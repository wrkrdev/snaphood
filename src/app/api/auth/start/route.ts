import { NextResponse } from "next/server";
import { z } from "zod";
import { createMagicLink, createSession, sendMagicLink } from "@/lib/auth";
import { env, isAdminEmail } from "@/lib/env";
import { applyRateLimit } from "@/lib/rate-limit";
import { readJsonBody, rejectCrossOrigin } from "@/lib/request-guards";

const schema = z.object({
  email: z.string().email()
});

export async function POST(request: Request) {
  const blocked = rejectCrossOrigin(request);
  if (blocked) return blocked;

  const limited = await applyRateLimit(request, {
    name: "auth:start:ip",
    limit: 12,
    windowSeconds: 10 * 60
  });
  if (limited) return limited;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const body = schema.safeParse(json.body);
  if (!body.success) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  try {
    if (!env.demoAuthEnabled) {
      const magicLink = await createMagicLink(body.data.email);
      const delivery = await sendMagicLink(magicLink);

      return NextResponse.json({
        sent: true,
        email: magicLink.email,
        mode: delivery.mode,
        magicLink: delivery.mode === "dry-run" && process.env.NODE_ENV !== "production" ? magicLink.url : undefined
      });
    }

    const user = await createSession(body.data.email);
    return NextResponse.json({ user: { ...user, isAdmin: isAdminEmail(user.email) }, mode: "demo" });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not start session." },
      { status: 500 }
    );
  }
}
