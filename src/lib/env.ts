export const env = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  databaseUrl: process.env.DATABASE_URL ?? "",
  redisUrl: process.env.REDIS_URL ?? "",
  sessionSecret: process.env.SNAPHOOD_SESSION_SECRET ?? "snaphood-local-demo-secret",
  demoAuthEnabled: process.env.SNAPHOOD_DEMO_AUTH_ENABLED !== "false",
  authEmailMode: process.env.SNAPHOOD_AUTH_EMAIL_MODE ?? "dry-run",
  authEmailFrom: process.env.SNAPHOOD_AUTH_EMAIL_FROM ?? "",
  authMagicLinkTtlMinutes: Number(process.env.SNAPHOOD_AUTH_MAGIC_LINK_TTL_MINUTES ?? "15"),
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
  falImageEditModel: process.env.FAL_IMAGE_EDIT_MODEL ?? "fal-ai/flux-kontext/dev",
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
  tradingPositionId: process.env.TRADING_POSITION_ID ?? "",
  robinhoodWethAddress: process.env.ROBINHOOD_WETH_ADDRESS ?? "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
  uniswapV3Factory: process.env.UNISWAP_V3_FACTORY ?? "0x1f7d7550b1b028f7571e69a784071f0205fd2efa",
  uniswapV3PositionManager: process.env.UNISWAP_V3_POSITION_MANAGER ?? "0x73991a25c818bf1f1128deaab1492d45638de0d3",
  uniswapV3SwapRouter: process.env.UNISWAP_V3_SWAP_ROUTER_02 ?? "0xcaf681a66d020601342297493863e78c959e5cb2",
  uniswapV3Fee: Number(process.env.UNISWAP_V3_FEE ?? "10000"),
  liquidityTokenAmount: process.env.LIQUIDITY_TOKEN_AMOUNT ?? "1000000",
  liquidityEthAmount: process.env.LIQUIDITY_ETH_AMOUNT ?? "0.0001",
  indexSwapEthAmount: process.env.SWAP_ETH_AMOUNT ?? "0.00001"
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
    publicStorageUploads: env.wrkrStoragePublicUploads,
    chain: Boolean(env.robinhoodRpcUrl),
    deployer: Boolean(env.deployerPrivateKey),
    adminConfigured: env.adminEmails.length > 0,
    demoAuthEnabled: env.demoAuthEnabled,
    authEmailMode: env.authEmailMode,
    launchMode: env.launchMode,
    network: env.robinhoodNetwork,
    chainId: env.robinhoodChainId
  };
}
