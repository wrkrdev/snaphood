import { NextResponse } from "next/server";
import { getAddress, isAddress, parseUnits, type Abi, type Address, type Hex } from "viem";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { query, withTransaction } from "@/lib/db";
import { env } from "@/lib/env";
import { getRobinhoodPublicClient } from "@/lib/launch";
import { validateLaunchRequestShape, validateTokenomics } from "@/lib/launch-validation";
import { applyRateLimit } from "@/lib/rate-limit";
import { readJsonBody, rejectCrossOrigin } from "@/lib/request-guards";
import SnapHoodToken from "@/generated/SnapHoodToken.json";

export const runtime = "nodejs";

const completionSchema = z.object({
  creatorWallet: z.string().refine(isAddress, "Creator wallet must be an EVM address."),
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  contractAddress: z.string().refine(isAddress, "Contract address must be an EVM address.").optional()
});

const guardrailVersion = "2026-07-16.user-wallet-v1";
const tokenAbi = SnapHoodToken.abi as Abi;

type DraftLaunchState = {
  id: string;
  status: string;
  contract_address: string | null;
  tx_hash: string | null;
  chain_id: number | null;
};

export async function POST(request: Request) {
  const blocked = rejectCrossOrigin(request);
  if (blocked) return blocked;

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in before launching." }, { status: 401 });
  }

  const limited = await applyRateLimit(request, {
    name: env.launchMode === "demo" ? "launch:complete:demo:user" : "launch:complete:live:user-wallet",
    limit: env.launchMode === "demo" ? 18 : 9,
    windowSeconds: 60 * 60,
    identity: user.id
  });
  if (limited) return limited;

  const json = await readJsonBody(request);
  if (!json.ok) return json.response;

  const parsed = validateLaunchRequestShape(json.body);
  const completion = completionSchema.safeParse(json.body);
  if (!parsed.success || !completion.success) {
    return NextResponse.json({ error: "Launch completion payload is incomplete or invalid." }, { status: 400 });
  }

  const tokenomicsError = validateTokenomics(parsed.data);
  if (tokenomicsError) {
    return NextResponse.json({ error: tokenomicsError }, { status: 400 });
  }

  const ownership = await query<DraftLaunchState>(
    `
      select id, status, contract_address, tx_hash, chain_id
      from snaphood_token_drafts
      where id = $1 and user_id = $2
      limit 1
    `,
    [parsed.data.draftId, user.id]
  );

  const draftState = ownership.rows[0];
  if (!draftState) {
    return NextResponse.json({ error: "Draft not found." }, { status: 404 });
  }

  if (draftState.status === "launched" && draftState.contract_address && draftState.tx_hash && draftState.chain_id) {
    return NextResponse.json({
      launch: {
        contractAddress: draftState.contract_address,
        txHash: draftState.tx_hash,
        chainId: draftState.chain_id,
        explorerUrl: `${env.robinhoodBlockExplorerUrl.replace(/\/$/, "")}/address/${draftState.contract_address}`,
        mode: env.launchMode,
        name: parsed.data.name,
        ticker: parsed.data.ticker,
        reused: true
      }
    });
  }

  if (draftState.status !== "launching") {
    return NextResponse.json({ error: "Prepare this draft for wallet launch before completing it." }, { status: 409 });
  }

  const creatorWallet = getAddress(completion.data.creatorWallet);
  const txHash = completion.data.txHash as Hex;

  let verified;
  try {
    verified = await verifyUserWalletDeployment({
      txHash,
      requestedContractAddress: completion.data.contractAddress,
      creatorWallet,
      name: parsed.data.name,
      ticker: parsed.data.ticker,
      supply: parsed.data.tokenomics.supply,
      decimals: parsed.data.tokenomics.decimals
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not verify wallet deployment." },
      { status: 400 }
    );
  }

  const completedAt = new Date().toISOString();
  await withTransaction(async (client) => {
    await client.query(
      `
        update snaphood_token_drafts
        set name = $2,
            ticker = $3,
            description = $4,
            tokenomics = $5,
            status = 'launched',
            contract_address = $6,
            tx_hash = $7,
            chain_id = $8,
            updated_at = now()
        where id = $1 and user_id = $9 and status = 'launching'
      `,
      [
        parsed.data.draftId,
        parsed.data.name,
        parsed.data.ticker,
        parsed.data.description,
        JSON.stringify(parsed.data.tokenomics),
        verified.contractAddress,
        txHash,
        env.robinhoodChainId,
        user.id
      ]
    );

    await client.query(
      "insert into snaphood_launch_events (id, draft_id, event_type, payload) values ($1, $2, $3, $4)",
      [
        crypto.randomUUID(),
        parsed.data.draftId,
        "launch.completed",
        JSON.stringify({
          launch: {
            contractAddress: verified.contractAddress,
            txHash,
            chainId: env.robinhoodChainId,
            explorerUrl: `${env.robinhoodBlockExplorerUrl.replace(/\/$/, "")}/address/${verified.contractAddress}`,
            mode: env.launchMode,
            name: parsed.data.name,
            ticker: parsed.data.ticker,
            deployer: creatorWallet,
            execution: "user-wallet"
          },
          verification: verified.verification,
          guardrails: {
            version: guardrailVersion,
            acceptedAt: completedAt,
            acceptedBy: user.id,
            acknowledgements: parsed.data.acknowledgements
          }
        })
      ]
    );
  });

  return NextResponse.json({
    launch: {
      contractAddress: verified.contractAddress,
      txHash,
      chainId: env.robinhoodChainId,
      explorerUrl: `${env.robinhoodBlockExplorerUrl.replace(/\/$/, "")}/address/${verified.contractAddress}`,
      mode: env.launchMode,
      name: parsed.data.name,
      ticker: parsed.data.ticker,
      deployer: creatorWallet,
      execution: "user-wallet"
    }
  });
}

async function verifyUserWalletDeployment(input: {
  txHash: Hex;
  requestedContractAddress?: string;
  creatorWallet: Address;
  name: string;
  ticker: string;
  supply: string;
  decimals: number;
}) {
  const publicClient = getRobinhoodPublicClient();
  const [receipt, transaction] = await Promise.all([
    publicClient.getTransactionReceipt({ hash: input.txHash }),
    publicClient.getTransaction({ hash: input.txHash })
  ]);

  if (receipt.status !== "success") {
    throw new Error("Wallet deployment transaction did not succeed.");
  }

  if (!receipt.contractAddress) {
    throw new Error("Wallet transaction is not a contract deployment.");
  }

  const contractAddress = getAddress(receipt.contractAddress);
  if (input.requestedContractAddress && contractAddress !== getAddress(input.requestedContractAddress)) {
    throw new Error("Submitted contract address does not match the transaction receipt.");
  }

  if (getAddress(receipt.from) !== input.creatorWallet || getAddress(transaction.from) !== input.creatorWallet) {
    throw new Error("Deployment transaction was not sent by the connected creator wallet.");
  }

  if (transaction.to !== null) {
    throw new Error("Deployment transaction must create a new token contract.");
  }

  const bytecode = (SnapHoodToken.bytecode as string).toLowerCase();
  if (!transaction.input.toLowerCase().startsWith(bytecode)) {
    throw new Error("Deployment bytecode does not match the reviewed SnapHood token artifact.");
  }

  const expectedSupply = parseUnits(input.supply.replace(/,/g, ""), input.decimals);
  const [name, symbol, decimals, totalSupply, creator, creatorBalance] = await Promise.all([
    publicClient.readContract({ address: contractAddress, abi: tokenAbi, functionName: "name" }),
    publicClient.readContract({ address: contractAddress, abi: tokenAbi, functionName: "symbol" }),
    publicClient.readContract({ address: contractAddress, abi: tokenAbi, functionName: "decimals" }),
    publicClient.readContract({ address: contractAddress, abi: tokenAbi, functionName: "totalSupply" }),
    publicClient.readContract({ address: contractAddress, abi: tokenAbi, functionName: "creator" }),
    publicClient.readContract({
      address: contractAddress,
      abi: tokenAbi,
      functionName: "balanceOf",
      args: [input.creatorWallet]
    })
  ]);

  if (name !== input.name || symbol !== input.ticker) {
    throw new Error("Deployed token metadata does not match the prepared launch.");
  }

  if (Number(decimals) !== input.decimals) {
    throw new Error("Deployed token decimals do not match the prepared launch.");
  }

  if (totalSupply !== expectedSupply || creatorBalance !== expectedSupply) {
    throw new Error("Deployed token supply was not minted to the creator wallet.");
  }

  if (getAddress(creator as Address) !== input.creatorWallet) {
    throw new Error("Deployed token creator does not match the connected creator wallet.");
  }

  return {
    contractAddress,
    verification: {
      receiptStatus: receipt.status,
      sender: input.creatorWallet,
      bytecodeArtifact: SnapHoodToken.bytecodeHash,
      metadata: "name,symbol,decimals,totalSupply,balanceOf,creator"
    }
  };
}
