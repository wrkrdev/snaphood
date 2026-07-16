import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { query } from "@/lib/db";
import { env } from "@/lib/env";

const cookieName = "snaphood_session";

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

export async function clearSession() {
  const jar = await cookies();
  jar.set(cookieName, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: env.appUrl.startsWith("https://"),
    path: "/",
    expires: new Date(0)
  });
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
