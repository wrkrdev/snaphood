# Public Release Checklist

Before making SnapHood public:

- Confirm `.env.local` and generated upload folders are not committed.
- Rotate any key that was ever pasted into a shell, log, screenshot, or chat.
- Keep GitHub Actions CI green on `main`.
- Run `npm run verify:public-release` before changing repository visibility.
- Run `npm run verify:secrets` before changing repository visibility.
- Run `npm run verify:readiness -- --profile=public` and resolve every failure.
- Run `npm run db:migrate && npm run db:seed` on the deployment database.
- Confirm readiness reports `database integrity indexes` as passing.
- Verify response security headers through `npm run verify:smoke`.
- Verify cross-origin mutation protection through `npm run verify:smoke`.
- Verify unsafe upload rejection through `SNAPHOOD_SMOKE_GENERATE=true npm run verify:smoke`.
- Verify the public-mode upload-to-draft path through `npm run verify:generate`.
- Verify public profile, banner, and original image URLs return valid raster image bytes.
- Disable demo auth and verify Wrkr magic-link email delivery.
- Set `NEXT_PUBLIC_APP_URL` to the HTTPS URL from `wrkr expose` or your production domain.
- Verify Redis-backed rate limits are active for auth, generation, launch, and admin trading endpoints.
- Enable Wrkr storage with public asset URLs for uploaded and generated coin media.
- Run `npm run build && npm run prod:start` for first boot, or `npm run build && npm run prod:restart` for an existing process, then confirm `npm run prod:status` reports healthy.
- Schedule `npm run prod:ensure` with `crontab` as the production process watchdog.
- Schedule `SNAPHOOD_MAINTENANCE_DRY_RUN=false npm run db:maintenance` with `crontab`.
- Keep default `TOKEN_LAUNCH_MODE=demo` in `.env.example`.
- Verify launch acknowledgements cover jurisdiction, no-investment-value, content rights, and no-affiliation guardrails.
- Review `contracts/SnapHoodToken.sol` and keep `npm run contract:verify` green.
- Deploy to Robinhood Chain testnet before mainnet.
- Keep liquidity and indexer-swap execution admin-gated with a dry-run/confirmation step.
- Use a dedicated deployer wallet with low funds and no unrelated assets.
- Avoid Robinhood logos, proprietary marks, and any claim that the app is official.
