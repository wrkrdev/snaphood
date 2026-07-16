import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listUserDrafts } from "@/lib/drafts";
import { applyRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to view drafts." }, { status: 401 });
  }

  const limited = await applyRateLimit(request, {
    name: "me:drafts:user",
    limit: 120,
    windowSeconds: 60,
    identity: user.id
  });
  if (limited) return limited;

  const drafts = await listUserDrafts(user.id);
  return NextResponse.json(
    { drafts },
    {
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
