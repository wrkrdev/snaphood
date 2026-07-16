import { NextResponse } from "next/server";
import { getLaunchedCoin } from "@/lib/coins";

export async function GET(_request: Request, { params }: { params: Promise<{ contract: string }> }) {
  const { contract } = await params;

  try {
    const coin = await getLaunchedCoin(contract);
    if (!coin) {
      return NextResponse.json({ error: "Coin not found." }, { status: 404 });
    }

    return NextResponse.json({ coin });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load coin." },
      { status: 500 }
    );
  }
}
