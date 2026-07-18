"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, Crown, Flame, RefreshCw, Trophy } from "lucide-react";
import type { Leaderboard, LeaderboardEntry } from "@/lib/types";

const POLL_INTERVAL_MS = 30_000;

function formatUsd(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: value >= 1000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1000 ? 1 : 2
  }).format(value);
}

function relativeTime(fromIso: string, now: number) {
  const then = new Date(fromIso).getTime();
  if (!Number.isFinite(then)) return "just now";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

const medalLabels = ["1st", "2nd", "3rd"];

export function LeaderboardBoard({ initial }: { initial: Leaderboard }) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>(initial.entries);
  const [generatedAt, setGeneratedAt] = useState(initial.generatedAt);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => new Date(initial.generatedAt).getTime());

  async function load() {
    setRefreshing(true);
    try {
      const response = await fetch("/api/coins/leaderboard", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as { leaderboard?: Leaderboard };
      if (data.leaderboard) {
        setEntries(data.leaderboard.entries);
        setGeneratedAt(data.leaderboard.generatedAt);
      }
    } catch {
      // Keep the last good ranking on a transient error — the next poll retries.
    } finally {
      setRefreshing(false);
    }
  }

  // Auto-refresh so the board stays live without a manual reload (CANON: self-updating).
  useEffect(() => {
    const interval = window.setInterval(load, POLL_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, []);

  // Tick every second so the "updated Xs ago" label stays honest.
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(tick);
  }, []);

  const podium = useMemo(() => entries.slice(0, 3), [entries]);
  const updatedLabel = relativeTime(generatedAt, now);

  return (
    <>
      <section className="leaderboard-head">
        <div>
          <p className="eyebrow">
            <Trophy size={13} />
            Live leaderboard
          </p>
          <h1>Top SnapHood coins</h1>
          <p className="leaderboard-sub">Ranked by market cap + 24h volume · updates on its own</p>
        </div>
        <div className={refreshing ? "leaderboard-live refreshing" : "leaderboard-live"} aria-live="polite">
          <span className="leaderboard-live-dot" />
          <span>Live · updated {updatedLabel}</span>
          <button className="icon-action" onClick={() => void load()} type="button" aria-label="Refresh leaderboard">
            <RefreshCw size={14} />
          </button>
        </div>
      </section>

      {entries.length === 0 ? (
        <div className="empty-launchpad">
          <Trophy size={22} />
          <span>No coins are trading yet — a coin joins the ranking once it has a live market.</span>
        </div>
      ) : (
        <>
          {podium.length > 0 ? (
            <section className="leaderboard-podium" aria-label="Top three coins">
              {podium.map((entry) => (
                <a
                  className={`podium-card rank-${entry.rank}`}
                  href={`/coin/${entry.coin.contractAddress}`}
                  key={entry.coin.id}
                >
                  <span className="podium-rank">
                    {entry.rank === 1 ? <Crown size={16} /> : null}
                    {medalLabels[entry.rank - 1]}
                  </span>
                  <img className="podium-avatar" src={entry.coin.profileImageUrl} alt="" />
                  <div className="podium-copy">
                    <strong>{entry.coin.name}</strong>
                    <span>${entry.coin.ticker}</span>
                  </div>
                  <div className="podium-stats">
                    <div>
                      <span>Market cap</span>
                      <strong>{formatUsd(entry.marketCapUsd)}</strong>
                    </div>
                    <div>
                      <span>24h vol</span>
                      <strong>{formatUsd(entry.volume24hUsd)}</strong>
                    </div>
                  </div>
                </a>
              ))}
            </section>
          ) : null}

          <section className="leaderboard-table" aria-label="Coin ranking">
            <div className="leaderboard-row leaderboard-row-head" aria-hidden="true">
              <span>#</span>
              <span>Coin</span>
              <span className="num">Market cap</span>
              <span className="num">24h vol</span>
              <span className="num">Score</span>
              <span className="num">Chart</span>
            </div>
            {entries.map((entry) => (
              <a className="leaderboard-row" href={`/coin/${entry.coin.contractAddress}`} key={entry.coin.id}>
                <span className={entry.rank <= 3 ? "rank-cell top" : "rank-cell"}>{entry.rank}</span>
                <span className="coin-cell">
                  <img src={entry.coin.profileImageUrl} alt="" />
                  <span className="coin-cell-copy">
                    <strong>{entry.coin.name}</strong>
                    <span>${entry.coin.ticker}</span>
                  </span>
                </span>
                <span className="num">{formatUsd(entry.marketCapUsd)}</span>
                <span className="num">{formatUsd(entry.volume24hUsd)}</span>
                <span className="num score-cell">{formatUsd(entry.score)}</span>
                <span className="num chart-cell">
                  {entry.coin.dexscreenerPair ? (
                    <span className="chart-flag live">
                      <Activity size={13} />
                      live
                    </span>
                  ) : (
                    <span className="chart-flag">
                      <Flame size={13} />
                      soon
                    </span>
                  )}
                </span>
              </a>
            ))}
          </section>
        </>
      )}
    </>
  );
}

export default LeaderboardBoard;
