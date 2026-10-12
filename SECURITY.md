# SLA Sentinel AI — Security summary (prototype v3.3)

Aligned with the *AI, LLM & RPA Security & Governance Standard*: Zero Trust, least privilege, human-in-the-loop, auditability.
All data in this prototype is fictional (no real customer data).

## Application security controls

| Area | Control |
|---|---|
| Authentication | Staff password set by the operator (`DEMO_PASSWORD`, min. 12 chars) — no default or hard-coded password. Passwords hashed with scrypt + per-user salt, constant-time comparison. |
| Brute force | Account locked 15 min after 5 failed attempts; IP throttled after 30; every failure written to the audit trail. |
| Sessions | 192-bit random token, `HttpOnly`, `SameSite=Strict`, `Secure` over HTTPS, 8-hour expiry, server-side logout. |
| Authorisation | Role-based access control on every API route (9 roles, least privilege). G2 console requires re-authentication. Destructive demo controls limited to the Administrator role. |
| CSRF | State-changing calls must be JSON and same-origin (Origin/Referer check) + `SameSite=Strict` cookie. |
| Injection | All SQL queries parameterised; React output escaping; server-generated HTML escaped. |
| Security headers | Content-Security-Policy (no inline or third-party scripts), HSTS over HTTPS, `X-Frame-Options`, `nosniff`, Referrer-Policy, Permissions-Policy, COOP/CORP. |
| File uploads | Type checked on the file bytes (JPG, PNG, WebP, GIF, PDF only — SVG/HTML/scripts rejected), 12 MB max, file name sanitised, served with a sandboxing CSP and `nosniff`. |
| Rate limiting | Per-IP limits on the API, on conversation creation, login and uploads. |
| Errors | No stack traces or internal messages returned to clients; incidents logged server-side. |
| Audit | Every action (human, AI, robot, failed login) in a SHA-256 hash-chained, tamper-evident audit trail, verifiable from the Security & Trust page. |
| Secrets | No secrets in the repository (`.env` excluded from Git and from the Docker build context); API keys set in the hosting dashboard only. |
| Container | Runs as non-root user `node`; minimal Debian slim base; no runtime npm dependencies (zero third-party JS on the server). |

## AI / LLM / RPA controls

| Area | Control |
|---|---|
| Prompt injection (OWASP LLM01) | Every TOBi message screened; attempts blocked and logged. |
| Excessive agency (LLM08) | AI agents are read-only; only allow-listed robot actions can write, within policy; High/Critical actions need human approval (maker-checker). |
| Identities | Developer, AI runtime, robot, administrator and break-glass identities are segregated. |
| Kill switches | Each agent/robot can be stopped; its work falls back to people (fail-secure). |
| Data protection | Phone and ID numbers masked in guardrail logs; AI mode is off unless an API key is configured by the operator. |

## Checks performed before submission

- Dependency audit: the server has **no runtime npm dependencies** (only Node.js built-ins); build tools are not shipped in the runtime path.
- Secret scan of the repository and its full Git history: **no secrets found**.
- Manual review + automated HTTP tests: security headers present; CSRF blocked for cross-site and form posts; account lockout after 5 failures; old default password rejected; SVG/HTML upload disguised as PNG rejected; malformed JSON → 400 without internal details.
- End-to-end functional test under the new Content-Security-Policy: no violations.

## Known limits (prototype)

- Core systems (G2, iCAP, IRM, transactional, control) are simulated; production would use mTLS service accounts and a secrets vault.
- One-time code verification in TOBi is simulated (no SMS gateway in the prototype).
- Rate-limit counters are in memory (single instance); production would use a shared store.
