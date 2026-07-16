import { env } from "@/lib/env";
import type { TokenDraft, Tokenomics } from "@/lib/types";

type GeneratedDraft = Pick<TokenDraft, "name" | "ticker" | "description" | "tokenomics"> & {
  promptSummary: string;
};

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

function normalizeDraft(input: Partial<GeneratedDraft>): GeneratedDraft {
  const ticker = String(input.ticker ?? "SNAP")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 6);

  const tokenomics = normalizeTokenomics(input.tokenomics);

  return {
    name: String(input.name ?? "SnapHood Original").slice(0, 64),
    ticker: ticker.length >= 3 ? ticker : "SNAP",
    description: String(input.description ?? "A camera-born meme token for fun on Robinhood Chain.").slice(0, 800),
    promptSummary: String(input.promptSummary ?? "Uploaded image converted into meme token metadata.").slice(0, 300),
    tokenomics
  };
}

function normalizeTokenomics(input: unknown): Tokenomics {
  const value = input && typeof input === "object" ? (input as Partial<Tokenomics>) : {};
  const allocation = Array.isArray(value.allocation)
    ? value.allocation
        .map((row) => ({
          label: String(row.label ?? "Community"),
          percent: parsePercent(row.percent)
        }))
        .filter((row) => row.label && Number.isFinite(row.percent))
        .slice(0, 6)
    : [];
  const allocationTotal = allocation.reduce((sum, row) => sum + row.percent, 0);
  const usableAllocation = allocation.length > 0 && Math.abs(allocationTotal - 100) < 0.01;

  return {
    supply: String(value.supply ?? env.defaultTokenSupply),
    decimals: Number(value.decimals ?? env.defaultTokenDecimals),
    allocation: usableAllocation
      ? allocation
      : [
          { label: "Community memes", percent: 45 },
          { label: "Liquidity seed", percent: 30 },
          { label: "Creator vault", percent: 15 },
          { label: "Airdrops", percent: 10 }
        ],
    notes: Array.isArray(value.notes)
      ? value.notes.map((note) => String(note)).slice(0, 5)
      : ["Fixed-supply demo token.", "No investment promises.", "Made for fun and test launches."]
  };
}

function parsePercent(input: unknown) {
  if (typeof input === "number") {
    return input;
  }

  if (typeof input === "string") {
    const parsed = Number.parseFloat(input.replace("%", ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
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
      allocation: [
        { label: "Community memes", percent: 45 },
        { label: "Liquidity seed", percent: 30 },
        { label: "Creator vault", percent: 15 },
        { label: "Airdrops", percent: 10 }
      ],
      notes: ["Fixed supply.", "No transfer tax.", "No implied investment value."]
    }
  };
}

function titleCase(value: string) {
  return value.replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}
