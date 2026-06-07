# Quick Domain Audit: *.dev.travix.com

## Verdict
No credible Critical/High from metadata — target is **out of scope for bounty** (`in_scope: false`, `eligible_for_bounty: false`) despite being an active wildcard entry. Any finding here would be informational only.

## Top Attack Hypotheses

- **Exposed dev/staging dashboards** — the `*.dev.travix.com` wildcard suggests a development environment that may host admin panels, CI/CD interfaces, or API docs without production-grade auth controls, potentially leaking internal endpoints.
- **Subdomain takeover** — a wildcard DNS pattern with many ephemeral dev subdomains increases the risk of dangling CNAME or stale DNS records pointing to decommissioned cloud resources, enabling full subdomain hijack.
- **Information disclosure via default credentials or debug mode** — dev environments frequently run with verbose error pages, Swagger/OpenAPI specs, or default credentials on frameworks (e.g., Spring Boot Actuator, Django debug mode), potentially exposing secrets or internal architecture.
- **SSRF via dev-only internal services** — dev subdomains may have looser network policies allowing requests to internal metadata services or cloud APIs, potentially enabling cloud metadata SSRF to steal credentials.
- **Broken access control across dev↔prod boundary** — if dev services share authentication stores or session cookies with production Trip.com infrastructure, privilege escalation or cross-environment data access may be possible.

## Fast Checks

1. **Subdomain enumeration** — run `subfinder -d dev.travix.com` or `amass enum -brute -d dev.travix.com` to map the live attack surface and identify orphaned subdomains.
2. **HTTP probing & screenshot** — use `httpx -l subs.txt -sc -cl -title` followed by `aquatone` or `nuclei -t exposures/` to find open dashboards, debug endpoints, and unauthenticated admin panels.
3. **CNAME/dangling DNS audit** — check each subdomain's DNS for CNAMEs pointing to decommissioned S3 buckets, Azure Traffic Manager, GitHub Pages, or Heroku — classic takeover targets.
4. **Certificate transparency log review** — query `crt.sh/?q=%.dev.travix.com` for historical subdomains that may reveal internal service names no longer maintained.
5. **Scope confirmation** — verify on the [HackerOne policy page](https://hackerone.com/trip_com) whether `*.dev.travix.com` is intentionally out-of-scope or if the `in_scope: false` flag is a metadata error, before investing effort.

## Notes

- **Scope caveat**: The target metadata explicitly marks this as `in_scope: false` and `eligible_for_bounty: false`. Findings would likely be treated as informational. Confirm scope status directly with the program before reporting.
- **No live testing performed**: This audit is derived purely from metadata — no DNS resolution, HTTP probing, or active reconnaissance was conducted. All hypotheses are speculative.
- **High competition**: The program receives ~284 reports per 90 days with a "High" competition risk rating, meaning common surface-level findings are likely already well-reported.
- **Travix context**: Travix is a Trip.com Group subsidiary focused on European travel retail (BudgetAir, Vliegwinkel, etc.). Dev infrastructure may span multiple brands and regions.