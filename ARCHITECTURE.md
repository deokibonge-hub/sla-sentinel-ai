# Architecture — SLA Sentinel AI

```
 Merchant (phone) ──► TOBi (web chat, QR)                                     Employees (browser)
                         │  ConversationAIService / IntentClassification              │
                         ▼                                                            ▼
                 ┌──────────────── Sentinel server (Node, one process) ────────────────────┐
                 │ Document Intelligence → Verification → Case Engine → Risk Engine        │
                 │        (AI vision | OCR)   (declared vs docs)   (pipeline)  (explainable) │
                 │ Policy Engine → Recommendation → Human-in-the-loop → Orchestration      │
                 │ SLA Engine · Continuous Monitoring · Lifecycle (Alert/Support/Educate/Engage)│
                 │ Alerts (per department) · Audit Trail · Notifications · RBAC            │
                 └───────────────┬──────────────────────────────┬──────────────────────────┘
                                 │ adapter                       │
                           G2 Simulator                    SQLite (relational)
                     (accounts, KYC, docs, txns,
                      SIM swap, PIN reset, delete)
```

## Case pipeline
`UNDERSTAND → VERIFY → RISK_SCORE → DECIDE → ORCHESTRATE → MONITOR → PREDICT → RESOLVE → LEARN`

## Onboarding flow
1. TOBi collects data conversationally; every answer and every document extraction updates the **invisible form** (`applications.fields` + `field_sources`).
2. When a document value contradicts a declared value (or vice-versa) a **conflict** is stored and TOBi asks for clarification — nothing is auto-rejected.
3. On submit: verification (declared vs document vs document, expiry, completeness) → risk (Operational, Compliance, AML/CFT, Fraud, Legal, Overall; each with factors) → policy → recommendation.
4. Policy `decision_policy`: low risk + verified + no exceptions → **straight-through processing**; otherwise routed (AML ≥ 70 → AML; Legal ≥ 60 → Legal; Compliance ≥ 80 → Compliance; Overall ≥ 60 → Risk; exceptions → Operations), alert raised, automation blocked.
5. Approval (policy or human) → G2 adapter creates the account → case RESOLVED, SLA stopped, customer notified, monitoring scheduled.
6. Human decisions that differ from the AI recommendation require a reason and raise an Audit alert.

## Continuous monitoring (runs every minute and on time travel)
| Rule | Department | Customer action (TOBi) |
|---|---|---|
| Document expiry at 90 / 30 / 7 / 0 days | Compliance (+ Internal Control from 30 days) | ALERT + renewal upload → compliance restored |
| < 6 transactions in 7 days after activation | Risk (inactivity predicted) | ENGAGE offer |
| ≥ 3 cash-ins 900–999 USD in 24h | AML (structuring) | — |
| SIM swap + PIN reset + ≥ 800 USD out in 24h | AML + Risk (account takeover) | — |
| Sensitive G2 operation without case reference | Internal Control | — |
| SLA ≥ 65% / 90% / 100% consumed | Operations | — |
| Human override of AI | Internal Audit | — |
| Lifecycle day +3 / +4 / +5 / +7 | — | EDUCATE tip · EDUCATE AML quiz · SUPPORT check-in · ENGAGE offer |

## Data model (main tables)
`users, roles, permissions, sessions, policies, conversations, messages, applications, documents, extractions, verifications, cases, risk_assessments, decisions, alerts, audit_events, notifications, g2_accounts, g2_transactions, g2_operations, g2_requests, lifecycle_actions, contracts, settings`

## AI services
`server/ai.js` wraps the Anthropic Messages API. Each AI use has a deterministic fallback so the demo never breaks:
- Conversation → rules-based slot filling (`tobi.js: rulesUnderstand`)
- Document intelligence → Tesseract/Poppler OCR + pattern extraction (`documents.js: rulesExtract`)

## Security notes (prototype)
Passwords hashed with scrypt; session cookie HttpOnly; RBAC checked on every API route; document files served only to authorised staff or to the owning TOBi conversation. For production: HTTPS termination, SSO, encryption at rest, data residency per OpCo and pseudonymous digital identity for cross-OpCo exchange.
