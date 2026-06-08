#!/usr/bin/env python3
"""Paid SAP caller for the Auditor agent."""

from __future__ import annotations

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import subprocess
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse
from urllib.error import HTTPError
from urllib.request import Request, urlopen

try:
    from dotenv import load_dotenv
except ModuleNotFoundError:
    def load_dotenv(path: Path) -> None:
        if not path.exists():
            return
        for line in path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, value = stripped.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / ".env")
WORKDIR = Path(os.getenv("WORKDIR", ROOT / "work")).resolve()
DEFAULT_REGISTRATION = WORKDIR / "sap-registration.json"
DEFAULT_RECEIPTS = WORKDIR / "caller_receipts.jsonl"
PAYMENT_SCRIPT = ROOT / "scripts" / "sap-caller-payment.ts"
DEFAULT_KEYPAIR = ROOT / ".sap-keypair-mainnet.json"

HOME_HTML = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Auditor Caller</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #090c10;
      --panel: #111821;
      --panel-2: #151f2a;
      --text: #f2f6fb;
      --muted: #94a3b8;
      --line: #273445;
      --accent: #45d19f;
      --accent-2: #f5c542;
      --danger: #ff6b6b;
      --input: #080d13;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      width: min(1240px, calc(100% - 28px));
      margin: 0 auto;
      padding: 28px 0;
    }
    header {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 18px;
      padding: 18px 0 24px;
      border-bottom: 1px solid var(--line);
    }
    h1, h2, h3, p { margin: 0; }
    h1 { font-size: clamp(1.9rem, 4vw, 3.2rem); line-height: 1; letter-spacing: 0; }
    header p { margin-top: 10px; color: var(--muted); line-height: 1.5; }
    .status {
      min-width: min(100%, 340px);
      padding: 14px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      overflow-wrap: anywhere;
    }
    .status b { display: block; margin-bottom: 4px; color: var(--accent); font-size: 0.82rem; }
    .layout {
      display: grid;
      grid-template-columns: minmax(320px, 0.9fr) minmax(0, 1.35fr);
      gap: 18px;
      padding-top: 18px;
      align-items: start;
    }
    section, aside {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
    }
    .stack { display: grid; gap: 18px; }
    .block { padding: 18px; }
    .block + .block { border-top: 1px solid var(--line); }
    h2 { font-size: 1rem; letter-spacing: 0; }
    h3 { font-size: 0.95rem; letter-spacing: 0; }
    .hint { margin-top: 6px; color: var(--muted); font-size: 0.88rem; line-height: 1.45; }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      margin-top: 14px;
    }
    label {
      display: grid;
      gap: 6px;
      color: var(--muted);
      font-size: 0.8rem;
      font-weight: 700;
    }
    input, select, textarea {
      width: 100%;
      min-height: 40px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 9px 10px;
      background: var(--input);
      color: var(--text);
      font: inherit;
      letter-spacing: 0;
    }
    textarea {
      min-height: 118px;
      resize: vertical;
      font: 0.86rem/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    .actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-top: 14px;
    }
    button {
      min-height: 40px;
      border: 1px solid transparent;
      border-radius: 8px;
      padding: 0 14px;
      color: #07110d;
      background: var(--accent);
      font: inherit;
      font-weight: 800;
      cursor: pointer;
    }
    button.secondary {
      color: var(--text);
      background: transparent;
      border-color: var(--line);
    }
    button.warning { background: var(--accent-2); color: #171202; }
    button:disabled { opacity: 0.64; cursor: wait; }
    .output {
      min-height: 260px;
      max-height: 720px;
      overflow: auto;
      padding: 14px;
      border-radius: 8px;
      border: 1px solid var(--line);
      background: #070b10;
      color: #c5d2e3;
      font: 0.84rem/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .reports {
      display: grid;
      gap: 10px;
      margin-top: 14px;
    }
    .row {
      display: grid;
      gap: 8px;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel-2);
    }
    .row .meta { color: var(--muted); font-size: 0.82rem; overflow-wrap: anywhere; }
    .row button { justify-self: start; }
    @media (max-width: 860px) {
      header { align-items: stretch; flex-direction: column; }
      .layout { grid-template-columns: 1fr; }
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Auditor Caller</h1>
        <p>Paid SAP tool caller with escrow payment, report access, and local receipt outlines.</p>
      </div>
      <div class="status">
        <b>Configuration</b>
        <span id="config">Loading...</span>
      </div>
    </header>

    <div class="layout">
      <section>
        <div class="block">
          <h2>Launch Audit</h2>
          <p class="hint">Starts a paid bounded run and records the receipt locally.</p>
          <div class="grid">
            <label>Page <input id="page" type="number" min="1" value="1"></label>
            <label>Page size <input id="page_size" type="number" min="1" value="3"></label>
            <label>Max files <input id="max_files_per_task" type="number" min="1" value="80"></label>
            <label>Audit timeout <input id="audit_timeout_seconds" type="number" min="1" value="60"></label>
            <label>Program timeout <input id="program_timeout_seconds" type="number" min="1" value="60"></label>
          </div>
          <div class="actions">
            <button id="launch">Pay & Launch</button>
            <button class="secondary" id="stats">Pay & Refresh Stats</button>
          </div>
        </div>

        <div class="block">
          <h2>Reports</h2>
          <p class="hint">Paid stats reveal report IDs owned by this caller wallet.</p>
          <div class="reports" id="reports"></div>
          <div class="actions">
            <button class="secondary" id="refresh-receipts">Refresh Receipts</button>
          </div>
        </div>

        <div class="block">
          <h2>Custom Tool Call</h2>
          <p class="hint">Arguments must be a JSON object.</p>
          <div class="grid">
            <label>Tool
              <select id="tool">
                <option>auditor_stats</option>
                <option>auditor_stop</option>
                <option>auditor_get_report</option>
                <option>auditor_launch</option>
              </select>
            </label>
            <label>Calls to cover <input id="calls" type="number" min="1" value="1"></label>
          </div>
          <label style="margin-top:14px">Arguments
            <textarea id="arguments">{}</textarea>
          </label>
          <div class="actions">
            <button class="warning" id="call-tool">Pay & Call Tool</button>
          </div>
        </div>
      </section>

      <aside class="stack">
        <div class="block">
          <h2>Output</h2>
          <p class="hint">Latest response, report content, or receipt detail.</p>
          <pre class="output" id="output">Ready.</pre>
        </div>
        <div class="block">
          <h2>Receipt Outlines</h2>
          <div class="reports" id="receipts"></div>
        </div>
      </aside>
    </div>
  </main>

  <script>
    const $ = id => document.getElementById(id);

    function show(value) {
      $("output").textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    }

    function showCallResult(data) {
      if (data?.receipt?.ok === false) {
        show({
          error: "remote_tool_call_failed",
          status_code: data.receipt.status_code,
          tool: data.receipt.tool,
          body: data.body,
          receipt: data.receipt,
        });
        return;
      }
      show(data);
    }

    async function api(path, options = {}) {
      const response = await fetch(path, {
        ...options,
        headers: { "content-type": "application/json", ...(options.headers || {}) },
      });
      const text = await response.text();
      let data;
      try { data = JSON.parse(text); } catch { data = text; }
      if (!response.ok) throw data;
      return data;
    }

    function setBusy(button, busy) {
      button.disabled = busy;
      button.dataset.originalText ||= button.textContent;
      button.textContent = busy ? "Working..." : button.dataset.originalText;
    }

    function renderReports(stats) {
      const target = $("reports");
      const reports = Array.isArray(stats?.body?.reports) ? stats.body.reports : Array.isArray(stats?.reports) ? stats.reports : [];
      if (!reports.length) {
        target.innerHTML = '<div class="row"><span class="meta">No owned reports yet.</span></div>';
        return;
      }
      target.innerHTML = "";
      for (const report of reports) {
        const row = document.createElement("div");
        row.className = "row";
        const title = document.createElement("h3");
        title.textContent = `${report.program || "Program"} / ${report.target || "Target"}`;
        const meta = document.createElement("div");
        meta.className = "meta";
        meta.textContent = report.report_id || "";
        const button = document.createElement("button");
        button.className = "secondary";
        button.textContent = "Pay & Fetch Report";
        button.onclick = () => fetchReport(report.report_id, button);
        row.append(title, meta, button);
        target.append(row);
      }
    }

    function renderReceipts(receipts) {
      const target = $("receipts");
      if (!receipts.length) {
        target.innerHTML = '<div class="row"><span class="meta">No receipts recorded yet.</span></div>';
        return;
      }
      target.innerHTML = "";
      for (const item of receipts.slice().reverse().slice(0, 12)) {
        const row = document.createElement("div");
        row.className = "row";
        const title = document.createElement("h3");
        title.textContent = `${item.tool || "tool"} · HTTP ${item.status_code}`;
        const meta = document.createElement("div");
        meta.className = "meta";
        meta.textContent = `${item.call_id || ""} · ${item.payment?.action || "payment"} · ${item.payment?.escrow_pda || ""}`;
        const button = document.createElement("button");
        button.className = "secondary";
        button.textContent = "Open Receipt";
        button.onclick = async () => show(await api(`/api/receipt?id=${encodeURIComponent(item.call_id)}`));
        row.append(title, meta, button);
        target.append(row);
      }
    }

    async function loadConfig() {
      const config = await api("/api/config");
      $("config").textContent = `${config.base_url} · ${config.network} · ${config.depositor_hint}`;
    }

    async function refreshReceipts() {
      renderReceipts(await api("/api/receipts"));
    }

    async function refreshStats(button = $("stats")) {
      setBusy(button, true);
      try {
        const data = await api("/api/stats", { method: "POST", body: "{}" });
        showCallResult(data);
        renderReports(data);
        await refreshReceipts();
      } catch (error) {
        show(error);
      } finally {
        setBusy(button, false);
      }
    }

    async function fetchReport(reportId, button) {
      setBusy(button, true);
      try {
        const data = await api("/api/report", { method: "POST", body: JSON.stringify({ report_id: reportId }) });
        show(data.body?.content || data);
        await refreshReceipts();
      } catch (error) {
        show(error);
      } finally {
        setBusy(button, false);
      }
    }

    $("launch").onclick = async event => {
      const button = event.currentTarget;
      setBusy(button, true);
      const payload = {
        page: Number($("page").value),
        page_size: Number($("page_size").value),
        max_files_per_task: Number($("max_files_per_task").value),
        audit_timeout_seconds: Number($("audit_timeout_seconds").value),
        program_timeout_seconds: Number($("program_timeout_seconds").value),
      };
      try {
        const data = await api("/api/launch", { method: "POST", body: JSON.stringify(payload) });
        showCallResult(data);
        await refreshReceipts();
      } catch (error) {
        show(error);
      } finally {
        setBusy(button, false);
      }
    };

    $("stats").onclick = event => refreshStats(event.currentTarget);
    $("refresh-receipts").onclick = refreshReceipts;

    $("call-tool").onclick = async event => {
      const button = event.currentTarget;
      setBusy(button, true);
      try {
        const args = JSON.parse($("arguments").value || "{}");
        const data = await api("/api/tool", {
          method: "POST",
          body: JSON.stringify({ tool: $("tool").value, arguments: args, calls: Number($("calls").value) }),
        });
        showCallResult(data);
        renderReports(data);
        await refreshReceipts();
      } catch (error) {
        show(error);
      } finally {
        setBusy(button, false);
      }
    };

    loadConfig().catch(show);
    refreshReceipts().catch(show);
  </script>
</body>
</html>
"""


def load_json_file(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def write_receipt(path: Path, receipt: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(receipt, ensure_ascii=True, default=str) + "\n")


def read_receipts(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    receipts = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            receipts.append(json.loads(line))
    return receipts


def parse_kv(items: list[str]) -> dict[str, Any]:
    parsed: dict[str, Any] = {}
    for item in items:
        if "=" not in item:
            raise SystemExit(f"Expected --arg values as key=value, got {item!r}.")
        key, value = item.split("=", 1)
        try:
            parsed[key] = json.loads(value)
        except json.JSONDecodeError:
            parsed[key] = value
    return parsed


def merge_arguments(json_payload: str | None, kv_args: list[str]) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    if json_payload:
        loaded = json.loads(json_payload)
        if not isinstance(loaded, dict):
            raise SystemExit("--json must be a JSON object.")
        payload.update(loaded)
    payload.update(parse_kv(kv_args))
    return payload


class CallerAgent:
    def __init__(self, args: argparse.Namespace) -> None:
        load_dotenv(ROOT / ".env")
        self.registration_path = Path(args.registration).resolve()
        self.registration = load_json_file(self.registration_path, {})
        self.receipts_path = Path(args.receipts).resolve()
        self.base_url = self.resolve_base_url(args.base_url)
        self.agent_wallet = args.agent_wallet or self.registration.get("wallet")
        self.rpc_url = args.rpc_url or os.getenv("SAP_RPC_URL") or os.getenv("SYNAPSE_RPC_URL") or self.registration.get("rpcUrl")
        self.rpc_api_key = args.rpc_api_key or os.getenv("SAP_RPC_API_KEY") or os.getenv("SYNAPSE_API_KEY")
        self.keypair_path = args.keypair or os.getenv("SAP_KEYPAIR_PATH") or os.getenv("ANCHOR_WALLET")
        self.network = args.network or os.getenv("SAP_PAYMENT_NETWORK") or "solana:mainnet-beta"
        self.price_per_call = str(args.price_per_call or os.getenv("SAP_PRICE_PER_CALL_LAMPORTS") or "1000")
        self.min_escrow_deposit = str(args.min_escrow_deposit or os.getenv("SAP_MIN_ESCROW_DEPOSIT_LAMPORTS") or "10000")
        self.session_calls = int(args.session_calls or os.getenv("SAP_CALLER_MAX_CALLS") or self.manifest_session_calls() or 20)
        self.timeout = args.timeout

        if not self.keypair_path and DEFAULT_KEYPAIR.exists():
            self.keypair_path = str(DEFAULT_KEYPAIR)

    def resolve_base_url(self, explicit: str | None) -> str:
        if explicit:
            return explicit.rstrip("/")
        env_url = os.getenv("SAP_CALLER_BASE_URL") or os.getenv("AGENT_BASE_URL")
        if env_url:
            return env_url.rstrip("/")
        return str(self.registration.get("agentBaseUrl") or "http://127.0.0.1:8000").rstrip("/")

    def require_payment_config(self) -> None:
        missing = []
        if not self.agent_wallet:
            missing.append("agent wallet (use --agent-wallet or work/sap-registration.json)")
        if not self.rpc_url:
            missing.append("RPC URL (use --rpc-url or SAP_RPC_URL)")
        if not self.keypair_path:
            missing.append("keypair (use --keypair, SAP_KEYPAIR_PATH, ANCHOR_WALLET, or .sap-keypair-mainnet.json)")
        if missing:
            raise SystemExit("Missing " + ", ".join(missing) + ".")

    def manifest_session_calls(self) -> int | None:
        try:
            pricing = self.registration.get("agent", {}).get("pricing", [])
            if pricing and pricing[0].get("maxCallsPerSession"):
                return int(pricing[0]["maxCallsPerSession"])
        except (TypeError, ValueError):
            return None
        return None

    def payment_headers(self, calls: int, force_create: bool = False) -> dict[str, Any]:
        self.require_payment_config()
        request = {
            "agentWallet": self.agent_wallet,
            "rpcUrl": self.rpc_url,
            "rpcApiKey": self.rpc_api_key,
            "keypairPath": self.keypair_path,
            "network": self.network,
            "pricePerCallLamports": self.price_per_call,
            "minEscrowDepositLamports": self.min_escrow_deposit,
            "calls": calls,
            "maxCalls": self.session_calls,
            "forceCreate": force_create,
        }
        env = os.environ.copy()
        env["SAP_CALLER_PAYMENT_REQUEST"] = json.dumps(request)
        command = ["npx", "tsx", str(PAYMENT_SCRIPT)]
        completed = subprocess.run(
            command,
            cwd=ROOT,
            env=env,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        if completed.returncode != 0:
            raise SystemExit(f"Payment preparation failed:\n{completed.stderr.strip() or completed.stdout.strip()}")
        return json.loads(completed.stdout)

    def post_tool(self, tool: str, arguments: dict[str, Any], calls: int, force_create: bool = False) -> dict[str, Any]:
        payment = self.payment_headers(calls=calls, force_create=force_create)
        headers = {str(key): str(value) for key, value in payment["headers"].items()}
        headers["content-type"] = "application/json"
        call_id = f"call_{uuid.uuid4().hex[:16]}"
        url = f"{self.base_url}/sap/tools/{tool}"
        started_at = time.time()

        status_code, response_headers, response_text = http_request(
            "POST",
            url,
            headers,
            {"arguments": arguments},
            timeout=self.timeout,
        )
        content_type = response_headers.get("content-type", "")
        body: Any = json.loads(response_text) if "application/json" in content_type else response_text

        receipt = {
            "call_id": call_id,
            "time": started_at,
            "tool": tool,
            "url": url,
            "arguments": arguments,
            "status_code": status_code,
            "ok": status_code < 400,
            "payment": {
                "action": payment.get("action"),
                "tx_signature": payment.get("txSignature"),
                "escrow_pda": payment.get("escrowPda"),
                "agent_pda": payment.get("agentPda"),
                "depositor_wallet": payment.get("depositorWallet"),
                "program_id": payment.get("programId"),
                "network": payment.get("network"),
                "price_per_call_lamports": payment.get("pricePerCallLamports"),
                "max_calls": payment.get("maxCalls"),
                "balance_after": payment.get("balanceAfter"),
            },
            "response_summary": summarize_response(body),
            "response_body": body,
        }
        write_receipt(self.receipts_path, receipt)
        return {"receipt": receipt, "body": body}

    def get(self, path: str) -> Any:
        status_code, headers, text = http_request("GET", f"{self.base_url}{path}", {}, None, timeout=self.timeout)
        if status_code >= 400:
            raise SystemExit(f"GET {path} failed with HTTP {status_code}: {text[:500]}")
        if "application/json" not in headers.get("content-type", ""):
            raise SystemExit(f"GET {path} did not return JSON: {text[:500]}")
        return json.loads(text)


def http_request(
    method: str,
    url: str,
    headers: dict[str, str],
    payload: dict[str, Any] | None,
    timeout: float,
) -> tuple[int, dict[str, str], str]:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = Request(url, data=data, headers=headers, method=method)
    try:
        with urlopen(request, timeout=timeout) as response:
            return (
                int(response.status),
                {key.lower(): value for key, value in response.headers.items()},
                response.read().decode("utf-8", errors="replace"),
            )
    except HTTPError as error:
        return (
            int(error.code),
            {key.lower(): value for key, value in error.headers.items()},
            error.read().decode("utf-8", errors="replace"),
        )


def summarize_response(body: Any) -> dict[str, Any]:
    if not isinstance(body, dict):
        return {"type": type(body).__name__, "preview": str(body)[:240]}

    summary: dict[str, Any] = {}
    for key in ("status", "run_id", "owner_wallet", "error", "current", "running", "report_id"):
        if key in body:
            summary[key] = body[key]
    if isinstance(body.get("reports"), list):
        summary["report_ids"] = [item.get("report_id") for item in body["reports"] if isinstance(item, dict)]
        summary["report_count"] = len(body["reports"])
    if "content" in body and isinstance(body["content"], str):
        summary["content_bytes"] = len(body["content"].encode("utf-8"))
    return summary


def print_json(value: Any) -> None:
    print(json.dumps(value, indent=2, ensure_ascii=True, default=str))


def print_receipt_outline(receipts: list[dict[str, Any]]) -> None:
    if not receipts:
        print("No receipts recorded yet.")
        return
    for item in receipts:
        payment = item.get("payment", {})
        summary = item.get("response_summary", {})
        bits = [
            item.get("call_id", "unknown"),
            item.get("tool", "unknown"),
            f"status={item.get('status_code')}",
            f"payment={payment.get('action')}",
            f"escrow={payment.get('escrow_pda')}",
        ]
        if summary.get("run_id"):
            bits.append(f"run={summary['run_id']}")
        if summary.get("report_ids"):
            bits.append(f"reports={','.join(summary['report_ids'])}")
        print(" | ".join(str(bit) for bit in bits if bit is not None))


def json_response(handler: BaseHTTPRequestHandler, status: int, payload: Any) -> None:
    body = json.dumps(payload, indent=2, ensure_ascii=True, default=str).encode("utf-8")
    handler.send_response(status)
    handler.send_header("content-type", "application/json")
    handler.send_header("content-length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def html_response(handler: BaseHTTPRequestHandler, body: str) -> None:
    data = body.encode("utf-8")
    handler.send_response(200)
    handler.send_header("content-type", "text/html; charset=utf-8")
    handler.send_header("content-length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


def read_request_json(handler: BaseHTTPRequestHandler) -> dict[str, Any]:
    length = int(handler.headers.get("content-length") or "0")
    if length <= 0:
        return {}
    raw = handler.rfile.read(length).decode("utf-8")
    if not raw.strip():
        return {}
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise ValueError("Request body must be a JSON object.")
    return data


def public_config(caller: CallerAgent) -> dict[str, Any]:
    keypair_hint = Path(caller.keypair_path).name if caller.keypair_path else "missing keypair"
    return {
        "base_url": caller.base_url,
        "registration": str(caller.registration_path),
        "receipts": str(caller.receipts_path),
        "agent_wallet": caller.agent_wallet,
        "network": caller.network,
        "price_per_call_lamports": caller.price_per_call,
        "min_escrow_deposit_lamports": caller.min_escrow_deposit,
        "session_calls": caller.session_calls,
        "depositor_hint": keypair_hint,
    }


def serve_home(caller: CallerAgent, host: str, port: int) -> None:
    class CallerHandler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: Any) -> None:
            print(f"{self.address_string()} - {format % args}")

        def do_GET(self) -> None:
            parsed = urlparse(self.path)
            try:
                if parsed.path == "/":
                    html_response(self, HOME_HTML)
                    return
                if parsed.path == "/api/config":
                    json_response(self, 200, public_config(caller))
                    return
                if parsed.path == "/api/receipts":
                    json_response(self, 200, read_receipts(caller.receipts_path))
                    return
                if parsed.path == "/api/receipt":
                    call_id = parse_qs(parsed.query).get("id", [""])[0]
                    receipts = read_receipts(caller.receipts_path)
                    match = next((item for item in receipts if item.get("call_id") == call_id), None)
                    json_response(self, 200 if match else 404, match or {"error": "receipt_not_found", "call_id": call_id})
                    return
                json_response(self, 404, {"error": "not_found"})
            except Exception as error:
                json_response(self, 500, {"error": str(error)})

        def do_POST(self) -> None:
            parsed = urlparse(self.path)
            try:
                payload = read_request_json(self)
                if parsed.path == "/api/launch":
                    result = caller.post_tool("auditor_launch", {
                        "page": int(payload.get("page") or 1),
                        "page_size": int(payload.get("page_size") or 3),
                        "max_files_per_task": int(payload.get("max_files_per_task") or 80),
                        "audit_timeout_seconds": int(payload.get("audit_timeout_seconds") or 60),
                        "program_timeout_seconds": int(payload.get("program_timeout_seconds") or 60),
                    }, calls=1)
                    json_response(self, 200, result)
                    return
                if parsed.path == "/api/stats":
                    json_response(self, 200, caller.post_tool("auditor_stats", {}, calls=1))
                    return
                if parsed.path == "/api/report":
                    report_id = str(payload.get("report_id") or "")
                    if not report_id:
                        json_response(self, 422, {"error": "Missing report_id"})
                        return
                    json_response(self, 200, caller.post_tool("auditor_get_report", {"report_id": report_id}, calls=1))
                    return
                if parsed.path == "/api/tool":
                    tool = str(payload.get("tool") or "")
                    arguments = payload.get("arguments") or {}
                    calls = int(payload.get("calls") or 1)
                    if not tool:
                        json_response(self, 422, {"error": "Missing tool"})
                        return
                    if not isinstance(arguments, dict):
                        json_response(self, 422, {"error": "arguments must be a JSON object"})
                        return
                    json_response(self, 200, caller.post_tool(tool, arguments, calls=calls))
                    return
                json_response(self, 404, {"error": "not_found"})
            except SystemExit as error:
                json_response(self, 500, {"error": str(error)})
            except Exception as error:
                json_response(self, 500, {"error": str(error)})

    server = ThreadingHTTPServer((host, port), CallerHandler)
    print(f"Caller agent UI listening on http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping caller agent UI.")
    finally:
        server.server_close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Paid SAP caller for the Auditor agent.")
    parser.add_argument("--base-url", help="Agent base URL. Defaults to SAP_CALLER_BASE_URL, AGENT_BASE_URL, registration, then localhost.")
    parser.add_argument("--registration", default=str(DEFAULT_REGISTRATION), help="Path to SAP registration JSON.")
    parser.add_argument("--receipts", default=str(DEFAULT_RECEIPTS), help="Path to caller receipt JSONL.")
    parser.add_argument("--keypair", help="Existing Solana keypair path for payment.")
    parser.add_argument("--rpc-url", help="Solana RPC URL.")
    parser.add_argument("--rpc-api-key", help="Optional RPC API key sent as x-api-key.")
    parser.add_argument("--agent-wallet", help="Agent owner wallet; defaults to registration wallet.")
    parser.add_argument("--network", help="X-Payment network identifier.", default=None)
    parser.add_argument("--price-per-call", help="Lamports per tool call.")
    parser.add_argument("--min-escrow-deposit", help="Minimum escrow deposit lamports.")
    parser.add_argument("--session-calls", type=int, help="Max calls to reserve when creating a new escrow.")
    parser.add_argument("--timeout", type=float, default=60.0, help="HTTP timeout in seconds.")

    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("manifest", help="Fetch SAP manifest.")
    sub.add_parser("tools", help="Fetch SAP tool manifest.")

    call = sub.add_parser("call", help="Call any paid SAP tool.")
    call.add_argument("tool")
    call.add_argument("--json", help="JSON object to send as tool arguments.")
    call.add_argument("--arg", action="append", default=[], help="Tool argument as key=value. JSON values are accepted.")
    call.add_argument("--calls", type=int, default=1, help="Calls to ensure escrow can cover.")
    call.add_argument("--force-create", action="store_true", help="Create a fresh escrow instead of reusing an existing one.")

    launch = sub.add_parser("launch", help="Launch a paid audit run.")
    launch.add_argument("--page", type=int, default=1)
    launch.add_argument("--page-size", type=int, default=3)
    launch.add_argument("--max-files-per-task", type=int, default=80)
    launch.add_argument("--audit-timeout-seconds", type=int, default=60)
    launch.add_argument("--program-timeout-seconds", type=int, default=60)

    sub.add_parser("stats", help="Read paid caller stats and owned report IDs.")

    report = sub.add_parser("report", help="Fetch an owned paid report.")
    report.add_argument("report_id")

    receipts = sub.add_parser("receipts", help="List local receipt outlines.")
    receipts.add_argument("--json", action="store_true", help="Print full JSON receipts.")

    receipt = sub.add_parser("receipt", help="Print one local receipt.")
    receipt.add_argument("call_id")

    serve = sub.add_parser("serve", help="Start the caller agent home page/UI.")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8088)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    caller = CallerAgent(args)

    if args.command == "manifest":
        print_json(caller.get("/sap/manifest"))
    elif args.command == "tools":
        print_json(caller.get("/sap/tools"))
    elif args.command == "call":
        arguments = merge_arguments(args.json, args.arg)
        result = caller.post_tool(args.tool, arguments, calls=args.calls, force_create=args.force_create)
        print_json(result)
    elif args.command == "launch":
        result = caller.post_tool("auditor_launch", {
            "page": args.page,
            "page_size": args.page_size,
            "max_files_per_task": args.max_files_per_task,
            "audit_timeout_seconds": args.audit_timeout_seconds,
            "program_timeout_seconds": args.program_timeout_seconds,
        }, calls=1)
        print_json(result)
    elif args.command == "stats":
        result = caller.post_tool("auditor_stats", {}, calls=1)
        print_json(result)
    elif args.command == "report":
        result = caller.post_tool("auditor_get_report", {"report_id": args.report_id}, calls=1)
        print_json(result)
    elif args.command == "receipts":
        receipts = read_receipts(caller.receipts_path)
        print_json(receipts) if args.json else print_receipt_outline(receipts)
    elif args.command == "receipt":
        receipts = read_receipts(caller.receipts_path)
        match = next((item for item in receipts if item.get("call_id") == args.call_id), None)
        if not match:
            raise SystemExit(f"No receipt found for {args.call_id}.")
        print_json(match)
    elif args.command == "serve":
        serve_home(caller, args.host, args.port)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
