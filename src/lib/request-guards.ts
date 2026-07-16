import { NextResponse } from "next/server";
import { env } from "@/lib/env";

export function rejectCrossOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const expectedOrigin = expectedOriginFor(request);

  if (origin && origin !== expectedOrigin) {
    return NextResponse.json({ error: "Cross-origin requests are not allowed." }, { status: 403 });
  }

  if (!origin && referer) {
    try {
      if (new URL(referer).origin !== expectedOrigin) {
        return NextResponse.json({ error: "Cross-origin requests are not allowed." }, { status: 403 });
      }
    } catch {
      return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
    }
  }

  return null;
}

export async function readJsonBody(request: Request) {
  try {
    return { ok: true as const, body: await request.json() as unknown };
  } catch {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 })
    };
  }
}

export async function readOptionalJsonBody(request: Request) {
  const text = await request.text();
  if (!text.trim()) {
    return { ok: true as const, body: {} as unknown };
  }

  try {
    return { ok: true as const, body: JSON.parse(text) as unknown };
  } catch {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 })
    };
  }
}

function expectedOriginFor(request: Request) {
  const appOrigin = safeOrigin(env.appUrl);
  if (appOrigin) return appOrigin;

  return new URL(request.url).origin;
}

function safeOrigin(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}
