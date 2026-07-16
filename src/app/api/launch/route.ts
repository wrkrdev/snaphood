import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { env, isAdminEmail } from "@/lib/env";
import { launchToken } from "@/lib/launch";
import { applyRateLimit } from "@/lib/rate-limit";

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
  })
});

export async function POST(request: Request) {
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

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Launch form is incomplete or invalid." }, { status: 400 });
  }

  const ownership = await query<{ id: string }>(
    "select id from snaphood_token_drafts where id = $1 and user_id = $2 limit 1",
    [parsed.data.draftId, user.id]
  );

  if (!ownership.rows[0]) {
    return NextResponse.json({ error: "Draft not found." }, { status: 404 });
  }

  await query("update snaphood_token_drafts set status = 'launching', updated_at = now() where id = $1", [
    parsed.data.draftId
  ]);

  try {
    const launch = await launchToken(parsed.data);
    await query(
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

    await query(
      "insert into snaphood_launch_events (id, draft_id, event_type, payload) values ($1, $2, $3, $4)",
      [crypto.randomUUID(), parsed.data.draftId, "launch.completed", JSON.stringify(launch)]
    );

    return NextResponse.json({ launch });
  } catch (error) {
    await query("update snaphood_token_drafts set status = 'failed', updated_at = now() where id = $1", [
      parsed.data.draftId
    ]);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Launch failed." },
      { status: 500 }
    );
  }
}
