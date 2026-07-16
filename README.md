# SnapHood

SnapHood is a Wrkr full-stack launchpad that turns a camera snap or uploaded image into a launch-ready meme token on Robinhood Chain.

It is an original launchpad product with a Pump.fun-inspired dense feed and creator workflow. It does not use Robinhood or Pump.fun logos, private assets, private source code, or official affiliation claims.

## Included

- Next.js full-stack app with mobile-first photo upload.
- Demo session auth backed by Wrkr Postgres.
- AI-generated token name, ticker, description, and tokenomics with a deterministic fallback.
- Upload persistence with local preview and optional Wrkr object storage publishing.
- User-wallet live launch flow for Robinhood Chain testnet/mainnet configuration, with an admin-only server-wallet fallback.
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
npm run db:seed
npm run dev -- --hostname 0.0.0.0
```

Open `http://localhost:3000`.

## Production Runtime

Use `next dev` only for local development. Public Wrkr exposure should point at the production server:

```bash
npm run build
npm run prod:start
npm run prod:status
```

The runtime helper writes `logs/server.pid` and appends to `logs/server.log`, both ignored by git. It waits for
`/api/health` before reporting success, so a bad environment fails fast. After a new `npm run build`, restart the
running production process so it picks up the fresh `.next` output:

```bash
npm run prod:restart
npm run prod:ensure
npm run prod:stop
```

On the Wrkr workstation, keep the process alive with cron:

```cron
* * * * * cd /home/wrkr/robinhood && npm run prod:ensure >> /home/wrkr/robinhood/logs/watchdog.log 2>&1 # snaphood-watchdog
```

## Verification

With the app running locally, verify the full demo surface:

```bash
npm run db:migrate
npm run db:seed
npm run verify:env-example
npm run verify:secrets
npm run verify:ai-normalization
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
npm run verify:generate
```

The `SNAPHOOD_SMOKE_GENERATE=true` smoke path uses normal demo or dry-run auth. `verify:generate` creates a temporary
DB-backed session directly, so it can verify the real `/api/generate` route even when public auth sends Wrkr email links.
Both paths upload a generated 1x1 PNG and check that `/api/generate` returns persisted draft metadata and image URLs.
The public smoke paths also fetch profile, banner, and original image URLs and validate raster content type, size, and file signatures.
In live mode, `verify:generate` also proves that public users cannot spend the server deployer wallet and can prepare a
user-wallet launch plan without writing fake chain receipt fields.
They may call configured AI/image providers, so keep them opt-in for low-cost routine checks.

To verify launch idempotency without spending funds, restart the local app with `TOKEN_LAUNCH_MODE=demo`, then run:

```bash
npm run verify:launch-consistency
```

The verifier creates a draft directly in Postgres, launches it through the API, and confirms a repeated launch request reuses the
first receipt instead of creating another token.

`npm run db:seed` is idempotent. It inserts or updates the public SNAPG proof launch, Uniswap v3 pool metadata,
proof events, and compact Dexscreener cache so a fresh Wrkr database has a tradable coin on the homepage after migration.
The migration also enforces one launched/trading row per contract address and chain, preventing duplicate public feed entries.

`npm run verify:secrets` scans tracked files for committed API keys, wallet private keys, PEM private keys, non-placeholder
secret env assignments, and accidentally tracked local uploads or env files. It intentionally ignores public blockchain tx hashes.

Security headers are configured in `next.config.ts` and verified by `npm run verify:smoke`. The policy disables
`X-Powered-By`, blocks framing and plugin content, keeps referrers scoped, restricts browser permissions, and allows
camera access only for the local SnapHood capture workflow.

State-changing API routes also reject mismatched browser `Origin` or `Referer` headers. This keeps same-origin app requests
and CLI smoke tests working while blocking cross-site form/fetch attempts against authenticated sessions.

Uploads are limited to PNG, JPEG, WebP, and GIF raster files, and `/api/generate` verifies the file signature before
storing or sending media to AI providers. `SNAPHOOD_SMOKE_GENERATE=true npm run verify:smoke` covers both unsafe upload
rejection and a successful PNG draft.

## Launch Modes

`TOKEN_LAUNCH_MODE=demo` is the default. It creates a realistic launch receipt without broadcasting a transaction.

In live launch modes, public users launch from their own connected EVM wallet. The browser deploys the reviewed
`SnapHoodToken` bytecode, the user wallet pays gas, and `/api/launch/complete` verifies the chain receipt, sender,
bytecode prefix, token name, ticker, decimals, total supply, creator, and creator balance before storing the launch.
The server deployer wallet path remains admin-gated by `SNAPHOOD_ADMIN_EMAILS` for operational demos and recovery only.

Every launch request must include creator acknowledgements that the token is a meme experiment, not an investment product,
that SnapHood has no official affiliation with Robinhood, Pump.fun, Dexscreener, or Uniswap, that the creator can use the
uploaded content, that the creator is allowed to launch from their jurisdiction, and that live execution uses the creator's
own wallet unless an admin intentionally uses the server fallback. The accepted guardrail version is persisted in
`snaphood_launch_events` with the launch receipt.

Before enabling live deployment:

- set `ROBINHOOD_RPC_URL` and `ROBINHOOD_CHAIN_ID`;
- set `SNAPHOOD_ADMIN_EMAILS`;
- only set and fund `DEPLOYER_PRIVATE_KEY` when you intentionally need the admin server-wallet fallback;
- review and compile `contracts/SnapHoodToken.sol`;
- wire the reviewed bytecode into `src/generated/SnapHoodToken.json`.

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

To verify magic-link replay behavior locally, restart the app with demo auth disabled and dry-run email enabled, then run:

```bash
SNAPHOOD_DEMO_AUTH_ENABLED=false SNAPHOOD_AUTH_EMAIL_MODE=dry-run npm run dev -- --hostname 0.0.0.0
npm run verify:auth-challenge-consistency
```

The verifier starts two links for the same email and confirms the older link is retired while the newest link signs in.

## Trading / Liquidity

SnapHood can make a deployed token technically tradable by seeding a Uniswap v3 pool on Robinhood Chain mainnet.
For public user launches, this is a creator-wallet action: open the coin page, connect the same wallet that launched the
token, estimate the liquidity plan, then approve the wallet prompts to wrap ETH, approve WETH, approve the token,
create/initialize the pool when needed, and mint the liquidity position. The server records pool metadata only after it
verifies the successful wallet transactions on-chain.

After a pool exists, use the coin page's Dexscreener sync action. Dexscreener may still need a few minutes, and often a
small swap, before it returns full pair data.

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

Admins can also operate a server-wallet fallback from the app. Sign in with an email listed in
`SNAPHOOD_ADMIN_EMAILS`, open `/coin/<contract>`, then use the Trading Operations
panel. Every live-spending action has a dry-run estimate button and requires an
explicit browser confirmation before `execute: true` is sent.

Public creator-wallet API routes:

- `POST /api/coins/<contract>/trade/prepare` — estimate and return wallet transactions for Uniswap v3 liquidity.
- `POST /api/coins/<contract>/trade/complete` — verify wallet transaction receipts and record pool/LP metadata.
- `POST /api/coins/<contract>/trade/sync-dex` — fetch and cache Dexscreener metadata after a pool exists.

Admin API routes:

- `POST /api/admin/coins/<contract>/make-tradable` — estimate or seed Uniswap v3 liquidity.
- `POST /api/admin/coins/<contract>/index-swap` — estimate or run a tiny WETH-to-token indexer swap.
- `POST /api/admin/coins/<contract>/sync-dex` — fetch and cache the Dexscreener pair payload.

Live admin trading execution requires `execute: true` plus `confirmation: "EXECUTE_LIVE_TRADE"` in the request body.
Dry-run planning requests omit the confirmation and never broadcast transactions.

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

Public APIs:

- `GET /api/coins` — latest launched coins across configured Robinhood Chain environments.
- `GET /api/coins?chainId=4663&limit=30` — bounded chain-specific feed for public mainnet views.
- `GET /api/coins?query=SNAPG&tradable=true` — DB-backed ticker/name/contract search with optional tradable-only filtering.
- `GET /api/coins?limit=30&cursor=<nextCursor>` — stable cursor pagination for longer launchpad feeds.
- `GET /api/coins/stats` — aggregate launchpad totals from persisted launch/trading metadata.
- `GET /api/coins/stats?chainId=4663` — chain-specific aggregate totals for public network views.

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
`status='draft'` after `SNAPHOOD_STALE_DRAFT_RETENTION_DAYS`. On Wrkr, schedule it with `crontab` once the app is public:

```cron
17 3 * * * cd /home/wrkr/robinhood && SNAPHOOD_MAINTENANCE_DRY_RUN=false npm run db:maintenance >> /home/wrkr/robinhood/logs/maintenance.log 2>&1 # snaphood-maintenance
```

## AI

Without `LLM_API_KEY`, SnapHood uses deterministic fallback metadata so the demo remains usable.

With an OpenAI-compatible provider:

```bash
LLM_BASE_URL="https://api.openai.com/v1"
LLM_MODEL="gpt-5.6-luna"
LLM_API_KEY="..."
```

Fal image generation keeps the uploaded snap as the visual source. The text model remains available as a cheap fallback,
while profile and banner art use an image-to-image edit model by default:

```bash
FAL_KEY="..."
FAL_IMAGE_MODEL="fal-ai/flux/schnell"
FAL_IMAGE_EDIT_MODEL="fal-ai/flux-kontext/dev"
```

## Public Release Notes

Keep the repository private until the checklist in [docs/PUBLIC_RELEASE.md](docs/PUBLIC_RELEASE.md) is complete.

Product direction and next-session UX work are tracked in [docs/CANON.md](docs/CANON.md).
