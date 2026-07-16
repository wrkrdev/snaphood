import { config } from "dotenv";
import { Pool } from "pg";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const baseUrl = (process.env.SNAPHOOD_SMOKE_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const databaseUrl = process.env.DATABASE_URL;
const syntheticIp = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;
const cookieJar = [];

if (!databaseUrl) {
  console.error("DATABASE_URL is required. Run `wrkr db --json` and add it to .env.local.");
  process.exit(1);
}

const health = await getJson("/api/health");
if (health.readiness?.launchMode !== "demo") {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: "Launch consistency verification only runs against TOKEN_LAUNCH_MODE=demo.",
        launchMode: health.readiness?.launchMode
      },
      null,
      2
    )
  );
  process.exit(1);
}

const email = `launch-consistency-${Date.now()}@snaphood.local`;
const auth = await postJson("/api/auth/start", { email });
if (auth.magicLink) {
  await verifyMagicLink(auth.magicLink);
}

const me = await getJson("/api/me");
assert(me.user?.id, "expected authenticated user id");

const pool = new Pool({ connectionString: databaseUrl, max: 1 });
const draftId = crypto.randomUUID();
const staleDraftId = crypto.randomUUID();
const draftIdsToCleanup = [];
const tokenomics = {
  supply: "1000000000",
  decimals: 18,
  allocation: [
    { label: "Community memes", percent: 45 },
    { label: "Liquidity seed", percent: 30 },
    { label: "Creator vault", percent: 15 },
    { label: "Airdrops", percent: 10 }
  ],
  notes: ["Demo launch consistency verifier.", "No implied investment value."]
};

try {
  await pool.query(
    `
      insert into snaphood_token_drafts (
        id, user_id, original_image_url, profile_image_url, banner_image_url,
        prompt_summary, name, ticker, description, tokenomics, status
      )
      values ($1, $2, '/assets/snapg-genesis.png', '/assets/snapg-genesis.png', '/assets/snapg-genesis.png',
        'launch consistency verifier', 'Consistency Check', 'CHK', $3, $4, 'draft')
    `,
    [
      draftId,
      me.user.id,
      "A deterministic API verifier draft used to prove repeated launch requests reuse the first launch receipt.",
      JSON.stringify(tokenomics)
    ]
  );
  draftIdsToCleanup.push(draftId);
} finally {
  await pool.end().catch(() => undefined);
}

const launchBody = {
  draftId,
  name: "Consistency Check",
  ticker: "CHK",
  description: "A deterministic API verifier draft used to prove repeated launch requests reuse the first launch receipt.",
  tokenomics,
  acknowledgements: {
    noInvestmentValue: true,
    noAffiliation: true,
    contentRights: true,
    jurisdictionAllowed: true,
    liveAdminControlled: true
  }
};

const first = await postJson("/api/launch", launchBody);
assert(first.launch?.contractAddress, "first launch should return a contract address");
assert(!first.launch.reused, "first launch should not be marked reused");

const second = await postJson("/api/launch", launchBody);
assert(second.launch?.reused === true, "second launch should reuse the existing receipt");
assert(
  second.launch.contractAddress === first.launch.contractAddress && second.launch.txHash === first.launch.txHash,
  "second launch should return the same contract and tx"
);

const startedEventCount = await countLaunchEvents(draftId, "launch.started");
const completedEventCount = await countLaunchEvents(draftId, "launch.completed");
assert(startedEventCount === 1, `expected one launch.started event after retry, got ${startedEventCount}`);
assert(completedEventCount === 1, `expected one launch.completed event after retry, got ${completedEventCount}`);

const feed = await getJson(`/api/coins?chainId=${first.launch.chainId}`);
const feedCoin = feed.coins?.find(
  (coin) => coin.contractAddress?.toLowerCase() === first.launch.contractAddress.toLowerCase()
);
assert(feedCoin, "launched coin should be visible through the public coins API");

await createStaleLaunchingDraft();
const staleLaunchBody = {
  ...launchBody,
  draftId: staleDraftId,
  name: "Recovered Launch",
  ticker: "RCVR",
  description: "A deterministic stale launching draft used to prove safe recovery after a worker interruption."
};
const recovered = await postJson("/api/launch", staleLaunchBody);
assert(recovered.launch?.contractAddress, "recovered launch should return a contract address");
const recoveredEventCount = await countLaunchEvents(staleDraftId, "launch.recovered");
const recoveredStartedEventCount = await countLaunchEvents(staleDraftId, "launch.started");
const recoveredCompletedEventCount = await countLaunchEvents(staleDraftId, "launch.completed");
assert(recoveredEventCount === 1, `expected one launch.recovered event, got ${recoveredEventCount}`);
assert(recoveredStartedEventCount === 2, `expected old and new launch.started events, got ${recoveredStartedEventCount}`);
assert(recoveredCompletedEventCount === 1, `expected one recovered launch.completed event, got ${recoveredCompletedEventCount}`);

await cleanupDraft();

console.log(
  JSON.stringify(
    {
      ok: true,
      draftId,
      contractAddress: first.launch.contractAddress,
      txHash: first.launch.txHash,
      launchStartedEvents: startedEventCount,
      launchCompletedEvents: completedEventCount,
      staleRecovery: {
        recoveredEvents: recoveredEventCount,
        launchStartedEvents: recoveredStartedEventCount,
        launchCompletedEvents: recoveredCompletedEventCount
      },
      feedVisible: true,
      reused: second.launch.reused
    },
    null,
    2
  )
);

async function cleanupDraft() {
  if (!draftIdsToCleanup.length) return;

  const cleanupPool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await cleanupPool.query("delete from snaphood_token_drafts where id = any($1::text[])", [draftIdsToCleanup]);
  } finally {
    await cleanupPool.end().catch(() => undefined);
  }
}

async function createStaleLaunchingDraft() {
  const stalePool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await stalePool.query(
      `
        insert into snaphood_token_drafts (
          id, user_id, original_image_url, profile_image_url, banner_image_url,
          prompt_summary, name, ticker, description, tokenomics, status, updated_at
        )
        values ($1, $2, '/assets/snapg-genesis.png', '/assets/snapg-genesis.png', '/assets/snapg-genesis.png',
          'stale launch recovery verifier', 'Recovered Launch', 'RCVR', $3, $4, 'launching', now() - interval '30 minutes')
      `,
      [
        staleDraftId,
        me.user.id,
        "A deterministic stale launching draft used to prove safe recovery after a worker interruption.",
        JSON.stringify(tokenomics)
      ]
    );
    draftIdsToCleanup.push(staleDraftId);
    await stalePool.query(
      "insert into snaphood_launch_events (id, draft_id, event_type, payload) values ($1, $2, $3, $4)",
      [
        crypto.randomUUID(),
        staleDraftId,
        "launch.started",
        JSON.stringify({
          mode: "demo",
          reason: "synthetic stale verifier event",
          createdBy: "verify:launch-consistency"
        })
      ]
    );
  } finally {
    await stalePool.end().catch(() => undefined);
  }
}

async function countLaunchEvents(targetDraftId, eventType) {
  const countPool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const result = await countPool.query(
      `
        select count(*)::int as count
        from snaphood_launch_events
        where draft_id = $1 and event_type = $2
      `,
      [targetDraftId, eventType]
    );
    return result.rows[0].count;
  } finally {
    await countPool.end().catch(() => undefined);
  }
}

async function getJson(path) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: withCookies({ "x-forwarded-for": syntheticIp })
  });
  return readJsonResponse(response, path);
}

async function postJson(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: withCookies({
      "content-type": "application/json",
      "x-forwarded-for": syntheticIp
    }),
    body: JSON.stringify(body)
  });
  captureCookies(response);
  return readJsonResponse(response, path);
}

async function verifyMagicLink(url) {
  const response = await fetch(url, {
    headers: withCookies({ "x-forwarded-for": syntheticIp }),
    redirect: "manual"
  });
  captureCookies(response);
  assert([302, 303, 307, 308].includes(response.status), "magic-link verification should redirect");
}

async function readJsonResponse(response, path) {
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`${path} did not return JSON: ${text}`);
  }

  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${text}`);
  }

  return payload;
}

function withCookies(headers) {
  if (!cookieJar.length) return headers;
  return {
    ...headers,
    cookie: cookieJar.join("; ")
  };
}

function captureCookies(response) {
  for (const cookie of response.headers.getSetCookie?.() ?? []) {
    const value = cookie.split(";")[0];
    const name = value.split("=")[0];
    const existingIndex = cookieJar.findIndex((entry) => entry.startsWith(`${name}=`));
    if (existingIndex >= 0) {
      cookieJar[existingIndex] = value;
    } else {
      cookieJar.push(value);
    }
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
