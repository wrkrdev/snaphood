import { NextResponse } from "next/server";
import { listLaunchedCoins } from "@/lib/coins";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseBoundedInteger(searchParams.get("limit"), 30, 1, 100);
    const chainId = parseOptionalInteger(searchParams.get("chainId"));
    const search = parseSearch(searchParams.get("query") ?? searchParams.get("q"));
    const tradableOnly = parseBoolean(searchParams.get("tradable"));
    const coins = await listLaunchedCoins(limit, { chainId, query: search, tradableOnly });
    return NextResponse.json({
      coins,
      filters: {
        chainId: chainId ?? null,
        limit,
        query: search,
        tradable: tradableOnly
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load launched coins.", coins: [] },
      { status: 500 }
    );
  }
}

function parseBoundedInteger(value: string | null, fallback: number, min: number, max: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function parseOptionalInteger(value: string | null) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function parseSearch(value: string | null) {
  const normalized = value?.trim().slice(0, 80);
  return normalized || undefined;
}

function parseBoolean(value: string | null) {
  return value === "true" || value === "1";
}
