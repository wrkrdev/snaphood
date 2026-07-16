import { notFound } from "next/navigation";
import { Activity, ExternalLink, Flame, ShieldCheck, WalletCards } from "lucide-react";
import { getLaunchedCoin } from "@/lib/coins";

export default async function CoinPage({ params }: { params: Promise<{ contract: string }> }) {
  const { contract } = await params;
  const coin = await getLaunchedCoin(contract);

  if (!coin) {
    notFound();
  }

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
    </main>
  );
}
