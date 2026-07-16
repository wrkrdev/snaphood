import { NextResponse } from "next/server";
import { hasDatabase } from "@/lib/db";
import { getReadiness } from "@/lib/env";
import { applyRateLimit } from "@/lib/rate-limit";
import { hasWrkrStorageCli, pingRedis } from "@/lib/runtime-readiness";

export async function GET(request: Request) {
  const limited = await applyRateLimit(request, {
    name: "health:ip",
    limit: 60,
    windowSeconds: 60
  });
  if (limited) return limited;

  const readiness = getReadiness();
  const [databaseReachable, cacheReachable, storageCliAvailable] = await Promise.all([
    hasDatabase(),
    pingRedis(),
    hasWrkrStorageCli()
  ]);
  const ok =
    databaseReachable &&
    (!readiness.cache || cacheReachable) &&
    (!readiness.storage || storageCliAvailable);

  return NextResponse.json({
    ok,
    app: "snaphood",
    readiness: {
      ...readiness,
      databaseReachable,
      cacheReachable,
      storageCliAvailable
    }
  });
}
