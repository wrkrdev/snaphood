# SnapHood Canon

## Product Intent

SnapHood should feel like a seamless snap-to-token launchpad for normal users, not a developer console. The core loop is:

1. Upload or capture a photo.
2. See a recognizable image remix and editable token draft.
3. Connect wallet only when needed.
4. Launch from the user's wallet.
5. Stay on a centered, celebratory launch status surface.
6. See proof, chart readiness, liquidity setup, and next actions in the same place — updating on their own.

Public proof matters, but proof should support the user journey rather than dominate it. Prefer labels like `Proof`, `Receipt`, `Chart`, `Launch`, and `Remix` over low-level words like `contract`, `tx`, `stack`, or chain internals in primary UI. Status must be **truthful**: never claim something is live before it actually is.

## Shipped (current as of 2026-07-18)

- **Rate limits**: every public and authenticated route has a deliberate policy — including magic-link `auth/verify` (brute-force cap), `auth/logout`, and every expensive read (`coins` feed, coin detail, `stats`, `proof`, `me`, `me/drafts`, `health`).
- **Snap → reveal**: uploading shows an entertaining "remixing" state (the snap on a scanning canvas, cycling status, progress bar), then one coherent reveal — a "your snap → coin remix" before/after, editable name/ticker (with a `$` affordance), meme angle, story, tokenomics, and a single launch action. The reveal scrolls itself into view (no more "stuck" layout with the image out of frame).
- **Tokenomics editor**: allocation is constrained so the split can never exceed 100%, shows the remaining amount, renders a graphical stacked bar with a per-row color legend, and supports add/remove split plus auto-balance. The AI's own suggested split now flows through (the model's `category`/`percentage` field names are mapped, instead of always falling back to the default split).
- **Launch flow**: launching shows staged progress (waiting for wallet → deploying → confirming → saving proof) and completes server-side with retries, so a slow block never leaves it stuck after the token has actually deployed. On success it reveals an in-place celebratory card (proof link, chart status, trading next-step, "snap another") — the user is never dropped into a disconnected toast.
- **Trading opens in one transaction**: `CreatorTradingPanel` is a clean, playful "trade card" (Give $TICKER its first market · Fund → Sign → Live · liquidity presets · formatted fees · details disclosure). It builds a single Position Manager `multicall` (create + initialize pool, mint liquidity, refund) with the ETH side sent as value and auto-wrapped — no separate wrap or WETH approve, and create+mint are atomic. New coins carry EIP-2612 permit, so the token approval is a signature folded into that one transaction; legacy coins fall back to one approve tx + the multicall. Proven on-chain on Robinhood Chain (4663).
- **Real-time, no manual refresh**: after the market opens, the coin page refreshes itself (`router.refresh()`) so the pool, status, and chart panel update in place. The chart panel auto-polls and refreshes the moment the pair is indexed.
- **Charts appear on their own**: a `dex:sync` cron records Dexscreener pairs server-side; an `index:swap` cron does one tiny real swap per newly-tradable pool (a fresh pool with only liquidity and no trades is never indexed). "Chart live" is shown **only when Dexscreener returns real pair data** — a recorded URL alone can 404, so until the pair exists it honestly reads "Chart soon / almost ready".
- **User-first language**: raw internals (`chart unlock pending`, estimate/pool/indexer-swap in primary UI) are gone; technical proof (contract, tx, pool, position, indexer swap) lives one layer below under a collapsed "Proof & contract details".
- **Public release**: MIT-licensed with a `SECURITY.md` and private vulnerability reporting; the working tree and full git history are secret-clean (real secrets live only in a git-ignored `.env.local`). The repo is public.

## How trading & charts work (canonical mechanics)

- **Tradable ≠ charted.** A coin is *tradable* once it has a pool (`poolAddress`). Its *chart is live* only once Dexscreener has `dexscreenerPair` data. Drive all "Chart live" UI off the pair, not the URL.
- **One multicall.** Liquidity is opened with a single `multicall([createAndInitializePoolIfNecessary, mint, refundETH])` on the Uniswap v3 Position Manager, value = the ETH side. Permit-enabled tokens prepend `selfPermitIfNecessary` (signed EIP-712) for a true single transaction.
- **Indexer swap.** Dexscreener needs an actual trade to index a pool, so `scripts/index-swap.mjs` seeds one tiny real swap per pool (once ever, bounded, with an ETH safety floor on the deployer). This spends deployer ETH; when low, it stops gracefully and coins stay tradable but un-charted until refunded.
- **Crons** (operational, not in the repo): `dex:sync` every 2 min, `index:swap` every 4 min, plus the watchdog and maintenance jobs.

## Still Open / Future Polish

- A real browser-wallet click-through of launch + "go live" (headless verification proves the on-chain mechanism via the deployer key, but can't drive a MetaMask popup).
- Auto-charting is bounded by deployer ETH; top it up (or make `index:swap` opt-in) if it should never pause.
- The launch timeline still surfaces `Uniswap pool` / `Indexer swap` labels — acceptable as proof context, but could be folded into the details block.
- Nice-to-haves: loading skeletons and an even richer signed-out first screen.

## UX Rules

- Keep the first screen usable, not explanatory.
- Keep technical proof available, but one layer below the main user action.
- Do not expose raw implementation concepts unless needed for trust or wallet confirmation.
- Every launch/trading status should answer: what happened, what is happening now, and what should I do next — and update itself, not wait for a refresh.
- Status must be truthful — never claim "live" before it is actually live.
- Mobile and desktop must both feel first-class.
