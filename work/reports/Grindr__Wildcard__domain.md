# Quick Domain Audit: *.grindr.com

## Verdict
Needs Manual Review — wildcard scope on a high-value dating platform with location data, auth tokens, and PII presents credible Critical/High surface area worth investigating.

## Top Attack Hypotheses

1. **Subdomain takeover / dangling DNS** — Wildcard scope covers potentially hundreds of subdomains; stale CNAME records pointing at decommissioned SaaS/cloud services could enable full subdomain takeover, yielding session token theft (Critical).

2. **API authentication bypass on staging/internal subdomains** — Given 25 total targets with 9 in-scope, exposed non-production subdomains (staging, dev, api-internal) may have relaxed auth or missing rate limits, exposing user data en masse.

3. **IDOR in user profile/chat APIs** — Grindr handles sensitive location, photos, and message data; sequential or predictable user IDs in REST/GraphQL APIs could allow unauthorized access to other users' profiles and real-time location (High/Critical).

4. **WebSocket/real-time location leakage** — The app broadcasts proximity data; manipulating WebSocket messages or replaying location updates could reveal exact geolocation of arbitrary users (Critical — safety impact).

5. **OAuth/token handling flaws** — Mobile apps with social login may expose access tokens via deep links, custom URL schemes, or insecure token storage, enabling full account takeover (High).

## Fast Checks

1. **Subdomain enumeration** — Run `subfinder -d grindr.com` + `amass enum -passive -d grindr.com`, then `dnsrecon` to identify stale CNAMEs pointing at unclaimed third-party services.

2. **HTTP probe + screenshot** — `httpx -l subs.txt -sc -cl -title` + `nuclei -t takeover/` to find live hosts and known takeover fingerprints.

3. **API endpoint discovery** — Decompile the Grindr APK (`jadx`) to extract API base URLs, endpoints, and hardcoded secrets; test for auth inconsistencies across discovered subdomains.

4. **IDOR testing on core APIs** — After authenticating, systematically replace user IDs in profile/message/location API calls with another user's ID and check for unauthorized data return.

5. **Deep link / custom scheme analysis** — Extract Android intent filters and iOS URL schemes from the mobile app; test for token leakage via `adb` or Frida hooking on OAuth redirect flows.

## Notes

- This audit is based **solely on program metadata and general knowledge** of Grindr's platform — no live testing or tooling was performed.
- Scope is a wildcard (`*.grindr.com`) with 7 wildcard targets total; verify each discovered subdomain against the official policy before testing to avoid out-of-scope findings.
- Bounty range is $100–$3,000 with "critical" CVSS rating flagged in scope metadata — highest payouts likely reserved for account takeover or mass PII disclosure.
- 27 reports in the last 90 days suggests active triage but not an overwhelmed program; quality reports with clear reproduction stand a good chance of acceptance.
- Grindr handles LGBTQ+ user data with real-world safety implications; findings involving location disclosure or identity exposure may receive elevated severity consideration.