# Public Release Checklist

Before making SnapHood public:

- Confirm `.env.local` and generated upload folders are not committed.
- Rotate any key that was ever pasted into a shell, log, screenshot, or chat.
- Disable demo auth and verify Wrkr magic-link email delivery.
- Verify Redis-backed rate limits are active for auth, generation, launch, and admin trading endpoints.
- Keep default `TOKEN_LAUNCH_MODE=demo` in `.env.example`.
- Verify launch acknowledgements cover jurisdiction, no-investment-value, content rights, and no-affiliation guardrails.
- Review `contracts/SnapHoodToken.sol` and use a reproducible compile/deploy script.
- Deploy to Robinhood Chain testnet before mainnet.
- Keep liquidity and indexer-swap execution admin-gated with a dry-run/confirmation step.
- Use a dedicated deployer wallet with low funds and no unrelated assets.
- Avoid Robinhood logos, proprietary marks, and any claim that the app is official.
