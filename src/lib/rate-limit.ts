import { createHash } from "crypto";
import Redis from "ioredis";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";

type RateLimitOptions = {
  name: string;
  limit: number;
  windowSeconds: number;
  identity?: string;
};

type RateLimitResult = {
  limited: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
};

const memoryBuckets = new Map<string, { count: number; resetAt: number }>();
let redis: Redis | null = null;
let redisFailed = false;

export async function applyRateLimit(request: Request, options: RateLimitOptions) {
  const result = await checkRateLimit(request, options);
  if (!result.limited) {
    return null;
  }

  return NextResponse.json(
    {
      error: "Too many requests. Try again shortly.",
      retryAfterSeconds: result.resetSeconds
    },
    {
      status: 429,
      headers: rateLimitHeaders(result)
    }
  );
}

async function checkRateLimit(request: Request, options: RateLimitOptions): Promise<RateLimitResult> {
  const identity = options.identity ?? getClientIdentity(request);
  const key = `snaphood:rl:${options.name}:${hashIdentity(identity)}`;

  if (env.redisUrl && !redisFailed) {
    try {
      return await redisRateLimit(key, options.limit, options.windowSeconds);
    } catch (error) {
      redisFailed = true;
      console.warn("Redis rate limit unavailable; using memory fallback.", error);
    }
  }

  return memoryRateLimit(key, options.limit, options.windowSeconds);
}

async function redisRateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const client = await getRedis();
  const count = await client.incr(key);
  if (count === 1) {
    await client.expire(key, windowSeconds);
  }

  const ttl = await client.ttl(key);
  const resetSeconds = ttl > 0 ? ttl : windowSeconds;

  return {
    limited: count > limit,
    limit,
    remaining: Math.max(0, limit - count),
    resetSeconds
  };
}

function memoryRateLimit(key: string, limit: number, windowSeconds: number): RateLimitResult {
  const now = Date.now();
  const current = memoryBuckets.get(key);
  const resetAt = current && current.resetAt > now ? current.resetAt : now + windowSeconds * 1000;
  const count = current && current.resetAt > now ? current.count + 1 : 1;

  memoryBuckets.set(key, { count, resetAt });

  return {
    limited: count > limit,
    limit,
    remaining: Math.max(0, limit - count),
    resetSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000))
  };
}

async function getRedis() {
  if (!redis) {
    redis = new Redis(env.redisUrl, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      enableOfflineQueue: false
    });
  }

  if (redis.status === "wait" || redis.status === "end") {
    await redis.connect();
  }

  return redis;
}

function getClientIdentity(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  return forwarded || realIp || "local";
}

function hashIdentity(identity: string) {
  return createHash("sha256").update(identity.trim().toLowerCase()).digest("hex").slice(0, 32);
}

function rateLimitHeaders(result: RateLimitResult) {
  return {
    "Retry-After": String(result.resetSeconds),
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(result.resetSeconds)
  };
}
