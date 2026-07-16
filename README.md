# SnapHood

SnapHood is a Wrkr full-stack launchpad that turns a camera snap or uploaded image into a launch-ready meme token on Robinhood Chain.

It is an original launchpad product with a Pump.fun-inspired dense feed and creator workflow. It does not use Robinhood or Pump.fun logos, private assets, private source code, or official affiliation claims.

## Included

- Next.js full-stack app with mobile-first photo upload.
- Demo session auth backed by Wrkr Postgres.
- AI-generated token name, ticker, description, and tokenomics with a deterministic fallback.
- Upload persistence with local preview and optional Wrkr object storage publishing.
- Admin-gated live launch flow for Robinhood Chain testnet/mainnet configuration.
- Public launchpad feed and shareable coin detail pages.
- Persisted Uniswap v3 pool, LP position, swap, and Dexscreener metadata.
- `/stack` proof page for Wrkr DB/cache/storage/AI/chain readiness.
- Public-safe `.env.example`; real secrets stay in `.env.local`.

## Wrkr Primitive Map

| Need | Wrkr primitive | Used for |
| --- | --- | --- |
| Durable data | `wrkr db` | users, sessions, token drafts, launches, trading metadata, Dexscreener cache |
| Cache/rate limits | `wrkr cache` | configured for later rate limiting/background jobs |
| Uploads/assets | `wrkr storage` | optional object storage for images and generated assets |
| Email | `wrkr email` | future magic-link auth |
| Public URL | `wrkr expose` | publish local Next port |

## Quickstart

```bash
npm install
cp .env.example .env.local
wrkr db --json
wrkr cache --json
```

Copy the printed URLs into `.env.local`, then run:

```bash
npm run db:migrate
npm run dev -- --hostname 0.0.0.0
```

Open `http://localhost:3000`.

## Launch Modes

`TOKEN_LAUNCH_MODE=demo` is the default. It creates a realistic launch receipt without broadcasting a transaction.

Live launch modes are admin-gated by `SNAPHOOD_ADMIN_EMAILS`. Public visitors can explore coins and generate drafts, but they cannot spend the server deployer wallet.

Before enabling live deployment:

- fund a dedicated low-balance deployer wallet with ETH on the target Robinhood Chain network;
- set `ROBINHOOD_RPC_URL`, `ROBINHOOD_CHAIN_ID`, and `DEPLOYER_PRIVATE_KEY`;
- set `SNAPHOOD_ADMIN_EMAILS`;
- review and compile `contracts/SnapHoodToken.sol`;
- wire the reviewed bytecode into `src/lib/launch.ts`.

Robinhood Chain docs list mainnet chain ID `4663`, testnet chain ID `46630`, ETH gas, and standard EVM contract deployment.

## Trading / Liquidity

SnapHood can make a deployed token technically tradable by seeding a Uniswap v3 pool on Robinhood Chain mainnet.

The current proof pool is:

- Token: `0xce0213831ddf77fae87da578efe0ddae2b0218d0` (`SNAPG`)
- Pool: `0x2FA084cCc246EF1142E9caeee39674980217B5cE`
- Pair: `SNAPG / WETH`
- Fee tier: `10000` / `1%`
- Position NFT id: `150238`

Use a dry run first:

```bash
LIQUIDITY_DRY_RUN=true npm run liquidity:seed
```

Then intentionally seed liquidity:

```bash
LIQUIDITY_DRY_RUN=false npm run liquidity:seed
```

The script wraps ETH to WETH, approves WETH and the token, creates/initializes the pool when needed, and mints a Uniswap v3 liquidity position. Tiny proof liquidity makes the token tradable but causes very high slippage; meaningful trading needs more liquidity.

To create a tiny swap event for indexers:

```bash
SWAP_DRY_RUN=true npm run swap:smoke
SWAP_DRY_RUN=false npm run swap:smoke
```

Sync Dexscreener metadata into Postgres:

```bash
npm run dex:sync
```

Admins can also operate the same flow from the app. Sign in with an email listed in
`SNAPHOOD_ADMIN_EMAILS`, open `/coin/<contract>`, then use the Trading Operations
panel. Every live-spending action has a dry-run estimate button and requires an
explicit browser confirmation before `execute: true` is sent.

Admin API routes:

- `POST /api/admin/coins/<contract>/make-tradable` — estimate or seed Uniswap v3 liquidity.
- `POST /api/admin/coins/<contract>/index-swap` — estimate or run a tiny WETH-to-token indexer swap.
- `POST /api/admin/coins/<contract>/sync-dex` — fetch and cache the Dexscreener pair payload.

Public pages:

- `/` — launchpad feed and creation workflow
- `/coin/<contract>` — shareable coin detail page
- `/stack` — Wrkr stack proof page

## AI

Without `LLM_API_KEY`, SnapHood uses deterministic fallback metadata so the demo remains usable.

With an OpenAI-compatible provider:

```bash
LLM_BASE_URL="https://api.openai.com/v1"
LLM_MODEL="gpt-5.6-luna"
LLM_API_KEY="..."
```

Fal image generation uses the budget/fast `fal-ai/flux/schnell` model by default:

```bash
FAL_KEY="..."
FAL_IMAGE_MODEL="fal-ai/flux/schnell"
```

## Public Release Notes

Keep the repository private until the checklist in [docs/PUBLIC_RELEASE.md](docs/PUBLIC_RELEASE.md) is complete.
