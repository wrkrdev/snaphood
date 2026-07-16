import { env } from "@/lib/env";
import type { LaunchRequest } from "@/lib/types";
import SnapHoodToken from "@/generated/SnapHoodToken.json";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  http,
  parseUnits,
  type Hex
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export async function launchToken(input: LaunchRequest) {
  if (env.launchMode === "demo") {
    return demoLaunch(input);
  }

  return deployToken(input);
}

export function getRobinhoodChain() {
  return defineChain({
    id: env.robinhoodChainId,
    name: env.robinhoodNetwork === "mainnet" ? "Robinhood Chain" : "Robinhood Chain Testnet",
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18
    },
    rpcUrls: {
      default: {
        http: [env.robinhoodRpcUrl]
      }
    },
    blockExplorers: {
      default: {
        name: "Robinhood Blockscout",
        url: env.robinhoodBlockExplorerUrl
      }
    }
  });
}

export function getRobinhoodPublicClient() {
  if (!env.robinhoodRpcUrl) {
    throw new Error("ROBINHOOD_RPC_URL is required for chain verification.");
  }

  return createPublicClient({
    chain: getRobinhoodChain(),
    transport: http(env.robinhoodRpcUrl)
  });
}

function demoLaunch(input: LaunchRequest) {
  const txHash = `0x${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`.slice(0, 66);
  const address = `0x${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`.slice(0, 42);

  return {
    contractAddress: address,
    txHash,
    chainId: env.robinhoodChainId,
    explorerUrl: `${env.robinhoodBlockExplorerUrl.replace(/\/$/, "")}/address/${address}`,
    mode: env.launchMode,
    name: input.name,
    ticker: input.ticker
  };
}

async function deployToken(input: LaunchRequest) {
  if (!env.deployerPrivateKey) {
    throw new Error("DEPLOYER_PRIVATE_KEY is required for real token launches.");
  }

  if (!env.robinhoodRpcUrl) {
    throw new Error("ROBINHOOD_RPC_URL is required for real token launches.");
  }

  const account = privateKeyToAccount(env.deployerPrivateKey as Hex);
  const chain = getRobinhoodChain();
  const publicClient = getRobinhoodPublicClient();
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(env.robinhoodRpcUrl)
  });

  const balance = await publicClient.getBalance({ address: account.address });
  if (balance === 0n) {
    throw new Error(`Deployer ${account.address} has 0 ETH on chain ${env.robinhoodChainId}. Fund it before launching.`);
  }

  const decimals = input.tokenomics.decimals;
  const initialSupply = parseUnits(input.tokenomics.supply.replace(/,/g, ""), decimals);

  const hash = await walletClient.deployContract({
    abi: SnapHoodToken.abi,
    bytecode: SnapHoodToken.bytecode as Hex,
    args: [input.name, input.ticker, decimals, initialSupply, account.address]
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) {
    throw new Error(`Deployment transaction ${hash} did not return a contract address.`);
  }

  return {
    contractAddress: receipt.contractAddress,
    txHash: hash,
    chainId: env.robinhoodChainId,
    explorerUrl: `${env.robinhoodBlockExplorerUrl.replace(/\/$/, "")}/address/${receipt.contractAddress}`,
    mode: env.launchMode,
    name: input.name,
    ticker: input.ticker,
    deployer: account.address,
    deployerBalanceBefore: `${formatEther(balance)} ETH`
  };
}
