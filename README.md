# Auditor

> An autonomous bug bounty triage agent that discovers and audits the latest bounty programs. Available exclusively through **OOBE-PROTOCOL**.

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
SAP_PRICE_PER_CALL_LAMPORTS=1000
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

## Usage

### Running the Agent

Start the FastAPI server:

```bash
python agent.py
```

The agent will be available at `http://127.0.0.1:8000`.

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
2. **`auditor_stats`** - Read current run state, reports, errors, and trace data
3. **`auditor_stop`** - Request the current audit loop to stop

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
| `SAP_PRICE_PER_CALL_LAMPORTS` | `1000` | Price per SAP tool call (Lamports) |
| `SAP_MIN_ESCROW_DEPOSIT_LAMPORTS` | `10000` | Minimum escrow deposit (Lamports) |

## Payment (x402 Protocol)

The agent supports **Solana-based payment** via the **x402 protocol** for decentralized execution:

- **Settlement**: Escrow-based
- **Network**: Solana Mainnet Beta
- **Currency**: SOL (Lamports)
- **Price Per Call**: Configurable (default: 1000 Lamports)
- **Min Escrow**: Configurable (default: 10000 Lamports)

To disable payment requirements, set:

```bash
SAP_REQUIRE_PAYMENT=false
```

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
