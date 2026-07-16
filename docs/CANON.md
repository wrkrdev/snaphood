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

## Next Session Priorities

- Rate limits: audit every public and authenticated route and ensure every mutation, AI/image action, auth action, launch/trading action, sync action, and expensive read has a deliberate rate-limit policy.
- Upload-to-draft UI: the post-upload state currently feels scattered and pale. Rework it into a polished reveal with the original snap, image remix, name/ticker, meme angle, tokenomics, and primary next action in one coherent panel.
- Tokenomics editor: make allocation editing logical and constrained. Percentages must not exceed 100, should communicate the remaining amount, and should include a clean graphical allocation representation.
- Launch completion: after launch, keep the user centered in the same flow. Do not jump the user into a disconnected receipt/toast state. Show launch success, proof, chart status, liquidity/trading status, and next action in-place.
- Chart readiness: `chart unlock pending` is not understandable enough. Explain the actual status in user language and surface the next best action without making the user guess.
- Wallet/trading flow: `Connect Wallet`, `Estimate`, liquidity setup, and chart sync need to become a single guided flow. New users should not need to understand estimates, pools, indexer swaps, or Dexscreener sync internals.
- Visual polish: make the app feel richer and more entertaining without adding complex new systems. Add stronger image treatment, allocation graphics, clearer progress states, and a more confident launchpad layout.

## UX Rules

- Keep the first screen usable, not explanatory.
- Keep technical proof available, but one layer below the main user action.
- Do not expose raw implementation concepts unless needed for trust or wallet confirmation.
- Every launch status should answer: what happened, what is happening now, and what should I do next?
- Mobile and desktop must both feel first-class.
