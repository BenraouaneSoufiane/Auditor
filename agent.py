import os, re, json, time, signal, shutil, asyncio, logging, shlex
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("auditor-agent")

BBRADAR_TOKEN = os.getenv("BBRADAR_TOKEN")
CCR_CMD = os.getenv("CCR_CMD", "claude -p --setting-sources project,local")
WORKDIR = Path(os.getenv("WORKDIR", "./work")).resolve()
REPORTS = WORKDIR / "reports"
REPOS = WORKDIR / "repos"
CONTRACTS = WORKDIR / "contracts"

ETHERSCAN_API_KEY = os.getenv("ETHERSCAN_API_KEY", "")
BASESCAN_API_KEY = os.getenv("BASESCAN_API_KEY", "")
ARBISCAN_API_KEY = os.getenv("ARBISCAN_API_KEY", "")
POLYGONSCAN_API_KEY = os.getenv("POLYGONSCAN_API_KEY", "")
OPTIMISTIC_API_KEY = os.getenv("OPTIMISTIC_API_KEY", "")

app = FastAPI()

state = {
    "running": False,
    "stop": False,
    "current": None,
    "reports": [],
    "errors": [],
    "skipped": [],
    "explorer_debug": [],
    "trace": [],
    "started_at": None,
}


class LaunchRequest(BaseModel):
    page: int = 1
    page_size: int = 3
    max_files_per_task: int = 80
    audit_timeout_seconds: int = 60
    program_timeout_seconds: int = 60


def safe_name(v: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_.-]+", "_", str(v or "unknown"))[:120]


def trace(event: str, **details):
    entry = {
        "time": time.time(),
        "event": event,
        **details,
    }
    state["trace"].append(entry)
    state["trace"] = state["trace"][-1000:]
    logger.info("trace %s %s", event, details)
    try:
        WORKDIR.mkdir(exist_ok=True)
        with (WORKDIR / "audit_trace.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, default=str) + "\n")
    except Exception as e:
        logger.warning("failed to write audit trace: %s", e)
    return entry


def all_strings(obj):
    found = []

    if isinstance(obj, dict):
        for v in obj.values():
            found.extend(all_strings(v))
    elif isinstance(obj, list):
        for v in obj:
            found.extend(all_strings(v))
    elif isinstance(obj, str):
        found.append(obj)

    return found


def extract_github_url(item: dict) -> Optional[str]:
    for s in all_strings(item):
        if "github.com" in s:
            return s.strip()

    return None


def normalize_github_url(url: str) -> str:
    url = url.strip()

    if url.startswith("git@github.com:"):
        return url

    m = re.search(r"https?://github\.com/[^/\s]+/[^/\s#?]+", url)
    if not m:
        return url

    clean = m.group(0).rstrip("/")
    if not clean.endswith(".git"):
        clean += ".git"

    return clean


def extract_contract_url(item: dict) -> Optional[str]:
    for s in all_strings(item):
        s = s.strip()
        if any(host in s for host in [
            "etherscan.io/address/",
            "basescan.org/address/",
            "arbiscan.io/address/",
            "polygonscan.com/address/",
            "optimistic.etherscan.io/address/",
            "explorer.hiro.so/txid/",
        ]):
            return s

    return None


def domain_identifier(target: dict) -> str:
    return str(target.get("identifier") or target.get("normalized_identifier") or "").strip()


def is_domain_target(target: dict) -> bool:
    identifier = domain_identifier(target)
    target_type = str(target.get("target_type") or target.get("type") or "").lower()

    if not identifier:
        return False

    blocked = [
        "github.com",
        "etherscan.io/address/",
        "basescan.org/address/",
        "arbiscan.io/address/",
        "polygonscan.com/address/",
        "optimistic.etherscan.io/address/",
        "explorer.hiro.so/txid/",
    ]
    if any(value in identifier.lower() for value in blocked):
        return False

    if "domain" in target_type or "url" in target_type or "website" in target_type:
        return True

    parsed = urlparse(identifier if "://" in identifier else f"https://{identifier.lstrip('*.')}")
    host = parsed.netloc or parsed.path.split("/")[0]
    return "." in host and " " not in host


def extract_address(url: str) -> Optional[str]:
    m = re.search(r"/address/(0x[a-fA-F0-9]{40})", url)
    return m.group(1) if m else None


def scan_config(host: str):
    host = host.lower()

    if "basescan.org" in host:
        return "https://api.basescan.org/api", BASESCAN_API_KEY
    if "arbiscan.io" in host:
        return "https://api.arbiscan.io/api", ARBISCAN_API_KEY
    if "polygonscan.com" in host:
        return "https://api.polygonscan.com/api", POLYGONSCAN_API_KEY
    if "optimistic.etherscan.io" in host:
        return "https://api-optimistic.etherscan.io/api", OPTIMISTIC_API_KEY
    if "etherscan.io" in host:
        return "https://api.etherscan.io/api", ETHERSCAN_API_KEY

    return None, None


async def fetch_programs(page: int, page_size: int):
    url = "https://bbradar.io/api/v1/pro/programs"
    headers = {"Authorization": f"Bearer {BBRADAR_TOKEN}"}
    params = {"page": page, "page_size": page_size}

    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(url, headers=headers, params=params)
        r.raise_for_status()
        data = r.json()

    if isinstance(data, dict):
        return data.get("data") or data.get("programs") or data.get("items") or []
    return data


async def fetch_targets(program_id: str):
    url = f"https://bbradar.io/api/v1/pro/programs/{program_id}/targets"
    headers = {"Authorization": f"Bearer {BBRADAR_TOKEN}"}

    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(url, headers=headers)
        r.raise_for_status()
        data = r.json()

    if isinstance(data, dict):
        return data.get("data") or data.get("targets") or data.get("items") or []
    return data


async def run_cmd(cmd: str, cwd: Optional[Path] = None):
    proc = await asyncio.create_subprocess_shell(
        cmd,
        cwd=str(cwd) if cwd else None,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        preexec_fn=os.setsid,
    )

    while True:
        if state["stop"]:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
            except Exception:
                pass
            raise RuntimeError("Stopped by user")

        try:
            await asyncio.wait_for(proc.wait(), timeout=1)
            break
        except asyncio.TimeoutError:
            continue

    out, err = await proc.communicate()

    if proc.returncode != 0:
        raise RuntimeError(err.decode(errors="ignore")[:4000])

    return out.decode(errors="ignore")


async def run_llm(
    prompt: str,
    cwd: Optional[Path] = None,
    label: str = "llm",
    timeout_seconds: int = 60,
):
    cmd = shlex.split(CCR_CMD)
    if not cmd:
        raise RuntimeError("CCR_CMD is empty")

    env = os.environ.copy()
    if Path(cmd[0]).name == "claude":
        env.setdefault("ANTHROPIC_AUTH_TOKEN", "test")
        env.setdefault("ANTHROPIC_BASE_URL", "http://127.0.0.1:3456")
        env.setdefault("NO_PROXY", "127.0.0.1")
        env.setdefault("DISABLE_TELEMETRY", "true")
        env.setdefault("DISABLE_COST_WARNINGS", "true")
        env.setdefault("API_TIMEOUT_MS", "600000")
        env.pop("CLAUDE_CODE_USE_BEDROCK", None)

    trace(
        "llm_start",
        label=label,
        cmd=" ".join(cmd),
        cwd=str(cwd) if cwd else None,
        prompt_bytes=len(prompt.encode("utf-8")),
        timeout_seconds=timeout_seconds,
    )
    started = time.time()

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=str(cwd) if cwd else None,
        env=env,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        preexec_fn=os.setsid,
    )

    communicate = asyncio.create_task(proc.communicate(prompt.encode("utf-8")))

    while True:
        if state["stop"]:
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
            except Exception:
                pass
            communicate.cancel()
            raise RuntimeError("Stopped by user")

        try:
            out, err = await asyncio.wait_for(asyncio.shield(communicate), timeout=1)
            break
        except asyncio.TimeoutError:
            if time.time() - started >= timeout_seconds:
                try:
                    os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
                except Exception:
                    pass
                try:
                    await asyncio.wait_for(proc.wait(), timeout=5)
                except asyncio.TimeoutError:
                    try:
                        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                    except Exception:
                        pass
                communicate.cancel()
                trace(
                    "llm_timeout",
                    label=label,
                    elapsed_seconds=round(time.time() - started, 2),
                    timeout_seconds=timeout_seconds,
                )
                raise TimeoutError(f"LLM command timed out after {timeout_seconds} seconds: {' '.join(cmd)}")
            continue

    stdout = out.decode(errors="ignore")
    stderr = err.decode(errors="ignore")

    if proc.returncode != 0:
        details = (stderr or stdout).strip()[:4000]
        if "Service not running" in details or "ccr start" in details:
            details = f"CCR service is not running. Run `ccr start`, then launch again. Details: {details}"
        elif "--dangerously-skip-permissions" in details:
            details = f"CCR invoked Claude with a root-forbidden permissions flag. Set CCR_CMD to `claude -p` and keep CCR running. Details: {details}"
        trace(
            "llm_error",
            label=label,
            exit_code=proc.returncode,
            elapsed_seconds=round(time.time() - started, 2),
            error=details[:1000],
        )
        raise RuntimeError(f"LLM command failed ({' '.join(cmd)}) with exit code {proc.returncode}: {details}")

    final = stdout.strip()
    if not final:
        details = f"LLM command returned no stdout. stderr preview: {stderr.strip()[:1000]}"
        trace(
            "llm_error",
            label=label,
            exit_code=proc.returncode,
            elapsed_seconds=round(time.time() - started, 2),
            error=details,
        )
        raise RuntimeError(details)

    trace(
        "llm_done",
        label=label,
        exit_code=proc.returncode,
        elapsed_seconds=round(time.time() - started, 2),
        output_bytes=len(final.encode("utf-8")),
        stderr_preview=stderr.strip()[:500],
    )

    return final


def contract_source_filename(contract_name: str, index: int):
    name = (contract_name or f"contract_{index}").strip()
    if name.endswith(".sol"):
        return safe_name(name)
    return f"{safe_name(name)}.sol"


def write_contract_source(entry: dict, out_dir: Path):
    source = (entry.get("SourceCode") or "").strip()
    contract_name = entry.get("ContractName") or "contract"

    if not source:
        return 0

    out_dir.mkdir(parents=True, exist_ok=True)

    # Etherscan wraps multi-file metadata in one or two layers of braces.
    normalized = source
    if normalized.startswith("{{") and normalized.endswith("}}"):
        normalized = normalized[1:-1]

    try:
        parsed = json.loads(normalized)
    except json.JSONDecodeError:
        path = out_dir / contract_source_filename(contract_name, 1)
        path.write_text(source, encoding="utf-8")
        return 1

    sources = parsed.get("sources") if isinstance(parsed, dict) else None
    if isinstance(sources, dict) and sources:
        count = 0
        for idx, (name, meta) in enumerate(sources.items(), 1):
            content = meta.get("content") if isinstance(meta, dict) else None
            if not content:
                continue
            relative = Path(*Path(name).parts)
            if relative.is_absolute() or ".." in relative.parts:
                relative = Path(f"source_{idx}.sol")
            path = out_dir / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
            count += 1
        return count

    path = out_dir / contract_source_filename(contract_name, 1)
    path.write_text(source, encoding="utf-8")
    return 1


def repo_chunks(repo: Path, max_files: int):
    files = []
    ignore = {".git", "node_modules", "target", "dist", "build", ".next", "vendor", "__pycache__"}
    exts = {
        ".sol", ".rs", ".go", ".ts", ".tsx", ".js", ".jsx", ".py",
        ".move", ".vy", ".java", ".c", ".cpp", ".h", ".hpp", ".cs", ".php", ".clar"
    }

    for p in repo.rglob("*"):
        if p.is_file() and not any(part in ignore for part in p.parts):
            if p.suffix.lower() in exts:
                files.append(str(p.relative_to(repo)))

    for i in range(0, len(files), max_files):
        yield files[i:i + max_files]


async def download_verified_contract(contract_url: str, out_dir: Path):
    parsed = urlparse(contract_url)
    address = extract_address(contract_url)

    if not address:
        raise RuntimeError(f"Could not extract address from {contract_url}")

    api_url, api_key = scan_config(parsed.netloc)

    if not api_url:
        raise RuntimeError(f"Unsupported explorer host: {parsed.netloc}")

    params = {
        "module": "contract",
        "action": "getsourcecode",
        "address": address,
    }

    if api_key:
        params["apikey"] = api_key

    logger.info(
        "Explorer request host=%s address=%s api_key_present=%s",
        parsed.netloc,
        address,
        bool(api_key),
    )

    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.get(api_url, params=params)
    debug_dir = WORKDIR / "debug"
    debug_dir.mkdir(exist_ok=True)
    
    debug_file = debug_dir / f"{safe_name(parsed.netloc)}__{address}.json"
    debug_file.write_text(r.text, encoding="utf-8")
    
    state["explorer_debug"].append({
        "host": parsed.netloc,
        "address": address,
        "status_code": r.status_code,
        "api_key_present": bool(api_key),
        "debug_file": str(debug_file),
        "response_preview": r.text[:1000],
    })    

    logger.info("Explorer HTTP status=%s", r.status_code)

    logger.info(
        "Explorer raw response:\n%s",
        r.text[:5000]
    )

    r.raise_for_status()

    data = r.json()

    logger.info(
        "Explorer parsed response:\n%s",
        json.dumps(data, indent=2)[:10000]
    )

    result = data.get("result", [])

    if data.get("status") == "0":
        raise RuntimeError(
            f"Explorer returned status=0 message={data.get('message')} result={data.get('result')}"
        )

    if not result:
        raise RuntimeError(
            f"Explorer returned empty result for {address}"
        )

    written = 0
    for entry in result:
        if isinstance(entry, dict):
            written += write_contract_source(entry, out_dir)

    if not written:
        raise RuntimeError(
            f"Explorer response did not include verified source code for {address}"
        )

async def audit_path(item: dict, source_path: Path, report_path: Path, repo_or_target: str, max_files: int):
    partials = []
    chunks = list(repo_chunks(source_path, max_files))
    report_path.parent.mkdir(parents=True, exist_ok=True)

    trace(
        "audit_path_start",
        program=item.get("program", {}).get("name") or item.get("program_name"),
        target=item.get("target", {}).get("display_name") or item.get("target", {}).get("name"),
        source=str(source_path),
        report=str(report_path),
        chunk_count=len(chunks),
        max_files=max_files,
    )

    if not chunks:
        raise RuntimeError("No supported source files found")

    for idx, files in enumerate(chunks, 1):
        prompt = f"""
Audit this target for ONLY credible Critical and High severity bugs.

Target:
{repo_or_target}

Program:
{json.dumps(item.get("program", {}), indent=2)[:8000]}

Target metadata:
{json.dumps(item.get("target", {}), indent=2)[:8000]}

Analyze this file subset:
{chr(10).join(files)}

Focus on:
- Loss of funds
- Unauthorized asset transfer
- Access-control bypass
- Signature/auth verification bugs
- Severe accounting bugs
- Oracle/price manipulation bugs
- Upgrade/admin privilege bugs
- RCE only if this is an app/backend repo

Do not invent findings.
If weak, mark Needs Manual Review.
"""

        prompt_path = WORKDIR / f"prompt_{safe_name(report_path.stem)}_{idx}.txt"
        prompt_path.write_text(prompt, encoding="utf-8")
        trace(
            "prompt_written",
            target=repo_or_target,
            chunk=idx,
            chunk_count=len(chunks),
            prompt=str(prompt_path),
            prompt_bytes=prompt_path.stat().st_size,
            file_count=len(files),
            first_files=files[:10],
        )

        label = f"{report_path.stem}:chunk:{idx}"
        out = await run_llm(prompt, cwd=source_path, label=label)
        partial_path = REPORTS / f"{safe_name(report_path.stem)}__partial_{idx}.md"
        partial_path.write_text(out, encoding="utf-8")
        trace(
            "partial_report_written",
            target=repo_or_target,
            chunk=idx,
            partial_report=str(partial_path),
            output_bytes=partial_path.stat().st_size,
        )
        partials.append(f"\n\n# Subtask {idx}\n\n{out}")

    if len(partials) == 1:
        report_path.write_text(partials[0].strip(), encoding="utf-8")
        trace(
            "report_written",
            target=repo_or_target,
            report=str(report_path),
            report_bytes=report_path.stat().st_size,
            mode="single_chunk",
        )
        return

    final_prompt = f"""
Merge these audit notes into a final report.

Keep only credible Critical/High findings.
Deduplicate.
Mark weak findings as Needs Manual Review.
Include a summary table.

Target:
{repo_or_target}

Notes:
{''.join(partials)[:120000]}
"""

    final_prompt_path = WORKDIR / f"final_{safe_name(report_path.stem)}.txt"
    final_prompt_path.write_text(final_prompt, encoding="utf-8")
    trace(
        "final_prompt_written",
        target=repo_or_target,
        prompt=str(final_prompt_path),
        prompt_bytes=final_prompt_path.stat().st_size,
        partial_count=len(partials),
    )

    final = await run_llm(final_prompt, cwd=source_path, label=f"{report_path.stem}:final")
    report_path.write_text(final, encoding="utf-8")
    trace(
        "report_written",
        target=repo_or_target,
        report=str(report_path),
        report_bytes=report_path.stat().st_size,
        mode="merged",
    )


async def audit_target(item: dict, max_files: int, audit_timeout_seconds: int = 60):
    program = item.get("program", {})
    target = item.get("target", {})

    program_name = safe_name(program.get("name") or item.get("program_name") or "program")
    target_name = safe_name(target.get("display_name") or target.get("name") or target.get("id") or "target")
    identifier = domain_identifier(target)

    if not is_domain_target(target):
        raise RuntimeError("No domain or subdomain target found")

    report_path = REPORTS / f"{program_name}__{target_name}__domain.md"
    report_path.parent.mkdir(parents=True, exist_ok=True)

    trace(
        "target_audit_start",
        program=program.get("name") or program_name,
        target=target.get("display_name") or target_name,
        source=identifier,
        kind="domain",
        timeout_seconds=audit_timeout_seconds,
    )

    prompt = f"""
Do a QUICK bug bounty triage audit for this domain/subdomain target.
You must finish quickly. Do not perform deep analysis. Do not use tools. Keep the report under 500 words.

Target:
{identifier}

Program:
{json.dumps(program, indent=2)[:3000]}

Target metadata:
{json.dumps(target, indent=2)[:3000]}

Return exactly this structure:
# Quick Domain Audit: {identifier}

## Verdict
One of: No credible Critical/High from metadata | Needs Manual Review | Potential Critical/High hypothesis.

## Top Attack Hypotheses
At most 5 bullets. Each bullet must be one sentence and include the likely impact.

## Fast Checks
At most 5 concrete checks a human can run next.

## Notes
Only include uncertainty, scope caveats, or why no credible finding can be claimed from metadata.
"""

    prompt_path = WORKDIR / f"prompt_{safe_name(report_path.stem)}.txt"
    prompt_path.write_text(prompt, encoding="utf-8")
    trace(
        "prompt_written",
        target=identifier,
        prompt=str(prompt_path),
        prompt_bytes=prompt_path.stat().st_size,
        kind="domain",
    )

    try:
        report = await run_llm(
            prompt,
            cwd=WORKDIR,
            label=f"{report_path.stem}:domain",
            timeout_seconds=audit_timeout_seconds,
        )
    except TimeoutError:
        report = f"""# Quick Domain Audit: {identifier}

## Verdict
Needs Manual Review

## Top Attack Hypotheses
- The model call timed out before producing a triage result, so no credible Critical/High finding can be claimed from metadata alone.

## Fast Checks
- Check whether `{identifier}` resolves and identify the active application or hosting provider.
- Review authentication, password reset, invite, OAuth/SAML, and session flows if the host is live.
- Check for exposed admin panels, debug endpoints, object storage, and dangling DNS/CNAME records.
- Confirm the target is in scope before active testing.

## Notes
Generated as a timeout fallback after {audit_timeout_seconds} seconds.
"""
        trace(
            "timeout_fallback_report",
            target=identifier,
            report=str(report_path),
            timeout_seconds=audit_timeout_seconds,
        )
    report_path.write_text(report, encoding="utf-8")
    trace(
        "report_written",
        target=identifier,
        report=str(report_path),
        report_bytes=report_path.stat().st_size,
        mode="domain",
    )

    result = {
        "kind": "domain",
        "program": program.get("name") or program_name,
        "target": target.get("display_name") or target_name,
        "source": identifier,
        "report": str(report_path),
        "finished_at": time.time(),
    }
    state["reports"].append(result)
    trace("target_audit_done", **result)
    return result


async def agent_loop(req: LaunchRequest):
    state["running"] = True
    state["stop"] = False
    state["started_at"] = time.time()
    state["errors"] = []
    state["reports"] = []
    state["skipped"] = []
    state["explorer_debug"] = []
    state["trace"] = []

    trace(
        "agent_loop_start",
        page=req.page,
        page_size=req.page_size,
        max_files_per_task=req.max_files_per_task,
        audit_timeout_seconds=req.audit_timeout_seconds,
        program_timeout_seconds=req.program_timeout_seconds,
        ccr_cmd=CCR_CMD,
    )

    WORKDIR.mkdir(exist_ok=True)
    REPOS.mkdir(exist_ok=True)
    REPORTS.mkdir(exist_ok=True)

    try:
        programs = await fetch_programs(req.page, req.page_size)
        trace("programs_fetched", count=len(programs))

        for program in programs:
            if state["stop"]:
                break

            program_id = program.get("id") or program.get("program_id")
            program_name = program.get("name") or str(program_id)
            program_started = time.time()
            trace("program_start", program=program_name, program_id=program_id)

            if not program_id:
                state["errors"].append({"program": program_name, "error": "Missing program id"})
                trace("program_error", program=program_name, error="Missing program id")
                continue

            try:
                targets = await fetch_targets(program_id)
                trace("targets_fetched", program=program_name, count=len(targets))
            except Exception as e:
                state["errors"].append({"program": program_name, "error": f"Failed to fetch targets: {e}"})
                trace("program_error", program=program_name, error=f"Failed to fetch targets: {e}")
                continue

            for target in targets:
                if state["stop"]:
                    break
                if time.time() - program_started >= req.program_timeout_seconds:
                    trace(
                        "program_timeout_skip",
                        program=program_name,
                        elapsed_seconds=round(time.time() - program_started, 2),
                        timeout_seconds=req.program_timeout_seconds,
                        remaining_targets="not processed",
                    )
                    break

                target_name = target.get("display_name") or target.get("name") or target.get("id") or "unknown-target"
                state["current"] = f"{program_name} / {target_name}"

                identifier = domain_identifier(target)
                target_type = str(target.get("target_type") or target.get("type") or "")

                if not is_domain_target(target):
                    skipped = {
                        "program": program_name,
                        "target": target_name,
                        "target_type": target.get("target_type") or target.get("type"),
                        "reason": "Skipped: only domain/subdomain targets are audited",
                        "identifier": identifier[:300],
                    }
                    state["skipped"].append(skipped)
                    trace("target_skipped", **skipped)
                    continue

                trace(
                    "target_selected",
                    program=program_name,
                    target=target_name,
                    target_type=target_type,
                    identifier=identifier[:300],
                    kind="domain",
                )

                try:
                    await audit_target({
                        "program": program,
                        "target": target,
                        "program_name": program_name,
                    }, req.max_files_per_task, req.audit_timeout_seconds)
                except Exception as e:
                    error = {
                        "program": program_name,
                        "target": target_name,
                        "error": str(e),
                    }
                    state["errors"].append(error)
                    if isinstance(e, TimeoutError):
                        trace("target_timeout", **error)
                    trace("target_error", **error)

    finally:
        trace(
            "agent_loop_done",
            report_count=len(state["reports"]),
            error_count=len(state["errors"]),
            skipped_count=len(state["skipped"]),
            stopped=state["stop"],
        )
        state["running"] = False
        state["current"] = None


@app.post("/launch")
async def launch(req: LaunchRequest):
    if not BBRADAR_TOKEN:
        return {"error": "Missing BBRADAR_TOKEN env var"}

    if state["running"]:
        return {"status": "already_running", "current": state["current"]}

    asyncio.create_task(agent_loop(req))
    return {"status": "launched", "page": req.page, "page_size": req.page_size}


@app.get("/stats")
async def stats():
    return state


@app.post("/stop")
async def stop():
    state["stop"] = True
    return {"status": "stopping"}
