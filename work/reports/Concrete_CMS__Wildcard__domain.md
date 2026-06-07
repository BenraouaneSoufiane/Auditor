# Quick Domain Audit: *.concretecms.org

## Verdict
**No credible Critical/High from metadata.** The target entry itself is flagged `in_scope: false` and `eligible_for_bounty: false`, meaning this wildcard may be informational or out-of-scope. The program pays **$0 bounties** across the board (pure VDP).

## Top Attack Hypotheses

- **Subdomain takeover / dangling DNS** — the wildcard scope (`*.concretecms.org`) suggests many subdomains; any stale CNAME pointing to decommissioned S3, Heroku, or GitHub Pages could allow takeover (impact: full subdomain compromise, phishing).
- **Reflected XSS on marketing/community subdomains** — Concrete CMS is a PHP CMS with a long history of XSS; any demo, docs, or community site running an older version is likely vulnerable (impact: session hijack of admins).
- **Exposed `.git` directory or debug endpoints** — subdomains spun up for staging or events frequently leak `.git/`, `phpinfo()`, or `/server-info` (impact: source code disclosure, config leaks).
- **Unauthenticated SQL injection in legacy Concrete CMS endpoints** — the CMS has had multiple SQLi CVEs (e.g., CVE-2023-29524, CVE-2022-38525); if any subdomain runs a patched-but-misconfigured instance, edge cases may persist (impact: database extraction).
- **IDOR or broken access control on API endpoints** — Concrete CMS's REST/API layer has historically had authorization gaps in file manager and user profile routes (impact: unauthorized data access).

## Fast Checks

1. **Subdomain enumeration** — run `subfinder -d concretecms.org | httpx -sc -cl -title` to map live hosts and status codes.
2. **Version fingerprint** — check `/concrete/config/version.php` or the `<meta generator>` tag on each subdomain to find outdated installs.
3. **Dangling CNAME audit** — resolve all subdomains and compare CNAME targets against known takeover-vulnerable services (bug bounty cheat sheets list ~40).
4. **Quick Nuclei scan** — `nuclei -l live_hosts.txt -t cves/ -t exposures/ -t takeovers/` for low-hanging CVEs, exposed files, and takeover signatures.
5. **Scope confirmation** — re-read the HackerOne policy at `hackerone.com/concretecms` to confirm which subdomains are actually in scope; this metadata entry shows `in_scope: false`.

## Notes

- **The wildcard is marked out-of-scope** (`in_scope: false`, `eligible_for_bounty: false`). Before investing effort, re-verify the live policy — this may be a stale or informational entry.
- **132 reports in 90 days** suggests heavy researcher traffic; low-hanging fruit is likely already picked. Focus on less-explored subdomains or logic bugs rather than known CVEs.
- **No bounties are paid** (`bounty_min/max: 0`). This is a reputation-only program — factor that into effort allocation.
- Only **1 of 4 targets** is marked in-scope; the real attack surface may be narrower than the wildcard implies.