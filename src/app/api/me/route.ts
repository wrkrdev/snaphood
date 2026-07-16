import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isAdminEmail } from "@/lib/env";

export async function GET() {
  try {
    const user = await getCurrentUser();
    return NextResponse.json({
      user: user ? { ...user, isAdmin: isAdminEmail(user.email) } : null
    });
  } catch {
    return NextResponse.json({ user: null });
  }
}
