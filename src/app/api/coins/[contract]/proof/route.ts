import { NextResponse } from "next/server";
import { getLaunchProof } from "@/lib/coins";
import { applyRateLimit } from "@/lib/rate-limit";

const publicProofCacheHeaders = {
  "Cache-Control": "public, max-age=15, stale-while-revalidate=45"
};

export async function GET(request: Request, { params }: { params: Promise<{ contract: string }> }) {
  const limited = await applyRateLimit(request, {
    name: "coins:proof:ip",
    limit: 120,
    windowSeconds: 60
  });
  if (limited) return limited;

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
