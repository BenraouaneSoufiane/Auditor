# Quick Domain Audit: login.starbucks.co.jp

## Verdict
Needs Manual Review — Login endpoint with critical CVSS classification on a mature, bounty-eligible target warrants hands-on testing.

## Top Attack Hypotheses

- **OAuth/Auth-flow redirect hijacking** — Misconfigured `redirect_uri` or missing state parameter could allow account takeover via authorization code interception.
- **Credential stuffing / brute-force** — Login portals without rate-limiting or account lockout enable large-scale credential stuffing from prior breaches.
- **Password reset token leakage** — Tokens sent over HTTP or predictable token generation could let an attacker reset arbitrary accounts.
- **Session fixation or cookie scope issues** — If session cookies lack `Secure`/`HttpOnly`/`SameSite` flags or are scoped too broadly, session hijack via XSS or network MITM is possible.
- **Subdomain takeover / dangling CNAME** — As a dedicated login subdomain, if it was ever hosted on external infrastructure (e.g., AWS, Azure), an unclaimed DNS record could allow full subdomain takeover.

## Fast Checks

1. **Check for open redirect** — Append `?redirect_uri=https://evil.com` or `?next=https://evil.com` to the login endpoint and observe post-auth behavior.
2. **Test rate limiting** — Send 50+ rapid login attempts with invalid credentials; note whether any CAPTCHA, lockout, or 429 response triggers.
3. **Inspect cookie/security headers** — Review `Set-Cookie` attributes (`Secure`, `HttpOnly`, `SameSite`) and presence of `X-Frame-Options`, `Content-Security-Policy`, and `Strict-Transport-Security`.
4. **Enumerate password reset flow** — Trigger a reset and inspect the token in the email link for entropy, expiry, and whether it's single-use.
5. **DNS/subdomain recon** — Run `dig` / `subfinder` on `starbucks.co.jp` to check for dangling CNAMEs or stale DNS records pointing to unclaimed cloud resources.

## Notes

- This audit is metadata-only; no live testing was performed. The CVSS "critical" label in scope metadata suggests the program values login-related findings highly.
- Program has 42 reports in the last 90 days with high competition risk — common vuln classes (XSS, open redirect) are likely already reported. Focus on authentication logic flaws and business-logic edge cases for differentiated findings.
- Bounty range ($150–$3,000) is strong; authentication bypass or account takeover findings would justify the top end.
- Scope is the single hostname `login.starbucks.co.jp` (no wildcard); ensure all testing stays on this exact domain to remain in scope.