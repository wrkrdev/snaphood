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
    .array(
      z.object({
        label: z.coerce.string().trim().min(1).max(60),
        percent: z.coerce.number().min(0).max(100)
      })
    )
    .max(6)
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

export async function generateBrandImages(draft: GeneratedDraft, originalImageUrl: string) {
  if (!env.falKey) {
    return buildGeneratedImageUrls(originalImageUrl);
  }

  const [profile, banner] = await Promise.allSettled([
    generateFalImage(
      [
        `A circular meme coin profile avatar for ${draft.name} with ticker ${draft.ticker}.`,
        `Inspired by: ${draft.promptSummary}.`,
        "Bold centered subject, Robinhood-inspired green and black accent palette, clean vector-poster energy, no official logos, no small text, no price claims."
      ].join(" "),
      { width: 512, height: 512 }
    ),
    generateFalImage(
      [
        `A wide social banner for the meme token ${draft.name}, ticker ${draft.ticker}.`,
        `Inspired by: ${draft.promptSummary}.`,
        "Energetic brokerage-app style, green/black/white palette, playful but polished, room for UI text overlay, no official logos, no price claims."
      ].join(" "),
      { width: 768, height: 432 }
    )
  ]);

  return {
    profileImageUrl: profile.status === "fulfilled" ? profile.value : originalImageUrl,
    bannerImageUrl: banner.status === "fulfilled" ? banner.value : originalImageUrl
  };
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
