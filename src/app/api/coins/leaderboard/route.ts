import { NextResponse } from "next/server";
import { getLeaderboard } from "@/lib/coins";
import { applyRateLimit } from "@/lib/rate-limit";

export async function GET(request: Request) {
  const limited = await applyRateLimit(request, {
    name: "coins:leaderboard:ip",
    limit: 120,
    windowSeconds: 60
  });
  if (limited) return limited;

  try {
    const { searchParams } = new URL(request.url);
    const chainId = parseOptionalInteger(searchParams.get("chainId"));
    const limit = parseBoundedInteger(searchParams.get("limit"), 50, 1, 100);
    const leaderboard = await getLeaderboard({ chainId, limit });
    return NextResponse.json(
      { leaderboard },
      {
        headers: {
          "Cache-Control": "public, max-age=15, stale-while-revalidate=45"
        }
      }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load the leaderboard." },
      { status: 500 }
    );
  }
}

function parseOptionalInteger(value: string | null) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function parseBoundedInteger(value: string | null, fallback: number, min: number, max: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}
