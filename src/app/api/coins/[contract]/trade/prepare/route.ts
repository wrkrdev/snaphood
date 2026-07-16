import { NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { applyRateLimit } from "@/lib/rate-limit";
import { readJsonBody, rejectCrossOrigin } from "@/lib/request-guards";
import { planUserWalletLiquidity } from "@/lib/trading";
import { getLaunchedCoin } from "@/lib/coins";

export const runtime = "nodejs";

const schema = z.object({
  creatorWallet: z.string().refine(isAddress, "Creator wallet must be an EVM address."),
  tokenAmount: z.string().min(1).optional(),
  ethAmount: z.string().min(1).optional()
});

export async function POST(request: Request, { params }: { params: Promise<{ contract: string }> }) {
  const blocked = rejectCrossOrigin(request);
  if (blocked) return blocked;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in before making a token tradable." }, { status: 401 });
  }

  const limited = await applyRateLimit(request, {
    name: "trade:prepare:user-wallet",
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

  if (coin.poolAddress) {
    return NextResponse.json({ error: "This token already has a recorded trading pool." }, { status: 409 });
  }

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const parsed = schema.safeParse(json.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Trading request is incomplete or invalid." }, { status: 400 });
  }

  const creatorWallet = getAddress(parsed.data.creatorWallet);
  const launchCreator = await getLaunchCreatorWallet(coin.id);
  if (!launchCreator || getAddress(launchCreator) !== creatorWallet) {
    return NextResponse.json({ error: "Connect the creator wallet that launched this token." }, { status: 403 });
  }

  try {
    const plan = await planUserWalletLiquidity(
      {
        contractAddress: coin.contractAddress,
        ticker: coin.ticker,
        decimals: readDecimals(coin.tokenomics)
      },
      {
        creatorWallet,
        tokenAmount: parsed.data.tokenAmount,
        ethAmount: parsed.data.ethAmount
      }
    );

    return NextResponse.json({ plan });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not prepare trading plan." },
      { status: 400 }
    );
  }
}

async function getLaunchCreatorWallet(draftId: string) {
  const result = await query<{ wallet: string | null }>(
    `
      select coalesce(
        payload #>> '{launch,deployer}',
        payload #>> '{creatorWallet}',
        payload #>> '{verification,sender}'
      ) as wallet
      from snaphood_launch_events
      where draft_id = $1
        and event_type in ('launch.completed', 'launch.started')
      order by created_at desc
      limit 1
    `,
    [draftId]
  );

  return result.rows[0]?.wallet ?? null;
}

function readDecimals(tokenomics: unknown) {
  const decimals = Number((tokenomics as { decimals?: unknown } | null)?.decimals);
  return Number.isInteger(decimals) ? decimals : 18;
}
