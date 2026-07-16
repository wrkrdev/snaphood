import { NextResponse } from "next/server";
import { listLaunchedCoins, type CoinFeedCursor } from "@/lib/coins";

const publicFeedCacheHeaders = {
  "Cache-Control": "public, max-age=15, stale-while-revalidate=45"
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseBoundedInteger(searchParams.get("limit"), 30, 1, 100);
    const chainId = parseOptionalInteger(searchParams.get("chainId"));
    const search = parseSearch(searchParams.get("query") ?? searchParams.get("q"));
    const tradableOnly = parseBoolean(searchParams.get("tradable"));
    const cursor = parseCursor(searchParams.get("cursor"));
    const page = await listLaunchedCoins(limit + 1, { chainId, query: search, tradableOnly, cursor });
    const coins = page.slice(0, limit);
    const lastCoin = coins.at(-1);
    const hasMore = page.length > limit;

    return NextResponse.json(
      {
        coins,
        filters: {
          chainId: chainId ?? null,
          limit,
          query: search,
          tradable: tradableOnly
        },
        pagination: {
          hasMore,
          nextCursor: hasMore && lastCoin ? encodeCursor({ id: lastCoin.id, updatedAt: lastCoin.updatedAt }) : null
        }
      },
      {
        headers: publicFeedCacheHeaders
      }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load launched coins.", coins: [] },
      { status: error instanceof InvalidCursorError ? 400 : 500 }
    );
  }
}

class InvalidCursorError extends Error {}

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

function parseCursor(value: string | null): CoinFeedCursor | undefined {
  if (!value) return undefined;

  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<CoinFeedCursor>;
    if (!decoded.id || !decoded.updatedAt || Number.isNaN(new Date(decoded.updatedAt).getTime())) {
      throw new InvalidCursorError("Invalid cursor payload.");
    }

    return {
      id: decoded.id,
      updatedAt: decoded.updatedAt
    };
  } catch {
    throw new InvalidCursorError("Invalid feed cursor.");
  }
}

function encodeCursor(cursor: CoinFeedCursor) {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}
