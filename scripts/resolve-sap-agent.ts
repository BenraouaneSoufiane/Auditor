import "dotenv/config";

import { createHash } from "node:crypto";
import { createRequire } from "node:module";

import { Connection, PublicKey } from "@solana/web3.js";

import manifest from "../sap/auditor-tools.json" with { type: "json" };

type DiscoveryRequest = {
  rpcUrl?: string;
  rpcApiKey?: string;
  agentId?: string;
};

const require = createRequire(import.meta.url);
const { SapClient, Pdas } = require("@oobe-protocol-labs/synapse-sap-sdk") as typeof import("@oobe-protocol-labs/synapse-sap-sdk");

function rpcConfig(raw: string, explicitApiKey?: string) {
  const parsed = new URL(raw);
  const queryApiKey = parsed.searchParams.get("api_key") ?? parsed.searchParams.get("apikey");
  parsed.searchParams.delete("api_key");
  parsed.searchParams.delete("apikey");
  return {
    url: parsed.toString(),
    apiKey: explicitApiKey ?? queryApiKey ?? undefined,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function field(source: unknown, camelName: string, snakeName?: string) {
  const record = asRecord(source);
  return record[camelName] ?? (snakeName ? record[snakeName] : undefined);
}

function stringify(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (typeof value === "object") {
    const maybe = value as { toBase58?: () => string; toString?: () => string };
    if (typeof maybe.toBase58 === "function") return maybe.toBase58();
    if (typeof maybe.toString === "function") return maybe.toString();
  }
  return String(value);
}

function numberString(value: unknown): string | null {
  const text = stringify(value);
  return text && text !== "[object Object]" ? text : null;
}

function hashBytes(value: string) {
  return createHash("sha256").update(value).digest();
}

function deriveToolPda(agentPda: PublicKey, toolName: string, programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("sap_tool"), agentPda.toBuffer(), hashBytes(toolName)],
    programId,
  );
}

function serializeCapability(value: unknown) {
  return {
    id: stringify(field(value, "id")),
    description: stringify(field(value, "description")),
    protocolId: stringify(field(value, "protocolId", "protocol_id")),
    version: stringify(field(value, "version")),
  };
}

function serializePricing(value: unknown) {
  return {
    tierId: stringify(field(value, "tierId", "tier_id")),
    pricePerCall: numberString(field(value, "pricePerCall", "price_per_call")),
    rateLimit: Number(numberString(field(value, "rateLimit", "rate_limit")) ?? 0),
    maxCallsPerSession: Number(numberString(field(value, "maxCallsPerSession", "max_calls_per_session")) ?? 0),
    burstLimit: Number(numberString(field(value, "burstLimit", "burst_limit")) ?? 0),
    tokenType: stringify(field(value, "tokenType", "token_type")),
    settlementMode: stringify(field(value, "settlementMode", "settlement_mode")),
    minEscrowDeposit: numberString(field(value, "minEscrowDeposit", "min_escrow_deposit")),
  };
}

function serializeAgent(identity: unknown, agentPda: PublicKey) {
  const wallet = stringify(field(identity, "wallet"));
  const agentUri = stringify(field(identity, "agentUri", "agent_uri"));
  const x402Endpoint = stringify(field(identity, "x402Endpoint", "x402_endpoint"));
  const pricingRaw = field(identity, "pricing");
  const capabilitiesRaw = field(identity, "capabilities");
  const protocolsRaw = field(identity, "protocols");
  return {
    wallet,
    agentPda: agentPda.toBase58(),
    agentBaseUrl: agentUri ? new URL(agentUri).origin : null,
    agentUri,
    x402Endpoint,
    agent: {
      name: stringify(field(identity, "name")),
      description: stringify(field(identity, "description")),
      agentId: stringify(field(identity, "agentId", "agent_id")),
      isActive: Boolean(field(identity, "isActive", "is_active")),
      protocols: Array.isArray(protocolsRaw) ? protocolsRaw.map((item) => stringify(item)).filter(Boolean) : [],
      capabilities: Array.isArray(capabilitiesRaw) ? capabilitiesRaw.map(serializeCapability) : [],
      pricing: Array.isArray(pricingRaw) ? pricingRaw.map(serializePricing) : [],
    },
  };
}

async function fetchTool(client: InstanceType<typeof SapClient>, agentPda: PublicKey, toolName: string) {
  try {
    const [toolPda] = deriveToolPda(agentPda, toolName, client.programId);
    const descriptor = await (client.program.account as unknown as {
      toolDescriptor: { fetch(toolPda: PublicKey): Promise<unknown> };
    }).toolDescriptor.fetch(toolPda);
    return {
      name: toolName,
      toolPda: toolPda.toBase58(),
      protocolHash: stringify(field(descriptor, "protocolHash", "protocol_hash")),
      descriptionHash: stringify(field(descriptor, "descriptionHash", "description_hash")),
      inputSchemaHash: stringify(field(descriptor, "inputSchemaHash", "input_schema_hash")),
      outputSchemaHash: stringify(field(descriptor, "outputSchemaHash", "output_schema_hash")),
      paramsCount: Number(numberString(field(descriptor, "paramsCount", "params_count")) ?? 0),
      requiredParams: Number(numberString(field(descriptor, "requiredParams", "required_params")) ?? 0),
      isActive: Boolean(field(descriptor, "isActive", "is_active") ?? true),
    };
  } catch {
    return { name: toolName, missing: true };
  }
}

async function resolveIdentity(client: InstanceType<typeof SapClient>, request: DiscoveryRequest) {
  if (!request.agentId) {
    throw new Error("Missing SAP_AGENT_ID. Set it to the agent owner Solana address.");
  }
  const wallet = new PublicKey(request.agentId);
  const [agentPda] = Pdas.getAgentPDA(wallet);
  const identity = await (client.program.account as unknown as {
    agentAccount: { fetch(agentPda: PublicKey): Promise<unknown> };
  }).agentAccount.fetch(agentPda);
  return { pda: agentPda, identity };
}

async function main() {
  const request = JSON.parse(process.env.SAP_AGENT_DISCOVERY_REQUEST ?? "{}") as DiscoveryRequest;
  request.agentId ??= process.env.SAP_AGENT_ID;
  const rawRpcUrl = request.rpcUrl ?? process.env.SAP_RPC_URL ?? process.env.SYNAPSE_RPC_URL;
  if (!rawRpcUrl) {
    throw new Error("Missing rpcUrl, SAP_RPC_URL, or SYNAPSE_RPC_URL for SAP agent discovery.");
  }

  const rpc = rpcConfig(rawRpcUrl, request.rpcApiKey ?? process.env.SAP_RPC_API_KEY ?? process.env.SYNAPSE_API_KEY);
  const connection = new Connection(rpc.url, {
    commitment: "confirmed",
    httpHeaders: rpc.apiKey ? { "x-api-key": rpc.apiKey } : undefined,
  });
  const client = new SapClient({ connection }) as InstanceType<typeof SapClient>;
  const resolved = await resolveIdentity(client, request);
  const toolNames = manifest.tools.map((tool) => tool.name);
  const tools = await Promise.all(toolNames.map((toolName) => fetchTool(client, resolved.pda, toolName)));

  console.log(JSON.stringify({
    source: "sap-onchain-registry",
    rpcUrl: rpc.url,
    rpcAuth: rpc.apiKey ? "x-api-key" : "none",
    ...serializeAgent(resolved.identity, resolved.pda),
    tools,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
