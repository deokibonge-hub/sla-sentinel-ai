// Trust layer: connected systems, machine identities, tool trust tiers, LLM guardrails, kill switches,
// DRC pilot programme and the end-to-end orchestration trace of a case (the 9 steps).
// Aligned with the AI, LLM & RPA Security & Governance Standard (Zero Trust, least privilege, HITL, audit).
import { get, all, run, s, j, setting, setSetting, policy } from './db.js';
import { iso, now, audit, verifyAudit, DAY, HOUR } from './core.js';

// ---------- connected systems ----------
// Every call goes through the API gateway with mTLS + OAuth2 client credentials, under a dedicated identity.
export const CONNECTORS = [
  { code: 'TOBI', name: 'TOBi', role: 'Conversational channel — WhatsApp, App, USSD, Web', identity: 'svc-tobi-runtime', kind: 'AI agent', scopes: ['conversation.read', 'conversation.write', 'notify.send'], tier: 'LOW' },
  { code: 'G2', name: 'G2', role: 'Core M-Pesa platform — accounts, PIN, wallets', identity: 'bot-g2-provisioning', kind: 'Robot', scopes: ['account.create', 'pin.reset', 'account.read'], tier: 'MEDIUM', hitl: 'Reversal, deletion, limit change → human approval' },
  { code: 'ICAP', name: 'iCAP', role: 'SIM connection — activation and provisioning of SIMs', identity: 'bot-icap', kind: 'Robot', scopes: ['sim.connect', 'sim.activate', 'sim.swap'], tier: 'MEDIUM', hitl: 'SIM swap → human approval (High tier)' },
  { code: 'IRM', name: 'IRM', role: 'Gateway for SIM unblocking and KYC registration', identity: 'bot-irm', kind: 'Robot', scopes: ['kyc.lookup', 'kyc.register', 'sim.unblock'], tier: 'MEDIUM' },
  { code: 'TRANSACTIONAL', name: 'Transactional systems', role: 'Payments, billing, settlement, tills & short codes', identity: 'bot-txn', kind: 'Robot', scopes: ['tx.read', 'till.activate'], tier: 'MEDIUM', items: ['Payments', 'Billing', 'Settlement', 'Tills & short codes'] },
  { code: 'CONTROL', name: 'Control systems', role: 'AML monitoring, sanctions / PEP screening, GRC, audit', identity: 'bot-grc', kind: 'Robot', scopes: ['aml.screening', 'evidence.push', 'exception.raise'], tier: 'LOW', items: ['AML monitoring', 'Sanctions / PEP', 'GRC', 'Audit'] },
];
const CMAP = Object.fromEntries(CONNECTORS.map(c => [c.code, c]));
const LAT = { TOBI: [40, 140], G2: [180, 420], ICAP: [120, 300], IRM: [110, 280], TRANSACTIONAL: [80, 220], CONTROL: [60, 180], GATEWAY: [8, 30] };
const lat = (sys) => { const [a, b] = LAT[sys] || [50, 200]; return Math.round(a + Math.random() * (b - a)); };

export function callSystem(system, operation, { case_ref = null, identity, tier, status = 'OK', detail = null, ts } = {}) {
  const c = CMAP[system];
  run('INSERT INTO integration_calls(ts,system,operation,identity,tier,case_ref,status,latency_ms,detail) VALUES(?,?,?,?,?,?,?,?,?)',
    ts || iso(), system, operation, identity || c?.identity || 'gateway', tier || c?.tier || 'LOW', case_ref, status, lat(system), detail ? (typeof detail === 'string' ? detail : s(detail)) : null);
}

// ---------- identities (segregated, per the standard) ----------
export const IDENTITIES = [
  { id: 'dev-*', type: 'Developer', used_by: 'Engineering team', access: 'Non-production only · no customer data', auth: 'SSO + MFA', rotation: '—' },
  { id: 'svc-sentinel-ai', type: 'AI runtime', used_by: 'Document Intelligence, Risk & AML, SLA agents', access: 'Read-only: KYC lookup, screening, approved knowledge', auth: 'mTLS + OAuth2', rotation: '24 h' },
  { id: 'svc-tobi-runtime', type: 'AI runtime', used_by: 'TOBi agent', access: 'Conversations, notifications', auth: 'mTLS + OAuth2', rotation: '24 h' },
  { id: 'bot-g2-provisioning', type: 'Bot', used_by: 'G2 robot', access: 'account.create, pin.reset — allow-listed actions only', auth: 'Vaulted secret', rotation: '7 days' },
  { id: 'bot-icap / bot-irm / bot-txn / bot-grc', type: 'Bot', used_by: 'iCAP, IRM, transactional, control robots', access: 'Write to own system only', auth: 'Vaulted secret', rotation: '7 days' },
  { id: 'admin-*', type: 'Administrator', used_by: 'Platform admins', access: 'Configuration · sessions recorded', auth: 'SSO + MFA + PAM', rotation: '—' },
  { id: 'break-glass', type: 'Break-glass', used_by: 'Emergency only (CISO approval)', access: 'Sealed · every use alerts the SOC', auth: 'Hardware key', rotation: 'After each use' },
];

// ---------- tool trust framework ----------
export const TOOLS = [
  { tool: 'Knowledge retrieval (policies, product rules)', tier: 'LOW', mode: 'Automatic', by: 'AI agents' },
  { tool: 'Document reading, KYC lookup, AML screening', tier: 'LOW', mode: 'Automatic (read-only)', by: 'AI agents' },
  { tool: 'Reminders, tickets, education messages', tier: 'MEDIUM', mode: 'Automatic within policy', by: 'Robots' },
  { tool: 'Account creation, SIM connection, PIN reset, SIM unblock', tier: 'MEDIUM', mode: 'Automatic only if policy allows (low risk, all checks passed)', by: 'G2 robot' },
  { tool: 'SIM swap, KYC override, limit change', tier: 'HIGH', mode: 'Human approval (maker-checker)', by: 'Robot after approval' },
  { tool: 'Reversals, payments, IAM, policy changes', tier: 'CRITICAL', mode: 'Human approval + second approver', by: 'People only' },
];

// ---------- guardrails ----------
const INJECTION = [/ignore (all |the )?(previous|prior|above) (instructions|rules)/i, /system prompt/i, /you are now/i, /act as (an? )?(admin|administrator|developer)/i, /disable (the )?(security|guardrails|filters)/i, /reveal (your|the) (instructions|prompt|keys?|password)/i, /approve (my|this) (account|request) (without|now)/i, /jailbreak/i];
const PII = [/(?:\+?243|0)\s?[89]\d(?:[\s.-]?\d){7}/g, /\b\d{2}-[A-Z0-9]{2,4}-[A-Z0-9]{5,9}\b/g, /\b[A-Z]{2}\d{6,9}\b/g];
export function maskPII(text) { let t = String(text || ''); for (const r of PII) t = t.replace(r, (m) => m.slice(0, 3) + '•••' + m.slice(-2)); return t; }
export function screenInput(text, conv_id, channel = 'TOBi') {
  const hit = INJECTION.find(r => r.test(String(text || '')));
  if (hit) { run('INSERT INTO guardrail_events(ts,kind,channel,conv_id,detail,action) VALUES(?,?,?,?,?,?)', iso(), 'PROMPT_INJECTION', channel, conv_id, maskPII(String(text).slice(0, 160)), 'BLOCKED'); audit({ actor: 'Guardrail', system: 'SENTINEL', action: 'Prompt-injection attempt blocked', entity: 'conversation:' + conv_id, rule: 'LLM01_PROMPT_INJECTION' }); return { blocked: true }; }
  if (PII.some(r => { r.lastIndex = 0; return r.test(String(text || '')); })) run('INSERT INTO guardrail_events(ts,kind,channel,conv_id,detail,action) VALUES(?,?,?,?,?,?)', iso(), 'PII_MASKED', channel, conv_id, null, 'MASKED');
  return { blocked: false };
}

// ---------- kill switches ----------
export const AGENTS = [['TOBI_AGENT', 'TOBi agent'], ['DOC_INTEL', 'Document Intelligence'], ['RISK_AGENT', 'Risk & AML agent'], ['BOT_G2', 'G2 robot'], ['BOT_ICAP', 'iCAP robot']];
export const killed = (k) => !!setting('kill_' + k, false);
export function setKill(k, on, user) { setSetting('kill_' + k, !!on); audit({ actor: user.name, role: user.role, action: `Kill switch ${on ? 'ENGAGED' : 'released'}: ${k}`, entity: 'agent:' + k, rule: 'FAIL_SECURE' }); }

// ---------- overview for the Security & Trust and Connected systems pages ----------
export function systemsOverview() {
  const day = new Date(+now() - DAY).toISOString();
  return CONNECTORS.map(c => {
    const st = get('SELECT COUNT(*) n, AVG(latency_ms) l, SUM(status!=\'OK\') e, MAX(ts) last FROM integration_calls WHERE system=?', c.code);
    const d1 = get('SELECT COUNT(*) n FROM integration_calls WHERE system=? AND ts>=?', c.code, day).n;
    return { ...c, status: 'CONNECTED', protocol: 'REST API · mTLS 1.3 + OAuth2', calls: st.n, calls_24h: d1, avg_ms: Math.round(st.l || 0), errors: st.e || 0, last: st.last };
  });
}
export function recentCalls(limit = 25) { return all('SELECT * FROM integration_calls ORDER BY id DESC LIMIT ?', limit); }

export function trustOverview() {
  const g = (k) => get('SELECT COUNT(*) n FROM guardrail_events WHERE kind=?', k).n;
  const hitl = get("SELECT COUNT(*) n FROM decisions WHERE role!='SYSTEM'").n, stp = get("SELECT COUNT(*) n FROM decisions WHERE role='SYSTEM'").n;
  return {
    identities: IDENTITIES, tools: TOOLS,
    guardrails: { injections_blocked: g('PROMPT_INJECTION'), pii_masked: g('PII_MASKED'), outputs_validated: get("SELECT COUNT(*) n FROM messages WHERE sender='tobi'").n, ai_writes: 0 },
    decisions: { automatic: stp, human: hitl, overrides: get('SELECT COUNT(*) n FROM decisions WHERE override=1').n },
    audit: verifyAudit(), audit_events: get('SELECT COUNT(*) n FROM audit_events').n,
    kill: AGENTS.map(([k, l]) => ({ key: k, label: l, engaged: killed(k) })),
    recent_guardrails: all('SELECT * FROM guardrail_events ORDER BY id DESC LIMIT 8'),
    standards: ['ISO 27001 / 27701', 'NIST CSF', 'NIST AI RMF', 'OWASP LLM Top 10', 'OWASP Agentic Security', 'PCI-DSS v4.0', 'Zero Trust'],
  };
}

// ---------- DRC pilot programme ----------
export function programme() {
  const c = (sql, ...p) => get(sql, ...p)?.n || 0;
  const onb = c("SELECT COUNT(*) n FROM cases WHERE type='MERCHANT_ONBOARDING'");
  const onbAuto = c("SELECT COUNT(DISTINCT d.case_id) n FROM decisions d JOIN cases x ON x.id=d.case_id WHERE d.role='SYSTEM' AND x.type='MERCHANT_ONBOARDING' AND d.action='APPROVE'");
  const res = all("SELECT created_at, resolved_at, sla_status FROM cases WHERE resolved_at IS NOT NULL");
  const met = res.filter(r => r.sla_status === 'MET').length;
  const times = all("SELECT (julianday(resolved_at)-julianday(created_at))*24 h FROM cases WHERE type='MERCHANT_ONBOARDING' AND status='RESOLVED'").map(r => r.h).sort((a, b) => a - b);
  const med = times.length ? times[Math.floor(times.length / 2)] : null;
  const kpis = [
    { label: 'SLA met', value: res.length ? Math.round(met / res.length * 100) : 0, unit: '%', target: 90 },
    { label: 'Onboarding straight-through', value: onb ? Math.round(onbAuto / onb * 100) : 0, unit: '%', target: 40 },
    { label: 'Median onboarding time', value: med == null ? null : Math.round(med * 10) / 10, unit: 'h', target: 24, lower: true },
    { label: 'Open critical security findings', value: 0, unit: '', target: 0, lower: true },
  ];
  return {
    budget: { total: 700000, lines: [['Team · 6 FTE × 9 months', 270000], ['Integrations · TOBi, G2, iCAP, IRM, transactional & control systems', 110000], ['Cybersecurity · pen test, SOC, vault, DR', 80000], ['Cloud · 18 months', 45000], ['DRC pilot · training, change, support', 115000], ['Contingency', 80000]],
    },
    market: { country: 'DRC', city: 'Kinshasa', phase: 'Pilot · Y1 – Y2', next: ['2 OpCos · Y3', 'All OpCos · Y4'] },
    kpis, accounts: c("SELECT COUNT(*) n FROM g2_accounts WHERE status='ACTIVE'"), cases: c('SELECT COUNT(*) n FROM cases'),
    connected: CONNECTORS.length, systems: CONNECTORS.map(c => c.name),
  };
}

// ---------- orchestration trace: the 9 steps of one case ----------
export function caseTrace(c) {
  if (!c) return null;
  const conv = c.conv_id ? get('SELECT * FROM conversations WHERE id=?', c.conv_id) : null;
  const calls = all('SELECT * FROM integration_calls WHERE case_ref=? ORDER BY id', c.ref);
  const decs = all('SELECT * FROM decisions WHERE case_id=? ORDER BY id', c.id);
  const rec = j(c.recommendation, {});
  const human = decs.find(d => d.role !== 'SYSTEM'), stp = decs.find(d => d.role === 'SYSTEM' && d.action === 'APPROVE');
  const ex = c.application_id ? get('SELECT COUNT(*) n FROM extractions e JOIN documents d ON d.id=e.document_id WHERE d.application_id=?', c.application_id).n : 0;
  const life = c.account_msisdn ? all('SELECT pillar, code, status, due_at, sent_at FROM lifecycle_actions WHERE msisdn=? ORDER BY due_at', c.account_msisdn) : [];
  const ev = get('SELECT COUNT(*) n FROM audit_events WHERE case_ref=?', c.ref).n;
  const last = get('SELECT hash FROM audit_events WHERE case_ref=? ORDER BY id DESC LIMIT 1', c.ref);
  const gw = conv ? get("SELECT * FROM integration_calls WHERE system='GATEWAY' AND detail=? ORDER BY id DESC", 'conv:' + conv.id) : null;
  const sys = (code) => calls.filter(x => x.system === code);
  const done = ['RESOLVED'].includes(c.status);
  const exec = calls.filter(x => ['G2', 'ICAP', 'TRANSACTIONAL'].includes(x.system) || (x.system === 'IRM' && x.operation !== 'kyc.lookup') || (x.system === 'CONTROL' && x.operation !== 'aml.screening'));
  const steps = [
    { n: 1, title: 'Request received', actor: c.source === 'TOBi' ? 'TOBi agent' : (c.source || 'Channel'), identity: 'svc-tobi-runtime', ts: conv?.created_at || c.created_at, status: 'DONE', detail: c.source === 'TOBi' ? `Conversation on ${conv?.channel === 'TOBI_WEB' ? 'TOBi (web)' : 'TOBi'} — ${c.customer_name}` : `Created by ${c.source || 'Sentinel'}` },
    { n: 2, title: 'Identity checked at the gateway', actor: 'API gateway', identity: 'gateway', ts: gw?.ts || conv?.created_at || c.created_at, status: 'DONE', detail: gw ? 'Phone number verified by one-time code · session bound to device · TLS 1.3' : 'Authenticated session · TLS 1.3 · rate-limited' },
    { n: 3, title: 'Case opened, SLA clock started', actor: 'Sentinel orchestrator', identity: 'svc-sentinel-ai', ts: c.created_at, status: 'DONE', detail: `${c.ref} · SLA ${c.sla_hours} h · due ${new Date(c.sla_due).toUTCString().slice(5, 22)}` },
    { n: 4, title: 'AI agents read and check', actor: 'Document Intelligence · Risk & AML agent', identity: 'svc-sentinel-ai (read-only)', ts: sys('IRM')[0]?.ts || c.created_at, status: 'DONE', detail: `${ex} document(s) read · KYC lookup (IRM) ${sys('IRM').length ? '✓' : '—'} · AML screening ${sys('CONTROL').some(x => x.operation === 'aml.screening') ? '✓' : '—'} · risk ${c.risk_score}/100 ${c.risk_level}`, systems: ['IRM', 'CONTROL'].filter(x => sys(x).length) },
    { n: 5, title: 'Policy decides', actor: 'Policy & permission engine', identity: 'policy-engine', ts: c.created_at, status: 'DONE', detail: rec.rule || '—', branch: rec.automation ? 'ROBOT' : 'HUMAN' },
    { n: 6, title: 'Human approval', actor: human ? `${human.actor}` : 'Not required', identity: human ? human.role : '—', ts: human?.created_at || null, status: human ? 'DONE' : (stp ? 'SKIPPED' : (done ? 'SKIPPED' : 'WAITING')), detail: human ? `${human.action}${human.override ? ' (override)' : ''} — ${human.reason || 'maker-checker'}` : stp ? 'Low risk, all checks passed → policy authorises the robot (Medium tier)' : 'Waiting for the responsible team' },
    { n: 7, title: 'Robot executes in core systems', actor: 'G2 · iCAP · IRM · transactional · control robots', identity: 'bot-g2-provisioning', ts: exec[0]?.ts || null, status: exec.some(x => x.status !== 'OK') && !exec.some(x => x.system === 'G2' && x.status === 'OK') ? 'FAILED' : exec.length ? 'DONE' : 'PENDING', detail: exec.length ? exec.map(x => `${CMAP[x.system]?.name || x.system} ${x.operation}${x.status === 'OK' ? ' ✓' : ' ✗'}`).join(' · ') : '—', systems: [...new Set(exec.map(x => x.system))] },
    { n: 8, title: 'Sentinel stays with the client', actor: 'Lifecycle agent · TOBi', identity: 'svc-tobi-runtime', ts: life[0]?.due_at || null, status: life.some(l => l.status !== 'SCHEDULED') ? 'ACTIVE' : life.length ? 'SCHEDULED' : 'PENDING', detail: life.length ? life.map(l => `${l.pillar} ${l.status === 'SCHEDULED' ? '· day ' + Math.max(0, Math.round((new Date(l.due_at) - new Date(c.resolved_at || c.created_at)) / DAY)) : '✓'}`).join(' · ') : 'Starts when the account is live', pillars: ['ALERT', 'SUPPORT', 'EDUCATE', 'ENGAGE'] },
    { n: 9, title: 'Every step secured and logged', actor: 'Audit trail (hash-chained)', identity: '—', ts: null, status: 'DONE', detail: `${ev} audit events · ${calls.length} system calls under machine identities · chain ${verifyAudit().ok ? 'verified ✓' : 'BROKEN'}${last?.hash ? ' · ' + last.hash.slice(0, 12) + '…' : ''}` },
  ];
  return steps;
}

// ---------- backfill call history for seeded data ----------
export function backfillCalls() {
  const nowIso = iso();
  const add = (system, op, ts, case_ref, extra = {}) => callSystem(system, op, { ts: ts && ts < nowIso ? ts : nowIso, case_ref, ...extra });
  for (const c of all("SELECT * FROM cases ORDER BY id")) {
    if (/TOBi/i.test(c.source || '')) add('TOBI', 'conversation.write', c.created_at, c.ref);
    if (c.type === 'MERCHANT_ONBOARDING') { add('IRM', 'kyc.lookup', c.created_at, c.ref, { identity: 'svc-sentinel-ai', tier: 'LOW' }); add('CONTROL', 'aml.screening', c.created_at, c.ref, { identity: 'svc-sentinel-ai' }); }
    else if (/KYC|RENEWAL|AML/.test(c.type || '')) add(/AML/.test(c.type) ? 'CONTROL' : 'IRM', /AML/.test(c.type) ? 'aml.screening' : 'kyc.register', c.created_at, c.ref);
    if (c.resolved_at && c.type === 'MERCHANT_ONBOARDING' && c.status === 'RESOLVED') { add('G2', 'account.create', c.resolved_at, c.ref); add('ICAP', 'sim.connect', c.resolved_at, c.ref); add('IRM', 'kyc.register', c.resolved_at, c.ref); add('TRANSACTIONAL', 'till.activate', c.resolved_at, c.ref); add('CONTROL', 'evidence.push', c.resolved_at, c.ref); }
  }
  for (const o of all('SELECT * FROM g2_operations ORDER BY id')) add(o.op === 'SIM_SWAP' ? 'ICAP' : /UNBLOCK/.test(o.op) ? 'IRM' : 'G2', o.op === 'SIM_SWAP' ? 'sim.swap' : 'op.' + String(o.op).toLowerCase(), o.ts, o.case_ref, { identity: /Sentinel/.test(o.operator || '') ? 'bot-g2-provisioning' : 'staff:' + (o.operator || 'unknown') });
  for (const a of all("SELECT * FROM alerts WHERE dept IN ('INTERNAL_CONTROL','AUDIT')")) add('CONTROL', 'exception.raise', a.created_at, a.case_ref);
  for (const m of all("SELECT conv_id, MIN(created_at) ts, COUNT(*) n FROM messages WHERE sender='tobi' GROUP BY conv_id")) add('TOBI', 'conversation.write', m.ts, null, { detail: `${m.n} messages` });
  for (const l of all("SELECT * FROM lifecycle_actions WHERE sent_at IS NOT NULL")) add('TRANSACTIONAL', 'tx.read', l.sent_at, null, { detail: l.pillar });
}
