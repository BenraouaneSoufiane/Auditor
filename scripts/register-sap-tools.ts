import "dotenv/config";

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { Keypair, PublicKey, type TransactionInstruction } from "@solana/web3.js";
import type { SapClient as SapClientType } from "@oobe-protocol-labs/synapse-sap-sdk";
import type BNType from "bn.js";

import manifest from "../sap/auditor-tools.json" with { type: "json" };

type SapTool = (typeof manifest.tools)[number];
type PricingConfig = (typeof manifest.agent.pricing)[number];
type AgentPricingTier = {
  tier_id: string;
  price_per_call: BNType;
  min_price_per_call: BNType | null;
  max_price_per_call: BNType | null;
  rate_limit: number;
  max_calls_per_session: number;
  burst_limit: number | null;
  token_type: unknown;
  token_mint: PublicKey | null;
  token_decimals: number | null;
  settlement_mode: unknown;
  min_escrow_deposit: BNType | null;
  batch_interval_sec: number | null;
  volume_curve: null;
};

const require = createRequire(import.meta.url);
const { BN, Wallet } = require("@coral-xyz/anchor") as typeof import("@coral-xyz/anchor");
const { SapClient, Pdas } = require("@oobe-protocol-labs/synapse-sap-sdk") as typeof import("@oobe-protocol-labs/synapse-sap-sdk");
const { TokenType, SettlementMode } = require("@oobe-protocol-labs/synapse-sap-sdk/types") as typeof import("@oobe-protocol-labs/synapse-sap-sdk/types");

const RPC_URL = process.env.SAP_RPC_URL ?? process.env.SYNAPSE_RPC_URL;
const KEYPAIR_PATH = process.env.SAP_KEYPAIR_PATH ?? process.env.ANCHOR_WALLET;
const AGENT_BASE_URL = (process.env.AGENT_BASE_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, "");
const OUT_PATH = process.env.SAP_REGISTRATION_OUT ?? "work/sap-registration.json";

function requireEnv(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing ${name}. Set it before running npm run sap:register.`);
  }
  return value;
}

function loadKeypair(path: string): Keypair {
  const secret = JSON.parse(readFileSync(resolve(path), "utf8"));
  if (!Array.isArray(secret)) {
    throw new Error(`Expected ${path} to contain a Solana secret-key byte array.`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function hashBytes(value: string): number[] {
  return Array.from(createHash("sha256").update(value).digest());
}

function schemaString(value: unknown): string {
  return JSON.stringify(value);
}

async function sendOne(
  client: SapClientType,
  signer: Keypair,
  instruction: TransactionInstruction,
): Promise<string> {
  const tx = await client.buildTransaction([instruction], signer.publicKey, {
    microLamports: Number(process.env.SAP_PRIORITY_MICROLAMPORTS ?? 0) || undefined,
    limit: Number(process.env.SAP_COMPUTE_UNIT_LIMIT ?? 0) || undefined,
  });
  return client.sendTransaction(tx, [signer], { commitment: "confirmed", maxRetries: 3 });
}

async function publishTool(
  client: SapClientType,
  signer: Keypair,
  agentPda: PublicKey,
  globalPda: PublicKey,
  tool: SapTool,
) {
  const [toolPda] = Pdas.getToolPDA(agentPda, tool.name);
  const existing = await client.connection.getAccountInfo(toolPda);

  if (existing) {
    return { name: tool.name, toolPda: toolPda.toBase58(), skipped: true };
  }

  const inputSchema = schemaString(tool.inputSchema);
  const outputSchema = schemaString(tool.outputSchema);
  const descriptionSchema = schemaString({
    name: tool.name,
    protocol: tool.protocol,
    description: tool.description,
    localUrl: `${AGENT_BASE_URL}/sap/tools/${tool.name}`,
  });

  const publishIx = await client.tools.publishTool({
    signer,
    wallet: signer.publicKey,
    agent: agentPda,
    tool: toolPda,
    globalRegistry: globalPda,
    toolName: tool.name,
    toolNameHash: hashBytes(tool.name),
    protocolHash: hashBytes(tool.protocol),
    descriptionHash: hashBytes(tool.description),
    inputSchemaHash: hashBytes(inputSchema),
    outputSchemaHash: hashBytes(outputSchema),
    httpMethod: tool.httpMethod,
    category: tool.category,
    paramsCount: tool.paramsCount,
    requiredParams: tool.requiredParams,
    isCompound: tool.isCompound,
  });
  const publishTx = await sendOne(client, signer, publishIx);

  const schemaTxs = [];
  for (const [schemaType, data] of [
    [0, inputSchema],
    [1, outputSchema],
    [2, descriptionSchema],
  ] as const) {
    const schemaIx = await client.tools.inscribeToolSchema({
      signer,
      wallet: signer.publicKey,
      agent: agentPda,
      tool: toolPda,
      schemaType,
      schemaData: Buffer.from(data, "utf8"),
      schemaHash: hashBytes(data),
      compression: 0,
    });
    schemaTxs.push(await sendOne(client, signer, schemaIx));
  }

  return {
    name: tool.name,
    toolPda: toolPda.toBase58(),
    publishTx,
    schemaTxs,
    localUrl: `${AGENT_BASE_URL}/sap/tools/${tool.name}`,
  };
}

function tokenTypeFor(value: PricingConfig["tokenType"]) {
  switch (value) {
    case "sol":
      return TokenType.Sol;
    case "usdc":
      return TokenType.Usdc;
    case "spl":
      return TokenType.Spl;
  }
}

function settlementModeFor(value: PricingConfig["settlementMode"]) {
  switch (value) {
    case "escrow":
      return SettlementMode.Escrow;
    case "x402":
      return SettlementMode.X402;
    case "instant":
      return SettlementMode.Instant;
    case "batched":
      return SettlementMode.Batched;
  }
}

function pricingTierFromConfig(tier: PricingConfig): AgentPricingTier {
  return {
    tier_id: tier.tierId,
    price_per_call: new BN(tier.pricePerCall),
    min_price_per_call: null,
    max_price_per_call: null,
    rate_limit: tier.rateLimit,
    max_calls_per_session: tier.maxCallsPerSession,
    burst_limit: tier.burstLimit,
    token_type: tokenTypeFor(tier.tokenType),
    token_mint: null,
    token_decimals: tier.tokenType === "sol" ? 9 : 6,
    settlement_mode: settlementModeFor(tier.settlementMode),
    min_escrow_deposit: tier.minEscrowDeposit ? new BN(tier.minEscrowDeposit) : null,
    batch_interval_sec: null,
    volume_curve: null,
  };
}

async function main() {
  const rpcUrl = requireEnv(RPC_URL, "SAP_RPC_URL or SYNAPSE_RPC_URL");
  const keypairPath = requireEnv(KEYPAIR_PATH, "SAP_KEYPAIR_PATH or ANCHOR_WALLET");
  const signer = loadKeypair(keypairPath);
  const wallet = new Wallet(signer);
  const client: SapClientType = new SapClient({ rpcUrl, wallet });

  const [agentPda] = Pdas.getAgentPDA(signer.publicKey);
  const [agentStatsPda] = Pdas.getAgentStatsPDA(agentPda);
  const [globalPda] = Pdas.getGlobalPDA();

  const capabilities = manifest.agent.capabilities.map((capability) => ({
    id: capability.id,
    description: capability.description,
    protocol_id: capability.protocolId,
    version: capability.version,
  }));

  const result: Record<string, unknown> = {
    cluster: "mainnet-beta",
    rpcUrl,
    wallet: signer.publicKey.toBase58(),
    agentPda: agentPda.toBase58(),
    agentStatsPda: agentStatsPda.toBase58(),
    globalPda: globalPda.toBase58(),
    agentBaseUrl: AGENT_BASE_URL,
    agentUri: `${AGENT_BASE_URL}/sap/agent`,
    x402Endpoint: `${AGENT_BASE_URL}/sap/tools`,
  };

  const existingAgent = await client.connection.getAccountInfo(agentPda);
  if (existingAgent) {
    result.agentSkipped = true;
  } else {
    const registerIx = await client.agent.registerAgent({
      signer,
      wallet: signer.publicKey,
      agent: agentPda,
      agentStats: agentStatsPda,
      globalRegistry: globalPda,
      name: manifest.agent.name,
      description: manifest.agent.description,
      capabilities,
      pricing: manifest.agent.pricing.map(pricingTierFromConfig) as never,
      protocols: manifest.agent.protocols,
      agentId: manifest.agent.agentId,
      agentUri: `${AGENT_BASE_URL}/sap/agent`,
      x402Endpoint: `${AGENT_BASE_URL}/sap/tools`,
    });
    result.agentTx = await sendOne(client, signer, registerIx);
  }

  const tools = [];
  for (const tool of manifest.tools) {
    tools.push(await publishTool(client, signer, agentPda, globalPda, tool));
  }
  result.tools = tools;

  writeFileSync(resolve(OUT_PATH), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
