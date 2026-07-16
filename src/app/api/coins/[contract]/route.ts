import { NextResponse } from "next/server";
import { getLaunchedCoin } from "@/lib/coins";

const publicCoinCacheHeaders = {
  "Cache-Control": "public, max-age=15, stale-while-revalidate=45"
};

export async function GET(_request: Request, { params }: { params: Promise<{ contract: string }> }) {
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
