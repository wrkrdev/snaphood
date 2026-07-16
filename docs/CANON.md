# SnapHood Canon

## Product Intent

SnapHood should feel like a seamless snap-to-token launchpad for normal users, not a developer console. The core loop is:

1. Upload or capture a photo.
2. See a recognizable image remix and editable token draft.
3. Connect wallet only when needed.
4. Launch from the user's wallet.
5. Stay on a centered, celebratory launch status surface.
6. See proof, chart readiness, liquidity setup, and next actions in the same place.

Public proof matters, but proof should support the user journey rather than dominate it. Prefer labels like `Proof`, `Receipt`, `Chart`, `Launch`, and `Remix` over low-level words like `contract`, `tx`, `stack`, or chain internals in primary UI.

## Shipped (2026-07-16 UX pass)

- Rate limits: every public and authenticated route now has a deliberate policy, including the previously uncovered magic-link `auth/verify` (brute-force cap), `auth/logout`, and every expensive read (`coins` feed, coin detail, `stats`, `proof`, `me`, `me/drafts`, `health`).
- Upload-to-draft reveal: the post-upload state is now one coherent panel — a "your snap → coin remix" before/after, editable name/ticker (with a `$` affordance), meme angle, story, tokenomics, and a single confident launch action.
- Tokenomics editor: allocation is constrained so the split can never exceed 100%, shows the remaining amount, renders a graphical stacked allocation bar with per-row color legend, and supports add/remove split plus an auto-balance affordance.
- Launch completion: launching now reveals an in-place success card (celebration, proof link, chart status, trading next-step, and "snap another") instead of a disconnected toast.
- Chart/liquidity language: `chart unlock pending` and other internals are gone from primary UI; the feed and coin page speak in "Chart live / New launch / Chart soon", and the Dexscreener sync is now a friendly "Your chart is almost ready" panel.
- Wallet/trading flow: `CreatorTradingPanel` is a guided connect → choose liquidity → confirm-in-wallet flow with plain-language field labels; costs, gas, and step internals are tucked under a "What this costs & the steps" details disclosure. Raw contract/tx/pool proof on the coin page now lives under a collapsed "Proof & contract details".

## Still Open / Future Polish

- The launch timeline still surfaces `Uniswap pool` / `Indexer swap` labels; acceptable as proof context, but could be softened further or fully folded into a details block.
- End-to-end wallet launch and liquidity seeding still need a funded-wallet run to verify on-chain (headless verification covers UI and validation only).
- Nice-to-haves: loading skeletons, subtle motion on the reveal/success states, and a richer signed-out first screen.

## UX Rules

- Keep the first screen usable, not explanatory.
- Keep technical proof available, but one layer below the main user action.
- Do not expose raw implementation concepts unless needed for trust or wallet confirmation.
- Every launch status should answer: what happened, what is happening now, and what should I do next?
- Mobile and desktop must both feel first-class.
