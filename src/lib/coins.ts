import { createHash } from "crypto";
import { query } from "@/lib/db";
import { env } from "@/lib/env";
import type { LaunchpadStats, LaunchProof, LaunchedCoin } from "@/lib/types";

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

type LaunchEventRow = {
  event_type: string;
  payload: Record<string, unknown>;
  created_at: Date;
};

type StatsRow = {
  chain_id: number;
  updated_at: Date;
  pool_address: string | null;
  dexscreener_url: string | null;
  dexscreener_pair: Record<string, unknown> | null;
};

const launchProofVersion = "snaphood.launch-proof.v1";

export async function listLaunchedCoins(
  limit = 30,
  options: { chainId?: number; query?: string; tradableOnly?: boolean } = {}
) {
  const search = normalizeSearch(options.query);
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
        and ($2::int is null or d.chain_id = $2)
        and (
          $3::text is null
          or lower(d.name) like '%' || $3 || '%'
          or lower(d.ticker) like '%' || $3 || '%'
          or lower(d.contract_address) like '%' || $3 || '%'
        )
        and (
          $4::boolean is not true
          or t.pool_address is not null
          or t.dexscreener_url is not null
        )
      order by d.updated_at desc
      limit $1
    `,
    [limit, options.chainId ?? null, search, options.tradableOnly ?? false]
  );

  return result.rows.map(mapCoinRow);
}

function normalizeSearch(value: string | undefined) {
  const normalized = value?.trim().toLowerCase().slice(0, 80);
  return normalized || null;
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

export async function getLaunchpadStats(options: { chainId?: number } = {}): Promise<LaunchpadStats> {
  const result = await query<StatsRow>(
    `
      select d.chain_id,
             d.updated_at,
             t.pool_address,
             t.dexscreener_url,
             t.dexscreener_pair
      from snaphood_token_drafts d
      left join snaphood_token_trading t on t.draft_id = d.id
      where d.status = 'launched'
        and d.contract_address is not null
        and ($1::int is null or d.chain_id = $1)
    `,
    [options.chainId ?? null]
  );

  let latestLaunchAt: Date | undefined;
  let tradableLaunches = 0;
  let totalLiquidityUsd = 0;
  let totalVolume24hUsd = 0;
  let totalMarketCapUsd = 0;
  const chains = new Set<number>();

  for (const row of result.rows) {
    chains.add(row.chain_id);
    if (!latestLaunchAt || row.updated_at > latestLaunchAt) {
      latestLaunchAt = row.updated_at;
    }

    if (row.pool_address || row.dexscreener_url) {
      tradableLaunches += 1;
    }

    totalLiquidityUsd += pairNumber(row.dexscreener_pair, ["liquidity", "usd"]);
    totalVolume24hUsd += pairNumber(row.dexscreener_pair, ["volume", "h24"]);
    totalMarketCapUsd += pairNumber(row.dexscreener_pair, ["marketCap"]) || pairNumber(row.dexscreener_pair, ["fdv"]);
  }

  return {
    totalLaunches: result.rows.length,
    tradableLaunches,
    chainCount: chains.size,
    totalLiquidityUsd,
    totalVolume24hUsd,
    totalMarketCapUsd,
    latestLaunchAt: latestLaunchAt?.toISOString(),
    generatedAt: new Date().toISOString(),
    filters: {
      chainId: options.chainId
    }
  };
}

export async function getLaunchProof(contractOrId: string): Promise<LaunchProof | null> {
  const coin = await getLaunchedCoin(contractOrId);
  if (!coin) return null;

  const events = await query<LaunchEventRow>(
    `
      select event_type, payload, created_at
      from snaphood_launch_events
      where draft_id = $1
      order by created_at asc
    `,
    [coin.id]
  );
  const normalizedEvents = events.rows.map((event) => ({
    eventType: event.event_type,
    createdAt: event.created_at.toISOString(),
    payload: event.payload
  }));
  const launchEventRow = [...events.rows].reverse().find((event) => event.event_type === "launch.completed");
  const liquidityEvent = latestEvent(normalizedEvents, "trading.liquidity_seeded");
  const swapEvent = latestEvent(normalizedEvents, "trading.indexer_swap");
  const dexEvent = latestEvent(normalizedEvents, "trading.dexscreener_synced");
  const launchEvent = launchEventRow
    ? {
        eventType: launchEventRow.event_type,
        createdAt: launchEventRow.created_at.toISOString(),
        payload: launchEventRow.payload
      }
    : undefined;
  const guardrails = readGuardrails(launchEventRow?.payload);
  const txBase = coin.txUrl?.replace(/\/tx\/[^/]+$/, "/tx");
  const timeline = [
    guardrails
      ? {
          label: "Launch guardrails accepted",
          status: "complete" as const,
          timestamp: guardrails.acceptedAt,
          detail: guardrails.version ? `Version ${guardrails.version}` : "Creator acknowledgements recorded"
        }
      : {
          label: "Launch guardrails accepted",
          status: "pending" as const,
          detail: "Legacy launch event did not include guardrail metadata"
        },
    {
      label: "Token deployed",
      status: "complete" as const,
      timestamp: launchEvent?.createdAt ?? coin.updatedAt,
      detail: `${coin.name} on chain ${coin.chainId}`,
      txHash: coin.txHash,
      url: coin.txUrl
    },
    coin.poolAddress
      ? {
          label: "Uniswap pool recorded",
          status: "complete" as const,
          detail: coin.poolAddress,
          url: coin.poolUrl
        }
      : {
          label: "Uniswap pool recorded",
          status: "pending" as const,
          detail: "No pool metadata recorded yet"
        },
    coin.liquidityTxHash
      ? {
          label: "Liquidity seeded",
          status: "complete" as const,
          timestamp: liquidityEvent?.createdAt,
          detail: eventString(liquidityEvent?.payload.tokenAmount) && eventString(liquidityEvent?.payload.ethAmount)
            ? `${eventString(liquidityEvent?.payload.tokenAmount)} tokens + ${eventString(liquidityEvent?.payload.ethAmount)} WETH side`
            : `${coin.liquidityTokenAmount ?? "token"} tokens + ${coin.liquidityEthAmount ?? "ETH"} WETH side`,
          txHash: coin.liquidityTxHash,
          url: txBase ? `${txBase}/${coin.liquidityTxHash}` : undefined
        }
      : {
          label: "Liquidity seeded",
          status: "pending" as const,
          detail: "No liquidity transaction recorded yet"
        },
    coin.swapTxHash
      ? {
          label: "Indexer swap",
          status: "complete" as const,
          timestamp: swapEvent?.createdAt,
          detail: eventString(swapEvent?.payload.swapEthAmount)
            ? `Tiny ${eventString(swapEvent?.payload.swapEthAmount)} WETH swap used to help indexers discover the pool`
            : "Tiny swap used to help indexers discover the pool",
          txHash: coin.swapTxHash,
          url: txBase ? `${txBase}/${coin.swapTxHash}` : undefined
        }
      : {
          label: "Indexer swap",
          status: "pending" as const,
          detail: "No indexer swap recorded yet"
        },
    coin.dexscreenerUrl
      ? {
          label: "Dexscreener synced",
          status: "complete" as const,
          timestamp: dexEvent?.createdAt ?? coin.dexscreenerSyncedAt,
          detail: "Cached pair payload available",
          url: coin.dexscreenerUrl
        }
      : {
          label: "Dexscreener synced",
          status: "pending" as const,
          detail: "Pair has not been synced from Dexscreener yet"
        }
  ];

  const proofBody = {
    coinId: coin.id,
    contractAddress: coin.contractAddress,
    chainId: coin.chainId,
    events: normalizedEvents,
    launchEvent,
    guardrails,
    timeline
  };

  return {
    proofVersion: launchProofVersion,
    proofHash: proofHash(proofBody),
    ...proofBody
  };
}

export function mapCoinRow(row: CoinRow): LaunchedCoin {
  const explorerBase = getExplorerBase(row.chain_id);
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

function getExplorerBase(chainId: number) {
  if (chainId === env.robinhoodChainId && env.robinhoodBlockExplorerUrl) {
    return env.robinhoodBlockExplorerUrl.replace(/\/$/, "");
  }

  if (chainId === 4663) {
    return "https://robinhoodchain.blockscout.com";
  }

  if (chainId === 46630) {
    return "https://explorer.testnet.chain.robinhood.com";
  }

  return env.robinhoodBlockExplorerUrl.replace(/\/$/, "");
}

function latestEvent(
  events: Array<{ eventType: string; createdAt: string; payload: Record<string, unknown> }>,
  eventType: string
) {
  return [...events].reverse().find((event) => event.eventType === eventType);
}

function eventString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function pairNumber(pair: Record<string, unknown> | null | undefined, path: string[]) {
  let value: unknown = pair;
  for (const key of path) {
    if (!value || typeof value !== "object") {
      return 0;
    }
    value = (value as Record<string, unknown>)[key];
  }

  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function readGuardrails(payload: Record<string, unknown> | undefined): LaunchProof["guardrails"] | undefined {
  const guardrails = payload?.guardrails;
  if (!guardrails || typeof guardrails !== "object") {
    return undefined;
  }

  const value = guardrails as Record<string, unknown>;
  return {
    version: typeof value.version === "string" ? value.version : undefined,
    acceptedAt: typeof value.acceptedAt === "string" ? value.acceptedAt : undefined,
    acknowledgements:
      value.acknowledgements && typeof value.acknowledgements === "object"
        ? (value.acknowledgements as Record<string, unknown>)
        : undefined
  };
}

function proofHash(proofBody: Omit<LaunchProof, "proofVersion" | "proofHash">) {
  return `sha256:${createHash("sha256")
    .update(stableStringify({ proofVersion: launchProofVersion, ...proofBody }))
    .digest("hex")}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .filter((key) => object[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
    .join(",")}}`;
}
