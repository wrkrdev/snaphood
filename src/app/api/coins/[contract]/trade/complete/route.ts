import { NextResponse } from "next/server";
import { getAddress, isAddress, type Hex } from "viem";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { getLaunchedCoin } from "@/lib/coins";
import { query } from "@/lib/db";
import { recordLaunchEvent, recordLiquidity } from "@/lib/admin-coins";
import { applyRateLimit } from "@/lib/rate-limit";
import { readJsonBody, rejectCrossOrigin } from "@/lib/request-guards";
import { factoryAbi, getReadOnlyTradingContext, readPositionId, zeroAddress } from "@/lib/trading";

export const runtime = "nodejs";

const schema = z.object({
  creatorWallet: z.string().refine(isAddress, "Creator wallet must be an EVM address."),
  tokenAmount: z.string().min(1),
  ethAmount: z.string().min(1),
  executed: z
    .array(
      z.object({
        label: z.string().min(1),
        hash: z.string().regex(/^0x[a-fA-F0-9]{64}$/)
      })
    )
    .min(1)
});

export async function POST(request: Request, { params }: { params: Promise<{ contract: string }> }) {
  const blocked = rejectCrossOrigin(request);
  if (blocked) return blocked;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in before recording trading metadata." }, { status: 401 });
  }

  const limited = await applyRateLimit(request, {
    name: "trade:complete:user-wallet",
    limit: 10,
    windowSeconds: 60 * 60,
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
    return NextResponse.json({ error: "Trading completion payload is incomplete or invalid." }, { status: 400 });
  }

  const creatorWallet = getAddress(parsed.data.creatorWallet);
  const launchCreator = await getLaunchCreatorWallet(coin.id);
  if (!launchCreator || getAddress(launchCreator) !== creatorWallet) {
    return NextResponse.json({ error: "Connect the creator wallet that launched this token." }, { status: 403 });
  }

  const mintStep = [...parsed.data.executed].reverse().find((step) => step.label === "mint liquidity position");
  if (!mintStep) {
    return NextResponse.json({ error: "Mint liquidity transaction is required." }, { status: 400 });
  }

  try {
    const ctx = getReadOnlyTradingContext();
    for (const step of parsed.data.executed) {
      const receipt = await ctx.publicClient.getTransactionReceipt({ hash: step.hash as Hex });
      if (receipt.status !== "success") {
        throw new Error(`${step.label} did not succeed on-chain.`);
      }

      if (getAddress(receipt.from) !== creatorWallet) {
        throw new Error(`${step.label} was not sent by the creator wallet.`);
      }
    }

    const mintReceipt = await ctx.publicClient.getTransactionReceipt({ hash: mintStep.hash as Hex });
    const poolAddress = await ctx.publicClient.readContract({
      address: ctx.factory,
      abi: factoryAbi,
      functionName: "getPool",
      args: [getAddress(coin.contractAddress), ctx.weth, ctx.fee]
    });
    if (poolAddress === zeroAddress) {
      throw new Error("Uniswap factory still does not show a pool for this token.");
    }

    const positionId = readPositionId(mintReceipt, ctx.positionManager, creatorWallet);
    await recordLiquidity({
      draftId: coin.id,
      contractAddress: coin.contractAddress,
      chainId: coin.chainId,
      ticker: coin.ticker,
      poolAddress,
      positionManager: ctx.positionManager,
      positionId,
      feeTier: ctx.fee,
      wethAddress: ctx.weth,
      liquidityTokenAmount: parsed.data.tokenAmount,
      liquidityEthAmount: parsed.data.ethAmount,
      liquidityTxHash: mintStep.hash
    });

    await recordLaunchEvent({
      draftId: coin.id,
      eventType: "trading.liquidity_seeded",
      payload: {
        userId: user.id,
        execution: "user-wallet",
        creatorWallet,
        contractAddress: coin.contractAddress,
        poolAddress,
        positionId,
        feeTier: ctx.fee,
        tokenAmount: parsed.data.tokenAmount,
        ethAmount: parsed.data.ethAmount,
        liquidityTxHash: mintStep.hash,
        executed: parsed.data.executed
      }
    });

    return NextResponse.json({
      result: {
        poolAddress,
        positionId,
        fee: ctx.fee,
        weth: ctx.weth,
        tokenAmount: parsed.data.tokenAmount,
        ethAmount: parsed.data.ethAmount,
        liquidityTxHash: mintStep.hash
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not verify trading transactions." },
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
