import { NextResponse } from "next/server";
import { verifyMagicLink } from "@/lib/auth";
import { env } from "@/lib/env";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const appUrl = env.appUrl.replace(/\/$/, "");

  if (!token) {
    return NextResponse.redirect(`${appUrl}/?auth=missing`);
  }

  const user = await verifyMagicLink(token);
  if (!user) {
    return NextResponse.redirect(`${appUrl}/?auth=expired`);
  }

  return NextResponse.redirect(`${appUrl}/?auth=verified`);
}
