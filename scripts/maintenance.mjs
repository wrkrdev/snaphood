import { config } from "dotenv";
import { Pool } from "pg";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const databaseUrl = process.env.DATABASE_URL;
const dryRun = readBoolean("dry-run", process.env.SNAPHOOD_MAINTENANCE_DRY_RUN !== "false");
const staleDraftDays = Number(process.env.SNAPHOOD_STALE_DRAFT_RETENTION_DAYS ?? "30");
const authChallengeRetentionDays = Number(process.env.SNAPHOOD_AUTH_CHALLENGE_RETENTION_DAYS ?? "7");

if (!databaseUrl) {
  console.error("DATABASE_URL is required. Run `wrkr db --json` and add it to .env.local.");
  process.exit(1);
}

if (!Number.isFinite(staleDraftDays) || staleDraftDays < 1) {
  console.error("SNAPHOOD_STALE_DRAFT_RETENTION_DAYS must be a positive number.");
  process.exit(1);
}

if (!Number.isFinite(authChallengeRetentionDays) || authChallengeRetentionDays < 1) {
  console.error("SNAPHOOD_AUTH_CHALLENGE_RETENTION_DAYS must be a positive number.");
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl, max: 1 });

try {
  const sessionCount = await countExpiredSessions();
  const challengeCount = await countRetiredChallenges();
  const staleDraftCount = await countStaleDrafts();

  const result = {
    ok: true,
    dryRun,
    retention: {
      authChallengeDays: authChallengeRetentionDays,
      staleDraftDays
    },
    candidates: {
      expiredSessions: Number(sessionCount),
      retiredAuthChallenges: Number(challengeCount),
      staleDrafts: Number(staleDraftCount)
    },
    deleted: {
      expiredSessions: 0,
      retiredAuthChallenges: 0,
      staleDrafts: 0
    }
  };

  if (!dryRun) {
    result.deleted.expiredSessions = await deleteExpiredSessions();
    result.deleted.retiredAuthChallenges = await deleteRetiredChallenges();
    result.deleted.staleDrafts = await deleteStaleDrafts();
  }

  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => undefined);
}

async function countExpiredSessions() {
  const result = await pool.query("select count(*)::int as count from snaphood_sessions where expires_at < now()");
  return result.rows[0].count;
}

async function deleteExpiredSessions() {
  const result = await pool.query("delete from snaphood_sessions where expires_at < now()");
  return result.rowCount ?? 0;
}

async function countRetiredChallenges() {
  const result = await pool.query(
    `
      select count(*)::int as count
      from snaphood_auth_challenges
      where expires_at < now() - ($1::text || ' days')::interval
         or (used_at is not null and used_at < now() - ($1::text || ' days')::interval)
    `,
    [authChallengeRetentionDays]
  );
  return result.rows[0].count;
}

async function deleteRetiredChallenges() {
  const result = await pool.query(
    `
      delete from snaphood_auth_challenges
      where expires_at < now() - ($1::text || ' days')::interval
         or (used_at is not null and used_at < now() - ($1::text || ' days')::interval)
    `,
    [authChallengeRetentionDays]
  );
  return result.rowCount ?? 0;
}

async function countStaleDrafts() {
  const result = await pool.query(
    `
      select count(*)::int as count
      from snaphood_token_drafts
      where status = 'draft'
        and updated_at < now() - ($1::text || ' days')::interval
    `,
    [staleDraftDays]
  );
  return result.rows[0].count;
}

async function deleteStaleDrafts() {
  const result = await pool.query(
    `
      delete from snaphood_token_drafts
      where status = 'draft'
        and updated_at < now() - ($1::text || ' days')::interval
    `,
    [staleDraftDays]
  );
  return result.rowCount ?? 0;
}

function readBoolean(name, fallback) {
  const prefix = `--${name}=`;
  const arg = process.argv.slice(2).find((value) => value.startsWith(prefix));
  if (!arg) return fallback;
  const value = arg.slice(prefix.length).trim().toLowerCase();
  return !["false", "0", "no"].includes(value);
}
