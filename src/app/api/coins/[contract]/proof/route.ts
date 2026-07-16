import { NextResponse } from "next/server";
import { getLaunchProof } from "@/lib/coins";

const publicProofCacheHeaders = {
  "Cache-Control": "public, max-age=15, stale-while-revalidate=45"
};

export async function GET(_request: Request, { params }: { params: Promise<{ contract: string }> }) {
  const { contract } = await params;

  try {
    const proof = await getLaunchProof(contract);
    if (!proof) {
      return NextResponse.json({ error: "Coin not found." }, { status: 404 });
    }

    return NextResponse.json(
      { proof },
      {
        headers: publicProofCacheHeaders
      }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load launch proof." },
      { status: 500 }
    );
  }
}
