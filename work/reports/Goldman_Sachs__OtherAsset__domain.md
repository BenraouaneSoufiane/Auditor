# Quick Domain Audit: *.ayco.com

## Verdict
Potential Critical/High hypothesis — wildcard scope on a wealth-management platform with financial data creates meaningful attack surface, but no confirmed vulnerability from metadata alone.

## Top Attack Hypotheses

- **Subdomain takeover via dangling CNAME/DNS records** — wildcard scopes frequently have orphaned cloud resources (S3, Azure, Heroku) pointing at unclaimed subdomains, enabling phishing or session theft against Goldman Sachs employees and clients (Critical).
- **IDOR on financial planning API endpoints** — Ayco manages personal financial data for corporate executives; broken access control on REST/GraphQL APIs could expose other clients' portfolio, tax, or compensation data (Critical).
- **Authentication bypass or SSO misconfiguration on client portals** — as a Goldman Sachs subsidiary handling sensitive wealth data, complex SSO/OAuth flows may allow authentication bypass or account takeover (High–Critical).
- **Stored XSS in client-facing financial dashboards** — advisory platforms often render user-controllable data (notes, document names) in dashboards; stored XSS could hijack advisor or client sessions (High).
- **Information disclosure via exposed staging/debug subdomains** — wildcard scope increases the chance of exposed `.staging`, `.dev`, or `.admin` subdomains leaking internal APIs, secrets, or Swagger docs (High).

## Fast Checks

1. **Subdomain enumeration** — run `subfinder -d ayco.com`, query `crt.sh`, and check DNSdumpster for the full subdomain surface.
2. **Dangling CNAME detection** — `dig +short CNAME <sub>` for each discovered subdomain; flag any pointing to unclaimed S3 buckets, Azure endpoints, or dead third-party services.
3. **HTTP fingerprint all subdomains** — use `httpx` to identify tech stacks, then map to known CVEs (e.g., outdated Apache, Spring, or proxy versions).
4. **Test auth flows** — enumerate SSO endpoints, check for open redirects, missing CSRF tokens, or OAuth misconfigs on login/signup flows.
5. **Probe for exposed APIs/docs** — check `/api`, `/swagger`, `/graphql`, `/admin`, `/actuator` on each subdomain for unauthenticated access.

## Notes

- This audit is derived solely from program metadata and public knowledge of Ayco (Goldman Sachs' personal financial management subsidiary). No live testing was performed.
- The "critical" CVSS label in metadata reflects the *impact classification* of the asset (financial/PII data), not a confirmed vulnerability.
- High competition risk (215 reports/90 days, program active since 2018) means common findings are likely already reported; focus on less-explored subdomains and logic flaws.
- Scope is `*.ayco.com` wildcard — confirm any discovered subdomain is explicitly covered before testing to avoid scope disputes.