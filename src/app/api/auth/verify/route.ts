import { NextResponse } from "next/server";
import { verifyMagicLink } from "@/lib/auth";
import { env } from "@/lib/env";
import { applyRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const appUrl = env.appUrl.replace(/\/$/, "");

  // Magic-link tokens are single-use secrets; cap verification attempts per IP so
  // the link cannot be brute-forced or replayed in a tight loop.
  const limited = await applyRateLimit(request, {
    name: "auth:verify:ip",
    limit: 20,
    windowSeconds: 10 * 60
  });
  if (limited) {
    return NextResponse.redirect(`${appUrl}/?auth=throttled`);
  }

  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return NextResponse.redirect(`${appUrl}/?auth=missing`);
  }

  const user = await verifyMagicLink(token);
  if (!user) {
    return NextResponse.redirect(`${appUrl}/?auth=expired`);
  }

  return NextResponse.redirect(`${appUrl}/?auth=verified`);
}
