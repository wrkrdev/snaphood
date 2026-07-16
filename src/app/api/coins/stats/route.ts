import { NextResponse } from "next/server";
import { getLaunchpadStats } from "@/lib/coins";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const chainId = parseOptionalInteger(searchParams.get("chainId"));
    const stats = await getLaunchpadStats({ chainId });
    return NextResponse.json(
      { stats },
      {
        headers: {
          "Cache-Control": "public, max-age=15, stale-while-revalidate=45"
        }
      }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load launchpad stats." },
      { status: 500 }
    );
  }
}

function parseOptionalInteger(value: string | null) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : undefined;
}
