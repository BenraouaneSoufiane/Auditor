# Quick Domain Audit: firststerling.com

## Verdict
Potential Critical/High hypothesis — metadata flags a **critical CVSS score**, and the domain appears to be a legacy/acquired asset under the Regions Financial program, which often means weaker security posture.

## Top Attack Hypotheses

- **Subdomain takeover or stale DNS** — "firststerling" does not obviously brand-match "Regions Financial," suggesting an acquired or legacy entity; dangling CNAMEs or expired third-party services are common on such assets, potentially leading to full domain hijack (Critical).
- **Unauthenticated sensitive data exposure** — the critical CVSS tag hints the program already knows or suspects high-severity data exposure (e.g., customer PII, financial records), meaning an API or portal on this domain may lack proper auth controls (Critical/High).
- **Broken access control on legacy web app** — acquired domains often run outdated applications with IDOR or privilege escalation flaws, allowing unauthorized access to internal functions or customer data (High).
- **TLS or header misconfiguration** — legacy financial domains frequently lack HSTS, have weak cipher suites, or miss security headers, enabling downgrade or cookie-hijack scenarios (Medium/High).
- **Phishing/unverified sender infrastructure** — if SPF/DKIM/DMARC are misconfigured on a financial domain, spoofed emails could target Regions customers (Medium).

## Fast Checks

1. **`dig firststerling.com ANY` + `subfinder` / `crt.sh`** — enumerate all subdomains and check for dangling CNAME records pointing to decommissioned SaaS providers.
2. **`nmap -sV -p- firststerling.com`** — identify open ports, running services, and software versions to spot known CVEs.
3. **`curl -sI https://firststerling.com`** — inspect response headers for missing security controls (HSTS, CSP, X-Frame-Options) and server/version disclosure.
4. **Check SPF/DKIM/DMARC** — `dig TXT firststerling.com` and `dig _dmarc.firststerling.com TXT` to find email spoofing gaps.
5. **Wayback Machine / `waybackurls`** — pull historical URLs to discover forgotten endpoints, admin panels, or API routes no longer linked from the live site.

## Notes

- **No bounty** — this target is marked `eligible_for_bounty: false`; submissions will receive acknowledgment only, which may reduce researcher competition.
- **Critical CVSS tag is metadata, not a confirmed vulnerability** — it may reflect the asset's *potential* impact (financial data) rather than a known flaw. Corroborate with live testing before claiming a finding.
- **Domain–brand mismatch** — firststerling.com likely belongs to an acquired entity (e.g., First Sterling Securities or similar); such assets typically receive less security investment than primary brands, making them higher-value targets.
- **Scope is the exact domain only** — no wildcard, so subdomains of firststerling.com may or may not be in scope; check the program policy before testing subdomain findings.
- **No live testing was performed** — all hypotheses are derived from metadata signals; manual validation is required.