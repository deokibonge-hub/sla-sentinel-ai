// Case engine: risk scoring (explainable), policy evaluation, recommendation, routing, SLA, human decisions, G2 orchestration.
import { get, all, run, s, j, policy } from './db.js';
import { iso, now, audit, notify, nextRef, HOUR, DAY, DEPT_NAMES } from './core.js';
import { verifyApplication, summary } from './verification.js';
import { appDocuments, caseDocuments } from './documents.js';
import { createAccount, normMsisdn, fmtMsisdn, operate } from './g2.js';
import { raise, resolveAlerts } from './alerts.js';
import { tobiSay, convForApplication } from './tobi_out.js';
import { scheduleLifecycle, titleName } from './lifecycle.js';
import { SERVICES, slaLabel } from './services.js';
import { callSystem, killed, caseTrace } from './trust.js';

export const PIPELINE = ['UNDERSTAND', 'VERIFY', 'RISK_SCORE', 'DECIDE', 'ORCHESTRATE', 'MONITOR', 'PREDICT', 'RESOLVE', 'LEARN'];
export const level = (x) => x >= 80 ? 'CRITICAL' : x >= 60 ? 'HIGH' : x >= 30 ? 'MEDIUM' : 'LOW';

// ---------- risk ----------
export function assessRisk(fields, verifs, docs) {
  const dims = { OPERATIONAL: [], COMPLIANCE: [], AML_CFT: [], FRAUD: [], LEGAL: [] };
  const add = (d, points, label) => dims[d].push({ points, label });
  const mism = verifs.filter(v => v.status === 'MISMATCH'), clar = verifs.filter(v => v.status === 'CLARIFIED');
  const turnover = Number(String(fields.monthly_turnover_usd || '').replace(/[^\d.]/g, '')) || 0;
  for (const m of mism) {
    if (/RCCM|ID_NAT/.test(m.check_code)) add('COMPLIANCE', 25, `${m.label.split(':')[0]} mismatch`);
    else if (/OWNER|ID_NUMBER/.test(m.check_code)) { add('AML_CFT', 30, 'Identity inconsistency'); add('FRAUD', 25, 'Identity data does not match ID document'); }
    else add('OPERATIONAL', 12, `${m.label.split(':')[0]} inconsistent`);
  }
  if (clar.length) add('COMPLIANCE', 6 * clar.length, `${clar.length} discrepancy(ies) clarified by applicant`);
  for (const v of verifs.filter(v => v.status === 'MISSING')) add('COMPLIANCE', 14, `${v.label.replace(' provided', '')} missing`);
  for (const v of verifs.filter(v => v.status === 'REVIEW')) add('OPERATIONAL', 18, `${v.label.replace(' readability', '')} unreadable — manual check`);
  for (const v of verifs.filter(v => v.status === 'EXPIRED')) add('COMPLIANCE', 35, `${v.label.replace(' validity', '')} expired`);
  for (const v of verifs.filter(v => v.status === 'EXPIRING')) add('COMPLIANCE', 20, `${v.label.replace(' validity', '')} expires within 30 days`);
  if (fields.pep === 'Yes') add('AML_CFT', 45, 'Politically exposed person declared');
  if (fields.sanctions === 'Yes') add('AML_CFT', 60, 'Asset freeze / sanctions declared');
  if (fields.convictions === 'Yes') add('AML_CFT', 50, 'Prior conviction declared');
  if (turnover > 10000) add('AML_CFT', 15, `High expected turnover (${turnover.toLocaleString('en-US')} USD/month)`);
  if (/exchange|bureau de change|forex|gold|or\b|diamond|crypto/i.test(fields.business_activity || '')) add('AML_CFT', 18, 'Higher-risk business activity');
  const msisdn = normMsisdn(fields.phone);
  const dupe = get("SELECT name FROM g2_accounts WHERE msisdn=? AND status!='DELETED'", msisdn);
  if (dupe) add('FRAUD', 30, `Phone already registered in G2 to ${dupe.name}`);
  const sameId = fields.id_number ? all('SELECT msisdn FROM g2_accounts WHERE kyc LIKE ?', `%"id_number":"${fields.id_number}"%`) : [];
  if (sameId.length) add('AML_CFT', 25, `Related accounts: ID used on ${sameId.length} other account(s)`);
  if (fields.legal_form === 'COMPANY' && !fields.rccm && fields.contract_type !== 'MR') add('LEGAL', 30, 'Company without RCCM');
  if (fields.terms_accepted === 'No') add('LEGAL', 40, 'Terms / data protection agreement not accepted');
  if (fields.contract_type === 'MR' && turnover > 3000) add('OPERATIONAL', 15, 'Turnover above street-merchant profile');
  if (!docs.length) add('OPERATIONAL', 20, 'No supporting documents');
  const out = {};
  const docConf = Math.min(97, 70 + docs.length * 8 - mism.length * 4);
  for (const [d, f] of Object.entries(dims)) { const sc = Math.min(100, f.reduce((a, b) => a + b.points, 0) + (d === 'OPERATIONAL' ? 4 : 2)); out[d] = { score: sc, level: level(sc), factors: f, confidence: Math.max(60, docConf - (d === 'AML_CFT' ? 5 : 0)) }; }
  const vals = Object.values(out).map(x => x.score);
  const overall = Math.min(100, Math.round(Math.max(...vals) * 0.75 + vals.reduce((a, b) => a + b, 0) / vals.length * 0.25));
  return { dims: out, overall, level: level(overall) };
}

// ---------- policy & recommendation ----------
export function recommend(risk, verifs) {
  const p = policy('decision_policy', {});
  const open = verifs.filter(v => ['MISMATCH', 'MISSING', 'EXPIRED'].includes(v.status));
  const d = risk.dims;
  let action = 'APPROVE', route = 'OPERATIONS', reason = [], automation = false, rule = null;
  if (d.AML_CFT.score >= (p.aml_edd ?? 70)) { action = 'EDD_REQUIRED'; route = 'AML'; rule = `AML/CFT risk ≥ ${p.aml_edd ?? 70}`; reason.push('AML/CFT indicators require enhanced due diligence'); }
  else if (d.LEGAL.score >= (p.legal ?? 60)) { action = 'LEGAL_REVIEW_REQUIRED'; route = 'LEGAL'; rule = `Legal risk ≥ ${p.legal ?? 60}`; reason.push('Legal issue detected'); }
  else if (d.COMPLIANCE.score >= (p.compliance ?? 80)) { action = 'REVIEW'; route = 'COMPLIANCE'; rule = `Compliance risk ≥ ${p.compliance ?? 80}`; reason.push('Compliance exceptions above threshold'); }
  else if (risk.overall >= (p.specialist ?? 60)) { action = 'ESCALATE'; route = 'RISK'; rule = `Overall risk ≥ ${p.specialist ?? 60}`; reason.push('High overall risk — specialist review'); }
  else if (open.length) { action = 'REQUEST_INFORMATION'; route = 'OPERATIONS'; rule = 'Open verification exceptions'; reason.push(`${open.length} verification exception(s) to resolve`); }
  else if (verifs.some(v => v.status === 'REVIEW')) { action = 'APPROVE'; route = 'OPERATIONS'; rule = 'Document read manually → human verification before approval'; reason.push('A document photo was unreadable; details typed by the customer must be checked by an agent'); }
  else if (risk.overall < (p.auto_max ?? 30)) { action = 'AUTO_PROCESS'; automation = p.stp_enabled !== false; rule = `Low risk (< ${p.auto_max ?? 30}) + documents verified + no exceptions → straight-through processing`; reason.push('All required documents verified', 'No inconsistencies detected', 'No policy exceptions detected'); }
  else { action = 'APPROVE'; route = 'OPERATIONS'; rule = 'Medium risk → human review'; reason.push('Medium risk — human approval required'); }
  const confidence = Math.max(62, Math.min(97, 96 - Math.round(risk.overall / 4) - open.length * 3));
  return { action, route, automation, reason, rule, confidence, risk_level: risk.level, overall: risk.overall };
}

// ---------- SLA ----------
export function slaInfo(c) {
  if (!c.sla_due) return null;
  const start = new Date(c.sla_start), due = new Date(c.sla_due), end = c.resolved_at ? new Date(c.resolved_at) : now();
  const total = due - start, elapsed = end - start, remaining = due - end;
  let status, prob;
  if (c.resolved_at) { status = remaining >= 0 ? 'MET' : 'BREACHED'; prob = 0; }
  else {
    const frac = elapsed / total;
    prob = Math.max(2, Math.min(99, Math.round(100 / (1 + Math.exp(-10 * (frac - 0.72))))));
    status = remaining < 0 ? 'BREACHED' : frac > 0.9 ? 'CRITICAL' : frac > 0.65 ? 'AT_RISK' : 'ON_TRACK';
    if (remaining < 0) prob = 100;
  }
  const svc = SERVICES[c.service || c.type] || (c.type === 'MERCHANT_ONBOARDING' ? SERVICES.MERCHANT_CREATION : null);
  const team = c.team || svc?.team || DEPT_NAMES[c.owner_dept] || c.owner_dept;
  const next = c.resolved_at ? (status === 'MET' ? 'None — SLA met' : 'Root-cause review of breach')
    : ({ AWAITING_CUSTOMER: 'Customer to provide information (TOBi follow-up)', EDD_REQUESTED: 'Customer to provide EDD documents', G2_FAILED: 'Retry G2 creation', CREATING: 'G2 provisioning in progress', LEGAL_REVISION: 'Legal revision of the agreement' }[c.status]
      || (status === 'BREACHED' ? `Escalate to ${team} manager now` : status === 'CRITICAL' ? `Prioritise — decide within ${Math.max(1, Math.round(remaining / HOUR))} h` : `Review by ${team}`));
  return { status, breach_probability: prob, remaining_ms: remaining, elapsed_ms: elapsed, target_hours: c.sla_hours, target_label: svc ? slaLabel(svc.sla) : `${c.sla_hours} hours`, due: c.sla_due, team, next_action: next };
}
export function refreshSla(c) {
  const i = slaInfo(c); if (!i) return c;
  if (i.status !== c.sla_status) run('UPDATE cases SET sla_status=? WHERE id=?', i.status, c.id);
  return { ...c, sla_status: i.status };
}

// ---------- case creation from an application ----------
export function submitApplication(app_id) {
  const app = get('SELECT * FROM applications WHERE id=?', app_id);
  if (!app) throw new Error('Application not found');
  if (app.case_id) return get('SELECT * FROM cases WHERE id=?', app.case_id);
  const fields = j(app.fields, {});
  const docs = appDocuments(app.id);
  const verifs = verifyApplication(app);
  const risk = assessRisk(fields, verifs, docs);
  const rec = recommend(risk, verifs);
  const ref = nextRef('MP-ONB');
  const hours = (policy('sla_hours', {}).MERCHANT_ONBOARDING) || 48;
  const t0 = now();
  const r = run(`INSERT INTO cases(ref,type,application_id,account_msisdn,customer_name,status,stage,owner_dept,priority,risk_score,risk_level,sla_hours,sla_start,sla_due,sla_status,recommendation,source,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, ref, 'MERCHANT_ONBOARDING', app.id, normMsisdn(fields.phone), fields.trading_name || fields.legal_name, 'SUBMITTED', 'UNDERSTAND', rec.route,
    risk.level === 'LOW' ? 'NORMAL' : risk.level === 'MEDIUM' ? 'HIGH' : 'URGENT', risk.overall, risk.level, hours, t0.toISOString(), new Date(+t0 + hours * HOUR).toISOString(), 'ON_TRACK', s(rec), 'TOBi', iso(), iso());
  const case_id = r.lastInsertRowid;
  callSystem('IRM', 'kyc.lookup', { case_ref: ref, identity: 'svc-sentinel-ai', tier: 'LOW', detail: `${verifs.length} checks` });
  callSystem('CONTROL', 'aml.screening', { case_ref: ref, identity: 'svc-sentinel-ai', detail: `sanctions/PEP · risk ${risk.overall}` });
  run('UPDATE cases SET service=?, team=?, conv_id=?, requester_type=? WHERE id=?', 'MERCHANT_CREATION', SERVICES.MERCHANT_CREATION.team, app.conv_id, 'Merchant', case_id);
  for (const [d, v] of Object.entries(risk.dims)) run('INSERT INTO risk_assessments(case_id,dimension,score,level,factors,created_at,confidence) VALUES(?,?,?,?,?,?,?)', case_id, d, v.score, v.level, s(v.factors), iso(), v.confidence);
  run('INSERT INTO risk_assessments(case_id,dimension,score,level,factors,created_at) VALUES(?,?,?,?,?,?)', case_id, 'OVERALL', risk.overall, risk.level, s([]), iso());
  run("UPDATE applications SET status='SUBMITTED', case_id=?, submitted_at=?, updated_at=? WHERE id=?", case_id, iso(), iso(), app.id);
  audit({ actor: 'TOBi', system: 'TOBi', action: 'Application submitted → case created', case_ref: ref, new_state: 'SUBMITTED', evidence: { documents: docs.length } });
  const okv = verifs.filter(v => ['MATCH', 'OK', 'VALID'].includes(v.status)).length;
  audit({ action: 'Document verification', case_ref: ref, new_state: `${okv}/${verifs.length} checks passed`, evidence: verifs.filter(v => v.status !== 'MATCH').map(v => v.label + ': ' + v.status) });
  for (const [d, v] of Object.entries(risk.dims)) if (v.score >= 20) audit({ action: 'Risk assessment', case_ref: ref, new_state: `${d.replace('_', '/')} risk ${v.score}/100`, risk: v.score });
  audit({ action: 'Risk assessment', case_ref: ref, new_state: `Overall risk ${risk.overall}/100 (${risk.level})`, risk: risk.overall });
  audit({ action: 'Sentinel recommendation', case_ref: ref, ai: `${rec.action} (${rec.confidence}%)`, rule: rec.rule, new_state: `Route → ${DEPT_NAMES[rec.route] || rec.route}` });
  run("UPDATE cases SET stage='DECIDE', status='UNDER_REVIEW' WHERE id=?", case_id);

  // Hard eligibility rules → rejection with precise reasons (applicant can correct and re-apply)
  const hard = [];
  const idExp = verifs.find(v => v.check_code === 'EXP_NATIONAL_ID' && v.status === 'EXPIRED');
  if (idExp) hard.push(`ID document expired (${idExp.found}) — a valid ID is mandatory`);
  if (verifs.find(v => v.check_code === 'DOC_NATIONAL_ID' && v.status === 'MISSING')) hard.push('ID document of the owner not provided');
  if (fields.terms_accepted === 'No') hard.push('Terms, AML policy and data protection declaration not accepted');
  if (hard.length) {
    run("UPDATE cases SET status='REJECTED', stage='RESOLVE', resolved_at=?, reasons=?, owner_dept='OPERATIONS' WHERE id=?", iso(), s(hard), case_id);
    run('INSERT INTO decisions(case_id,actor,role,action,ai_action,override,reason,created_at) VALUES(?,?,?,?,?,?,?,?)', case_id, 'Sentinel AI (eligibility rules)', 'SYSTEM', 'REJECT', 'REJECT', 0, hard.join('; '), iso());
    run("UPDATE applications SET status='REJECTED', updated_at=? WHERE id=?", iso(), app.id);
    audit({ action: 'Application rejected — eligibility rules', case_ref: ref, new_state: 'REJECTED', rule: 'MERCHANT_ELIGIBILITY', evidence: hard });
    const conv = convForApplication(app.id);
    if (conv) tobiSay(conv.id, `I'm sorry — application ${ref} can't be accepted as it is. Here is exactly why, so you can fix it and apply again in minutes:`, 'card', { title: 'Application not accepted', pillar: 'ALERT', rows: hard.map((h, i) => [`Reason ${i + 1}`, h]), reasons: hard });
    return get('SELECT * FROM cases WHERE id=?', case_id);
  }

  if (rec.automation && killed('BOT_G2')) { rec.automation = false; rec.rule += ' — G2 robot kill switch engaged → human'; run('UPDATE cases SET recommendation=? WHERE id=?', s(rec), case_id); audit({ action: 'Automation blocked: kill switch engaged', case_ref: ref, rule: 'FAIL_SECURE' }); }
  if (rec.automation) {
    audit({ action: 'Straight-through processing authorised by policy', case_ref: ref, rule: rec.rule, ai: 'AUTO_PROCESS', new_state: 'APPROVED' });
    run('INSERT INTO decisions(case_id,actor,role,action,ai_action,override,reason,created_at) VALUES(?,?,?,?,?,?,?,?)', case_id, 'Sentinel AI (policy STP)', 'SYSTEM', 'APPROVE', rec.action, 0, rec.rule, iso());
    orchestrateCreation(case_id, 'Sentinel AI');
  } else {
    run("UPDATE cases SET status='PENDING_REVIEW' WHERE id=?", case_id);
    const sev = { AML: 'HIGH', RISK: 'HIGH', LEGAL: 'MEDIUM', COMPLIANCE: 'MEDIUM', OPERATIONS: 'MEDIUM' }[rec.route];
    const why = Object.values(risk.dims).flatMap(d => d.factors).sort((a, b) => b.points - a.points).slice(0, 5);
    raise({ dept: rec.route, type: 'CASE_REVIEW', severity: sev, title: `${ref}: ${rec.action.replace(/_/g, ' ')} — ${fields.trading_name || fields.legal_name}`, detail: rec.reason.join('. '), why, recommendation: rec.action.replace(/_/g, ' '), case_ref: ref, rule: 'CASE_ROUTED' });
    if (rec.route !== 'OPERATIONS') raise({ dept: 'OPERATIONS', type: 'ESCALATION', severity: 'LOW', title: `${ref} escalated to ${DEPT_NAMES[rec.route]}`, detail: 'Automation blocked; case owned by ' + DEPT_NAMES[rec.route], why, case_ref: ref, rule: 'CASE_ESCALATED' });
    const conv = convForApplication(app.id);
    if (conv) tobiSay(conv.id, rec.action === 'REQUEST_INFORMATION'
      ? `Thanks! Your application ${ref} is received. Our team needs to check a few details — I'll message you here as soon as they reply.`
      : `Thanks! Your application ${ref} is received and is being reviewed by our team. Typical review time is under ${hours} hours. You can ask me "what is the status of my application?" anytime.`);
  }
  return get('SELECT * FROM cases WHERE id=?', case_id);
}

export function orchestrateCreation(case_id, actor) {
  const c = get('SELECT * FROM cases WHERE id=?', case_id);
  const app = get('SELECT * FROM applications WHERE id=?', c.application_id);
  const fields = j(app?.fields, {});
  run("UPDATE cases SET stage='ORCHESTRATE', status='CREATING', updated_at=? WHERE id=?", iso(), case_id);
  const res = createAccount({ case_ref: c.ref, type: 'MERCHANT', fields, documents: appDocuments(app.id) });
  const conv = convForApplication(app.id);
  callSystem('G2', 'account.create', { case_ref: c.ref, status: res.ok ? 'OK' : 'ERROR', detail: res.ok ? res.merchant_id : res.error });
  if (!res.ok) {
    run("UPDATE cases SET status='G2_FAILED', stage='ORCHESTRATE', owner_dept='OPERATIONS', updated_at=? WHERE id=?", iso(), case_id);
    raise({ dept: 'OPERATIONS', type: 'G2_FAILURE', severity: 'HIGH', title: `${c.ref}: G2 creation failed`, detail: res.error, why: [{ points: 50, label: res.error }], recommendation: 'Retry creation from Case 360', case_ref: c.ref, rule: 'G2_FAILURE' });
    if (conv) tobiSay(conv.id, `Your application ${c.ref} is approved — account creation is taking a little longer than usual. No action needed from you; I'll confirm shortly.`);
    return { ok: false, error: res.error };
  }
  run("UPDATE cases SET status='RESOLVED', stage='MONITOR', resolved_at=?, account_msisdn=?, updated_at=? WHERE id=?", iso(), res.msisdn, iso(), case_id);
  callSystem('ICAP', 'sim.connect', { case_ref: c.ref, detail: 'merchant SIM ' + res.merchant_sim }); callSystem('IRM', 'kyc.register', { case_ref: c.ref }); callSystem('TRANSACTIONAL', 'till.activate', { case_ref: c.ref, detail: 'till ' + res.till_number }); callSystem('CONTROL', 'evidence.push', { case_ref: c.ref });
  const c2 = refreshSla(get('SELECT * FROM cases WHERE id=?', case_id));
  run("UPDATE applications SET status='ACTIVE', updated_at=? WHERE id=?", iso(), app.id);
  resolveAlerts({ case_ref: c.ref }, actor, 'Case resolved');
  audit({ actor: 'Sentinel AI', action: 'Case resolved', case_ref: c.ref, new_state: `RESOLVED · SLA ${c2.sla_status}`, evidence: res });
  notify('WHATSAPP', fmtMsisdn(res.msisdn), 'M-Pesa Business account created', `Merchant number ${res.merchant_id} · Till ${res.till_number}. Collect your merchant SIM ${fmtMsisdn(res.merchant_sim)} at Vodacom Park within 48 hours.`, c.ref);
  notify('SMS', fmtMsisdn(res.msisdn), 'Merchant SIM ready', `Your merchant SIM is ready at Vodacom Park (Gombe). Collect within 48h with your ID.`, c.ref);
  notify('EMAIL', fields.email || fmtMsisdn(res.msisdn), 'Welcome to M-Pesa Business', `Your merchant account ${res.merchant_id} is active.`, c.ref);
  if (conv) {
    run('UPDATE conversations SET msisdn=? WHERE id=?', res.msisdn, conv.id);
    tobiSay(conv.id, `Great news, ${titleName(String(fields.owner_name || '').split(' ')[0]) || 'there'}! Your M-Pesa Business account is ready.`, 'card',
      { title: 'Account created', rows: [['Merchant number', res.merchant_id], ['Till number', res.till_number], ['Short code', res.short_code], ['Merchant SIM', fmtMsisdn(res.merchant_sim)], ['Status', 'ACTIVE'], ['Created', new Date(res.created_at).toUTCString().slice(5, 22)], ['Case', c.ref]], form_link: true });
    tobiSay(conv.id, `📍 Your merchant SIM ${fmtMsisdn(res.merchant_sim)} is ready for collection at Vodacom Park (Gombe, Kinshasa) within 48 hours. Bring your ID card. You can also download your completed merchant form.`, 'options', { options: ['My requests', 'Download my merchant form'] });
    scheduleLifecycle(res.msisdn, conv.id);
  }
  return { ok: true, ...res };
}

// ---------- human decisions ----------
export function decide(case_ref, user, action, reason = '') {
  const c = get('SELECT * FROM cases WHERE ref=?', case_ref);
  if (!c) throw new Error('Case not found');
  if (['RESOLVED', 'REJECTED', 'CLOSED'].includes(c.status)) throw new Error('Case already closed');
  const rec = j(c.recommendation, {});
  const aiAct = rec.action;
  const agrees = (action === 'APPROVE' && ['APPROVE', 'AUTO_PROCESS'].includes(aiAct)) || (action === 'REQUEST_INFORMATION' && aiAct === 'REQUEST_INFORMATION') || (action === 'ESCALATE' && ['ESCALATE', 'EDD_REQUIRED', 'LEGAL_REVIEW_REQUIRED', 'REVIEW'].includes(aiAct)) || (action === 'REJECT' && aiAct === 'REJECT');
  const override = !agrees;
  if (action === 'REJECT' && reason.trim().length < 5) { const e = new Error('A justification is required to reject'); e.code = 'OVERRIDE_REASON'; throw e; }
  if (override && reason.trim().length < 5) { const e = new Error('Reason for override required'); e.code = 'OVERRIDE_REASON'; throw e; }
  // department authority
  if (action === 'APPROVE' && c.owner_dept === 'AML' && user.role !== 'AML_OFFICER') throw new Error('Only AML/CFT can approve a case under AML review');
  run('INSERT INTO decisions(case_id,actor,role,action,ai_action,override,reason,created_at) VALUES(?,?,?,?,?,?,?,?)', c.id, user.name, user.role, action, aiAct, override ? 1 : 0, reason, iso());
  callSystem('CONTROL', 'maker_checker.evidence', { case_ref, identity: 'staff:' + user.role, detail: action });
  audit({ actor: user.name, role: user.role, action: `Human decision: ${action.replace(/_/g, ' ')}`, case_ref, prev_state: c.status, ai: aiAct, human: action, override, override_reason: override ? reason : null, risk: c.risk_score });
  if (override) raise({ dept: 'AUDIT', type: 'OVERRIDE', severity: 'LOW', title: `${case_ref}: AI recommendation overridden`, detail: `${user.name} (${user.roleName}) chose ${action} vs Sentinel ${aiAct}. Reason: ${reason}`, why: [{ points: 20, label: 'Human override of AI recommendation' }], case_ref, rule: 'OVERRIDE_' + c.id });
  const conv = c.application_id ? convForApplication(c.application_id) : null;
  if (action === 'APPROVE' && c.application_id) return orchestrateCreation(c.id, user.name);
  if (action === 'APPROVE') {
    if (['SIM_SWAP', 'PIN_RESET'].includes(c.type) && c.account_msisdn) { try { operate(c.account_msisdn, c.type, { operator: user.name, role: user.role, case_ref }); } catch (e) { /* account may be closed */ } }
    run("UPDATE cases SET status='RESOLVED', stage='RESOLVE', resolved_at=?, updated_at=? WHERE id=?", iso(), iso(), c.id);
    const c2 = refreshSla(get('SELECT * FROM cases WHERE id=?', c.id));
    resolveAlerts({ case_ref }, user.name, 'Case approved & resolved');
    audit({ actor: user.name, role: user.role, action: 'Case resolved', case_ref, new_state: `RESOLVED · SLA ${c2.sla_status}` });
    if (c.conv_id) tobiSay(c.conv_id, `Good news ✅ Your request ${case_ref} is completed${c.type === 'SIM_SWAP' ? ' — your new SIM is active. Keep your PIN secret' : ''}.`, 'options', { options: ['My requests', 'New request'] });
    return c2;
  }
  if (action === 'REJECT') {
    run("UPDATE cases SET status='REJECTED', stage='RESOLVE', resolved_at=?, updated_at=?, reasons=? WHERE id=?", iso(), iso(), s([reason]), c.id);
    resolveAlerts({ case_ref }, user.name, 'Case rejected');
    const cv = conv || (c.conv_id ? { id: c.conv_id } : null);
    if (cv) tobiSay(cv.id, `We're sorry — request ${case_ref} could not be approved. Reason: ${reason}. You can fix this and start a new request anytime.`, 'options', { options: ['My requests', 'New request'] });
  } else if (action === 'REQUEST_INFORMATION') {
    run("UPDATE cases SET status='AWAITING_CUSTOMER', stage='DECIDE', updated_at=?, reasons=? WHERE id=?", iso(), s([reason || 'please confirm your details']), c.id);
    if (!conv && c.conv_id) tobiSay(c.conv_id, `Our team reviewed request ${case_ref} and needs one more thing: ${reason || 'please confirm your details'}.`, 'options', { options: ['My requests'] });
    if (conv) tobiSay(conv.id, `Our team reviewed application ${case_ref} and needs one more thing: ${reason || 'please confirm your details'}. You can reply or upload a document here.`);
    notify('WHATSAPP', case_ref, 'Information required', reason, case_ref);
  } else if (action === 'ESCALATE') {
    const to = reason.match(/\b(AML|RISK|LEGAL|COMPLIANCE|INTERNAL_CONTROL)\b/)?.[1] || (rec.route !== c.owner_dept ? rec.route : 'RISK');
    run('UPDATE cases SET owner_dept=?, status=?, updated_at=? WHERE id=?', to, 'PENDING_REVIEW', iso(), c.id);
    raise({ dept: to, type: 'ESCALATION', severity: 'HIGH', title: `${case_ref} escalated by ${user.roleName}`, detail: reason, why: [{ points: 30, label: 'Manual escalation' }], case_ref, rule: 'ESCALATED_' + to });
  }
  return get('SELECT * FROM cases WHERE ref=?', case_ref);
}

const V_STATE = { MATCH: 'ok', VALID: 'ok', OK: 'ok', PARTIAL: 'warn', CLARIFIED: 'warn', EXPIRING: 'warn', REVIEW: 'warn', MISMATCH: 'bad', EXPIRED: 'bad', MISSING: 'bad' };
const fieldOfCheck = (code, docType) => code === 'X_OWNER_ID' ? 'owner_name' : code === 'X_ADDR_RCCM_POA' ? 'commune' : code.startsWith('EXP_') ? (docType === 'NATIONAL_ID' ? 'id_expiry' : 'expiry') : code.startsWith('DECL_') ? code.slice(5).toLowerCase() : null;
// Annotate each document with what Sentinel found on it (field → ok / warn / bad + explanation) and list the key findings.
function annotate(docs, verifs, checks) {
  const byId = Object.fromEntries(docs.map(d => [d.id, d]));
  const findings = [];
  const mark = (doc, field, st, note, label) => {
    if (!doc || !field) return;
    doc.marks = doc.marks || {};
    const prev = doc.marks[field]; const rank = { bad: 3, warn: 2, ok: 1, info: 0 };
    if (!prev || rank[st] > rank[prev.s]) doc.marks[field] = { s: st, note, label };
  };
  for (const v of verifs || []) {
    const id = Number(String(v.source || '').split(':')[1]); const doc = byId[id];
    const st = V_STATE[v.status] || 'info';
    const field = doc ? fieldOfCheck(v.check_code, doc.doc_type) : null;
    const note = v.declared || v.found ? `${v.label} — declared “${v.declared ?? '—'}”, document “${v.found ?? '—'}”` : `${v.label}${v.detail ? ' — ' + v.detail : ''}`;
    if (field) mark(doc, field, st, st === 'ok' ? (v.check_code.startsWith('EXP_') ? `Valid — ${v.detail || ''}` : `Matches the declared data (${v.label.split(':')[0]})`) : note.replace(/declared “—”, /, ''), v.label);
    if (st === 'bad' || (st === 'warn' && v.status !== 'MATCH')) findings.push({ s: st, label: v.label, status: v.status, declared: v.declared, found: v.found, detail: v.detail, doc_id: doc ? id : null, field });
  }
  for (const c of checks || []) {
    const doc = byId[Number(c.doc_id)];
    const st = c.ok ? (c.info ? 'info' : 'ok') : (c.sev || 'bad');
    const note = `${c.label}${c.declared ? ` — on file “${c.declared}”` : ''}${c.found ? `${c.declared ? ',' : ' —'} document “${c.found}”` : ''}`;
    mark(doc, c.field, st, st === 'ok' ? `✓ ${c.label}` : note, c.label);
    if (!c.ok) findings.push({ s: st, label: c.label, declared: c.declared, found: c.found, doc_id: doc ? doc.id : null, field: c.field });
    else if (c.info) findings.push({ s: 'info', label: c.label, declared: c.declared, found: c.found, doc_id: doc ? doc.id : null, field: c.field });
  }
  for (const d of docs) {
    if (d.expiry_date && d.boxes?.id_expiry && !d.marks?.id_expiry) { const days = Math.floor((new Date(d.expiry_date) - now()) / DAY); const st = days < 0 ? 'bad' : days <= 30 ? 'warn' : 'ok'; mark(d, 'id_expiry', st, days < 0 ? `Expired ${-days} days ago` : `Valid — expires in ${days} days`); if (st !== 'ok') findings.push({ s: st, label: days < 0 ? `ID document expired ${-days} days ago` : `ID document expires in ${days} days`, found: d.expiry_date, doc_id: d.id, field: 'id_expiry' }); }
    for (const [k, b] of Object.entries(d.boxes || {})) if (b.s && !d.marks?.[k]) { mark(d, k, b.s, b.note || '', b.label); if (b.s === 'bad' && !findings.some(f => f.doc_id === d.id && f.field === k)) findings.push({ s: 'bad', label: b.label ? `${b.label} — ${b.note}` : b.note, doc_id: d.id, field: k }); }
  }
  const rank = { bad: 0, warn: 1, info: 2 };
  return findings.sort((a, b) => rank[a.s] - rank[b.s]);
}
// Why is an open case waiting, who must act, and what happens next — stated explicitly for every open case.
export function waitingFor(c, rec = {}) {
  if (['RESOLVED', 'REJECTED', 'CLOSED'].includes(c.status)) return null;
  const det = j(c.details, {}) || {}, req = String(det.fields?.request || '');
  const team = c.team || DEPT_NAMES[c.owner_dept] || c.owner_dept;
  const pol = policy('decision_policy', {});
  const W = (who, why, next) => ({ who, why, next });
  switch (c.status) {
    case 'AWAITING_CUSTOMER': return W('Customer (via TOBi)', (rec.reason || []).join(' · ') || 'Information or a document is missing', 'TOBi has asked the customer; the case resumes automatically when they reply');
    case 'EDD_REQUESTED': return W('Customer (EDD documents)', 'AML/CFT risk above the EDD threshold — source of funds must be evidenced', 'AML officer reviews the EDD documents, then approves or rejects');
    case 'G2_FAILED': return W('Operations', 'G2 returned an error while creating the account', 'Retry the G2 creation from this case');
    case 'CREATING': return W('G2', 'Account creation in progress', 'No action — straight-through processing');
  }
  if (rec.action === 'EDD_REQUIRED') return W(DEPT_NAMES.AML, `AML/CFT risk ≥ ${pol.aml_edd ?? 70}: enhanced due diligence is mandatory`, 'Decide: request EDD documents, file a SAR, or close as false positive (rationale required)');
  if (rec.action === 'LEGAL_REVIEW_REQUIRED' || c.type === 'CONTRACT_REVIEW') return W(DEPT_NAMES.LEGAL, 'Contract clauses deviate from the approved template — only Legal can accept them', 'Request revision of the flagged clauses or accept the legal risk');
  if (rec.action === 'ESCALATE') return W(team, (rec.reason || []).join(' · ') || 'Risk above the specialist threshold', 'Specialist decision: approve, reject or request information');
  if (rec.action === 'REVIEW') return W(DEPT_NAMES.COMPLIANCE, 'Compliance exceptions above threshold', 'Compliance officer decides');
  // documents are fine, but policy still requires a human decision
  if (/unreadable|manually/i.test(rec.rule || '')) return W(team, 'A photo was unreadable — the details were typed by the customer, so an agent must compare them with the image', 'Agent checks the image, then approves (maker-checker)');
  if (c.type === 'SIM_SWAP' || c.service === 'SIM_SWAP') return W(team, 'SIM swap is a sensitive G2 operation (account-takeover risk): even with valid documents, a callback and a second person are required', 'Call the alternative number registered in KYC, then approve to execute the swap in G2');
  if (/reversal/i.test(req) || /REVERSAL/.test(c.service || '')) return W(team, 'A reversal moves money out of another customer’s wallet: it is never automatic (maker-checker)', 'Hold the funds, notify the recipient, then approve the reversal');
  if (c.type === 'KYC_UPDATE') return W(DEPT_NAMES.COMPLIANCE, 'Documents are consistent, but a change of KYC data in G2 must be validated by Compliance (maker-checker)', 'Approve to update the address in G2 KYC');
  if (c.type === 'DOCUMENT_RENEWAL') return W(DEPT_NAMES.COMPLIANCE, 'The renewed ID is valid; Compliance validates it before replacing the expired one in G2', 'Approve to update G2 KYC and close the non-compliance');
  if (rec.action === 'APPROVE' && (rec.overall ?? c.risk_score) >= (pol.auto_max ?? 30)) return W(team, `Documents are fine, but overall risk ${rec.overall ?? c.risk_score}/100 is above the straight-through limit (${pol.auto_max ?? 30}) — see the RISK tab for the drivers`, 'Human approval required by policy (decision_policy.auto_max)');
  return W(team, rec.rule || 'Human review', 'Decide on this case');
}
const CHECK_STATUS = (c) => c.ok ? (c.info ? 'INFO' : 'MATCH') : (c.sev === 'warn' ? 'PARTIAL' : 'MISMATCH');
export function case360(ref) {
  const c0 = get('SELECT * FROM cases WHERE ref=?', ref);
  if (!c0) return null;
  const c = refreshSla(c0);
  const app = c.application_id ? get('SELECT * FROM applications WHERE id=?', c.application_id) : null;
  const fields = j(app?.fields, {});
  const details = j(c.details, null);
  const verifs = app ? all('SELECT * FROM verifications WHERE application_id=? ORDER BY id', app.id) : (details?.checks || []).map((x, i) => ({ id: i + 1, check_code: x.code, label: x.label, status: CHECK_STATUS(x), declared: x.declared ?? null, found: x.found ?? null, detail: x.detail ?? null, source: x.doc_id ? 'document:' + x.doc_id : null }));
  const documents = caseDocuments(c, app);
  const findings = annotate(documents, app ? verifs : [], app ? [] : (details?.checks || []));
  const trace = caseTrace(c);
  return { trace,
    case: { ...c, recommendation: j(c.recommendation, {}) }, sla: slaInfo(c), pipeline: PIPELINE,
    application: app ? { ...app, fields, field_sources: j(app.field_sources, {}) } : null,
    documents, findings, waiting: waitingFor(c, j(c.recommendation, {})),
    verifications: verifs, summary: app ? summary(verifs, fields) : (details?.checks || []).filter(x => !x.info).map(x => ({ label: x.label, ok: !!x.ok })),
    risk: riskView(c),
    activity: activity(c),
    reasons: j(c.reasons, []), details,
    decisions: all('SELECT * FROM decisions WHERE case_id=? ORDER BY id', c.id),
    audit: all('SELECT * FROM audit_events WHERE case_ref=? ORDER BY ts, id', ref).map(e => ({ ...e, evidence: j(e.evidence) })),
    alerts: all('SELECT * FROM alerts WHERE case_ref=? ORDER BY id DESC', ref).map(a => ({ ...a, why: j(a.why, []) })),
    g2: c.account_msisdn ? get('SELECT * FROM g2_accounts WHERE msisdn=?', c.account_msisdn) : null,
    g2_requests: all('SELECT * FROM g2_requests WHERE case_ref=? ORDER BY id', ref).map(r => ({ ...r, response: j(r.response) })),
  };
}

const RISK_REC = { OPERATIONAL: 'Standard processing', COMPLIANCE: 'Resolve KYC exceptions before approval', AML_CFT: 'Enhanced due diligence if HIGH', FRAUD: 'Verify identity on a trusted channel', LEGAL: 'Legal review before contract', SLA_BREACH: 'Prioritise in the queue' };
function riskView(c) {
  const rows = all('SELECT * FROM risk_assessments WHERE case_id=? ORDER BY id', c.id).map(r => ({ ...r, factors: j(r.factors, []), confidence: r.confidence ?? Math.max(65, 92 - Math.round((r.score || 0) / 8)), recommendation: r.dimension === 'OVERALL' ? null : ['LOW'].includes(r.level) ? 'No action needed — low risk' : RISK_REC[r.dimension] || null }));
  const sl = slaInfo(c);
  if (sl) {
    const sc = c.resolved_at ? 0 : sl.breach_probability;
    const f = c.resolved_at ? [{ points: 0, label: `Resolved — SLA ${sl.status}` }] : [{ points: Math.round(sc * 0.6), label: `${Math.round(sl.elapsed_ms / Math.max(1, sl.elapsed_ms + sl.remaining_ms) * 100)}% of the SLA consumed` }, { points: Math.round(sc * 0.4), label: `Status ${c.status.replace(/_/g, ' ').toLowerCase()} · owner ${sl.team}` }];
    const ov = rows.findIndex(r => r.dimension === 'OVERALL');
    rows.splice(ov < 0 ? rows.length : ov, 0, { dimension: 'SLA_BREACH', score: sc, level: level(sc), factors: f, confidence: 88, recommendation: c.resolved_at ? `None — SLA ${sl.status}` : sc >= 60 ? RISK_REC.SLA_BREACH : 'On track — keep in normal queue' });
  }
  return rows;
}
function activity(c) {
  const ev = [];
  const conv = c.conv_id ? get('SELECT id FROM conversations WHERE id=?', c.conv_id) : c.application_id ? get('SELECT conv_id id FROM applications WHERE id=?', c.application_id) : null;
  const since = new Date(+new Date(c.created_at) - 20 * 60000).toISOString();
  if (conv?.id) for (const m of all("SELECT sender, kind, content, created_at FROM messages WHERE conv_id=? AND (created_at>=? OR content LIKE ?) ORDER BY id DESC LIMIT 40", conv.id, c.application_id ? '0' : since, '%' + c.ref + '%')) ev.push({ ts: m.created_at, channel: 'TOBi', who: m.sender === 'tobi' ? 'TOBi' : 'Customer', text: m.content });
  for (const n of all('SELECT * FROM notifications WHERE case_ref=? ORDER BY id DESC LIMIT 20', c.ref)) ev.push({ ts: n.created_at, channel: n.channel, who: 'Notification', text: `${n.title} — ${n.body}` });
  if (c.account_msisdn) for (const o of all('SELECT * FROM g2_operations WHERE msisdn=? ORDER BY id DESC LIMIT 20', c.account_msisdn)) ev.push({ ts: o.ts, channel: 'G2', who: o.operator, text: `${o.op.replace(/_/g, ' ')} — ${o.detail || ''}${o.case_ref ? ' · ' + o.case_ref : ''}` });
  if (c.account_msisdn) for (const l of all('SELECT * FROM lifecycle_actions WHERE msisdn=? AND sent_at IS NOT NULL ORDER BY id DESC LIMIT 20', c.account_msisdn)) ev.push({ ts: l.sent_at, channel: 'Lifecycle', who: l.pillar, text: `${l.code.replace(/_/g, ' ').toLowerCase()} — ${l.status}${l.response ? ' · ' + l.response : ''}` });
  return ev.sort((a, b) => String(b.ts).localeCompare(String(a.ts))).slice(0, 80);
}

// ---------- department actions (human-in-the-loop, all persisted & audited) ----------
export const CASE_ACTIONS = {
  REQUEST_EDD: { perm: 'aml.edd', label: 'Request EDD', note: true },
  ADD_MITIGATION: { perm: 'risk.mitigate', label: 'Add mitigation', note: true },
  REQUEST_REVISION: { perm: 'legal.review', label: 'Request revision', note: true },
  ACCEPT_LEGAL: { perm: 'legal.review', label: 'Accept legal recommendation' },
  INITIATE_REMEDIATION: { perm: 'remediation.initiate', label: 'Initiate remediation', note: true },
  CLOSE_CONTROL: { perm: 'control.close', label: 'Close control', note: true },
  AUDIT_FLAG: { perm: 'audit.flag', label: 'Create audit flag', note: true },
  SEND_TO_G2: { perm: 'g2.create', label: 'Send to G2' },
};
export function caseAction(ref, user, action, note = '') {
  const c = get('SELECT * FROM cases WHERE ref=?', ref);
  if (!c) throw new Error('Case not found');
  const def = CASE_ACTIONS[action]; if (!def) throw new Error('Unknown action');
  if (def.note && String(note).trim().length < 5) { const e = new Error('A short note / justification is required'); e.code = 'OVERRIDE_REASON'; throw e; }
  const rec = j(c.recommendation, {});
  const log = (ns) => {
    run('INSERT INTO decisions(case_id,actor,role,action,ai_action,override,reason,created_at) VALUES(?,?,?,?,?,?,?,?)', c.id, user.name, user.role, action, rec.action || null, 0, note, iso());
    audit({ actor: user.name, role: user.role, action: `${def.label}`, case_ref: ref, prev_state: c.status, new_state: ns || c.status, ai: rec.action, human: action, human_decision: note || null, risk: c.risk_score });
  };
  const conv = c.conv_id || (c.application_id ? get('SELECT conv_id FROM applications WHERE id=?', c.application_id)?.conv_id : null);
  if (action === 'REQUEST_EDD') {
    run("UPDATE cases SET status='EDD_REQUESTED', owner_dept='AML', reasons=?, updated_at=? WHERE id=?", s([note]), iso(), c.id); log('EDD_REQUESTED');
    if (conv) tobiSay(conv, `To complete request ${ref}, our compliance team needs: ${note}. You can upload the documents here.`, 'options', { options: ['My requests'] });
  } else if (action === 'ADD_MITIGATION') {
    log(c.status); run("UPDATE alerts SET status='ACKNOWLEDGED', owner=?, updated_at=? WHERE case_ref=? AND dept='RISK' AND status='OPEN'", user.name, iso(), ref);
  } else if (action === 'REQUEST_REVISION') {
    run("UPDATE cases SET status='LEGAL_REVISION', owner_dept='LEGAL', updated_at=? WHERE id=?", iso(), c.id); log('LEGAL_REVISION');
  } else if (action === 'ACCEPT_LEGAL') {
    resolveAlerts({ case_ref: ref }, user.name, 'Legal recommendation accepted');
    if (['LEGAL'].includes(c.owner_dept)) run("UPDATE cases SET owner_dept='OPERATIONS', status='PENDING_REVIEW', updated_at=? WHERE id=?", iso(), c.id);
    log('LEGAL CLEARED');
  } else if (action === 'INITIATE_REMEDIATION') {
    const r2 = nextRef('MP-RMD'); const t0 = now();
    run(`INSERT INTO cases(ref,type,account_msisdn,customer_name,status,stage,owner_dept,priority,risk_score,risk_level,sla_hours,sla_start,sla_due,sla_status,recommendation,source,created_at,updated_at,team,details)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, r2, 'REMEDIATION', c.account_msisdn, c.customer_name, 'OPEN', 'ORCHESTRATE', user.dept, 'HIGH', 40, 'MEDIUM', 168, t0.toISOString(), new Date(+t0 + 168 * HOUR).toISOString(), 'ON_TRACK', s({ action: 'CONTROL_REMEDIATION_REQUIRED', reason: [note], confidence: 90 }), 'SENTINEL', iso(), iso(), 'Internal Control', s({ origin: ref, note }));
    log(`Remediation ${r2}`); return { ok: true, case_ref: r2 };
  } else if (action === 'CLOSE_CONTROL') {
    run("UPDATE alerts SET status='RESOLVED', owner=?, updated_at=? WHERE case_ref=? AND dept='INTERNAL_CONTROL'", user.name, iso(), ref);
    if (c.type === 'REMEDIATION' && !c.resolved_at) run("UPDATE cases SET status='RESOLVED', stage='RESOLVE', resolved_at=?, updated_at=? WHERE id=?", iso(), iso(), c.id);
    log('CONTROL CLOSED');
  } else if (action === 'AUDIT_FLAG') {
    raise({ dept: 'AUDIT', type: 'AUDIT_FLAG', severity: 'MEDIUM', title: `Audit flag: ${ref} — ${c.customer_name}`, detail: note, why: [{ points: 25, label: `Flagged by ${user.name}` }], case_ref: ref, account_msisdn: c.account_msisdn, rule: 'AUDIT_FLAG_CASE_' + c.id + '_' + Date.now() });
    log(c.status);
  } else if (action === 'SEND_TO_G2') {
    if (!c.application_id) throw new Error('Only account-creation cases can be sent to G2');
    if (['RESOLVED', 'REJECTED'].includes(c.status)) throw new Error('Case already closed');
    if (['AML', 'LEGAL'].includes(c.owner_dept)) throw new Error(`Blocked: case is under ${DEPT_NAMES[c.owner_dept]} review`);
    log('SENT TO G2');
    return orchestrateCreation(c.id, user.name);
  }
  return { ok: true, case: get('SELECT ref,status,owner_dept FROM cases WHERE id=?', c.id) };
}
