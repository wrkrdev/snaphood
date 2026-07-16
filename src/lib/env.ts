export const env = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  databaseUrl: process.env.DATABASE_URL ?? "",
  redisUrl: process.env.REDIS_URL ?? "",
  sessionSecret: process.env.SNAPHOOD_SESSION_SECRET ?? "snaphood-local-demo-secret",
  demoAuthEnabled: process.env.SNAPHOOD_DEMO_AUTH_ENABLED !== "false",
  adminEmails: (process.env.SNAPHOOD_ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),
  llmProvider: process.env.LLM_PROVIDER ?? "openai",
  llmBaseUrl: process.env.LLM_BASE_URL ?? "https://api.openai.com/v1",
  llmModel: process.env.LLM_MODEL ?? "gpt-5.6-luna",
  llmApiKey: process.env.LLM_API_KEY ?? "",
  imageModel: process.env.IMAGE_MODEL ?? "fal-ai/flux/schnell",
  falKey: process.env.FAL_KEY ?? "",
  falImageModel: process.env.FAL_IMAGE_MODEL ?? process.env.IMAGE_MODEL ?? "fal-ai/flux/schnell",
  wrkrStorageEnabled: process.env.WRKR_STORAGE_ENABLED === "true",
  wrkrStoragePublicUploads: process.env.WRKR_STORAGE_PUBLIC_UPLOADS === "true",
  robinhoodNetwork: process.env.ROBINHOOD_NETWORK ?? "testnet",
  robinhoodRpcUrl: process.env.ROBINHOOD_RPC_URL ?? "https://rpc.testnet.chain.robinhood.com",
  robinhoodChainId: Number(process.env.ROBINHOOD_CHAIN_ID ?? "46630"),
  robinhoodBlockExplorerUrl:
    process.env.ROBINHOOD_BLOCK_EXPLORER_URL ?? "https://explorer.testnet.chain.robinhood.com",
  deployerPrivateKey: process.env.DEPLOYER_PRIVATE_KEY ?? "",
  deployerAddress: process.env.DEPLOYER_ADDRESS ?? "",
  launchMode: process.env.TOKEN_LAUNCH_MODE ?? "demo",
  defaultTokenSupply: process.env.DEFAULT_TOKEN_SUPPLY ?? "1000000000",
  defaultTokenDecimals: Number(process.env.DEFAULT_TOKEN_DECIMALS ?? "18"),
  tradingTokenAddress: process.env.TRADING_TOKEN_ADDRESS ?? "",
  tradingPoolAddress: process.env.TRADING_POOL_ADDRESS ?? "",
  tradingPositionId: process.env.TRADING_POSITION_ID ?? ""
};

export function isAdminEmail(email: string) {
  return env.adminEmails.includes(email.trim().toLowerCase());
}

export function getReadiness() {
  return {
    database: Boolean(env.databaseUrl),
    cache: Boolean(env.redisUrl),
    ai: Boolean(env.llmApiKey),
    imageAi: Boolean(env.falKey),
    storage: env.wrkrStorageEnabled,
    chain: Boolean(env.robinhoodRpcUrl),
    deployer: Boolean(env.deployerPrivateKey),
    adminConfigured: env.adminEmails.length > 0,
    launchMode: env.launchMode,
    network: env.robinhoodNetwork,
    chainId: env.robinhoodChainId
  };
}
