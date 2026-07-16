import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { getAdminCoin, recordDexscreener, recordLaunchEvent } from "@/lib/admin-coins";
import { applyRateLimit } from "@/lib/rate-limit";
import { rejectCrossOrigin } from "@/lib/request-guards";
import { fetchDexscreenerPair } from "@/lib/trading";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ contract: string }> }) {
  const blocked = rejectCrossOrigin(request);
  if (blocked) return blocked;

  const admin = await requireAdmin();
  if ("response" in admin) return admin.response;

  const limited = await applyRateLimit(request, {
    name: "admin:dex-sync",
    limit: 60,
    windowSeconds: 10 * 60,
    identity: admin.user.id
  });
  if (limited) return limited;

  const { contract } = await params;
  const coin = await getAdminCoin(contract);
  if (!coin) {
    return NextResponse.json({ error: "Launched coin not found." }, { status: 404 });
  }

  if (!coin.poolAddress) {
    return NextResponse.json({ error: "No pool address is recorded for this coin yet." }, { status: 409 });
  }

  try {
    const result = await fetchDexscreenerPair(coin.poolAddress);
    await recordDexscreener({
      draftId: coin.id,
      dexscreenerUrl: result.dexscreenerUrl,
      pair: result.pair
    });
    await recordLaunchEvent({
      draftId: coin.id,
      eventType: "trading.dexscreener_synced",
      payload: {
        adminUserId: admin.user.id,
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
