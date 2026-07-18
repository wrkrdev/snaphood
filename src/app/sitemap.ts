import type { MetadataRoute } from "next";
import { listLaunchedCoins } from "@/lib/coins";
import { env } from "@/lib/env";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = env.appUrl.replace(/\/$/, "");
  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: `${baseUrl}/`,
      changeFrequency: "hourly",
      priority: 1
    },
    {
      url: `${baseUrl}/leaderboard`,
      changeFrequency: "hourly",
      priority: 0.7
    },
    {
      url: `${baseUrl}/stack`,
      changeFrequency: "daily",
      priority: 0.6
    }
  ];

  try {
    const coins = await listLaunchedCoins(1000);
    return [
      ...staticRoutes,
      ...coins.map((coin) => ({
        url: `${baseUrl}/coin/${coin.contractAddress}`,
        lastModified: new Date(coin.updatedAt),
        changeFrequency: "hourly" as const,
        priority: coin.dexscreenerUrl ? 0.9 : 0.75
      }))
    ];
  } catch {
    return staticRoutes;
  }
}
