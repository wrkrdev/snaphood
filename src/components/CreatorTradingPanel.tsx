"use client";

import { useState } from "react";
import { Activity, ExternalLink, RefreshCw, Wallet } from "lucide-react";
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
      setMessage("Trading plan ready. Review the steps before sending wallet transactions.");
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
      setMessage("Trading pool recorded. Dexscreener may need a little time to index it.");
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

  return (
    <section className="creator-trading-panel">
      <div className="admin-trading-head">
        <div>
          <p className="eyebrow">creator action</p>
          <h2>Make ${ticker} tradable</h2>
        </div>
        <span className="status-pill">
          <Wallet size={14} />
          wallet
        </span>
      </div>

      <div className="trade-input-grid">
        <label className="label">
          Token liquidity
          <input className="field" value={tokenAmount} onChange={(event) => setTokenAmount(event.target.value)} />
        </label>
        <label className="label">
          ETH side
          <input className="field" value={ethAmount} onChange={(event) => setEthAmount(event.target.value)} />
        </label>
      </div>

      <div className="admin-actions">
        <button className="btn ghost small" disabled={Boolean(busy)} onClick={connectWallet} type="button">
          <Wallet size={14} />
          {walletAddress ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : "Connect wallet"}
        </button>
        <button className="btn ghost small" disabled={Boolean(busy)} onClick={prepare} type="button">
          <Activity size={14} />
          Estimate
        </button>
        <button className="btn primary small" disabled={Boolean(busy) || !plan || !plan.enoughNative} onClick={execute} type="button">
          <RefreshCw size={14} />
          {busy === "execute" ? "Sending" : "Send transactions"}
        </button>
      </div>

      {message ? <div className={message.includes("Could not") || message.includes("blocked") ? "toast error" : "toast"}>{message}</div> : null}

      {plan ? (
        <div className="admin-result">
          <div>
            <span>Required ETH</span>
            <strong>{plan.requiredNativeEth}</strong>
          </div>
          <div>
            <span>Gas est.</span>
            <strong>{plan.estimatedGasCostEth}</strong>
          </div>
          <div>
            <span>Funded</span>
            <strong>{plan.enoughNative ? "yes" : "no"}</strong>
          </div>
          <ul>
            {plan.steps.map((step) => (
              <li key={`${step.label}-${step.to}`}>
                <span>{step.label}</span>
                <strong>{step.estimable ? step.estimatedGas ?? "ready" : step.label === "mint liquidity position" ? "after approvals" : "blocked"}</strong>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {executed.length ? (
        <div className="admin-result">
          <ul>
            {executed.map((step) => (
              <li key={step.hash}>
                <span>{step.label}</span>
                <strong>
                  <a href={`${explorerUrl.replace(/\/address\/.*$/, "")}/tx/${step.hash}`} target="_blank" rel="noreferrer">
                    {step.status ?? "sent"} <ExternalLink size={12} />
                  </a>
                </strong>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {result?.poolAddress ? (
        <div className="toast">
          <strong>Pool recorded</strong>
          <a href={`${explorerUrl.replace(/\/address\/.*$/, "")}/address/${result.poolAddress}`} target="_blank" rel="noreferrer">
            Open pool <ExternalLink size={13} />
          </a>
        </div>
      ) : null}
    </section>
  );
}
