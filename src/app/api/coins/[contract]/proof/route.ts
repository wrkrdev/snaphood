import { NextResponse } from "next/server";
import { getLaunchProof } from "@/lib/coins";

export async function GET(_request: Request, { params }: { params: Promise<{ contract: string }> }) {
  const { contract } = await params;

  try {
    const proof = await getLaunchProof(contract);
    if (!proof) {
      return NextResponse.json({ error: "Coin not found." }, { status: 404 });
    }

    return NextResponse.json({ proof });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load launch proof." },
      { status: 500 }
    );
  }
}
