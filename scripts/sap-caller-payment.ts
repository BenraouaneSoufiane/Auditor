import "dotenv/config";

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomInt } from "node:crypto";

import { Connection, Keypair, PublicKey, SystemProgram, type TransactionInstruction } from "@solana/web3.js";

type PaymentRequest = {
  agentWallet: string;
  rpcUrl?: string;
  rpcApiKey?: string;
  keypairPath?: string;
  network?: string;
  pricePerCallLamports: string | number;
  minEscrowDepositLamports: string | number;
  calls?: number;
  maxCalls?: number;
  forceCreate?: boolean;
  freshEscrow?: boolean;
  escrowNonce?: number;
};

const require = createRequire(import.meta.url);
const { BN, Wallet } = require("@coral-xyz/anchor") as typeof import("@coral-xyz/anchor");
const { SapClient, Pdas } = require("@oobe-protocol-labs/synapse-sap-sdk") as typeof import("@oobe-protocol-labs/synapse-sap-sdk");

function requireString(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function loadKeypair(path: string): Keypair {
  const secret = JSON.parse(readFileSync(resolve(path), "utf8"));
  if (!Array.isArray(secret)) {
    throw new Error(`Expected ${path} to contain a Solana secret-key byte array.`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function rpcConfig(rawUrl: string, explicitApiKey?: string) {
  const parsed = new URL(rawUrl);
  const queryApiKey = parsed.searchParams.get("api_key") ?? parsed.searchParams.get("apikey");
  parsed.searchParams.delete("api_key");
  parsed.searchParams.delete("apikey");
  return {
    url: parsed.toString(),
    apiKey: explicitApiKey ?? queryApiKey ?? undefined,
  };
}

function bnString(value: unknown): string | null {
  if (value && typeof value === "object" && "toString" in value) {
    return String((value as { toString(): string }).toString());
  }
  return value == null ? null : String(value);
}

function escrowSummary(escrow: any, pricePerCall: any) {
  if (!escrow) return null;
  const balance = BigInt(escrow.balance?.toString?.() ?? "0");
  const maxCalls = Number(escrow.maxCalls?.toString?.() ?? "0");
  const totalCallsSettled = Number(escrow.totalCallsSettled?.toString?.() ?? "0");
  const unitPrice = BigInt(pricePerCall?.toString?.() ?? escrow.pricePerCall?.toString?.() ?? "0");
  const affordableCalls = unitPrice > 0n ? Number(balance / unitPrice) : Number.POSITIVE_INFINITY;
  const callsRemaining = maxCalls > 0 ? Math.max(0, maxCalls - totalCallsSettled) : Number.POSITIVE_INFINITY;
  const expiresAt = Number(escrow.expiresAt?.toString?.() ?? "0");
  return {
    balance: bnString(escrow.balance),
    totalDeposited: bnString(escrow.totalDeposited),
    totalSettled: bnString(escrow.totalSettled),
    totalCallsSettled: bnString(escrow.totalCallsSettled),
    callsRemaining: String(Math.min(callsRemaining, affordableCalls)),
    affordableCalls: String(affordableCalls),
    isExpired: expiresAt > 0 && Math.floor(Date.now() / 1000) >= expiresAt,
  };
}

async function fetchEscrowV2(client: any, escrowPda: PublicKey) {
  try {
    return await client.program.account.escrowAccountV2.fetch(escrowPda);
  } catch {
    return null;
  }
}

function derivePricingMenu(agentPda: PublicKey, programId: PublicKey) {
  return PublicKey.findProgramAddressSync([Buffer.from("sap_pricing"), agentPda.toBuffer()], programId);
}

function u64Le(value: number) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}

function freshNonce() {
  const timeBits = Date.now() % 1_000_000_000;
  const randomBits = randomInt(1_000_000);
  return timeBits * 1_000_000 + randomBits;
}

function deriveEscrowV2(agentPda: PublicKey, depositor: PublicKey, escrowNonce: number, programId: PublicKey) {
  return PublicKey.findProgramAddressSync([
    Buffer.from("sap_escrow_v2"),
    agentPda.toBuffer(),
    depositor.toBuffer(),
    u64Le(escrowNonce),
  ], programId);
}

async function sendInstructions(client: any, signer: Keypair, instructions: any[]) {
  const tx = await client.buildTransaction(instructions, signer.publicKey, {
    microLamports: Number(process.env.SAP_PRIORITY_MICROLAMPORTS ?? 0) || undefined,
    limit: Number(process.env.SAP_COMPUTE_UNIT_LIMIT ?? 0) || undefined,
  });
  tx.sign([signer]);
  const signature = await client.connection.sendRawTransaction(tx.serialize(), {
    preflightCommitment: "confirmed",
    maxRetries: 3,
  });
  const confirmation = await client.connection.confirmTransaction(signature, "confirmed");
  if (confirmation.value.err) {
    throw new Error(`Transaction ${signature} failed confirmation: ${JSON.stringify(confirmation.value.err)}`);
  }
  return signature;
}

function reorderCreateEscrowV2ForDeployedProgram(
  instruction: TransactionInstruction,
  accounts: {
    depositor: PublicKey;
    agent: PublicKey;
    escrow: PublicKey;
    systemProgram: PublicKey;
    agentStake: PublicKey;
    agentStats: PublicKey;
    pricingMenu: PublicKey;
  },
) {
  const byAddress = new Map(instruction.keys.map((meta) => [meta.pubkey.toBase58(), meta]));
  instruction.keys = [
    accounts.depositor,
    accounts.agent,
    accounts.escrow,
    accounts.systemProgram,
    accounts.agentStake,
    accounts.agentStats,
    accounts.pricingMenu,
  ].map((pubkey) => {
    const meta = byAddress.get(pubkey.toBase58());
    if (!meta) throw new Error(`createEscrowV2 instruction is missing account ${pubkey.toBase58()}`);
    return meta;
  });
  return instruction;
}

async function main() {
  const raw = process.env.SAP_CALLER_PAYMENT_REQUEST;
  if (!raw) throw new Error("Missing SAP_CALLER_PAYMENT_REQUEST.");

  const request = JSON.parse(raw) as PaymentRequest;
  const rpcUrl = request.rpcUrl ?? process.env.SAP_RPC_URL ?? process.env.SYNAPSE_RPC_URL;
  const rpcApiKey = request.rpcApiKey ?? process.env.SAP_RPC_API_KEY ?? process.env.SYNAPSE_API_KEY;
  const keypairPath = request.keypairPath ?? process.env.SAP_KEYPAIR_PATH ?? process.env.ANCHOR_WALLET;
  const network = request.network ?? process.env.SAP_PAYMENT_NETWORK ?? "solana:mainnet-beta";
  const calls = Math.max(1, Number(request.calls ?? 1));
  const maxCalls = Math.max(calls, Number(request.maxCalls ?? process.env.SAP_CALLER_MAX_CALLS ?? 20));

  const signer = loadKeypair(requireString(keypairPath, "keypairPath, SAP_KEYPAIR_PATH, or ANCHOR_WALLET"));
  const rpc = rpcConfig(requireString(rpcUrl, "rpcUrl, SAP_RPC_URL, or SYNAPSE_RPC_URL"), rpcApiKey);
  const connection = new Connection(rpc.url, {
    commitment: "confirmed",
    httpHeaders: rpc.apiKey ? { "x-api-key": rpc.apiKey } : undefined,
  });
  const client = new SapClient({ connection, wallet: new Wallet(signer) }) as any;
  const agentWallet = new PublicKey(request.agentWallet);
  const pricePerCall = new BN(String(request.pricePerCallLamports));
  const minDeposit = new BN(String(request.minEscrowDepositLamports));
  const requestedCost = pricePerCall.mul(new BN(calls));
  const deposit = BN.max(minDeposit, requestedCost);

  const escrowNonce = Number(request.escrowNonce ?? (request.freshEscrow ? freshNonce() : 0));
  const [agentPda] = Pdas.getAgentPDA(agentWallet);
  const [agentStatsPda] = Pdas.getAgentStatsPDA(agentPda);
  const [agentStakePda] = Pdas.getAgentStakePDA(agentPda);
  const [escrowPda] = deriveEscrowV2(agentPda, signer.publicKey, escrowNonce, client.programId);
  const [pricingMenuPda] = derivePricingMenu(agentPda, client.programId);
  let action = "reuse";
  let txSignature: string | null = null;
  let escrowBefore = await fetchEscrowV2(client, escrowPda);

  if (request.forceCreate || !escrowBefore) {
    action = "create";
    const instruction = await client.program.methods
      .createEscrowV2(
        new BN(escrowNonce),
        pricePerCall,
        new BN(maxCalls),
        deposit,
        new BN(0),
        [],
        null,
        9,
        0,
        new BN(0),
        null,
        null,
      )
      .accounts({
        depositor: signer.publicKey,
        agent: agentPda,
        agentStake: agentStakePda,
        agentStats: agentStatsPda,
        pricingMenu: pricingMenuPda,
        escrow: escrowPda,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    txSignature = await sendInstructions(client, signer, [
      reorderCreateEscrowV2ForDeployedProgram(instruction, {
        depositor: signer.publicKey,
        agent: agentPda,
        escrow: escrowPda,
        systemProgram: SystemProgram.programId,
        agentStake: agentStakePda,
        agentStats: agentStatsPda,
        pricingMenu: pricingMenuPda,
      }),
    ]);
  } else {
    const before = escrowSummary(escrowBefore, pricePerCall);
    const affordableCalls = Number(before?.affordableCalls ?? 0);
    const callsRemaining = Number(before?.callsRemaining ?? 0);
    if (callsRemaining < calls) {
      throw new Error(
        `Existing escrow has only ${callsRemaining} calls remaining. Use a different depositor keypair or close/recreate the escrow with a larger maxCalls.`,
      );
    }
    if (affordableCalls < calls) {
      action = "top_up";
      const shortfallCalls = Math.max(calls - affordableCalls, 1);
      const topUp = BN.max(minDeposit, pricePerCall.mul(new BN(shortfallCalls)));
      const instruction = await client.program.methods
        .depositEscrowV2(new BN(escrowNonce), topUp)
        .accounts({
          depositor: signer.publicKey,
          escrow: escrowPda,
          systemProgram: SystemProgram.programId,
        })
        .instruction();
      txSignature = await sendInstructions(client, signer, [instruction]);
    }
  }

  const escrowAfter = await fetchEscrowV2(client, escrowPda);
  if (!escrowAfter) {
    throw new Error("Payment escrow was not available after create/top-up.");
  }
  const headers = {
    "X-Payment-Protocol": "SAP-x402",
    "X-Payment-Escrow": escrowPda.toBase58(),
    "X-Payment-Agent": agentPda.toBase58(),
    "X-Payment-Depositor": signer.publicKey.toBase58(),
    "X-Payment-MaxCalls": escrowAfter.maxCalls.toString(),
    "X-Payment-PricePerCall": escrowAfter.pricePerCall.toString(),
    "X-Payment-Program": client.programId.toBase58(),
    "X-Payment-Network": network,
  };

  console.log(JSON.stringify({
    action,
    txSignature,
    escrowNonce,
    depositorWallet: signer.publicKey.toBase58(),
    headers,
    escrowPda: headers["X-Payment-Escrow"],
    agentPda: headers["X-Payment-Agent"],
    agentWallet: agentWallet.toBase58(),
    programId: headers["X-Payment-Program"],
    network,
    pricePerCallLamports: headers["X-Payment-PricePerCall"],
    maxCalls: headers["X-Payment-MaxCalls"],
    balanceBefore: escrowSummary(escrowBefore, pricePerCall),
    balanceAfter: escrowSummary(escrowAfter, escrowAfter.pricePerCall),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
