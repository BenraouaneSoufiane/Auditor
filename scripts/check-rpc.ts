import "dotenv/config";

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Keypair } from "@solana/web3.js";

const require = createRequire(import.meta.url);
const { Pdas } = require("@oobe-protocol-labs/synapse-sap-sdk") as typeof import("@oobe-protocol-labs/synapse-sap-sdk");

const rawUrl = process.env.SAP_RPC_URL ?? process.env.SYNAPSE_RPC_URL;
const rawApiKey = process.env.SAP_RPC_API_KEY ?? process.env.SYNAPSE_API_KEY;
const keypairPath = process.env.SAP_KEYPAIR_PATH ?? process.env.ANCHOR_WALLET;

if (!rawUrl) {
  throw new Error("Missing SAP_RPC_URL or SYNAPSE_RPC_URL.");
}

const url = new URL(rawUrl);
const queryApiKey = url.searchParams.get("api_key") ?? url.searchParams.get("apikey");
const apiKey = rawApiKey ?? queryApiKey ?? undefined;
url.searchParams.delete("api_key");
url.searchParams.delete("apikey");

function loadKeypair(path: string): Keypair {
  const secret = JSON.parse(readFileSync(resolve(path), "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

async function rpc(method: string, params: unknown[]) {
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { "x-api-key": apiKey } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: method, method, params }),
  });
  const text = await response.text();
  return {
    method,
    status: response.status,
    ok: response.ok,
    body: text.slice(0, 2000),
  };
}

try {
  const checks = [
    await rpc("getLatestBlockhash", [{ commitment: "confirmed" }]),
  ];

  if (keypairPath) {
    const signer = loadKeypair(keypairPath);
    const [agentPda] = Pdas.getAgentPDA(signer.publicKey);
    const [agentStatsPda] = Pdas.getAgentStatsPDA(agentPda);
    const [globalPda] = Pdas.getGlobalPDA();
    const accounts = {
      wallet: signer.publicKey.toBase58(),
      agentPda: agentPda.toBase58(),
      agentStatsPda: agentStatsPda.toBase58(),
      globalPda: globalPda.toBase58(),
    };

    for (const [label, address] of Object.entries(accounts)) {
      checks.push(await rpc("getAccountInfo", [
        address,
        { encoding: "base64", commitment: "confirmed" },
      ]).then((result) => ({ ...result, label, address })));
    }
  }

  console.log(JSON.stringify({
    url: url.toString(),
    auth: apiKey ? "x-api-key" : "none",
    checks,
  }, null, 2));
} catch (error) {
  console.error("RPC fetch failed.");
  console.error(error);
  process.exitCode = 1;
}
