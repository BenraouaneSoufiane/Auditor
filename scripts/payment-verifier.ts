import "dotenv/config";

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { Connection, Keypair, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";

const require = createRequire(import.meta.url);
const { Wallet, BN } = require("@coral-xyz/anchor") as typeof import("@coral-xyz/anchor");
const { SapClient, Pdas } = require("@oobe-protocol-labs/synapse-sap-sdk") as typeof import("@oobe-protocol-labs/synapse-sap-sdk");
const { SapMerchantValidator, parseX402Headers } = require(
  resolve("node_modules/@oobe-protocol-labs/synapse-sap-sdk/dist/cjs/utils/merchant-validator.js"),
);
const { deriveSettlementReceipt } = require(
  resolve("node_modules/@oobe-protocol-labs/synapse-sap-sdk/dist/cjs/pda/index.js"),
);

const rawUrl = process.env.SAP_RPC_URL ?? process.env.SYNAPSE_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const rawApiKey = process.env.SAP_RPC_API_KEY ?? process.env.SYNAPSE_API_KEY;
const port = Number(process.env.SAP_PAYMENT_VERIFIER_PORT ?? "8787");
const expectedAgentPda = process.env.SAP_AGENT_PDA ?? "5qPThoENH14iJD3MpJfU4w8pAeHJ5wAzWcdWXm6SY5Y7";
const expectedProgramId = process.env.SAP_PROGRAM_ID ?? "SAPpUhsWLJG1FfkGRcXagEDMrMsWGjbky7AyhGpFETZ";
const expectedPricePerCall = process.env.SAP_PRICE_PER_CALL_LAMPORTS ?? "1000";
const allowNetwork = process.env.SAP_PAYMENT_NETWORK ?? "solana:mainnet-beta";
const settlementRequired = !new Set(["0", "false", "no", "off"]).has(
  (process.env.SAP_SETTLEMENT_REQUIRED ?? "true").toLowerCase(),
);
const settlementKeypairPath = process.env.SAP_AGENT_KEYPAIR_PATH ?? process.env.SAP_SETTLEMENT_KEYPAIR_PATH ?? process.env.ANCHOR_WALLET;
const coSignerKeypairPath = process.env.SAP_COSIGNER_KEYPAIR_PATH;
const treasuryAccount = process.env.SAP_TREASURY_ACCOUNT ? new PublicKey(process.env.SAP_TREASURY_ACCOUNT) : null;
const useLegacySettleCalls = !new Set(["0", "false", "no", "off"]).has(
  (process.env.SAP_LEGACY_SETTLE_CALLS ?? "true").toLowerCase(),
);
const useSettlementReceiptAccount = new Set(["1", "true", "yes", "on"]).has(
  (process.env.SAP_SETTLEMENT_RECEIPT_ACCOUNT ?? "false").toLowerCase(),
);

function rpcConfig(raw: string) {
  const parsed = new URL(raw);
  const queryApiKey = parsed.searchParams.get("api_key") ?? parsed.searchParams.get("apikey");
  parsed.searchParams.delete("api_key");
  parsed.searchParams.delete("apikey");
  return {
    url: parsed.toString(),
    apiKey: rawApiKey ?? queryApiKey ?? undefined,
  };
}

function normalizeHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const normalized: Record<string, string> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === "string") normalized[key] = item;
    else if (Array.isArray(item) && typeof item[0] === "string") normalized[key] = item[0];
  }
  return normalized;
}

function headerPayload(body: Record<string, unknown>) {
  const headers = normalizeHeaders(body.headers);
  for (const [key, value] of Object.entries(body)) {
    if (key.toLowerCase().startsWith("x-payment-") && typeof value === "string") {
      headers[key] = value;
    }
  }
  return headers;
}

function loadKeypair(path: string): Keypair {
  const secret = JSON.parse(readFileSync(resolve(path), "utf8"));
  if (!Array.isArray(secret)) {
    throw new Error(`Expected ${path} to contain a Solana secret-key byte array.`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function readEscrowNonce(headers: Record<string, string>, body: Record<string, unknown>) {
  const value = headers["X-Payment-Escrow-Nonce"] ?? headers["x-payment-escrow-nonce"] ?? body.escrow_nonce ?? body.escrowNonce;
  const nonce = Number(value ?? 0);
  if (!Number.isSafeInteger(nonce) || nonce < 0) {
    throw new Error(`Invalid escrow nonce ${String(value)}`);
  }
  return nonce;
}

function serviceHash(body: Record<string, unknown>, headers: Record<string, string>, parsed: any, callsToSettle: number) {
  const serviceId = String(body.settlement_service_id ?? body.settlementServiceId ?? body.service_id ?? body.serviceId ?? "");
  if (!serviceId) throw new Error("Missing settlement_service_id.");
  const digest = createHash("sha256")
    .update(JSON.stringify({
      serviceId,
      tool: body.tool,
      escrowPda: parsed.escrowPda.toBase58(),
      depositorWallet: parsed.depositorWallet.toBase58(),
      agentPda: parsed.agentPda.toBase58(),
      callsToSettle,
      pricePerCall: parsed.pricePerCall.toString(),
      protocol: headers["X-Payment-Protocol"] ?? headers["x-payment-protocol"],
    }))
    .digest();
  return Array.from(digest);
}

const rpc = rpcConfig(rawUrl);
const connection = new Connection(rpc.url, {
  commitment: "confirmed",
  httpHeaders: rpc.apiKey ? { "x-api-key": rpc.apiKey } : undefined,
});
const settlementSigner = settlementKeypairPath ? loadKeypair(settlementKeypairPath) : null;
const coSignerKeypair = coSignerKeypairPath ? loadKeypair(coSignerKeypairPath) : null;
const client = new SapClient({
  connection,
  wallet: settlementSigner ? new Wallet(settlementSigner) : undefined,
});
const legacyValidator = new SapMerchantValidator(connection, (pda: PublicKey) =>
  (client.escrow as any).fetchByPda?.(pda).catch(() => null),
);

function asBigInt(value: unknown): bigint {
  if (value && typeof value === "object" && "toString" in value) {
    return BigInt(String((value as { toString(): string }).toString()));
  }
  return BigInt(String(value ?? 0));
}

function pubkeyString(value: unknown): string | null {
  if (value instanceof PublicKey) return value.toBase58();
  if (value && typeof value === "object" && "toBase58" in value) {
    return String((value as { toBase58(): string }).toBase58());
  }
  return value == null ? null : String(value);
}

async function fetchEscrowByHeaderPda(escrowPda: PublicKey) {
  const program = (client as any).program;
  const v2 = await program.account.escrowAccountV2?.fetch(escrowPda).catch(() => null);
  if (v2) return { version: 2, account: v2 };
  const v1 = await program.account.escrowAccount?.fetch(escrowPda).catch(() => null);
  if (v1) return { version: 1, account: v1 };
  const info = await client.connection.getAccountInfo(escrowPda);
  const legacy = info ? decodeLegacyEscrow(info.data) : null;
  if (legacy) return { version: 1, account: legacy };
  return null;
}

function readU64(data: Buffer, offset: number) {
  return data.readBigUInt64LE(offset).toString();
}

function readI64(data: Buffer, offset: number) {
  return data.readBigInt64LE(offset).toString();
}

function decodeLegacyEscrow(data: Buffer) {
  if (data.subarray(0, 8).toString("hex") !== "2445301280e17d87") return null;
  let offset = 8;
  const bump = data.readUInt8(offset);
  offset += 1;
  const agent = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  const depositor = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  const agentWallet = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  const balance = readU64(data, offset);
  offset += 8;
  const totalDeposited = readU64(data, offset);
  offset += 8;
  const totalSettled = readU64(data, offset);
  offset += 8;
  const totalCallsSettled = readU64(data, offset);
  offset += 8;
  const pricePerCall = readU64(data, offset);
  offset += 8;
  const maxCalls = readU64(data, offset);
  offset += 8;
  const createdAt = readI64(data, offset);
  offset += 8;
  const lastSettledAt = readI64(data, offset);
  offset += 8;
  const expiresAt = readI64(data, offset);
  return {
    bump,
    agent,
    depositor,
    agentWallet,
    balance,
    totalDeposited,
    totalSettled,
    totalCallsSettled,
    pricePerCall,
    maxCalls,
    createdAt,
    lastSettledAt,
    expiresAt,
  };
}

function isCoSignedEscrow(escrow: any) {
  return Boolean(
    escrow?.settlementSecurity &&
    typeof escrow.settlementSecurity === "object" &&
    "coSigned" in escrow.settlementSecurity
  );
}

function reorderSettleCallsV2ForDeployedProgram(
  instruction: TransactionInstruction,
  accounts: {
    wallet: PublicKey;
    agent: PublicKey;
    agentStats: PublicKey;
    escrow: PublicKey;
    systemProgram: PublicKey;
    settlementReceipt: PublicKey;
  },
) {
  const byAddress = new Map(instruction.keys.map((meta) => [meta.pubkey.toBase58(), meta]));
  const base = [
    accounts.wallet,
    accounts.agent,
    accounts.agentStats,
    accounts.escrow,
    accounts.systemProgram,
  ].map((pubkey) => {
    const meta = byAddress.get(pubkey.toBase58());
    if (!meta) throw new Error(`settleCallsV2 instruction is missing account ${pubkey.toBase58()}`);
    return meta;
  });
  const baseAddresses = new Set([
    accounts.wallet.toBase58(),
    accounts.agent.toBase58(),
    accounts.agentStats.toBase58(),
    accounts.escrow.toBase58(),
    accounts.systemProgram.toBase58(),
    accounts.settlementReceipt.toBase58(),
  ]);
  instruction.keys = [
    ...base,
    ...instruction.keys.filter((meta) => !baseAddresses.has(meta.pubkey.toBase58())),
  ];
  return instruction;
}

function u64Le(value: number) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}

function legacySettleCallsInstruction(accounts: {
  wallet: PublicKey;
  agent: PublicKey;
  agentStats: PublicKey;
  escrow: PublicKey;
  treasury: PublicKey;
}, callsToSettle: number, serviceHash: number[]) {
  const discriminator = Buffer.from("649cc586dbf503aa", "hex");
  return new TransactionInstruction({
    programId: client.programId,
    keys: [
      { pubkey: accounts.wallet, isSigner: true, isWritable: true },
      { pubkey: accounts.agent, isSigner: false, isWritable: false },
      { pubkey: accounts.agentStats, isSigner: false, isWritable: true },
      { pubkey: accounts.escrow, isSigner: false, isWritable: true },
      {
        pubkey: accounts.treasury,
        isSigner: accounts.treasury.equals(accounts.wallet),
        isWritable: true,
      },
    ],
    data: Buffer.concat([discriminator, u64Le(callsToSettle), Buffer.from(serviceHash)]),
  });
}

async function validateHeaderEscrow(headers: Record<string, string>, callsToSettle: number) {
  const parsed = parseX402Headers(headers);
  const fetched = await fetchEscrowByHeaderPda(parsed.escrowPda);
  if (!fetched) {
    return { valid: false, errors: [`Escrow not found at ${parsed.escrowPda.toBase58()}`], parsed };
  }

  const escrow = fetched.account;
  const errors: string[] = [];
  const escrowAgent = pubkeyString(escrow.agent);
  const escrowDepositor = pubkeyString(escrow.depositor);
  const escrowPrice = asBigInt(escrow.pricePerCall);
  const escrowBalance = asBigInt(escrow.balance);
  const escrowMaxCalls = asBigInt(escrow.maxCalls);
  const escrowSettledCalls = asBigInt(escrow.totalCallsSettled);
  const escrowExpiresAt = asBigInt(escrow.expiresAt);
  const needed = asBigInt(parsed.pricePerCall) * BigInt(callsToSettle);

  if (escrowAgent && escrowAgent !== parsed.agentPda.toBase58()) {
    errors.push(`Escrow agent mismatch: ${escrowAgent} != ${parsed.agentPda.toBase58()}`);
  }
  if (escrowDepositor && escrowDepositor !== parsed.depositorWallet.toBase58()) {
    errors.push(`Escrow depositor mismatch: ${escrowDepositor} != ${parsed.depositorWallet.toBase58()}`);
  }
  if (escrowPrice !== asBigInt(parsed.pricePerCall)) {
    errors.push(`Escrow price mismatch: ${escrowPrice} != ${parsed.pricePerCall.toString()}`);
  }
  if (escrowBalance < needed) {
    errors.push(`Insufficient balance: ${escrowBalance} < ${needed}`);
  }
  if (escrowMaxCalls > 0n && escrowMaxCalls - escrowSettledCalls < BigInt(callsToSettle)) {
    errors.push(`Max calls exceeded: ${escrowMaxCalls - escrowSettledCalls} remaining but needs ${callsToSettle}`);
  }
  if (escrowExpiresAt > 0n && escrowExpiresAt < BigInt(Math.floor(Date.now() / 1000))) {
    errors.push(`Escrow expired at ${escrowExpiresAt}`);
  }

  return {
    valid: errors.length === 0,
    errors,
    parsed,
    escrowValidation: {
      escrowPda: parsed.escrowPda,
      escrow,
      version: fetched.version,
    },
  };
}

async function sendInstructions(instructions: any[], signers: Keypair[] = []) {
  if (!settlementSigner) {
    throw new Error("Settlement requires SAP_AGENT_KEYPAIR_PATH, SAP_SETTLEMENT_KEYPAIR_PATH, or ANCHOR_WALLET.");
  }
  const tx = await client.buildTransaction(instructions, settlementSigner.publicKey, {
    microLamports: Number(process.env.SAP_PRIORITY_MICROLAMPORTS ?? 0) || undefined,
    limit: Number(process.env.SAP_COMPUTE_UNIT_LIMIT ?? 0) || undefined,
  });
  tx.sign([settlementSigner, ...signers]);
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

async function settleHeaderEscrow(body: Record<string, unknown>, headers: Record<string, string>, parsed: any, callsToSettle: number) {
  if (!settlementRequired) {
    return { settled: false, skipped: true, reason: "SAP_SETTLEMENT_REQUIRED=false" };
  }
  if (!settlementSigner) {
    throw new Error("Settlement signer is not configured.");
  }
  if (settlementSigner.publicKey.toBase58() !== process.env.SAP_AGENT_WALLET) {
    const expectedWallet = process.env.SAP_AGENT_WALLET;
    if (expectedWallet) {
      throw new Error(`Settlement signer ${settlementSigner.publicKey.toBase58()} does not match SAP_AGENT_WALLET ${expectedWallet}.`);
    }
  }

  const escrowNonce = readEscrowNonce(headers, body);
  const hash = serviceHash(body, headers, parsed, callsToSettle);
  const [agentStatsPda] = Pdas.getAgentStatsPDA(parsed.agentPda);
  const [settlementReceiptPda] = deriveSettlementReceipt(parsed.escrowPda, Buffer.from(hash), client.programId);
  const fetched = await fetchEscrowByHeaderPda(parsed.escrowPda);
  const escrow = fetched?.account;
  const coSigner = pubkeyString(escrow?.coSigner);
  const extraSigners: Keypair[] = [];
  const existingReceipt = useSettlementReceiptAccount
    ? await client.connection.getAccountInfo(settlementReceiptPda)
    : null;
  if (useSettlementReceiptAccount && existingReceipt) {
    return {
      settled: true,
      alreadySettled: true,
      escrowNonce,
      settlementReceipt: settlementReceiptPda.toBase58(),
      serviceHash: Buffer.from(hash).toString("hex"),
    };
  }

  if (useLegacySettleCalls) {
    const treasury = treasuryAccount ?? settlementSigner.publicKey;
    const instruction = legacySettleCallsInstruction({
      wallet: settlementSigner.publicKey,
      agent: parsed.agentPda,
      agentStats: agentStatsPda,
      escrow: parsed.escrowPda,
      treasury,
    }, callsToSettle, hash);
    const signature = await sendInstructions([instruction]);
    return {
      settled: true,
      alreadySettled: false,
      signature,
      escrowNonce,
      settlementReceipt: null,
      serviceHash: Buffer.from(hash).toString("hex"),
      legacySettleCalls: true,
    };
  }

  let builder = client.program.methods
    .settleCallsV2(new BN(escrowNonce), new BN(callsToSettle), hash)
    .accounts({
      wallet: settlementSigner.publicKey,
      agent: parsed.agentPda,
      agentStats: agentStatsPda,
      escrow: parsed.escrowPda,
      settlementReceipt: settlementReceiptPda,
      systemProgram: SystemProgram.programId,
    });
  if (isCoSignedEscrow(escrow)) {
    if (!coSigner) {
      throw new Error("CoSigned escrow is missing coSigner.");
    }
    if (!coSignerKeypair) {
      throw new Error("CoSigned settlement requires SAP_COSIGNER_KEYPAIR_PATH.");
    }
    if (coSigner !== coSignerKeypair.publicKey.toBase58()) {
      throw new Error(`CoSigned escrow requires coSigner ${coSigner}, but configured SAP_COSIGNER_KEYPAIR_PATH is ${coSignerKeypair.publicKey.toBase58()}.`);
    }
    builder = builder.remainingAccounts([
      ...(treasuryAccount ? [{ pubkey: treasuryAccount, isSigner: false, isWritable: true }] : []),
      { pubkey: coSignerKeypair.publicKey, isSigner: true, isWritable: false },
    ]);
    extraSigners.push(coSignerKeypair);
  }
  let instruction = await builder.instruction();
  if (!useSettlementReceiptAccount) {
    instruction = reorderSettleCallsV2ForDeployedProgram(instruction, {
      wallet: settlementSigner.publicKey,
      agent: parsed.agentPda,
      agentStats: agentStatsPda,
      escrow: parsed.escrowPda,
      systemProgram: SystemProgram.programId,
      settlementReceipt: settlementReceiptPda,
    });
  }
  const signature = await sendInstructions([instruction], extraSigners);
  return {
    settled: true,
    alreadySettled: false,
    signature,
    escrowNonce,
    settlementReceipt: settlementReceiptPda.toBase58(),
    serviceHash: Buffer.from(hash).toString("hex"),
  };
}

const server = BunLikeServer();

function BunLikeServer() {
  return {
    listen() {
      const http = require("node:http") as typeof import("node:http");
      const nodeServer = http.createServer(async (req, res) => {
        try {
          if (req.method === "GET" && req.url === "/health") {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: true, rpcUrl: rpc.url, auth: rpc.apiKey ? "x-api-key" : "none" }));
            return;
          }

          if (req.method !== "POST" || (req.url !== "/verify" && req.url !== "/settle")) {
            res.writeHead(404, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: "not_found" }));
            return;
          }

          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(Buffer.from(chunk));
          const bodyText = Buffer.concat(chunks).toString("utf8");
          const body = bodyText.trim() ? JSON.parse(bodyText) as Record<string, unknown> : {};
          const headers = headerPayload(body);
          const parsed = parseX402Headers(headers);

          if (parsed.agentPda.toBase58() !== expectedAgentPda) {
            throw new Error(`Unexpected X-Payment-Agent ${parsed.agentPda.toBase58()}`);
          }
          if (parsed.programId.toBase58() !== expectedProgramId) {
            throw new Error(`Unexpected X-Payment-Program ${parsed.programId.toBase58()}`);
          }
          if (parsed.network !== allowNetwork) {
            throw new Error(`Unexpected X-Payment-Network ${parsed.network}`);
          }
          if (parsed.pricePerCall.toString() !== expectedPricePerCall) {
            throw new Error(`Unexpected X-Payment-PricePerCall ${parsed.pricePerCall.toString()}`);
          }

          const callsToSettle = Number(body.calls_to_settle ?? body.callsToSettle ?? 1);
          let result = await validateHeaderEscrow(headers, callsToSettle);
          if (!result.valid && (client.escrow as any).fetchByPda) {
            result = await legacyValidator.validateRequest(headers, {
              callsToSettle,
              throwOnMissingAta: false,
            }) as typeof result;
          }

          if (!result.valid) {
            res.writeHead(402, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: false, errors: result.errors }));
            return;
          }

          if (req.url === "/verify") {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({
              ok: true,
              settled: false,
              escrowPda: parsed.escrowPda.toBase58(),
              depositorWallet: parsed.depositorWallet.toBase58(),
              maxCalls: parsed.maxCalls.toString(),
              pricePerCall: parsed.pricePerCall.toString(),
              escrowNonce: readEscrowNonce(headers, body),
            }));
            return;
          }

          const settlement = await settleHeaderEscrow(body, headers, parsed, callsToSettle);
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({
            ok: true,
            ...settlement,
            escrowPda: parsed.escrowPda.toBase58(),
            depositorWallet: parsed.depositorWallet.toBase58(),
            maxCalls: parsed.maxCalls.toString(),
            pricePerCall: parsed.pricePerCall.toString(),
          }));
        } catch (error) {
          res.writeHead(402, { "content-type": "application/json" });
          res.end(JSON.stringify({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }));
        }
      });

      nodeServer.listen(port, "127.0.0.1", () => {
        console.log(`SAP payment verifier listening on http://127.0.0.1:${port}/verify`);
      });
    },
  };
}

server.listen();
