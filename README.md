# Auditor

![Language](https://img.shields.io/badge/Python-99.8%25-blue)
![License](https://img.shields.io/badge/License-MIT-green)

## Overview

**Auditor** is a sophisticated autonomous agent that:

- 🔍 **Fetches** the latest bug bounty programs from [Bug Bounty Radar](https://bbradar.io)
- 🎯 **Identifies** domain and smart contract targets within those programs
- 🛡️ **Audits** targets for **Critical** and **High** severity vulnerabilities
- 📊 **Generates** detailed security reports with findings and remediation guidance
- 🔗 **Integrates** with [OOBE-PROTOCOL](https://explorer.oobeprotocol.ai/) for decentralized execution

The agent uses **Claude AI** (via CCR - Claude Command Runner) to perform intelligent code analysis and domain-level threat assessment, delivering quick triage reports or deep-dive audits depending on target type.

## Features

### Core Capabilities

- **Multi-target Auditing**: Process multiple bounty programs and targets in a single run
- **Smart Target Detection**: Automatically identifies domain/subdomain targets vs. code repositories vs. smart contracts
- **Chunked Analysis**: For large codebases, automatically splits files into manageable chunks and merges findings
- **Verified Contract Extraction**: Fetches verified smart contract source code from Etherscan, Basescan, Arbiscan, Polygonscan, and Optimism explorers
- **Timeout Fallback Reporting**: Generates fallback reports when analysis takes too long, ensuring no data loss
- **Real-time Dashboard**: Web UI to monitor agent status, launch runs, and view live activity logs
- **SAP Integration**: Synapse Agent Protocol support for decentralized payment and execution

### Security Analysis Focus

The agent looks for:

- **Loss of funds** vulnerabilities
- **Unauthorized asset transfer** bugs
- **Access-control bypass** flaws
- **Signature/auth verification** issues
- **Severe accounting bugs**
- **Oracle/price manipulation** exploits
- **Upgrade/admin privilege** vulnerabilities
- **RCE** (for application/backend targets)

## Installation

### Prerequisites

- **Python 3.10+**
- **Claude CLI** (CCR - Claude Command Runner) running locally or via Anthropic
- **Node.js 18+** (for SAP registration)
- **PM2** (optional, for production process management)
- API keys for blockchain explorers (optional but recommended):
  - Etherscan API key
  - Basescan API key
  - Arbiscan API key
  - Polygonscan API key
  - Optimism Etherscan API key

### Setup

```bash
# Clone the repository
git clone https://github.com/BenraouaneSoufiane/Auditor.git
cd Auditor

# Create a Python virtual environment
python3 -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Create .env file with required configuration
cat > .env << 'EOF'
# Bug Bounty Radar API token (required)
BBRADAR_TOKEN=your_bbradar_api_token

# Claude Command Runner command
CCR_CMD="claude -p --setting-sources project,local"

# Blockchain explorer API keys (optional)
ETHERSCAN_API_KEY=your_etherscan_key
BASESCAN_API_KEY=your_basescan_key
ARBISCAN_API_KEY=your_arbiscan_key
POLYGONSCAN_API_KEY=your_polygonscan_key
OPTIMISTIC_API_KEY=your_optimism_key

# Optional configuration
WORKDIR=./work
LOG_LEVEL=INFO
AGENT_BASE_URL=http://127.0.0.1:8000

# SAP (Synapse Agent Protocol) payment settings
SAP_REQUIRE_PAYMENT=false
SAP_PAYMENT_VERIFY_URL=http://127.0.0.1:8787/verify
SAP_PRICE_PER_CALL_LAMPORTS=50000000
SAP_MIN_ESCROW_DEPOSIT_LAMPORTS=10000
EOF
```

### Dependencies

Install Python dependencies:

```bash
pip install fastapi httpx python-dotenv pydantic uvicorn
```

For SAP registration (optional):

```bash
npm install
# or
yarn install
```

Install PM2 globally if you want the production commands below:

```bash
npm install -g pm2
```

## Usage

### Running the Agent

Start the FastAPI server with Uvicorn:

```bash
source .venv/bin/activate
uvicorn agent:app --host 127.0.0.1 --port 8000
```

The agent will be available at `http://127.0.0.1:8000`.

### Running with PM2

PM2 can keep the FastAPI agent and the SAP payment verifier running in the background.

Start the agent:

```bash
cd /root/auditor

BBRADAR_TOKEN="your_bbradar_api_token" \
CCR_CMD="claude -p --setting-sources project,local" \
AGENT_BASE_URL="https://audits.click" \
SAP_REQUIRE_PAYMENT=true \
SAP_PAYMENT_VERIFY_URL="http://127.0.0.1:8787/verify" \
SAP_PRICE_PER_CALL_LAMPORTS=50000000 \
SAP_MIN_ESCROW_DEPOSIT_LAMPORTS=10000 \
pm2 start .venv/bin/uvicorn --name auditor-agent --interpreter none -- agent:app --host 127.0.0.1 --port 8000
```

`--interpreter none` is required so PM2 executes the Uvicorn binary directly instead of trying to run it with Node.js.

If your public domain terminates TLS through nginx/Caddy, proxy `https://audits.click` to `127.0.0.1:8000`.

Check and manage the process:

```bash
pm2 status
pm2 logs auditor-agent
pm2 restart auditor-agent --update-env
```

Persist PM2 after reboot:

```bash
pm2 save
pm2 startup
```

#### Web Dashboard

Open your browser and navigate to:

```
http://127.0.0.1:8000
```

The interactive dashboard allows you to:

- **View agent status** (Running/Idle)
- **Monitor metrics** (Reports generated, Errors, Skipped targets)
- **Launch audit runs** with custom parameters:
  - **Page**: Which page of bounty programs to fetch (default: 1)
  - **Page Size**: Number of programs per page (default: 3)
  - **Max Files**: Maximum files per code analysis chunk (default: 80)
  - **Audit Timeout**: Seconds per audit task (default: 60)
  - **Program Timeout**: Seconds per program (default: 60)
- **View activity logs** showing recent reports, errors, and skipped targets
- **Stop running audits** at any time

### API Endpoints

#### REST API

- **`GET /`** - Web dashboard
- **`POST /launch`** - Start an audit run
- **`GET /stats`** - Get current run statistics and reports
- **`POST /stop`** - Stop the running audit

#### Synapse Agent Protocol (SAP)

- **`GET /sap/agent`** - Agent profile and capabilities
- **`GET /sap/tools`** - Registered SAP tools
- **`GET /sap/manifest`** - Complete SAP manifest
- **`POST /sap/tools/{tool_name}`** - Execute SAP tool (with x402 payment support)

**SAP Tools:**

1. **`auditor_launch`** - Launch a bounded audit run with custom parameters
2. **`auditor_stats`** - Read the paid caller's current run state and report IDs
3. **`auditor_stop`** - Request the current audit loop to stop
4. **`auditor_get_report`** - Retrieve a generated report owned by the paid caller

### Example: Launch via API

```bash
curl -X POST http://127.0.0.1:8000/launch \
  -H "Content-Type: application/json" \
  -d '{
    "page": 1,
    "page_size": 5,
    "max_files_per_task": 100,
    "audit_timeout_seconds": 120,
    "program_timeout_seconds": 300
  }'
```

### Example: Get Statistics

```bash
curl http://127.0.0.1:8000/stats | jq .
```

### Paid Caller Agent

This repo also includes a standalone Python caller app that pays with the existing Solana keypair, calls the SAP tools, and records local receipt outlines.

Defaults are read from `.env`, `work/sap-registration.json`, and `.sap-keypair-mainnet.json` when present:

```bash
source .venv/bin/activate
python3 caller_agent.py tools
python3 caller_agent.py serve --host 127.0.0.1 --port 8088
python3 caller_agent.py stats
python3 caller_agent.py report report_<id>
python3 caller_agent.py receipts
```

The home page is available at `http://127.0.0.1:8088` and provides automatic paid launch/status/stop, paid report retrieval, custom tool calls, and local receipt browsing. Launch parameters and automation timing are read from `.env`, not printed on the UI:

```bash
SAP_CALLER_AUTO_RUN=true
SAP_CALLER_RUN_DURATION_SECONDS=30m
SAP_CALLER_STATS_INTERVAL_SECONDS=2m
SAP_CALLER_FRESH_ESCROW_PER_CALL=true
SAP_CALLER_AUTO_FETCH_REPORTS=true

SAP_CALLER_LAUNCH_PAGE=1
SAP_CALLER_LAUNCH_PAGE_SIZE=3
SAP_CALLER_LAUNCH_MAX_FILES_PER_TASK=80
SAP_CALLER_LAUNCH_AUDIT_TIMEOUT_SECONDS=60
SAP_CALLER_LAUNCH_PROGRAM_TIMEOUT_SECONDS=60
```

When `serve` starts and `SAP_CALLER_RUN_DURATION_SECONDS` is set, the caller automatically pays for `auditor_launch`, pays for `auditor_stats` at the configured interval, pays once to fetch each new unique report by program/target, then pays for `auditor_stop` when the duration elapses. `SAP_CALLER_FRESH_ESCROW_PER_CALL=true` creates a fresh escrow nonce for each call, so each launch, stats poll, report fetch, stop, or custom tool call submits a new on-chain transaction instead of reusing a prior payment transaction.

Caller `.env` reference:

| Variable | Purpose |
|----------|---------|
| `SAP_CALLER_AUTO_RUN` | Starts the automatic caller loop when `caller_agent.py serve` starts. |
| `SAP_CALLER_RUN_DURATION_SECONDS` | Total run duration before the caller pays for `auditor_stop`; accepts values like `600`, `10m`, or `1h`. |
| `SAP_CALLER_STATS_INTERVAL_SECONDS` | How often the caller pays for `auditor_stats`; accepts values like `120` or `2m`. |
| `SAP_CALLER_FRESH_ESCROW_PER_CALL` | Creates a new escrow nonce per paid call so each action submits a new on-chain transaction. |
| `SAP_CALLER_AUTO_FETCH_REPORTS` | After each stats call, pays once to fetch each new unique report by program/target. |
| `SAP_CALLER_LAUNCH_PAGE` | Page passed to `auditor_launch`. |
| `SAP_CALLER_LAUNCH_PAGE_SIZE` | Page size passed to `auditor_launch`. |
| `SAP_CALLER_LAUNCH_MAX_FILES_PER_TASK` | Max files per audit task passed to `auditor_launch`. |
| `SAP_CALLER_LAUNCH_AUDIT_TIMEOUT_SECONDS` | Per-audit timeout passed to `auditor_launch`. |
| `SAP_CALLER_LAUNCH_PROGRAM_TIMEOUT_SECONDS` | Per-program timeout passed to `auditor_launch`. |

To point at a local agent instead of the registered public URL:

```bash
python3 caller_agent.py --base-url http://127.0.0.1:8000 serve
```

For arbitrary paid SAP tool calls:

```bash
python3 caller_agent.py call auditor_get_report --arg report_id=report_<id>
```

The caller delegates payment/header construction to `scripts/sap-caller-payment.ts`. With the default `SAP_CALLER_FRESH_ESCROW_PER_CALL=true`, receipts are appended to `work/caller_receipts.jsonl` for each fresh paid call and include the call ID, tool, HTTP status, escrow PDA, escrow nonce, depositor wallet, payment transaction signature, and returned report IDs when available.

To clear local caller/audit output and start fresh while keeping `.env`, keypairs, registration, and source code intact:

```bash
rm -f work/caller_receipts.jsonl
rm -f work/audit_trace.jsonl
rm -f work/report_access.json
rm -rf work/reports/*
rm -rf work/repos/*
rm -rf work/contracts/*
rm -rf work/debug/*
rm -f work/prompt_*.txt
```

This only clears local history and generated artifacts. It does not undo any on-chain escrow accounts, transactions, or payments.

## Architecture

### Core Components

```
agent.py
├── FastAPI Application
│   ├── Web Dashboard (HTML/CSS/JS)
│   ├── REST API Endpoints
│   └── SAP Protocol Endpoints
├── Agent Loop (agent_loop)
│   ├── Program Fetching (bbradar.io)
│   ├── Target Filtering
│   ├── Audit Dispatch
│   └── Report Generation
├── Audit Functions
│   ├── Domain Audit (audit_target)
│   ├── Code Repository Audit (audit_path)
│   └── Smart Contract Analysis (download_verified_contract)
└── Support Functions
    ├── LLM Integration (run_llm)
    ├── Command Execution (run_cmd)
    ├── Repository Chunking (repo_chunks)
    └── Tracing & Logging (trace)
```

### Data Flow

```
Bug Bounty Radar API
        ↓
   Programs List
        ↓
   For Each Program
        ↓
   Fetch Targets
        ↓
   Filter Domain/Contract Targets
        ↓
   Audit Target (Claude AI)
        ↓
   Generate Report
        ↓
   Save to Disk & State
```

### Output Structure

Reports are saved to:

- **Domain audits**: `work/reports/{program}__{target}__domain.md`
- **Code audits**: `work/reports/{program}__{target}__code.md`
- **Trace logs**: `work/audit_trace.jsonl` (structured events)
- **Debug data**: `work/debug/` (explorer responses, prompts)

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BBRADAR_TOKEN` | Required | Bug Bounty Radar API token |
| `CCR_CMD` | `claude -p --setting-sources project,local` | Claude command runner |
| `WORKDIR` | `./work` | Working directory for reports & temp files |
| `LOG_LEVEL` | `INFO` | Logging level (DEBUG, INFO, WARNING, ERROR) |
| `AGENT_BASE_URL` | `http://127.0.0.1:8000` | Base URL for SAP endpoints |
| `ETHERSCAN_API_KEY` | Empty | Etherscan explorer API key |
| `BASESCAN_API_KEY` | Empty | Basescan explorer API key |
| `ARBISCAN_API_KEY` | Empty | Arbiscan explorer API key |
| `POLYGONSCAN_API_KEY` | Empty | Polygonscan explorer API key |
| `OPTIMISTIC_API_KEY` | Empty | Optimism explorer API key |
| `SAP_REQUIRE_PAYMENT` | `true` | Require x402 payment for SAP tools |
| `SAP_PAYMENT_VERIFY_URL` | Empty | URL to verify x402 payment receipts |
| `SAP_PAYMENT_ALLOW_UNVERIFIED_RECEIPTS` | `false` | Allow unverified payment receipts |
| `SAP_PRICE_PER_CALL_LAMPORTS` | `50000000` | Price per SAP tool call (Lamports; 0.05 SOL) |
| `SAP_MIN_ESCROW_DEPOSIT_LAMPORTS` | `10000` | Minimum escrow deposit (Lamports) |

## Payment (x402 Protocol)

The agent supports **Solana-based payment** via the **x402 protocol** for decentralized execution:

- **Settlement**: Escrow-based
- **Network**: Solana Mainnet Beta
- **Currency**: SOL (Lamports)
- **Price Per Call**: Configurable (default: 50000000 Lamports / 0.05 SOL)
- **Min Escrow**: Configurable (default: 10000 Lamports)

To disable payment requirements, set:

```bash
SAP_REQUIRE_PAYMENT=false
```

### SAP Payment Verifier

The verifier is a local HTTP service that validates SAP-x402 escrow headers using the Synapse SAP SDK. The FastAPI agent calls it through `SAP_PAYMENT_VERIFY_URL` before executing any SAP tool.

Start it with PM2:

```bash
cd /root/auditor

SAP_RPC_URL="https://api.mainnet-beta.solana.com" \
SAP_AGENT_PDA="5qPThoENH14iJD3MpJfU4w8pAeHJ5wAzWcdWXm6SY5Y7" \
SAP_AGENT_KEYPAIR_PATH="/root/auditor/.sap-agent-keypair-mainnet.json" \
SAP_PRICE_PER_CALL_LAMPORTS=50000000 \
SAP_PAYMENT_VERIFIER_PORT=8787 \
pm2 start npm --name sap-payment-verifier -- run sap:verify-payment
```

Health check:

```bash
curl http://127.0.0.1:8787/health
pm2 logs sap-payment-verifier
```

Configure the agent to use it:

```bash
SAP_REQUIRE_PAYMENT=true
SAP_PAYMENT_VERIFY_URL="http://127.0.0.1:8787/verify"
# Optional; defaults to the same base URL with /settle.
SAP_PAYMENT_SETTLE_URL="http://127.0.0.1:8787/settle"
```

The verifier exposes `/verify` for read-only escrow validation and `/settle` for the signed on-chain `settleCallsV2` transaction. Set `SAP_AGENT_KEYPAIR_PATH`, `SAP_SETTLEMENT_KEYPAIR_PATH`, or `ANCHOR_WALLET` for settlement signing. For local verification-only testing, set `SAP_SETTLEMENT_REQUIRED=false`.

SAP-x402 callers must include these headers when calling `/sap/tools/{tool_name}`:

```http
X-Payment-Protocol: SAP-x402
X-Payment-Escrow: <escrow_pda>
X-Payment-Agent: 5qPThoENH14iJD3MpJfU4w8pAeHJ5wAzWcdWXm6SY5Y7
X-Payment-Depositor: <caller_wallet>
X-Payment-Escrow-Nonce: <escrow_nonce>
X-Payment-MaxCalls: <funded_call_allowance>
X-Payment-PricePerCall: 50000000
X-Payment-Program: SAPpUhsWLJG1FfkGRcXagEDMrMsWGjbky7AyhGpFETZ
X-Payment-Network: solana:mainnet-beta
```

For local testing only, you can bypass real verification:

```bash
SAP_PAYMENT_ALLOW_UNVERIFIED_RECEIPTS=true
```

Do not use unverified receipts in production.

### Paid Report Access

SAP payment gates each tool call. Reports are scoped to the payer wallet from `X-Payment-Depositor`:

1. Call `auditor_launch` with valid SAP-x402 headers.
2. Poll `auditor_stats` with valid SAP-x402 headers from the same depositor wallet.
3. Read `reports[*].report_id` from the stats response.
4. Call `auditor_get_report` with the same depositor wallet and the `report_id`.

Example:

```bash
curl -X POST https://audits.click/sap/tools/auditor_get_report \
  -H "Content-Type: application/json" \
  -H "X-Payment-Protocol: SAP-x402" \
  -H "X-Payment-Escrow: <escrow_pda>" \
  -H "X-Payment-Agent: 5qPThoENH14iJD3MpJfU4w8pAeHJ5wAzWcdWXm6SY5Y7" \
  -H "X-Payment-Depositor: <caller_wallet>" \
  -H "X-Payment-MaxCalls: <funded_call_allowance>" \
  -H "X-Payment-PricePerCall: 50000000" \
  -H "X-Payment-Program: SAPpUhsWLJG1FfkGRcXagEDMrMsWGjbky7AyhGpFETZ" \
  -H "X-Payment-Network: solana:mainnet-beta" \
  -d '{"arguments":{"report_id":"report_..."}}'
```

The public `/stats` endpoint remains a dashboard/debug endpoint. Paid SAP callers should use `/sap/tools/auditor_stats` and `/sap/tools/auditor_get_report`.

Paid report ownership is persisted in `work/report_access.json` so completed report access survives agent restarts.

## SAP Registration

The repository includes TypeScript helpers for Synapse Agent Protocol registration.

### Wallet

Generate or provide a Solana keypair and fund it with enough SOL for account rent and transaction fees:

```bash
export SAP_KEYPAIR_PATH="/root/auditor/.sap-keypair-mainnet.json"
```

Print the wallet address:

```bash
node -e "const {Keypair}=require('@solana/web3.js');const fs=require('fs');const kp=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.SAP_KEYPAIR_PATH,'utf8'))));console.log(kp.publicKey.toBase58())"
```

### Register Agent and Tools

Use a standard Solana mainnet RPC for registration:

```bash
export SAP_KEYPAIR_PATH="/root/auditor/.sap-keypair-mainnet.json"
export SAP_RPC_URL="https://api.mainnet-beta.solana.com"
export AGENT_BASE_URL="https://audits.click"
unset SAP_INSCRIBE_SCHEMAS

npm run sap:register
```

The registration script writes a summary to:

```bash
work/sap-registration.json
```

To update pricing for an already-registered agent, opt in to the update transaction:

```bash
SAP_UPDATE_AGENT=true npm run sap:register
```

Current mainnet addresses from the completed registration:

| Item | Address |
|------|---------|
| Wallet | `6ZTMVhTK5i1dphmrdCHMgbtKhy9roPSsoesPEt9oPXRA` |
| Agent PDA | `5qPThoENH14iJD3MpJfU4w8pAeHJ5wAzWcdWXm6SY5Y7` |
| Agent Stats PDA | `FMLQkvTu29gikNYDybKcT4Qz2oeASnQckj15qfyunM5B` |
| `auditor_launch` tool | `FJQiKzXxHB3Px9kioeitfvNPQYuZq1GFxhH99c2i2HAi` |
| `auditor_stats` tool | `Fkj5GaRbzv9a6vTFRCPHz7pw8yz6QmohkbsgjpZNrSjZ` |
| `auditor_stop` tool | `GtR3j1P3sHf4rojJRa4gm61SYpbnZujq1pW3PnxT4NWm` |

After adding new tools, rerun `npm run sap:register`. Existing tools are skipped; only missing tools are published.

### RPC Diagnostics

Check whether an RPC endpoint supports the methods needed by SAP registration:

```bash
export SAP_RPC_URL="https://api.mainnet-beta.solana.com"
npm run sap:check-rpc
```

The OOBE staging endpoint may serve some methods but not all standard Solana JSON-RPC methods. If it fails on `getAccountInfo` or `sendTransaction`, use a standard Solana mainnet RPC provider for registration.

## Integration with OOBE-PROTOCOL

The Auditor agent is registered with **OOBE-PROTOCOL** for:

- **Decentralized discovery** via the OOBE explorer
- **Trustless payment settlement** using x402
- **Composable agent interactions** with other OOBE services

Access the agent at:

🔗 **[OOBE-PROTOCOL Explorer](https://explorer.oobeprotocol.ai/)**

## Troubleshooting

### Claude Command Runner Issues

**Error**: `CCR service is not running`

```bash
# Start CCR service
ccr start
# or
claude-code-runner start
```

**Error**: `--dangerously-skip-permissions`

Set `CCR_CMD="claude -p"` (without root-forbidden flags).

### Missing API Keys

- **Etherscan**: Optional, but required for verified contract extraction
- **BBRADAR_TOKEN**: Required for program fetching
- **Claude**: Configure via `ANTHROPIC_AUTH_TOKEN` or run Claude locally

### Timeout Issues

Increase timeout values:

```bash
curl -X POST http://127.0.0.1:8000/launch \
  -H "Content-Type: application/json" \
  -d '{
    "audit_timeout_seconds": 180,
    "program_timeout_seconds": 600
  }'
```

### Viewing Detailed Logs

Check the trace file for detailed events:

```bash
cat work/audit_trace.jsonl | jq .
```

## Performance Considerations

- **Chunking**: Large repositories are split into ~80 files per chunk for faster analysis
- **Parallelization**: Currently sequential; targets are processed one at a time
- **Timeouts**: Each audit has a configurable timeout (default 60s) to prevent hanging
- **Memory**: Reports and state are kept in memory; consider cleanup for long runs

## Security Notes

⚠️ **Important**:

1. **API Keys**: Store in `.env` (gitignored) or environment variables, never in code
2. **BBRADAR_TOKEN**: Treat as sensitive; do not commit to repository
3. **SAP Payment**: Verify payment receipts against `SAP_PAYMENT_VERIFY_URL` in production
4. **Local Execution**: Running locally limits to single machine; consider containerization for scale

## Project Structure

```
Auditor/
├── agent.py                  # Main FastAPI application & agent logic
├── package.json              # Node.js dependencies (SAP registration)
├── tsconfig.json             # TypeScript configuration
├── .env                       # Configuration (gitignored)
├── .gitignore                # Git ignore rules
├── README.md                 # This file
├── work/                      # Working directory (generated)
│   ├── reports/              # Generated audit reports
│   ├── repos/                # Cloned repositories
│   ├── contracts/            # Downloaded contract sources
│   ├── debug/                # Debug output (explorer responses)
│   └── audit_trace.jsonl     # Structured event log
└── scripts/                  # Utility scripts (SAP registration, etc.)
```

## Contributing

Contributions are welcome! Areas for enhancement:

- [ ] Parallel target processing
- [ ] Additional blockchain explorer support
- [ ] Custom audit templates
- [ ] Database integration for report storage
- [ ] Advanced filtering and deduplication
- [ ] Web UI improvements

## License

This project is open source. Check the repository for license details.

## Support

- 🔗 **OOBE-PROTOCOL**: [explorer.oobeprotocol.ai](https://explorer.oobeprotocol.ai/)
- 📧 **Issues**: GitHub Issues
- 📚 **Documentation**: See inline code comments

---

**Built for bug bounty hunters and security researchers.**
