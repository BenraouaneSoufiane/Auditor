# Quick Domain Audit: *.anduril.com

## Verdict
Needs Manual Review

## Top Attack Hypotheses

- **Subdomain takeover** — wildcard scope on a defense-tech company likely means many subdomains with heterogeneous infrastructure (marketing sites, dev/staging, API gateways), increasing the chance of dangling CNAMEs or stale cloud resources (impact: full domain hijack, phishing stem).

- **Authentication/SSO misconfiguration** — large enterprises federating across `*.anduril.com` subdomains often expose misconfigured OAuth callbacks, open redirects, or SAML assertion issues (impact: account takeover across corporate apps).

- **Exposed internal tooling on subdomains** — rapid-growing defense contractors frequently spin up Jira, Grafana, Jenkins, or internal APIs on subdomains without proper access controls (impact: sensitive data leak, intellectual property exposure).

- **API endpoint on unlisted subdomain** — wildcard scope combined with 6 in-scope targets suggests asset inventory may be incomplete; enumeration may reveal pre-production or forgotten APIs (impact: unauthorized data access, business logic abuse).

- **TLS/SSL misconfiguration on secondary subdomains** — long-tail subdomains in wildcard scopes often have expired, misissued, or weak TLS configs (impact: MITM, credential interception, compliance violation).

## Fast Checks

1. **Subdomain enumeration** — run `subfinder -d anduril.com`, `amass enum -d anduril.com`, and certificate transparency log lookups (`crt.sh/?q=%.anduril.com`) to build a full subdomain inventory.
2. **Dangling CNAME detection** — resolve all discovered subdomains and check for CNAMEs pointing to decommissioned S3 buckets, Azure Traffic Manager, GitHub Pages, Heroku, or other takeover-prone services.
3. **HTTP prober + screenshot** — use `httpx -l subs.txt -sc -cl -title -screenshot` to identify live hosts, status codes, and page types; flag anything unexpected (login portals, dashboards, swagger UI).
4. **Port scan high-value hosts** — `nmap -sV --top-ports 1000` on any discovered API, staging, or internal-looking subdomains to find unprotected services.
5. **Content discovery on interesting subdomains** — `ffuf` or `feroxbuster` against any login/admin/API endpoints found for hidden paths, `.git/`, `.env`, swagger docs, or debug panels.

## Notes

- This audit is based **solely on program metadata** — no live reconnaissance or tool output was consulted.
- Anduril Industries is a **defense/national security contractor**; their bug bounty likely has stricter responsible disclosure expectations and potentially narrower de facto scope despite the wildcard inclusion.
- **High competition risk (Medium)** and **1,191 reports in 90 days** indicate heavy researcher activity; easy/obvious findings are likely already claimed. Differentiate by focusing on less-obvious subdomains and business-logic flaws rather than low-hanging web vulns.
- Bounty range $50–$7,500 is strong; Critical-severity findings on defense-tech infrastructure could command top payouts.
- Scope includes 6 in-scope targets (6 wildcard) and 2 out-of-scope — verify any discovered subdomain isn't explicitly excluded before testing.