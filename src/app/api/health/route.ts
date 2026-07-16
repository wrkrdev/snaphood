import { NextResponse } from "next/server";
import { hasDatabase } from "@/lib/db";
import { getReadiness } from "@/lib/env";
import { hasWrkrStorageCli, pingRedis } from "@/lib/runtime-readiness";

export async function GET() {
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
