import { query } from "@/lib/db";
import type { LaunchedCoin } from "@/lib/types";

type CoinRow = {
  id: string;
  name: string;
  ticker: string;
  description: string;
  original_image_url: string;
  profile_image_url: string;
  banner_image_url: string;
  tokenomics: unknown;
  contract_address: string;
  tx_hash: string;
  chain_id: number;
  status: string;
  created_at: Date;
  updated_at: Date;
  pool_address: string | null;
  position_id: string | null;
  fee_tier: number | null;
  liquidity_token_amount: string | null;
  liquidity_eth_amount: string | null;
  liquidity_tx_hash: string | null;
  swap_tx_hash: string | null;
  dexscreener_url: string | null;
  dexscreener_pair: Record<string, unknown> | null;
  dexscreener_synced_at: Date | null;
};

export async function listLaunchedCoins(limit = 30) {
  const result = await query<CoinRow>(
    `
      select d.id,
             d.name,
             d.ticker,
             d.description,
             d.original_image_url,
             d.profile_image_url,
             d.banner_image_url,
             d.tokenomics,
             d.contract_address,
             d.tx_hash,
             d.chain_id,
             d.status,
             d.created_at,
             d.updated_at,
             t.pool_address,
             t.position_id,
             t.fee_tier,
             t.liquidity_token_amount,
             t.liquidity_eth_amount,
             t.liquidity_tx_hash,
             t.swap_tx_hash,
             t.dexscreener_url,
             t.dexscreener_pair,
             t.dexscreener_synced_at
      from snaphood_token_drafts d
      left join snaphood_token_trading t on t.draft_id = d.id
      where d.status = 'launched'
        and d.contract_address is not null
        and d.chain_id = 4663
      order by d.updated_at desc
      limit $1
    `,
    [limit]
  );

  return result.rows.map(mapCoinRow);
}

export async function getLaunchedCoin(contractOrId: string) {
  const result = await query<CoinRow>(
    `
      select d.id,
             d.name,
             d.ticker,
             d.description,
             d.original_image_url,
             d.profile_image_url,
             d.banner_image_url,
             d.tokenomics,
             d.contract_address,
             d.tx_hash,
             d.chain_id,
             d.status,
             d.created_at,
             d.updated_at,
             t.pool_address,
             t.position_id,
             t.fee_tier,
             t.liquidity_token_amount,
             t.liquidity_eth_amount,
             t.liquidity_tx_hash,
             t.swap_tx_hash,
             t.dexscreener_url,
             t.dexscreener_pair,
             t.dexscreener_synced_at
      from snaphood_token_drafts d
      left join snaphood_token_trading t on t.draft_id = d.id
      where d.status = 'launched'
        and d.contract_address is not null
        and (lower(d.contract_address) = lower($1) or d.id = $1)
      limit 1
    `,
    [contractOrId]
  );

  const row = result.rows[0];
  return row ? mapCoinRow(row) : null;
}

export function mapCoinRow(row: CoinRow): LaunchedCoin {
  const explorerBase = row.chain_id === 4663 ? "https://robinhoodchain.blockscout.com" : "";
  const dexscreenerPair = row.dexscreener_pair ?? undefined;

  return {
    id: row.id,
    name: row.name,
    ticker: row.ticker,
    description: row.description,
    originalImageUrl: row.original_image_url,
    profileImageUrl: row.profile_image_url,
    bannerImageUrl: row.banner_image_url,
    tokenomics: row.tokenomics,
    contractAddress: row.contract_address,
    txHash: row.tx_hash,
    chainId: row.chain_id,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    explorerUrl: `${explorerBase}/address/${row.contract_address}`,
    txUrl: `${explorerBase}/tx/${row.tx_hash}`,
    poolAddress: row.pool_address ?? undefined,
    poolUrl: row.pool_address ? `${explorerBase}/address/${row.pool_address}` : undefined,
    positionId: row.position_id ?? undefined,
    feeTier: row.fee_tier ?? undefined,
    liquidityTokenAmount: row.liquidity_token_amount ?? undefined,
    liquidityEthAmount: row.liquidity_eth_amount ?? undefined,
    liquidityTxHash: row.liquidity_tx_hash ?? undefined,
    swapTxHash: row.swap_tx_hash ?? undefined,
    dexscreenerUrl: row.dexscreener_url ?? undefined,
    dexscreenerPair,
    dexscreenerSyncedAt: row.dexscreener_synced_at?.toISOString()
  };
}
