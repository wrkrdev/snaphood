import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin";
import { getAdminCoin, recordIndexerSwap } from "@/lib/admin-coins";
import { applyRateLimit } from "@/lib/rate-limit";
import { planOrRunIndexerSwap } from "@/lib/trading";

export const runtime = "nodejs";

const schema = z.object({
  execute: z.boolean().optional().default(false),
  ethAmount: z.string().min(1).optional()
});

export async function POST(request: Request, { params }: { params: Promise<{ contract: string }> }) {
  const admin = await requireAdmin();
  if ("response" in admin) return admin.response;

  const { contract } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid swap request." }, { status: 400 });
  }

  const limited = await applyRateLimit(request, {
    name: parsed.data.execute ? "admin:index-swap:execute" : "admin:index-swap:plan",
    limit: parsed.data.execute ? 4 : 40,
    windowSeconds: parsed.data.execute ? 60 * 60 : 10 * 60,
    identity: admin.user.id
  });
  if (limited) return limited;

  const coin = await getAdminCoin(contract);
  if (!coin) {
    return NextResponse.json({ error: "Launched coin not found." }, { status: 404 });
  }

  try {
    const result = await planOrRunIndexerSwap(
      {
        contractAddress: coin.contractAddress,
        ticker: coin.ticker,
        decimals: coin.tokenomics.decimals
      },
      parsed.data
    );

    if (result.swapTxHash) {
      await recordIndexerSwap({
        draftId: coin.id,
        contractAddress: coin.contractAddress,
        chainId: coin.chainId,
        ticker: coin.ticker,
        wethAddress: result.weth,
        feeTier: result.fee,
        swapTxHash: result.swapTxHash
      });
    }

    return NextResponse.json({ result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not run indexer swap." },
      { status: 500 }
    );
  }
}
