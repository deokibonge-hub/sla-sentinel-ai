// SQLite data layer (node:sqlite, built into Node >= 22.5). Relational model; portable to PostgreSQL/Prisma.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });
export const db = new DatabaseSync(path.join(DATA_DIR, 'sentinel.db'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS roles (code TEXT PRIMARY KEY, name TEXT, department TEXT);
CREATE TABLE IF NOT EXISTS permissions (role TEXT, permission TEXT, PRIMARY KEY(role, permission));
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT UNIQUE, password_hash TEXT, salt TEXT, name TEXT, role TEXT REFERENCES roles(code));
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER REFERENCES users(id), created_at TEXT);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS policies (key TEXT PRIMARY KEY, category TEXT, value TEXT, description TEXT, version INTEGER DEFAULT 1, updated_by TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS conversations (id INTEGER PRIMARY KEY, token TEXT UNIQUE, channel TEXT, msisdn TEXT, application_id INTEGER, state TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, conv_id INTEGER REFERENCES conversations(id), sender TEXT, kind TEXT, content TEXT, meta TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS applications (id INTEGER PRIMARY KEY, conv_id INTEGER, status TEXT, fields TEXT, field_sources TEXT, case_id INTEGER, created_at TEXT, updated_at TEXT, submitted_at TEXT);
CREATE TABLE IF NOT EXISTS documents (id INTEGER PRIMARY KEY, application_id INTEGER, account_msisdn TEXT, doc_type TEXT, filename TEXT, mime TEXT, path TEXT, size INTEGER, status TEXT, expiry_date TEXT, replaced_by INTEGER, uploaded_at TEXT);
CREATE TABLE IF NOT EXISTS extractions (id INTEGER PRIMARY KEY, document_id INTEGER REFERENCES documents(id), mode TEXT, doc_type TEXT, fields TEXT, confidence TEXT, raw_text TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS verifications (id INTEGER PRIMARY KEY, application_id INTEGER, check_code TEXT, label TEXT, status TEXT, declared TEXT, found TEXT, source TEXT, detail TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS cases (id INTEGER PRIMARY KEY, ref TEXT UNIQUE, type TEXT, application_id INTEGER, account_msisdn TEXT, customer_name TEXT, status TEXT, stage TEXT, owner_dept TEXT, assignee TEXT, priority TEXT, risk_score INTEGER, risk_level TEXT, sla_hours REAL, sla_start TEXT, sla_due TEXT, sla_status TEXT, resolved_at TEXT, recommendation TEXT, source TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS risk_assessments (id INTEGER PRIMARY KEY, case_id INTEGER, dimension TEXT, score INTEGER, level TEXT, factors TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS decisions (id INTEGER PRIMARY KEY, case_id INTEGER, actor TEXT, role TEXT, action TEXT, ai_action TEXT, override INTEGER, reason TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS alerts (id INTEGER PRIMARY KEY, dept TEXT, type TEXT, severity TEXT, title TEXT, detail TEXT, why TEXT, recommendation TEXT, case_ref TEXT, account_msisdn TEXT, status TEXT, owner TEXT, rule TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS audit_events (id INTEGER PRIMARY KEY, ts TEXT, actor TEXT, role TEXT, system TEXT, action TEXT, case_ref TEXT, entity TEXT, prev_state TEXT, new_state TEXT, ai_recommendation TEXT, human_decision TEXT, risk_score INTEGER, rule TEXT, override INTEGER DEFAULT 0, override_reason TEXT, evidence TEXT);
CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY, channel TEXT, recipient TEXT, title TEXT, body TEXT, case_ref TEXT, created_at TEXT, read INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS g2_accounts (msisdn TEXT PRIMARY KEY, account_type TEXT, short_code TEXT, till_number TEXT, name TEXT, trading_name TEXT, contract_type TEXT, kyc TEXT, status TEXT, balance REAL, float_balance REAL, currency TEXT, sim_iccid TEXT, pin_status TEXT, region TEXT, g2_ref TEXT, case_ref TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS g2_transactions (id INTEGER PRIMARY KEY, msisdn TEXT, tx_ref TEXT, type TEXT, amount REAL, counterparty TEXT, balance_after REAL, ts TEXT);
CREATE TABLE IF NOT EXISTS g2_operations (id INTEGER PRIMARY KEY, msisdn TEXT, op TEXT, operator TEXT, case_ref TEXT, detail TEXT, ts TEXT);
CREATE TABLE IF NOT EXISTS g2_requests (id INTEGER PRIMARY KEY, case_ref TEXT, payload TEXT, status TEXT, response TEXT, created_at TEXT, completed_at TEXT);
CREATE TABLE IF NOT EXISTS lifecycle_actions (id INTEGER PRIMARY KEY, msisdn TEXT, conv_id INTEGER, pillar TEXT, code TEXT, status TEXT, payload TEXT, due_at TEXT, sent_at TEXT, response TEXT);
CREATE TABLE IF NOT EXISTS contracts (id INTEGER PRIMARY KEY, partner TEXT, title TEXT, risk_level TEXT, clauses TEXT, status TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS integration_calls (id INTEGER PRIMARY KEY, ts TEXT, system TEXT, operation TEXT, identity TEXT, tier TEXT, case_ref TEXT, status TEXT, latency_ms INTEGER, detail TEXT);
CREATE TABLE IF NOT EXISTS guardrail_events (id INTEGER PRIMARY KEY, ts TEXT, kind TEXT, channel TEXT, conv_id INTEGER, detail TEXT, action TEXT);
`;
db.exec(SCHEMA);
// additive migrations (safe on existing databases)
const MIGRATIONS = [
  'ALTER TABLE cases ADD COLUMN conv_id INTEGER', 'ALTER TABLE cases ADD COLUMN service TEXT', 'ALTER TABLE cases ADD COLUMN team TEXT',
  'ALTER TABLE cases ADD COLUMN requester_type TEXT', 'ALTER TABLE cases ADD COLUMN reasons TEXT', 'ALTER TABLE cases ADD COLUMN details TEXT',
  'ALTER TABLE documents ADD COLUMN precheck TEXT', 'ALTER TABLE documents ADD COLUMN case_ref TEXT', 'ALTER TABLE extractions ADD COLUMN boxes TEXT', 'ALTER TABLE risk_assessments ADD COLUMN confidence INTEGER',
  'ALTER TABLE audit_events ADD COLUMN prev_hash TEXT', 'ALTER TABLE audit_events ADD COLUMN hash TEXT',
];
export function migrate() { for (const m of MIGRATIONS) { try { db.exec(m); } catch { /* column exists */ } } }
migrate();

export const j = (v, d = null) => { try { return v == null ? d : JSON.parse(v); } catch { return d; } };
export const s = (v) => JSON.stringify(v ?? null);
export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const get = (sql, ...p) => db.prepare(sql).get(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);

export function setting(key, def = null) { const r = get('SELECT value FROM settings WHERE key=?', key); return r ? j(r.value, r.value) : def; }
export function setSetting(key, value) { run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, s(value)); }
export function policy(key, def = null) { const r = get('SELECT value FROM policies WHERE key=?', key); return r ? j(r.value, def) : def; }

export function wipe() {
  const tables = all("SELECT name FROM sqlite_master WHERE type='table'").map(r => r.name);
  db.exec('PRAGMA foreign_keys=OFF;');
  for (const t of tables) db.exec(`DROP TABLE IF EXISTS ${t}`);
  db.exec('PRAGMA foreign_keys=ON;');
  db.exec(SCHEMA);
  migrate();
  const up = path.join(DATA_DIR, 'uploads');
  for (const f of fs.readdirSync(up)) fs.rmSync(path.join(up, f), { force: true });
}
