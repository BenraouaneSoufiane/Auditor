import "dotenv/config";

import { createRequire } from "node:module";
import { resolve } from "node:path";
import { Connection, PublicKey } from "@solana/web3.js";

const require = createRequire(import.meta.url);
const { SapClient } = require("@oobe-protocol-labs/synapse-sap-sdk") as typeof import("@oobe-protocol-labs/synapse-sap-sdk");
const { SapMerchantValidator, parseX402Headers } = require(
  resolve("node_modules/@oobe-protocol-labs/synapse-sap-sdk/dist/cjs/utils/merchant-validator.js"),
);

const rawUrl = process.env.SAP_RPC_URL ?? process.env.SYNAPSE_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const rawApiKey = process.env.SAP_RPC_API_KEY ?? process.env.SYNAPSE_API_KEY;
const port = Number(process.env.SAP_PAYMENT_VERIFIER_PORT ?? "8787");
const expectedAgentPda = process.env.SAP_AGENT_PDA ?? "5qPThoENH14iJD3MpJfU4w8pAeHJ5wAzWcdWXm6SY5Y7";
const expectedProgramId = process.env.SAP_PROGRAM_ID ?? "SAPpUhsWLJG1FfkGRcXagEDMrMsWGjbky7AyhGpFETZ";
const expectedPricePerCall = process.env.SAP_PRICE_PER_CALL_LAMPORTS ?? "1000";
const allowNetwork = process.env.SAP_PAYMENT_NETWORK ?? "solana:mainnet-beta";

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

async function readJson(req: Request) {
  const text = await req.text();
  if (!text.trim()) return {};
  return JSON.parse(text) as Record<string, unknown>;
}

const rpc = rpcConfig(rawUrl);
const connection = new Connection(rpc.url, {
  commitment: "confirmed",
  httpHeaders: rpc.apiKey ? { "x-api-key": rpc.apiKey } : undefined,
});
const client = new SapClient({ connection });
const validator = new SapMerchantValidator(connection, (pda: PublicKey) =>
  (client.escrow as any).fetchByPda(pda).catch(() => null),
);

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

          if (req.method !== "POST" || req.url !== "/verify") {
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

          const result = await validator.validateRequest(headers, {
            callsToSettle: Number(body.calls_to_settle ?? body.callsToSettle ?? 1),
            throwOnMissingAta: false,
          });

          if (!result.valid) {
            res.writeHead(402, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: false, errors: result.errors }));
            return;
          }

          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({
            ok: true,
            escrowPda: result.escrowValidation.escrowPda.toBase58(),
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
