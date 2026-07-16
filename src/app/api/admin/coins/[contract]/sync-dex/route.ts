import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import { getAdminCoin, recordDexscreener } from "@/lib/admin-coins";
import { fetchDexscreenerPair } from "@/lib/trading";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ contract: string }> }) {
  const admin = await requireAdmin();
  if ("response" in admin) return admin.response;

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

    return NextResponse.json({ result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not sync Dexscreener." },
      { status: 500 }
    );
  }
}
