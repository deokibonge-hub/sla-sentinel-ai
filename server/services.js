// Service catalogue: what TOBi can open for a customer, with SLA target, owning team, required data and documents.
import { get, all, run, s, j } from './db.js';
import { iso, now, audit, notify, nextRef, HOUR, DAY, DEPT_NAMES } from './core.js';
import { normMsisdn, fmtMsisdn, operate, account } from './g2.js';
import { raise } from './alerts.js';

export const CLIENT_TYPES = ['Customer', 'Merchant', 'Agent', 'Super Agent', 'Partner', 'Vendor', 'Enterprise'];

// sla: { h } calendar hours or { bd } business days (Mon–Fri)
export const SERVICES = {
  MERCHANT_CREATION: { label: 'Merchant Account Creation', sla: { h: 48 }, dept: 'OPERATIONS', team: 'M-Pesa Merchant Operations', prefix: 'MP-ONB', group: 'M-Pesa' },
  SIM_CREATION: { label: 'SIM Creation', sla: { h: 72 }, dept: 'OPERATIONS', team: 'Customer Operations', prefix: 'MP-SIM', group: 'M-Pesa', fields: ['requester_type', 'full_name', 'id_number', 'sim_type', 'city'], docs: ['NATIONAL_ID'] },
  SIM_SWAP: { label: 'SIM Swap', sla: { h: 48 }, dept: 'OPERATIONS', team: 'Customer Operations', prefix: 'MP-SWP', group: 'M-Pesa', fields: ['requester_type', 'full_name', 'msisdn', 'id_number', 'swap_reason'], docs: ['NATIONAL_ID'] },
  PIN_RESET: { label: 'Reset PIN', sla: { h: 24 }, dept: 'OPERATIONS', team: 'Customer Operations', prefix: 'MP-PIN', group: 'M-Pesa', fields: ['requester_type', 'full_name', 'msisdn', 'id_number'] },
  CASH_OUT_REVERSAL: { label: 'Cash-out Reversal', sla: { h: 48 }, dept: 'OPERATIONS', team: 'M-Pesa Reversals Desk', prefix: 'MP-REV', group: 'M-Pesa', fields: ['requester_type', 'full_name', 'msisdn', 'tx_ref', 'amount', 'counterparty', 'reversal_reason'] },
  CASH_IN_REVERSAL: { label: 'Cash-in Reversal', sla: { h: 48 }, dept: 'OPERATIONS', team: 'M-Pesa Reversals Desk', prefix: 'MP-REV', group: 'M-Pesa', fields: ['requester_type', 'full_name', 'msisdn', 'tx_ref', 'amount', 'counterparty', 'reversal_reason'] },
  PARTNER_ONBOARDING: { label: 'Partner Onboarding', sla: { bd: 5 }, dept: 'OPERATIONS', team: 'VBU Partnerships', prefix: 'MP-PRT', group: 'Partners', fields: ['requester_type', 'company_name', 'rccm', 'contact_name', 'msisdn', 'email', 'partnership_type'], docs: ['RCCM', 'NATIONAL_ID'] },
  ENTERPRISE_DATA: { label: 'Enterprise Data Bundles', sla: { h: 72 }, ebu: true },
  CLOSED_USER_GROUP: { label: 'Closed User Group', sla: { h: 72 }, ebu: true },
  PUBLIC_CLOUD: { label: 'Public Cloud', sla: { bd: 5 }, ebu: true },
  PRIVATE_CLOUD: { label: 'Private Cloud', sla: { bd: 5 }, ebu: true },
  SERVER_HOSTING: { label: 'Server Hosting', sla: { bd: 5 }, ebu: true },
  FLEET_MANAGEMENT: { label: 'Vehicle Fleet Management', sla: { bd: 5 }, ebu: true },
  VOICE: { label: 'Mobile and Fixed Voice', sla: { h: 72 }, ebu: true },
  MOBILE_INTERNET: { label: 'Mobile Internet', sla: { h: 72 }, ebu: true },
  FIBER_INTERNET: { label: 'Fiber Internet', sla: { bd: 5 }, ebu: true },
};
for (const v of Object.values(SERVICES)) if (v.ebu) Object.assign(v, { dept: 'OPERATIONS', team: 'Enterprise Business Unit (EBU)', prefix: 'EBU', group: 'Business solutions', fields: ['company_name', 'contact_name', 'msisdn', 'email', 'city', 'need'] });

export const SFIELDS = {
  requester_type: { q: 'Are you requesting as a…', options: CLIENT_TYPES, label: 'Client type' },
  full_name: { q: 'What is your full name (as on your ID)?', label: 'Full name' },
  msisdn: { q: 'Which M-Pesa number is concerned? (e.g. +243 81 234 5678)', label: 'M-Pesa number' },
  id_number: { q: 'What is your ID document number?', label: 'ID number' },
  swap_reason: { q: 'Why do you need a SIM swap?', options: ['Lost SIM', 'Stolen phone', 'Damaged SIM', 'Upgrade to 4G/eSIM'], label: 'Reason' },
  sim_type: { q: 'What kind of SIM do you need?', options: ['Individual line', 'Merchant line', 'Agent line'], label: 'SIM type' },
  city: { q: 'In which city/province?', label: 'City' },
  tx_ref: { q: 'What is the transaction reference (from your SMS, e.g. TX123456789)?', label: 'Transaction ID' },
  amount: { q: 'What amount (USD)?', label: 'Amount (USD)' },
  counterparty: { q: 'To/from which number or agent was it sent?', label: 'Counterparty' },
  reversal_reason: { q: 'What happened?', options: ['Sent to wrong number', 'Wrong amount', 'Duplicate transaction', 'Agent error'], label: 'Reason' },
  company_name: { q: 'What is the company name?', label: 'Company' },
  rccm: { q: 'What is the RCCM number?', label: 'RCCM' },
  contact_name: { q: 'Who is the contact person?', label: 'Contact person' },
  email: { q: 'Which email should we use?', label: 'Email' },
  partnership_type: { q: 'Which partnership?', options: ['Super Agent', 'Aggregator / Distributor', 'Vendor / Supplier', 'Biller / Payment partner'], label: 'Partnership type' },
  need: { q: 'Tell me briefly what you need (sites, number of users, bandwidth…).', label: 'Need' },
};

export function validateSField(key, raw) {
  const v = String(raw ?? '').trim().replace(/[.!]+$/, '');
  if (!v) return null;
  const f = SFIELDS[key];
  if (f?.options) { const o = f.options.find(x => x.toLowerCase() === v.toLowerCase()) || f.options.find(x => v.toLowerCase().includes(x.toLowerCase().split(' ')[0])); return o || (key === 'requester_type' ? null : v); }
  if (key === 'msisdn' || key === 'counterparty') { const d = normMsisdn(v); if (d.length === 12) return fmtMsisdn(d); return key === 'counterparty' && v.length >= 3 ? v : null; }
  if (key === 'email') { const m = v.match(/[\w.+-]+@[\w-]+\.[\w.]+/); return m ? m[0].toLowerCase() : null; }
  if (key === 'amount') { const m = v.replace(/,/g, '').match(/\d+(\.\d+)?/); return m ? String(Number(m[0])) : null; }
  if (key === 'tx_ref') { const m = v.toUpperCase().match(/[A-Z0-9]{6,}/); return m ? m[0] : null; }
  if (key === 'id_number') return /[A-Z0-9]{5,}/i.test(v.replace(/\s/g, '')) ? v.replace(/\s/g, '').toUpperCase() : null;
  if (key === 'rccm') return /RCCM/i.test(v) ? v.toUpperCase().replace(/\s+/g, '') : null;
  if (key === 'full_name' || key === 'contact_name') return v.split(/\s+/).length >= 2 ? v.replace(/\b\w/g, c => c.toUpperCase()) : null;
  return v;
}

// ---- SLA ----
export function slaDue(start, sla) {
  if (sla.h) return new Date(+start + sla.h * HOUR);
  let d = new Date(start), left = sla.bd;
  while (left > 0) { d = new Date(+d + DAY); const wd = d.getUTCDay(); if (wd !== 0 && wd !== 6) left--; }
  return d;
}
export const slaLabel = (sla) => sla.h ? `${sla.h} hours` : `${sla.bd} business days`;

// ---- case creation for a service request ----
export function createServiceCase({ code, fields, conv_id = null, docs = [], checks = [] }) {
  const svc = SERVICES[code];
  const ref = nextRef(svc.prefix);
  const t0 = now(), due = slaDue(t0, svc.sla);
  const hours = Math.round((due - t0) / HOUR * 10) / 10;
  const msisdn = fields.msisdn ? normMsisdn(fields.msisdn) : null;
  const name = fields.company_name || fields.full_name || fields.contact_name || 'Customer';
  const out = decideService(code, fields, docs, checks, msisdn);
  run(`INSERT INTO cases(ref,type,account_msisdn,customer_name,status,stage,owner_dept,priority,risk_score,risk_level,sla_hours,sla_start,sla_due,sla_status,recommendation,source,created_at,updated_at,conv_id,service,team,requester_type,reasons,details)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, ref, code, msisdn, name, 'SUBMITTED', 'UNDERSTAND', out.dept || svc.dept, out.risk >= 60 ? 'URGENT' : out.risk >= 30 ? 'HIGH' : 'NORMAL',
    out.risk, out.risk >= 80 ? 'CRITICAL' : out.risk >= 60 ? 'HIGH' : out.risk >= 30 ? 'MEDIUM' : 'LOW', hours, t0.toISOString(), due.toISOString(), 'ON_TRACK', s(out.rec), 'TOBi', iso(), iso(),
    conv_id, code, svc.team, fields.requester_type || null, s(out.reasons || []), s({ fields, documents: docs.map(d => d.id), checks }));
  const c = get('SELECT * FROM cases WHERE ref=?', ref);
  run("INSERT INTO risk_assessments(case_id,dimension,score,level,factors,created_at,confidence) VALUES(?,?,?,?,?,?,?)", c.id, out.dim || 'OPERATIONAL', out.risk, c.risk_level, s(out.factors || []), iso(), out.rec.confidence);
  run("INSERT INTO risk_assessments(case_id,dimension,score,level,factors,created_at,confidence) VALUES(?,?,?,?,?,?,?)", c.id, 'OVERALL', out.risk, c.risk_level, s([]), iso(), out.rec.confidence);
  for (const d of docs) run('UPDATE documents SET account_msisdn=COALESCE(account_msisdn,?), case_ref=COALESCE(case_ref,?) WHERE id=?', msisdn, ref, d.id);
  audit({ actor: 'TOBi', system: 'TOBi', action: `${svc.label} request submitted → case created`, case_ref: ref, new_state: `SLA ${slaLabel(svc.sla)} · ${svc.team}`, evidence: { fields: Object.keys(fields), documents: docs.length } });
  audit({ action: 'Sentinel recommendation', case_ref: ref, ai: `${out.rec.action} (${out.rec.confidence}%)`, rule: out.rec.rule, new_state: `Assigned → ${svc.team}` });
  // outcome
  if (out.status === 'REJECTED') {
    run("UPDATE cases SET status='REJECTED', stage='RESOLVE', resolved_at=? WHERE id=?", iso(), c.id);
    run('INSERT INTO decisions(case_id,actor,role,action,ai_action,override,reason,created_at) VALUES(?,?,?,?,?,?,?,?)', c.id, 'Sentinel AI (policy)', 'SYSTEM', 'REJECT', 'REJECT', 0, out.reasons.join('; '), iso());
    audit({ action: 'Request rejected by policy', case_ref: ref, new_state: 'REJECTED', rule: out.rec.rule, evidence: out.reasons });
  } else if (out.status === 'RESOLVED') {
    run("UPDATE cases SET status='RESOLVED', stage='RESOLVE', resolved_at=?, sla_status='MET' WHERE id=?", iso(), c.id);
    run('INSERT INTO decisions(case_id,actor,role,action,ai_action,override,reason,created_at) VALUES(?,?,?,?,?,?,?,?)', c.id, 'Sentinel AI (policy STP)', 'SYSTEM', 'APPROVE', 'AUTO_PROCESS', 0, out.rec.rule, iso());
    if (out.op && msisdn) operate(msisdn, out.op, { operator: 'Sentinel API (TOBi)', role: 'SYSTEM', case_ref: ref });
    audit({ action: 'Request resolved automatically', case_ref: ref, new_state: 'RESOLVED · SLA MET' });
  } else {
    run("UPDATE cases SET status=?, stage='DECIDE' WHERE id=?", out.status || 'PENDING_REVIEW', c.id);
    raise({ dept: out.dept || svc.dept, type: 'CASE_REVIEW', severity: out.risk >= 60 ? 'HIGH' : 'MEDIUM', title: `${ref}: ${svc.label} — ${name}`, detail: (out.rec.reason || []).join('. '), why: out.factors || [], recommendation: out.rec.action.replace(/_/g, ' '), case_ref: ref, account_msisdn: msisdn, rule: 'SVC_' + ref });
    if (out.legal) raise({ dept: 'LEGAL', type: 'CONTRACT_REVIEW', severity: 'MEDIUM', title: `${ref}: partner agreement & DPA review — ${name}`, detail: 'New partner: agreement, data processing agreement and signature specimen to be reviewed.', why: [{ points: 30, label: 'Partner contract requires legal validation' }, { points: 20, label: 'Personal data shared with partner (DPA)' }], recommendation: 'Review agreement & DPA within the 5 business-day SLA', case_ref: ref, rule: 'PARTNER_LEGAL_' + ref });
  }
  notify('WHATSAPP', fields.msisdn || fields.email || name, `${svc.label} request ${ref}`, `Status: ${out.status}. SLA ${slaLabel(svc.sla)}.`, ref);
  return { case: get('SELECT * FROM cases WHERE id=?', c.id), svc, outcome: out };
}

// Deterministic decision rules per service (explainable, auditable).
function decideService(code, f, docs, checks, msisdn) {
  const svc = SERVICES[code];
  const failed = checks.filter(c => !c.ok);
  const acc = msisdn ? account(msisdn) : null;
  const kyc = acc?.kyc || {};
  const nameOk = (a, b) => { const n = (x) => String(x || '').toUpperCase().replace(/[^A-Z ]/g, '').split(/\s+/).filter(Boolean); const A = n(a), B = n(b); return A.length && B.length && A.filter(x => B.includes(x)).length >= Math.min(2, Math.min(A.length, B.length)); };
  const rec = (action, rule, reason, confidence = 90) => ({ action, rule, reason, confidence });
  if (code === 'PIN_RESET') {
    if (!acc) return { status: 'PENDING_REVIEW', risk: 35, factors: [{ points: 35, label: 'Number not found in G2 — identity cannot be verified automatically' }], rec: rec('REVIEW', 'Unknown MSISDN → human verification', ['Number not found in G2']) };
    const idOk = kyc.id_number && String(kyc.id_number).toUpperCase() === String(f.id_number || '').toUpperCase();
    const nmOk = nameOk(f.full_name, kyc.owner_name || acc.name);
    if (idOk || (nmOk && failed.length === 0 && !kyc.id_number)) return { status: 'RESOLVED', op: 'PIN_RESET', risk: 8, factors: [{ points: 8, label: 'Identity matches G2 KYC' }], rec: rec('AUTO_PROCESS', 'Identity verified against G2 KYC → straight-through', ['ID number matches G2 KYC'], 95) };
    return { status: 'PENDING_REVIEW', risk: 55, dim: 'FRAUD', factors: [{ points: 40, label: 'Declared ID does not match G2 KYC' }, { points: 15, label: 'Sensitive operation (PIN)' }], rec: rec('REVIEW', 'Identity mismatch → human verification', ['ID number does not match G2 KYC']) };
  }
  if (code === 'SIM_SWAP') {
    const reasons = [];
    if (!docs.some(d => d.doc_type === 'NATIONAL_ID')) reasons.push('No ID document provided');
    for (const c of failed) reasons.push(c.label);
    if (acc && kyc.id_number && f.id_number && String(kyc.id_number).toUpperCase() !== String(f.id_number).toUpperCase()) reasons.push('ID number does not match the account holder in G2');
    if (reasons.length) return { status: 'REJECTED', risk: 70, dim: 'FRAUD', reasons, factors: reasons.map(r => ({ points: 30, label: r })), rec: rec('REJECT', 'SIM swap identity checks failed', reasons, 92) };
    const recent = msisdn ? get("SELECT ts FROM g2_operations WHERE msisdn=? AND op='SIM_SWAP' AND ts>=?", msisdn, new Date(+now() - 30 * DAY).toISOString()) : null;
    if (recent) return { status: 'PENDING_REVIEW', dept: 'RISK', risk: 65, dim: 'FRAUD', factors: [{ points: 40, label: 'Another SIM swap in the last 30 days' }, { points: 25, label: 'Account-takeover typology' }], rec: rec('ESCALATE', 'Repeat SIM swap → Risk review', ['Repeat SIM swap within 30 days']) };
    return { status: 'PENDING_REVIEW', risk: 22, factors: [{ points: 12, label: 'ID verified' }, { points: 10, label: 'Sensitive operation: maker-checker required' }], rec: rec('APPROVE', 'Identity verified → approve after maker-checker', ['ID document verified', 'No recent SIM swap']) };
  }
  if (code === 'CASH_OUT_REVERSAL' || code === 'CASH_IN_REVERSAL') {
    const tx = msisdn && f.tx_ref ? get('SELECT * FROM g2_transactions WHERE msisdn=? AND tx_ref=?', msisdn, f.tx_ref) : null;
    if (!tx) return { status: 'AWAITING_CUSTOMER', risk: 30, reasons: [`Transaction ${f.tx_ref} not found on ${f.msisdn}`], factors: [{ points: 30, label: 'Transaction reference not found in G2' }], rec: rec('REQUEST_INFORMATION', 'Transaction not found → ask customer', ['Transaction reference not found in G2'], 88) };
    if (Math.abs(Number(tx.amount) - Number(f.amount)) > 0.5) return { status: 'AWAITING_CUSTOMER', risk: 30, reasons: [`Amount declared ${f.amount} USD ≠ G2 ${tx.amount} USD`], factors: [{ points: 30, label: 'Declared amount differs from G2' }], rec: rec('REQUEST_INFORMATION', 'Amount mismatch → ask customer', ['Declared amount differs from G2']) };
    return { status: 'PENDING_REVIEW', risk: 18, factors: [{ points: 10, label: 'Transaction found in G2' }, { points: 8, label: 'Recipient consent required' }], rec: rec('APPROVE', 'Transaction verified → reverse after recipient check', ['Transaction found in G2, amount matches']) };
  }
  if (code === 'PARTNER_ONBOARDING') {
    const missing = (svc.docs || []).filter(t => !docs.some(d => d.doc_type === t));
    return { status: 'PENDING_REVIEW', risk: missing.length ? 45 : 28, dim: 'LEGAL', legal: true, factors: [{ points: 20, label: 'Partner agreement & DPA to be signed' }, ...missing.map(m => ({ points: 12, label: `${m} not provided` }))], rec: rec(missing.length ? 'REQUEST_INFORMATION' : 'APPROVE', 'Partner onboarding → due diligence + legal review', ['Due-diligence questionnaire', 'Legal review of agreement & DPA'], 86) };
  }
  if (code === 'SIM_CREATION') {
    if (!docs.some(d => d.doc_type === 'NATIONAL_ID')) return { status: 'AWAITING_CUSTOMER', risk: 25, reasons: ['ID document required for SIM registration'], factors: [{ points: 25, label: 'No ID document' }], rec: rec('REQUEST_INFORMATION', 'SIM registration requires an ID', ['ID missing']) };
    return { status: 'PENDING_REVIEW', risk: 12, factors: [{ points: 12, label: 'ID verified' }], rec: rec('APPROVE', 'ID verified → create SIM', ['ID verified']) };
  }
  return { status: 'PENDING_REVIEW', risk: 10, factors: [{ points: 10, label: 'Commercial request' }], rec: rec('REVIEW', 'EBU lead → account manager', [`${svc.label} request — qualify and quote`], 90) };
}

// ---- customer view ----
const STATUS_LABEL = { SUBMITTED: 'Submitted', UNDER_REVIEW: 'In review', PENDING_REVIEW: 'In review by our team', AWAITING_CUSTOMER: 'Waiting for your information', EDD_REQUESTED: 'Additional checks (documents requested)', CREATING: 'Being processed in G2', G2_FAILED: 'Being processed in G2', RESOLVED: 'Completed', REJECTED: 'Not approved', CLOSED: 'Closed', OPEN: 'Open', LEGAL_REVISION: 'In review by our team' };
export function customerRequests(conv) {
  const app = get('SELECT case_id FROM applications WHERE id=?', conv.application_id);
  const rows = all(`SELECT * FROM cases WHERE conv_id=? OR id=? OR (? IS NOT NULL AND account_msisdn=? AND type IN ('SUPPORT','DOCUMENT_RENEWAL')) ORDER BY id DESC`, conv.id, app?.case_id || -1, conv.msisdn, conv.msisdn);
  return rows.map(c => {
    const svc = SERVICES[c.service || c.type] || (c.type === 'MERCHANT_ONBOARDING' ? SERVICES.MERCHANT_CREATION : null);
    const dec = get("SELECT reason FROM decisions WHERE case_id=? AND action IN ('REJECT','REQUEST_INFORMATION','REQUEST_EDD') ORDER BY id DESC", c.id);
    const reasons = j(c.reasons, []);
    const due = new Date(c.sla_due), rem = +due - +now();
    return { ref: c.ref, service: svc?.label || c.type.replace(/_/g, ' ').toLowerCase().replace(/^\w/, x => x.toUpperCase()), status: c.status, status_label: STATUS_LABEL[c.status] || c.status,
      created: c.created_at, due: c.sla_due, remaining_ms: c.resolved_at ? null : rem, sla_status: c.sla_status, team: c.team || DEPT_NAMES[c.owner_dept], sla_label: svc ? slaLabel(svc.sla) : `${c.sla_hours} hours`,
      reasons: c.status === 'REJECTED' || c.status === 'AWAITING_CUSTOMER' || c.status === 'EDD_REQUESTED' ? (reasons.length ? reasons : dec?.reason ? [dec.reason] : []) : [], resolved: c.resolved_at };
  });
}
