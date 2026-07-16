import { NextResponse } from "next/server";
import { clearSession } from "@/lib/auth";
import { applyRateLimit } from "@/lib/rate-limit";
import { rejectCrossOrigin } from "@/lib/request-guards";

export async function POST(request: Request) {
  const blocked = rejectCrossOrigin(request);
  if (blocked) return blocked;

  const limited = await applyRateLimit(request, {
    name: "auth:logout:ip",
    limit: 30,
    windowSeconds: 5 * 60
  });
  if (limited) return limited;

  const result = await clearSession();
  return NextResponse.json({ ok: true, ...result });
}
