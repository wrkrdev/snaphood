import { query } from "@/lib/db";
import type { Tokenomics } from "@/lib/types";

export type AdminCoin = {
  id: string;
  name: string;
  ticker: string;
  contractAddress: string;
  chainId: number;
  tokenomics: Tokenomics;
  poolAddress: string | null;
};

type AdminCoinRow = {
  id: string;
  name: string;
  ticker: string;
  contract_address: string;
  chain_id: number;
  tokenomics: Tokenomics;
  pool_address: string | null;
};

export async function getAdminCoin(contract: string) {
  const result = await query<AdminCoinRow>(
    `
      select d.id,
             d.name,
             d.ticker,
             d.contract_address,
             d.chain_id,
             d.tokenomics,
             t.pool_address
      from snaphood_token_drafts d
      left join snaphood_token_trading t on t.draft_id = d.id
      where d.status = 'launched'
        and d.contract_address is not null
        and lower(d.contract_address) = lower($1)
      limit 1
    `,
    [contract]
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    id: row.id,
    name: row.name,
    ticker: row.ticker,
    contractAddress: row.contract_address,
    chainId: row.chain_id,
    tokenomics: row.tokenomics,
    poolAddress: row.pool_address
  };
}

export async function recordLiquidity(input: {
  draftId: string;
  contractAddress: string;
  chainId: number;
  ticker: string;
  poolAddress: string;
  positionManager: string;
  positionId?: string;
  feeTier: number;
  wethAddress: string;
  liquidityTokenAmount: string;
  liquidityEthAmount: string;
  liquidityTxHash?: string;
}) {
  await query(
    `
      insert into snaphood_token_trading (
        draft_id,
        contract_address,
        chain_id,
        dex,
        pair_label,
        pool_address,
        position_manager,
        position_id,
        fee_tier,
        weth_address,
        liquidity_token_amount,
        liquidity_eth_amount,
        liquidity_tx_hash
      )
      values ($1, $2, $3, 'uniswap-v3', $4, $5, $6, $7, $8, $9, $10, $11, $12)
      on conflict (draft_id) do update
      set pool_address = excluded.pool_address,
          position_manager = excluded.position_manager,
          position_id = coalesce(excluded.position_id, snaphood_token_trading.position_id),
          fee_tier = excluded.fee_tier,
          weth_address = excluded.weth_address,
          liquidity_token_amount = excluded.liquidity_token_amount,
          liquidity_eth_amount = excluded.liquidity_eth_amount,
          liquidity_tx_hash = coalesce(excluded.liquidity_tx_hash, snaphood_token_trading.liquidity_tx_hash),
          updated_at = now()
    `,
    [
      input.draftId,
      input.contractAddress,
      input.chainId,
      `${input.ticker}/WETH`,
      input.poolAddress,
      input.positionManager,
      input.positionId ?? null,
      input.feeTier,
      input.wethAddress,
      input.liquidityTokenAmount,
      input.liquidityEthAmount,
      input.liquidityTxHash ?? null
    ]
  );
}

export async function recordIndexerSwap(input: {
  draftId: string;
  contractAddress: string;
  chainId: number;
  ticker: string;
  wethAddress: string;
  feeTier: number;
  swapTxHash: string;
}) {
  await query(
    `
      insert into snaphood_token_trading (
        draft_id,
        contract_address,
        chain_id,
        dex,
        pair_label,
        weth_address,
        fee_tier,
        swap_tx_hash
      )
      values ($1, $2, $3, 'uniswap-v3', $4, $5, $6, $7)
      on conflict (draft_id) do update
      set weth_address = excluded.weth_address,
          fee_tier = excluded.fee_tier,
          swap_tx_hash = excluded.swap_tx_hash,
          updated_at = now()
    `,
    [input.draftId, input.contractAddress, input.chainId, `${input.ticker}/WETH`, input.wethAddress, input.feeTier, input.swapTxHash]
  );
}

export async function recordDexscreener(input: {
  draftId: string;
  dexscreenerUrl: string;
  pair: Record<string, unknown> | null;
}) {
  await query(
    `
      update snaphood_token_trading
      set dexscreener_url = $2,
          dexscreener_pair = $3,
          dexscreener_synced_at = now(),
          updated_at = now()
      where draft_id = $1
    `,
    [input.draftId, input.dexscreenerUrl, input.pair ? JSON.stringify(input.pair) : null]
  );
}
