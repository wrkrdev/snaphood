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
| Cache/rate limits | `wrkr cache` | Redis-backed throttles for auth, generation, launch, and admin trading |
| Uploads/assets | `wrkr storage` | optional object storage for images and generated assets |
| Email | `wrkr email` | production magic-link auth |
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

## Verification

With the app running locally, verify the full demo surface:

```bash
npm run db:migrate
npm run verify:env-example
npm run contract:verify
npm run build
npm audit --audit-level=high
npm run verify:readiness
npm run verify:smoke
```

`verify:readiness` checks environment shape, Postgres reachability, expected database tables, Redis ping, and Wrkr storage CLI availability
without printing secret values. Use stricter public or live profiles before exposing the app:

```bash
npm run verify:readiness -- --profile=public
npm run verify:readiness -- --profile=live
```

`verify:smoke` checks `/`, `/stack`, `/robots.txt`, `/sitemap.xml`, `/api/health`, launched coin feed/detail/proof APIs, a shareable coin page,
demo or magic-link auth behavior, and unauthenticated admin-route protection. It defaults to
`http://localhost:3000`; override with `SNAPHOOD_SMOKE_BASE_URL`.

To also verify the upload-to-draft flow, run:

```bash
SNAPHOOD_SMOKE_GENERATE=true npm run verify:smoke
```

That path signs in, uploads a generated 1x1 PNG, and checks that `/api/generate` returns persisted draft metadata and image URLs.
It may call configured AI/image providers, so keep it opt-in for low-cost routine checks.

## Launch Modes

`TOKEN_LAUNCH_MODE=demo` is the default. It creates a realistic launch receipt without broadcasting a transaction.

Live launch modes are admin-gated by `SNAPHOOD_ADMIN_EMAILS`. Public visitors can explore coins and generate drafts, but they cannot spend the server deployer wallet.

Every launch request must include creator acknowledgements that the token is a meme experiment, not an investment product,
that SnapHood has no official affiliation with Robinhood, Pump.fun, Dexscreener, or Uniswap, that the creator can use the
uploaded content, that the creator is allowed to launch from their jurisdiction, and that live execution is admin-controlled. The accepted guardrail version is persisted in
`snaphood_launch_events` with the launch receipt.

Before enabling live deployment:

- fund a dedicated low-balance deployer wallet with ETH on the target Robinhood Chain network;
- set `ROBINHOOD_RPC_URL`, `ROBINHOOD_CHAIN_ID`, and `DEPLOYER_PRIVATE_KEY`;
- set `SNAPHOOD_ADMIN_EMAILS`;
- review and compile `contracts/SnapHoodToken.sol`;
- wire the reviewed bytecode into `src/lib/launch.ts`.

Robinhood Chain docs list mainnet chain ID `4663`, testnet chain ID `46630`, ETH gas, and standard EVM contract deployment.

## Auth Modes

Local demos use instant email sessions by default:

```bash
SNAPHOOD_DEMO_AUTH_ENABLED="true"
```

For a public deployment, disable demo auth and send one-time magic links:

```bash
SNAPHOOD_DEMO_AUTH_ENABLED="false"
SNAPHOOD_AUTH_EMAIL_MODE="wrkr"
SNAPHOOD_AUTH_EMAIL_FROM=""
SNAPHOOD_AUTH_MAGIC_LINK_TTL_MINUTES="15"
```

`SNAPHOOD_AUTH_EMAIL_MODE=dry-run` keeps the same Postgres-backed magic-link flow but returns the link in the API response
for local verification. `wrkr` mode sends through `wrkr email send`.

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

## Abuse Controls

`src/lib/rate-limit.ts` uses Wrkr Redis when `REDIS_URL` is set and falls back to
process memory for local development. Current limits:

- auth start: 12 requests per IP per 10 minutes;
- generation: 10 drafts per user per hour;
- launch: 8 demo launches per user per hour, or 3 live launches per admin per hour;
- admin liquidity execution: 2 live executions per admin per hour;
- admin indexer swap execution: 4 live executions per admin per hour;
- admin dry-run and Dex sync routes have higher non-spending limits.

Public pages:

- `/` — launchpad feed and creation workflow
- `/coin/<contract>` — shareable coin detail page
- `/stack` — Wrkr stack proof page

## Maintenance

Run the maintenance job in dry-run mode to inspect expired sessions, retired magic-link challenges, and stale unlaunched drafts:

```bash
npm run db:maintenance
```

Execute cleanup explicitly:

```bash
SNAPHOOD_MAINTENANCE_DRY_RUN=false npm run db:maintenance
```

The job never deletes launched coins. It only removes expired sessions, old used/expired auth challenges, and token drafts that are still
`status='draft'` after `SNAPHOOD_STALE_DRAFT_RETENTION_DAYS`. On Wrkr, schedule it with `crontab` once the app is public.

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
