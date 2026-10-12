// SLA Sentinel AI — HTTP server (no external dependencies). Node >= 22.5.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { get, all, run, j, s, setting, setSetting, policy, DATA_DIR } from './db.js';
import { verifyPassword, login, logout, userFromToken, can, ensureDemoUsers, iso, now, audit, advanceClock, DAY, HOUR, DEPTS, DEPT_NAMES, ROLES } from './core.js';
import * as tobi from './tobi.js';
import { case360, waitingFor, decide, orchestrateCreation, slaInfo, refreshSla, caseAction, CASE_ACTIONS } from './cases.js';
import { account, operate, normMsisdn, fmtMsisdn, addTx, txSummary, fraudCheck } from './g2.js';
import { tick, createSimpleCase } from './lifecycle.js';
import { raise } from './alerts.js';
import { qrSvg } from './qr.js';
import { aiEnabled } from './ai.js';
import { seed, USERS } from './seed.js';
import { bcfHtml } from './forms.js';
import { customerRequests, SERVICES, slaLabel } from './services.js';
import { programme, systemsOverview, recentCalls, trustOverview, setKill, AGENTS, backfillCalls } from './trust.js';
import { sealAudit } from './core.js';
import { securityHeaders, sessionCookie, csrfOk, rateLimited, clientIp, loginLocked, loginFailed, loginOk, DOC_CSP } from './security.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'web', 'dist');
const PORT = Number(process.env.PORT || 3000);
// load .env if present
try { for (const l of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, ''); } } catch { }

const SEED_VERSION = '3.2-trust';
if (!get('SELECT 1 FROM users LIMIT 1')) { console.log('Seeding demo data…'); seed(); setSetting('seed_version', SEED_VERSION); }
else if (setting('seed_version') !== SEED_VERSION) { console.log('Demo data from an older version — re-seeding with complete case files…'); seed(true); setSetting('seed_version', SEED_VERSION); }
try { ensureDemoUsers(USERS); } catch (e) { console.warn('Demo users check failed:', e.message); }
try { if (!get('SELECT COUNT(*) n FROM integration_calls').n) backfillCalls(); const n = sealAudit(); if (n) console.log(`Audit trail sealed: ${n} events hash-chained`); } catch (e) { console.warn('Trust layer init failed:', e.message); }

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.pdf': 'application/pdf', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(type === 'application/json' ? JSON.stringify(body) : body); };
const bad = (res, code, msg, extra = {}) => send(res, code, { error: msg, ...extra });
class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
async function body(req) { let b = ''; for await (const c of req) { b += c; if (b.length > 20e6) throw new HttpError(413, 'Payload too large'); } if (!b) return {}; try { const v = JSON.parse(b); return v && typeof v === 'object' ? v : {}; } catch { throw new HttpError(400, 'Invalid JSON'); } }
const docHeaders = (res, d) => { res.setHeader('Content-Security-Policy', DOC_CSP); res.setHeader('Content-Disposition', `inline; filename="${String(d.filename || 'document').replace(/[^\w.\-]/g, '_')}"`); };
const cookie = (req, k) => (req.headers.cookie || '').split(';').map(x => x.trim().split('=')).find(([a]) => a === k)?.[1];

const routes = [];
const r = (method, pattern, perm, fn) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), perm, fn });

// ---------- public / TOBi ----------
r('GET', '/api/config', null, () => ({ ai: aiEnabled(), clock: iso(), public_url: process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || null, demo_offset_days: Math.round((Number(setting('clock_offset_ms', 0)) || 0) / DAY * 10) / 10 }));
r('POST', '/api/tobi/start', null, (q, b) => ({ token: tobi.startConversation({}) }));
r('GET', '/api/tobi/:token', null, (q) => tobi.getConversation(q.p.token, Number(q.url.searchParams.get('since') || 0)));
r('POST', '/api/tobi/:token/message', null, async (q, b) => { await tobi.handleText(q.p.token, b.text); return tobi.getConversation(q.p.token, Number(b.since || 0)); });
r('POST', '/api/tobi/:token/upload', null, async (q, b, res) => { try { await tobi.handleUpload(q.p.token, b); } catch (e) { return bad(res, 400, /accepted|too large/i.test(e.message) ? e.message : 'This file could not be processed.'); } return tobi.getConversation(q.p.token, Number(b.since || 0)); });
r('POST', '/api/tobi/:token/action', null, async (q, b) => { const out = await tobi.handleAction(q.p.token, b); return { ...tobi.getConversation(q.p.token, Number(b.since || 0)), result: out || null }; });
r('GET', '/api/tobi/:token/requests', null, (q, b, res) => { const conv = get('SELECT * FROM conversations WHERE token=?', q.p.token); if (!conv) return bad(res, 404, 'Not found'); return customerRequests(conv); });
r('GET', '/api/tobi/:token/form', null, (q, b, res) => { const conv = get('SELECT application_id FROM conversations WHERE token=?', q.p.token); const app = conv && get('SELECT id, status FROM applications WHERE id=?', conv.application_id); if (!app || app.status === 'DRAFT') return send(res, 404, '<p>Form available after submission.</p>', 'text/html'); res.setHeader('Content-Security-Policy', DOC_CSP); return send(res, 200, bcfHtml(app.id), 'text/html; charset=utf-8'); });
r('GET', '/api/services', null, () => Object.entries(SERVICES).map(([code, v]) => ({ code, label: v.label, sla: slaLabel(v.sla), team: v.team, group: v.group })));
r('GET', '/api/qr', null, (q, b, res) => send(res, 200, qrSvg(String(q.url.searchParams.get('text') || 'https://vodacom.cd').slice(0, 300), { scale: 10 }), 'image/svg+xml'));
r('GET', '/api/tobi/:token/doc/:id', null, (q, b, res) => {
  const conv = get('SELECT application_id FROM conversations WHERE token=?', q.p.token);
  const d = conv && get('SELECT * FROM documents WHERE id=? AND application_id=?', q.p.id, conv.application_id);
  if (!d) return bad(res, 404, 'Not found');
  docHeaders(res, d); return send(res, 200, fs.readFileSync(path.join(DATA_DIR, 'uploads', path.basename(d.path))), d.mime || 'application/octet-stream');
});

// ---------- auth ----------
r('POST', '/api/login', null, (q, b, res) => {
  const ip = clientIp(q.req), user = String(b.username || '').trim().toLowerCase().slice(0, 64);
  if (loginLocked('ip:' + ip, 'u:' + user)) return bad(res, 429, 'Too many failed attempts. Try again in 15 minutes.');
  const out = typeof b.password === 'string' && b.password.length <= 128 ? login(user, b.password) : null;
  if (!out) { loginFailed('ip:' + ip, 'u:' + user); audit({ actor: 'Unknown', role: 'ANONYMOUS', action: 'Failed login', entity: 'user:' + user.replace(/[^\w.@-]/g, '').slice(0, 40), rule: 'AUTH_FAILURE' }); return bad(res, 401, 'Wrong username or password.'); }
  loginOk('ip:' + ip, 'u:' + user);
  res.setHeader('set-cookie', sessionCookie(q.req, out.token));
  return { user: out.user };
});
r('POST', '/api/logout', null, (q, b, res) => { logout(cookie(q.req, 'sid')); res.setHeader('set-cookie', sessionCookie(q.req, '', 0)); return { ok: true }; });
r('GET', '/api/me', 'auth', (q) => q.user);
r('POST', '/api/reauth', 'auth', (q, b, res) => { const k = 'u:' + q.user.username; if (loginLocked(k)) return bad(res, 429, 'Too many failed attempts. Try again in 15 minutes.'); if (!verifyPassword(q.user.username, b.password)) { loginFailed(k, 'ip:' + clientIp(q.req)); audit({ actor: q.user.name, role: q.user.role, system: 'G2', action: 'G2 re-authentication failed', rule: 'AUTH_FAILURE' }); return bad(res, 401, 'Wrong password.'); } audit({ actor: q.user.name, role: q.user.role, system: 'G2', action: 'G2 session opened (re-authenticated)' }); return { ok: true }; });
r('GET', '/api/users/demo', null, () => all('SELECT username, name, role FROM users ORDER BY id').map(u => ({ ...u, roleName: ROLES[u.role]?.name })));

// ---------- dashboard ----------
function kpis(dept = null) {
  const c = (sql, ...p) => get(sql, ...p)?.n || 0;
  for (const x of all("SELECT * FROM cases WHERE status NOT IN ('RESOLVED','REJECTED','CLOSED')")) refreshSla(x);
  const D = dept && DEPTS.includes(dept) ? dept : null;
  const cw = D ? ` AND owner_dept='${D}'` : '';   // D is whitelisted above
  const open = "status NOT IN ('RESOLVED','REJECTED','CLOSED')" + cw;
  const aw = (d) => D ? (D === d ? '' : ' AND 0') : '';
  return {
    total_cases: c(`SELECT COUNT(*) n FROM cases WHERE 1=1${cw}`),
    active_cases: c(`SELECT COUNT(*) n FROM cases WHERE ${open}`),
    on_track: c(`SELECT COUNT(*) n FROM cases WHERE ${open} AND sla_status='ON_TRACK'`),
    at_risk: c(`SELECT COUNT(*) n FROM cases WHERE ${open} AND sla_status IN ('AT_RISK','CRITICAL')`),
    breached: c(`SELECT COUNT(*) n FROM cases WHERE ${open} AND sla_status='BREACHED'`),
    auto_processed: c(`SELECT COUNT(DISTINCT d.case_id) n FROM decisions d JOIN cases x ON x.id=d.case_id WHERE d.role='SYSTEM'${D ? ` AND x.owner_dept='${D}'` : ''}`),
    human_review: c(`SELECT COUNT(*) n FROM cases WHERE status IN ('PENDING_REVIEW','AWAITING_CUSTOMER','EDD_REQUESTED','LEGAL_REVISION')${cw}`),
    control_exceptions: c("SELECT COUNT(*) n FROM alerts WHERE dept='INTERNAL_CONTROL' AND status!='RESOLVED'" + aw('INTERNAL_CONTROL')),
    docs_expiring: c("SELECT COUNT(*) n FROM documents WHERE replaced_by IS NULL AND account_msisdn IS NOT NULL AND expiry_date BETWEEN ? AND ?", iso(), new Date(+now() + 30 * DAY).toISOString()),
    non_compliant: c("SELECT COUNT(DISTINCT account_msisdn) n FROM documents WHERE replaced_by IS NULL AND account_msisdn IS NOT NULL AND expiry_date < ?", iso()),
    high_risk: c(`SELECT COUNT(*) n FROM cases WHERE ${open} AND risk_level IN ('HIGH','CRITICAL')`),
    aml_escalations: c("SELECT COUNT(*) n FROM alerts WHERE dept='AML' AND status!='RESOLVED'" + aw('AML')),
    legal_reviews: c("SELECT COUNT(*) n FROM alerts WHERE dept='LEGAL' AND status!='RESOLVED'" + aw('LEGAL')),
    audit_flags: c("SELECT COUNT(*) n FROM alerts WHERE dept='AUDIT' AND status!='RESOLVED'" + aw('AUDIT')),
    sla_met_pct: (() => { const t = c("SELECT COUNT(*) n FROM cases WHERE resolved_at IS NOT NULL" + cw), m = c("SELECT COUNT(*) n FROM cases WHERE resolved_at IS NOT NULL AND sla_status='MET'" + cw); return t ? Math.round(m / t * 100) : 0; })(),
    noncompliance_prevented: Number(setting('noncompliance_prevented', 0)) + c("SELECT COUNT(*) n FROM cases WHERE type='DOCUMENT_RENEWAL' AND status='RESOLVED' AND source IN ('SEED','Sentinel monitoring')"),
    accounts_monitored: c("SELECT COUNT(*) n FROM g2_accounts WHERE status='ACTIVE'"),
  };
}
r('GET', '/api/dashboard', 'dashboard.view', (q) => {
  const dept = q.url.searchParams.get('dept');
  const alerts = all("SELECT * FROM alerts WHERE status!='RESOLVED' ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END, id DESC").map(a => ({ ...a, why: j(a.why, []) }));
  const byDept = Object.fromEntries(DEPTS.map(d => [d, alerts.filter(a => a.dept === d)]));
  const stages = all("SELECT stage, COUNT(*) n FROM cases WHERE status NOT IN ('RESOLVED','REJECTED','CLOSED') GROUP BY stage");
  const types = all("SELECT type, COUNT(*) n FROM cases GROUP BY type");
  const days = []; for (let i = 13; i >= 0; i--) { const d0 = new Date(+now() - i * DAY); const k = d0.toISOString().slice(0, 10); days.push({ day: k.slice(5), created: get("SELECT COUNT(*) n FROM cases WHERE substr(created_at,1,10)=?", k).n, resolved: get("SELECT COUNT(*) n FROM cases WHERE substr(resolved_at,1,10)=?", k).n, alerts: get("SELECT COUNT(*) n FROM alerts WHERE substr(created_at,1,10)=?", k).n }); }
  const riskHeat = all("SELECT dimension, level, COUNT(*) n FROM risk_assessments WHERE dimension!='OVERALL' GROUP BY dimension, level");
  const recent = all("SELECT * FROM audit_events ORDER BY id DESC LIMIT 14");
  const openC = "status NOT IN ('RESOLVED','REJECTED','CLOSED')";
  const dept_summary = DEPTS.map(d => ({ dept: d, alerts: byDept[d].length, urgent: byDept[d].filter(a => ['CRITICAL', 'HIGH'].includes(a.severity)).length,
    cases: get(`SELECT COUNT(*) n FROM cases WHERE owner_dept=? AND ${openC}`, d).n, on_track: get(`SELECT COUNT(*) n FROM cases WHERE owner_dept=? AND ${openC} AND sla_status='ON_TRACK'`, d).n,
    breached: get(`SELECT COUNT(*) n FROM cases WHERE owner_dept=? AND ${openC} AND sla_status='BREACHED'`, d).n }));
  const resolvedN = get("SELECT COUNT(*) n FROM cases WHERE resolved_at IS NOT NULL" + (DEPTS.includes(dept) ? ` AND owner_dept='${dept}'` : '')).n;
  return { kpis: { ...kpis(dept), resolved: resolvedN }, dept: DEPTS.includes(dept) ? dept : null, dept_summary, alerts: byDept, dept_names: DEPT_NAMES, stages, types, trend: days, risk_heat: riskHeat, recent, clock: iso(), ai: aiEnabled() };
});
r('GET', '/api/alerts/:id', 'dashboard.view', (q) => { const a = get('SELECT * FROM alerts WHERE id=?', q.p.id); return a && { ...a, why: j(a.why, []), account: a.account_msisdn ? account(a.account_msisdn) : null, history: all("SELECT * FROM audit_events WHERE (case_ref=? AND ? IS NOT NULL) OR entity=? ORDER BY id DESC LIMIT 20", a.case_ref, a.case_ref, 'account:' + a.account_msisdn) }; });
r('POST', '/api/alerts/:id/action', 'auth', (q, b, res) => {
  const a = get('SELECT * FROM alerts WHERE id=?', q.p.id); if (!a) return bad(res, 404, 'Alert not found');
  const u = q.user, act = b.action;
  if (act === 'FLAG') { if (!can(u, 'audit.flag')) return bad(res, 403, 'Not authorised'); raise({ dept: 'AUDIT', type: 'AUDIT_FLAG', severity: 'MEDIUM', title: `Audit flag: ${a.title}`, detail: b.note || 'Flagged for assurance review', why: [{ points: 25, label: `Flagged by ${u.name}` }], case_ref: a.case_ref, account_msisdn: a.account_msisdn, rule: 'AUDIT_FLAG_' + a.id }); return { ok: true }; }
  if (!can(u, 'alert.act') || (u.dept !== a.dept && u.role !== 'ADMIN')) return bad(res, 403, `Only ${DEPT_NAMES[a.dept]} can act on this alert`);
  if (act === 'INITIATE_REMEDIATION') {
    if (!can(u, 'remediation.initiate')) return bad(res, 403, 'Not authorised');
    const ref = createSimpleCase('REMEDIATION', a.account_msisdn, a.title.split('—').pop().trim(), a.dept, 24 * 7, { action: 'CONTROL_REMEDIATION_REQUIRED', reason: [a.title], confidence: 90 });
    run("UPDATE alerts SET status='ACKNOWLEDGED', owner=?, case_ref=COALESCE(case_ref,?), updated_at=? WHERE id=?", u.name, ref, iso(), a.id);
    audit({ actor: u.name, role: u.role, action: 'Remediation initiated', case_ref: ref, new_state: a.title });
    return { ok: true, case_ref: ref };
  }
  const st = { ACK: 'ACKNOWLEDGED', RESOLVE: 'RESOLVED', ESCALATE: 'ACKNOWLEDGED' }[act];
  if (!st) return bad(res, 400, 'Unknown action');
  run('UPDATE alerts SET status=?, owner=?, updated_at=? WHERE id=?', st, u.name, iso(), a.id);
  if (act === 'ESCALATE') raise({ dept: b.to || 'RISK', type: 'ESCALATION', severity: 'HIGH', title: `Escalated from ${DEPT_NAMES[a.dept]}: ${a.title}`, detail: b.note || '', why: j(a.why, []), case_ref: a.case_ref, account_msisdn: a.account_msisdn, rule: 'ESC_' + a.id });
  audit({ actor: u.name, role: u.role, action: `Alert ${act.toLowerCase()}`, case_ref: a.case_ref, entity: 'alert:' + a.id, prev_state: a.status, new_state: st, human_decision: b.note || null });
  return { ok: true };
});

// ---------- cases ----------
r('GET', '/api/cases', 'case.view', (q) => {
  const sp = q.url.searchParams, w = [], p = [];
  const list = (k) => (sp.get(k) || '').split(',').map(x => x.trim()).filter(Boolean);
  const inList = (col, vals) => { if (vals.length) { w.push(`${col} IN (${vals.map(() => '?').join(',')})`); p.push(...vals); } };
  // refresh SLA states first so the filters match what the dashboard shows
  for (const x of all("SELECT * FROM cases WHERE status NOT IN ('RESOLVED','REJECTED','CLOSED')")) refreshSla(x);
  inList('owner_dept', list('dept'));
  if (sp.get('open') === '1') w.push("status NOT IN ('RESOLVED','REJECTED','CLOSED')");
  if (sp.get('open') === '0') w.push("status IN ('RESOLVED','REJECTED','CLOSED')");
  inList('sla_status', list('sla'));
  inList('status', list('status'));
  inList('type', list('type'));
  inList('risk_level', list('risk'));
  if (sp.get('auto') === '1') w.push("id IN (SELECT case_id FROM decisions WHERE role='SYSTEM')");
  if (sp.get('override') === '1') w.push("id IN (SELECT case_id FROM decisions WHERE override=1)");
  if (sp.get('q')) { w.push('(ref LIKE ? OR customer_name LIKE ? OR account_msisdn LIKE ? OR type LIKE ? OR service LIKE ? OR ref IN (SELECT case_ref FROM alerts WHERE title LIKE ?))'); p.push(...Array(6).fill('%' + sp.get('q') + '%')); }
  const sort = sp.get('sort') === 'sla' ? 'ORDER BY CASE WHEN resolved_at IS NULL THEN 0 ELSE 1 END, sla_due' : sp.get('sort') === 'risk' ? 'ORDER BY risk_score DESC' : 'ORDER BY id DESC';
  const rows = all(`SELECT * FROM cases ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ${sort} LIMIT 300`, ...p);
  const ndocs = Object.fromEntries(all('SELECT case_ref, COUNT(*) n FROM documents WHERE case_ref IS NOT NULL AND replaced_by IS NULL GROUP BY case_ref').map(r => [r.case_ref, r.n]));
  const adocs = Object.fromEntries(all('SELECT application_id, COUNT(*) n FROM documents WHERE application_id IS NOT NULL AND replaced_by IS NULL GROUP BY application_id').map(r => [r.application_id, r.n]));
  return rows.map(c => ({ ...c, details: undefined, recommendation: j(c.recommendation, {}), waiting: waitingFor(c, j(c.recommendation, {})), sla: slaInfo(c), docs: Math.max(ndocs[c.ref] || 0, adocs[c.application_id] || 0, (j(c.details, {})?.documents || []).length) }));
});
r('GET', '/api/cases/:ref', 'case.view', (q, b, res) => case360(q.p.ref) || bad(res, 404, 'Case not found'));
r('POST', '/api/cases/:ref/decision', 'auth', (q, b, res) => {
  const u = q.user, act = b.action;
  const need = { APPROVE: 'case.decide', REJECT: 'case.reject', REQUEST_INFORMATION: 'case.request_info', ESCALATE: 'case.escalate' }[act];
  const c = get('SELECT owner_dept FROM cases WHERE ref=?', q.p.ref);
  const okAml = c?.owner_dept === 'AML' && u.role === 'AML_OFFICER' && ['APPROVE', 'REJECT'].includes(act);
  if (!need || (!can(u, need) && !okAml)) return bad(res, 403, 'Your role is not authorised for this action');
  try { return { ok: true, result: decide(q.p.ref, u, act, b.reason || '') }; } catch (e) { return bad(res, e.code === 'OVERRIDE_REASON' ? 422 : 400, e.message, { code: e.code }); }
});
r('POST', '/api/cases/:ref/action', 'auth', (q, b, res) => {
  const def = CASE_ACTIONS[b.action]; if (!def) return bad(res, 400, 'Unknown action');
  if (!can(q.user, def.perm)) return bad(res, 403, `Your role (${q.user.roleName}) is not authorised to ${def.label.toLowerCase()}`);
  try { return { ok: true, result: caseAction(q.p.ref, q.user, b.action, b.note || '') }; } catch (e) { return bad(res, e.code === 'OVERRIDE_REASON' ? 422 : 400, e.message, { code: e.code }); }
});
r('GET', '/api/case-actions', 'auth', (q) => Object.entries(CASE_ACTIONS).filter(([, d]) => can(q.user, d.perm)).map(([k, d]) => ({ action: k, ...d })));
r('POST', '/api/cases/:ref/retry-g2', 'g2.create', (q, b, res) => { const c = get('SELECT id,status FROM cases WHERE ref=?', q.p.ref); if (!c || c.status !== 'G2_FAILED') return bad(res, 400, 'Nothing to retry'); audit({ actor: q.user.name, role: q.user.role, action: 'Retry G2 creation', case_ref: q.p.ref }); return orchestrateCreation(c.id, q.user.name); });
r('GET', '/api/forms/bcf/:ref', 'case.view', (q, b, res) => { const c = get('SELECT application_id FROM cases WHERE ref=?', q.p.ref); if (!c?.application_id) return send(res, 404, '<p>No merchant form for this case.</p>', 'text/html'); audit({ actor: q.user.name, role: q.user.role, action: 'Merchant form printed', case_ref: q.p.ref }); res.setHeader('Content-Security-Policy', DOC_CSP); return send(res, 200, bcfHtml(c.application_id), 'text/html; charset=utf-8'); });
r('GET', '/api/documents/:id/file', 'case.view', (q, b, res) => { const d = get('SELECT * FROM documents WHERE id=?', q.p.id); if (!d) return bad(res, 404, 'Not found'); docHeaders(res, d); return send(res, 200, fs.readFileSync(path.join(DATA_DIR, 'uploads', path.basename(d.path))), d.mime || 'application/octet-stream'); });
r('GET', '/api/workbench', 'auth', (q) => {
  const u = q.user, dept = u.dept;
  const cases = (dept === 'AUDIT' || dept === 'ADMIN') ? all("SELECT * FROM cases WHERE status NOT IN ('RESOLVED','REJECTED','CLOSED') ORDER BY sla_due LIMIT 60") : all("SELECT * FROM cases WHERE owner_dept=? AND status NOT IN ('RESOLVED','REJECTED','CLOSED') ORDER BY sla_due LIMIT 60", dept);
  const alerts = all(`SELECT * FROM alerts WHERE status!='RESOLVED' ${['AUDIT', 'ADMIN'].includes(dept) ? '' : 'AND dept=?'} ORDER BY id DESC LIMIT 60`, ...(['AUDIT', 'ADMIN'].includes(dept) ? [] : [dept])).map(a => ({ ...a, why: j(a.why, []) }));
  const mine = all('SELECT d.*, c.ref FROM decisions d JOIN cases c ON c.id=d.case_id WHERE d.actor=? ORDER BY d.id DESC LIMIT 20', u.name);
  return { user: u, cases: cases.map(c => ({ ...refreshSla(c), sla: slaInfo(c) })), alerts, decisions: mine };
});

// ---------- G2 ----------
r('GET', '/api/g2/search', 'g2.view', (q) => { const sp = q.url.searchParams; const t = (sp.get('q') || '').trim(); const n = normMsisdn(t); const ty = sp.get('type'); return all(`SELECT msisdn, account_type, name, trading_name, short_code, till_number, status, region, created_at, kyc FROM g2_accounts WHERE (msisdn LIKE ? OR short_code=? OR till_number=? OR name LIKE ? OR trading_name LIKE ? OR kyc LIKE ?) ${ty ? 'AND account_type=?' : ''} ORDER BY updated_at DESC LIMIT 50`, '%' + (n || t) + '%', t, t, '%' + t + '%', '%' + t + '%', '%"merchant_id":"' + t + '"%', ...(ty ? [ty] : [])).map(a => { const k = j(a.kyc, {}); delete a.kyc; return { ...a, merchant_id: k.merchant_id || null, owner: k.owner_name || null }; }); });
r('GET', '/api/g2/accounts', 'g2.view', () => all("SELECT msisdn, account_type, name, trading_name, till_number, status, created_at FROM g2_accounts ORDER BY created_at DESC LIMIT 25"));
r('GET', '/api/g2/requests', 'g2.view', () => all('SELECT * FROM g2_requests ORDER BY id DESC LIMIT 40').map(r => { const p = j(r.payload, {}); return { ...r, payload: p, response: j(r.response), documents: (p.documents || []).map(id => get('SELECT id, doc_type, filename, expiry_date FROM documents WHERE id=?', id)).filter(Boolean) }; }));
r('GET', '/api/g2/transactions', 'g2.view', (q) => {
  const sp = q.url.searchParams, w = [], p = [];
  if (sp.get('msisdn')) { w.push('t.msisdn LIKE ?'); p.push('%' + normMsisdn(sp.get('msisdn')) + '%'); }
  if (sp.get('type')) { w.push('t.type=?'); p.push(sp.get('type')); }
  if (sp.get('ref')) { w.push('t.tx_ref LIKE ?'); p.push('%' + sp.get('ref') + '%'); }
  if (sp.get('from')) { w.push('t.ts>=?'); p.push(sp.get('from')); }
  if (sp.get('to')) { w.push('t.ts<=?'); p.push(sp.get('to') + 'T23:59:59'); }
  return all(`SELECT t.*, a.name, a.trading_name, a.account_type FROM g2_transactions t LEFT JOIN g2_accounts a ON a.msisdn=t.msisdn ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY t.ts DESC LIMIT 200`, ...p);
});
r('GET', '/api/g2/operations', 'g2.view', (q) => {
  const sp = q.url.searchParams, w = [], p = [];
  if (sp.get('q')) { w.push('(o.msisdn LIKE ? OR o.case_ref LIKE ? OR o.operator LIKE ? OR o.op LIKE ?)'); p.push(...Array(4).fill('%' + sp.get('q') + '%')); }
  if (sp.get('op')) { w.push('o.op=?'); p.push(sp.get('op')); }
  if (sp.get('from')) { w.push('o.ts>=?'); p.push(sp.get('from')); }
  if (sp.get('to')) { w.push('o.ts<=?'); p.push(sp.get('to') + 'T23:59:59'); }
  return all(`SELECT o.*, a.name, a.trading_name FROM g2_operations o LEFT JOIN g2_accounts a ON a.msisdn=o.msisdn ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY o.id DESC LIMIT 200`, ...p);
});
r('GET', '/api/g2/accounts/:msisdn', 'g2.view', (q, b, res) => {
  const a = account(q.p.msisdn); if (!a) return bad(res, 404, 'Account not found');
  audit({ actor: q.user.name, role: q.user.role, system: 'G2', action: 'G2 account viewed', entity: 'account:' + a.msisdn });
  return { account: a, transactions: all('SELECT * FROM g2_transactions WHERE msisdn=? ORDER BY ts DESC LIMIT 60', a.msisdn), operations: all('SELECT * FROM g2_operations WHERE msisdn=? ORDER BY id DESC LIMIT 40', a.msisdn),
    documents: all('SELECT id, doc_type, filename, mime, expiry_date, uploaded_at FROM documents WHERE account_msisdn=? AND replaced_by IS NULL', a.msisdn), summary: txSummary(a.msisdn) };
});
r('POST', '/api/g2/accounts/:msisdn/op', 'g2.operate', (q, b, res) => {
  if (b.op === 'DELETE' && !can(q.user, 'g2.delete')) return bad(res, 403, 'Account deletion requires Operations Manager');
  try { return { ok: true, account: operate(q.p.msisdn, b.op, { operator: q.user.name, role: q.user.role, case_ref: b.case_ref || null, detail: b }) }; } catch (e) { return bad(res, 400, e.message); }
});

// ---------- audit, notifications, contracts, policies ----------
r('GET', '/api/audit', 'auth', (q, b, res) => {
  if (!can(q.user, 'audit.view') && !can(q.user, 'case.view')) return bad(res, 403, 'Not authorised');
  const sp = q.url.searchParams, w = [], p = [];
  if (sp.get('case_ref')) { w.push('case_ref=?'); p.push(sp.get('case_ref')); }
  if (sp.get('override')) w.push('override=1');
  if (sp.get('q')) { w.push('(action LIKE ? OR actor LIKE ? OR case_ref LIKE ? OR new_state LIKE ?)'); p.push(...Array(4).fill('%' + sp.get('q') + '%')); }
  return all(`SELECT * FROM audit_events ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY id DESC LIMIT 300`, ...p).map(e => ({ ...e, evidence: j(e.evidence) }));
});
r('GET', '/api/audit/export', 'audit.export', (q, b, res) => { const rows = all('SELECT * FROM audit_events ORDER BY id'); const cols = Object.keys(rows[0] || { id: 1 }); const csv = [cols.join(','), ...rows.map(r => cols.map(c => JSON.stringify(r[c] ?? '')).join(','))].join('\n'); res.setHeader('content-disposition', 'attachment; filename="sentinel_audit_trail.csv"'); return send(res, 200, csv, 'text/csv'); });
r('GET', '/api/notifications', 'auth', () => all('SELECT * FROM notifications ORDER BY id DESC LIMIT 60'));
r('GET', '/api/contracts', 'dashboard.view', () => all('SELECT * FROM contracts ORDER BY id DESC').map(c => ({ ...c, clauses: j(c.clauses, []) })));
r('GET', '/api/policies', 'dashboard.view', () => all('SELECT * FROM policies ORDER BY category, key').map(p => ({ ...p, value: j(p.value) })));
r('PUT', '/api/policies/:key', 'policy.manage', (q, b, res) => { const p = get('SELECT * FROM policies WHERE key=?', q.p.key); if (!p) return bad(res, 404, 'Unknown policy'); run('UPDATE policies SET value=?, version=version+1, updated_by=?, updated_at=? WHERE key=?', s(b.value), q.user.name, iso(), q.p.key); audit({ actor: q.user.name, role: q.user.role, action: 'Policy updated', entity: 'policy:' + q.p.key, prev_state: p.value, new_state: s(b.value) }); return { ok: true }; });

// ---------- programme, connected systems, security & trust ----------
r('GET', '/api/programme', 'dashboard.view', () => programme());
r('GET', '/api/systems', 'dashboard.view', () => ({ systems: systemsOverview(), calls: recentCalls(30) }));
r('GET', '/api/trust', 'dashboard.view', () => trustOverview());
r('POST', '/api/trust/kill', 'policy.manage', (q, b, res) => { if (!AGENTS.some(([k]) => k === b.key)) return bad(res, 400, 'Unknown agent'); setKill(b.key, !!b.on, q.user); return { ok: true }; });

// ---------- demo control ----------
r('GET', '/api/demo/state', 'demo.control', () => ({ offset_days: Math.round((Number(setting('clock_offset_ms', 0)) || 0) / DAY * 10) / 10, clock: iso(), g2_fail_next: !!setting('g2_fail_next', false), ai: aiEnabled() }));
r('POST', '/api/demo/advance', 'demo.control', (q, b) => { const from = +now(); advanceClock((Number(b.days) || 0) * DAY + (Number(b.hours) || 0) * HOUR); audit({ actor: q.user.name, role: q.user.role, system: 'DEMO', action: `Time advanced +${b.days || 0}d ${b.hours || 0}h` }); tick(from); return { ok: true, clock: iso() }; });
r('POST', '/api/demo/simulate', 'demo.control', (q, b, res) => {
  const k = b.kind; const who = { actor: q.user.name, role: q.user.role, system: 'DEMO' };
  if (k === 'G2_FAILURE') { setSetting('g2_fail_next', true); audit({ ...who, action: 'Next G2 call will fail' }); return { ok: true }; }
  if (k === 'SLA_RISK') { const c = get("SELECT * FROM cases WHERE status NOT IN ('RESOLVED','REJECTED','CLOSED') AND sla_status='ON_TRACK' ORDER BY id DESC"); if (!c) return bad(res, 400, 'No open case'); run('UPDATE cases SET sla_start=?, sla_due=? WHERE id=?', new Date(+now() - c.sla_hours * HOUR * 0.92).toISOString(), new Date(+now() + c.sla_hours * HOUR * 0.08).toISOString(), c.id); tick(); return { ok: true, case_ref: c.ref }; }
  if (k === 'AML_ALERT') { const a = get("SELECT * FROM g2_accounts WHERE status='ACTIVE' AND account_type='CUSTOMER' ORDER BY RANDOM()"); operate(a.msisdn, 'SIM_SWAP', { operator: 'Agent shop #4412', role: 'G2' , case_ref: 'MP-SUP-SIM-' + Math.floor(Math.random() * 9999) }); operate(a.msisdn, 'PIN_RESET', { operator: 'Agent shop #4412', role: 'G2', case_ref: 'MP-SUP-PIN-' + Math.floor(Math.random() * 9999) }); addTx(a.msisdn, 'CASH_OUT', 1450, 'Agent 4412 — Kinshasa/Limete'); fraudCheck(a.msisdn); return { ok: true, msisdn: a.msisdn }; }
  if (k === 'CONTROL_EXCEPTION') { const a = get("SELECT * FROM g2_accounts WHERE status='ACTIVE' AND account_type='MERCHANT' ORDER BY RANDOM()"); operate(a.msisdn, 'SIM_SWAP', { operator: 'backoffice.user7', role: 'OPS_AGENT' }); return { ok: true, msisdn: a.msisdn }; }
  if (k === 'TICK') { tick(); return { ok: true }; }
  if (k === 'KYC_EXPIRY') { const m = normMsisdn(b.msisdn || ''); const d = get("SELECT id FROM documents WHERE account_msisdn=? AND doc_type='NATIONAL_ID' AND replaced_by IS NULL ORDER BY id DESC", m); if (!d) return bad(res, 400, 'No ID document on this account'); run('UPDATE documents SET expiry_date=? WHERE id=?', new Date(+now() + 30 * DAY - HOUR).toISOString().slice(0, 10), d.id); audit({ ...who, action: 'ID expiry brought forward for demo', entity: 'account:' + m }); tick(); return { ok: true }; }
  return bad(res, 400, 'Unknown simulation');
});
r('POST', '/api/demo/reset', 'demo.control', () => { seed(true); setSetting('seed_version', SEED_VERSION); return { ok: true }; });

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  securityHeaders(req, res);
  try {
    if (url.pathname.startsWith('/api/')) {
      const ip = clientIp(req);
      if (rateLimited('api:' + ip, 900, 60e3)) return bad(res, 429, 'Too many requests — slow down.');
      if (req.method === 'POST' && /^\/api\/(tobi\/start|login)$/.test(url.pathname) && rateLimited('burst:' + url.pathname + ip, 30, 60e3)) return bad(res, 429, 'Too many requests — slow down.');
      if (/\/upload$/.test(url.pathname) && rateLimited('up:' + ip, 40, 60e3)) return bad(res, 429, 'Too many uploads — slow down.');
      if (!csrfOk(req)) return bad(res, 403, 'Request blocked (cross-site or wrong content type).');
      for (const rt of routes) {
        if (rt.method !== req.method) continue;
        const m = url.pathname.match(rt.re); if (!m) continue;
        const user = userFromToken(cookie(req, 'sid') || (req.headers.authorization || '').replace(/^Bearer /, ''));
        if (rt.perm === 'auth' && !user) return bad(res, 401, 'Login required');
        if (rt.perm && rt.perm !== 'auth' && !can(user, rt.perm)) return bad(res, user ? 403 : 401, user ? 'Your role is not authorised' : 'Login required');
        const b = ['POST', 'PUT'].includes(req.method) ? await body(req) : {};
        const out = await rt.fn({ req, url, p: m.groups || {}, user }, b, res);
        if (!res.writableEnded) send(res, 200, out ?? null);
        return;
      }
      return bad(res, 404, 'Not found');
    }
    // static
    let fp = path.join(WEB, decodeURIComponent(url.pathname));
    if (!fp.startsWith(WEB) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) fp = path.join(WEB, 'index.html');
    res.writeHead(200, { 'content-type': MIME[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(res);
  } catch (e) { if (e instanceof HttpError) { if (!res.writableEnded) bad(res, e.code, e.message); return; } console.error(e); if (!res.writableEnded) bad(res, 500, 'Internal error — the incident was logged.'); }
});
setInterval(() => { try { tick(); } catch (e) { console.error('tick', e.message); } }, 60000);
server.listen(PORT, () => console.log(`SLA Sentinel AI running on http://localhost:${PORT}  (AI mode: ${aiEnabled() ? 'ON' : 'OFF — demo rules'})`));
