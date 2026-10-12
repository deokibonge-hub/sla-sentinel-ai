// G2 SIMULATOR — stands in for the internal platform that creates and operates customer / merchant / agent accounts.
// Sentinel talks to it only through this adapter (createAccount, operate, transactions).
import { callSystem } from './trust.js';
import { get, all, run, s, j, setting, setSetting } from './db.js';
import { iso, now, audit, rid, DAY, HOUR } from './core.js';
import { raise } from './alerts.js';

export const normMsisdn = (v) => {
  let d = String(v || '').replace(/[^\d]/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('0')) d = '243' + d.slice(1);
  if (d.length === 9) d = '243' + d;
  return d;
};
export const fmtMsisdn = (m) => { const d = normMsisdn(m); return d.length === 12 ? `+${d.slice(0, 3)} ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8)}` : m; };

export function account(msisdn) {
  const a = get('SELECT * FROM g2_accounts WHERE msisdn=? OR short_code=? OR till_number=?', normMsisdn(msisdn) || msisdn, msisdn, msisdn);
  return a ? { ...a, kyc: j(a.kyc, {}) } : null;
}

// ---- creation (called by Sentinel orchestration) ----
export function createAccount({ case_ref, type = 'MERCHANT', fields, documents = [] }) {
  const req = run('INSERT INTO g2_requests(case_ref,payload,status,created_at) VALUES(?,?,?,?)', case_ref, s({ type, fields, documents: documents.map(d => d.id) }), 'PROCESSING', iso());
  audit({ actor: 'Sentinel AI', system: 'SENTINEL', action: 'Creation request → G2', case_ref, new_state: 'PROCESSING' });
  if (setting('g2_fail_next', false)) {
    setSetting('g2_fail_next', false);
    const resp = { ok: false, error: 'G2-ERR-503 Upstream timeout while provisioning till number' };
    run('UPDATE g2_requests SET status=?, response=?, completed_at=? WHERE id=?', 'FAILED', s(resp), iso(), req.lastInsertRowid);
    audit({ actor: 'G2 Simulator', system: 'G2', action: 'Account creation FAILED', case_ref, new_state: resp.error });
    return resp;
  }
  const msisdn = normMsisdn(fields.phone);
  if (get('SELECT 1 FROM g2_accounts WHERE msisdn=? AND status!=?', msisdn, 'DELETED')) {
    const resp = { ok: false, error: `G2-ERR-409 MSISDN ${fmtMsisdn(msisdn)} already registered` };
    run('UPDATE g2_requests SET status=?, response=?, completed_at=? WHERE id=?', 'FAILED', s(resp), iso(), req.lastInsertRowid);
    audit({ actor: 'G2 Simulator', system: 'G2', action: 'Account creation FAILED', case_ref, new_state: resp.error });
    return resp;
  }
  const short_code = String(700000 + Math.floor(Math.random() * 299999));
  const till = String(100000 + Math.floor(Math.random() * 899999));
  let merchant_id; do { merchant_id = type === 'AGENT' ? 'AGT-' + rid(6) : '0' + rid(6); } while (get('SELECT 1 FROM g2_accounts WHERE kyc LIKE ?', `%"merchant_id":"${merchant_id}"%`));
  const merchant_sim = '24381' + String(5000000 + Math.floor(Math.random() * 4999999)); // dedicated demo SIM for the till
  const g2_ref = 'G2-CR-' + rid(6);
  run(`INSERT INTO g2_accounts(msisdn,account_type,short_code,till_number,name,trading_name,contract_type,kyc,status,balance,float_balance,currency,sim_iccid,pin_status,region,g2_ref,case_ref,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    msisdn, type, short_code, till, fields.legal_name, fields.trading_name, fields.contract_type, s({ ...fields, merchant_id, merchant_sim, sim_pickup: 'Vodacom Park, Gombe — within 48 hours' }), 'ACTIVE', 0, 0, 'USD',
    '8924301' + rid(12), 'SET', fields.city || 'Kinshasa', g2_ref, case_ref, iso(), iso());
  for (const d of documents) run('UPDATE documents SET account_msisdn=? WHERE id=?', msisdn, d.id);
  run('INSERT INTO g2_operations(msisdn,op,operator,case_ref,detail,ts) VALUES(?,?,?,?,?,?)', msisdn, 'ACCOUNT_CREATED', 'Sentinel API', case_ref, `${type} ${merchant_id}`, iso());
  const resp = { ok: true, msisdn, merchant_id, merchant_sim, short_code, till_number: till, g2_ref, created_at: iso() };
  run('UPDATE g2_requests SET status=?, response=?, completed_at=? WHERE id=?', 'COMPLETED', s(resp), iso(), req.lastInsertRowid);
  audit({ actor: 'G2 Simulator', system: 'G2', action: `${type === 'AGENT' ? 'Agent' : 'Merchant'} created`, case_ref, new_state: `${merchant_id} · ${g2_ref}` });
  return resp;
}

// ---- operations (G2 back-office screen or Sentinel) ----
const SENSITIVE = new Set(['SIM_SWAP', 'PIN_RESET', 'DELETE', 'SUSPEND']);
export function operate(msisdn, op, { operator, role, case_ref = null, detail = {} } = {}) {
  const a = account(msisdn);
  if (!a) throw new Error('Account not found');
  if (a.status === 'DELETED') throw new Error('Account is deleted');
  callSystem(op === 'SIM_SWAP' ? 'ICAP' : /UNBLOCK/.test(op) ? 'IRM' : 'G2', op === 'SIM_SWAP' ? 'sim.swap' : 'op.' + String(op).toLowerCase(), { case_ref, identity: /Sentinel/.test(operator || '') ? 'bot-g2-provisioning' : 'staff:' + (role || operator || 'unknown') });
  let desc = '';
  if (op === 'SIM_SWAP') { const iccid = '8924301' + rid(12); run('UPDATE g2_accounts SET sim_iccid=?, updated_at=? WHERE msisdn=?', iccid, iso(), a.msisdn); desc = `SIM swapped → ICCID ${iccid}`; }
  else if (op === 'PIN_RESET') { run("UPDATE g2_accounts SET pin_status='RESET_PENDING', updated_at=? WHERE msisdn=?", iso(), a.msisdn); desc = 'PIN reset — temporary PIN sent by SMS'; }
  else if (op === 'SUSPEND') { run("UPDATE g2_accounts SET status='SUSPENDED', updated_at=? WHERE msisdn=?", iso(), a.msisdn); desc = 'Account suspended'; }
  else if (op === 'REACTIVATE') { run("UPDATE g2_accounts SET status='ACTIVE', updated_at=? WHERE msisdn=?", iso(), a.msisdn); desc = 'Account reactivated'; }
  else if (op === 'DELETE') { run("UPDATE g2_accounts SET status='DELETED', updated_at=? WHERE msisdn=?", iso(), a.msisdn); desc = 'Account deleted'; }
  else if (op === 'FLOAT_TOPUP') { const amt = Number(detail.amount) || 500; addTx(a.msisdn, 'FLOAT_TOPUP', amt, 'Super agent float'); desc = `Float top-up ${amt} USD`; }
  else throw new Error('Unknown operation');
  run('INSERT INTO g2_operations(msisdn,op,operator,case_ref,detail,ts) VALUES(?,?,?,?,?,?)', a.msisdn, op, operator, case_ref, desc, iso());
  audit({ actor: operator, role, system: 'G2', action: `G2 ${op.replace('_', ' ')}`, case_ref, entity: 'account:' + a.msisdn, new_state: desc });
  // Continuous control monitoring: sensitive operation without a supporting case
  if (SENSITIVE.has(op) && !case_ref) {
    raise({ dept: 'INTERNAL_CONTROL', type: 'CONTROL_EXCEPTION', severity: op === 'DELETE' ? 'HIGH' : 'MEDIUM', title: `G2 ${op.replace('_', ' ')} performed without a case`,
      detail: `${operator} performed ${op.replace('_', ' ')} on ${fmtMsisdn(a.msisdn)} (${a.trading_name || a.name}) with no supporting request or approval.`,
      why: [{ points: 40, label: 'Sensitive G2 operation' }, { points: 35, label: 'No case / ticket reference' }, { points: op === 'DELETE' ? 20 : 10, label: 'Maker-checker not evidenced' }],
      recommendation: 'Obtain evidence (customer request, signature specimen) or reverse the operation', account_msisdn: a.msisdn, rule: 'CTRL_G2_OP_NO_CASE_' + op });
  }
  if (op === 'SIM_SWAP' || op === 'PIN_RESET') fraudCheck(a.msisdn);
  return account(a.msisdn);
}

export function addTx(msisdn, type, amount, counterparty, ts = null) {
  const a = get('SELECT balance, float_balance, account_type FROM g2_accounts WHERE msisdn=?', msisdn);
  const credit = ['CASH_IN', 'PAYMENT_RECEIVED', 'P2P_RECEIVE', 'FLOAT_TOPUP'].includes(type);
  const bal = Math.max(0, Math.round(((a?.balance || 0) + (credit ? amount : -amount)) * 100) / 100);
  run('UPDATE g2_accounts SET balance=? WHERE msisdn=?', bal, msisdn);
  run('INSERT INTO g2_transactions(msisdn,tx_ref,type,amount,counterparty,balance_after,ts) VALUES(?,?,?,?,?,?,?)', msisdn, 'TX' + rid(9), type, amount, counterparty, bal, ts || iso());
}

// SIM swap + PIN reset + large cash-out within 24h → AML & Risk (account takeover pattern)
export function fraudCheck(msisdn) {
  const since = new Date(now() - DAY).toISOString();
  const ops = all('SELECT op FROM g2_operations WHERE msisdn=? AND ts>=?', msisdn, since).map(r => r.op);
  const big = get("SELECT SUM(amount) t FROM g2_transactions WHERE msisdn=? AND ts>=? AND type IN ('CASH_OUT','P2P_SEND')", msisdn, since)?.t || 0;
  if (ops.includes('SIM_SWAP') && ops.includes('PIN_RESET') && big >= 800) {
    const a = account(msisdn);
    const why = [{ points: 30, label: 'SIM swap in last 24h' }, { points: 25, label: 'PIN reset in last 24h' }, { points: 25, label: `Cash-out ${Math.round(big)} USD right after` }, { points: 12, label: 'Pattern matches account-takeover typology' }];
    raise({ dept: 'AML', type: 'AML_ALERT', severity: 'CRITICAL', title: 'Possible account takeover: SIM swap → PIN reset → cash-out', detail: `${a.trading_name || a.name} (${fmtMsisdn(msisdn)}) — ${Math.round(big)} USD moved out within 24h of SIM swap and PIN reset.`, why, recommendation: 'Freeze outgoing transactions, contact the customer on a verified channel, file SAR if confirmed', account_msisdn: msisdn, rule: 'AML_ATO_PATTERN' });
    raise({ dept: 'RISK', type: 'FRAUD_RISK', severity: 'HIGH', title: 'Fraud risk spike: account takeover pattern', detail: `Fraud risk 92/100 on ${fmtMsisdn(msisdn)}.`, why, recommendation: 'Review SIM swap controls for this channel', account_msisdn: msisdn, rule: 'RISK_ATO_PATTERN' });
  }
}

export function txSummary(msisdn, days = 30) {
  const since = new Date(now() - days * DAY).toISOString();
  const r = get("SELECT COUNT(*) n, COALESCE(SUM(CASE WHEN type IN ('PAYMENT_RECEIVED','CASH_IN','P2P_RECEIVE') THEN amount END),0) inflow FROM g2_transactions WHERE msisdn=? AND ts>=?", msisdn, since);
  const last = get('SELECT MAX(ts) ts FROM g2_transactions WHERE msisdn=?', msisdn)?.ts;
  return { count: r.n, inflow: Math.round(r.inflow), last_tx: last };
}
