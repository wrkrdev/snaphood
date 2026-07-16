import { env } from "@/lib/env";
import type { TokenDraft, Tokenomics } from "@/lib/types";
import { z } from "zod";

type GeneratedDraft = Pick<TokenDraft, "name" | "ticker" | "description" | "tokenomics"> & {
  promptSummary: string;
};

const fallbackAllocation = [
  { label: "Community memes", percent: 45 },
  { label: "Liquidity seed", percent: 30 },
  { label: "Creator vault", percent: 15 },
  { label: "Airdrops", percent: 10 }
];

const fallbackNotes = ["Fixed supply.", "No transfer tax.", "No implied investment value."];

const rawDraftSchema = z.object({
  name: z.unknown().optional(),
  ticker: z.unknown().optional(),
  description: z.unknown().optional(),
  promptSummary: z.unknown().optional(),
  tokenomics: z.unknown().optional()
});

const tokenomicsSchema = z.object({
  supply: z.coerce
    .string()
    .trim()
    .regex(/^(\d+|\d{1,3}(,\d{3})+)$/)
    .catch(env.defaultTokenSupply),
  decimals: z.coerce.number().int().min(0).max(36).catch(env.defaultTokenDecimals),
  allocation: z
    .preprocess(
      // Models label allocation fields inconsistently (category/percentage/share/name);
      // map the common aliases onto {label, percent} so the AI's split survives instead
      // of being silently replaced by the default.
      (value) =>
        Array.isArray(value)
          ? value.map((row) => {
              const record = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
              return {
                label: record.label ?? record.category ?? record.name ?? record.bucket ?? record.slice,
                percent: record.percent ?? record.percentage ?? record.share ?? record.allocation ?? record.pct
              };
            })
          : value,
      z.array(
        z.object({
          label: z.coerce.string().trim().min(1).max(60),
          percent: z.coerce.number().min(0).max(100)
        })
      ).max(6)
    )
    .catch(fallbackAllocation),
  notes: z.array(z.coerce.string().trim().min(1).max(160)).max(5).catch(fallbackNotes)
});

const prohibitedPromisePattern =
  /\b(guaranteed|risk[-\s]?free|investment|profit|returns?|moonshot|pump|100x|1000x|financial advice)\b/gi;

export async function generateDraftFromImage(file: File): Promise<GeneratedDraft> {
  if (!env.llmApiKey) {
    return fallbackDraft(file.name);
  }

  try {
    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const dataUrl = `data:${file.type || "image/jpeg"};base64,${base64}`;
    const response = await fetch(`${env.llmBaseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.llmApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: env.llmModel,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You generate playful meme coin launch metadata from an image. Return only JSON with name, ticker, description, promptSummary, tokenomics. Ticker must be 3-6 uppercase letters. Avoid investment promises."
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  "Analyze this image and make a funny, harmless meme token concept for Robinhood Chain. Tokenomics must include supply, decimals, allocation array, and notes array."
              },
              {
                type: "image_url",
                image_url: { url: dataUrl }
              }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`AI request failed with ${response.status}`);
    }

    const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("AI response did not include content");
    }

    return normalizeDraft(JSON.parse(content));
  } catch {
    return fallbackDraft(file.name);
  }
}

export function buildGeneratedImageUrls(originalImageUrl: string) {
  return {
    profileImageUrl: originalImageUrl,
    bannerImageUrl: originalImageUrl
  };
}

export async function generateBrandImages(draft: GeneratedDraft, originalImageUrl: string, sourceFile?: File) {
  if (!env.falKey) {
    return buildGeneratedImageUrls(originalImageUrl);
  }

  const sourceImageUrl = await getFalSourceImageUrl(sourceFile, originalImageUrl);
  const [profile, banner] = await Promise.allSettled([
    generateFalImageEdit(
      [
        `Transform the uploaded image into a playful meme coin profile avatar for ${draft.name}, ticker ${draft.ticker}.`,
        "Keep the original snap immediately recognizable: preserve the main subject, pose, silhouette, and strongest color cues.",
        `Meme angle: ${draft.promptSummary}.`,
        "Add community-launch energy with expressive sticker-like styling, crisp lighting, fun props only when they fit the source image, and a green/black/white app palette.",
        "No official logos, no readable text, no ticker letters, no price claims."
      ].join(" "),
      sourceImageUrl,
      "1:1"
    ),
    generateFalImageEdit(
      [
        `Remix the uploaded image into a wide social banner for the meme token ${draft.name}, ticker ${draft.ticker}.`,
        "The original snap must remain the hero image and should be clearly recognizable.",
        `Meme angle: ${draft.promptSummary}.`,
        "Extend the scene into a playful community launch moment with confetti, sticker energy, subtle trading-app shapes, and open space for UI overlay.",
        "Use a green/black/white accent palette. No official logos, no readable text, no ticker letters, no price claims."
      ].join(" "),
      sourceImageUrl,
      "16:9"
    )
  ]);

  return {
    profileImageUrl: profile.status === "fulfilled" ? profile.value : originalImageUrl,
    bannerImageUrl: banner.status === "fulfilled" ? banner.value : originalImageUrl
  };
}

async function getFalSourceImageUrl(sourceFile: File | undefined, originalImageUrl: string) {
  if (!sourceFile) return originalImageUrl;

  const { fal } = await import("@fal-ai/client");
  fal.config({ credentials: env.falKey });

  try {
    return await fal.storage.upload(sourceFile);
  } catch {
    return originalImageUrl;
  }
}

async function generateFalImageEdit(prompt: string, imageUrl: string, resolutionMode: "1:1" | "16:9") {
  const { fal } = await import("@fal-ai/client");
  fal.config({ credentials: env.falKey });

  const result = await fal.subscribe(env.falImageEditModel, {
    input: {
      prompt,
      image_url: imageUrl,
      num_inference_steps: 20,
      guidance_scale: 2.5,
      num_images: 1,
      enable_safety_checker: true,
      output_format: "jpeg",
      acceleration: "none",
      resolution_mode: resolutionMode
    },
    logs: false
  });

  const generatedImageUrl = (result.data as { images?: Array<{ url?: string }> }).images?.[0]?.url;
  if (!generatedImageUrl) {
    throw new Error("Fal did not return an edited image URL.");
  }

  return generatedImageUrl;
}

async function generateFalImage(prompt: string, imageSize: { width: number; height: number }) {
  const { fal } = await import("@fal-ai/client");
  fal.config({ credentials: env.falKey });

  const result = await fal.subscribe(env.falImageModel, {
    input: {
      prompt,
      image_size: imageSize,
      num_inference_steps: 4,
      guidance_scale: 3.5,
      num_images: 1,
      enable_safety_checker: true,
      output_format: "jpeg",
      acceleration: "none"
    },
    logs: false
  });

  const imageUrl = (result.data as { images?: Array<{ url?: string }> }).images?.[0]?.url;
  if (!imageUrl) {
    throw new Error("Fal did not return an image URL.");
  }

  return imageUrl;
}

export function normalizeDraft(input: unknown): GeneratedDraft {
  const parsed = rawDraftSchema.catch({}).parse(input ?? {});
  const ticker = coerceText(parsed.ticker, "SNAP", 32)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);

  const tokenomics = normalizeTokenomics(parsed.tokenomics);

  return {
    name: coerceText(parsed.name, "SnapHood Original", 64, 2),
    ticker: ticker.length >= 3 ? ticker : "SNAP",
    description: sanitizeMarketingCopy(
      coerceText(parsed.description, "A camera-born meme token for fun on Robinhood Chain.", 800, 20)
    ),
    promptSummary: sanitizeMarketingCopy(
      coerceText(parsed.promptSummary, "Uploaded image converted into meme token metadata.", 300)
    ),
    tokenomics
  };
}

function normalizeTokenomics(input: unknown): Tokenomics {
  const value = tokenomicsSchema.catch({
    supply: env.defaultTokenSupply,
    decimals: env.defaultTokenDecimals,
    allocation: fallbackAllocation,
    notes: fallbackNotes
  }).parse(input ?? {});
  const allocation = value.allocation
    .map((row) => ({
      label: sanitizeMarketingCopy(row.label).slice(0, 60) || "Community",
      percent: Number(row.percent)
    }))
    .filter((row) => row.label && Number.isFinite(row.percent))
    .slice(0, 6);
  const allocationTotal = allocation.reduce((sum, row) => sum + row.percent, 0);
  const usableAllocation = allocation.length > 0 && Math.abs(allocationTotal - 100) < 0.01;

  return {
    supply: value.supply,
    decimals: value.decimals,
    allocation: usableAllocation ? allocation : fallbackAllocation,
    notes: value.notes.map((note) => sanitizeMarketingCopy(note)).filter(Boolean).slice(0, 5)
  };
}

function fallbackDraft(fileName: string): GeneratedDraft {
  const base = fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim();
  const seed = base || "Camera Chaos";
  const words = seed.split(/\s+/).filter(Boolean);
  const name = words.length ? `${titleCase(words.slice(0, 3).join(" "))} Coin` : "SnapHood Coin";
  const ticker = words
    .map((word) => word[0])
    .join("")
    .toUpperCase()
    .padEnd(4, "H")
    .slice(0, 6);

  return {
    name,
    ticker,
    description:
      "A just-for-fun meme token generated from an uploaded photo. Snap it, name it, tune the launch details, and deploy a fixed-supply token on Robinhood Chain testnet.",
    promptSummary: "Demo fallback generated metadata because no AI key is configured.",
    tokenomics: {
      supply: env.defaultTokenSupply,
      decimals: env.defaultTokenDecimals,
      allocation: fallbackAllocation,
      notes: fallbackNotes
    }
  };
}

function titleCase(value: string) {
  return value.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

function sanitizeMarketingCopy(value: string) {
  return value.replace(prohibitedPromisePattern, "meme").replace(/\s+/g, " ").trim();
}

function coerceText(value: unknown, fallback: string, maxLength: number, minLength = 1) {
  const text = typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value).trim() : "";
  if (text.length < minLength) return fallback;
  return text.slice(0, maxLength);
}
