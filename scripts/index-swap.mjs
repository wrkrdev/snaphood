import { config } from "dotenv";
import { randomUUID } from "crypto";
import { Pool } from "pg";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  maxUint256,
  parseEther
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

// Seed a tiny, real swap on each newly-tradable pool so indexers (Dexscreener) discover it
// and show a chart. Deliberately bounded: only coins that have a pool but no recorded swap
// yet (so each coin is swapped exactly once, ever), a couple per run, and never below a
// safety floor of ETH in the deployer wallet.
config({ path: ".env.local" });
config();

const MAX_COINS = Number(process.env.INDEX_SWAP_MAX_PER_RUN ?? "2");
const SWAP_ETH = process.env.SWAP_ETH_AMOUNT ?? "0.00001";
const SAFETY_FLOOR = parseEther(process.env.INDEX_SWAP_SAFETY_FLOOR_ETH ?? "0.0004");
const CHAIN_ID = Number(process.env.ROBINHOOD_CHAIN_ID ?? "4663");

const databaseUrl = process.env.DATABASE_URL;
const rpcUrl = process.env.ROBINHOOD_RPC_URL;
const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;

if (!databaseUrl || !rpcUrl || !deployerKey) {
  console.log("index-swap: missing DATABASE_URL, ROBINHOOD_RPC_URL or DEPLOYER_PRIVATE_KEY; skipping.");
  process.exit(0);
}
if (CHAIN_ID !== 4663) {
  console.log(`index-swap: refusing to swap on chain ${CHAIN_ID}; expected Robinhood Chain 4663.`);
  process.exit(0);
}

const weth = getAddress(process.env.ROBINHOOD_WETH_ADDRESS ?? "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73");
const router = getAddress(process.env.UNISWAP_V3_SWAP_ROUTER_02 ?? "0xcaf681a66d020601342297493863e78c959e5cb2");
const fee = Number(process.env.UNISWAP_V3_FEE ?? "10000");

const wethAbi = [
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    outputs: [{ type: "bool" }]
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "a", type: "address" }],
    outputs: [{ type: "uint256" }]
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" }
    ],
    outputs: [{ type: "uint256" }]
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

const chain = defineChain({
  id: CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } }
});
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const account = privateKeyToAccount(deployerKey);
const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });
const pool = new Pool({ connectionString: databaseUrl });

async function send(address, abi, functionName, args, value) {
  const hash = await walletClient.writeContract({ address, abi, functionName, args, value });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`${functionName} reverted (${hash})`);
  return hash;
}

async function main() {
  const rows = await pool.query(
    `
      select d.id, d.contract_address
      from snaphood_token_drafts d
      join snaphood_token_trading t on t.draft_id = d.id
      where d.status = 'launched'
        and d.chain_id = $1
        and t.pool_address is not null
        and t.swap_tx_hash is null
      order by d.updated_at desc
      limit $2
    `,
    [CHAIN_ID, MAX_COINS]
  );

  if (rows.rows.length === 0) {
    console.log("index-swap: no pools awaiting an indexer swap.");
    return;
  }

  const amountIn = parseEther(SWAP_ETH);

  for (const row of rows.rows) {
    const balance = await publicClient.getBalance({ address: account.address });
    if (balance < SAFETY_FLOOR + amountIn) {
      console.log(`index-swap: deployer below safety floor (${balance}); stopping.`);
      break;
    }

    const token = getAddress(row.contract_address);
    try {
      const [wethBalance, allowance] = await Promise.all([
        publicClient.readContract({ address: weth, abi: wethAbi, functionName: "balanceOf", args: [account.address] }),
        publicClient.readContract({ address: weth, abi: wethAbi, functionName: "allowance", args: [account.address, router] })
      ]);

      if (wethBalance < amountIn) {
        await send(weth, wethAbi, "deposit", [], amountIn - wethBalance);
      }
      if (allowance < amountIn) {
        await send(weth, wethAbi, "approve", [router, maxUint256]);
      }

      const swapHash = await send(router, routerAbi, "exactInputSingle", [
        {
          tokenIn: weth,
          tokenOut: token,
          fee,
          recipient: account.address,
          amountIn,
          amountOutMinimum: 0n,
          sqrtPriceLimitX96: 0n
        }
      ]);

      await pool.query(
        "update snaphood_token_trading set swap_tx_hash = $2, updated_at = now() where draft_id = $1",
        [row.id, swapHash]
      );
      await pool.query(
        "insert into snaphood_launch_events (id, draft_id, event_type, payload) values ($1, $2, $3, $4)",
        [
          randomUUID(),
          row.id,
          "trading.indexer_swap",
          JSON.stringify({
            execution: "indexer-swap-cron",
            contractAddress: row.contract_address,
            swapEthAmount: SWAP_ETH,
            swapTxHash: swapHash,
            note: "Tiny swap used to help indexers discover the pool"
          })
        ]
      );
      console.log(`index-swap: seeded ${row.contract_address} -> ${swapHash}`);
    } catch (error) {
      console.warn(`index-swap: ${row.contract_address} failed: ${error instanceof Error ? error.message : error}`);
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
