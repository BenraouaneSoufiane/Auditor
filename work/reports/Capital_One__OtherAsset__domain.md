# Quick Domain Audit: *.capitalone.ca

## Verdict
Needs Manual Review — wildcard scope on a major financial institution's Canadian domain with a "critical" CVSS metadata tag warrants active reconnaissance despite no confirmed vulnerability from metadata alone.

## Top Attack Hypotheses

1. **Subdomain takeover via dangling DNS records** — wildcard scope (`*.capitalone.ca`) suggests many subdomains, some likely pointing to decommissioned cloud resources (S3 buckets, Azure/AWS CNAMEs), enabling full subdomain hijack and phishing against Capital One customers.

2. **Unauthenticated API endpoints on Canadian-specific services** — financial institutions often expose distinct APIs per region; forgotten or less-audited Canadian endpoints may leak customer PII or account data without proper auth.

3. **CORS misconfiguration on auth-sensitive subdomains** — a wildcard origin with `Access-Control-Allow-Origin: *` or reflecting arbitrary `Origin` headers on login/session endpoints could allow credential theft from attacker-controlled pages.

4. **TLS/SSL misconfigurations on secondary subdomains** — lower-priority subdomains under the wildcard frequently run outdated cipher suites, expired certs, or support legacy protocols, enabling MITM attacks on customer traffic.

5. **Forgotten staging/dev subdomains exposed to the internet** — dev, staging, or test environments under `*.capitalone.ca` may lack authentication, exposing internal tools, admin panels, or debug endpoints with elevated access.

## Fast Checks

1. **Subdomain enumeration** — run `subfinder -d capitalone.ca`, `amass enum -d capitalone.ca`, and DNS brute-force; canonicalize results to find all live hosts.
2. **Dangling CNAME detection** — for each resolved subdomain, check CNAME records pointing to cloud providers (`*.amazonaws.com`, `*.azurewebsites.net`, etc.) and attempt takeover.
3. **HTTP header audit** — curl each live host for missing security headers (`Strict-Transport-Security`, `X-Frame-Options`) and permissive CORS policies (`Access-Control-Allow-Origin: *` with credentials).
4. **Port/service scan** — `nmap -sV` top 1000 ports on discovered subdomains to identify exposed admin panels, databases, or debug services.
5. **Certificate transparency log review** — query `crt.sh/?q=%.capitalone.ca` for historically issued certs revealing subdomains that may no longer be actively maintained.

## Notes

- **No bounty eligibility:** this target is marked `eligible_for_bounty: false`, so findings may only qualify for acknowledgment/points — confirm current policy before investing significant effort.
- **CVSS "critical" tag in metadata** is a program-assigned severity hint, not a confirmed finding; it signals the asset owner considers this a high-value target.
- **Scope confidence:** the wildcard `*.capitalone.ca` is confirmed in scope as of 2026-05-07; verify no subdomain-specific exclusions exist in the full policy before testing.
- **26 reports in 90 days** suggests moderate researcher attention — the most obvious issues may already be reported; focus on deeper subdomains and less common misconfigs.
- **No active probing was performed** for this audit; all hypotheses are derived from metadata analysis and general knowledge of financial institution attack surfaces.