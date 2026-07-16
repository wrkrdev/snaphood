import { execFile } from "child_process";
import { promisify } from "util";
import { config } from "dotenv";
import Redis from "ioredis";
import { Pool } from "pg";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const execFileAsync = promisify(execFile);
const profile = readArg("profile") ?? process.env.SNAPHOOD_READINESS_PROFILE ?? "local";
const validProfiles = new Set(["local", "public", "live"]);

if (!validProfiles.has(profile)) {
  console.error(`Unknown readiness profile "${profile}". Use local, public, or live.`);
  process.exit(1);
}

const isPublic = profile === "public" || profile === "live";
const isLive = profile === "live";
const checks = [];

await checkRequiredEnv();
await checkDatabase();
await checkRedis();
await checkWrkrStorage();

const failures = checks.filter((check) => check.status === "fail");
const warnings = checks.filter((check) => check.status === "warn");

console.log(
  JSON.stringify(
    {
      ok: failures.length === 0,
      profile,
      summary: {
        pass: checks.filter((check) => check.status === "pass").length,
        warn: warnings.length,
        fail: failures.length
      },
      checks
    },
    null,
    2
  )
);

if (failures.length > 0) {
  process.exit(1);
}

async function checkRequiredEnv() {
  requireOrFail("DATABASE_URL", "Wrkr Postgres is required for users, drafts, launches, and trading metadata.");
  requireOrWarn("REDIS_URL", "Wrkr Redis enables distributed rate limits.");
  requireOrFail("NEXT_PUBLIC_APP_URL", "Public URL is required for share links, auth links, and metadata.");

  const sessionSecret = env("SNAPHOOD_SESSION_SECRET");
  if (!sessionSecret || sessionSecret === "snaphood-local-demo-secret") {
    isPublic
      ? fail("SNAPHOOD_SESSION_SECRET", "Set a unique session secret before public traffic.")
      : warn("SNAPHOOD_SESSION_SECRET", "Using the local fallback secret is acceptable only for private demos.");
  } else if (sessionSecret.length < 32) {
    isPublic
      ? fail("SNAPHOOD_SESSION_SECRET", "Use at least 32 characters of entropy for public sessions.")
      : warn("SNAPHOOD_SESSION_SECRET", "Short session secret; use at least 32 characters before public use.");
  } else {
    pass("SNAPHOOD_SESSION_SECRET", "Session secret is configured.");
  }

  const demoAuthEnabled = env("SNAPHOOD_DEMO_AUTH_ENABLED") !== "false";
  if (demoAuthEnabled && isPublic) {
    fail("SNAPHOOD_DEMO_AUTH_ENABLED", "Disable demo auth for public or live deployments.");
  } else {
    pass("SNAPHOOD_DEMO_AUTH_ENABLED", demoAuthEnabled ? "Demo auth enabled for local use." : "Magic-link auth enabled.");
  }

  const authMode = env("SNAPHOOD_AUTH_EMAIL_MODE") || "dry-run";
  if (!demoAuthEnabled && authMode !== "wrkr" && isPublic) {
    fail("SNAPHOOD_AUTH_EMAIL_MODE", "Public magic-link auth must send through wrkr email, not dry-run links.");
  } else if (!demoAuthEnabled && authMode === "wrkr") {
    pass("SNAPHOOD_AUTH_EMAIL_MODE", "Wrkr email mode selected.");
  } else {
    warn("SNAPHOOD_AUTH_EMAIL_MODE", "Dry-run auth links are for local demos only.");
  }

  if (!env("SNAPHOOD_ADMIN_EMAILS")) {
    isPublic
      ? fail("SNAPHOOD_ADMIN_EMAILS", "At least one admin email is required for live launch and trading controls.")
      : warn("SNAPHOOD_ADMIN_EMAILS", "Admin routes cannot be used until an admin email is configured.");
  } else {
    pass("SNAPHOOD_ADMIN_EMAILS", "Admin allowlist is configured.");
  }

  requireAiKey("LLM_API_KEY", "Vision metadata generation");
  requireAiKey("FAL_KEY", "Generated profile/banner images");

  const storageEnabled = env("WRKR_STORAGE_ENABLED") === "true";
  const storagePublic = env("WRKR_STORAGE_PUBLIC_UPLOADS") === "true";
  if (!storageEnabled) {
    isPublic
      ? fail("WRKR_STORAGE_ENABLED", "Enable Wrkr storage before public traffic so user assets are not local-only.")
      : warn("WRKR_STORAGE_ENABLED", "Local upload fallback is enabled.");
  } else {
    pass("WRKR_STORAGE_ENABLED", "Wrkr storage is enabled.");
  }

  if (!storagePublic) {
    isPublic
      ? fail("WRKR_STORAGE_PUBLIC_UPLOADS", "Public coin pages need publicly readable asset URLs.")
      : warn("WRKR_STORAGE_PUBLIC_UPLOADS", "Generated assets will fall back to local URLs unless public storage URLs are enabled.");
  } else {
    pass("WRKR_STORAGE_PUBLIC_UPLOADS", "Public asset URLs are enabled.");
  }

  const launchMode = env("TOKEN_LAUNCH_MODE") || "demo";
  if (isLive && launchMode === "demo") {
    fail("TOKEN_LAUNCH_MODE", "Live readiness requires a non-demo launch mode.");
  } else {
    pass("TOKEN_LAUNCH_MODE", `Launch mode is ${launchMode}.`);
  }

  requireOrFail("ROBINHOOD_RPC_URL", "Robinhood Chain RPC is required.");
  const chainId = Number(env("ROBINHOOD_CHAIN_ID") || "0");
  if (![4663, 46630].includes(chainId)) {
    fail("ROBINHOOD_CHAIN_ID", "Expected Robinhood Chain mainnet 4663 or testnet 46630.");
  } else {
    pass("ROBINHOOD_CHAIN_ID", `Robinhood Chain ID ${chainId} configured.`);
  }

  const privateKey = env("DEPLOYER_PRIVATE_KEY");
  if (isLive && !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    fail("DEPLOYER_PRIVATE_KEY", "Live launch mode needs a dedicated low-balance deployer private key.");
  } else if (privateKey) {
    pass("DEPLOYER_PRIVATE_KEY", "Deployer key is present.");
  } else {
    warn("DEPLOYER_PRIVATE_KEY", "No deployer key; demo mode can still run.");
  }
}

async function checkDatabase() {
  const databaseUrl = env("DATABASE_URL");
  if (!databaseUrl) return;

  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await pool.query("select 1");
    pass("database connection", "Postgres connection succeeded.");

    const tableResult = await pool.query(
      `
        select table_name
        from information_schema.tables
        where table_schema = 'public'
          and table_name = any($1::text[])
      `,
      [
        [
          "snaphood_users",
          "snaphood_sessions",
          "snaphood_auth_challenges",
          "snaphood_token_drafts",
          "snaphood_launch_events",
          "snaphood_token_trading"
        ]
      ]
    );
    const found = new Set(tableResult.rows.map((row) => row.table_name));
    const missing = [
      "snaphood_users",
      "snaphood_sessions",
      "snaphood_auth_challenges",
      "snaphood_token_drafts",
      "snaphood_launch_events",
      "snaphood_token_trading"
    ].filter((table) => !found.has(table));
    if (missing.length) {
      fail("database migrations", `Missing tables: ${missing.join(", ")}. Run npm run db:migrate.`);
    } else {
      pass("database migrations", "All SnapHood tables exist.");
    }

    const indexResult = await pool.query(
      `
        select indexname
        from pg_indexes
        where schemaname = 'public'
          and indexname = any($1::text[])
      `,
      [
        [
          "snaphood_token_drafts_contract_chain_unique",
          "snaphood_token_trading_contract_chain_unique"
        ]
      ]
    );
    const foundIndexes = new Set(indexResult.rows.map((row) => row.indexname));
    const missingIndexes = [
      "snaphood_token_drafts_contract_chain_unique",
      "snaphood_token_trading_contract_chain_unique"
    ].filter((index) => !foundIndexes.has(index));
    if (missingIndexes.length) {
      fail("database integrity indexes", `Missing indexes: ${missingIndexes.join(", ")}. Run npm run db:migrate.`);
    } else {
      pass("database integrity indexes", "Contract uniqueness indexes exist.");
    }
  } catch (error) {
    fail("database connection", messageFor(error));
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function checkRedis() {
  const redisUrl = env("REDIS_URL");
  if (!redisUrl) return;

  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false
  });
  try {
    await redis.connect();
    const pong = await redis.ping();
    if (pong === "PONG") {
      pass("redis connection", "Redis ping succeeded.");
    } else {
      warn("redis connection", `Unexpected Redis ping response: ${pong}`);
    }
  } catch (error) {
    isPublic ? fail("redis connection", messageFor(error)) : warn("redis connection", messageFor(error));
  } finally {
    redis.disconnect();
  }
}

async function checkWrkrStorage() {
  if (env("WRKR_STORAGE_ENABLED") !== "true") return;

  try {
    await execFileAsync("wrkr", ["storage", "--help"], { timeout: 10_000 });
    pass("wrkr storage cli", "wrkr storage command is available.");
  } catch (error) {
    isPublic ? fail("wrkr storage cli", messageFor(error)) : warn("wrkr storage cli", messageFor(error));
  }
}

function requireAiKey(name, label) {
  if (env(name)) {
    pass(name, `${label} key is configured.`);
  } else if (isPublic) {
    fail(name, `${label} needs a configured provider key for production behavior.`);
  } else {
    warn(name, `${label} will use deterministic/local fallback behavior.`);
  }
}

function requireOrFail(name, detail) {
  if (env(name)) {
    pass(name, "Configured.");
  } else {
    fail(name, detail);
  }
}

function requireOrWarn(name, detail) {
  if (env(name)) {
    pass(name, "Configured.");
  } else if (isPublic) {
    fail(name, detail);
  } else {
    warn(name, detail);
  }
}

function pass(name, detail) {
  checks.push({ name, status: "pass", detail });
}

function warn(name, detail) {
  checks.push({ name, status: "warn", detail });
}

function fail(name, detail) {
  checks.push({ name, status: "fail", detail });
}

function env(name) {
  return process.env[name]?.trim() ?? "";
}

function readArg(name) {
  const prefix = `--${name}=`;
  const arg = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return arg?.slice(prefix.length);
}

function messageFor(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
