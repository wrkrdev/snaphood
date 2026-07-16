import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Activity, ExternalLink, Flame, ShieldCheck, WalletCards } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { getLaunchedCoin, getLaunchProof } from "@/lib/coins";
import { env, isAdminEmail } from "@/lib/env";
import { AdminTradingPanel } from "@/components/AdminTradingPanel";
import type { Tokenomics } from "@/lib/types";

export async function generateMetadata({ params }: { params: Promise<{ contract: string }> }): Promise<Metadata> {
  const { contract } = await params;
  const coin = await getLaunchedCoin(contract);

  if (!coin) {
    return {
      title: "Coin not found"
    };
  }

  const title = `${coin.name} ($${coin.ticker})`;
  const description = coin.description;
  const path = `/coin/${coin.contractAddress}`;
  const imageUrl = absoluteUrl(coin.bannerImageUrl);

  return {
    title,
    description,
    alternates: {
      canonical: path
    },
    openGraph: {
      title,
      description,
      url: path,
      siteName: "SnapHood",
      type: "article",
      images: [
        {
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: `${coin.name} banner`
        }
      ]
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imageUrl]
    }
  };
}

export default async function CoinPage({ params }: { params: Promise<{ contract: string }> }) {
  const { contract } = await params;
  const [coin, proof] = await Promise.all([getLaunchedCoin(contract), getLaunchProof(contract)]);

  if (!coin) {
    notFound();
  }

  const user = await getCurrentUser();
  const isAdmin = user ? isAdminEmail(user.email) : false;

  const pair = coin.dexscreenerPair as
    | {
        priceUsd?: string;
        liquidity?: { usd?: number; base?: number; quote?: number };
        volume?: { h24?: number };
        txns?: { h24?: { buys?: number; sells?: number } };
        fdv?: number;
        marketCap?: number;
      }
    | undefined;
  const tokenomics = parseTokenomics(coin.tokenomics);

  return (
    <main className="coin-page">
      <section className="coin-hero-detail">
        <div className="coin-hero-media">
          <img src={coin.bannerImageUrl} alt="" />
        </div>
        <div className="coin-hero-copy">
          <img className="coin-hero-avatar" src={coin.profileImageUrl} alt="" />
          <div>
            <p className="eyebrow">SnapHood launch</p>
            <h1>{coin.name}</h1>
            <p className="coin-symbol">${coin.ticker}</p>
          </div>
          <p className="coin-detail-description">{coin.description}</p>
          <div className="coin-detail-actions">
            <a className="btn primary" href={coin.dexscreenerUrl ?? coin.explorerUrl} target="_blank" rel="noreferrer">
              <Flame size={16} />
              {coin.dexscreenerUrl ? "Open chart" : "Open contract"}
            </a>
            <a className="btn ghost" href={coin.explorerUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={16} />
              Contract
            </a>
          </div>
        </div>
      </section>

      <section className="coin-detail-grid">
        <div className="detail-stat">
          <Activity size={18} />
          <span>Price</span>
          <strong>{pair?.priceUsd ? `$${pair.priceUsd}` : "pending"}</strong>
        </div>
        <div className="detail-stat">
          <WalletCards size={18} />
          <span>Liquidity</span>
          <strong>{pair?.liquidity?.usd ? `$${pair.liquidity.usd.toFixed(2)}` : "pending"}</strong>
        </div>
        <div className="detail-stat">
          <Flame size={18} />
          <span>24h volume</span>
          <strong>{pair?.volume?.h24 ? `$${pair.volume.h24.toFixed(2)}` : "pending"}</strong>
        </div>
        <div className="detail-stat">
          <ShieldCheck size={18} />
          <span>Chain</span>
          <strong>{coin.chainId}</strong>
        </div>
      </section>

      {!coin.poolAddress ? (
        <section className="trade-status">
          <div>
            <p className="eyebrow">not tradable yet</p>
            <h2>Pool needed for Dexscreener</h2>
          </div>
          <p>
            This token contract is deployed on-chain, but it does not have a recorded Uniswap pool, liquidity position, or
            indexer swap. Dexscreener usually appears after a real pool exists and indexing sees trading activity.
          </p>
        </section>
      ) : !coin.dexscreenerUrl ? (
        <section className="trade-status">
          <div>
            <p className="eyebrow">indexing pending</p>
            <h2>Pool recorded, chart pending</h2>
          </div>
          <p>
            A pool is recorded for this token, but Dexscreener has not returned a pair URL yet. Sync again after the indexer
            sees the pool and swap activity.
          </p>
        </section>
      ) : null}

      <section className="coin-ledger">
        <h2>Launch Proof</h2>
        <dl>
          <div>
            <dt>Token contract</dt>
            <dd>{coin.contractAddress}</dd>
          </div>
          <div>
            <dt>Deploy tx</dt>
            <dd>{coin.txHash}</dd>
          </div>
          {proof ? (
            <div>
              <dt>Proof fingerprint</dt>
              <dd className="proof-hash">
                <code>{proof.proofHash}</code>
                <span>{proof.proofVersion}</span>
              </dd>
            </div>
          ) : null}
          {coin.poolAddress ? (
            <div>
              <dt>Uniswap pool</dt>
              <dd>{coin.poolAddress}</dd>
            </div>
          ) : null}
          {coin.positionId ? (
            <div>
              <dt>LP position</dt>
              <dd>{coin.positionId}</dd>
            </div>
          ) : null}
          {coin.swapTxHash ? (
            <div>
              <dt>Indexer swap</dt>
              <dd>{coin.swapTxHash}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      {tokenomics ? (
        <section className="coin-tokenomics">
          <div className="proof-head">
            <div>
              <p className="eyebrow">launch config</p>
              <h2>Tokenomics</h2>
            </div>
            <div className="tokenomics-supply">
              <span>Supply</span>
              <strong>{formatSupply(tokenomics.supply)}</strong>
              <em>{tokenomics.decimals} decimals</em>
            </div>
          </div>
          <div className="allocation-bars">
            {tokenomics.allocation.map((row) => (
              <div className="allocation-item" key={row.label}>
                <div>
                  <strong>{row.label}</strong>
                  <span>{row.percent}%</span>
                </div>
                <span className="allocation-track">
                  <span style={{ width: `${Math.max(0, Math.min(row.percent, 100))}%` }} />
                </span>
              </div>
            ))}
          </div>
          {tokenomics.notes.length > 0 ? (
            <ul className="tokenomics-notes">
              {tokenomics.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {proof ? (
        <section className="proof-timeline">
          <div className="proof-head">
            <div>
              <p className="eyebrow">public proof</p>
              <h2>Audit Timeline</h2>
            </div>
            <a className="btn ghost small" href={`/api/coins/${coin.contractAddress}/proof`} target="_blank" rel="noreferrer">
              <ExternalLink size={14} />
              JSON
            </a>
          </div>
          <ol>
            {proof.timeline.map((item) => (
              <li className={item.status === "complete" ? "proof-step complete" : "proof-step pending"} key={item.label}>
                <span className="proof-dot" />
                <div>
                  <div className="proof-step-top">
                    <strong>{item.label}</strong>
                    <em>{item.status}</em>
                  </div>
                  {item.detail ? <p>{item.detail}</p> : null}
                  {item.timestamp ? <time dateTime={item.timestamp}>{new Date(item.timestamp).toLocaleString()}</time> : null}
                  {item.url ? (
                    <a href={item.url} target="_blank" rel="noreferrer">
                      {item.txHash ? "Open tx" : "Open proof"} <ExternalLink size={13} />
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {isAdmin ? (
        <AdminTradingPanel
          contractAddress={coin.contractAddress}
          isTradable={Boolean(coin.poolAddress)}
          hasIndexerSwap={Boolean(coin.swapTxHash)}
        />
      ) : null}
    </main>
  );
}

function absoluteUrl(value: string) {
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value;
  }

  const base = env.appUrl.replace(/\/$/, "");
  return `${base}${value.startsWith("/") ? value : `/${value}`}`;
}

function parseTokenomics(value: unknown): Tokenomics | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Partial<Tokenomics>;
  const decimals = Number(input.decimals);
  const allocation = Array.isArray(input.allocation)
    ? input.allocation
        .map((row) => ({
          label: String(row.label ?? "").trim().slice(0, 60),
          percent: Number(row.percent)
        }))
        .filter((row) => row.label && Number.isFinite(row.percent) && row.percent >= 0 && row.percent <= 100)
    : [];

  return {
    supply: String(input.supply ?? ""),
    decimals: Number.isInteger(decimals) ? decimals : 18,
    allocation,
    notes: Array.isArray(input.notes) ? input.notes.map((note) => String(note).trim()).filter(Boolean).slice(0, 5) : []
  };
}

function formatSupply(value: string) {
  const normalized = value.replace(/,/g, "");
  if (!/^\d+$/.test(normalized)) return value;
  return new Intl.NumberFormat("en-US", { notation: normalized.length > 9 ? "compact" : "standard" }).format(
    Number(normalized)
  );
}
