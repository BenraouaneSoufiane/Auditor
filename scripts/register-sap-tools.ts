import "dotenv/config";

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { Connection, Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import type { SapClient as SapClientType } from "@oobe-protocol-labs/synapse-sap-sdk";
import type BNType from "bn.js";

import manifest from "../sap/auditor-tools.json" with { type: "json" };

type SapTool = (typeof manifest.tools)[number];
type PricingConfig = (typeof manifest.agent.pricing)[number];
type AgentPricingTier = {
  tierId: string;
  pricePerCall: BNType;
  minPricePerCall: BNType | null;
  maxPricePerCall: BNType | null;
  rateLimit: number;
  maxCallsPerSession: number;
  burstLimit: number | null;
  tokenType: unknown;
  tokenMint: PublicKey | null;
  tokenDecimals: number | null;
  settlementMode: unknown;
  minEscrowDeposit: BNType | null;
  batchIntervalSec: number | null;
  volumeCurve: null;
};

const require = createRequire(import.meta.url);
const { BN, Wallet } = require("@coral-xyz/anchor") as typeof import("@coral-xyz/anchor");
const { SapClient, Pdas } = require("@oobe-protocol-labs/synapse-sap-sdk") as typeof import("@oobe-protocol-labs/synapse-sap-sdk");
const { TokenType, SettlementMode } = require("@oobe-protocol-labs/synapse-sap-sdk/types") as typeof import("@oobe-protocol-labs/synapse-sap-sdk/types");

const RPC_URL = process.env.SAP_RPC_URL ?? process.env.SYNAPSE_RPC_URL;
const RPC_API_KEY = process.env.SAP_RPC_API_KEY ?? process.env.SYNAPSE_API_KEY;
const KEYPAIR_PATH = process.env.SAP_KEYPAIR_PATH ?? process.env.ANCHOR_WALLET;
const AGENT_BASE_URL = (process.env.AGENT_BASE_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, "");
const OUT_PATH = process.env.SAP_REGISTRATION_OUT ?? "work/sap-registration.json";
const ASSUME_MISSING_ON_ACCOUNT_INFO_ERROR =
  (process.env.SAP_ASSUME_MISSING_ON_ACCOUNT_INFO_ERROR ?? "true").toLowerCase() !== "false";
const BUILD_ONLY = (process.env.SAP_BUILD_ONLY ?? "false").toLowerCase() === "true";
const INSCRIBE_SCHEMAS = (process.env.SAP_INSCRIBE_SCHEMAS ?? "false").toLowerCase() === "true";
const SKIP_ACCOUNT_CHECKS = (process.env.SAP_SKIP_ACCOUNT_CHECKS ?? "false").toLowerCase() === "true";
const ASSUME_AGENT_REGISTERED = (process.env.SAP_ASSUME_AGENT_REGISTERED ?? "false").toLowerCase() === "true";
const UPDATE_AGENT = (process.env.SAP_UPDATE_AGENT ?? "false").toLowerCase() === "true";
const CONFIRM_TRANSACTIONS = (process.env.SAP_CONFIRM_TRANSACTIONS ?? "true").toLowerCase() !== "false";
const SKIP_TOOLS = new Set(
  (process.env.SAP_SKIP_TOOLS ?? "")
    .split(",")
    .map((tool) => tool.trim())
    .filter(Boolean),
);

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

function rpcConfig(rawUrl: string) {
  const parsed = new URL(rawUrl);
  const queryApiKey = parsed.searchParams.get("api_key") ?? parsed.searchParams.get("apikey");
  const apiKey = RPC_API_KEY ?? queryApiKey ?? undefined;

  if (queryApiKey) {
    parsed.searchParams.delete("api_key");
    parsed.searchParams.delete("apikey");
    console.error("Using RPC API key from query string as x-api-key header for Synapse compatibility.");
  }

  return {
    url: parsed.toString(),
    apiKey,
  };
}

function redactUrl(rawUrl: string) {
  const parsed = new URL(rawUrl);
  if (parsed.searchParams.has("api_key")) parsed.searchParams.set("api_key", "redacted");
  if (parsed.searchParams.has("apikey")) parsed.searchParams.set("apikey", "redacted");
  return parsed.toString();
}

function hashBytes(value: string): number[] {
  return Array.from(createHash("sha256").update(value).digest());
}

function deriveToolPda(agentPda: PublicKey, toolName: string, programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("sap_tool"), agentPda.toBuffer(), Buffer.from(hashBytes(toolName))],
    programId,
  );
}

function derivePricingMenu(agentPda: PublicKey, programId: PublicKey) {
  return PublicKey.findProgramAddressSync([Buffer.from("sap_pricing"), agentPda.toBuffer()], programId);
}

function deployedUpdateAgentIx(ix: TransactionInstruction) {
  if (ix.keys.length !== 4) return ix;
  return new TransactionInstruction({
    programId: ix.programId,
    data: ix.data,
    keys: [ix.keys[0], ix.keys[1], ix.keys[3], ix.keys[2]],
  });
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
  tx.sign([signer]);
  const signature = await client.connection.sendRawTransaction(tx.serialize(), {
    preflightCommitment: "confirmed",
    maxRetries: 3,
  });
  if (!CONFIRM_TRANSACTIONS) return signature;

  const confirmation = await client.connection.confirmTransaction(signature, "confirmed");
  if (confirmation.value.err) {
    throw new Error(`Transaction ${signature} failed confirmation: ${JSON.stringify(confirmation.value.err)}`);
  }
  return signature;
}

async function accountExists(client: SapClientType, address: PublicKey, label: string): Promise<boolean> {
  if (SKIP_ACCOUNT_CHECKS) {
    console.error(`Skipping getAccountInfo for ${label} because SAP_SKIP_ACCOUNT_CHECKS=true.`);
    return false;
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      console.error(`Checking ${label} account ${address.toBase58()} (${attempt}/3)`);
      const info = await client.connection.getAccountInfo(address);
      if (!info) return false;

      const owner = info.owner.toBase58();
      const programId = client.programId.toBase58();
      console.error(`Found ${label} account owner=${owner} data_len=${info.data.length}`);

      if (owner !== programId || info.data.length < 8) {
        console.error(
          `Treating ${label} as not initialized because it is not a SAP-owned initialized account.`,
        );
        return false;
      }

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`RPC getAccountInfo failed for ${label}: ${message}`);
      if (attempt < 3) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000 * attempt));
      }
    }
  }

  if (ASSUME_MISSING_ON_ACCOUNT_INFO_ERROR) {
    console.error(
      `Assuming ${label} account is missing after RPC errors. Set SAP_ASSUME_MISSING_ON_ACCOUNT_INFO_ERROR=false to fail instead.`,
    );
    return false;
  }

  throw new Error(`Could not check ${label} account ${address.toBase58()} with getAccountInfo.`);
}

async function publishTool(
  client: SapClientType,
  signer: Keypair,
  agentPda: PublicKey,
  globalPda: PublicKey,
  tool: SapTool,
) {
  if (SKIP_TOOLS.has(tool.name)) {
    return { name: tool.name, skipped: true, reason: "SAP_SKIP_TOOLS" };
  }

  const [toolPda] = deriveToolPda(agentPda, tool.name, client.programId);
  const existing = await accountExists(client, toolPda, `tool:${tool.name}`);

  const inputSchema = schemaString(tool.inputSchema);
  const outputSchema = schemaString(tool.outputSchema);
  const descriptionSchema = schemaString({
    name: tool.name,
    protocol: tool.protocol,
    description: tool.description,
    localUrl: `${AGENT_BASE_URL}/sap/tools/${tool.name}`,
  });

  let publishTx = "already_exists";
  if (!existing) {
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
    publishTx = await sendOne(client, signer, publishIx);
  }

  const schemaTxs = [];
  if (INSCRIBE_SCHEMAS) {
    for (const [schemaType, data] of [
      [0, inputSchema],
      [1, outputSchema],
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
  }

  return {
    name: tool.name,
    toolPda: toolPda.toBase58(),
    publishTx,
    schemaInscription: INSCRIBE_SCHEMAS ? "enabled" : "disabled",
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
    tierId: tier.tierId,
    pricePerCall: new BN(tier.pricePerCall),
    minPricePerCall: null,
    maxPricePerCall: null,
    rateLimit: tier.rateLimit,
    maxCallsPerSession: tier.maxCallsPerSession,
    burstLimit: tier.burstLimit,
    tokenType: tokenTypeFor(tier.tokenType),
    tokenMint: null,
    tokenDecimals: tier.tokenType === "sol" ? 9 : 6,
    settlementMode: settlementModeFor(tier.settlementMode),
    minEscrowDeposit: tier.minEscrowDeposit ? new BN(tier.minEscrowDeposit) : null,
    batchIntervalSec: null,
    volumeCurve: null,
  };
}

async function main() {
  const rpcUrl = requireEnv(RPC_URL, "SAP_RPC_URL or SYNAPSE_RPC_URL");
  const keypairPath = requireEnv(KEYPAIR_PATH, "SAP_KEYPAIR_PATH or ANCHOR_WALLET");
  const signer = loadKeypair(keypairPath);
  const wallet = new Wallet(signer);
  const rpc = rpcConfig(rpcUrl);
  const connection = new Connection(rpc.url, {
    commitment: "confirmed",
    httpHeaders: rpc.apiKey ? { "x-api-key": rpc.apiKey } : undefined,
  });
  const client: SapClientType = new SapClient({ connection, wallet });

  const [agentPda] = Pdas.getAgentPDA(signer.publicKey);
  const [agentStatsPda] = Pdas.getAgentStatsPDA(agentPda);
  const [globalPda] = Pdas.getGlobalPDA();
  const [pricingMenuPda] = derivePricingMenu(agentPda, client.programId);

  const capabilities = manifest.agent.capabilities.map((capability) => ({
    id: capability.id,
    description: capability.description,
    protocolId: capability.protocolId,
    version: capability.version,
  }));

  const result: Record<string, unknown> = {
    cluster: "mainnet-beta",
    rpcUrl: redactUrl(rpc.url),
    rpcAuth: rpc.apiKey ? "x-api-key" : "none",
    wallet: signer.publicKey.toBase58(),
    agentPda: agentPda.toBase58(),
    agentStatsPda: agentStatsPda.toBase58(),
    globalPda: globalPda.toBase58(),
    pricingMenuPda: pricingMenuPda.toBase58(),
    agentBaseUrl: AGENT_BASE_URL,
    agentUri: `${AGENT_BASE_URL}/sap/agent`,
    x402Endpoint: `${AGENT_BASE_URL}/sap/tools`,
  };

  if (BUILD_ONLY) {
    await client.agent.registerAgent({
      signer,
      wallet: signer.publicKey,
      agent: agentPda,
      agentStats: agentStatsPda,
      globalRegistry: globalPda,
      name: manifest.agent.name,
      description: manifest.agent.description,
      capabilities: capabilities as never,
      pricing: manifest.agent.pricing.map(pricingTierFromConfig) as never,
      protocols: manifest.agent.protocols,
      agentId: manifest.agent.agentId,
      agentUri: `${AGENT_BASE_URL}/sap/agent`,
      x402Endpoint: `${AGENT_BASE_URL}/sap/tools`,
    });
    result.buildOnly = true;
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const existingAgent = ASSUME_AGENT_REGISTERED || await accountExists(client, agentPda, "agent");
  if (existingAgent) {
    result.agentSkipped = true;
    if (ASSUME_AGENT_REGISTERED) result.agentSkipReason = "SAP_ASSUME_AGENT_REGISTERED";
    if (UPDATE_AGENT) {
      const updateIx = await client.agent.updateAgent({
        signer,
        wallet: signer.publicKey,
        agent: agentPda,
        pricingMenu: pricingMenuPda,
        name: null,
        description: null,
        capabilities: null,
        pricing: manifest.agent.pricing.map(pricingTierFromConfig) as never,
        protocols: null,
        agentId: null,
        agentUri: null,
        x402Endpoint: null,
      });
      result.agentUpdateMode = "pricing_only";
      result.agentUpdateTx = await sendOne(client, signer, deployedUpdateAgentIx(updateIx));
    }
  } else {
    const registerIx = await client.agent.registerAgent({
      signer,
      wallet: signer.publicKey,
      agent: agentPda,
      agentStats: agentStatsPda,
      globalRegistry: globalPda,
      name: manifest.agent.name,
      description: manifest.agent.description,
      capabilities: capabilities as never,
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
