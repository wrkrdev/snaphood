"use client";

import { useState } from "react";
import { Activity, RefreshCw, Rocket, ShieldCheck } from "lucide-react";
import { adminExecutionConfirmation } from "@/lib/admin-execution";

type AdminTradingPanelProps = {
  contractAddress: string;
  isTradable: boolean;
  hasIndexerSwap: boolean;
};

type AdminResult = {
  execute?: boolean;
  steps?: Array<{ label: string; estimatedGas?: string | null; estimable?: boolean; reason?: string }>;
  executed?: Array<{ label: string; hash: string; status: string }>;
  poolAddress?: string | null;
  swapTxHash?: string;
  requiredNativeEth?: string;
  estimatedGasCostEth?: string;
  enoughNative?: boolean;
  dexscreenerUrl?: string;
};

type AdminResponse = {
  status?: "pending";
  result?: AdminResult;
  error?: string;
};

export function AdminTradingPanel({ contractAddress, isTradable, hasIndexerSwap }: AdminTradingPanelProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState<AdminResult | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const executionConfirmed = confirmation === adminExecutionConfirmation;

  async function callAdmin(action: "make-tradable" | "index-swap" | "sync-dex", execute = false) {
    if (execute) {
      const confirmed = window.confirm("This sends live Robinhood Chain mainnet transactions. Continue?");
      if (!confirmed) return;
    }

    setBusy(`${action}:${execute ? "execute" : "plan"}`);
    setMessage("");

    try {
      const response = await fetch(`/api/admin/coins/${contractAddress}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body:
          action === "sync-dex"
            ? "{}"
            : JSON.stringify({
                execute,
                confirmation: execute ? confirmation : undefined
              })
      });
      const data = (await response.json()) as AdminResponse;
      if (!response.ok) throw new Error(data.error || "Admin action failed.");
      setResult(data.result ?? null);
      setMessage(
        action === "sync-dex"
          ? data.status === "pending"
            ? "Dexscreener has not indexed this pool yet."
            : "Dexscreener synced."
          : execute
            ? "Transaction flow completed."
            : "Estimate ready."
      );
      if (execute) {
        setConfirmation("");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Admin action failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="admin-trading-panel" aria-label="Admin trading controls">
      <div className="admin-trading-head">
        <div>
          <p className="eyebrow">Admin desk</p>
          <h2>Trading Operations</h2>
        </div>
        <span className="status-pill">
          <ShieldCheck size={14} />
          gated
        </span>
      </div>

      <div className="admin-actions">
        <button
          className="btn ghost small"
          disabled={Boolean(busy)}
          onClick={() => void callAdmin("make-tradable")}
          type="button"
        >
          <Activity size={14} />
          Estimate LP
        </button>
        <label className="admin-confirmation">
          <span>Execution key</span>
          <input
            autoComplete="off"
            spellCheck={false}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value.trim())}
            placeholder={adminExecutionConfirmation}
          />
        </label>
        <button
          className="btn primary small"
          disabled={Boolean(busy) || !executionConfirmed}
          onClick={() => void callAdmin("make-tradable", true)}
          type="button"
        >
          <Rocket size={14} />
          {isTradable ? "Add LP" : "Make Tradable"}
        </button>
        <button
          className="btn ghost small"
          disabled={Boolean(busy)}
          onClick={() => void callAdmin("index-swap")}
          type="button"
        >
          <Activity size={14} />
          Estimate Swap
        </button>
        <button
          className="btn primary small"
          disabled={Boolean(busy) || !executionConfirmed}
          onClick={() => void callAdmin("index-swap", true)}
          type="button"
        >
          <Rocket size={14} />
          {hasIndexerSwap ? "Swap Again" : "Indexer Swap"}
        </button>
        <button
          className="btn ghost small"
          disabled={Boolean(busy)}
          onClick={() => void callAdmin("sync-dex")}
          type="button"
        >
          <RefreshCw size={14} />
          Sync Dex
        </button>
      </div>

      {message ? <div className={message.includes("failed") || message.includes("required") ? "toast error" : "toast"}>{message}</div> : null}

      {result ? (
        <div className="admin-result">
          {result.requiredNativeEth ? (
            <div>
              <span>Required ETH</span>
              <strong>{result.requiredNativeEth}</strong>
            </div>
          ) : null}
          {result.estimatedGasCostEth ? (
            <div>
              <span>Gas est.</span>
              <strong>{result.estimatedGasCostEth}</strong>
            </div>
          ) : null}
          {typeof result.enoughNative === "boolean" ? (
            <div>
              <span>Funded</span>
              <strong>{result.enoughNative ? "yes" : "no"}</strong>
            </div>
          ) : null}
          {result.poolAddress ? (
            <div>
              <span>Pool</span>
              <strong>{result.poolAddress}</strong>
            </div>
          ) : null}
          {result.steps?.length ? (
            <ul>
              {result.steps.map((step) => (
                <li key={step.label}>
                  <span>{step.label}</span>
                  <strong>{step.estimable === false ? "blocked" : step.estimatedGas ?? "pending"}</strong>
                </li>
              ))}
            </ul>
          ) : null}
          {result.executed?.length ? (
            <ul>
              {result.executed.map((step) => (
                <li key={`${step.label}-${step.hash}`}>
                  <span>{step.label}</span>
                  <strong>{step.status}</strong>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
