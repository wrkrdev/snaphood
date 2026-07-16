"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  Wallet,
  WandSparkles
} from "lucide-react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  http,
  parseUnits,
  type Abi,
  type Hex
} from "viem";
import type { LaunchAcknowledgements, LaunchedCoin, LaunchpadStats, TokenDraft, Tokenomics } from "@/lib/types";
import SnapHoodToken from "@/generated/SnapHoodToken.json";

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
  }
}

type User = {
  id: string;
  email: string;
  isAdmin?: boolean;
};

type LaunchReceipt = {
  contractAddress: string;
  txHash: string;
  chainId: number;
  explorerUrl: string;
  mode: string;
  name: string;
  ticker: string;
  execution?: string;
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

type LaunchPlan = {
  draftId: string;
  mode: string;
  chain: {
    id: number;
    name: string;
    rpcUrl: string;
    explorerUrl: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
  };
  creatorWallet: string;
  contract: {
    args: [string, string, number, string, string];
  };
};

const launchAcknowledgementItems: Array<{
  key: keyof LaunchAcknowledgements;
  label: string;
}> = [
  { key: "noInvestmentValue", label: "This is a meme token experiment, not an investment product or financial promise." },
  { key: "noAffiliation", label: "SnapHood is not affiliated with Robinhood, Pump.fun, Dexscreener, or Uniswap." },
  { key: "contentRights", label: "I have the right to use the uploaded image and generated token details." },
  { key: "jurisdictionAllowed", label: "I am allowed to create this token from my jurisdiction." },
  { key: "userWalletPaysGas", label: "I will launch from my own wallet and pay the gas for any live transaction." }
];

function getPair(coin: LaunchedCoin) {
  return coin.dexscreenerPair as DexPair | undefined;
}

function compactUsd(value?: number) {
  if (value === undefined || value === null) return "pending";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: value >= 1000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1000 ? 1 : 2
  }).format(value);
}

function activityScore(coin: LaunchedCoin) {
  const pair = getPair(coin);
  return (pair?.volume?.h24 ?? 0) * 3 + (pair?.liquidity?.usd ?? 0) + (pair?.marketCap ?? pair?.fdv ?? 0) / 1000;
}

function isTradable(coin: LaunchedCoin) {
  return Boolean(coin.dexscreenerUrl || coin.poolAddress);
}

function mergeCoins(current: LaunchedCoin[], incoming: LaunchedCoin[]) {
  const seen = new Set(current.map((coin) => coin.id));
  return [...current, ...incoming.filter((coin) => !seen.has(coin.id))];
}

export default function SnapHoodApp() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState("demo@snaphood.fun");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [authMagicLink, setAuthMagicLink] = useState("");
  const [walletAddress, setWalletAddress] = useState("");
  const [walletChainId, setWalletChainId] = useState<number | null>(null);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [draft, setDraft] = useState<TokenDraft | null>(null);
  const [userDrafts, setUserDrafts] = useState<TokenDraft[]>([]);
  const [coins, setCoins] = useState<LaunchedCoin[]>([]);
  const [stats, setStats] = useState<LaunchpadStats | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [feedHasMore, setFeedHasMore] = useState(false);
  const [search, setSearch] = useState("");
  const [feedTab, setFeedTab] = useState<"movers" | "new" | "tradable">("movers");
  const [form, setForm] = useState({
    name: "",
    ticker: "",
    description: "",
    tokenomics: defaultTokenomics
  });
  const [acknowledgements, setAcknowledgements] = useState<Record<keyof LaunchAcknowledgements, boolean>>({
    noInvestmentValue: false,
    noAffiliation: false,
    contentRights: false,
    jurisdictionAllowed: false,
    userWalletPaysGas: false,
    liveAdminControlled: false
  });
  const [receipt, setReceipt] = useState<LaunchReceipt | null>(null);

  useEffect(() => {
    void refreshSession();
    void refreshCoins();
    void refreshStats();
    const authStatus = new URLSearchParams(window.location.search).get("auth");
    if (authStatus === "verified") {
      setAuthNotice("Signed in with magic link.");
      window.history.replaceState({}, "", window.location.pathname);
    } else if (authStatus === "expired") {
      setError("That sign-in link expired or was already used.");
      window.history.replaceState({}, "", window.location.pathname);
    } else if (authStatus === "missing") {
      setError("Sign-in link is missing a token.");
      window.history.replaceState({}, "", window.location.pathname);
    }
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
    setAcknowledgements({
      noInvestmentValue: false,
      noAffiliation: false,
      contentRights: false,
      jurisdictionAllowed: false,
      userWalletPaysGas: false,
      liveAdminControlled: false
    });
    setReceipt(null);
  }, [draft]);

  useEffect(() => {
    if (!user) {
      setUserDrafts([]);
      return;
    }

    void refreshDrafts();
  }, [user?.id]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void refreshCoins({
        query: search,
        tradableOnly: feedTab === "tradable"
      });
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [feedTab, search]);

  const allocationTotal = useMemo(
    () => form.tokenomics.allocation.reduce((sum, row) => sum + Number(row.percent || 0), 0),
    [form.tokenomics.allocation]
  );
  const acknowledgementsAccepted = useMemo(
    () => launchAcknowledgementItems.every((item) => acknowledgements[item.key]),
    [acknowledgements]
  );
  const requiresWalletLaunch = Boolean(draft && health?.readiness.launchMode !== "demo");
  const visibleCoins = useMemo(() => {
    const normalized = search.trim().toLowerCase();
    return coins
      .filter((coin) => {
        const matchesSearch =
          !normalized ||
          coin.name.toLowerCase().includes(normalized) ||
          coin.ticker.toLowerCase().includes(normalized) ||
          coin.contractAddress.toLowerCase().includes(normalized);
        const matchesTab = feedTab === "tradable" ? isTradable(coin) : true;
        return matchesSearch && matchesTab;
      })
      .sort((left, right) => {
        if (feedTab === "movers") {
          const scoreDelta = activityScore(right) - activityScore(left);
          if (scoreDelta !== 0) return scoreDelta;
        }

        return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
      });
  }, [coins, feedTab, search]);
  const featuredCoins = visibleCoins.slice(0, 4);

  async function refreshSession() {
    const response = await fetch("/api/me");
    const data = (await response.json()) as { user: User | null };
    setUser(data.user);
  }

  async function refreshCoins(
    filters: { query?: string; tradableOnly?: boolean; cursor?: string | null; append?: boolean } = {}
  ) {
    try {
      const params = new URLSearchParams();
      const query = filters.query?.trim();
      if (query) params.set("query", query);
      if (filters.tradableOnly) params.set("tradable", "true");
      if (filters.cursor) params.set("cursor", filters.cursor);
      const response = await fetch(`/api/coins${params.size ? `?${params}` : ""}`);
      const data = (await response.json()) as {
        coins?: LaunchedCoin[];
        pagination?: { hasMore?: boolean; nextCursor?: string | null };
      };
      const nextCoins = data.coins ?? [];
      setCoins((current) => (filters.append ? mergeCoins(current, nextCoins) : nextCoins));
      setNextCursor(data.pagination?.nextCursor ?? null);
      setFeedHasMore(Boolean(data.pagination?.hasMore));
    } catch {
      if (!filters.append) {
        setCoins([]);
      }
      setNextCursor(null);
      setFeedHasMore(false);
    }
  }

  async function refreshStats() {
    try {
      const response = await fetch("/api/coins/stats");
      const data = (await response.json()) as { stats?: LaunchpadStats };
      setStats(data.stats ?? null);
    } catch {
      setStats(null);
    }
  }

  async function refreshDrafts() {
    try {
      const response = await fetch("/api/me/drafts");
      if (!response.ok) {
        setUserDrafts([]);
        return;
      }
      const data = (await response.json()) as { drafts?: TokenDraft[] };
      setUserDrafts(data.drafts ?? []);
    } catch {
      setUserDrafts([]);
    }
  }

  async function signIn() {
    setBusy("auth");
    setError("");
    setAuthNotice("");
    setAuthMagicLink("");
    try {
      const response = await fetch("/api/auth/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not sign in.");
      if (data.user) {
        setUser(data.user);
        setAuthNotice("");
        return;
      }

      if (data.sent) {
        setAuthNotice(`Magic link sent to ${data.email}.`);
        setAuthMagicLink(data.magicLink ?? "");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not sign in.");
    } finally {
      setBusy(null);
    }
  }

  async function connectWallet() {
    setError("");
    if (!window.ethereum) {
      setError("Install a browser wallet that supports EVM networks, then reload SnapHood.");
      return "";
    }

    try {
      setBusy("wallet");
      const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
      const selected = accounts[0] ?? "";
      if (!selected) throw new Error("No wallet account was selected.");
      setWalletAddress(selected);
      const chainIdHex = (await window.ethereum.request({ method: "eth_chainId" })) as string;
      setWalletChainId(Number.parseInt(chainIdHex, 16));
      return selected;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not connect wallet.");
      return "";
    } finally {
      setBusy(null);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    setDraft(null);
    setUserDrafts([]);
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
      void refreshDrafts();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not generate token.");
    } finally {
      setBusy(null);
    }
  }

  async function launch() {
    if (!draft) return;
    if (requiresWalletLaunch) {
      await launchWithWallet();
      return;
    }

    setBusy("launch");
    setError("");

    try {
      const response = await fetch("/api/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: draft.id,
          ...form,
          ticker: form.ticker.toUpperCase(),
          acknowledgements: acknowledgementsAccepted
            ? {
                noInvestmentValue: true,
                noAffiliation: true,
                contentRights: true,
                jurisdictionAllowed: true,
                userWalletPaysGas: true
              }
            : acknowledgements
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not launch token.");
      setReceipt(data.launch);
      void refreshCoins({
        query: search,
        tradableOnly: feedTab === "tradable"
      });
      void refreshStats();
      void refreshDrafts();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not launch token.");
    } finally {
      setBusy(null);
    }
  }

  async function launchWithWallet() {
    if (!draft) return;
    setBusy("launch");
    setError("");

    try {
      const creatorWallet = walletAddress || (await connectWallet());
      if (!creatorWallet) return;
      setBusy("launch");

      const launchBody = {
        draftId: draft.id,
        ...form,
        ticker: form.ticker.toUpperCase(),
        creatorWallet,
        acknowledgements: acknowledgementsAccepted
          ? {
              noInvestmentValue: true,
              noAffiliation: true,
              contentRights: true,
              jurisdictionAllowed: true,
              userWalletPaysGas: true
            }
          : acknowledgements
      };

      const prepareResponse = await fetch("/api/launch/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(launchBody)
      });
      const prepared = (await prepareResponse.json()) as { launchPlan?: LaunchPlan; launch?: LaunchReceipt; error?: string };
      if (!prepareResponse.ok) throw new Error(prepared.error || "Could not prepare wallet launch.");
      if (prepared.launch) {
        setReceipt(prepared.launch);
        return;
      }
      if (!prepared.launchPlan) throw new Error("Launch plan was not returned.");

      const launchPlan = prepared.launchPlan;
      const ethereum = window.ethereum;
      if (!ethereum) throw new Error("Browser wallet is not available.");
      await switchWalletChain(launchPlan.chain);
      const chain = defineChain({
        id: launchPlan.chain.id,
        name: launchPlan.chain.name,
        nativeCurrency: launchPlan.chain.nativeCurrency,
        rpcUrls: { default: { http: [launchPlan.chain.rpcUrl] } },
        blockExplorers: { default: { name: "Robinhood Blockscout", url: launchPlan.chain.explorerUrl } }
      });
      const walletClient = createWalletClient({
        chain,
        transport: custom(ethereum)
      });
      const publicClient = createPublicClient({
        chain,
        transport: http(launchPlan.chain.rpcUrl)
      });
      const hash = await walletClient.deployContract({
        account: creatorWallet as Hex,
        abi: SnapHoodToken.abi as Abi,
        bytecode: SnapHoodToken.bytecode as Hex,
        args: [
          launchPlan.contract.args[0],
          launchPlan.contract.args[1],
          launchPlan.contract.args[2],
          parseUnits(launchPlan.contract.args[3], launchPlan.contract.args[2]),
          creatorWallet
        ]
      });

      const receiptResult = await publicClient.waitForTransactionReceipt({ hash });
      if (!receiptResult.contractAddress) throw new Error("Wallet transaction did not create a token contract.");

      const completeResponse = await fetch("/api/launch/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...launchBody,
          txHash: hash,
          contractAddress: receiptResult.contractAddress
        })
      });
      const completed = (await completeResponse.json()) as { launch?: LaunchReceipt; error?: string };
      if (!completeResponse.ok) throw new Error(completed.error || "Could not verify wallet launch.");
      if (!completed.launch) throw new Error("Launch receipt was not returned.");

      setReceipt(completed.launch);
      void refreshCoins({
        query: search,
        tradableOnly: feedTab === "tradable"
      });
      void refreshStats();
      void refreshDrafts();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not launch token from wallet.");
    } finally {
      setBusy(null);
    }
  }

  async function switchWalletChain(chain: LaunchPlan["chain"]) {
    if (!window.ethereum) throw new Error("Browser wallet is not available.");
    const chainId = `0x${chain.id.toString(16)}`;
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId }]
      });
    } catch (caught) {
      const code = typeof caught === "object" && caught && "code" in caught ? Number(caught.code) : undefined;
      if (code !== 4902) throw caught;
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId,
            chainName: chain.name,
            nativeCurrency: chain.nativeCurrency,
            rpcUrls: [chain.rpcUrl],
            blockExplorerUrls: [chain.explorerUrl]
          }
        ]
      });
    }

    setWalletChainId(chain.id);
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

  function resumeDraft(nextDraft: TokenDraft) {
    setDraft(nextDraft);
    setSelectedImage(nextDraft.originalImageUrl);
    setReceipt(null);
    setError("");
  }

  function loadMoreCoins() {
    if (!nextCursor) return;
    void refreshCoins({
      query: search,
      tradableOnly: feedTab === "tradable",
      cursor: nextCursor,
      append: true
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
            <span>Home</span>
          </a>
          <a className="side-link" href="#explore">
            <Flame size={16} />
            <span>Explore</span>
          </a>
          <a className="side-link" href="#create">
            <Rocket size={16} />
            <span>Create</span>
          </a>
          <a className="side-link" href="#stack">
            <Activity size={16} />
            <span>Stack</span>
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
            {health?.readiness.launchMode !== "demo" ? (
              <button className="btn ghost small" onClick={connectWallet} disabled={busy === "wallet"} type="button">
                <Wallet size={14} />
                {walletAddress ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : busy === "wallet" ? "Connecting" : "Wallet"}
              </button>
            ) : null}
            <button
              className="btn ghost small"
              onClick={() => {
                void refreshCoins({
                  query: search,
                  tradableOnly: feedTab === "tradable"
                });
                void refreshStats();
              }}
              type="button"
            >
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
                  <strong>{stats?.totalLaunches ?? coins.length}</strong>
                  <span>launches</span>
                </div>
              </div>
              <div className="ticker-card">
                <Flame size={18} />
                <div>
                  <strong>{stats?.tradableLaunches ?? coins.filter(isTradable).length}</strong>
                  <span>tradable</span>
                </div>
              </div>
              <div className="ticker-card">
                <WandSparkles size={18} />
                <div>
                  <strong>{compactUsd(stats?.totalLiquidityUsd)}</strong>
                  <span>liquidity</span>
                </div>
              </div>
              <div className="ticker-card">
                <ShieldCheck size={18} />
                <div>
                  <strong>{compactUsd(stats?.totalVolume24hUsd)}</strong>
                  <span>24h vol</span>
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
                      <em>{isTradable(coin) ? "trade" : "contract"}</em>
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
                <>
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
                                  <span>{isTradable(coin) ? "tradable" : "deployed only"}</span>
                                  {!isTradable(coin) ? <span>needs pool</span> : null}
                                  <span>chain {coin.chainId}</span>
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
                          {coin.txUrl ? (
                            <a className="btn ghost small" href={coin.txUrl} target="_blank" rel="noreferrer">
                              Tx
                            </a>
                          ) : null}
                          {coin.dexscreenerUrl ? (
                            <a className="btn primary small" href={coin.dexscreenerUrl} target="_blank" rel="noreferrer">
                              Chart
                            </a>
                          ) : !coin.poolAddress ? (
                            <span className="trade-note">pool needed for chart</span>
                          ) : null}
                        </div>
                      </article>
                    ))}
                  </div>
                  {feedHasMore && nextCursor ? (
                    <button className="btn ghost feed-more" onClick={loadMoreCoins} type="button">
                      <RefreshCw size={15} />
                      Load more
                    </button>
                  ) : null}
                </>
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
                    {authNotice ? (
                      <div className="toast">
                        <strong>{authNotice}</strong>
                        {authMagicLink ? (
                          <a href={authMagicLink}>
                            Open local magic link <ExternalLink size={13} />
                          </a>
                        ) : null}
                      </div>
                    ) : null}
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
                        ref={fileInputRef}
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

                    <button
                      className="btn ghost"
                      disabled={busy === "generate"}
                      onClick={() => fileInputRef.current?.click()}
                      type="button"
                    >
                      <Upload size={16} />
                      {busy === "generate" ? "Generating" : "Upload snap"}
                    </button>

                    {userDrafts.length > 0 ? (
                      <div className="recent-drafts" aria-label="Recent token drafts">
                        <div className="recent-drafts-head">
                          <span>Recent drafts</span>
                          <button
                            className="icon-action"
                            onClick={() => void refreshDrafts()}
                            type="button"
                            aria-label="Refresh drafts"
                          >
                            <RefreshCw size={14} />
                          </button>
                        </div>
                        {userDrafts.map((item) => (
                          <div className={draft?.id === item.id ? "draft-row active" : "draft-row"} key={item.id}>
                            <img src={item.profileImageUrl} alt="" />
                            <button
                              className="draft-row-main"
                              onClick={() => resumeDraft(item)}
                              type="button"
                              disabled={item.status === "launched"}
                            >
                              <strong>{item.name}</strong>
                              <span>${item.ticker} · {item.status}</span>
                            </button>
                            {item.status === "launched" && item.contractAddress ? (
                              <a
                                className="icon-action"
                                href={`/coin/${item.contractAddress}`}
                                aria-label={`Open ${item.name}`}
                              >
                                <ExternalLink size={14} />
                              </a>
                            ) : (
                              <button
                                className="icon-action"
                                onClick={() => resumeDraft(item)}
                                type="button"
                                aria-label={`Resume ${item.name}`}
                              >
                                <Rocket size={14} />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </>
                )}

                {error ? <div className="toast error">{error}</div> : null}

                {draft ? (
                  <div className="stack">
                    <div className="token-preview">
                      <div className="coin remix-coin">
                        <img src={draft.profileImageUrl} alt="" />
                      </div>
                      <div>
                        <span className="token-preview-label">snap remix</span>
                        <h3>{form.name || "Untitled Token"}</h3>
                        <p>${form.ticker || "SNAP"} · {form.tokenomics.supply}</p>
                        {draft.promptSummary ? <p className="meme-angle">{draft.promptSummary}</p> : null}
                  </div>
                  <div className="disclaimer">
                    {requiresWalletLaunch
                      ? "Live launches deploy from your connected wallet. SnapHood stores the verified receipt after the chain confirms it."
                      : "Demo launches create a realistic receipt without broadcasting a transaction."}
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

                    <div className="ack-panel" aria-label="Launch acknowledgements">
                      <div className="ack-head">
                        <ShieldCheck size={16} />
                        <strong>Launch guardrails</strong>
                      </div>
                      {launchAcknowledgementItems.map((item) => (
                        <label className="check-row" key={item.key}>
                          <input
                            type="checkbox"
                            checked={acknowledgements[item.key]}
                            onChange={(event) =>
                              setAcknowledgements((current) => ({
                                ...current,
                                [item.key]: event.target.checked
                              }))
                            }
                          />
                          <span>{item.label}</span>
                        </label>
                      ))}
                    </div>

                    {requiresWalletLaunch ? (
                      <div className="toast">
                        {walletAddress
                          ? `Wallet connected${walletChainId ? ` on chain ${walletChainId}` : ""}.`
                          : "Connect an EVM wallet to launch this token with your own gas."}
                      </div>
                    ) : null}

                    <button
                      className="btn primary"
                      disabled={busy === "launch" || busy === "wallet" || allocationTotal !== 100 || !acknowledgementsAccepted}
                      onClick={requiresWalletLaunch && !walletAddress ? connectWallet : launch}
                      type="button"
                    >
                      {requiresWalletLaunch && !walletAddress ? <Wallet size={17} /> : <Rocket size={17} />}
                      {requiresWalletLaunch && !walletAddress
                        ? busy === "wallet"
                          ? "Connecting"
                          : "Connect wallet"
                        : busy === "launch"
                          ? "Launching"
                          : requiresWalletLaunch
                            ? "Launch from wallet"
                            : "Launch demo"}
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
