# Quick Domain Audit: cart.tw.coupang.com

## Verdict
Needs Manual Review — cart subdomain on a high-traffic e-commerce platform with Critical CVSS metadata and bounties up to $4,000, but 764 reports in 90 days suggests high competition; surface area must be explored manually.

## Top Attack Hypotheses

- **Cart price manipulation / race condition** — tampering with quantity, coupon, or item price parameters in cart API calls could lead to purchasing items at arbitrary prices (High/Critical impact).
- **IDOR on cart session or user cart data** — accessing or modifying another user's cart by swapping cart/user identifiers in API requests could expose PII or enable fraud (High impact).
- **Stored XSS via cart item names or notes** — if product titles, gift messages, or custom fields rendered in the cart are unsanitized, stored XSS could hijack buyer sessions (Medium/High impact).
- **Authentication bypass on cart endpoints** — unauthenticated access to cart creation/modification APIs may allow cart injection or account enumeration (Medium/High impact).
- **Promo/coupon abuse via parameter tampering** — applying discount codes cross-region (TW vs KR) or stacking coupons beyond limits by manipulating request parameters (Medium impact).

## Fast Checks

1. **Recon the cart API surface** — `curl -v https://cart.tw.coupang.com/` and enumerate `/api/`, `/api/v1/`, `/graphql`, `/rest/` endpoints; note auth headers and cookies.
2. **Fuzz cart parameters** — intercept a cart add/update request in Burp, then fuzz `price`, `quantity`, `discount`, `cartId`, `userId` fields for manipulation.
3. **Test IDOR** — clone your session cookie, swap `cartId` or `userId` to sequential/predictable values and observe whether another user's cart is returned.
4. **Check for XSS in rendered cart content** — inject `<img src=x onerror=alert(1)>` in any free-text field (gift notes, search within cart, custom product input) and reload the page.
5. **Map cross-origin behavior** — test whether `tw.coupang.com` cart cookies/tokens are accepted on `coupang.com` (Korean main site) or vice versa, indicating auth scope issues.

## Notes

- **High competition risk** — 764 reports in 90 days means low-hanging fruit is likely gone; focus on cart-specific logic flaws over generic vulnerabilities.
- **No live testing performed** — this audit is metadata-only; all hypotheses are unconfirmed and require authorized testing within the HackerOne program scope.
- **Scope is limited to `cart.tw.coupang.com`** exactly (no wildcard); ensure any adjacent testing (e.g., `api.tw.coupang.com`) stays within declared program scope.
- **Program launched 2026-05-06** (~1 month old); triage may still be responsive but report saturation is a real concern.
- **CVSS label "critical"** in metadata likely reflects program severity rating policy, not a confirmed finding.