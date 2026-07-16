import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  formatEther,
  formatUnits,
  getAddress,
  http,
  parseEther,
  parseEventLogs,
  parseUnits,
  type Address,
  type Hex,
  type TransactionReceipt
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "@/lib/env";

const zeroAddress = "0x0000000000000000000000000000000000000000";

const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" }
    ],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  }
] as const;

const wethAbi = [
  ...erc20Abi,
  {
    type: "function",
    name: "deposit",
    stateMutability: "payable",
    inputs: [],
    outputs: []
  }
] as const;

const factoryAbi = [
  {
    type: "function",
    name: "getPool",
    stateMutability: "view",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "fee", type: "uint24" }
    ],
    outputs: [{ name: "pool", type: "address" }]
  }
] as const;

const positionManagerAbi = [
  {
    type: "function",
    name: "createAndInitializePoolIfNecessary",
    stateMutability: "payable",
    inputs: [
      { name: "token0", type: "address" },
      { name: "token1", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "sqrtPriceX96", type: "uint160" }
    ],
    outputs: [{ name: "pool", type: "address" }]
  },
  {
    type: "function",
    name: "mint",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "token0", type: "address" },
          { name: "token1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickLower", type: "int24" },
          { name: "tickUpper", type: "int24" },
          { name: "amount0Desired", type: "uint256" },
          { name: "amount1Desired", type: "uint256" },
          { name: "amount0Min", type: "uint256" },
          { name: "amount1Min", type: "uint256" },
          { name: "recipient", type: "address" },
          { name: "deadline", type: "uint256" }
        ]
      }
    ],
    outputs: [
      { name: "tokenId", type: "uint256" },
      { name: "liquidity", type: "uint128" },
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" }
    ]
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { indexed: true, name: "from", type: "address" },
      { indexed: true, name: "to", type: "address" },
      { indexed: true, name: "tokenId", type: "uint256" }
    ]
  }
] as const;

const routerAbi = [
  {
    type: "function",
    name: "exactInputSingle",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" }
        ]
      }
    ],
    outputs: [{ name: "amountOut", type: "uint256" }]
  }
] as const;

type TradingStep = {
  label: string;
  to: Address;
  value?: bigint;
  data: Hex;
};

export type ExecutedStep = {
  label: string;
  hash: Hex;
  status: TransactionReceipt["status"];
};

export type TradingCoinInput = {
  contractAddress: string;
  ticker: string;
  decimals: number;
};

type TradingOptions = {
  execute?: boolean;
  tokenAmount?: string;
  ethAmount?: string;
};

export async function planOrSeedLiquidity(coin: TradingCoinInput, options: TradingOptions = {}) {
  const ctx = getTradingContext();
  const token = getAddress(coin.contractAddress);
  const decimals = coin.decimals;
  const tokenAmountLabel = options.tokenAmount ?? env.liquidityTokenAmount;
  const ethAmountLabel = options.ethAmount ?? env.liquidityEthAmount;
  const tokenAmount = parseUnits(tokenAmountLabel.replace(/,/g, ""), decimals);
  const ethAmount = parseEther(ethAmountLabel);
  const token0 = compareAddresses(ctx.weth, token) < 0 ? ctx.weth : token;
  const token1 = token0 === ctx.weth ? token : ctx.weth;
  const amount0Desired = token0 === ctx.weth ? ethAmount : tokenAmount;
  const amount1Desired = token0 === ctx.weth ? tokenAmount : ethAmount;
  const sqrtPriceX96 = sqrt((amount1Desired << 192n) / amount0Desired);
  const tickSpacing = getTickSpacing(ctx.fee);
  const tickLower = Math.ceil(-887272 / tickSpacing) * tickSpacing;
  const tickUpper = Math.floor(887272 / tickSpacing) * tickSpacing;

  const [nativeBalance, tokenBalance, wethBalance, tokenAllowance, wethAllowance, existingPool] = await Promise.all([
    ctx.publicClient.getBalance({ address: ctx.account.address }),
    ctx.publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [ctx.account.address] }),
    ctx.publicClient.readContract({ address: ctx.weth, abi: erc20Abi, functionName: "balanceOf", args: [ctx.account.address] }),
    ctx.publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [ctx.account.address, ctx.positionManager]
    }),
    ctx.publicClient.readContract({
      address: ctx.weth,
      abi: erc20Abi,
      functionName: "allowance",
      args: [ctx.account.address, ctx.positionManager]
    }),
    ctx.publicClient.readContract({
      address: ctx.factory,
      abi: factoryAbi,
      functionName: "getPool",
      args: [token, ctx.weth, ctx.fee]
    })
  ]);

  if (tokenBalance < tokenAmount) {
    throw new Error(
      `Not enough ${coin.ticker}. Need ${formatUnits(tokenAmount, decimals)}, have ${formatUnits(tokenBalance, decimals)}.`
    );
  }

  const steps: TradingStep[] = [];
  if (wethBalance < ethAmount) {
    steps.push({
      label: "wrap ETH to WETH",
      to: ctx.weth,
      value: ethAmount - wethBalance,
      data: encodeFunctionData({ abi: wethAbi, functionName: "deposit" })
    });
  }

  if (wethAllowance < ethAmount) {
    steps.push({
      label: "approve WETH",
      to: ctx.weth,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [ctx.positionManager, ethAmount] })
    });
  }

  if (tokenAllowance < tokenAmount) {
    steps.push({
      label: `approve ${coin.ticker}`,
      to: token,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [ctx.positionManager, tokenAmount] })
    });
  }

  if (existingPool === zeroAddress) {
    steps.push({
      label: "create and initialize pool",
      to: ctx.positionManager,
      data: encodeFunctionData({
        abi: positionManagerAbi,
        functionName: "createAndInitializePoolIfNecessary",
        args: [token0, token1, ctx.fee, sqrtPriceX96]
      })
    });
  }

  steps.push({
    label: "mint liquidity position",
    to: ctx.positionManager,
    data: encodeFunctionData({
      abi: positionManagerAbi,
      functionName: "mint",
      args: [
        {
          token0,
          token1,
          fee: ctx.fee,
          tickLower,
          tickUpper,
          amount0Desired,
          amount1Desired,
          amount0Min: 0n,
          amount1Min: 0n,
          recipient: ctx.account.address,
          deadline: BigInt(Math.floor(Date.now() / 1000) + 60 * 20)
        }
      ]
    })
  });

  const dryRun = await estimateSteps(ctx, steps, nativeBalance);
  const response = {
    execute: Boolean(options.execute),
    account: ctx.account.address,
    token,
    weth: ctx.weth,
    factory: ctx.factory,
    positionManager: ctx.positionManager,
    fee: ctx.fee,
    token0,
    token1,
    tickLower,
    tickUpper,
    nativeBalanceEth: formatEther(nativeBalance),
    tokenBalance: formatUnits(tokenBalance, decimals),
    wethBalanceEth: formatEther(wethBalance),
    tokenAmount: tokenAmountLabel,
    ethAmount: ethAmountLabel,
    existingPool,
    steps: dryRun.steps,
    gasPriceWei: dryRun.gasPrice.toString(),
    estimatedGas: dryRun.estimatedGas.toString(),
    estimatedGasCostEth: formatEther(dryRun.estimatedGasCost),
    requiredNativeEth: formatEther(dryRun.requiredNative),
    enoughNative: nativeBalance > dryRun.requiredNative
  };

  if (!options.execute) {
    return {
      ...response,
      executed: [] as ExecutedStep[],
      poolAddress: existingPool === zeroAddress ? null : existingPool,
      positionId: undefined,
      liquidityTxHash: undefined
    };
  }

  const execution = await executeSteps(ctx, steps);
  const pool = await ctx.publicClient.readContract({
    address: ctx.factory,
    abi: factoryAbi,
    functionName: "getPool",
    args: [token, ctx.weth, ctx.fee]
  });

  return {
    ...response,
    executed: execution.executed,
    poolAddress: pool,
    positionId: execution.positionId,
    liquidityTxHash: execution.executed.find((step) => step.label === "mint liquidity position")?.hash
  };
}

export async function planOrRunIndexerSwap(coin: TradingCoinInput, options: Omit<TradingOptions, "tokenAmount"> = {}) {
  const ctx = getTradingContext();
  const token = getAddress(coin.contractAddress);
  const ethAmountLabel = options.ethAmount ?? env.indexSwapEthAmount;
  const ethAmount = parseEther(ethAmountLabel);

  const [nativeBalance, wethBalance, tokenBalance, wethAllowance] = await Promise.all([
    ctx.publicClient.getBalance({ address: ctx.account.address }),
    ctx.publicClient.readContract({ address: ctx.weth, abi: erc20Abi, functionName: "balanceOf", args: [ctx.account.address] }),
    ctx.publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [ctx.account.address] }),
    ctx.publicClient.readContract({
      address: ctx.weth,
      abi: erc20Abi,
      functionName: "allowance",
      args: [ctx.account.address, ctx.router]
    })
  ]);

  const steps: TradingStep[] = [];
  if (wethBalance < ethAmount) {
    steps.push({
      label: "wrap ETH to WETH",
      to: ctx.weth,
      value: ethAmount - wethBalance,
      data: encodeFunctionData({ abi: wethAbi, functionName: "deposit" })
    });
  }

  if (wethAllowance < ethAmount) {
    steps.push({
      label: "approve WETH to swap router",
      to: ctx.weth,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [ctx.router, ethAmount] })
    });
  }

  steps.push({
    label: `swap WETH to ${coin.ticker}`,
    to: ctx.router,
    data: encodeFunctionData({
      abi: routerAbi,
      functionName: "exactInputSingle",
      args: [
        {
          tokenIn: ctx.weth,
          tokenOut: token,
          fee: ctx.fee,
          recipient: ctx.account.address,
          amountIn: ethAmount,
          amountOutMinimum: 0n,
          sqrtPriceLimitX96: 0n
        }
      ]
    })
  });

  const dryRun = await estimateSteps(ctx, steps, nativeBalance);
  const response = {
    execute: Boolean(options.execute),
    account: ctx.account.address,
    token,
    weth: ctx.weth,
    router: ctx.router,
    fee: ctx.fee,
    nativeBalanceEth: formatEther(nativeBalance),
    wethBalanceEth: formatEther(wethBalance),
    tokenBalance: formatUnits(tokenBalance, coin.decimals),
    swapEthAmount: ethAmountLabel,
    steps: dryRun.steps,
    gasPriceWei: dryRun.gasPrice.toString(),
    estimatedGas: dryRun.estimatedGas.toString(),
    estimatedGasCostEth: formatEther(dryRun.estimatedGasCost),
    requiredNativeEth: formatEther(dryRun.requiredNative),
    enoughNative: nativeBalance > dryRun.requiredNative
  };

  if (!options.execute) {
    return { ...response, executed: [] as ExecutedStep[], swapTxHash: undefined };
  }

  const execution = await executeSteps(ctx, steps);
  return {
    ...response,
    executed: execution.executed,
    swapTxHash: execution.executed.find((step) => step.label === `swap WETH to ${coin.ticker}`)?.hash
  };
}

export async function fetchDexscreenerPair(poolAddress: string) {
  const pool = getAddress(poolAddress);
  const url = `https://api.dexscreener.com/latest/dex/pairs/robinhood/${pool}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Dexscreener fetch failed with ${response.status}.`);
  }

  const data = (await response.json()) as { pair?: Record<string, unknown> | null; pairs?: Record<string, unknown>[] };
  const pair = data.pair ?? data.pairs?.[0] ?? null;
  const pairUrl =
    typeof pair?.url === "string" ? pair.url : `https://dexscreener.com/robinhood/${pool.toLowerCase()}`;

  return { pair, dexscreenerUrl: pairUrl };
}

function getTradingContext() {
  if (!env.deployerPrivateKey) {
    throw new Error("DEPLOYER_PRIVATE_KEY is required for trading operations.");
  }

  if (!env.robinhoodRpcUrl) {
    throw new Error("ROBINHOOD_RPC_URL is required for trading operations.");
  }

  if (env.robinhoodChainId !== 4663) {
    throw new Error(`Refusing live trading on chain ${env.robinhoodChainId}; expected Robinhood Chain mainnet 4663.`);
  }

  const account = privateKeyToAccount(env.deployerPrivateKey as Hex);
  const chain = defineChain({
    id: env.robinhoodChainId,
    name: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [env.robinhoodRpcUrl] } },
    blockExplorers: { default: { name: "Robinhood Blockscout", url: env.robinhoodBlockExplorerUrl } }
  });

  const publicClient = createPublicClient({ chain, transport: http(env.robinhoodRpcUrl) });
  const walletClient = createWalletClient({ account, chain, transport: http(env.robinhoodRpcUrl) });

  return {
    account,
    publicClient,
    walletClient,
    weth: getAddress(env.robinhoodWethAddress),
    factory: getAddress(env.uniswapV3Factory),
    positionManager: getAddress(env.uniswapV3PositionManager),
    router: getAddress(env.uniswapV3SwapRouter),
    fee: env.uniswapV3Fee
  };
}

async function estimateSteps(
  ctx: ReturnType<typeof getTradingContext>,
  steps: TradingStep[],
  nativeBalance: bigint
) {
  const gasPrice = await ctx.publicClient.getGasPrice();
  let estimatedGas = 0n;
  const estimatedSteps = [];

  for (const step of steps) {
    try {
      const gas = await ctx.publicClient.estimateGas({
        account: ctx.account.address,
        to: step.to,
        value: step.value ?? 0n,
        data: step.data
      });
      estimatedGas += gas;
      estimatedSteps.push({ label: step.label, estimatedGas: gas.toString(), estimable: true });
    } catch (error) {
      estimatedSteps.push({
        label: step.label,
        estimatedGas: null,
        estimable: false,
        reason: error instanceof Error ? error.message : "Gas estimate failed."
      });
    }
  }

  const estimatedGasCost = estimatedGas * gasPrice;
  const requiredNative =
    estimatedGasCost + steps.reduce((sum, step) => sum + (step.value ?? 0n), 0n);

  return {
    gasPrice,
    estimatedGas,
    estimatedGasCost,
    requiredNative,
    enoughNative: nativeBalance > requiredNative,
    steps: estimatedSteps
  };
}

async function executeSteps(ctx: ReturnType<typeof getTradingContext>, steps: TradingStep[]) {
  const gasPrice = await ctx.publicClient.getGasPrice();
  const executed: ExecutedStep[] = [];
  let positionId: string | undefined;

  for (const step of steps) {
    const gas = await ctx.publicClient.estimateGas({
      account: ctx.account.address,
      to: step.to,
      value: step.value ?? 0n,
      data: step.data
    });
    const latestBalance = await ctx.publicClient.getBalance({ address: ctx.account.address });
    const estimatedCost = gas * gasPrice + (step.value ?? 0n);
    if (latestBalance <= estimatedCost) {
      throw new Error(
        `Not enough ETH for ${step.label}. Need about ${formatEther(estimatedCost)}, have ${formatEther(latestBalance)}.`
      );
    }

    const hash = await ctx.walletClient.sendTransaction({
      account: ctx.account,
      to: step.to,
      value: step.value ?? 0n,
      data: step.data
    });
    const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
    executed.push({ label: step.label, hash, status: receipt.status });

    if (step.label === "mint liquidity position") {
      positionId = readPositionId(receipt, ctx.positionManager, ctx.account.address);
    }
  }

  return { executed, positionId };
}

function readPositionId(receipt: TransactionReceipt, positionManager: Address, recipient: Address) {
  const logs = parseEventLogs({
    abi: positionManagerAbi,
    logs: receipt.logs,
    eventName: "Transfer"
  });
  const transfer = logs.find(
    (log) =>
      log.address.toLowerCase() === positionManager.toLowerCase() &&
      log.args.from.toLowerCase() === zeroAddress &&
      log.args.to.toLowerCase() === recipient.toLowerCase()
  );

  return transfer?.args.tokenId?.toString();
}

function getTickSpacing(fee: number) {
  if (fee === 100) return 1;
  if (fee === 500) return 10;
  if (fee === 3000) return 60;
  return 200;
}

function compareAddresses(left: Address, right: Address) {
  const a = BigInt(left.toLowerCase());
  const b = BigInt(right.toLowerCase());
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function sqrt(value: bigint) {
  if (value < 0n) throw new Error("Square root only works on non-negative values.");
  if (value < 2n) return value;
  let x0 = value / 2n;
  let x1 = (x0 + value / x0) / 2n;
  while (x1 < x0) {
    x0 = x1;
    x1 = (x0 + value / x0) / 2n;
  }
  return x0;
}
