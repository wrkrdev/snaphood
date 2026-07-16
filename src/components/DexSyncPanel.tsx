"use client";

import { useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";

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
      const data = (await response.json()) as { result?: { dexscreenerUrl?: string; pair?: unknown }; error?: string };
      if (!response.ok || !data.result) throw new Error(data.error || "Could not sync Dexscreener.");
      setUrl(data.result.dexscreenerUrl ?? "");
      setMessage(data.result.pair ? "Dexscreener pair synced." : "Dexscreener URL recorded; pair data may still be indexing.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not sync Dexscreener.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="trade-status">
      <div>
        <p className="eyebrow">chart pending</p>
        <h2>Sync Dexscreener</h2>
      </div>
      <div className="sync-dex-body">
        <p>Use this after the pool and a swap exist. Indexers can take a few minutes to return pair data.</p>
        <button className="btn ghost small" disabled={busy} onClick={syncDex} type="button">
          <RefreshCw size={14} />
          {busy ? "Syncing" : "Sync chart"}
        </button>
        {message ? <div className={message.includes("Could not") ? "toast error" : "toast"}>{message}</div> : null}
        {url ? (
          <a className="btn primary small" href={url} target="_blank" rel="noreferrer">
            Open Dexscreener <ExternalLink size={14} />
          </a>
        ) : null}
      </div>
    </section>
  );
}
