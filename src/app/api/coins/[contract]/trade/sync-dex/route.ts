import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getLaunchedCoin } from "@/lib/coins";
import { recordDexscreener, recordLaunchEvent } from "@/lib/admin-coins";
import { applyRateLimit } from "@/lib/rate-limit";
import { rejectCrossOrigin } from "@/lib/request-guards";
import { fetchDexscreenerPair } from "@/lib/trading";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ contract: string }> }) {
  const blocked = rejectCrossOrigin(request);
  if (blocked) return blocked;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in before syncing Dexscreener." }, { status: 401 });
  }

  const limited = await applyRateLimit(request, {
    name: "trade:dex-sync:user",
    limit: 20,
    windowSeconds: 10 * 60,
    identity: user.id
  });
  if (limited) return limited;

  const { contract } = await params;
  const coin = await getLaunchedCoin(contract);
  if (!coin) {
    return NextResponse.json({ error: "Launched coin not found." }, { status: 404 });
  }

  if (!coin.poolAddress) {
    return NextResponse.json({ error: "No pool address is recorded for this coin yet." }, { status: 409 });
  }

  try {
    const result = await fetchDexscreenerPair(coin.poolAddress);
    if (!result.pair) {
      return NextResponse.json({ status: "pending", result }, { status: 202 });
    }

    await recordDexscreener({
      draftId: coin.id,
      dexscreenerUrl: result.dexscreenerUrl,
      pair: result.pair
    });
    await recordLaunchEvent({
      draftId: coin.id,
      eventType: "trading.dexscreener_synced",
      payload: {
        userId: user.id,
        execution: "user-sync",
        contractAddress: coin.contractAddress,
        poolAddress: coin.poolAddress,
        dexscreenerUrl: result.dexscreenerUrl,
        hasPair: Boolean(result.pair)
      }
    });

    return NextResponse.json({ result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not sync Dexscreener." },
      { status: 500 }
    );
  }
}
