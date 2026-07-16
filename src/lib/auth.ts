import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { cookies } from "next/headers";
import { query, withTransaction } from "@/lib/db";
import { env } from "@/lib/env";

const cookieName = "snaphood_session";
const execFileAsync = promisify(execFile);

type AuthChallengeRow = {
  id: string;
  email: string;
  expires_at: Date;
};

function sign(value: string) {
  return createHmac("sha256", env.sessionSecret).update(value).digest("base64url");
}

function packSession(id: string) {
  return `${id}.${sign(id)}`;
}

function unpackSession(value: string | undefined) {
  if (!value) {
    return null;
  }

  const [id, signature] = value.split(".");
  if (!id || !signature) {
    return null;
  }

  const expected = sign(id);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return null;
  }

  return id;
}

export async function createSession(email: string) {
  const userId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const normalizedEmail = email.trim().toLowerCase();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);

  const user = await query<{ id: string; email: string }>(
    `
      insert into snaphood_users (id, email)
      values ($1, $2)
      on conflict (email) do update set email = excluded.email
      returning id, email
    `,
    [userId, normalizedEmail]
  );

  await query(
    `
      insert into snaphood_sessions (id, user_id, expires_at)
      values ($1, $2, $3)
    `,
    [sessionId, user.rows[0].id, expiresAt]
  );

  const jar = await cookies();
  jar.set(cookieName, packSession(sessionId), {
    httpOnly: true,
    sameSite: "lax",
    secure: env.appUrl.startsWith("https://"),
    path: "/",
    expires: expiresAt
  });

  return user.rows[0];
}

export async function createMagicLink(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + env.authMagicLinkTtlMinutes * 60 * 1000);

  await withTransaction(async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
      `snaphood-auth-challenge:${normalizedEmail}`
    ]);

    await client.query(
      `
        update snaphood_auth_challenges
        set used_at = now()
        where email = $1
          and used_at is null
          and expires_at > now()
      `,
      [normalizedEmail]
    );

    await client.query(
      `
        insert into snaphood_auth_challenges (id, email, token_hash, expires_at)
        values ($1, $2, $3, $4)
      `,
      [id, normalizedEmail, tokenHash, expiresAt]
    );
  });

  return {
    email: normalizedEmail,
    token,
    expiresAt,
    url: `${env.appUrl.replace(/\/$/, "")}/api/auth/verify?token=${encodeURIComponent(token)}`
  };
}

export async function sendMagicLink(input: { email: string; url: string; expiresAt: Date }) {
  const subject = "Sign in to SnapHood";
  const text = [
    "Open this link to sign in to SnapHood:",
    "",
    input.url,
    "",
    `This link expires at ${input.expiresAt.toISOString()}.`,
    "If you did not request it, ignore this email."
  ].join("\n");
  if (env.authEmailMode !== "wrkr") {
    return {
      mode: "dry-run",
      delivered: false
    };
  }

  const args = [
    "email",
    "send",
    "--to",
    input.email,
    "--subject",
    subject,
    "--text",
    text,
    "--idempotency-key",
    `snaphood-auth-${hashToken(input.url).slice(0, 24)}`,
    "--json"
  ];

  if (env.authEmailFrom) {
    args.push("--from", env.authEmailFrom);
  }

  await execFileAsync("wrkr", args, { timeout: 30_000 });

  return {
    mode: "wrkr",
    delivered: true
  };
}

export async function verifyMagicLink(token: string) {
  const tokenHash = hashToken(token);
  const result = await query<AuthChallengeRow>(
    `
      update snaphood_auth_challenges
      set used_at = now()
      where token_hash = $1
        and used_at is null
        and expires_at > now()
      returning id, email, expires_at
    `,
    [tokenHash]
  );

  const challenge = result.rows[0];
  if (!challenge) {
    return null;
  }

  return createSession(challenge.email);
}

export async function clearSession() {
  const jar = await cookies();
  const sessionId = unpackSession(jar.get(cookieName)?.value);
  let revoked = false;

  if (sessionId) {
    const result = await query("delete from snaphood_sessions where id = $1", [sessionId]);
    revoked = (result.rowCount ?? 0) > 0;
  }

  jar.set(cookieName, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: env.appUrl.startsWith("https://"),
    path: "/",
    expires: new Date(0)
  });

  return { revoked };
}

export async function getCurrentUser() {
  const jar = await cookies();
  const sessionId = unpackSession(jar.get(cookieName)?.value);
  if (!sessionId) {
    return null;
  }

  const result = await query<{ id: string; email: string }>(
    `
      select u.id, u.email
      from snaphood_sessions s
      join snaphood_users u on u.id = s.user_id
      where s.id = $1 and s.expires_at > now()
      limit 1
    `,
    [sessionId]
  );

  return result.rows[0] ?? null;
}

function hashToken(token: string) {
  return createHash("sha256").update(`${env.sessionSecret}:${token}`).digest("hex");
}
