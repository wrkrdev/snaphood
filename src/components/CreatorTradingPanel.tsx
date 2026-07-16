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
  const isError = message.includes("Could not") || message.includes("blocked") || message.includes("needs");

  return (
    <section className="creator-trading-panel guided" aria-label="Make this coin tradable">
      <div className="guided-head">
        <p className="eyebrow">unlock trading</p>
        <h2>Make ${ticker} tradable</h2>
        <p className="guided-lede">
          Add a little starting liquidity so anyone can buy and sell ${ticker}. This also turns on the live price chart.
          You approve everything in your own wallet.
        </p>
      </div>

      {done ? (
        <div className="trade-done">
          <span className="trade-done-mark">
            <Sparkles size={18} />
          </span>
          <div className="trade-done-copy">
            <strong>${ticker} is tradable</strong>
            <span>People can trade it now. Your live chart usually appears within a few minutes.</span>
          </div>
          {result?.poolAddress ? (
            <a
              className="btn ghost small"
              href={`${explorerUrl.replace(/\/address\/.*$/, "")}/address/${result.poolAddress}`}
              target="_blank"
              rel="noreferrer"
            >
              View liquidity <ExternalLink size={13} />
            </a>
          ) : null}
        </div>
      ) : (
        <ol className="guided-steps">
          <li className={connected ? "guided-step done" : "guided-step active"}>
            <span className="step-index">{connected ? <Check size={14} /> : 1}</span>
            <div className="step-body">
              <strong>Connect your wallet</strong>
              <span>Use the same wallet that launched ${ticker}.</span>
              <button className="btn ghost small" disabled={Boolean(busy)} onClick={connectWallet} type="button">
                <Wallet size={14} />
                {connected ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}` : busy === "wallet" ? "Connecting" : "Connect wallet"}
              </button>
            </div>
          </li>

          <li className={connected ? "guided-step active" : "guided-step"}>
            <span className="step-index">2</span>
            <div className="step-body">
              <strong>Choose the starting liquidity</strong>
              <span>A small amount is plenty to open trading.</span>
              <div className="trade-input-grid">
                <label className="label">
                  Coins for the pool
                  <input
                    className="field"
                    inputMode="decimal"
                    value={tokenAmount}
                    onChange={(event) => setTokenAmount(event.target.value)}
                  />
                </label>
                <label className="label">
                  ETH to pair
                  <input
                    className="field"
                    inputMode="decimal"
                    value={ethAmount}
                    onChange={(event) => setEthAmount(event.target.value)}
                  />
                </label>
              </div>
              {planReady && !funded ? (
                <p className="cta-hint">
                  This wallet needs about {plan?.requiredNativeEth} ETH (the pair amount plus a small network fee). Top it
                  up, then try again.
                </p>
              ) : null}
            </div>
          </li>

          <li className={planReady && funded ? "guided-step active" : "guided-step"}>
            <span className="step-index">3</span>
            <div className="step-body">
              <strong>Confirm in your wallet</strong>
              <span>Your wallet will ask you to approve and sign — that&apos;s the last step.</span>
              {!planReady ? (
                <button className="btn primary small" disabled={Boolean(busy) || !connected} onClick={prepare} type="button">
                  <Activity size={14} />
                  {busy === "prepare" ? "Checking" : "Review setup"}
                </button>
              ) : (
                <button className="btn primary small" disabled={Boolean(busy) || !funded} onClick={execute} type="button">
                  <Rocket size={14} />
                  {busy === "execute" ? "Confirm in wallet" : "Make it tradable"}
                </button>
              )}
            </div>
          </li>
        </ol>
      )}

      {message ? <div className={isError ? "toast error" : "toast"}>{message}</div> : null}

      {plan ? (
        <details className="trade-details">
          <summary>What this costs &amp; the steps</summary>
          <div className="admin-result">
            <div>
              <span>ETH needed</span>
              <strong>{plan.requiredNativeEth}</strong>
            </div>
            <div>
              <span>Network fee (est.)</span>
              <strong>{plan.estimatedGasCostEth}</strong>
            </div>
            <div>
              <span>Wallet funded</span>
              <strong>{funded ? "yes" : "not yet"}</strong>
            </div>
            <ul>
              {plan.steps.map((step) => (
                <li key={`${step.label}-${step.to}`}>
                  <span>{friendlyStepLabel(step.label)}</span>
                  <strong>{step.estimable ? "ready" : step.label === "mint liquidity position" ? "after approvals" : "needs a step first"}</strong>
                </li>
              ))}
            </ul>
          </div>
        </details>
      ) : null}

      {executed.length ? (
        <details className="trade-details" open>
          <summary>Your wallet transactions</summary>
          <div className="admin-result">
            <ul>
              {executed.map((step) => (
                <li key={step.hash}>
                  <span>{friendlyStepLabel(step.label)}</span>
                  <strong>
                    <a href={`${explorerUrl.replace(/\/address\/.*$/, "")}/tx/${step.hash}`} target="_blank" rel="noreferrer">
                      {step.status ?? "sent"} <ExternalLink size={12} />
                    </a>
                  </strong>
                </li>
              ))}
            </ul>
          </div>
        </details>
      ) : null}
    </section>
  );
}
