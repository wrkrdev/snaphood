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
  parseEther
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

config({ path: ".env.local" });

const TOKEN = getAddress(process.env.TRADING_TOKEN_ADDRESS ?? "0xce0213831ddf77fae87da578efe0ddae2b0218d0");
const WETH = getAddress(process.env.ROBINHOOD_WETH_ADDRESS ?? "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
const ROUTER = getAddress(process.env.UNISWAP_V3_SWAP_ROUTER_02 ?? "0xcaf681a66d020601342297493863e78c959e5cb2");
const FEE = Number(process.env.UNISWAP_V3_FEE ?? "10000");
const SWAP_ETH_AMOUNT = parseEther(process.env.SWAP_ETH_AMOUNT ?? "0.00001");
const DRY_RUN = process.env.SWAP_DRY_RUN === "true";

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
];

if (!process.env.DEPLOYER_PRIVATE_KEY) {
  throw new Error("DEPLOYER_PRIVATE_KEY is required.");
}

if (process.env.ROBINHOOD_CHAIN_ID !== "4663") {
  throw new Error("Refusing to swap unless ROBINHOOD_CHAIN_ID=4663.");
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

const [nativeBalance, wethBalance, tokenBalance, wethAllowance] = await Promise.all([
  publicClient.getBalance({ address: account.address }),
  publicClient.readContract({ address: WETH, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }),
  publicClient.readContract({ address: TOKEN, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }),
  publicClient.readContract({ address: WETH, abi: erc20Abi, functionName: "allowance", args: [account.address, ROUTER] })
]);

console.log(
  JSON.stringify(
    {
      dryRun: DRY_RUN,
      account: account.address,
      token: TOKEN,
      weth: WETH,
      router: ROUTER,
      fee: FEE,
      nativeBalanceEth: formatEther(nativeBalance),
      wethBalanceEth: formatEther(wethBalance),
      tokenBalance: formatUnits(tokenBalance, 18),
      swapEthAmount: formatEther(SWAP_ETH_AMOUNT)
    },
    null,
    2
  )
);

const steps = [];
if (wethBalance < SWAP_ETH_AMOUNT) {
  steps.push({
    label: "wrap ETH to WETH",
    to: WETH,
    value: SWAP_ETH_AMOUNT - wethBalance,
    data: encodeFunctionData({ abi: wethAbi, functionName: "deposit" })
  });
}

if (wethAllowance < SWAP_ETH_AMOUNT) {
  steps.push({
    label: "approve WETH to swap router",
    to: WETH,
    data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [ROUTER, SWAP_ETH_AMOUNT] })
  });
}

steps.push({
  label: "swap WETH to SNAPG",
  to: ROUTER,
  data: encodeFunctionData({
    abi: routerAbi,
    functionName: "exactInputSingle",
    args: [
      {
        tokenIn: WETH,
        tokenOut: TOKEN,
        fee: FEE,
        recipient: account.address,
        amountIn: SWAP_ETH_AMOUNT,
        amountOutMinimum: 0n,
        sqrtPriceLimitX96: 0n
      }
    ]
  })
});

const gasPrice = await publicClient.getGasPrice();

if (DRY_RUN) {
  let totalEstimatedGas = 0n;
  for (const step of steps) {
    if (step.label === "swap WETH to SNAPG" && (wethBalance < SWAP_ETH_AMOUNT || wethAllowance < SWAP_ETH_AMOUNT)) {
      console.log("swap WETH to SNAPG: skipped dry-run estimate until WETH wrap/approval are mined");
      continue;
    }
    const gas = await publicClient.estimateGas({
      account: account.address,
      to: step.to,
      value: step.value ?? 0n,
      data: step.data
    });
    totalEstimatedGas += gas;
    console.log(`${step.label}: estimated ${gas.toString()} gas`);
  }

  const requiredNative = totalEstimatedGas * gasPrice + (wethBalance < SWAP_ETH_AMOUNT ? SWAP_ETH_AMOUNT - wethBalance : 0n);
  console.log(
    JSON.stringify(
      {
        gasPriceWei: gasPrice.toString(),
        estimatedPrerequisiteGas: totalEstimatedGas.toString(),
        requiredNativeBeforeSwapEth: formatEther(requiredNative),
        enoughNativeBeforeSwap: nativeBalance > requiredNative
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
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  hashes.push({ label: step.label, hash, status: receipt.status });
  console.log(`${step.label}: ${receipt.status} ${hash}`);
}

const [finalNativeBalance, finalWethBalance, finalTokenBalance] = await Promise.all([
  publicClient.getBalance({ address: account.address }),
  publicClient.readContract({ address: WETH, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }),
  publicClient.readContract({ address: TOKEN, abi: erc20Abi, functionName: "balanceOf", args: [account.address] })
]);

console.log(
  JSON.stringify(
    {
      hashes,
      finalNativeBalanceEth: formatEther(finalNativeBalance),
      finalWethBalanceEth: formatEther(finalWethBalance),
      finalTokenBalance: formatUnits(finalTokenBalance, 18)
    },
    null,
    2
  )
);
