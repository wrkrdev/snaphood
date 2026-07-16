import { execFile } from "child_process";
import { promisify } from "util";
import Redis from "ioredis";
import { env } from "@/lib/env";

const execFileAsync = promisify(execFile);

export async function pingRedis() {
  if (!env.redisUrl) {
    return false;
  }

  const redis = new Redis(env.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false,
    connectTimeout: 1_500,
    commandTimeout: 1_500
  });

  try {
    await redis.connect();
    return (await redis.ping()) === "PONG";
  } catch {
    return false;
  } finally {
    redis.disconnect();
  }
}

export async function hasWrkrStorageCli() {
  if (!env.wrkrStorageEnabled) {
    return false;
  }

  try {
    await execFileAsync("wrkr", ["storage", "--help"], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}
