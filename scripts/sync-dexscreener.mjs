import { config } from "dotenv";
import { Pool } from "pg";

config({ path: ".env.local" });
config();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl });

async function main() {
  await backfillKnownTrading();

  const rows = await pool.query(`
    select d.id,
           d.contract_address,
           t.pool_address
    from snaphood_token_drafts d
    join snaphood_token_trading t on t.draft_id = d.id
    where d.chain_id = 4663
      and d.contract_address is not null
      and t.pool_address is not null
  `);

  for (const row of rows.rows) {
    const url = `https://api.dexscreener.com/latest/dex/pairs/robinhood/${row.pool_address}`;
    const response = await fetch(url);
    if (!response.ok) {
      console.warn(`Dexscreener fetch failed for ${row.pool_address}: ${response.status}`);
      continue;
    }

    const data = await response.json();
    const pair = data.pair ?? data.pairs?.[0] ?? null;
    if (!pair) {
      // Dexscreener has not indexed this pool yet. Do NOT record a chart URL — a link that
      // 404s must never make the UI claim the chart is live. Leave it "chart pending".
      continue;
    }

    const dexscreenerUrl = pair.url ?? `https://dexscreener.com/robinhood/${row.pool_address.toLowerCase()}`;
    await pool.query(
      `
        update snaphood_token_trading
        set dexscreener_url = $2,
            dexscreener_pair = $3,
            dexscreener_synced_at = now(),
            updated_at = now()
        where draft_id = $1
      `,
      [row.id, dexscreenerUrl, JSON.stringify(pair)]
    );
    console.log(`synced ${row.contract_address} -> ${dexscreenerUrl}`);
  }
}

async function backfillKnownTrading() {
  const token = process.env.TRADING_TOKEN_ADDRESS;
  const poolAddress = process.env.TRADING_POOL_ADDRESS;
  if (!token || !poolAddress) {
    return;
  }

  const draft = await pool.query(
    `
      select id, contract_address, chain_id
      from snaphood_token_drafts
      where lower(contract_address) = lower($1)
      limit 1
    `,
    [token]
  );

  const row = draft.rows[0];
  if (!row) {
    return;
  }

  await pool.query(
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
        liquidity_tx_hash,
        swap_tx_hash,
        dexscreener_url
      )
      values ($1, $2, $3, 'uniswap-v3', 'SNAPG/WETH', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      on conflict (draft_id) do update
      set pool_address = excluded.pool_address,
          position_manager = excluded.position_manager,
          position_id = excluded.position_id,
          fee_tier = excluded.fee_tier,
          weth_address = excluded.weth_address,
          liquidity_token_amount = excluded.liquidity_token_amount,
          liquidity_eth_amount = excluded.liquidity_eth_amount,
          liquidity_tx_hash = excluded.liquidity_tx_hash,
          swap_tx_hash = excluded.swap_tx_hash,
          dexscreener_url = excluded.dexscreener_url,
          updated_at = now()
    `,
    [
      row.id,
      row.contract_address,
      row.chain_id,
      poolAddress,
      process.env.UNISWAP_V3_POSITION_MANAGER ?? null,
      process.env.TRADING_POSITION_ID ?? null,
      Number(process.env.UNISWAP_V3_FEE ?? "10000"),
      process.env.ROBINHOOD_WETH_ADDRESS ?? null,
      process.env.LIQUIDITY_TOKEN_AMOUNT ?? null,
      process.env.LIQUIDITY_ETH_AMOUNT ?? null,
      "0x7394f7046e117ed85ff0a70c3816564fd66ce22ea6cb6419e525111ce9be17da",
      "0xa484a8a7134bc01d93500a395ee8df238f343421946d053f8c18ef2f3bec75d4",
      `https://dexscreener.com/robinhood/${poolAddress.toLowerCase()}`
    ]
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
