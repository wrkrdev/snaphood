"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, Check, ExternalLink, Rocket, Sparkles, Wallet } from "lucide-react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  encodeFunctionData,
  http,
  parseSignature,
  type Hex
} from "viem";

// Position Manager calls the client assembles: one multicall, optionally led by a signed permit.
const positionManagerMulticallAbi = [
  {
    type: "function",
    name: "multicall",
    stateMutability: "payable",
    inputs: [{ name: "data", type: "bytes[]" }],
    outputs: [{ name: "results", type: "bytes[]" }]
  },
  {
    type: "function",
    name: "selfPermitIfNecessary",
    stateMutability: "payable",
    inputs: [
      { name: "token", type: "address" },
      { name: "value", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" }
    ],
    outputs: []
  }
] as const;

const permitTypes = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" }
  ]
} as const;

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
  }
}

type TradingPlan = {
  account: string;
  chain: {
    id: number;
    name: string;
    rpcUrl: string;
    explorerUrl: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
  };
  token: string;
  positionManager: string;
  mode: "permit" | "approve";
  value: string;
  tokenAmountWei: string;
  deadline: string;
  calls: Hex[];
  permit: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: string;
    spender: string;
    nonce: string;
  } | null;
  approve: { to: string; data: Hex } | null;
  tokenAmount: string;
  ethAmount: string;
  requiredNativeEth: string;
  estimatedGasCostEth: string;
  enoughNative: boolean;
  existingPool: string;
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
    approve: "Approve your coins",
    "open trading": "Open the market",
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
  const router = useRouter();
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
      const innerCalls: Hex[] = [...plan.calls];

      if (plan.mode === "permit" && plan.permit) {
        // Sign the token approval off-chain so it can be batched into the single multicall.
        setMessage("Sign the coin approval in your wallet…");
        const signature = await walletClient.signTypedData({
          account: creatorWallet as Hex,
          domain: {
            name: plan.permit.name,
            version: plan.permit.version,
            chainId: plan.permit.chainId,
            verifyingContract: plan.permit.verifyingContract as Hex
          },
          types: permitTypes,
          primaryType: "Permit",
          message: {
            owner: creatorWallet as Hex,
            spender: plan.permit.spender as Hex,
            value: BigInt(plan.tokenAmountWei),
            nonce: BigInt(plan.permit.nonce),
            deadline: BigInt(plan.deadline)
          }
        });
        const sig = parseSignature(signature);
        const vByte = sig.v !== undefined ? Number(sig.v) : 27 + (sig.yParity ?? 0);
        const selfPermitData = encodeFunctionData({
          abi: positionManagerMulticallAbi,
          functionName: "selfPermitIfNecessary",
          args: [plan.token as Hex, BigInt(plan.tokenAmountWei), BigInt(plan.deadline), vByte, sig.r, sig.s]
        });
        innerCalls.unshift(selfPermitData);
      } else if (plan.mode === "approve" && plan.approve) {
        // Legacy token without permit: one approval tx, then the multicall.
        setMessage("Approve your coins in your wallet…");
        const approveHash = await walletClient.sendTransaction({
          account: creatorWallet as Hex,
          to: plan.approve.to as Hex,
          data: plan.approve.data
        });
        nextExecuted.push({ label: "approve", hash: approveHash });
        setExecuted([...nextExecuted]);
        const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveHash });
        nextExecuted[nextExecuted.length - 1] = { label: "approve", hash: approveHash, status: approveReceipt.status };
        setExecuted([...nextExecuted]);
        if (approveReceipt.status !== "success") throw new Error("Coin approval failed on-chain.");
      }

      setMessage("Confirm the market in your wallet…");
      const multicallData = encodeFunctionData({
        abi: positionManagerMulticallAbi,
        functionName: "multicall",
        args: [innerCalls]
      });
      const hash = await walletClient.sendTransaction({
        account: creatorWallet as Hex,
        to: plan.positionManager as Hex,
        value: BigInt(plan.value),
        data: multicallData
      });
      nextExecuted.push({ label: "open trading", hash });
      setExecuted([...nextExecuted]);
      setMessage("Opening the market…");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      nextExecuted[nextExecuted.length - 1] = { label: "open trading", hash, status: receipt.status };
      setExecuted([...nextExecuted]);
      if (receipt.status !== "success") throw new Error("Opening the market failed on-chain.");

      const response = await fetch(`/api/coins/${contractAddress}/trade/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creatorWallet, tokenAmount: plan.tokenAmount, ethAmount: plan.ethAmount, executed: nextExecuted })
      });
      const data = (await response.json()) as { result?: { poolAddress?: string; liquidityTxHash?: string }; error?: string };
      if (!response.ok || !data.result) throw new Error(data.error || "Could not record trading metadata.");
      setResult(data.result);
      setMessage("Trading is on! Your live chart usually appears within a few minutes.");
      // Reflect the new pool across the page (stats, status, chart panel) without a manual
      // reload — brief pause so the "live to trade" celebration registers first.
      window.setTimeout(() => router.refresh(), 1600);
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
          <summary>How it works</summary>
          <div className="trade-steps">
            {(plan.mode === "permit"
              ? [
                  { label: "Sign the coin approval", state: "no gas" },
                  { label: "Open the market", state: "1 transaction" }
                ]
              : [
                  { label: "Approve your coins", state: "transaction 1" },
                  { label: "Open the market", state: "transaction 2" }
                ]
            ).map((step) => (
              <div className="trade-step" key={step.label}>
                <span className="trade-step-dot" />
                <span className="trade-step-label">{step.label}</span>
                <span className="trade-step-state">{step.state}</span>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}
