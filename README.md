# SLA Sentinel AI — Seamless Lifecycle Assistance

*From reactive servicing to proactive lifecycle management.*

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/deokibonge-hub/sla-sentinel-ai)

Try it: open `/scan` on the deployed site for the QR code to TOBi.

Functional hackathon prototype for **M-Pesa DRC (Vodacash)**. One server, one database, five connected experiences:

| Experience | URL | Who |
|---|---|---|
| **TOBi** — conversational onboarding & lifecycle assistant (mobile) | `/tobi` | Merchants (scan the QR code) |
| **Sentinel Command Center** — cross-department alerts & KPIs | `/` | Management / all roles |
| **Employee Workbench** + **Case 360** | `/work`, `/cases`, `/case/<ref>` | Operations, AML/CFT, Compliance, Risk, Internal Control, Legal, Audit |
| **G2 Simulator** — account creation & operations (legacy look) | `/g2` | Back office |
| **Demo Control** — time travel & event simulation | `/demo` | Administrator / presenter |

### What's new in v3.1
- **Every KPI is clickable**: Active cases, SLA on track, Needs attention, SLA breached, Automated and Non-compliance prevented open the matching cases. Departments have a *Cases →* link. The Cases page has filters (status, SLA, department, type, workflow status, risk, automated only, sort) kept in the URL.
- **Real case files**: every demo case now contains the documents the customer actually submitted (voter card or passport with MRZ, RCCM certificate, SNEL/REGIDESO bill, SIM swap form, G2 statement, sanctions screening result, partner contract, SMS screenshot), filled with that customer's data.
- **CASE FILE tab** in Case 360: document viewer with highlighted fields. Green = verified, amber = to check, red = exception. Hover a field to locate it on the document; *Key findings* on the Overview jump straight to the problem.
- Documents uploaded live in TOBi are highlighted too, using the OCR word positions.
- Existing demo data from an older version is re-seeded automatically at start-up.

---

## 1. Run it

**Requirements:** Node.js **22.13 or newer** (uses the built-in `node:sqlite`). No `npm install` needed to run.
**Document reading without AI (autonomous mode):** install the OCR tools once — the French + English OCR models are bundled in `server/tessdata/`.
- macOS: `brew install tesseract imagemagick poppler`
- Ubuntu/Debian: `sudo apt install tesseract-ocr imagemagick poppler-utils`
- Docker: already included.

TOBi then reads real photos on its own: auto-rotation, contrast/deskew, French & English labels (RCCM, carte d'électeur, passport MRZ with check digits, SNEL/REGIDESO bills, PDFs). Uncertain values are confirmed with the customer; unreadable photos switch to "type the details" and the case is routed to a human check (no straight-through processing). With an `ANTHROPIC_API_KEY`, AI vision is used first and OCR is the fallback.

```bash
node server/index.js          # → http://localhost:3000
```

The first start seeds realistic **fictional** data (≈170 cases, 112 G2 accounts, alerts for every department).

### Docker (recommended for the competition server)
```bash
docker build -t sla-sentinel-ai .
docker run -p 3000:3000 -v sentinel-data:/app/data \
  -e PUBLIC_URL=https://your-public-domain \
  -e ANTHROPIC_API_KEY=sk-ant-...   \
  sla-sentinel-ai
```
The image includes Tesseract OCR and Poppler. Data (SQLite DB + uploaded documents) lives in `/app/data` → mount a persistent volume.

### Configuration (`.env` file or environment variables)
| Variable | Purpose |
|---|---|
| `PORT` | HTTP port (default 3000) |
| `PUBLIC_URL` | Public HTTPS address — used by the QR code page so phones open the right URL |
| `ANTHROPIC_API_KEY` | Enables **AI MODE** (natural conversation + AI document vision). Without it the app runs in **DEMO MODE** (rules + OCR) |
| `ANTHROPIC_MODEL` | Optional model override |
| `DATA_DIR` | Where the database and uploads are stored (default `./data`) |

> Never commit the API key. Put it in `.env` on the server (see `.env.example`).

## 2. Demo accounts (password = the `DEMO_PASSWORD` environment variable, min. 12 characters)

| Username | Role | Can |
|---|---|---|
| `ops` | Operations Agent | process cases, approve eligible cases, request info, operate G2 (no deletion) |
| `opsmanager` | Operations Manager | + assign, G2 account deletion |
| `aml` | AML/CFT Officer | AML alerts, EDD, decide AML-owned cases |
| `compliance` | Compliance Officer | document/KYC alerts, remediation |
| `risk` | Risk Manager | risk intelligence, mitigation, escalation |
| `control` | Internal Control Officer | control exceptions, remediation, close findings |
| `legal` | Legal Officer | contract risks, legal reviews |
| `audit` | Internal Auditor | read-only assurance, audit flags, evidence export |
| `admin` | Administrator | policy engine, demo control, everything read |

Permissions are enforced **server-side** (try: Legal acting on an AML alert → 403).

## 3. The 1 min 45 demo path

1. Open `/qr` on the big screen → scan with a phone (or open `/tobi`).
2. **TOBi:** *Open a merchant account* → *Tell you about my business* → *"Hi, I'm Jean-Paul Mukendi, I run Kin Market SARL in Gombe, RCCM CD/KIN/RCCM/26-B-12345"*.
3. 📎 → *RCCM certificate — Kin Market SARL* (sample). TOBi reads it, fills the form and detects the **RCCM mismatch** (12354 vs 12345) → pick the document value.
4. 📎 → *ID card — Jean-Paul Mukendi*. Answer the remaining questions (quick-reply chips), upload *Proof of address*.
5. **Verification summary** → *Submit application* → low risk ⇒ straight-through processing → **account created in G2** (7-digit merchant number starting with 0, till, merchant SIM to collect at Vodacom Park within 48 h) → TOBi confirms → *Download my merchant form* (printable BCF).
6. `/demo` → **+3 days / +1 / +1 / +2**: TOBi sends **EDUCATE** (usage tip + AML/CFT quiz), **SUPPORT** ("Do you need help?" → PIN reset done via G2 in < 1 min) and **ENGAGE** (0% fee offer).
7. **Command Center**: alerts for every department; click one → **Why?** (explainable drivers), recommendation, RBAC-controlled actions. Open the case → **Case 360** + **Audit trail**.
8. Optional: `/g2` → search the new merchant's number → KYC, ID uploads, transactions, SIM swap / PIN reset / suspend / delete.
9. Optional: `/demo` → **+30 days** → document expiry → TOBi asks for renewal → upload *Renewed ID* → "Non-compliance prevented".

Sample documents are **fictional** and watermarked; they are in `samples/` and in TOBi's 📎 menu.

## 4. Customer services (TOBi menu)

| Service | SLA | Team | Automated decision |
|---|---|---|---|
| Merchant Account Creation | 48 h | M-Pesa Merchant Operations | STP if low risk & verified; eligibility rules reject with precise reasons (expired ID, no ID, terms refused) |
| SIM Creation | 72 h | Customer Operations | ID required |
| SIM Swap | 48 h | Customer Operations | ID document vs declared vs G2 KYC; mismatch → rejected with reasons; repeat swap < 30 days → Risk |
| Reset PIN | 24 h | Customer Operations | Identity matches G2 KYC → done in G2 instantly |
| Cash-out / Cash-in Reversal | 48 h | M-Pesa Reversals Desk | Transaction looked up in G2; not found / amount mismatch → information requested |
| Partner Onboarding | 5 business days | VBU Partnerships | Due diligence + Legal alert (agreement & DPA) |
| Enterprise Data Bundles, Closed User Group, Mobile & Fixed Voice, Mobile Internet | 72 h | EBU | Lead routed to account manager |
| Public / Private Cloud, Server Hosting, Fleet Management, Fiber Internet | 5 business days | EBU | Lead routed to account manager |

- **My requests** (TOBi header button or "my requests"): only the customer's own cases, status, SLA countdown, team, rejection reasons / information requested — refreshed automatically.
- TOBi remembers answers (profile) and pre-fills them in the next request. Every upload gets a **pre-check**: format, size, readability, expiry.
- **Staff:** Command Center search (case ID, title, requester) and KPIs recalculated per department; Case 360 adds *Activity*, SLA breach risk, confidence per risk score, next action and responsible team, printable BCF; role actions — Request EDD (AML), Add mitigation (Risk), Request revision / Accept legal recommendation (Legal), Initiate remediation / Close control (Internal Control), Audit flag (Audit), Send to G2 (Operations). Reject requires a justification (Operations Manager) and is shown to the customer.
- **G2 simulator:** "Creation requests from Sentinel" — form fields received, documents used, result.

## 5. What is real vs simulated

| Capability | Status |
|---|---|
| Case orchestration, pipeline, SLA engine, breach prediction | **Functional** |
| Database (relational, SQLite — portable to PostgreSQL/Prisma) | **Functional** |
| Authentication & RBAC (server-side) | **Functional** |
| TOBi state-driven conversation (knows collected / missing / conflicting data) | **Functional** — AI mode with API key, rules otherwise |
| Document upload & extraction | **Functional** — AI vision with key, Tesseract OCR otherwise |
| Cross-document verification, risk engine (explainable), policy engine (configurable, versioned) | **Functional** |
| Human-in-the-loop decisions, mandatory override reason | **Functional** |
| Audit trail (every action, AI vs human, overrides), CSV evidence export | **Functional** |
| Continuous monitoring: expiry thresholds, inactivity, structuring, account-takeover pattern, G2 ops without case | **Functional** (rules) |
| Lifecycle pillars Alert · Support · Educate · Engage via TOBi | **Functional** |
| G2 platform | **Simulated through adapter** (`server/g2.js`) |
| TOBi channel (real TOBi / WhatsApp) | **Simulated** — web chat; channel adapter ready |
| PEP / sanctions screening provider | **Simulated** |
| E-mail / WhatsApp notifications | **Simulated** (logged in `notifications`) |
| Transactions | **Simulated** generator (time-travel aware) |

Ready for integration: G2, iCAP, IRM, KYC providers and TOBi plug in behind the adapters in `server/g2.js`, `server/documents.js`, `server/tobi_out.js`.

## 6. Project layout
```
server/   index.js (HTTP + API + RBAC) · db.js (schema) · core.js (auth, audit, clock)
          tobi.js (conversation engine) · services.js (service catalogue, SLA, decisions) · forms.js (printable BCF) · schema.js (BCF merchant form) · documents.js (document intelligence + pre-check)
          verification.js · cases.js (risk, policy, recommendation, SLA, decisions) · g2.js (G2 simulator)
          lifecycle.js (monitoring + Educate/Support/Engage) · alerts.js · qr.js · seed.js
web/src/  React UI (TOBi, Command Center, Workbench, Case 360, G2, Audit, Policies, Demo)
web/dist/ pre-built UI (served as-is)
samples/  fictional demo documents
```
Rebuild the UI after changes: `npm i -D esbuild react react-dom && npm run build`.

See `ARCHITECTURE.md` for the data model and flows. All data is fictional — no real customer data.
