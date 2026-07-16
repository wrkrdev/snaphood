import { Activity, Brain, Database, HardDrive, Mail, Network, ShieldCheck, WalletCards } from "lucide-react";
import { getReadiness } from "@/lib/env";
import { hasDatabase, query } from "@/lib/db";
import { hasWrkrStorageCli, pingRedis } from "@/lib/runtime-readiness";

export default async function StackPage() {
  const readiness = getReadiness();
  const [databaseReachable, cacheReachable, storageCliAvailable] = await Promise.all([
    hasDatabase(),
    pingRedis(),
    hasWrkrStorageCli()
  ]);
  const counts = databaseReachable
    ? await query<{ users: string; launches: string; trading_rows: string }>(
        `
          select
            (select count(*)::text from snaphood_users) as users,
            (select count(*)::text from snaphood_token_drafts where status = 'launched') as launches,
            (select count(*)::text from snaphood_token_trading) as trading_rows
        `
      )
    : null;
  const row = counts?.rows[0];

  const items = [
    { icon: Database, label: "Wrkr Postgres", value: databaseReachable ? "connected" : "offline", detail: `${row?.users ?? 0} users · ${row?.launches ?? 0} launches` },
    {
      icon: Activity,
      label: "Wrkr Redis",
      value: readiness.cache ? (cacheReachable ? "connected" : "offline") : "missing",
      detail: cacheReachable ? "distributed rate limits active" : "memory fallback for local-only use"
    },
    {
      icon: HardDrive,
      label: "Wrkr Storage",
      value: readiness.storage ? (storageCliAvailable ? "available" : "missing CLI") : "local mode",
      detail: readiness.publicStorageUploads ? "public asset URLs" : "uploads and generated assets"
    },
    { icon: Brain, label: "OpenAI + Fal", value: readiness.ai && readiness.imageAi ? "live" : "fallback", detail: "vision metadata and image generation" },
    { icon: Network, label: "Robinhood Chain", value: readiness.chain ? `${readiness.chainId}` : "missing", detail: `${readiness.network} RPC` },
    { icon: WalletCards, label: "Deployer", value: readiness.deployer ? "configured" : "missing", detail: readiness.adminConfigured ? "admin gated" : "admin missing" },
    { icon: ShieldCheck, label: "Launch mode", value: readiness.launchMode, detail: "demo/testnet/mainnet controlled by env" },
    {
      icon: Mail,
      label: "Auth email",
      value: readiness.demoAuthEnabled ? "demo" : readiness.authEmailMode,
      detail: readiness.demoAuthEnabled ? "instant local sessions" : "magic-link sign in"
    }
  ];

  return (
    <main className="stack-page">
      <section className="stack-hero">
        <p className="eyebrow">Wrkr proof</p>
        <h1>Full-stack launchpad running on one workstation.</h1>
        <p>
          SnapHood uses the local Wrkr primitives for the app backend, while AI and Robinhood Chain integrations prove
          the path from photo upload to tradable token.
        </p>
      </section>
      <section className="stack-grid">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <article className="stack-card" key={item.label}>
              <Icon size={20} />
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <p>{item.detail}</p>
            </article>
          );
        })}
      </section>
    </main>
  );
}
