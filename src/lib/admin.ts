import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isAdminEmail } from "@/lib/env";

export async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user) {
    return { response: NextResponse.json({ error: "Sign in as an admin." }, { status: 401 }) };
  }

  if (!isAdminEmail(user.email)) {
    return { response: NextResponse.json({ error: "Admin access is required." }, { status: 403 }) };
  }

  return { user };
}
