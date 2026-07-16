import { Pool } from "pg";
import { config } from "dotenv";

config({ path: ".env.local" });
config();

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is required. Run `wrkr db --json` and add it to .env.local.");
  process.exit(1);
}

async function main() {
  const pool = new Pool({ connectionString: databaseUrl });

  await pool.query(`
    create table if not exists snaphood_users (
      id text primary key,
      email text not null unique,
      created_at timestamptz not null default now()
    );

    create table if not exists snaphood_sessions (
      id text primary key,
      user_id text not null references snaphood_users(id) on delete cascade,
      expires_at timestamptz not null,
      created_at timestamptz not null default now()
    );

    create index if not exists snaphood_sessions_user_idx on snaphood_sessions(user_id);
    create index if not exists snaphood_sessions_expires_idx on snaphood_sessions(expires_at);

    create table if not exists snaphood_token_drafts (
      id text primary key,
      user_id text not null references snaphood_users(id) on delete cascade,
      original_image_url text not null,
      profile_image_url text not null,
      banner_image_url text not null,
      prompt_summary text not null default '',
      name text not null,
      ticker text not null,
      description text not null,
      tokenomics jsonb not null,
      status text not null default 'draft',
      contract_address text,
      tx_hash text,
      chain_id integer,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create index if not exists snaphood_token_drafts_user_idx on snaphood_token_drafts(user_id, created_at desc);

    create table if not exists snaphood_launch_events (
      id text primary key,
      draft_id text not null references snaphood_token_drafts(id) on delete cascade,
      event_type text not null,
      payload jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );

    create index if not exists snaphood_launch_events_draft_idx on snaphood_launch_events(draft_id, created_at desc);

    create table if not exists snaphood_token_trading (
      draft_id text primary key references snaphood_token_drafts(id) on delete cascade,
      contract_address text not null,
      chain_id integer not null,
      dex text not null default 'uniswap-v3',
      pair_label text not null default 'TOKEN/WETH',
      pool_address text,
      position_manager text,
      position_id text,
      fee_tier integer,
      weth_address text,
      liquidity_token_amount text,
      liquidity_eth_amount text,
      liquidity_tx_hash text,
      swap_tx_hash text,
      dexscreener_url text,
      dexscreener_pair jsonb,
      dexscreener_synced_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create index if not exists snaphood_token_trading_contract_idx
      on snaphood_token_trading(lower(contract_address), chain_id);
    create index if not exists snaphood_token_trading_pool_idx
      on snaphood_token_trading(lower(pool_address));
  `);

  await pool.end();
  console.log("SnapHood migration complete.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
