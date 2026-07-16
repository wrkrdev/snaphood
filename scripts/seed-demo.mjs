import { config } from "dotenv";
import { Pool } from "pg";

config({ path: ".env.local", quiet: true });
config({ quiet: true });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is required. Run `wrkr db --json` and add it to .env.local.");
  process.exit(1);
}

const ids = {
  user: "seed-user-snaphood-genesis",
  draft: "seed-draft-snaphood-genesis",
  launchEvent: "seed-event-snapg-launch-completed",
  liquidityEvent: "seed-event-snapg-liquidity-seeded",
  swapEvent: "seed-event-snapg-indexer-swap",
  dexEvent: "seed-event-snapg-dexscreener-synced"
};

const token = {
  name: "SnapHood Genesis",
  ticker: "SNAPG",
  contractAddress: "0xce0213831ddf77fae87da578efe0ddae2b0218d0",
  txHash: "0x99f22605a0ce3fdee9fd9cce7bbd06282dd2f9389f93888129428e50539bf60c",
  chainId: 4663,
  deployer: "0x61d8F5037EA8e0398a98fd93E66a2E2e537ea334",
  description:
    "A fixed-supply mainnet meme token launched from SnapHood, paired with WETH on Uniswap v3, and indexed on Dexscreener as a proof of the full Wrkr launchpad flow.",
  assetUrl: "/assets/snapg-genesis.png",
  createdAt: "2026-07-15T18:50:46.811Z",
  updatedAt: "2026-07-16T06:28:28.695Z",
  tokenomics: {
    supply: "1000000000",
    decimals: 18,
    allocation: [
      { label: "Community memes", percent: 45 },
      { label: "Liquidity seed", percent: 30 },
      { label: "Creator vault", percent: 15 },
      { label: "Airdrops", percent: 10 }
    ],
    notes: ["Fixed supply.", "No transfer tax.", "No owner minting.", "No implied investment value."]
  }
};

const trading = {
  poolAddress: "0x2FA084cCc246EF1142E9caeee39674980217B5cE",
  positionManager: "0x73991a25c818bf1f1128deaab1492d45638de0d3",
  positionId: "150238",
  feeTier: 10000,
  wethAddress: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  liquidityTokenAmount: "1000000",
  liquidityEthAmount: "0.0001",
  liquidityTxHash: "0x7394f7046e117ed85ff0a70c3816564fd66ce22ea6cb6419e525111ce9be17da",
  swapTxHash: "0xa484a8a7134bc01d93500a395ee8df238f343421946d053f8c18ef2f3bec75d4",
  dexscreenerUrl: "https://dexscreener.com/robinhood/0x2fa084ccc246ef1142e9caeee39674980217b5ce",
  dexscreenerSyncedAt: "2026-07-16T06:28:28.695Z",
  pair: {
    chainId: "robinhood",
    dexId: "uniswap",
    labels: ["v3"],
    url: "https://dexscreener.com/robinhood/0x2fa084ccc246ef1142e9caeee39674980217b5ce",
    pairAddress: "0x2FA084cCc246EF1142E9caeee39674980217B5cE",
    baseToken: {
      address: "0xCe0213831DDF77fAe87da578efE0DdaE2B0218d0",
      name: "SnapHood Genesis",
      symbol: "SNAPG"
    },
    quoteToken: {
      address: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
      name: "WETH",
      symbol: "WETH"
    },
    priceNative: "0.0000000001552",
    priceUsd: "0.0000002993",
    txns: {
      h24: { buys: 2, sells: 0 }
    },
    volume: {
      h24: 0.04
    },
    liquidity: {
      usd: 0.48,
      base: 802558,
      quote: 0.0001248
    },
    fdv: 299,
    marketCap: 299,
    pairCreatedAt: 1784141709000
  }
};

const events = [
  {
    id: ids.launchEvent,
    type: "launch.completed",
    createdAt: "2026-07-15T18:50:51.000Z",
    payload: {
      launch: {
        contractAddress: token.contractAddress,
        txHash: token.txHash,
        chainId: token.chainId,
        explorerUrl: `https://robinhoodchain.blockscout.com/address/${token.contractAddress}`,
        mode: "mainnet",
        name: token.name,
        ticker: token.ticker,
        deployer: token.deployer,
        deployerBalanceBefore: "0.0007 ETH"
      },
      guardrails: {
        version: "2026-07-16.public-demo-v1",
        acceptedAt: "2026-07-15T18:50:44.000Z",
        acceptedBy: ids.user,
        acknowledgements: {
          noInvestmentValue: true,
          noAffiliation: true,
          contentRights: true,
          jurisdictionAllowed: true,
          liveAdminControlled: true
        }
      }
    }
  },
  {
    id: ids.liquidityEvent,
    type: "trading.liquidity_seeded",
    createdAt: "2026-07-15T18:55:09.000Z",
    payload: {
      contractAddress: token.contractAddress,
      poolAddress: trading.poolAddress,
      positionId: trading.positionId,
      tokenAmount: trading.liquidityTokenAmount,
      ethAmount: trading.liquidityEthAmount,
      liquidityTxHash: trading.liquidityTxHash
    }
  },
  {
    id: ids.swapEvent,
    type: "trading.indexer_swap",
    createdAt: "2026-07-15T18:57:12.000Z",
    payload: {
      contractAddress: token.contractAddress,
      poolAddress: trading.poolAddress,
      swapEthAmount: "0.00001",
      swapTxHash: trading.swapTxHash
    }
  },
  {
    id: ids.dexEvent,
    type: "trading.dexscreener_synced",
    createdAt: trading.dexscreenerSyncedAt,
    payload: {
      hasPair: true,
      contractAddress: token.contractAddress,
      poolAddress: trading.poolAddress,
      dexscreenerUrl: trading.dexscreenerUrl,
      source: "seed-demo"
    }
  }
];

const pool = new Pool({ connectionString: databaseUrl, max: 1 });

try {
  await pool.query("begin");

  const userId = await upsertUser();
  const draftId = await findExistingDraftId() ?? ids.draft;
  await upsertDraft({ draftId, userId });
  await upsertTrading({ draftId });
  for (const event of events) {
    await upsertEvent({ draftId, event });
  }

  await pool.query("commit");

  console.log(
    JSON.stringify(
      {
        ok: true,
        draftId,
        contractAddress: token.contractAddress,
        poolAddress: trading.poolAddress,
        dexscreenerUrl: trading.dexscreenerUrl,
        events: events.map((event) => event.type)
      },
      null,
      2
    )
  );
} catch (error) {
  await pool.query("rollback").catch(() => undefined);
  console.error(error);
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => undefined);
}

async function upsertUser() {
  const existing = await pool.query(
    "select user_id from snaphood_token_drafts where lower(contract_address) = lower($1) limit 1",
    [token.contractAddress]
  );
  if (existing.rows[0]?.user_id) {
    return existing.rows[0].user_id;
  }

  const result = await pool.query(
    `
      insert into snaphood_users (id, email, created_at)
      values ($1, $2, $3)
      on conflict (email) do update set email = excluded.email
      returning id
    `,
    [ids.user, "demo@snaphood.local", token.createdAt]
  );
  return result.rows[0].id;
}

async function findExistingDraftId() {
  const existing = await pool.query(
    "select id from snaphood_token_drafts where lower(contract_address) = lower($1) or id = $2 limit 1",
    [token.contractAddress, ids.draft]
  );
  return existing.rows[0]?.id;
}

async function upsertDraft({ draftId, userId }) {
  await pool.query(
    `
      insert into snaphood_token_drafts (
        id, user_id, original_image_url, profile_image_url, banner_image_url,
        prompt_summary, name, ticker, description, tokenomics, status,
        contract_address, tx_hash, chain_id, created_at, updated_at
      )
      values ($1, $2, $3, $3, $3, $4, $5, $6, $7, $8, 'launched', $9, $10, $11, $12, $13)
      on conflict (id) do update set
        original_image_url = excluded.original_image_url,
        profile_image_url = excluded.profile_image_url,
        banner_image_url = excluded.banner_image_url,
        prompt_summary = excluded.prompt_summary,
        name = excluded.name,
        ticker = excluded.ticker,
        description = excluded.description,
        tokenomics = excluded.tokenomics,
        status = excluded.status,
        contract_address = excluded.contract_address,
        tx_hash = excluded.tx_hash,
        chain_id = excluded.chain_id,
        updated_at = excluded.updated_at
    `,
    [
      draftId,
      userId,
      token.assetUrl,
      "seeded mainnet proof launch",
      token.name,
      token.ticker,
      token.description,
      JSON.stringify(token.tokenomics),
      token.contractAddress,
      token.txHash,
      token.chainId,
      token.createdAt,
      token.updatedAt
    ]
  );
}

async function upsertTrading({ draftId }) {
  await pool.query(
    `
      insert into snaphood_token_trading (
        draft_id, contract_address, chain_id, dex, pair_label,
        pool_address, position_manager, position_id, fee_tier, weth_address,
        liquidity_token_amount, liquidity_eth_amount, liquidity_tx_hash, swap_tx_hash,
        dexscreener_url, dexscreener_pair, dexscreener_synced_at, created_at, updated_at
      )
      values ($1, $2, $3, 'uniswap-v3', 'SNAPG/WETH', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $16)
      on conflict (draft_id) do update set
        contract_address = excluded.contract_address,
        chain_id = excluded.chain_id,
        dex = excluded.dex,
        pair_label = excluded.pair_label,
        pool_address = excluded.pool_address,
        position_manager = excluded.position_manager,
        position_id = excluded.position_id,
        fee_tier = excluded.fee_tier,
        weth_address = excluded.weth_address,
        liquidity_token_amount = excluded.liquidity_token_amount,
        liquidity_eth_amount = excluded.liquidity_eth_amount,
        liquidity_tx_hash = excluded.liquidity_tx_hash,
        swap_tx_hash = excluded.swap_tx_hash,
        dexscreener_url = excluded.dexscreener_url,
        dexscreener_pair = excluded.dexscreener_pair,
        dexscreener_synced_at = excluded.dexscreener_synced_at,
        updated_at = excluded.updated_at
    `,
    [
      draftId,
      token.contractAddress,
      token.chainId,
      trading.poolAddress,
      trading.positionManager,
      trading.positionId,
      trading.feeTier,
      trading.wethAddress,
      trading.liquidityTokenAmount,
      trading.liquidityEthAmount,
      trading.liquidityTxHash,
      trading.swapTxHash,
      trading.dexscreenerUrl,
      JSON.stringify(trading.pair),
      trading.dexscreenerSyncedAt,
      token.updatedAt
    ]
  );
}

async function upsertEvent({ draftId, event }) {
  await pool.query(
    `
      insert into snaphood_launch_events (id, draft_id, event_type, payload, created_at)
      values ($1, $2, $3, $4, $5)
      on conflict (id) do update set
        draft_id = excluded.draft_id,
        event_type = excluded.event_type,
        payload = excluded.payload,
        created_at = excluded.created_at
    `,
    [event.id, draftId, event.type, JSON.stringify(event.payload), event.createdAt]
  );
}
