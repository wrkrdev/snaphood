import { NextResponse } from "next/server";
import { getLaunchedCoin } from "@/lib/coins";
import { applyRateLimit } from "@/lib/rate-limit";

const publicCoinCacheHeaders = {
  "Cache-Control": "public, max-age=15, stale-while-revalidate=45"
};

export async function GET(request: Request, { params }: { params: Promise<{ contract: string }> }) {
  const limited = await applyRateLimit(request, {
    name: "coins:detail:ip",
    limit: 180,
    windowSeconds: 60
  });
  if (limited) return limited;

  const { contract } = await params;

  try {
    const coin = await getLaunchedCoin(contract);
    if (!coin) {
      return NextResponse.json({ error: "Coin not found." }, { status: 404 });
    }

    return NextResponse.json(
      { coin },
      {
        headers: publicCoinCacheHeaders
      }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load coin." },
      { status: 500 }
    );
  }
}
