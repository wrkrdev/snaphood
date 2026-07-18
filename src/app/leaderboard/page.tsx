import type { Metadata } from "next";
import { Home } from "lucide-react";
import { getLeaderboard } from "@/lib/coins";
import { LeaderboardBoard } from "@/components/LeaderboardBoard";
import { ThemeToggle } from "@/components/ThemeToggle";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Leaderboard",
  description: "Live ranking of SnapHood coins by market cap and 24h volume.",
  alternates: {
    canonical: "/leaderboard"
  }
};

export default async function LeaderboardPage() {
  const leaderboard = await getLeaderboard({ limit: 100 });

  return (
    <main className="leaderboard-page">
      <div className="page-toolbar">
        <a className="page-toolbar-brand" href="/">
          <span className="brand-mark">S</span>
          <span>SnapHood</span>
        </a>
        <div className="page-toolbar-actions">
          <a className="btn ghost small" href="/">
            <Home size={14} />
            Home
          </a>
          <ThemeToggle className="small" />
        </div>
      </div>

      <LeaderboardBoard initial={leaderboard} />
    </main>
  );
}
