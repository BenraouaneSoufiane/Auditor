# Quick Domain Audit: *.anduril.com.au

## Verdict
Potential Critical/High hypothesis — wildcard scope on a defense contractor's Australian infrastructure with high bounty ceiling ($7,500) and critical CVSS classification warrants immediate manual reconnaissance.

## Top Attack Hypotheses

- **Subdomain takeover via dangling DNS records** — the wildcard scope covers all subdomains; stale CNAME pointers to decommissioned cloud services (S3, Azure, Heroku) could yield full domain hijack with critical impact on a defense contractor.
- **Authentication bypass on internal-facing portals** — Australian regional infrastructure often exposes HR portals, VPN endpoints, or employee self-service apps that may lack SSO enforcement, leading to account takeover and potential lateral movement.
- **Exposed .git directories or debug endpoints on staging/dev subdomains** — wildcard scope means any forgotten dev/staging subdomain is in-scope; these frequently leak source code, secrets, or API keys.
- **Misconfigured CORS or API on unauthenticated subdomains** — defense contractors often run separate marketing/career sites on the same wildcard; a permissive CORS policy on any could enable cross-origin data exfiltration.
- **Email spoofing via missing/dangling SPF/DKIM/DMARC on *.anduril.com.au** — the Australian domain may have weaker email hardening than the primary .com, enabling phishing that impersonates Anduril to partners or government contacts.

## Fast Checks

1. **Subdomain enumeration** — run `subfinder -d anduril.com.au`, `amass enum -d anduril.com.au`, and crt.sh lookup to map the full attack surface.
2. **Dangling CNAME detection** — resolve all discovered subdomains and check for NXDOMAIN responses on CNAME targets (classic takeover vector).
3. **Port scan top 100 ports** on all live hosts — look for unusual services (8443, 9090, 5985/5986 WinRM) on non-production hosts.
4. **HTTP probe + screenshot** — use `httpx` + `aquatone` to identify login portals, admin panels, and exposed frameworks; flag anything returning 401/403 for deeper auth testing.
5. **DNSSEC/SPF/DKIM/DMARC audit** — check `dig TXT anduril.com.au` and `dig MX` for missing or misconfigured email authentication records.

## Notes

- **High competition**: 1,191 reports in 90 days suggests the surface has been heavily tested; low-hanging fruit is likely exhausted, but new subdomains or recent infrastructure changes remain viable.
- **Scope is wildcard and bounty-eligible** — all subdomains of anduril.com.au are in scope with payouts, but verify the HackerOne policy for any excluded asset types (e.g., social media accounts, third-party SaaS).
- **No live testing performed** — this audit is metadata-only; all hypotheses must be validated through authorized testing per the program's rules.
- **Australian entity considerations** — .com.au domains have strict registrant eligibility requirements; the infrastructure may be managed separately from the primary anduril.com, potentially with different security maturity.