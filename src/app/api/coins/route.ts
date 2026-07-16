import { NextResponse } from "next/server";
import { listLaunchedCoins } from "@/lib/coins";

export async function GET() {
  try {
    const coins = await listLaunchedCoins();
    return NextResponse.json({ coins });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load launched coins.", coins: [] },
      { status: 500 }
    );
  }
}
