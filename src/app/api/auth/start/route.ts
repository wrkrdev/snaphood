import { NextResponse } from "next/server";
import { z } from "zod";
import { createSession } from "@/lib/auth";
import { applyRateLimit } from "@/lib/rate-limit";

const schema = z.object({
  email: z.string().email()
});

export async function POST(request: Request) {
  const limited = await applyRateLimit(request, {
    name: "auth:start:ip",
    limit: 12,
    windowSeconds: 10 * 60
  });
  if (limited) return limited;

  const body = schema.safeParse(await request.json());
  if (!body.success) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  try {
    const user = await createSession(body.data.email);
    return NextResponse.json({ user });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not start session." },
      { status: 500 }
    );
  }
}
