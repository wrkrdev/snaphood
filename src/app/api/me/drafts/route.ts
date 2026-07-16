import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listUserDrafts } from "@/lib/drafts";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to view drafts." }, { status: 401 });
  }

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
