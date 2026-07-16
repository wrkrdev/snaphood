import { createHmac } from "crypto";
import { config } from "dotenv";
import { Pool } from "pg";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const baseUrl = (process.env.SNAPHOOD_SMOKE_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const databaseUrl = process.env.DATABASE_URL;
const sessionSecret = process.env.SNAPHOOD_SESSION_SECRET ?? "snaphood-local-demo-secret";
const cleanup = process.env.SNAPHOOD_GENERATE_SMOKE_CLEANUP !== "false";
const syntheticIp = `192.0.2.${Math.floor(Math.random() * 200) + 1}`;
const email = `generate-smoke-${Date.now()}@snaphood.local`;
const userId = crypto.randomUUID();
const sessionId = crypto.randomUUID();
const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
const cookie = `snaphood_session=${packSession(sessionId)}`;
const checks = [];

if (!databaseUrl) {
  console.error("DATABASE_URL is required. Run `wrkr db --json` and add it to .env.local.");
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl, max: 1 });

try {
  const health = await getJson("/api/health", "health");
  assert(health.ok === true, "health should be ok");
  assert(health.readiness?.databaseReachable === true, "database should be reachable");

  await createVerifierSession();
  await postBadImage();
  const generated = await postImage();
  const draft = generated.draft;

  assert(draft?.id, "generate response should include a draft id");
  assert(draft.name && draft.ticker && draft.description, "draft should include generated metadata");
  assert(/^[A-Z0-9]{3,6}$/.test(draft.ticker), "draft ticker should be normalized to 3-6 uppercase characters");
  assert(draft.originalImageUrl && draft.profileImageUrl && draft.bannerImageUrl, "draft should include original/profile/banner image URLs");
  assert(Array.isArray(draft.tokenomics?.allocation), "draft should include tokenomics allocation");
  assert(
    draft.tokenomics.allocation.reduce((sum, row) => sum + Number(row.percent || 0), 0) === 100,
    "draft allocation should total 100 percent"
  );
  assert(!containsInvestmentPromise(draft.description), "draft description should not include investment promises");

  if (health.readiness?.storage && health.readiness?.publicStorageUploads) {
    assert(isHttpUrl(draft.originalImageUrl), "storage-backed original image should use a public URL");
    assert(isHttpUrl(draft.profileImageUrl), "storage-backed profile image should use a public URL");
    assert(isHttpUrl(draft.bannerImageUrl), "storage-backed banner image should use a public URL");
  }

  const dbDraft = await pool.query(
    `
      select id, user_id, original_image_url, profile_image_url, banner_image_url, name, ticker, description, tokenomics, status
      from snaphood_token_drafts
      where id = $1 and user_id = $2
    `,
    [draft.id, userId]
  );
  assert(dbDraft.rowCount === 1, "generated draft should be persisted for the verifier user");
  assert(dbDraft.rows[0].status === "draft", "generated draft should remain in draft status");

  const draftsPayload = await getJson("/api/me/drafts", "recent drafts");
  assert(
    draftsPayload.drafts?.some((persistedDraft) => persistedDraft.id === draft.id),
    "generated draft should be visible through /api/me/drafts"
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        baseUrl,
        cleanup,
        draft: {
          id: draft.id,
          name: draft.name,
          ticker: draft.ticker,
          originalImageUrl: draft.originalImageUrl,
          profileImageUrl: draft.profileImageUrl,
          bannerImageUrl: draft.bannerImageUrl
        },
        checks
      },
      null,
      2
    )
  );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        baseUrl,
        checks,
        error: error instanceof Error ? error.message : String(error)
      },
      null,
      2
    )
  );
  process.exitCode = 1;
} finally {
  if (cleanup) {
    await pool.query("delete from snaphood_users where id = $1", [userId]).catch(() => undefined);
  }
  await pool.end().catch(() => undefined);
}

async function createVerifierSession() {
  await pool.query(
    `
      insert into snaphood_users (id, email)
      values ($1, $2)
    `,
    [userId, email]
  );
  await pool.query(
    `
      insert into snaphood_sessions (id, user_id, expires_at)
      values ($1, $2, $3)
    `,
    [sessionId, userId, expiresAt]
  );
  checks.push({ name: "verifier session", status: "created" });
}

async function getJson(path, name) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: withVerifierHeaders()
  });
  const text = await response.text();
  assert(response.ok, `${path} should return 2xx, got ${response.status}: ${text}`);
  checks.push({ name, status: response.status });
  return JSON.parse(text);
}

async function postImage() {
  const formData = new FormData();
  formData.append("image", new Blob([tinyPng()], { type: "image/png" }), "generate-smoke-green-dot.png");

  const response = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: withVerifierHeaders(),
    body: formData
  });
  const text = await response.text();
  assert(response.ok, `/api/generate should return 2xx, got ${response.status}: ${text}`);
  checks.push({ name: "/api/generate", status: response.status });
  return JSON.parse(text);
}

async function postBadImage() {
  const formData = new FormData();
  formData.append("image", new Blob([Buffer.from("<svg><script>alert(1)</script></svg>")], { type: "image/svg+xml" }), "bad.svg");

  const response = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: withVerifierHeaders(),
    body: formData
  });
  const text = await response.text();
  assert(response.status === 400, `/api/generate should reject unsafe image uploads, got ${response.status}: ${text}`);
  const payload = JSON.parse(text);
  assert(payload.error, "unsafe image upload should return an error");
  checks.push({ name: "/api/generate unsafe image", status: response.status });
}

function withVerifierHeaders() {
  return {
    cookie,
    "x-forwarded-for": syntheticIp
  };
}

function packSession(id) {
  return `${id}.${createHmac("sha256", sessionSecret).update(id).digest("base64url")}`;
}

function tinyPng() {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
    "base64"
  );
}

function isHttpUrl(value) {
  return typeof value === "string" && /^https?:\/\//.test(value);
}

function containsInvestmentPromise(value) {
  return /\b(guaranteed|risk[-\s]?free|investment|profit|returns?|moonshot|pump|100x|1000x|financial advice)\b/i.test(
    value
  );
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
