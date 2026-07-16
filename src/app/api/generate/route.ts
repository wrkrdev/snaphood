import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { generateBrandImages, generateDraftFromImage } from "@/lib/ai";
import { query } from "@/lib/db";
import { applyRateLimit } from "@/lib/rate-limit";
import { rejectCrossOrigin } from "@/lib/request-guards";
import { saveRemoteImage, saveUpload } from "@/lib/storage";
import type { TokenDraft } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const blocked = rejectCrossOrigin(request);
  if (blocked) return blocked;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in before generating a token." }, { status: 401 });
  }

  const limited = await applyRateLimit(request, {
    name: "generate:user",
    limit: 10,
    windowSeconds: 60 * 60,
    identity: user.id
  });
  if (limited) return limited;

  const formData = await request.formData();
  const file = formData.get("image");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Upload an image file." }, { status: 400 });
  }

  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "Only image uploads are supported." }, { status: 400 });
  }

  if (file.size > 8 * 1024 * 1024) {
    return NextResponse.json({ error: "Image must be 8 MB or smaller." }, { status: 400 });
  }

  try {
    const [upload, generated] = await Promise.all([saveUpload(file), generateDraftFromImage(file)]);
    const images = await generateBrandImages(generated, upload.url);
    const [profileImage, bannerImage] = await Promise.all([
      saveRemoteImage(images.profileImageUrl, "generated").catch(() => ({ url: images.profileImageUrl })),
      saveRemoteImage(images.bannerImageUrl, "generated").catch(() => ({ url: images.bannerImageUrl }))
    ]);
    const id = crypto.randomUUID();

    const result = await query(
      `
        insert into snaphood_token_drafts (
          id, user_id, original_image_url, profile_image_url, banner_image_url,
          prompt_summary, name, ticker, description, tokenomics, status
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'draft')
        returning *
      `,
      [
        id,
        user.id,
        upload.url,
        profileImage.url,
        bannerImage.url,
        generated.promptSummary,
        generated.name,
        generated.ticker,
        generated.description,
        JSON.stringify(generated.tokenomics)
      ]
    );

    const draft = mapDraft(result.rows[0]);
    return NextResponse.json({ draft });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not generate token draft." },
      { status: 500 }
    );
  }
}

function mapDraft(row: Record<string, unknown>): TokenDraft {
  return {
    id: String(row.id),
    name: String(row.name),
    ticker: String(row.ticker),
    description: String(row.description),
    originalImageUrl: String(row.original_image_url),
    profileImageUrl: String(row.profile_image_url),
    bannerImageUrl: String(row.banner_image_url),
    tokenomics: row.tokenomics as TokenDraft["tokenomics"],
    status: row.status as TokenDraft["status"],
    contractAddress: row.contract_address ? String(row.contract_address) : undefined,
    txHash: row.tx_hash ? String(row.tx_hash) : undefined,
    chainId: row.chain_id ? Number(row.chain_id) : undefined
  };
}
