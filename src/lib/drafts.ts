import { query } from "@/lib/db";
import type { TokenDraft } from "@/lib/types";

type DraftRow = {
  id: string;
  name: string;
  ticker: string;
  description: string;
  prompt_summary: string | null;
  original_image_url: string;
  profile_image_url: string;
  banner_image_url: string;
  tokenomics: unknown;
  status: string;
  contract_address: string | null;
  tx_hash: string | null;
  chain_id: number | null;
  created_at: Date;
  updated_at: Date;
};

export async function listUserDrafts(userId: string, limit = 8) {
  const result = await query<DraftRow>(
    `
      select id,
             name,
             ticker,
             description,
             prompt_summary,
             original_image_url,
             profile_image_url,
             banner_image_url,
             tokenomics,
             status,
             contract_address,
             tx_hash,
             chain_id,
             created_at,
             updated_at
      from snaphood_token_drafts
      where user_id = $1
      order by updated_at desc
      limit $2
    `,
    [userId, limit]
  );

  return result.rows.map(mapTokenDraft);
}

export function mapTokenDraft(row: DraftRow | Record<string, unknown>): TokenDraft {
  return {
    id: String(row.id),
    name: String(row.name),
    ticker: String(row.ticker),
    description: String(row.description),
    promptSummary: row.prompt_summary ? String(row.prompt_summary) : undefined,
    originalImageUrl: String(row.original_image_url),
    profileImageUrl: String(row.profile_image_url),
    bannerImageUrl: String(row.banner_image_url),
    tokenomics: row.tokenomics as TokenDraft["tokenomics"],
    status: row.status as TokenDraft["status"],
    contractAddress: row.contract_address ? String(row.contract_address) : undefined,
    txHash: row.tx_hash ? String(row.tx_hash) : undefined,
    chainId: row.chain_id ? Number(row.chain_id) : undefined,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : stringifyOptional(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : stringifyOptional(row.updated_at)
  };
}

function stringifyOptional(value: unknown) {
  return value ? String(value) : undefined;
}
