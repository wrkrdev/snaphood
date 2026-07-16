import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isAdminEmail } from "@/lib/env";
import { applyRateLimit } from "@/lib/rate-limit";

export async function GET(request: Request) {
  const limited = await applyRateLimit(request, {
    name: "me:session:ip",
    limit: 180,
    windowSeconds: 60
  });
  if (limited) return limited;

  try {
    const user = await getCurrentUser();
    return NextResponse.json({
      user: user ? { ...user, isAdmin: isAdminEmail(user.email) } : null
    });
  } catch {
    return NextResponse.json({ user: null });
  }
}
