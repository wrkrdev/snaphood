import { config } from "dotenv";
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
  parseUnits
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

config({ path: ".env.local" });

const SNAPG = getAddress(process.env.TRADING_TOKEN_ADDRESS ?? "0xce0213831ddf77fae87da578efe0ddae2b0218d0");
const WETH = getAddress(process.env.ROBINHOOD_WETH_ADDRESS ?? "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
const POSITION_MANAGER = getAddress(
  process.env.UNISWAP_V3_POSITION_MANAGER ?? "0x73991a25c818bf1f1128deaab1492d45638de0d3"
);
const FACTORY = getAddress(process.env.UNISWAP_V3_FACTORY ?? "0x1f7d7550b1b028f7571e69a784071f0205fd2efa");
const FEE = Number(process.env.UNISWAP_V3_FEE ?? "10000");
const TICK_SPACING = FEE === 100 ? 1 : FEE === 500 ? 10 : FEE === 3000 ? 60 : 200;
const TICK_LOWER = Math.ceil(-887272 / TICK_SPACING) * TICK_SPACING;
const TICK_UPPER = Math.floor(887272 / TICK_SPACING) * TICK_SPACING;
const TOKEN_AMOUNT = parseUnits(process.env.LIQUIDITY_TOKEN_AMOUNT ?? "1000000", 18);
const ETH_AMOUNT = parseEther(process.env.LIQUIDITY_ETH_AMOUNT ?? "0.0001");
const DRY_RUN = process.env.LIQUIDITY_DRY_RUN === "true";

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
];

const wethAbi = [
  ...erc20Abi,
  {
    type: "function",
    name: "deposit",
    stateMutability: "payable",
    inputs: [],
    outputs: []
  }
];

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
];

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
  }
];

if (!process.env.DEPLOYER_PRIVATE_KEY) {
  throw new Error("DEPLOYER_PRIVATE_KEY is required.");
}

if (process.env.ROBINHOOD_CHAIN_ID !== "4663") {
  throw new Error("Refusing to seed mainnet liquidity unless ROBINHOOD_CHAIN_ID=4663.");
}

const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY);
const chain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [process.env.ROBINHOOD_RPC_URL] } },
  blockExplorers: { default: { name: "Robinhood Blockscout", url: "https://robinhoodchain.blockscout.com" } }
});
const publicClient = createPublicClient({ chain, transport: http(process.env.ROBINHOOD_RPC_URL) });
const walletClient = createWalletClient({ account, chain, transport: http(process.env.ROBINHOOD_RPC_URL) });

const token0 = BigInt(WETH.toLowerCase()) < BigInt(SNAPG.toLowerCase()) ? WETH : SNAPG;
const token1 = token0 === WETH ? SNAPG : WETH;
const amount0Desired = token0 === WETH ? ETH_AMOUNT : TOKEN_AMOUNT;
const amount1Desired = token0 === WETH ? TOKEN_AMOUNT : ETH_AMOUNT;
const sqrtPriceX96 = sqrt((amount1Desired << 192n) / amount0Desired);
const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 20);

const nativeBalance = await publicClient.getBalance({ address: account.address });
const [tokenBalance, wethBalance, tokenAllowance, wethAllowance, existingPool] = await Promise.all([
  publicClient.readContract({ address: SNAPG, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }),
  publicClient.readContract({ address: WETH, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }),
  publicClient.readContract({ address: SNAPG, abi: erc20Abi, functionName: "allowance", args: [account.address, POSITION_MANAGER] }),
  publicClient.readContract({ address: WETH, abi: erc20Abi, functionName: "allowance", args: [account.address, POSITION_MANAGER] }),
  publicClient.readContract({ address: FACTORY, abi: factoryAbi, functionName: "getPool", args: [SNAPG, WETH, FEE] })
]);

console.log(
  JSON.stringify(
    {
      dryRun: DRY_RUN,
      account: account.address,
      token: SNAPG,
      weth: WETH,
      fee: FEE,
      token0,
      token1,
      tickLower: TICK_LOWER,
      tickUpper: TICK_UPPER,
      nativeBalanceEth: formatEther(nativeBalance),
      tokenBalance: formatUnits(tokenBalance, 18),
      wethBalance: formatEther(wethBalance),
      tokenAmount: formatUnits(TOKEN_AMOUNT, 18),
      ethAmount: formatEther(ETH_AMOUNT),
      existingPool
    },
    null,
    2
  )
);

if (tokenBalance < TOKEN_AMOUNT) {
  throw new Error(`Not enough SNAPG. Need ${formatUnits(TOKEN_AMOUNT, 18)}, have ${formatUnits(tokenBalance, 18)}.`);
}

const steps = [];
if (wethBalance < ETH_AMOUNT) {
  steps.push({
    label: "wrap ETH to WETH",
    to: WETH,
    value: ETH_AMOUNT - wethBalance,
    data: encodeFunctionData({ abi: wethAbi, functionName: "deposit" })
  });
}

if (wethAllowance < ETH_AMOUNT) {
  steps.push({
    label: "approve WETH",
    to: WETH,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [POSITION_MANAGER, ETH_AMOUNT] })
  });
}

if (tokenAllowance < TOKEN_AMOUNT) {
  steps.push({
    label: "approve SNAPG",
    to: SNAPG,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [POSITION_MANAGER, TOKEN_AMOUNT] })
  });
}

if (existingPool === "0x0000000000000000000000000000000000000000") {
  steps.push({
    label: "create and initialize pool",
    to: POSITION_MANAGER,
    data: encodeFunctionData({
      abi: positionManagerAbi,
      functionName: "createAndInitializePoolIfNecessary",
      args: [token0, token1, FEE, sqrtPriceX96]
    })
  });
}

steps.push({
  label: "mint liquidity position",
  to: POSITION_MANAGER,
  data: encodeFunctionData({
    abi: positionManagerAbi,
    functionName: "mint",
    args: [
      {
        token0,
        token1,
        fee: FEE,
        tickLower: TICK_LOWER,
        tickUpper: TICK_UPPER,
        amount0Desired,
        amount1Desired,
        amount0Min: 0n,
        amount1Min: 0n,
        recipient: account.address,
        deadline
      }
    ]
  })
});

const gasPrice = await publicClient.getGasPrice();
if (DRY_RUN) {
  let estimatedGas = 0n;
  for (const step of steps) {
    if (step.label === "mint liquidity position") {
      console.log("mint liquidity position: skipped dry-run estimate until wrap/approve/pool-create are mined");
      continue;
    }
    const gas = await publicClient.estimateGas({
      account: account.address,
      to: step.to,
      value: step.value ?? 0n,
      data: step.data
    });
    estimatedGas += gas;
    console.log(`${step.label}: estimated ${gas.toString()} gas`);
  }
  const estimatedGasCost = estimatedGas * gasPrice;
  const requiredNative = estimatedGasCost + (wethBalance < ETH_AMOUNT ? ETH_AMOUNT - wethBalance : 0n);
  console.log(
    JSON.stringify(
      {
        gasPriceWei: gasPrice.toString(),
        estimatedPrerequisiteGas: estimatedGas.toString(),
        estimatedPrerequisiteGasCostEth: formatEther(estimatedGasCost),
        requiredNativeBeforeMintEth: formatEther(requiredNative),
        enoughNativeBeforeMint: nativeBalance > requiredNative
      },
      null,
      2
    )
  );
  process.exit(0);
}

const hashes = [];
for (const step of steps) {
  const gas = await publicClient.estimateGas({
    account: account.address,
    to: step.to,
    value: step.value ?? 0n,
    data: step.data
  });
  const latestBalance = await publicClient.getBalance({ address: account.address });
  const estimatedCost = gas * gasPrice + (step.value ?? 0n);
  if (latestBalance <= estimatedCost) {
    throw new Error(
      `Not enough ETH for ${step.label}. Need about ${formatEther(estimatedCost)}, have ${formatEther(latestBalance)}.`
    );
  }
  console.log(`${step.label}: estimated ${gas.toString()} gas`);
  console.log(`sending: ${step.label}`);
  const hash = await walletClient.sendTransaction({
    account,
    to: step.to,
    value: step.value ?? 0n,
    data: step.data
  });
  hashes.push({ label: step.label, hash });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`${step.label}: ${receipt.status} ${hash}`);
}

const pool = await publicClient.readContract({
  address: FACTORY,
  abi: factoryAbi,
  functionName: "getPool",
  args: [SNAPG, WETH, FEE]
});

const finalNativeBalance = await publicClient.getBalance({ address: account.address });
console.log(
  JSON.stringify(
    {
      pool,
      positionManager: POSITION_MANAGER,
      hashes,
      finalNativeBalanceEth: formatEther(finalNativeBalance),
      poolExplorer: `https://robinhoodchain.blockscout.com/address/${pool}`
    },
    null,
    2
  )
);

function sqrt(value) {
  if (value < 0n) throw new Error("square root only works on non-negative values");
  if (value < 2n) return value;
  let x0 = value / 2n;
  let x1 = (x0 + value / x0) / 2n;
  while (x1 < x0) {
    x0 = x1;
    x1 = (x0 + value / x0) / 2n;
  }
  return x0;
}
