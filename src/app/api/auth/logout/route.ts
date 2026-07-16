import { NextResponse } from "next/server";
import { clearSession } from "@/lib/auth";
import { rejectCrossOrigin } from "@/lib/request-guards";

export async function POST(request: Request) {
  const blocked = rejectCrossOrigin(request);
  if (blocked) return blocked;

  const result = await clearSession();
  return NextResponse.json({ ok: true, ...result });
}
