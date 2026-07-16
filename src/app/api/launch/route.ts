import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { query, withTransaction } from "@/lib/db";
import { env, isAdminEmail } from "@/lib/env";
import { launchToken } from "@/lib/launch";
import { applyRateLimit } from "@/lib/rate-limit";
import { readJsonBody, rejectCrossOrigin } from "@/lib/request-guards";

export const runtime = "nodejs";

const schema = z.object({
  draftId: z.string().min(1),
  name: z.string().min(2).max(64),
  ticker: z
    .string()
    .min(3)
    .max(6)
    .regex(/^[A-Z0-9]+$/),
  description: z.string().min(20).max(1000),
  tokenomics: z.object({
    supply: z.string().min(1),
    decimals: z.number().int().min(0).max(36),
    allocation: z.array(
      z.object({
        label: z.string().min(1).max(60),
        percent: z.number().min(0).max(100)
      })
    ),
    notes: z.array(z.string().max(160))
  }),
  acknowledgements: z.object({
    noInvestmentValue: z.literal(true),
    noAffiliation: z.literal(true),
    contentRights: z.literal(true),
    jurisdictionAllowed: z.literal(true),
    liveAdminControlled: z.literal(true)
  })
});

const guardrailVersion = "2026-07-16.public-demo-v1";
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

  if (env.launchMode !== "demo" && !isAdminEmail(user.email)) {
    return NextResponse.json(
      { error: "Live launches are admin-controlled in this deployment." },
      { status: 403 }
    );
  }

  const limited = await applyRateLimit(request, {
    name: env.launchMode === "demo" ? "launch:demo:user" : "launch:live:admin",
    limit: env.launchMode === "demo" ? 8 : 3,
    windowSeconds: 60 * 60,
    identity: user.id
  });
  if (limited) return limited;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const parsed = schema.safeParse(json.body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Launch form is incomplete or invalid." }, { status: 400 });
  }

  const allocationTotal = parsed.data.tokenomics.allocation.reduce((sum, row) => sum + row.percent, 0);
  if (allocationTotal !== 100) {
    return NextResponse.json({ error: "Tokenomics allocation must total 100%." }, { status: 400 });
  }

  if (!/^(\d+|\d{1,3}(,\d{3})+)$/.test(parsed.data.tokenomics.supply)) {
    return NextResponse.json({ error: "Token supply must be a whole number." }, { status: 400 });
  }

  const supply = BigInt(parsed.data.tokenomics.supply.replace(/,/g, ""));
  if (supply <= 0n) {
    return NextResponse.json({ error: "Token supply must be a positive number." }, { status: 400 });
  }

  const ownership = await query<DraftLaunchState>(
    `
      select id, status, contract_address, tx_hash, chain_id
             , updated_at
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
      return NextResponse.json({ error: "This draft is already launching. Refresh in a moment." }, { status: 409 });
    }

    const recovered = await recoverStaleLaunch(parsed.data.draftId, user.id, draftState.updated_at);
    if (!recovered) {
      return NextResponse.json({ error: "This draft is already launching. Refresh in a moment." }, { status: 409 });
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
        set status = 'launching', updated_at = now()
        where id = $1 and user_id = $2 and status = 'draft'
        returning id
      `,
      [parsed.data.draftId, user.id]
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
            chainId: env.robinhoodChainId,
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

  try {
    const launch = await launchToken(parsed.data);
    await withTransaction(async (client) => {
      await client.query(
        `
          update snaphood_token_drafts
          set name = $2,
              ticker = $3,
              description = $4,
              tokenomics = $5,
              status = 'launched',
              contract_address = $6,
              tx_hash = $7,
              chain_id = $8,
              updated_at = now()
          where id = $1
        `,
        [
          parsed.data.draftId,
          parsed.data.name,
          parsed.data.ticker,
          parsed.data.description,
          JSON.stringify(parsed.data.tokenomics),
          launch.contractAddress,
          launch.txHash,
          launch.chainId
        ]
      );

      await client.query(
        "insert into snaphood_launch_events (id, draft_id, event_type, payload) values ($1, $2, $3, $4)",
        [
          crypto.randomUUID(),
          parsed.data.draftId,
          "launch.completed",
          JSON.stringify({
            launch,
            guardrails: {
              version: guardrailVersion,
              acceptedAt,
              acceptedBy: user.id,
              acknowledgements: parsed.data.acknowledgements
            }
          })
        ]
      );
    });

    return NextResponse.json({ launch });
  } catch (error) {
    await withTransaction(async (client) => {
      await client.query("update snaphood_token_drafts set status = 'failed', updated_at = now() where id = $1", [
        parsed.data.draftId
      ]);
      await client.query(
        "insert into snaphood_launch_events (id, draft_id, event_type, payload) values ($1, $2, $3, $4)",
        [
          crypto.randomUUID(),
          parsed.data.draftId,
          "launch.failed",
          JSON.stringify({
            mode: env.launchMode,
            chainId: env.robinhoodChainId,
            error: error instanceof Error ? error.message : "Launch failed.",
            failedAt: new Date().toISOString()
          })
        ]
      );
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Launch failed." },
      { status: 500 }
    );
  }
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
          reason: "stale launching draft without chain receipt"
        })
      ]
    );

    return true;
  });
}
