// Continuous lifecycle intelligence: after activation Sentinel keeps watching (transactions, documents, SLA)
// and acts through TOBi with the 4 pillars: ALERT · SUPPORT · EDUCATE · ENGAGE.
import { get, all, run, s, j, setting, setSetting, policy } from './db.js';
import { iso, now, audit, notify, nextRef, DAY, HOUR } from './core.js';
import { tobiSay, convForMsisdn } from './tobi_out.js';
import { addTx, fmtMsisdn, fraudCheck } from './g2.js';
import { raise, resolveAlerts } from './alerts.js';

export const titleName = (n) => String(n || '').toLowerCase().replace(/(^|[\s-])\p{L}/gu, (m) => m.toUpperCase());
export const QUIZ = [
  { q: 'A customer wants to deposit a large amount of cash and asks you to split it into several smaller payments. What should you do?', options: ['Split it as requested', 'Refuse politely and report it to the MLRO', 'Ask a friend to process it'], a: 1 },
  { q: 'Should you tell a customer that you are reporting their activity as suspicious?', options: ['Yes, always', 'No — never alert the customer', 'Only if they ask'], a: 1 },
  { q: 'Where do you send a Suspicious Activity Report?', options: ['To the MLRO (Compliance)', 'To the customer', 'On social media'], a: 0 },
];

export function scheduleLifecycle(msisdn, conv_id) {
  const lp = policy('lifecycle', { educate_days: 3, training_days: 4, support_days: 5, engage_days: 7 });
  const t = +now();
  const add = (pillar, code, days) => run('INSERT INTO lifecycle_actions(msisdn,conv_id,pillar,code,status,due_at) VALUES(?,?,?,?,?,?)', msisdn, conv_id, pillar, code, 'SCHEDULED', new Date(t + days * DAY).toISOString());
  add('EDUCATE', 'USAGE_TIP', lp.educate_days);
  add('EDUCATE', 'AML_TRAINING', lp.training_days);
  add('SUPPORT', 'CHECK_IN', lp.support_days);
  add('ENGAGE', 'ACTIVATION_OFFER', lp.engage_days);
  const a = get('SELECT kyc FROM g2_accounts WHERE msisdn=?', msisdn);
  const kyc = j(a?.kyc, {}); kyc.profile = kyc.profile || { daily: 0.5, avg: 9 };
  run('UPDATE g2_accounts SET kyc=? WHERE msisdn=?', s(kyc), msisdn);
  audit({ action: 'Continuous monitoring started', entity: 'account:' + msisdn, new_state: 'MONITOR', evidence: { scheduled: ['EDUCATE', 'EDUCATE', 'SUPPORT', 'ENGAGE'] } });
}

function sendAction(a) {
  const acc = get('SELECT * FROM g2_accounts WHERE msisdn=?', a.msisdn);
  if (!acc || acc.status !== 'ACTIVE') { run("UPDATE lifecycle_actions SET status='CANCELLED' WHERE id=?", a.id); return; }
  const first = titleName(String(j(acc.kyc, {}).owner_name || '').split(' ')[0]) || 'there';
  const since = new Date(now() - 7 * DAY).toISOString();
  const tx = get("SELECT COUNT(*) n, COALESCE(SUM(amount),0) v FROM g2_transactions WHERE msisdn=? AND type='PAYMENT_RECEIVED' AND ts>=?", a.msisdn, since);
  let payload = {};
  if (a.code === 'USAGE_TIP') {
    const low = tx.n < 15;
    tobiSay(a.conv_id, low
      ? `Hi ${first} 👋 I noticed you've received ${tx.n} payment${tx.n === 1 ? '' : 's'} this week. Tip: print your till QR code and stick it at the counter — customers can pay in 5 seconds by scanning it, no cash needed.`
      : `Hi ${first}! Great start — ${tx.n} payments this week. Tip: you can withdraw your takings to your bank account directly from the M-Pesa Business app.`,
      'card', { title: 'EDUCATE · Tip for your business', pillar: 'EDUCATE', rows: [['Payments (7 days)', String(tx.n)], ['Collected', `${Math.round(tx.v)} USD`], ['Till number', acc.till_number]] });
    payload = { payments_7d: tx.n, segment: low ? 'LOW_ACTIVITY' : 'ACTIVE' };
  } else if (a.code === 'AML_TRAINING') {
    tobiSay(a.conv_id, `${first}, every M-Pesa merchant completes a short AML/CFT awareness module (Law n°22/068). It takes 1 minute — 3 questions. Ready?`, 'quiz_intro', { pillar: 'EDUCATE', action_id: a.id });
  } else if (a.code === 'CHECK_IN') {
    tobiSay(a.conv_id, `Hi ${first}, it's TOBi. How is M-Pesa working for your shop so far? Do you need any help?`, 'options',
      { pillar: 'SUPPORT', action_id: a.id, options: ['Everything is fine 👍', 'I need help with payments', 'Reset my PIN', 'Talk to an agent'] });
  } else if (a.code === 'ACTIVATION_OFFER') {
    const low = tx.n < 15;
    tobiSay(a.conv_id, low
      ? `${first}, we'd like to help you grow: for the next 30 days, receiving payments on your till is FREE (0% merchant fee), and you get a free printed QR display. Want to activate it?`
      : `${first}, your shop is doing great! You're eligible for our Merchant Growth bundle: lower fees on payments above 500 USD/month. Want to activate it?`,
      'offer', { pillar: 'ENGAGE', action_id: a.id, title: low ? '30 days · 0% merchant fee' : 'Merchant Growth bundle', options: ['Activate offer', 'Not now'] });
    payload = { segment: low ? 'LOW_ACTIVITY' : 'GROWTH' };
  }
  run("UPDATE lifecycle_actions SET status='SENT', sent_at=?, payload=? WHERE id=?", iso(), s(payload), a.id);
  audit({ actor: 'Sentinel AI', system: 'TOBi', action: `${a.pillar} message sent (${a.code.replace(/_/g, ' ').toLowerCase()})`, entity: 'account:' + a.msisdn, evidence: payload });
}

export function respondLifecycle(action_id, response) {
  const a = get('SELECT * FROM lifecycle_actions WHERE id=?', action_id);
  if (!a) throw new Error('Unknown action');
  run("UPDATE lifecycle_actions SET status='RESPONDED', response=? WHERE id=?", s(response), action_id);
  audit({ actor: 'Customer', system: 'TOBi', action: `${a.pillar} response`, entity: 'account:' + a.msisdn, new_state: typeof response === 'string' ? response : s(response) });
  return a;
}

// -------- transaction simulation --------
function poisson(l) { let L = Math.exp(-l), k = 0, p = 1; do { k++; p *= Math.random(); } while (p > L); return k - 1; }
function simulateTransactions(fromMs, toMs) {
  const accs = all("SELECT * FROM g2_accounts WHERE status='ACTIVE'");
  for (const a of accs) {
    const prof = j(a.kyc, {}).profile; if (!prof) continue;
    for (let t = fromMs; t < toMs; t += DAY) {
      const n = poisson(prof.daily || 1);
      for (let i = 0; i < n; i++) {
        const ts = new Date(t + Math.random() * DAY * 0.9).toISOString();
        const amt = Math.max(1, Math.round((prof.avg || 20) * (0.4 + Math.random() * 1.2)));
        if (a.account_type === 'AGENT') addTx(a.msisdn, Math.random() < 0.5 ? 'CASH_IN' : 'CASH_OUT', amt, 'Customer ' + fmtMsisdn('2438' + Math.floor(1e8 + Math.random() * 8e8)), ts);
        else addTx(a.msisdn, 'PAYMENT_RECEIVED', amt, 'Customer ' + fmtMsisdn('2439' + Math.floor(1e8 + Math.random() * 8e8)), ts);
      }
      if (prof.structuring) for (let k = 0; k < 4; k++) addTx(a.msisdn, 'CASH_IN', 940 + Math.round(Math.random() * 55), 'Walk-in depositor', new Date(t + 3600000 * (9 + k)).toISOString());
    }
  }
}

// -------- monitoring rules --------
function createSimpleCase(type, msisdn, name, dept, hours, rec) {
  const ref = nextRef(type === 'DOCUMENT_RENEWAL' ? 'MP-REN' : type === 'SUPPORT' ? 'MP-SUP' : 'MP-CAS');
  const t0 = now();
  run(`INSERT INTO cases(ref,type,account_msisdn,customer_name,status,stage,owner_dept,priority,risk_score,risk_level,sla_hours,sla_start,sla_due,sla_status,recommendation,source,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, ref, type, msisdn, name, 'OPEN', 'ORCHESTRATE', dept, 'NORMAL', 20, 'LOW', hours, t0.toISOString(), new Date(+t0 + hours * HOUR).toISOString(), 'ON_TRACK', s(rec), 'SENTINEL', iso(), iso());
  audit({ action: `${type.replace(/_/g, ' ')} case created`, case_ref: ref, entity: 'account:' + msisdn, new_state: 'OPEN' });
  return ref;
}
export { createSimpleCase };

function documentExpiryRules() {
  const th = policy('expiry_thresholds', [90, 30, 7, 0]);
  const docs = all("SELECT d.*, g.trading_name, g.name FROM documents d JOIN g2_accounts g ON g.msisdn=d.account_msisdn WHERE d.expiry_date IS NOT NULL AND d.replaced_by IS NULL AND g.status='ACTIVE'");
  for (const d of docs) {
    const days = Math.floor((new Date(d.expiry_date) - now()) / DAY);
    const label = { NATIONAL_ID: 'ID document', RCCM: 'RCCM certificate', PROOF_OF_ADDRESS: 'proof of address' }[d.doc_type] || 'document';
    if (days > th[0]) continue;
    const stage = days < 0 ? 'EXPIRED' : days <= th[2] ? 'COMPLIANCE_AT_RISK' : days <= th[1] ? 'ACTION_REQUIRED' : 'EXPIRING_SOON';
    const sev = { EXPIRED: 'CRITICAL', COMPLIANCE_AT_RISK: 'HIGH', ACTION_REQUIRED: 'MEDIUM', EXPIRING_SOON: 'LOW' }[stage];
    const why = [{ points: days < 0 ? 40 : days <= 7 ? 30 : 20, label: days < 0 ? `${label} expired ${-days} days ago` : `${label} expires in ${days} days` }, { points: 14, label: 'KYC validity is a mandatory control' }];
    raise({ dept: 'COMPLIANCE', type: 'DOCUMENT_EXPIRY', severity: sev, title: `${stage.replace(/_/g, ' ')}: ${label} — ${d.trading_name || d.name}`, detail: `Document expiry ${d.expiry_date}.`, why, recommendation: 'Renewal requested via TOBi', account_msisdn: d.account_msisdn, rule: 'DOC_EXPIRY_' + d.id + '_' + stage });
    if (days <= th[1]) {
      raise({ dept: 'INTERNAL_CONTROL', type: 'CONTROL_EXCEPTION', severity: days < 0 ? 'HIGH' : 'MEDIUM', title: `Document validity control: ${label} ${days < 0 ? 'expired' : 'expiring'} — ${d.trading_name || d.name}`, detail: `Continuous control "Document validity" flagged ${fmtMsisdn(d.account_msisdn)}.`, why, recommendation: 'Remediation in progress (renewal case)', account_msisdn: d.account_msisdn, rule: 'CTRL_DOC_VALIDITY_' + d.id });
      if (!get("SELECT 1 FROM cases WHERE type='DOCUMENT_RENEWAL' AND account_msisdn=? AND status NOT IN ('RESOLVED','CLOSED')", d.account_msisdn)) {
        const ref = createSimpleCase('DOCUMENT_RENEWAL', d.account_msisdn, d.trading_name || d.name, 'COMPLIANCE', 24 * 30, { action: 'REQUEST_INFORMATION', reason: [`${label} renewal`], confidence: 95 });
        const conv = convForMsisdn(d.account_msisdn);
        if (conv) tobiSay(conv.id, `Action required: your ${label} ${days < 0 ? 'has expired' : `expires in ${days} days`}. To keep your M-Pesa Business account fully active, please send me a photo of the renewed document.`, 'action',
          { pillar: 'ALERT', title: 'ACTION REQUIRED', doc_type: d.doc_type, case_ref: ref, button: 'Upload updated document' });
        notify('WHATSAPP', fmtMsisdn(d.account_msisdn), 'Document expiring', `Your ${label} expires on ${d.expiry_date}. Reply to TOBi to renew.`, ref);
      }
    }
  }
}

function activityRules() {
  const merch = all("SELECT * FROM g2_accounts WHERE status='ACTIVE' AND account_type IN ('MERCHANT','AGENT')");
  for (const a of merch) {
    const age = (now() - new Date(a.created_at)) / DAY;
    if (age < 5) continue;
    const since = new Date(now() - 7 * DAY).toISOString();
    const n = get('SELECT COUNT(*) n FROM g2_transactions WHERE msisdn=? AND ts>=?', a.msisdn, since).n;
    if (n < 6) {
      const prob = Math.min(95, 60 + (6 - n) * 6);
      raise({ dept: 'RISK', type: 'INACTIVITY_PREDICTED', severity: 'MEDIUM', title: `Inactivity predicted: ${a.trading_name || a.name}`, detail: `${n} transactions in 7 days. Probability of becoming dormant within 60 days: ${prob}%. (Dormant numbers are recycled after 6 months.)`,
        why: [{ points: 35, label: `Only ${n} transactions in the last 7 days` }, { points: 20, label: `Account age ${Math.round(age)} days — critical activation window` }, { points: 10, label: 'Below segment median activity' }], recommendation: 'ENGAGE: activation offer via TOBi', account_msisdn: a.msisdn, rule: 'RISK_INACTIVITY' });
    } else resolveAlerts({ rule: 'RISK_INACTIVITY', account_msisdn: a.msisdn });
    // structuring: ≥3 cash-ins between 900 and 999 within 24h
    const s24 = new Date(now() - DAY).toISOString();
    const st = get("SELECT COUNT(*) n, SUM(amount) t FROM g2_transactions WHERE msisdn=? AND type='CASH_IN' AND amount BETWEEN 900 AND 999 AND ts>=?", a.msisdn, s24);
    if (st.n >= 3) raise({ dept: 'AML', type: 'AML_ALERT', severity: 'HIGH', title: `Possible structuring: ${a.trading_name || a.name}`, detail: `${st.n} cash-ins just below 1,000 USD in 24h (total ${Math.round(st.t)} USD).`,
      why: [{ points: 35, label: `${st.n} deposits between 900–999 USD` }, { points: 25, label: 'Pattern consistent with threshold avoidance' }, { points: 12, label: 'Same-day concentration' }], recommendation: 'Enhanced due diligence; consider SAR to MLRO', account_msisdn: a.msisdn, rule: 'AML_STRUCTURING' });
    fraudCheck(a.msisdn);
  }
}

function slaRules() {
  const open = all("SELECT * FROM cases WHERE status NOT IN ('RESOLVED','REJECTED','CLOSED') AND sla_due IS NOT NULL");
  for (const c of open) {
    const total = new Date(c.sla_due) - new Date(c.sla_start), frac = (now() - new Date(c.sla_start)) / total;
    const st = frac > 1 ? 'BREACHED' : frac > 0.9 ? 'CRITICAL' : frac > 0.65 ? 'AT_RISK' : 'ON_TRACK';
    if (st !== c.sla_status) run('UPDATE cases SET sla_status=? WHERE id=?', st, c.id);
    if (st === 'AT_RISK' || st === 'CRITICAL' || st === 'BREACHED') {
      const prob = st === 'BREACHED' ? 100 : Math.round(100 / (1 + Math.exp(-10 * (frac - 0.72))));
      const rem = Math.round((new Date(c.sla_due) - now()) / 60000);
      raise({ dept: 'OPERATIONS', type: 'SLA', severity: st === 'BREACHED' ? 'CRITICAL' : st === 'CRITICAL' ? 'HIGH' : 'MEDIUM', title: `SLA ${st.replace('_', ' ')}: ${c.ref} (${c.customer_name})`,
        detail: st === 'BREACHED' ? `Breached by ${Math.abs(Math.round(rem / 60))} h.` : `Breach probability ${prob}% · ${rem > 120 ? Math.round(rem / 60) + ' h' : rem + ' min'} remaining · owner ${c.owner_dept}.`,
        why: [{ points: Math.round(frac * 50), label: `${Math.round(frac * 100)}% of SLA consumed` }, { points: 15, label: `Stage: ${c.stage}` }, { points: 10, label: `Queue: ${c.owner_dept}` }], recommendation: st === 'BREACHED' ? 'Escalate to Operations Manager' : 'PRIORITIZE NOW', case_ref: c.ref, rule: 'SLA_' + st });
    }
  }
}

// Simulated back-office activity during time travel: teams keep working the seeded queue, new requests keep arriving.
function simulateBackOffice(fromMs, toMs) {
  const open = all("SELECT * FROM cases WHERE source='SEED' AND status NOT IN ('RESOLVED','REJECTED','CLOSED')");
  for (const c of open) {
    const st = +new Date(c.sla_start), due = +new Date(c.sla_due), h = due - st;
    const doneAt = st + h * (0.35 + Math.random() * 0.6);
    if (doneAt <= toMs && Math.random() < 0.88) {
      const at = Math.max(doneAt, fromMs);
      run("UPDATE cases SET status='RESOLVED', stage='RESOLVE', resolved_at=?, sla_status=?, updated_at=? WHERE id=?", new Date(at).toISOString(), at <= due ? 'MET' : 'BREACHED', new Date(at).toISOString(), c.id);
      resolveAlerts({ case_ref: c.ref }, 'Operations team', 'Case resolved');
    }
  }
  const days = Math.floor((toMs - fromMs) / DAY);
  const tpl = all("SELECT * FROM cases WHERE source='SEED' ORDER BY RANDOM() LIMIT ?", Math.min(60, days * 6));
  tpl.forEach((t, i) => {
    const created = fromMs + Math.random() * (toMs - fromMs), h = t.sla_hours * HOUR;
    const frac = (toMs - created) / h, res = frac > 0.5 && Math.random() < 0.85;
    const resAt = res ? created + h * (0.3 + Math.random() * 0.6) : null;
    const pre = t.ref.split('-').slice(0, 2).join('-');
    const ref = `${pre}-2026-${String(5000 + Math.floor(Math.random() * 90000)).padStart(6, '0')}`;
    if (get('SELECT 1 FROM cases WHERE ref=?', ref)) return;
    run(`INSERT INTO cases(ref,type,account_msisdn,customer_name,status,stage,owner_dept,priority,risk_score,risk_level,sla_hours,sla_start,sla_due,sla_status,resolved_at,recommendation,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ref, t.type, t.account_msisdn, t.customer_name, res ? 'RESOLVED' : 'PENDING_REVIEW', res ? 'RESOLVE' : 'DECIDE', t.owner_dept, t.priority, t.risk_score, t.risk_level, t.sla_hours, new Date(created).toISOString(), new Date(created + h).toISOString(), res ? 'MET' : 'ON_TRACK', resAt ? new Date(resAt).toISOString() : null, t.recommendation, 'SEED', new Date(created).toISOString(), new Date(resAt || created).toISOString());
  });
}

export function tick(fromMs = null) {
  const last = Number(setting('last_tick_ms', 0)) || +now();
  const to = +now();
  if (to - last > HOUR) { simulateTransactions(fromMs ?? last, to); simulateBackOffice(fromMs ?? last, to); }
  for (const a of all("SELECT * FROM lifecycle_actions WHERE status='SCHEDULED' AND due_at<=? ORDER BY due_at", iso())) sendAction(a);
  documentExpiryRules(); activityRules(); slaRules();
  setSetting('last_tick_ms', to);
}

// renewal upload from an active merchant
export function handleRenewal(msisdn, doc, extracted) {
  const ren = get("SELECT * FROM cases WHERE type='DOCUMENT_RENEWAL' AND account_msisdn=? AND status NOT IN ('RESOLVED','CLOSED') ORDER BY id DESC", msisdn);
  const exp = extracted.fields.id_expiry || extracted.fields.expiry_date;
  const old = get("SELECT * FROM documents WHERE account_msisdn=? AND doc_type=? AND replaced_by IS NULL AND id!=? ORDER BY id", msisdn, extracted.doc_type, doc.id);
  run('UPDATE documents SET account_msisdn=? WHERE id=?', msisdn, doc.id);
  const valid = exp && (new Date(exp) - now()) / DAY > 90;
  if (!valid) return { ok: false, reason: exp ? `This document expires on ${exp} — please send the renewed one.` : 'I could not read an expiry date on this document.' };
  if (old) run('UPDATE documents SET replaced_by=? WHERE id=?', doc.id, old.id);
  const acc = get('SELECT kyc FROM g2_accounts WHERE msisdn=?', msisdn); const kyc = j(acc?.kyc, {});
  if (extracted.fields.id_number) kyc.id_number = extracted.fields.id_number; kyc.id_expiry = exp;
  run('UPDATE g2_accounts SET kyc=?, updated_at=? WHERE msisdn=?', s(kyc), iso(), msisdn);
  audit({ actor: 'Sentinel AI', action: 'Document verified → record updated', case_ref: ren?.ref, entity: 'account:' + msisdn, new_state: `New expiry ${exp}` });
  if (ren) { run("UPDATE cases SET status='RESOLVED', stage='LEARN', resolved_at=?, sla_status='MET' WHERE id=?", iso(), ren.id); audit({ action: 'Exception closed — compliance restored', case_ref: ren.ref, new_state: 'RESOLVED' }); }
  resolveAlerts({ account_msisdn: msisdn, rule_like: 'DOC_EXPIRY_%' }, 'Sentinel AI', 'Document renewed');
  resolveAlerts({ account_msisdn: msisdn, rule_like: 'CTRL_DOC_VALIDITY_%' }, 'Sentinel AI', 'Document renewed');
  setSetting('noncompliance_prevented', (Number(setting('noncompliance_prevented', 0)) || 0) + 1);
  return { ok: true, expiry: exp, case_ref: ren?.ref };
}
