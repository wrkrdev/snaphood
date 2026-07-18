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
import { ThemeToggle } from "@/components/ThemeToggle";

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

// Distinct, on-brand colors for the allocation bar segments (last slot = still unallocated).
const allocationColors = ["#00c805", "#0a9d5f", "#0ea5b7", "#3b7df6", "#f59e0b", "#ef476f"];
const unallocatedColor = "#dbe4da";

// Playful status messages that cycle while the snap is being remixed into a coin.
const remixMessages = [
  "Reading your snap…",
  "Finding the meme angle…",
  "Mixing the coin colors…",
  "Naming your token…",
  "Minting the vibe…",
  "Almost there…"
];

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

function formatCount(value: string) {
  const parsed = Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(parsed)) return value;
  return new Intl.NumberFormat("en-US", {
    notation: parsed >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: 1
  }).format(parsed);
}

function activityScore(coin: LaunchedCoin) {
  const pair = getPair(coin);
  return (pair?.volume?.h24 ?? 0) * 3 + (pair?.liquidity?.usd ?? 0) + (pair?.marketCap ?? pair?.fdv ?? 0) / 1000;
}

function isTradable(coin: LaunchedCoin) {
  return Boolean(coin.dexscreenerUrl || coin.poolAddress);
}

// The chart is only "live" once Dexscreener has returned pair data. A pool (or a bare URL)
// is not enough — the chart page 404s until the pool is actually indexed.
function hasChart(coin: LaunchedCoin) {
  return Boolean(coin.dexscreenerPair);
}

function mergeCoins(current: LaunchedCoin[], incoming: LaunchedCoin[]) {
  const seen = new Set(current.map((coin) => coin.id));
  return [...current, ...incoming.filter((coin) => !seen.has(coin.id))];
}

export default function SnapHoodApp() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const creatorPanelRef = useRef<HTMLElement | null>(null);
  const [remixStep, setRemixStep] = useState(0);
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
  const [launchStage, setLaunchStage] = useState("");

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
    } else if (authStatus === "throttled") {
      setError("Too many sign-in attempts. Wait a minute, then open your most recent link.");
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

  // Cycle the playful remixing messages while a snap is being generated.
  useEffect(() => {
    if (busy !== "generate") return;
    setRemixStep(0);
    const interval = window.setInterval(() => {
      setRemixStep((step) => (step + 1) % remixMessages.length);
    }, 1400);
    return () => window.clearInterval(interval);
  }, [busy]);

  // When a draft appears or a launch succeeds, bring the creator panel into view so the
  // reveal (and the snap → remix image at its top) is never left scrolled out of sight.
  useEffect(() => {
    if (!draft && !receipt) return;
    creatorPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [draft?.id, receipt?.contractAddress]);

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
  const allocationRemaining = Math.max(0, 100 - allocationTotal);
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
  const spiceChips = useMemo(() => {
    if (!draft) return [];
    const ticker = form.ticker || draft.ticker || "SNAP";
    return [
      `$${ticker} energy`,
      form.tokenomics.allocation[0]?.label ?? "Community memes",
      form.tokenomics.notes[0] ?? "Fixed supply",
      requiresWalletLaunch ? "wallet launch" : "demo launch"
    ].filter(Boolean);
  }, [draft, form.ticker, form.tokenomics.allocation, form.tokenomics.notes, requiresWalletLaunch]);

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
      setLaunchStage("Waiting for your wallet…");
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

      setLaunchStage(`Deploying $${form.ticker || draft.ticker} on-chain…`);
      let deployedContract: string | undefined;
      try {
        const receiptResult = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000, pollingInterval: 2500 });
        deployedContract = receiptResult.contractAddress ?? undefined;
      } catch {
        // Browser RPCs can be slow to surface the receipt; the server re-verifies from the
        // tx hash below, so a slow confirmation never leaves the launch stuck.
      }

      setLaunchStage("Saving your launch proof…");
      const launched = await finishWalletLaunch(launchBody, hash, deployedContract);

      setReceipt(launched);
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
      setLaunchStage("");
    }
  }

  // Record the launch server-side, retrying while the chain finishes confirming so a slow
  // block never leaves the UI stuck after the token has actually deployed.
  async function finishWalletLaunch(
    launchBody: Record<string, unknown>,
    txHash: string,
    contractAddress: string | undefined
  ): Promise<LaunchReceipt> {
    let lastError = "Could not verify wallet launch.";
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await fetch("/api/launch/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...launchBody, txHash, contractAddress })
      });
      const data = (await response.json()) as { launch?: LaunchReceipt; error?: string };
      if (response.ok && data.launch) {
        return data.launch;
      }
      lastError = data.error || lastError;
      setLaunchStage("Confirming on Robinhood Chain…");
      await new Promise((resolve) => window.setTimeout(resolve, 5000));
    }
    throw new Error(lastError);
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
      const allocation = current.tokenomics.allocation.map((row, rowIndex) => {
        if (rowIndex !== index) return row;
        if (key === "label") return { ...row, label: value };
        // Cap each edit at the percentage still available so the mix can never exceed 100%.
        const othersTotal = current.tokenomics.allocation.reduce(
          (sum, other, otherIndex) => (otherIndex === index ? sum : sum + Number(other.percent || 0)),
          0
        );
        const requested = Math.round(Number(value) || 0);
        const capped = Math.max(0, Math.min(requested, 100 - othersTotal));
        return { ...row, percent: capped };
      });
      return { ...current, tokenomics: { ...current.tokenomics, allocation } };
    });
  }

  function addAllocationRow() {
    setForm((current) => {
      if (current.tokenomics.allocation.length >= 6) return current;
      return {
        ...current,
        tokenomics: {
          ...current.tokenomics,
          allocation: [...current.tokenomics.allocation, { label: "New split", percent: 0 }]
        }
      };
    });
  }

  function removeAllocationRow(index: number) {
    setForm((current) => {
      if (current.tokenomics.allocation.length <= 1) return current;
      return {
        ...current,
        tokenomics: {
          ...current.tokenomics,
          allocation: current.tokenomics.allocation.filter((_, rowIndex) => rowIndex !== index)
        }
      };
    });
  }

  function autoBalanceAllocation() {
    setForm((current) => {
      const rows = current.tokenomics.allocation;
      if (rows.length === 0) return current;
      const total = rows.reduce((sum, row) => sum + Number(row.percent || 0), 0);
      const remaining = 100 - total;
      if (remaining <= 0) return current;
      // Give the leftover percentage to the largest bucket so the split always totals exactly 100%.
      let targetIndex = 0;
      rows.forEach((row, index) => {
        if (Number(row.percent || 0) >= Number(rows[targetIndex].percent || 0)) targetIndex = index;
      });
      const allocation = rows.map((row, index) =>
        index === targetIndex ? { ...row, percent: Number(row.percent || 0) + remaining } : row
      );
      return { ...current, tokenomics: { ...current.tokenomics, allocation } };
    });
  }

  function setAllAcknowledgements(value: boolean) {
    setAcknowledgements({
      noInvestmentValue: value,
      noAffiliation: value,
      contentRights: value,
      jurisdictionAllowed: value,
      userWalletPaysGas: value,
      liveAdminControlled: value
    });
  }

  function resetCreator() {
    setDraft(null);
    setReceipt(null);
    setSelectedImage(null);
    setError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
    void refreshDrafts();
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
          <a className="side-link" href="/leaderboard">
            <Trophy size={16} />
            <span>Leaderboard</span>
          </a>
          <a className="side-link" href="#create">
            <Rocket size={16} />
            <span>Create</span>
          </a>
          <a className="side-link" href="#stack">
            <Activity size={16} />
            <span>Proof</span>
          </a>
        </nav>
        <div className="side-status">
          <span className="status-pill">
            <span className="dot" />
            Live chain
          </span>
          <span className="mini-copy">wallet-powered launches</span>
        </div>
      </aside>

      <div className="pump-main">
        <header className="pump-topbar">
          <div className="searchbox">
            <Search size={16} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search coins or tickers..."
              aria-label="Search coins"
            />
          </div>
          <div className="nav-actions">
            <ThemeToggle className="small" />
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
                      <em>{hasChart(coin) ? "live" : "new"}</em>
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
                    Charts
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
                                  <span className={hasChart(coin) ? "meta-live" : "meta-soft"}>
                                    {hasChart(coin) ? "Chart live" : coin.poolAddress ? "Chart soon" : "New launch"}
                                  </span>
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
                            Proof
                          </a>
                          {coin.txUrl ? (
                            <a className="btn ghost small" href={coin.txUrl} target="_blank" rel="noreferrer">
                              Receipt
                            </a>
                          ) : null}
                          {hasChart(coin) && coin.dexscreenerUrl ? (
                            <a className="btn primary small" href={coin.dexscreenerUrl} target="_blank" rel="noreferrer">
                              Chart
                            </a>
                          ) : (
                            <a className="btn ghost small chart-soon" href={`/coin/${coin.contractAddress}`}>
                              Chart soon
                            </a>
                          )}
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
            <section className="panel launch-panel" aria-label="Token launch workflow" ref={creatorPanelRef}>
              <div className="panel-head">
                <div>
                  <h2 className="panel-title">Create coin</h2>
                  <p className="panel-subtitle">snap → remix → launch</p>
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
                ) : receipt ? (
                  <div className="launch-success" aria-live="polite">
                    <div className="success-crown">
                      {draft?.profileImageUrl ? (
                        <span className="success-coin">
                          <img src={draft.profileImageUrl} alt="" />
                        </span>
                      ) : (
                        <span className="success-coin">
                          <Rocket size={26} />
                        </span>
                      )}
                      <span className="success-spark">
                        <Sparkles size={14} />
                        launched
                      </span>
                    </div>
                    <div className="success-headline">
                      <h3>${receipt.ticker} is live</h3>
                      <p>{receipt.name} is now a real coin on Robinhood Chain. Here&apos;s what&apos;s next.</p>
                    </div>
                    <div className="success-status">
                      <div className="status-line done">
                        <span className="status-ic">
                          <Rocket size={15} />
                        </span>
                        <div>
                          <strong>Coin created</strong>
                          <span>Minted straight to your wallet.</span>
                        </div>
                        <a className="status-link" href={receipt.explorerUrl} target="_blank" rel="noreferrer">
                          Proof
                          <ExternalLink size={13} />
                        </a>
                      </div>
                      <div className="status-line pending">
                        <span className="status-ic">
                          <Activity size={15} />
                        </span>
                        <div>
                          <strong>Chart not live yet</strong>
                          <span>Add a little liquidity so people can trade it — then a live price chart appears.</span>
                        </div>
                      </div>
                    </div>
                    <div className="next-actions">
                      <a className="btn primary" href={`/coin/${receipt.contractAddress}`}>
                        <Flame size={16} />
                        Make it tradable
                      </a>
                      <a className="btn ghost" href={`/coin/${receipt.contractAddress}`}>
                        Open coin page
                      </a>
                      <button className="btn ghost" onClick={resetCreator} type="button">
                        <Camera size={16} />
                        Snap another
                      </button>
                    </div>
                  </div>
                ) : draft ? (
                  <div className="reveal stack">
                    <input
                      ref={fileInputRef}
                      className="hidden-file"
                      type="file"
                      accept="image/*"
                      capture="environment"
                      disabled={busy === "generate"}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void generate(file);
                      }}
                    />

                    <div className="reveal-head">
                      <span className="reveal-badge">
                        <Sparkles size={13} />
                        your coin is ready
                      </span>
                      <button
                        className="text-action"
                        onClick={() => fileInputRef.current?.click()}
                        type="button"
                        disabled={busy === "generate"}
                      >
                        <Camera size={13} />
                        {busy === "generate" ? "Remixing" : "Different snap"}
                      </button>
                    </div>

                    <div className="snap-baton" aria-label="Your snap remixed into coin art">
                      <figure>
                        <img src={selectedImage ?? draft.originalImageUrl} alt="Your snap" />
                        <figcaption>your snap</figcaption>
                      </figure>
                      <span className="baton-arrow">
                        <WandSparkles size={18} />
                      </span>
                      <figure>
                        <img src={draft.profileImageUrl} alt="Coin remix" />
                        <figcaption>coin remix</figcaption>
                      </figure>
                    </div>

                    {draft.promptSummary ? (
                      <p className="meme-angle-line">
                        <Flame size={14} />
                        {draft.promptSummary}
                      </p>
                    ) : null}

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
                        <div className="ticker-field">
                          <span>$</span>
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
                        </div>
                      </label>
                    </div>

                    <label className="label">
                      Story
                      <textarea
                        className="textarea"
                        value={form.description}
                        onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                      />
                    </label>

                    <div className="alloc-editor" aria-label="Token split">
                      <div className="alloc-top">
                        <div>
                          <span className="alloc-title">Token split</span>
                          <span className="alloc-sub">{formatCount(form.tokenomics.supply)} coins · divide them below</span>
                        </div>
                        <span className={allocationRemaining === 0 ? "alloc-remaining done" : "alloc-remaining"}>
                          {allocationRemaining === 0 ? "100% allocated" : `${allocationRemaining}% left`}
                        </span>
                      </div>

                      <div className="alloc-bar" role="img" aria-label={`${allocationTotal}% of the supply allocated`}>
                        {form.tokenomics.allocation.map((row, index) =>
                          Number(row.percent) > 0 ? (
                            <span
                              key={`seg-${index}`}
                              className="alloc-seg"
                              style={{ width: `${row.percent}%`, background: allocationColors[index % allocationColors.length] }}
                              title={`${row.label} · ${row.percent}%`}
                            />
                          ) : null
                        )}
                        {allocationRemaining > 0 ? (
                          <span className="alloc-seg unallocated" style={{ width: `${allocationRemaining}%`, background: unallocatedColor }} />
                        ) : null}
                      </div>

                      <div className="alloc-rows">
                        {form.tokenomics.allocation.map((row, index) => (
                          <div className="alloc-row" key={`row-${index}`}>
                            <span className="alloc-dot" style={{ background: allocationColors[index % allocationColors.length] }} />
                            <input
                              className="field alloc-label"
                              value={row.label}
                              onChange={(event) => updateAllocation(index, "label", event.target.value)}
                              aria-label={`Split label ${index + 1}`}
                            />
                            <div className="alloc-percent">
                              <input
                                className="field"
                                type="number"
                                min={0}
                                max={100}
                                value={row.percent}
                                onChange={(event) => updateAllocation(index, "percent", event.target.value)}
                                aria-label={`Split percent ${index + 1}`}
                              />
                              <span>%</span>
                            </div>
                            {form.tokenomics.allocation.length > 1 ? (
                              <button
                                className="alloc-remove"
                                onClick={() => removeAllocationRow(index)}
                                type="button"
                                aria-label={`Remove ${row.label || "split"}`}
                              >
                                ×
                              </button>
                            ) : null}
                          </div>
                        ))}
                      </div>

                      <div className="alloc-actions">
                        {form.tokenomics.allocation.length < 6 ? (
                          <button className="text-action" onClick={addAllocationRow} type="button">
                            + Add split
                          </button>
                        ) : null}
                        {allocationRemaining > 0 ? (
                          <button className="text-action" onClick={autoBalanceAllocation} type="button">
                            Fill the last {allocationRemaining}%
                          </button>
                        ) : null}
                      </div>
                    </div>

                    <div className="spice-chips" aria-label="Coin vibe">
                      {spiceChips.map((chip) => (
                        <span key={chip}>{chip}</span>
                      ))}
                    </div>

                    <div className="ack-master">
                      <label className="check-row master">
                        <input
                          type="checkbox"
                          checked={acknowledgementsAccepted}
                          onChange={(event) => setAllAcknowledgements(event.target.checked)}
                        />
                        <span>I made this, it&apos;s a fun meme coin (not an investment), and I&apos;ll launch it from my own wallet.</span>
                      </label>
                      <details className="ack-details">
                        <summary>See all launch terms</summary>
                        <div className="ack-list">
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
                      </details>
                    </div>

                    {requiresWalletLaunch ? (
                      <div className={walletAddress ? "wallet-chip ready" : "wallet-chip"}>
                        <Wallet size={14} />
                        {walletAddress
                          ? `Wallet ${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)} ready`
                          : "You'll confirm the launch in your own wallet."}
                      </div>
                    ) : null}

                    <button
                      className="btn primary launch-cta"
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

                    {busy === "launch" && launchStage ? (
                      <p className="launch-stage" aria-live="polite">
                        <span className="launch-stage-dot" />
                        {launchStage}
                      </p>
                    ) : allocationTotal !== 100 ? (
                      <p className="cta-hint">Balance the token split to 100% to launch.</p>
                    ) : !acknowledgementsAccepted ? (
                      <p className="cta-hint">Agree to the launch terms to continue.</p>
                    ) : null}

                    <button className="text-action center" onClick={resetCreator} type="button">
                      Back to snaps
                    </button>
                  </div>
                ) : busy === "generate" ? (
                  <div className="remix-loading" aria-live="polite">
                    <div className="remix-canvas">
                      {selectedImage ? <img src={selectedImage} alt="Your snap" /> : null}
                      <span className="remix-scan" />
                      <span className="remix-grid" />
                      <span className="remix-badge">
                        <WandSparkles size={15} />
                        remixing
                      </span>
                    </div>
                    <div className="remix-status">
                      <span className="remix-spinner" />
                      <div>
                        <strong>Turning your snap into a coin</strong>
                        <span key={remixStep} className="remix-message">{remixMessages[remixStep]}</span>
                      </div>
                    </div>
                    <div className="remix-bar">
                      <span />
                    </div>
                  </div>
                ) : (
                  <>
                    <input
                      ref={fileInputRef}
                      className="hidden-file"
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void generate(file);
                      }}
                    />

                    <button
                      type="button"
                      className="dropzone compact-drop"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <span className="dropzone-content">
                        <span className="drop-icon">
                          <Camera size={22} />
                        </span>
                        <strong>Snap to coin</strong>
                        <span>Take a photo or upload one — we turn it into coin art and a ready-to-edit token.</span>
                      </span>
                    </button>

                    <div className="snap-hint-row">
                      <button className="btn ghost" onClick={() => fileInputRef.current?.click()} type="button">
                        <Upload size={16} />
                        Upload a photo
                      </button>
                      <div className="snap-steps" aria-hidden="true">
                        <span><b>1</b> Snap</span>
                        <span><b>2</b> Review</span>
                        <span><b>3</b> Launch</span>
                      </div>
                    </div>

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
                          <div className="draft-row" key={item.id}>
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
              </div>
            </section>

            <section className="stack-proof" id="stack">
              <div>
                <ImageIcon size={15} />
                <span>snaps</span>
                <strong>{health?.readiness.storage ? "saved" : "local"}</strong>
              </div>
              <div>
                <WandSparkles size={15} />
                <span>remix</span>
                <strong>{health?.readiness.ai && health.readiness.imageAi ? "on" : "fallback"}</strong>
              </div>
              <div>
                <Activity size={15} />
                <span>proof</span>
                <strong>public</strong>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
