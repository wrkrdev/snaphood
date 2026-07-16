"use client";

import { useState } from "react";
import { ExternalLink, LineChart, RefreshCw } from "lucide-react";

type DexSyncPanelProps = {
  contractAddress: string;
};

export function DexSyncPanel({ contractAddress }: DexSyncPanelProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [url, setUrl] = useState("");

  async function syncDex() {
    setBusy(true);
    setMessage("");
    setUrl("");
    try {
      const response = await fetch(`/api/coins/${contractAddress}/trade/sync-dex`, { method: "POST" });
      const data = (await response.json()) as {
        status?: "pending";
        result?: { dexscreenerUrl?: string; pair?: unknown };
        error?: string;
      };
      if (!response.ok || !data.result) throw new Error(data.error || "Could not check the chart yet.");
      setUrl(data.result.pair ? (data.result.dexscreenerUrl ?? "") : "");
      setMessage(
        data.result.pair
          ? "Your chart is live!"
          : "Not picked up yet — new trades can take a few minutes to show. Check again shortly."
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not check the chart yet.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="chart-status" aria-label="Chart status">
      <div className="chart-status-copy">
        <span className="chart-status-mark">
          <LineChart size={18} />
        </span>
        <div>
          <p className="eyebrow">almost there</p>
          <h2>Your chart is almost ready</h2>
          <p>Trading is set up. The chart provider just needs to catch your first trades — usually a few minutes.</p>
        </div>
      </div>
      <div className="chart-status-actions">
        <button className="btn ghost small" disabled={busy} onClick={syncDex} type="button">
          <RefreshCw size={14} />
          {busy ? "Checking" : "Check chart status"}
        </button>
        {message ? <div className={message.includes("Could not") ? "toast error" : "toast"}>{message}</div> : null}
        {url ? (
          <a className="btn primary small" href={url} target="_blank" rel="noreferrer">
            Open your chart <ExternalLink size={14} />
          </a>
        ) : null}
      </div>
    </section>
  );
}
