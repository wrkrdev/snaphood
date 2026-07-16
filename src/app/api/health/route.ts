import { NextResponse } from "next/server";
import { hasDatabase } from "@/lib/db";
import { getReadiness } from "@/lib/env";

export async function GET() {
  const readiness = getReadiness();
  const databaseReachable = await hasDatabase();

  return NextResponse.json({
    ok: databaseReachable,
    app: "snaphood",
    readiness: {
      ...readiness,
      databaseReachable
    }
  });
}
