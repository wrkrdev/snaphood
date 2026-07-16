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
