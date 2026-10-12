// Clock (demo time travel), audit trail, auth/RBAC, notifications.
import crypto from 'node:crypto';
import { get, run, all, setting, setSetting, s } from './db.js';

// ---------- clock ----------
export function now() { const off = Number(setting('clock_offset_ms', 0)) || 0; return new Date(Date.now() + off); }
export const iso = (d = now()) => d.toISOString();
export function advanceClock(ms) { setSetting('clock_offset_ms', (Number(setting('clock_offset_ms', 0)) || 0) + ms); }
export const DAY = 86400000, HOUR = 3600000;

// ---------- audit ----------
export function audit(e) {
  run(`INSERT INTO audit_events(ts,actor,role,system,action,case_ref,entity,prev_state,new_state,ai_recommendation,human_decision,risk_score,rule,override,override_reason,evidence)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    iso(), e.actor || 'Sentinel AI', e.role || 'SYSTEM', e.system || 'SENTINEL', e.action, e.case_ref || null, e.entity || null,
    e.prev_state || null, e.new_state || null, e.ai || null, e.human || null, e.risk ?? null, e.rule || null, e.override ? 1 : 0, e.override_reason || null, s(e.evidence || null));
  sealAudit();
}
// Tamper-evident audit trail: each event stores sha256(previous hash + its own content).
const AUDIT_COLS = ['ts', 'actor', 'role', 'system', 'action', 'case_ref', 'entity', 'prev_state', 'new_state', 'ai_recommendation', 'human_decision', 'risk_score', 'rule', 'override', 'override_reason', 'evidence'];
export const auditHash = (prev, row) => crypto.createHash('sha256').update((prev || 'GENESIS') + '|' + AUDIT_COLS.map(c => row[c] ?? '').join('|')).digest('hex');
export function sealAudit() {
  const rows = all('SELECT * FROM audit_events WHERE hash IS NULL ORDER BY id');
  if (!rows.length) return 0;
  let prev = get('SELECT hash FROM audit_events WHERE hash IS NOT NULL AND id < ? ORDER BY id DESC LIMIT 1', rows[0].id)?.hash || null;
  for (const r of rows) { const h = auditHash(prev, r); run('UPDATE audit_events SET prev_hash=?, hash=? WHERE id=?', prev, h, r.id); prev = h; }
  return rows.length;
}
export function verifyAudit() {
  let prev = null, n = 0;
  for (const r of all('SELECT * FROM audit_events ORDER BY id')) {
    if (r.prev_hash !== prev || auditHash(prev, r) !== r.hash) return { ok: false, checked: n, broken_at: r.id };
    prev = r.hash; n++;
  }
  return { ok: true, checked: n, head: prev };
}

// ---------- notifications ----------
export function notify(channel, recipient, title, body, case_ref = null) {
  run('INSERT INTO notifications(channel,recipient,title,body,case_ref,created_at) VALUES(?,?,?,?,?,?)', channel, recipient, title, body, case_ref, iso());
}

// ---------- auth / RBAC ----------
export const ROLES = {
  OPS_AGENT: { name: 'Operations Agent', dept: 'OPERATIONS' },
  OPS_MANAGER: { name: 'Operations Manager', dept: 'OPERATIONS' },
  AML_OFFICER: { name: 'AML/CFT Officer', dept: 'AML' },
  COMPLIANCE_OFFICER: { name: 'Compliance Officer', dept: 'COMPLIANCE' },
  RISK_MANAGER: { name: 'Risk Manager', dept: 'RISK' },
  IC_OFFICER: { name: 'Internal Control Officer', dept: 'INTERNAL_CONTROL' },
  LEGAL_OFFICER: { name: 'Legal Officer', dept: 'LEGAL' },
  AUDITOR: { name: 'Internal Auditor', dept: 'AUDIT' },
  ADMIN: { name: 'Administrator', dept: 'ADMIN' },
};
export const PERMS = {
  OPS_AGENT: ['dashboard.view', 'case.view', 'case.decide', 'case.request_info', 'case.escalate', 'g2.view', 'g2.operate', 'g2.create', 'alert.act'],
  OPS_MANAGER: ['dashboard.view', 'case.view', 'case.decide', 'case.reject', 'case.request_info', 'case.escalate', 'case.assign', 'g2.view', 'g2.operate', 'g2.create', 'g2.delete', 'alert.act'],
  AML_OFFICER: ['dashboard.view', 'case.view', 'case.decide_aml', 'case.escalate', 'aml.edd', 'g2.view', 'alert.act'],
  COMPLIANCE_OFFICER: ['dashboard.view', 'case.view', 'case.request_info', 'case.escalate', 'remediation.initiate', 'alert.act'],
  RISK_MANAGER: ['dashboard.view', 'case.view', 'case.escalate', 'risk.mitigate', 'alert.act'],
  IC_OFFICER: ['dashboard.view', 'case.view', 'case.escalate', 'remediation.initiate', 'control.close', 'g2.view', 'alert.act'],
  LEGAL_OFFICER: ['dashboard.view', 'case.view', 'legal.review', 'case.escalate', 'alert.act'],
  AUDITOR: ['dashboard.view', 'case.view', 'audit.view', 'audit.flag', 'audit.export', 'g2.view'],
  ADMIN: ['dashboard.view', 'case.view', 'policy.manage', 'demo.control', 'user.manage', 'audit.view', 'g2.view', 'g2.operate', 'g2.delete', 'alert.act'],
};
export function can(user, perm) { return !!user && (PERMS[user.role] || []).includes(perm); }

export function hashPw(pw, salt = crypto.randomBytes(8).toString('hex')) {
  return { salt, hash: crypto.scryptSync(pw, salt, 32).toString('hex') };
}
// Tolerant login for the demo: username, full name or role name (any case, extra spaces ignored).
export function findUser(username) {
  const key = String(username || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!key) return null;
  const flat = key.replace(/[\s._/-]/g, '');
  return get('SELECT * FROM users WHERE username=?', key) || get('SELECT * FROM users WHERE username=?', flat)
    || get('SELECT * FROM users WHERE lower(name)=?', key)
    || all('SELECT * FROM users').find(u => { const rn = (ROLES[u.role]?.name || '').toLowerCase(); return rn === key || rn.replace(/[\s/._-]/g, '') === flat || u.role.toLowerCase().replace(/_/g, '') === flat; }) || null;
}
export function login(username, password) {
  const u = findUser(username);
  if (!u) return null;
  const { hash } = hashPw(String(password ?? '').trim(), u.salt);
  if (!crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(u.password_hash))) return null;
  const token = crypto.randomBytes(24).toString('hex');
  run('INSERT INTO sessions(token,user_id,created_at) VALUES(?,?,?)', token, u.id, new Date().toISOString());
  audit({ actor: u.name, role: u.role, action: 'User login', entity: 'user:' + u.username });
  return { token, user: publicUser(u) };
}
export function userFromToken(token) {
  if (!token) return null;
  const u = get('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?', token);
  return u ? publicUser(u) : null;
}
export function publicUser(u) { return { id: u.id, username: u.username, name: u.name, role: u.role, roleName: ROLES[u.role]?.name, dept: ROLES[u.role]?.dept, perms: PERMS[u.role] || [] }; }
export function logout(token) { run('DELETE FROM sessions WHERE token=?', token); }

export const DEPTS = ['OPERATIONS', 'AML', 'COMPLIANCE', 'RISK', 'INTERNAL_CONTROL', 'LEGAL', 'AUDIT'];
export const DEPT_NAMES = { OPERATIONS: 'Operations', AML: 'AML / CFT', COMPLIANCE: 'Compliance', RISK: 'Risk Management', INTERNAL_CONTROL: 'Internal Control', LEGAL: 'Legal', AUDIT: 'Internal Audit' };

export function nextRef(prefix) {
  const y = now().getUTCFullYear();
  const key = 'seq_global';
  const n = (Number(setting(key, 1240)) || 1240) + 1; setSetting(key, n);
  return `${prefix}-${y}-${String(n).padStart(6, '0')}`;
}
export const rid = (n = 6) => String(Math.floor(Math.random() * 10 ** n)).padStart(n, '0');

// Self-heal demo accounts at startup: every demo user exists and accepts "demo123".
export function ensureDemoUsers(USERS) {
  for (const [u, n, r] of USERS) {
    const row = get('SELECT * FROM users WHERE username=?', u);
    const ok = row && crypto.timingSafeEqual(Buffer.from(hashPw('demo123', row.salt).hash), Buffer.from(row.password_hash));
    if (!row) { const { hash, salt } = hashPw('demo123'); run('INSERT INTO users(username,password_hash,salt,name,role) VALUES(?,?,?,?,?)', u, hash, salt, n, r); }
    else if (!ok) { const { hash, salt } = hashPw('demo123'); run('UPDATE users SET password_hash=?, salt=? WHERE username=?', hash, salt, u); }
  }
}
