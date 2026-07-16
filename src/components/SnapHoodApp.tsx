"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Camera,
  Clock,
  ExternalLink,
  Flame,
  Home,
  ImageIcon,
  LogOut,
  RefreshCw,
  Rocket,
  Search,
  ShieldCheck,
  Sparkles,
  Trophy,
  Upload,
  WandSparkles
} from "lucide-react";
import type { LaunchedCoin, TokenDraft, Tokenomics } from "@/lib/types";

type User = {
  id: string;
  email: string;
};

type LaunchReceipt = {
  contractAddress: string;
  txHash: string;
  chainId: number;
  explorerUrl: string;
  mode: string;
  name: string;
  ticker: string;
};

type Health = {
  ok: boolean;
  readiness: {
    databaseReachable: boolean;
    ai: boolean;
    imageAi: boolean;
    storage: boolean;
    adminConfigured: boolean;
    launchMode: string;
    network: string;
    chainId: number;
  };
};

const defaultTokenomics: Tokenomics = {
  supply: "1000000000",
  decimals: 18,
  allocation: [
    { label: "Community memes", percent: 45 },
    { label: "Liquidity seed", percent: 30 },
    { label: "Creator vault", percent: 15 },
    { label: "Airdrops", percent: 10 }
  ],
  notes: ["Fixed supply.", "No transfer tax.", "No implied investment value."]
};

type DexPair = {
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  marketCap?: number;
  fdv?: number;
};

function getPair(coin: LaunchedCoin) {
  return coin.dexscreenerPair as DexPair | undefined;
}

function compactUsd(value?: number) {
  if (!value) return "pending";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: value >= 1000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1000 ? 1 : 2
  }).format(value);
}

export default function SnapHoodApp() {
  const [health, setHealth] = useState<Health | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("demo@snaphood.fun");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [draft, setDraft] = useState<TokenDraft | null>(null);
  const [coins, setCoins] = useState<LaunchedCoin[]>([]);
  const [search, setSearch] = useState("");
  const [feedTab, setFeedTab] = useState<"movers" | "new" | "tradable">("movers");
  const [form, setForm] = useState({
    name: "",
    ticker: "",
    description: "",
    tokenomics: defaultTokenomics
  });
  const [receipt, setReceipt] = useState<LaunchReceipt | null>(null);

  useEffect(() => {
    void refreshSession();
    void refreshCoins();
    void fetch("/api/health")
      .then((response) => response.json())
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  useEffect(() => {
    if (!draft) return;
    setForm({
      name: draft.name,
      ticker: draft.ticker,
      description: draft.description,
      tokenomics: draft.tokenomics
    });
    setReceipt(null);
  }, [draft]);

  const allocationTotal = useMemo(
    () => form.tokenomics.allocation.reduce((sum, row) => sum + Number(row.percent || 0), 0),
    [form.tokenomics.allocation]
  );
  const visibleCoins = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return coins.filter((coin) => {
      const matchesSearch =
        !normalized ||
        coin.name.toLowerCase().includes(normalized) ||
        coin.ticker.toLowerCase().includes(normalized) ||
        coin.contractAddress.toLowerCase().includes(normalized);
      const matchesTab =
        feedTab === "tradable" ? Boolean(coin.dexscreenerUrl) : feedTab === "new" ? true : true;
      return matchesSearch && matchesTab;
    });
  }, [coins, feedTab, search]);
  const featuredCoins = visibleCoins.slice(0, 4);

  async function refreshSession() {
    const response = await fetch("/api/me");
    const data = (await response.json()) as { user: User | null };
    setUser(data.user);
  }

  async function refreshCoins() {
    try {
      const response = await fetch("/api/coins");
      const data = (await response.json()) as { coins?: LaunchedCoin[] };
      setCoins(data.coins ?? []);
    } catch {
      setCoins([]);
    }
  }

  async function signIn() {
    setBusy("auth");
    setError("");
    try {
      const response = await fetch("/api/auth/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not sign in.");
      setUser(data.user);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not sign in.");
    } finally {
      setBusy(null);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    setDraft(null);
    setReceipt(null);
  }

  async function generate(file: File) {
    setBusy("generate");
    setError("");
    setReceipt(null);
    setSelectedImage(URL.createObjectURL(file));

    const body = new FormData();
    body.append("image", file);

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        body
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not generate token.");
      setDraft(data.draft);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not generate token.");
    } finally {
      setBusy(null);
    }
  }

  async function launch() {
    if (!draft) return;
    setBusy("launch");
    setError("");

    try {
      const response = await fetch("/api/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: draft.id,
          ...form,
          ticker: form.ticker.toUpperCase()
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not launch token.");
      setReceipt(data.launch);
      void refreshCoins();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not launch token.");
    } finally {
      setBusy(null);
    }
  }

  function updateAllocation(index: number, key: "label" | "percent", value: string) {
    setForm((current) => {
      const allocation = current.tokenomics.allocation.map((row, rowIndex) =>
        rowIndex === index
          ? {
              ...row,
              [key]: key === "percent" ? Number(value) : value
            }
          : row
      );
      return { ...current, tokenomics: { ...current.tokenomics, allocation } };
    });
  }

  return (
    <main className="pump-shell">
      <aside className="side-rail" aria-label="SnapHood navigation">
        <a className="pump-brand" href="#">
          <span className="brand-mark">S</span>
          <span>SnapHood</span>
        </a>
        <nav className="side-links">
          <a className="side-link active" href="#">
            <Home size={16} />
            Home
          </a>
          <a className="side-link" href="#explore">
            <Flame size={16} />
            Explore
          </a>
          <a className="side-link" href="#create">
            <Rocket size={16} />
            Create
          </a>
          <a className="side-link" href="#stack">
            <Activity size={16} />
            Stack
          </a>
        </nav>
        <div className="side-status">
          <span className="status-pill">
            <span className="dot" />
            {health?.readiness.network ?? "mainnet"} · {health?.readiness.chainId ?? 4663}
          </span>
          <span className="mini-copy">{health?.readiness.launchMode ?? "mainnet"} mode</span>
        </div>
      </aside>

      <div className="pump-main">
        <header className="pump-topbar">
          <div className="searchbox">
            <Search size={16} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search coins, tickers, or contracts..."
            />
          </div>
          <div className="nav-actions">
            <button className="btn ghost small" onClick={() => void refreshCoins()} type="button">
              <RefreshCw size={14} />
              Refresh
            </button>
            <a className="btn primary small" href="#create">
              <Rocket size={14} />
              Create
            </a>
            {user ? (
              <button className="btn ghost small" onClick={logout} type="button" aria-label="Sign out">
                <LogOut size={15} />
                {user.email}
              </button>
            ) : null}
          </div>
        </header>

        <div className="pump-layout">
          <section className="feed-column">
            <div className="ticker-strip">
              <div className="ticker-card hot">
                <Trophy size={18} />
                <div>
                  <strong>{coins.length}</strong>
                  <span>launches</span>
                </div>
              </div>
              <div className="ticker-card">
                <Flame size={18} />
                <div>
                  <strong>{coins.filter((coin) => coin.dexscreenerUrl).length}</strong>
                  <span>tradable</span>
                </div>
              </div>
              <div className="ticker-card">
                <WandSparkles size={18} />
                <div>
                  <strong>{health?.readiness.ai ? "live" : "demo"}</strong>
                  <span>AI</span>
                </div>
              </div>
              <div className="ticker-card">
                <ShieldCheck size={18} />
                <div>
                  <strong>{health?.readiness.databaseReachable ? "online" : "offline"}</strong>
                  <span>Wrkr DB</span>
                </div>
              </div>
            </div>

            <section className="launch-strip" aria-label="Trending launches">
              <div className="feed-head">
                <div>
                  <h1>Launches</h1>
                  <p>snap a thing, mint a meme, make it trade</p>
                </div>
              </div>
              {featuredCoins.length > 0 ? (
                <div className="featured-row">
                  {featuredCoins.map((coin) => (
                    <a className="featured-card" href={`/coin/${coin.contractAddress}`} key={coin.id}>
                      <img src={coin.profileImageUrl} alt="" />
                      <div>
                        <strong>${coin.ticker}</strong>
                        <span>{coin.name}</span>
                      </div>
                      <em>{coin.dexscreenerUrl ? "chart" : "contract"}</em>
                    </a>
                  ))}
                </div>
              ) : (
                <div className="empty-launchpad compact">
                  <Rocket size={18} />
                  <span>no launches yet</span>
                </div>
              )}
            </section>

            <section className="explore-panel" id="explore">
              <div className="explore-top">
                <h2>Explore coins</h2>
                <div className="tabs" role="tablist" aria-label="Coin feed">
                  <button className={feedTab === "movers" ? "tab active" : "tab"} onClick={() => setFeedTab("movers")} type="button">
                    <Flame size={14} />
                    Movers
                  </button>
                  <button className={feedTab === "new" ? "tab active" : "tab"} onClick={() => setFeedTab("new")} type="button">
                    <Clock size={14} />
                    New
                  </button>
                  <button className={feedTab === "tradable" ? "tab active" : "tab"} onClick={() => setFeedTab("tradable")} type="button">
                    <Activity size={14} />
                    Tradable
                  </button>
                </div>
              </div>

              {visibleCoins.length > 0 ? (
                <div className="coin-feed">
                  {visibleCoins.map((coin) => (
                    <article className="feed-card" key={coin.id}>
                      {(() => {
                        const pair = getPair(coin);
                        return (
                          <>
                            <img className="feed-card-image" src={coin.profileImageUrl} alt="" />
                            <div className="feed-card-main">
                              <div className="feed-card-title">
                                <h3>{coin.name}</h3>
                                <span>${coin.ticker}</span>
                              </div>
                              <p>{coin.description}</p>
                              <div className="coin-meta">
                                <span>MC {compactUsd(pair?.marketCap ?? pair?.fdv)}</span>
                                <span>Liq {compactUsd(pair?.liquidity?.usd)}</span>
                                <span>Vol {compactUsd(pair?.volume?.h24)}</span>
                              </div>
                              <div className="coin-meta">
                                <span>{coin.dexscreenerUrl ? "tradable" : "deployed"}</span>
                                <span>{new Date(coin.updatedAt).toLocaleDateString()}</span>
                              </div>
                            </div>
                          </>
                        );
                      })()}
                      <div className="feed-card-actions">
                        <a className="btn ghost small" href={`/coin/${coin.contractAddress}`}>
                          Details
                        </a>
                        <a className="btn ghost small" href={coin.explorerUrl} target="_blank" rel="noreferrer">
                          <ExternalLink size={14} />
                          Contract
                        </a>
                        {coin.dexscreenerUrl ? (
                          <a className="btn primary small" href={coin.dexscreenerUrl} target="_blank" rel="noreferrer">
                            Chart
                          </a>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="empty-launchpad">
                  <Rocket size={22} />
                  <span>No matching launches.</span>
                </div>
              )}
            </section>
          </section>

          <aside className="creator-column" id="create">
            <section className="panel launch-panel" aria-label="Token launch workflow">
              <div className="panel-head">
                <div>
                  <h2 className="panel-title">Create coin</h2>
                  <p className="panel-subtitle">camera → AI → launch</p>
                </div>
                <span className="status-pill">
                  <Sparkles size={14} />
                  snap
                </span>
              </div>
              <div className="panel-body stack">
                {!user ? (
                  <div className="stack">
                    <label className="label">
                      Email
                      <div className="auth-row">
                        <input
                          className="field"
                          inputMode="email"
                          value={email}
                          onChange={(event) => setEmail(event.target.value)}
                          placeholder="you@example.com"
                        />
                  <button className="btn primary" onClick={signIn} disabled={busy === "auth"} type="button">
                          {busy === "auth" ? "..." : "Start"}
                        </button>
                      </div>
                    </label>
                  </div>
                ) : (
                  <>
                    <label className="dropzone compact-drop">
                      {selectedImage || draft?.originalImageUrl ? (
                        <img
                          className="preview-image"
                          src={selectedImage ?? draft?.originalImageUrl}
                          alt="Uploaded token inspiration"
                        />
                      ) : (
                        <span className="dropzone-content">
                          <span className="drop-icon">
                            <Camera size={22} />
                          </span>
                          <strong>snap to coin</strong>
                          <span>camera or upload</span>
                        </span>
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        disabled={busy === "generate"}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void generate(file);
                        }}
                      />
                    </label>

                    <button className="btn ghost" type="button">
                      <Upload size={16} />
                      {busy === "generate" ? "Generating" : "Upload snap"}
                    </button>
                  </>
                )}

                {error ? <div className="toast error">{error}</div> : null}

                {draft ? (
                  <div className="stack">
                    <div className="token-preview">
                      <div className="coin">{form.ticker || "SNAP"}</div>
                      <div>
                        <h3>{form.name || "Untitled Token"}</h3>
                        <p>${form.ticker || "SNAP"} · {form.tokenomics.supply}</p>
                  </div>
                  <div className="disclaimer">
                    Live launches are admin-controlled; public visitors can explore the launchpad and generate drafts.
                  </div>
                </div>

                    <div className="form-grid">
                      <label className="label">
                        Name
                        <input
                          className="field"
                          value={form.name}
                          onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                        />
                      </label>
                      <label className="label">
                        Ticker
                        <input
                          className="field"
                          value={form.ticker}
                          maxLength={6}
                          onChange={(event) =>
                            setForm((current) => ({
                              ...current,
                              ticker: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "")
                            }))
                          }
                        />
                      </label>
                    </div>

                    <label className="label">
                      Description
                      <textarea
                        className="textarea"
                        value={form.description}
                        onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                      />
                    </label>

                    <div className="tokenomics mini-tokenomics" aria-label="Tokenomics allocation">
                      {form.tokenomics.allocation.map((row, index) => (
                        <div className="tokenomics-row" key={`${row.label}-${index}`}>
                          <input
                            className="field"
                            value={row.label}
                            onChange={(event) => updateAllocation(index, "label", event.target.value)}
                            aria-label={`Allocation label ${index + 1}`}
                          />
                          <input
                            className="field"
                            type="number"
                            min={0}
                            max={100}
                            value={row.percent}
                            onChange={(event) => updateAllocation(index, "percent", event.target.value)}
                            aria-label={`Allocation percent ${index + 1}`}
                          />
                        </div>
                      ))}
                      <div className={allocationTotal === 100 ? "toast" : "toast error"}>{allocationTotal}% allocated</div>
                    </div>

                    <button
                      className="btn primary"
                      disabled={busy === "launch" || allocationTotal !== 100}
                      onClick={launch}
                      type="button"
                    >
                      <Rocket size={17} />
                      {busy === "launch" ? "Launching" : "Launch"}
                    </button>
                  </div>
                ) : null}

                {receipt ? (
                  <div className="toast">
                    <strong>${receipt.ticker} launched</strong>
                    <a href={receipt.explorerUrl} target="_blank" rel="noreferrer">
                      Open explorer <ExternalLink size={13} />
                    </a>
                  </div>
                ) : null}
              </div>
            </section>

            <section className="stack-proof" id="stack">
              <div>
                <ImageIcon size={15} />
                <span>uploads</span>
                <strong>{health?.readiness.storage ? "storage" : "local"}</strong>
              </div>
              <div>
                <WandSparkles size={15} />
                <span>AI</span>
                <strong>{health?.readiness.ai && health.readiness.imageAi ? "live" : "fallback"}</strong>
              </div>
              <div>
                <Activity size={15} />
                <span>chain</span>
                <strong>{health?.readiness.chainId ?? 4663}</strong>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
