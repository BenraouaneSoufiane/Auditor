# Quick Domain Audit: app.gmelius.com

## Verdict
Needs Manual Review

## Top Attack Hypotheses

- **OAuth/token handling flaws** — Gmelius integrates deeply with Gmail via OAuth scopes (read/send email, modify settings); misconfigured token validation or scope escalation could yield full email account takeover (Critical impact).
- **IDOR in shared inbox/board APIs** — The app exposes shared kanban boards, shared inboxes, and CRM objects across teams; broken access control on resource IDs could expose other organizations' emails and conversations (High impact).
- **Stored XSS in email notes/annotations** — Gmelius injects UI overlays (notes, tags, tracking pixels) into Gmail; unsanitized content in shared notes or email annotations could execute JS in other users' Gmail context (High impact).
- **CSRF on workspace admin actions** — Workspace configuration endpoints (adding/removing members, changing permissions) may lack CSRF tokens, allowing a attacker to modify org membership or escalate privileges (High impact).
- **Subdomain takeover / postMessage origin issues** — As a Chrome extension + web app hybrid, cross-origin messaging between app.gmelius.com, Gmail, and extension contexts could leak sensitive data if origin checks are missing (Medium-High impact).

## Fast Checks

1. **Recon**: Subdomain enumerate `*.gmelius.com` and identify all in-scope assets — check for stale DNS, exposed staging/dev instances, and forgotten subdomains.
2. **API enumeration**: Authenticate and map all REST/GraphQL endpoints; test each for IDOR by swapping resource UUIDs between two different org accounts.
3. **OAuth flow review**: Walk the full OAuth grant flow; check for redirect_uri validation bypass, state parameter reuse, and scope escalation possibilities.
4. **Input fuzzing in collaborative features**: Test stored XSS in shared notes, board descriptions, email templates, and any user-generated content that renders for other users.
5. **Extension traffic analysis**: Intercept communication between the Gmelius Chrome extension and app.gmelius.com; look for missing auth on API calls, predictable tokens, or overly permissive CORS.

## Notes

- **No bounties offered** — `eligible_for_bounty: false` and `bounty_min/max: 0`. This is a reputation-only program unless policy states otherwise on the live H1 page.
- Only **4 reports in 90 days** suggests either aggressive duplicate closing, narrow scope, or low researcher attention — the attack surface may be undertested.
- The CVSS "critical" tag in metadata likely reflects the *sensitivity* of data handled (full email access) rather than a confirmed vulnerability.
- Scope is limited to specific domains (no wildcard), so carefully check the live policy at [hackerone.com/gmelius](https://hackerone.com/gmelius) for excluded endpoints (e.g., marketing site, blog) before testing.
- Gmelius operates as both a **web app and a Chrome extension** — both surfaces should be in scope; verify which is actually covered.