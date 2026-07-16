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
  createdAt?: string;
  updatedAt?: string;
};

export type LaunchRequest = {
  draftId: string;
  name: string;
  ticker: string;
  description: string;
  tokenomics: Tokenomics;
  acknowledgements: LaunchAcknowledgements;
};

export type LaunchAcknowledgements = {
  noInvestmentValue: true;
  noAffiliation: true;
  contentRights: true;
  jurisdictionAllowed: true;
  liveAdminControlled: true;
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

export type LaunchProofTimelineItem = {
  label: string;
  status: "complete" | "pending";
  timestamp?: string;
  detail?: string;
  txHash?: string;
  url?: string;
};

export type LaunchProof = {
  coinId: string;
  contractAddress: string;
  chainId: number;
  events: Array<{
    eventType: string;
    createdAt: string;
    payload: Record<string, unknown>;
  }>;
  launchEvent?: {
    eventType: string;
    createdAt: string;
    payload: Record<string, unknown>;
  };
  guardrails?: {
    version?: string;
    acceptedAt?: string;
    acknowledgements?: Record<string, unknown>;
  };
  timeline: LaunchProofTimelineItem[];
};
