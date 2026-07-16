export type Tokenomics = {
  supply: string;
  decimals: number;
  allocation: Array<{
    label: string;
    percent: number;
  }>;
  notes: string[];
};

export type TokenDraft = {
  id: string;
  name: string;
  ticker: string;
  description: string;
  originalImageUrl: string;
  profileImageUrl: string;
  bannerImageUrl: string;
  tokenomics: Tokenomics;
  status: "draft" | "launching" | "launched" | "failed";
  contractAddress?: string;
  txHash?: string;
  chainId?: number;
};

export type LaunchRequest = {
  draftId: string;
  name: string;
  ticker: string;
  description: string;
  tokenomics: Tokenomics;
};

export type LaunchedCoin = {
  id: string;
  name: string;
  ticker: string;
  description: string;
  originalImageUrl?: string;
  profileImageUrl: string;
  bannerImageUrl: string;
  tokenomics?: unknown;
  contractAddress: string;
  txHash: string;
  chainId: number;
  status: string;
  createdAt: string;
  updatedAt: string;
  explorerUrl: string;
  txUrl?: string;
  poolAddress?: string;
  poolUrl?: string;
  positionId?: string;
  feeTier?: number;
  liquidityTokenAmount?: string;
  liquidityEthAmount?: string;
  liquidityTxHash?: string;
  swapTxHash?: string;
  dexscreenerUrl?: string;
  dexscreenerPair?: Record<string, unknown>;
  dexscreenerSyncedAt?: string;
};
