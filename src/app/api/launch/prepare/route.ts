import { NextResponse } from "next/server";
import { getAddress, isAddress, keccak256, type Hex } from "viem";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { query, withTransaction } from "@/lib/db";
import { env } from "@/lib/env";
import { validateLaunchRequestShape, validateTokenomics, type ValidatedLaunchRequest } from "@/lib/launch-validation";
import { applyRateLimit } from "@/lib/rate-limit";
import { readJsonBody, rejectCrossOrigin } from "@/lib/request-guards";
import SnapHoodToken from "@/generated/SnapHoodToken.json";

export const runtime = "nodejs";

const prepareSchema = z.object({
  creatorWallet: z.string().refine(isAddress, "Creator wallet must be an EVM address.")
});

const guardrailVersion = "2026-07-16.user-wallet-v1";
const staleLaunchRecoveryMs = 15 * 60 * 1000;

type DraftLaunchState = {
  id: string;
  status: string;
  contract_address: string | null;
  tx_hash: string | null;
  chain_id: number | null;
  updated_at: Date;
};

export async function POST(request: Request) {
  const blocked = rejectCrossOrigin(request);
  if (blocked) return blocked;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in before launching." }, { status: 401 });
  }

  const limited = await applyRateLimit(request, {
    name: env.launchMode === "demo" ? "launch:prepare:demo:user" : "launch:prepare:live:user-wallet",
    limit: env.launchMode === "demo" ? 12 : 6,
    windowSeconds: 60 * 60,
    identity: user.id
  });
  if (limited) return limited;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const parsed = validateLaunchRequestShape(json.body);
  const prepare = prepareSchema.safeParse(json.body);
  if (!parsed.success || !prepare.success) {
    return NextResponse.json({ error: "Launch form is incomplete or invalid." }, { status: 400 });
  }

  const tokenomicsError = validateTokenomics(parsed.data);
  if (tokenomicsError) {
    return NextResponse.json({ error: tokenomicsError }, { status: 400 });
  }

  const creatorWallet = getAddress(prepare.data.creatorWallet);
  const ownership = await query<DraftLaunchState>(
    `
      select id, status, contract_address, tx_hash, chain_id, updated_at
      from snaphood_token_drafts
      where id = $1 and user_id = $2
      limit 1
    `,
    [parsed.data.draftId, user.id]
  );

  const draftState = ownership.rows[0];
  if (!draftState) {
    return NextResponse.json({ error: "Draft not found." }, { status: 404 });
  }

  if (draftState.status === "launched" && draftState.contract_address && draftState.tx_hash && draftState.chain_id) {
    return NextResponse.json({
      launch: {
        contractAddress: draftState.contract_address,
        txHash: draftState.tx_hash,
        chainId: draftState.chain_id,
        explorerUrl: `${env.robinhoodBlockExplorerUrl.replace(/\/$/, "")}/address/${draftState.contract_address}`,
        mode: env.launchMode,
        name: parsed.data.name,
        ticker: parsed.data.ticker,
        reused: true
      }
    });
  }

  let launchableStatus = draftState.status;
  if (draftState.status === "launching") {
    if (draftState.contract_address || draftState.tx_hash || draftState.chain_id) {
      return NextResponse.json({ error: "This draft has partial launch metadata. Contact an admin before retrying." }, { status: 409 });
    }

    if (!isStaleLaunch(draftState.updated_at)) {
      return NextResponse.json({ launchPlan: buildLaunchPlan(parsed.data, creatorWallet, true) });
    }

    const recovered = await recoverStaleLaunch(parsed.data.draftId, user.id, draftState.updated_at);
    if (!recovered) {
      return NextResponse.json({ error: "This draft is already prepared for launch. Finish the wallet transaction or retry later." }, { status: 409 });
    }

    launchableStatus = "draft";
  }

  if (launchableStatus !== "draft") {
    return NextResponse.json({ error: "This draft cannot be launched. Create a new draft and try again." }, { status: 409 });
  }

  const acceptedAt = new Date().toISOString();
  const transition = await withTransaction(async (client) => {
    const result = await client.query<{ id: string }>(
      `
        update snaphood_token_drafts
        set name = $3,
            ticker = $4,
            description = $5,
            tokenomics = $6,
            status = 'launching',
            updated_at = now()
        where id = $1 and user_id = $2 and status = 'draft'
        returning id
      `,
      [
        parsed.data.draftId,
        user.id,
        parsed.data.name,
        parsed.data.ticker,
        parsed.data.description,
        JSON.stringify(parsed.data.tokenomics)
      ]
    );

    if (result.rows[0]) {
      await client.query(
        "insert into snaphood_launch_events (id, draft_id, event_type, payload) values ($1, $2, $3, $4)",
        [
          crypto.randomUUID(),
          parsed.data.draftId,
          "launch.started",
          JSON.stringify({
            mode: env.launchMode,
            execution: "user-wallet",
            chainId: env.robinhoodChainId,
            creatorWallet,
            requestedToken: {
              name: parsed.data.name,
              ticker: parsed.data.ticker,
              supply: parsed.data.tokenomics.supply,
              decimals: parsed.data.tokenomics.decimals
            },
            guardrails: {
              version: guardrailVersion,
              acceptedAt,
              acceptedBy: user.id,
              acknowledgements: parsed.data.acknowledgements
            }
          })
        ]
      );
    }

    return result.rows[0] ?? null;
  });

  if (!transition) {
    return NextResponse.json({ error: "This draft is already being launched." }, { status: 409 });
  }

  return NextResponse.json({
    launchPlan: buildLaunchPlan(parsed.data, creatorWallet, false)
  });
}

function buildLaunchPlan(input: ValidatedLaunchRequest, creatorWallet: string, reused: boolean) {
  const initialSupply = input.tokenomics.supply.replace(/,/g, "");
  return {
    draftId: input.draftId,
    mode: env.launchMode,
    reused,
    chain: {
      id: env.robinhoodChainId,
      name: env.robinhoodNetwork === "mainnet" ? "Robinhood Chain" : "Robinhood Chain Testnet",
      rpcUrl: env.robinhoodRpcUrl,
      explorerUrl: env.robinhoodBlockExplorerUrl,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }
    },
    creatorWallet,
    contract: {
      abi: SnapHoodToken.abi,
      bytecode: SnapHoodToken.bytecode,
      bytecodeHash: keccak256(SnapHoodToken.bytecode as Hex),
      args: [input.name, input.ticker, input.tokenomics.decimals, initialSupply, creatorWallet]
    }
  };
}

function isStaleLaunch(updatedAt: Date) {
  return Date.now() - updatedAt.getTime() >= staleLaunchRecoveryMs;
}

async function recoverStaleLaunch(draftId: string, userId: string, previousUpdatedAt: Date) {
  return withTransaction(async (client) => {
    const result = await client.query<{ id: string }>(
      `
        update snaphood_token_drafts
        set status = 'draft', updated_at = now()
        where id = $1
          and user_id = $2
          and status = 'launching'
          and contract_address is null
          and tx_hash is null
          and chain_id is null
          and updated_at <= $3
        returning id
      `,
      [draftId, userId, new Date(Date.now() - staleLaunchRecoveryMs)]
    );

    if (!result.rows[0]) {
      return false;
    }

    await client.query(
      "insert into snaphood_launch_events (id, draft_id, event_type, payload) values ($1, $2, $3, $4)",
      [
        crypto.randomUUID(),
        draftId,
        "launch.recovered",
        JSON.stringify({
          mode: env.launchMode,
          chainId: env.robinhoodChainId,
          previousUpdatedAt: previousUpdatedAt.toISOString(),
          recoveredAt: new Date().toISOString(),
          reason: "stale user-wallet launch without chain receipt"
        })
      ]
    );

    return true;
  });
}
