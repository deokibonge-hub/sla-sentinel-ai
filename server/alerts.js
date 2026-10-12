// Alert service: one alert per (rule, entity) while open. Alerts are the cross-department intelligence feed.
import { get, run, s } from './db.js';
import { iso, audit, notify, DEPT_NAMES } from './core.js';

export function raise({ dept, type, severity = 'MEDIUM', title, detail = '', why = [], recommendation = '', case_ref = null, account_msisdn = null, rule = null, created_at = null }) {
  const key = rule || type;
  const ent = case_ref || account_msisdn || '';
  const ex = get("SELECT id FROM alerts WHERE dept=? AND rule=? AND COALESCE(case_ref,account_msisdn,'')=? AND status IN ('OPEN','ACKNOWLEDGED')", dept, key, ent);
  if (ex) return ex.id;
  const r = run('INSERT INTO alerts(dept,type,severity,title,detail,why,recommendation,case_ref,account_msisdn,status,rule,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
    dept, type, severity, title, detail, s(why), recommendation, case_ref, account_msisdn, 'OPEN', key, created_at || iso(), created_at || iso());
  if (!created_at) {
    audit({ action: `Alert raised → ${DEPT_NAMES[dept] || dept}`, case_ref, entity: account_msisdn ? 'account:' + account_msisdn : null, new_state: title, rule: key });
    notify('IN_APP', dept, `[${severity}] ${title}`, detail, case_ref);
  }
  return r.lastInsertRowid;
}
export function resolveAlerts(where, by = 'Sentinel AI', note = 'Condition cleared') {
  const { rule, rule_like, case_ref, account_msisdn } = where;
  const cond = [], params = [by, iso()];
  if (rule) { cond.push('rule=?'); params.push(rule); }
  if (rule_like) { cond.push('rule LIKE ?'); params.push(rule_like); }
  if (case_ref) { cond.push('case_ref=?'); params.push(case_ref); }
  if (account_msisdn) { cond.push('account_msisdn=?'); params.push(account_msisdn); }
  const rows = run(`UPDATE alerts SET status='RESOLVED', owner=?, updated_at=? WHERE status IN ('OPEN','ACKNOWLEDGED') ${cond.map(c => 'AND ' + c).join(' ')}`, ...params);
  if (rows.changes) audit({ action: 'Alert(s) auto-resolved', case_ref, entity: account_msisdn ? 'account:' + account_msisdn : null, new_state: note, rule });
  return rows.changes;
}
