"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, LineChart } from "lucide-react";

type DexSyncPanelProps = {
  contractAddress: string;
};

const MAX_ATTEMPTS = 12;

export function DexSyncPanel({ contractAddress }: DexSyncPanelProps) {
  const router = useRouter();
  const [checking, setChecking] = useState(true);
  const [note, setNote] = useState("Looking for your chart…");
  const [url, setUrl] = useState("");
  const timerRef = useRef<number | null>(null);
  const attemptRef = useRef(0);

  // One poll cycle: first see whether the chart was already recorded (by an earlier sync or
  // the background cron), then actively try to record it. As soon as it exists, refresh the
  // whole page so the chart, price and stats update in place — no manual reload.
  const pollOnce = useCallback(async () => {
    try {
      const read = await fetch(`/api/coins/${contractAddress}`, { cache: "no-store" });
      const readData = (await read.json()) as { coin?: { dexscreenerUrl?: string; dexscreenerPair?: unknown } };
      // Only treat the chart as live when Dexscreener has actually returned pair data.
      if (readData.coin?.dexscreenerPair) {
        setUrl(readData.coin.dexscreenerUrl ?? "");
        return true;
      }
    } catch {
      /* ignore and try an active sync */
    }

    try {
      const synced = await fetch(`/api/coins/${contractAddress}/trade/sync-dex`, { method: "POST" });
      const syncedData = (await synced.json()) as { result?: { dexscreenerUrl?: string; pair?: unknown } };
      if (synced.ok && syncedData.result?.pair) {
        setUrl(syncedData.result.dexscreenerUrl ?? "");
        return true;
      }
    } catch {
      /* keep waiting */
    }

    return false;
  }, [contractAddress]);

  const runPoller = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    attemptRef.current = 0;
    setChecking(true);
    setNote("Looking for your chart…");

    const tick = async () => {
      attemptRef.current += 1;
      const found = await pollOnce();
      if (found) {
        setChecking(false);
        setNote("Your chart is live!");
        router.refresh();
        return;
      }
      if (attemptRef.current >= MAX_ATTEMPTS) {
        setChecking(false);
        setNote("Still indexing — new pools can take a few minutes to appear.");
        return;
      }
      setNote("New trades can take a few minutes to show — checking automatically…");
      const delay = Math.min(10000 + attemptRef.current * 3000, 30000);
      timerRef.current = window.setTimeout(() => void tick(), delay);
    };

    timerRef.current = window.setTimeout(() => void tick(), 4000);
  }, [pollOnce, router]);

  useEffect(() => {
    runPoller();
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [runPoller]);

  return (
    <section className="chart-status" aria-label="Chart status" aria-live="polite">
      <div className="chart-status-copy">
        <span className={checking ? "chart-status-mark spinning" : "chart-status-mark"}>
          <LineChart size={18} />
        </span>
        <div>
          <p className="eyebrow">almost there</p>
          <h2>Your chart is almost ready</h2>
          <p>Trading is set up. We&apos;re watching for the first trades to appear on the chart — this updates on its own.</p>
        </div>
      </div>
      <div className="chart-status-actions">
        <span className={checking ? "chart-live-note checking" : "chart-live-note"}>
          {checking ? <span className="chart-dot" /> : null}
          {note}
        </span>
        {url ? (
          <a className="btn primary small" href={url} target="_blank" rel="noreferrer">
            Open your chart <ExternalLink size={14} />
          </a>
        ) : !checking ? (
          <button className="btn ghost small" onClick={runPoller} type="button">
            Check again
          </button>
        ) : null}
      </div>
    </section>
  );
}
