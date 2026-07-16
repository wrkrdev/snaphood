"use client";

import { useState } from "react";
import { Activity, Check, ExternalLink, Rocket, Sparkles, Wallet } from "lucide-react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  http,
  type Hex
} from "viem";

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
  }
}

type TradingStep = {
  label: string;
  to: string;
  value: string;
  data: Hex;
  estimatedGas?: string | null;
  estimable: boolean;
  reason?: string;
};

type TradingPlan = {
  account: string;
  chain: {
    id: number;
    name: string;
    rpcUrl: string;
    explorerUrl: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
  };
  tokenAmount: string;
  ethAmount: string;
  requiredNativeEth: string;
  estimatedGasCostEth: string;
  enoughNative: boolean;
  existingPool: string;
  steps: TradingStep[];
};

type CreatorTradingPanelProps = {
  contractAddress: string;
  ticker: string;
  chainId: number;
  explorerUrl: string;
};

// Turn the low-level on-chain step names into plain-language actions.
function friendlyStepLabel(label: string) {
  const map: Record<string, string> = {
    "wrap ETH to WETH": "Prepare ETH",
    "approve WETH": "Approve ETH for the pool",
    "create and initialize pool": "Create the market",
    "mint liquidity position": "Add the liquidity"
  };
  if (map[label]) return map[label];
  if (label.startsWith("approve")) return "Approve your coins";
  return label;
}

// Render a wei-derived ETH string as a short, human number instead of an 18-decimal tail.
function formatEth(value?: string | null) {
  if (value === undefined || value === null || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  if (n === 0) return "0 ETH";
  if (n > 0 && n < 0.00001) return "<0.00001 ETH";
  return `${Number(n.toFixed(5))} ETH`;
}

const liquidityPresets = [
  { key: "starter", label: "Starter", token: "1000000", eth: "0.0001" },
  { key: "bigger", label: "Bigger", token: "10000000", eth: "0.001" }
];

export function CreatorTradingPanel({ contractAddress, ticker, chainId, explorerUrl }: CreatorTradingPanelProps) {
  const [walletAddress, setWalletAddress] = useState("");
  const [tokenAmount, setTokenAmount] = useState("1000000");
  const [ethAmount, setEthAmount] = useState("0.0001");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [plan, setPlan] = useState<TradingPlan | null>(null);
  const [executed, setExecuted] = useState<Array<{ label: string; hash: string; status?: string }>>([]);
  const [result, setResult] = useState<{ poolAddress?: string; liquidityTxHash?: string } | null>(null);

  async function connectWallet() {
    setMessage("");
    if (!window.ethereum) {
      setMessage("Install an EVM wallet, then reload SnapHood.");
      return "";
    }

    try {
      setBusy("wallet");
      const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
      const selected = accounts[0] ?? "";
      if (!selected) throw new Error("No wallet account selected.");
      setWalletAddress(selected);
      return selected;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not connect wallet.");
      return "";
    } finally {
      setBusy(null);
    }
  }

  async function prepare() {
    const creatorWallet = walletAddress || (await connectWallet());
    if (!creatorWallet) return;

    setBusy("prepare");
    setMessage("");
    setExecuted([]);
    setResult(null);
    try {
      const response = await fetch(`/api/coins/${contractAddress}/trade/prepare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creatorWallet, tokenAmount, ethAmount })
      });
      const data = (await response.json()) as { plan?: TradingPlan; error?: string };
      if (!response.ok || !data.plan) throw new Error(data.error || "Could not prepare trading plan.");
      setPlan(data.plan);
      setMessage("Ready. Check the quick summary, then confirm in your wallet.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not prepare trading plan.");
    } finally {
      setBusy(null);
    }
  }

  async function execute() {
    if (!plan) return;
    const creatorWallet = walletAddress || (await connectWallet());
    if (!creatorWallet || !window.ethereum) return;

    setBusy("execute");
    setMessage("");
    setExecuted([]);
    setResult(null);
    try {
      await switchWalletChain(plan.chain);
      const chain = defineChain({
        id: plan.chain.id,
        name: plan.chain.name,
        nativeCurrency: plan.chain.nativeCurrency,
        rpcUrls: { default: { http: [plan.chain.rpcUrl] } },
        blockExplorers: { default: { name: "Robinhood Blockscout", url: plan.chain.explorerUrl } }
      });
      const walletClient = createWalletClient({ chain, transport: custom(window.ethereum) });
      const publicClient = createPublicClient({ chain, transport: http(plan.chain.rpcUrl) });
      const nextExecuted: Array<{ label: string; hash: string; status?: string }> = [];

      for (const step of plan.steps) {
        if (!step.estimable && step.label !== "mint liquidity position") {
          throw new Error(`${step.label} is blocked: ${step.reason ?? "estimate failed"}`);
        }
        setMessage(`Waiting for wallet: ${step.label}`);
        const hash = await walletClient.sendTransaction({
          account: creatorWallet as Hex,
          to: step.to as Hex,
          value: BigInt(step.value),
          data: step.data
        });
        nextExecuted.push({ label: step.label, hash });
        setExecuted([...nextExecuted]);
        setMessage(`Confirming: ${step.label}`);
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        nextExecuted[nextExecuted.length - 1] = { label: step.label, hash, status: receipt.status };
        setExecuted([...nextExecuted]);
        if (receipt.status !== "success") throw new Error(`${step.label} failed on-chain.`);
      }

      const response = await fetch(`/api/coins/${contractAddress}/trade/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creatorWallet, tokenAmount: plan.tokenAmount, ethAmount: plan.ethAmount, executed: nextExecuted })
      });
      const data = (await response.json()) as { result?: { poolAddress?: string; liquidityTxHash?: string }; error?: string };
      if (!response.ok || !data.result) throw new Error(data.error || "Could not record trading metadata.");
      setResult(data.result);
      setMessage("Trading is on! Your live chart usually appears within a few minutes.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not complete trading setup.");
    } finally {
      setBusy(null);
    }
  }

  async function switchWalletChain(chain: TradingPlan["chain"]) {
    if (!window.ethereum) throw new Error("Browser wallet is not available.");
    const chainHex = `0x${chain.id.toString(16)}`;
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainHex }] });
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? Number(error.code) : undefined;
      if (code !== 4902) throw error;
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: chainHex,
            chainName: chain.name,
            nativeCurrency: chain.nativeCurrency,
            rpcUrls: [chain.rpcUrl],
            blockExplorerUrls: [chain.explorerUrl]
          }
        ]
      });
    }
  }

  const connected = Boolean(walletAddress);
  const planReady = Boolean(plan);
  const funded = plan?.enoughNative ?? false;
  const done = Boolean(result?.poolAddress);
  const executing = busy === "execute";
  const isError = message.includes("Could not") || message.includes("blocked") || message.includes("failed");
  const shortWallet = walletAddress ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}` : "";
  const beat = done ? 3 : connected ? (planReady ? 2 : 1) : 0;
  const txBase = explorerUrl.replace(/\/address\/.*$/, "");

  function pickAmounts(token: string, eth: string) {
    setTokenAmount(token);
    setEthAmount(eth);
    setPlan(null);
  }

  return (
    <section className="trade-card" id="trade-card" aria-label="Open trading">
      <div className="trade-card-head">
        <span className="trade-card-emoji">
          <Rocket size={20} />
        </span>
        <div>
          <p className="eyebrow">unlock trading</p>
          <h2>Give ${ticker} its first market</h2>
        </div>
      </div>

      {done ? (
        <div className="trade-live">
          <span className="trade-live-burst">
            <Sparkles size={24} />
          </span>
          <h3>${ticker} is live to trade 🎉</h3>
          <p>Anyone can buy and sell it now. Your price chart usually shows up within a few minutes.</p>
          {result?.poolAddress ? (
            <a className="btn ghost" href={`${txBase}/address/${result.poolAddress}`} target="_blank" rel="noreferrer">
              View liquidity <ExternalLink size={14} />
            </a>
          ) : null}
        </div>
      ) : (
        <>
          <p className="trade-lede">
            Pair a little ${ticker}{" "}
            with ETH to open a market — that&apos;s what unlocks buying, selling, and the live chart. You sign it in your
            own wallet.
          </p>

          <div className="trade-beats" aria-hidden="true">
            {["Fund", "Sign", "Live"].map((label, index) => (
              <div key={label} className={index < beat ? "beat done" : index === beat ? "beat active" : "beat"}>
                <span className="beat-dot">{index < beat ? <Check size={12} /> : index + 1}</span>
                {label}
              </div>
            ))}
          </div>

          <div className="trade-amounts">
            <div className="trade-amounts-head">
              <span>Starting liquidity</span>
              <div className="preset-chips">
                {liquidityPresets.map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    className={tokenAmount === preset.token && ethAmount === preset.eth ? "preset active" : "preset"}
                    onClick={() => pickAmounts(preset.token, preset.eth)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="trade-input-grid">
              <label className="label">
                Coins in the pool
                <input
                  className="field"
                  inputMode="decimal"
                  value={tokenAmount}
                  onChange={(event) => {
                    setTokenAmount(event.target.value);
                    setPlan(null);
                  }}
                />
              </label>
              <label className="label">
                ETH to pair
                <input
                  className="field"
                  inputMode="decimal"
                  value={ethAmount}
                  onChange={(event) => {
                    setEthAmount(event.target.value);
                    setPlan(null);
                  }}
                />
              </label>
            </div>
          </div>

          {plan ? (
            <div className="trade-summary">
              <div className="trade-summary-row">
                <span>Network fee</span>
                <strong>≈ {formatEth(plan.estimatedGasCostEth)}</strong>
              </div>
              <div className={funded ? "trade-summary-row ok" : "trade-summary-row warn"}>
                <span>{funded ? "Wallet balance" : "Add a little ETH"}</span>
                <strong>{funded ? "Enough ✓" : `≈ ${formatEth(plan.requiredNativeEth)} needed`}</strong>
              </div>
            </div>
          ) : null}

          {connected ? (
            <div className="trade-wallet-chip">
              <Wallet size={13} />
              {shortWallet}
              <button className="text-action" onClick={connectWallet} type="button">
                switch
              </button>
            </div>
          ) : null}

          {!connected ? (
            <button className="btn primary trade-cta" disabled={Boolean(busy)} onClick={connectWallet} type="button">
              <Wallet size={17} />
              {busy === "wallet" ? "Connecting…" : "Connect wallet"}
            </button>
          ) : !planReady ? (
            <button className="btn primary trade-cta" disabled={Boolean(busy)} onClick={prepare} type="button">
              <Activity size={17} />
              {busy === "prepare" ? "Checking…" : "Review liquidity"}
            </button>
          ) : (
            <button className="btn primary trade-cta" disabled={Boolean(busy) || !funded} onClick={execute} type="button">
              <Rocket size={17} />
              {executing ? "Confirm in your wallet…" : funded ? "Go live 🚀" : "Add ETH to continue"}
            </button>
          )}
        </>
      )}

      {message && !done ? <div className={isError ? "toast error" : "toast"}>{message}</div> : null}

      {executed.length ? (
        <details className="trade-details" open>
          <summary>Your wallet transactions</summary>
          <div className="trade-steps">
            {executed.map((step) => (
              <div className="trade-step" key={step.hash}>
                <span className="trade-step-dot done" />
                <span className="trade-step-label">{friendlyStepLabel(step.label)}</span>
                <a className="trade-step-state" href={`${txBase}/tx/${step.hash}`} target="_blank" rel="noreferrer">
                  {step.status ?? "sent"} <ExternalLink size={12} />
                </a>
              </div>
            ))}
          </div>
        </details>
      ) : plan ? (
        <details className="trade-details">
          <summary>See the steps &amp; fee</summary>
          <div className="trade-steps">
            {plan.steps.map((step) => (
              <div className="trade-step" key={`${step.label}-${step.to}`}>
                <span className="trade-step-dot" />
                <span className="trade-step-label">{friendlyStepLabel(step.label)}</span>
                <span className="trade-step-state">
                  {step.estimable ? "ready" : step.label === "mint liquidity position" ? "after approvals" : "queued"}
                </span>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}
