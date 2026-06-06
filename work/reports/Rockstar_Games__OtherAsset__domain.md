# Quick Domain Audit: *.rockstargames.com

## Verdict
Needs Manual Review

## Top Attack Hypotheses

- **Wildcard subdomain takeover** — the `*.rockstargames.com` wildcard scope means orphaned or misconfigured subdomains (dangling CNAMEs, stale cloud buckets) could be claimed, enabling full domain control (Critical).
- **Authentication/SSO bypass on legacy subdomains** — Rockstar likely runs diverse legacy infrastructure (forums, support portals, dev tools) with inconsistent auth; finding a subdomain with weak session handling could yield account takeover (High).
- **API information disclosure on internal-facing subdomains** — staging/dev/admin subdomains often expose Swagger/OpenAPI docs or debug endpoints without auth, leaking internal APIs and potentially user data (High).
- **Stored XSS via user-generated content** — social/forums/support subdomains accepting rich input are prime targets; a stored XSS on a rockstargames.com subdomain can steal cookies or redirect users (High).
- **Race conditions or IDOR in store/account management** — given the gaming commerce context, purchase flows, currency transactions, or account APIs may lack proper authorization checks, allowing vertical privilege escalation (High).

## Fast Checks

1. **Subdomain enumeration** — run `subfinder -d rockstargames.com | httpx -sc -cl -title` to map live subdomains and spot stale/dangling ones.
2. **Dangling CNAME detection** — resolve all subdomains and check for NXDOMAIN responses pointing to cloud providers (AWS, Azure, GitHub Pages, Heroku) indicating potential takeover.
3. **Fuzz API/docs endpoints** — on each discovered subdomain, fuzz for `/api/`, `/swagger.json`, `/graphql`, `/debug`, `/admin`, `.env`, and `sitemap.xml`.
4. **Check for CVEs on identified technologies** — use `wappalyzer` or `whatweb` on each subdomain, then cross-reference identified frameworks/versions against known CVEs.
5. **Test CORS and auth headers** — for each subdomain sending `Access-Control-Allow-Origin`, test if arbitrary origins are reflected; check for missing `HttpOnly`/`Secure` flags on session cookies.

## Notes

- This audit is based **solely on metadata** — no live testing or tooling was performed. All hypotheses are speculative.
- **High competition risk** (112 reports in 90 days, program running since 2017) means well-known attack surfaces are likely already picked over; focus on lesser-known subdomains and logic flaws rather than low-hanging web bugs.
- The wildcard scope (`*.rockstargames.com`) is broad but 6 of 15 targets are out-of-scope — always confirm specific subdomains against the current HackerOne policy before testing.
- Bounty range ($150–$2,500) suggests Criticals pay well, but the high report volume indicates fast triage and quick duplicate marking — speed matters.
- No assessment of subdomain age, technology stack, or recent changes was possible from metadata alone.