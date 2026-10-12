// TOBi — conversational onboarding & lifecycle assistant (ConversationAIService + IntentClassificationService).
// State-driven: knows what is collected, missing, documented, conflicting. AI MODE (Claude) or DEMO MODE (rules).
import crypto from 'node:crypto';
import { get, all, run, s, j } from './db.js';
import { iso, now, audit, notify } from './core.js';
import { FIELDS, FIELD_MAP, CONTRACT_TYPES, DOC_TYPES, missingFields, requiredDocs } from './schema.js';
import { saveUpload, extractDocument, appDocuments } from './documents.js';
import { compareValues, verifyApplication, summary } from './verification.js';
import { submitApplication, slaInfo } from './cases.js';
import { tobiSay } from './tobi_out.js';
import { aiEnabled, claude, parseJSON } from './ai.js';
import { normMsisdn, fmtMsisdn, operate } from './g2.js';
import { respondLifecycle, handleRenewal, QUIZ, createSimpleCase } from './lifecycle.js';
import { raise } from './alerts.js';
import { SERVICES, SFIELDS, validateSField, createServiceCase, customerRequests, slaLabel } from './services.js';

const say = tobiSay;
const userSay = (conv_id, content, kind = 'text', meta = null) => run('INSERT INTO messages(conv_id,sender,kind,content,meta,created_at) VALUES(?,?,?,?,?,?)', conv_id, 'user', kind, content, s(meta), iso());

function load(token) {
  const conv = get('SELECT * FROM conversations WHERE token=?', token);
  if (!conv) throw new Error('Conversation not found');
  const app = get('SELECT * FROM applications WHERE id=?', conv.application_id);
  return { conv, app, state: j(conv.state, {}), fields: j(app.fields, {}), sources: j(app.field_sources, {}) };
}
function save(ctx) {
  run('UPDATE conversations SET state=?, updated_at=? WHERE id=?', s(ctx.state), iso(), ctx.conv.id);
  run('UPDATE applications SET fields=?, field_sources=?, updated_at=? WHERE id=?', s(ctx.fields), s(ctx.sources), iso(), ctx.app.id);
}

const MENU = ['Open a merchant account', 'SIM swap', 'Reset my PIN', 'Transaction reversal', 'Partner onboarding', 'Business solutions', 'My requests'];
const EBU = ['ENTERPRISE_DATA', 'CLOSED_USER_GROUP', 'PUBLIC_CLOUD', 'PRIVATE_CLOUD', 'SERVER_HOSTING', 'FLEET_MANAGEMENT', 'VOICE', 'MOBILE_INTERNET', 'FIBER_INTERNET'];
function detectService(t) {
  t = t.toLowerCase().trim();
  if (/my requests?|track|my cases?|my tickets?/.test(t)) return 'REQUESTS';
  if (/^(new request|menu|main menu|start over|something else|other request)\b/.test(t)) return 'MENU';
  if (/download.*form|merchant form|print.*form|my form/.test(t)) return 'FORM';
  for (const [k, v] of Object.entries(SERVICES)) if (t === v.label.toLowerCase()) return k;
  if (/open a merchant|merchant account|become a merchant|accept (m-pesa )?payments/.test(t)) return 'MERCHANT';
  if (/sim swap|swap (my )?sim|lost (my )?(sim|phone)|stolen/.test(t)) return 'SIM_SWAP';
  if (/new sim|sim creation|create (a )?sim|new line/.test(t)) return 'SIM_CREATION';
  if (/reset (my )?pin|forgot (my )?pin|pin (is )?blocked|locked pin/.test(t)) return 'PIN_RESET';
  if (/cash.?out reversal/.test(t)) return 'CASH_OUT_REVERSAL';
  if (/cash.?in reversal/.test(t)) return 'CASH_IN_REVERSAL';
  if (/revers|wrong number|sent (it )?to the wrong|refund my|cancel (a|my) transaction/.test(t)) return 'REVERSAL';
  if (/partner onboarding|become a partner|super agent|vendor|distributor|aggregator/.test(t)) return 'PARTNER_ONBOARDING';
  if (/business solution|enterprise|\bebu\b/.test(t)) return 'EBU';
  if (/cloud/.test(t)) return /private/.test(t) ? 'PRIVATE_CLOUD' : 'PUBLIC_CLOUD';
  if (/fib(er|re)/.test(t)) return 'FIBER_INTERNET';
  if (/closed user group|\bcug\b/.test(t)) return 'CLOSED_USER_GROUP';
  if (/data bundle/.test(t)) return 'ENTERPRISE_DATA';
  if (/hosting|server/.test(t)) return 'SERVER_HOSTING';
  if (/fleet|vehicle/.test(t)) return 'FLEET_MANAGEMENT';
  if (/mobile internet/.test(t)) return 'MOBILE_INTERNET';
  if (/voice|fixed line/.test(t)) return 'VOICE';
  return null;
}
function showMenu(ctx, pre = 'What else can I do for you?') { ctx.state.svc = null; say(ctx.conv.id, pre, 'options', { options: MENU }); }
function showRequests(ctx) {
  const items = customerRequests(get('SELECT * FROM conversations WHERE id=?', ctx.conv.id));
  if (!items.length) return say(ctx.conv.id, "You don't have any request yet. What would you like to do?", 'options', { options: MENU });
  say(ctx.conv.id, `You have ${items.length} request${items.length > 1 ? 's' : ''}. Tap "My requests" at the top anytime for live tracking.`, 'requests', { items: items.slice(0, 6) });
}
function profileFrom(ctx) {
  const f = ctx.fields, p = ctx.state.profile || {};
  return { full_name: p.full_name || f.owner_name, msisdn: p.msisdn || f.phone, id_number: p.id_number || f.id_number, email: p.email || f.email,
    company_name: p.company_name || f.legal_name, contact_name: p.contact_name || p.full_name || f.owner_name, rccm: p.rccm || f.rccm, city: p.city || f.city,
    requester_type: p.requester_type || (ctx.app.status === 'ACTIVE' ? 'Merchant' : null) };
}
function startService(ctx, code) {
  const svc = SERVICES[code];
  const pf = profileFrom(ctx), fields = {}, known = [];
  for (const k of svc.fields) if (pf[k] && !(k === 'requester_type' && code === 'PARTNER_ONBOARDING')) { fields[k] = pf[k]; known.push(SFIELDS[k].label.toLowerCase()); }
  ctx.state.svc = { code, fields, docs: [], checks: [] };
  say(ctx.conv.id, `Sure — ${svc.label}. Target time: ${slaLabel(svc.sla)}, handled by ${svc.team}.${known.length ? ` I already have your ${known.join(', ')} ✓` : ''}`);
  askService(ctx);
}
function askService(ctx) {
  const sv = ctx.state.svc, svc = SERVICES[sv.code];
  const miss = svc.fields.find(k => !sv.fields[k]);
  if (miss) { sv.pending = miss; const f = SFIELDS[miss]; return say(ctx.conv.id, f.q, f.options ? 'options' : 'text', f.options ? { options: f.options } : null); }
  sv.pending = null;
  const need = (svc.docs || []).filter(t => !sv.docs.some(d => d.doc_type === t));
  if (need.length && !sv.skip_docs) return say(ctx.conv.id, `Please send a photo of your ${need.map(t => DOC_TYPES[t].label).join(' and ')} — I'll check it instantly.`, 'upload_request', { doc_types: need, service: true });
  const rows = svc.fields.map(k => [SFIELDS[k].label, sv.fields[k]]);
  for (const d of sv.docs) rows.push([DOC_TYPES[d.doc_type]?.label || 'Document', d.ok ? 'Verified ✓' : 'Received ⚠']);
  rows.push(['Target time', slaLabel(svc.sla)], ['Handled by', svc.team]);
  say(ctx.conv.id, 'Here is your request — shall I submit it?', 'card', { title: svc.label.toUpperCase() + ' · SUMMARY', rows });
  say(ctx.conv.id, 'Everything correct?', 'options', { options: ['Submit request', 'Cancel'] });
}
function submitService(ctx) {
  const sv = ctx.state.svc, svc = SERVICES[sv.code];
  const docs = sv.docs.map(d => get('SELECT * FROM documents WHERE id=?', d.id)).filter(Boolean);
  const { case: c, outcome } = createServiceCase({ code: sv.code, fields: sv.fields, conv_id: ctx.conv.id, docs, checks: sv.checks });
  ctx.state.profile = { ...(ctx.state.profile || {}), ...Object.fromEntries(['full_name', 'msisdn', 'id_number', 'email', 'company_name', 'contact_name', 'rccm', 'city', 'requester_type'].filter(k => sv.fields[k]).map(k => [k, sv.fields[k]])) };
  if (sv.fields.msisdn && !ctx.conv.msisdn) run('UPDATE conversations SET msisdn=? WHERE id=?', normMsisdn(sv.fields.msisdn), ctx.conv.id);
  ctx.state.svc = null;
  const label = { RESOLVED: 'Completed ✓', REJECTED: 'Not approved', AWAITING_CUSTOMER: 'Waiting for your information', PENDING_REVIEW: 'In review by our team' }[c.status] || c.status;
  say(ctx.conv.id, `Request received ✓ Your case ID is ${c.ref}.`, 'card', { title: 'REQUEST CREATED', rows: [['Case ID', c.ref], ['Service', svc.label], ['Target time', slaLabel(svc.sla)], ['Due by', new Date(c.sla_due).toUTCString().slice(5, 22)], ['Assigned to', svc.team], ['Status', label]] });
  if (c.status === 'RESOLVED') say(ctx.conv.id, sv.code === 'PIN_RESET' ? `Done ✅ Identity verified against G2 — your PIN is reset. A temporary PIN is on its way by SMS to ${sv.fields.msisdn}. Change it at first use.` : 'Done ✅ Your request is completed.', 'options', { options: ['My requests', 'New request'] });
  else if (c.status === 'REJECTED') say(ctx.conv.id, `I'm sorry — I can't approve this request as it is:\n• ${outcome.reasons.join('\n• ')}\nYou can correct it and start a new request anytime.`, 'options', { options: ['New request', 'Talk to an agent'] });
  else if (c.status === 'AWAITING_CUSTOMER') say(ctx.conv.id, `One thing to fix before we can process it: ${outcome.reasons.join('; ')}. Start a new request with the right details, or talk to an agent.`, 'options', { options: ['My requests', 'New request'] });
  else say(ctx.conv.id, `The ${svc.team} team has it. I'll message you here at every step — you can track it in "My requests".`, 'options', { options: ['My requests', 'New request'] });
}
function handleServiceText(ctx, text) {
  const sv = ctx.state.svc;
  if (/^cancel\b/i.test(text)) return showMenu(ctx, 'Request cancelled. Anything else?');
  if (/^submit( request)?\b/i.test(text)) { const svc = SERVICES[sv.code]; if (svc.fields.every(k => sv.fields[k])) return submitService(ctx); }
  if (/continue without/i.test(text)) { sv.skip_docs = true; return askService(ctx); }
  if (sv.pending) {
    const v = validateSField(sv.pending, text);
    if (v == null) { const f = SFIELDS[sv.pending]; return say(ctx.conv.id, `Hmm, that doesn't look like a valid ${f.label.toLowerCase()}. ${f.q}`, f.options ? 'options' : 'text', f.options ? { options: f.options } : null); }
    sv.fields[sv.pending] = v;
    audit({ actor: 'TOBi', system: 'TOBi', action: 'Information collected', entity: 'conversation:' + ctx.conv.id, new_state: `${SERVICES[sv.code].label}: ${SFIELDS[sv.pending].label}` });
  }
  askService(ctx);
}
function serviceUpload(ctx, doc, ex) {
  const sv = ctx.state.svc;
  const pc = ex.precheck || [];
  let ok = pc.every(c => c.ok);
  if (ex.doc_type === 'NATIONAL_ID') {
    const idDoc = (ex.confidence?.id_number ?? 0.8) >= 0.72 ? String(ex.fields.id_number || '').toUpperCase() : '', idDec = String(sv.fields.id_number || '').toUpperCase();
    if (ex.fields.id_number && !idDoc) sv.checks.push({ code: 'ID_REVIEW', label: 'ID number not sharp on the photo — verified by an agent', ok: true });
    if (idDoc && !sv.fields.id_number) sv.fields.id_number = idDoc;
    else if (idDoc && idDec && idDoc !== idDec) { sv.checks.push({ code: 'ID_MATCH', label: `ID number on document (${idDoc}) ≠ declared (${idDec})`, ok: false }); ok = false; }
    if (ex.fields.owner_name && !sv.fields.full_name) sv.fields.full_name = String(ex.fields.owner_name).replace(/\b\w+/g, w => w[0] + w.slice(1).toLowerCase());
    const exp = pc.find(c => c.code === 'EXPIRY'); if (exp && !exp.ok) sv.checks.push({ code: 'ID_EXPIRED', label: 'ID document expired', ok: false });
  }
  if (ex.doc_type === 'RCCM') { if (ex.fields.legal_name && !sv.fields.company_name) sv.fields.company_name = ex.fields.legal_name; if (ex.fields.rccm && !sv.fields.rccm) sv.fields.rccm = ex.fields.rccm; }
  sv.docs.push({ id: doc.id, doc_type: ex.doc_type, ok });
  askService(ctx);
}
function askConfirm(ctx) {
  const c = ctx.state.confirm[0];
  ctx.state.pending_confirm = true; ctx.state.pending_field = null; ctx.state.pending_group = null;
  say(ctx.conv.id, `The photo is not very sharp on one detail: I read your ${c.label} as “${c.value}”. Is that right? If not, just type the correct value.`, 'options', { options: ["Yes, that's right", 'No, let me type it'] });
}
// returns true if the message was consumed by the confirmation / manual-capture logic
function handleConfirm(ctx, text) {
  const t = text.trim();
  if (ctx.state.last_unreadable && /retake|another photo|new photo/i.test(t)) { const d = ctx.state.last_unreadable; say(ctx.conv.id, 'Sure — take your time. Tap 📎 when ready.', 'upload_request', { doc_types: d.doc_type && d.doc_type !== 'OTHER' ? [d.doc_type] : ['RCCM', 'NATIONAL_ID'] }); return true; }
  if (ctx.state.last_unreadable && /type the details|type it|manual|by hand|enter.*details/i.test(t)) {
    const d = ctx.state.last_unreadable; run("UPDATE documents SET status='MANUAL_REVIEW' WHERE id=?", d.doc_id); ctx.state.last_unreadable = null;
    audit({ actor: 'Customer', system: 'TOBi', action: 'Document details typed manually (unreadable photo)', entity: 'document:' + d.doc_id, new_state: 'MANUAL_REVIEW', rule: 'HUMAN_VERIFICATION_REQUIRED' });
    ctx.state.stage = 'COLLECTING'; askNext(ctx, "No problem — I'll ask you the details, and our team will check the document by eye before approval."); return true;
  }
  if (ctx.state.typing_for) {   // customer typed the correct value after rejecting the OCR reading
    const tf = ctx.state.typing_for; const v = normalizeValue(tf.key, t, ctx.fields);
    if (v == null) {
      tf.tries = (tf.tries || 0) + 1;
      if (tf.tries >= 2 || /^(skip|later|i don'?t know|not sure)/i.test(t)) { ctx.state.typing_for = null; nextConfirmOrContinue(ctx, `No problem — let's continue, I'll ask for your ${tf.label} again later.`); return true; }
      say(ctx.conv.id, `Hmm, that doesn't look like a valid ${tf.label}${tf.key === 'id_nat' ? ' (format like 01-910-N48213P)' : tf.key === 'rccm' ? ' (format like CD/KIN/RCCM/23-B-04512)' : tf.key === 'tax_number' ? ' (format like A1234567K)' : ''}. Please type it exactly as on the document, or say "skip".`); return true;
    }
    ctx.fields[tf.key] = v; ctx.sources[tf.key] = 'declared'; ctx.sources[tf.key + '__clarified'] = { chose: 'declared', doc_value: tf.value, declared_value: v, at: iso(), reason: 'OCR misread corrected by customer' };
    audit({ actor: 'Customer', system: 'TOBi', action: 'OCR reading corrected by customer', entity: 'application:' + ctx.app.id, new_state: `${tf.label}: "${tf.value}" → "${v}"` });
    ctx.state.typing_for = null; nextConfirmOrContinue(ctx, 'Thanks, corrected ✓'); return true;
  }
  if (!ctx.state.pending_confirm || !ctx.state.confirm?.length) return false;
  const c = ctx.state.confirm[0];
  if (/^(y|yes|oui|correct|right|that'?s right|exact)/i.test(t)) {
    ctx.state.confirm.shift(); ctx.state.pending_confirm = false;
    ctx.fields[c.key] = c.value; ctx.sources[c.key] = c.doc; ctx.sources[c.key + '__verified'] = 'customer-confirmed';
    audit({ actor: 'Customer', system: 'TOBi', action: 'Low-confidence reading confirmed by customer', entity: 'application:' + ctx.app.id, new_state: `${c.label}: ${c.value}` });
    nextConfirmOrContinue(ctx, 'Perfect ✓'); return true;
  }
  ctx.state.confirm.shift(); ctx.state.pending_confirm = false;
  if (/^(n|no|non|wrong|incorrect|let me type)/i.test(t) && t.length < 30) { ctx.state.typing_for = c; say(ctx.conv.id, `OK — please type your ${c.label} exactly as on the document.`); return true; }
  ctx.state.typing_for = c; return handleConfirm(ctx, t);   // they directly typed the right value
}
function nextConfirmOrContinue(ctx, pre) { if (ctx.state.confirm?.length) { say(ctx.conv.id, pre); return askConfirm(ctx); } askNext(ctx, pre); }

function newApplication(ctx) {
  const a = run('INSERT INTO applications(status,fields,field_sources,created_at,updated_at,conv_id) VALUES(?,?,?,?,?,?)', 'DRAFT', s({}), s({}), iso(), iso(), ctx.conv.id);
  run('UPDATE conversations SET application_id=? WHERE id=?', a.lastInsertRowid, ctx.conv.id);
  ctx.app = get('SELECT * FROM applications WHERE id=?', a.lastInsertRowid); ctx.fields = {}; ctx.sources = {};
  Object.assign(ctx.state, { stage: 'GREETING', conflicts: [], pending_field: null, pending_group: null, skip_docs: false, asked_rccm: false });
}
function merchantIntro(ctx) {
  if (ctx.app.status !== 'DRAFT') newApplication(ctx);
  ctx.state.stage = 'GREETING'; ctx.state.svc = null;
  say(ctx.conv.id, "Great — let's open your M-Pesa Business (merchant) account. Target time: 48 hours.");
  say(ctx.conv.id, "Fastest way: send me a photo or PDF of your RCCM certificate and your ID card — I'll read them and fill in the application for you. Or just tell me about your business.", 'options', { options: ['Upload my documents', 'Tell you about my business'] });
}
// returns true if handled
function route(ctx, text) {
  const r = detectService(text);
  if (!r) return false;
  if (r === 'REQUESTS') { showRequests(ctx); return true; }
  if (r === 'MENU') { showMenu(ctx); return true; }
  if (r === 'FORM') { if (ctx.app.status === 'DRAFT') say(ctx.conv.id, 'Your merchant form will be available once your application is submitted.'); else say(ctx.conv.id, 'Here is your completed merchant form (BCF) — you can print it or save it as PDF.', 'link', { href: `/api/tobi/${ctx.conv.token}/form`, label: 'Open my merchant form' }); return true; }
  if (r === 'MERCHANT') { if (['SUBMITTED', 'ACTIVE'].includes(ctx.app.status)) { const c = ctx.app.case_id && get('SELECT ref FROM cases WHERE id=?', ctx.app.case_id); say(ctx.conv.id, `You already have a merchant application${c ? ' (' + c.ref + ')' : ''}. Ask me "status" anytime.`); return true; } merchantIntro(ctx); return true; }
  if (r === 'REVERSAL') { say(ctx.conv.id, 'Which transaction do you want reversed?', 'options', { options: ['Cash-out reversal', 'Cash-in reversal'] }); return true; }
  if (r === 'EBU') { say(ctx.conv.id, 'Our business solutions — which one interests you?', 'options', { options: EBU.map(k => SERVICES[k].label) }); return true; }
  if (SERVICES[r] && r !== 'MERCHANT_CREATION') { startService(ctx, r); return true; }
  return false;
}

export function startConversation({ msisdn = null } = {}) {
  const token = crypto.randomBytes(12).toString('hex');
  const a = run('INSERT INTO applications(status,fields,field_sources,created_at,updated_at) VALUES(?,?,?,?,?)', 'DRAFT', s({}), s({}), iso(), iso());
  const c = run('INSERT INTO conversations(token,channel,msisdn,application_id,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?)', token, 'TOBI_WEB', msisdn, a.lastInsertRowid, s({ stage: 'MENU', conflicts: [] }), iso(), iso());
  run('UPDATE applications SET conv_id=? WHERE id=?', c.lastInsertRowid, a.lastInsertRowid);
  say(c.lastInsertRowid, "Hi, I'm TOBi 👋 your M-Pesa assistant. I can open an account, solve a problem on your line, or track your requests. What do you need today?", 'options', { options: MENU });
  audit({ actor: 'TOBi', system: 'TOBi', action: 'Conversation started', entity: 'application:' + a.lastInsertRowid });
  return token;
}

// ---------------- field handling ----------------
const YES = /^(y|yes|yeah|yep|oui|ok|okay|sure|i do|i accept|accept|agreed?|correct|true)\b/i;
const NO = /^(n|no|nope|non|none|not|never|i don'?t|nothing|n\/a)\b/i;
function normalizeValue(key, raw, fields) {
  let v = String(raw ?? '').trim().replace(/[.!]+$/, '');
  if (!v) return null;
  const f = FIELD_MAP[key];
  if (f?.type === 'yesno') { if (/^(yes|no)$/i.test(v)) return v[0].toUpperCase() + v.slice(1).toLowerCase(); if (YES.test(v)) return 'Yes'; if (NO.test(v)) return 'No'; return null; }
  if (key === 'contract_type') {
    const u = v.toUpperCase();
    if (CONTRACT_TYPES[u]) return u;
    if (/LIGHT/.test(u)) return 'MIL'; if (/STREET|RUE|\bMR\b/.test(u)) return 'MR'; if (/DEPEND(?!ENT\s*INDEP)|\bMD\b/.test(u) && !/INDEPEND/.test(u)) return 'MD';
    if (/AUTONOM|\bMA\b/.test(u)) return 'MA'; if (/INDEPEND|\bMI\b|SINGLE|SHOP|STORE/.test(u)) return 'MI'; return null;
  }
  if (key === 'legal_form') { if (/INDIVID|SOLE|ETS|ESTABLISH|MYSELF|PERSONAL/i.test(v)) return 'INDIVIDUAL'; if (/COMPAN|SARL|\bSA\b|SAS|LTD|REGISTERED|CORP/i.test(v)) return 'COMPANY'; return null; }
  if (key === 'access_channel') { if (/APP/i.test(v)) return 'APP'; if (/API|INTEGRAT|SYSTEM|POS/i.test(v)) return 'INTEGRATED'; if (/USSD|\*|PHONE|CODE/i.test(v)) return 'USSD'; return null; }
  if (key === 'phone') { const d = normMsisdn(v); return d.length === 12 ? fmtMsisdn(d) : null; }
  if (key === 'email') { const m = v.match(/[\w.+-]+@[\w-]+\.[\w.]+/); return m ? m[0].toLowerCase() : null; }
  if (key === 'monthly_turnover_usd') { const m = v.replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*(k|thousand|m|million)?/i); if (!m) return null; let n = parseFloat(m[1]); if (/^k|thousand/i.test(m[2] || '')) n *= 1000; if (/^m/i.test(m[2] || '')) n *= 1e6; return String(Math.round(n)); }
  if (key === 'representative_name' && /^(me|myself|i am|it'?s me|same|the owner|owner)\b/i.test(v)) return fields.owner_name || null;
  if (['tax_number', 'bank_name', 'other_mm_operator'].includes(key) && NO.test(v)) return 'None';
  if (key === 'tax_number') { const m = v.toUpperCase().match(/\bA\s?\d{7}\s?[A-Z]\b/); return m ? m[0].replace(/\s/g, '') : null; }
  if (key === 'rccm') { const m = v.match(RX.rccm); return m ? m[0].toUpperCase().replace(/\s+/g, '') : null; }
  if (key === 'id_nat') { const m = v.toUpperCase().match(RX.id_nat); return m ? m[0] : null; }
  return v;
}

// returns 'set' | 'conflict' | 'same'
function setField(ctx, key, value, source) {
  if (!FIELD_MAP[key] || value == null || value === '') return null;
  const cur = ctx.fields[key], curSrc = ctx.sources[key] || '';
  if (cur != null && cur !== '' && source.startsWith('document') !== curSrc.startsWith('document')) {
    const cmp = compareValues(key, cur, value);
    if (cmp !== 'MATCH') {
      const docVal = source.startsWith('document') ? value : cur, decVal = source.startsWith('document') ? cur : value;
      const docSrc = source.startsWith('document') ? source : curSrc;
      ctx.state.conflicts = (ctx.state.conflicts || []).filter(c => c.field !== key);
      ctx.state.conflicts.push({ field: key, doc_value: docVal, declared_value: decVal, doc: docSrc, status: cmp });
      audit({ actor: 'Sentinel AI', action: 'Inconsistency detected', entity: 'application:' + ctx.app.id, new_state: `${FIELD_MAP[key].label}: declared "${decVal}" vs document "${docVal}"`, rule: 'CROSS_DOCUMENT_VERIFICATION' });
      return 'conflict';
    }
    if (source.startsWith('document')) { ctx.sources[key + '__verified'] = source; }
    return 'same';
  }
  ctx.fields[key] = value; ctx.sources[key] = source;
  return 'set';
}

// ---------------- rule-based understanding (DEMO MODE) ----------------
const RX = {
  phone: /(?:\+?243|0)\s?[89]\d(?:[\s.-]?\d){7}/, email: /[\w.+-]+@[\w-]+\.[\w.]+/,
  rccm: /CD\s*\/\s*[A-Z]{3}\s*\/\s*RCCM\s*\/\s*\d{2}\s*-\s*[A-Z]\s*-\s*\d{3,6}/i, id_nat: /\b\d{2}-[A-Z0-9]{2,4}-[A-Z0-9]{5,9}\b/, nif: /\bA\d{7}[A-Z]\b/,
};
function rulesUnderstand(ctx, text) {
  const t = text.trim();
  if (/status|where is my (application|request)|my application|any news|update on/i.test(t)) return { intent: 'STATUS' };
  if (/talk to (an? )?(agent|human|person)|speak to|call me/i.test(t)) return { intent: 'HUMAN' };
  if (/reset (my )?pin|forgot (my )?pin/i.test(t)) return { intent: 'PIN_RESET' };
  if (/^upload|send (my )?doc|upload my documents/i.test(t)) return { intent: 'UPLOAD' };
  if (/^tell you about my business/i.test(t)) return { intent: 'ABOUT' };
  const updates = {};
  const p = t.match(RX.phone); if (p) updates.phone = p[0];
  const e = t.match(RX.email); if (e) updates.email = e[0];
  const r = t.match(RX.rccm); if (r) updates.rccm = r[0];
  const n = t.match(RX.id_nat); if (n && !r) updates.id_nat = n[0];
  const x = t.match(RX.nif); if (x) updates.tax_number = x[0];
  const pend = ctx.state.pending_field;
  if (ctx.state.pending_group === 'COMPLIANCE') {
    if (/none|no to all|all no|^no\b|none of these/i.test(t)) Object.assign(updates, { pep: 'No', sanctions: 'No', convictions: 'No' });
    else if (/yes|one applies/i.test(t)) return { intent: 'COMPLIANCE_DETAIL', updates };
  } else if (pend && !(pend in updates) && (t.split(/\s+/).length <= 9 || FIELD_MAP[pend]?.type || ['business_activity','address','source_of_funds'].includes(pend))) {
    const v = normalizeValue(pend, t, ctx.fields);
    if (v != null) updates[pend] = v;
  }
  // light free-text cues (introductions)
  const who = t.match(/\b(?:[Ii]'?m|[Ii] am|[Mm]y name is|[Tt]his is)\s+([A-Z][\w'’-]+(?:\s+[A-Z][\w'’-]+){0,3})/);
  if (who && !ctx.fields.owner_name) updates.owner_name = who[1];
  const biz = t.match(/\b(?:[Ii] run|[Ii] own|[Ii] have|[Ww]e run|[Ww]e own|[Mm]y (?:shop|business|company|store) is(?: called)?)\s+(?:a |an |the )?([A-Z][\w'’&.-]*(?:\s+[A-Z0-9][\w'’&.-]*){0,4})/);
  if (biz) { const nm = biz[1].replace(/\s+(in|at|on)$/i, ''); if (/\b(SARL|SA|SAS|SARLU|ETS)\b/i.test(nm)) { if (!ctx.fields.legal_name) updates.legal_name = nm.toUpperCase(); if (!ctx.fields.trading_name) updates.trading_name = nm.replace(/\b(SARL|SA|SAS|SARLU|ETS)\b/ig, '').trim(); if (!ctx.fields.legal_form) updates.legal_form = /ETS/i.test(nm) ? 'INDIVIDUAL' : 'COMPANY'; } else if (!ctx.fields.trading_name) updates.trading_name = nm; }
  const COMM = ['Gombe', 'Limete', 'Kintambo', 'Ngaliema', 'Bandalungwa', 'Lingwala', 'Kalamu', 'Masina', 'Lemba', 'Matete', 'Kasa-Vubu', 'Barumbu', 'Ngiri-Ngiri', 'Kinshasa', 'Selembao', 'Kimbanseke', 'Ndjili', 'Mont-Ngafula', 'Makala', 'Bumbu', 'Kisenso', 'Ngaba', 'Nsele', 'Maluku'];
  const cm = t.match(new RegExp('\\b(?:in|at)\\s+(' + COMM.join('|') + ')\\b', 'i'));
  if (cm && !ctx.fields.commune && pend !== 'commune') { updates.commune = COMM.find(c => c.toLowerCase() === cm[1].toLowerCase()); if (!ctx.fields.city) updates.city = 'Kinshasa'; }
  if (!updates.business_activity && /\b(sell|selling|shop|store|restaurant|pharmacy|boutique)\b/i.test(t) && !ctx.fields.business_activity && pend !== 'business_activity' && t.length > 12) {
    const m = t.match(/\b(?:sell|selling)\s+([^.,;]+)/i); if (m) updates.business_activity = m[1].trim();
  }
  return { intent: Object.keys(updates).length ? 'ANSWER' : 'UNKNOWN', updates };
}

// ---------------- AI understanding (AI MODE) ----------------
async function aiUnderstand(ctx, text) {
  const missing = missingFields(ctx.fields).map(f => f.key);
  const hist = all('SELECT sender, content FROM messages WHERE conv_id=? ORDER BY id DESC LIMIT 14', ctx.conv.id).reverse().map(m => `${m.sender === 'tobi' ? 'TOBi' : 'Customer'}: ${m.content}`).join('\n');
  const docs = appDocuments(ctx.app.id).map(d => ({ type: d.doc_type, fields: d.ex_fields }));
  const schema = FIELDS.map(f => `${f.key} (${f.label}${f.type === 'yesno' ? '; Yes|No' : ''}${f.options ? '; one of ' + f.options.map(o => o.v).join('|') : ''})`).join('\n');
  const sys = `You are TOBi, Vodacom DRC's friendly M-Pesa assistant, onboarding a MERCHANT in English. Be warm, concise (max 2 short sentences), one question at a time (you may group 2 closely related questions). Never ask for something already known. Explain terms if asked (RCCM = trade register number, ID NAT = national identification number, NIF = tax number). Never invent values.
FIELDS (key (label)):\n${schema}
Return ONLY JSON: {"intent":"ANSWER|STATUS|HUMAN|PIN_RESET|UPLOAD|QUESTION|SMALLTALK","updates":{"key":"value"},"conflict_choice":{"field":"key","use":"document|declared"}|null,"reply":"what TOBi says next (ask the next most useful missing item)","quick_replies":["optional short options"]}
Rules: extract every field value the customer gives, even several at once. Values for contract_type must be codes (MI, MD, MR, MA, MIL); legal_form COMPANY|INDIVIDUAL; access_channel USSD|APP|INTEGRATED; yes/no fields "Yes"/"No". "me" as representative = the owner name. If documents already supply values, don't ask for them. If there are pending conflicts, resolve them first (ask which value is correct, or read the customer's choice into conflict_choice).`;
  const user = `CURRENT VALUES: ${JSON.stringify(ctx.fields)}
MISSING REQUIRED (in order): ${missing.join(', ') || 'none'}
DOCUMENTS: ${JSON.stringify(docs)}
PENDING CONFLICTS: ${JSON.stringify(ctx.state.conflicts || [])}
CONVERSATION:\n${hist}\nCustomer (latest): ${text}`;
  const out = parseJSON(await claude({ system: sys, messages: [{ role: 'user', content: user }], maxTokens: 700 }));
  const updates = {};
  for (const [k, v] of Object.entries(out.updates || {})) { const nv = normalizeValue(k, v, { ...ctx.fields, ...updates }); if (nv != null) updates[k] = nv; }
  return { intent: out.intent || 'ANSWER', updates, conflict_choice: out.conflict_choice, reply: out.reply, quick_replies: out.quick_replies };
}

// ---------------- next step ----------------
function optionsFor(f) { return f.type === 'yesno' ? ['Yes', 'No'] : f.options ? f.options.map(o => o.l) : null; }
function askConflict(ctx) {
  const c = ctx.state.conflicts[0];
  const f = FIELD_MAP[c.field];
  const docId = String(c.doc).split(':')[1];
  const d = docId ? get('SELECT doc_type FROM documents WHERE id=?', docId) : null;
  say(ctx.conv.id, `Quick check ⚠ — your ${DOC_TYPES[d?.doc_type]?.label || 'document'} shows ${f.label} "${c.doc_value}", but you told me "${c.declared_value}". Which one is correct?`, 'conflict',
    { field: c.field, options: [{ use: 'document', label: `${c.doc_value} (as on document)` }, { use: 'declared', label: `${c.declared_value} (as I said)` }] });
  ctx.state.pending_field = null; ctx.state.pending_group = null;
}
function askNext(ctx, prefaceFromAI = null, aiQuick = null) {
  if (ctx.state.conflicts?.length) { if (prefaceFromAI) say(ctx.conv.id, prefaceFromAI); return askConflict(ctx); }
  const miss = missingFields(ctx.fields);
  const docsMissing = requiredDocs(ctx.fields).filter(t => !appDocuments(ctx.app.id).some(d => d.doc_type === t));
  if (!miss.length) {
    if (docsMissing.length && !ctx.state.skip_docs) {
      say(ctx.conv.id, (prefaceFromAI ? prefaceFromAI + ' ' : '') + `Almost done! I still need: ${docsMissing.map(t => DOC_TYPES[t].label).join(', ')}. You can take a photo now.`, 'upload_request', { doc_types: docsMissing });
      ctx.state.pending_field = null; return;
    }
    return showReview(ctx, prefaceFromAI);
  }
  const comp = ['pep', 'sanctions', 'convictions'];
  if (comp.every(k => miss.some(f => f.key === k)) && miss[0].section === 'Compliance questionnaire') {
    ctx.state.pending_group = 'COMPLIANCE'; ctx.state.pending_field = null;
    return say(ctx.conv.id, (prefaceFromAI && aiEnabled() ? prefaceFromAI : 'Now a short compliance check (required by law n°22/068).') + '\nDoes any of these apply to the owner, partners, shareholders or directors?\n• Politically exposed person (PEP) or linked to a public official\n• Asset freeze, sanctions or terrorism listing\n• Conviction for money laundering, corruption, terrorist financing or economic crime', 'options',
      { options: ['None of these apply', 'Yes, one applies'] });
  }
  const f = miss[0];
  ctx.state.pending_field = f.key; ctx.state.pending_group = null;
  if (prefaceFromAI && aiEnabled()) return say(ctx.conv.id, prefaceFromAI, aiQuick?.length || optionsFor(f) ? 'options' : 'text', aiQuick?.length ? { options: aiQuick } : optionsFor(f) ? { options: optionsFor(f) } : null);
  const opts = optionsFor(f);
  say(ctx.conv.id, (prefaceFromAI ? prefaceFromAI + ' ' : '') + f.q, opts ? 'options' : 'text', opts ? { options: opts } : null);
}
function showReview(ctx, preface) {
  const verifs = verifyApplication(get('SELECT * FROM applications WHERE id=?', ctx.app.id));
  const sum = summary(verifs, ctx.fields);
  ctx.state.stage = 'REVIEW'; ctx.state.pending_field = null;
  const ok = sum.every(x => x.ok);
  say(ctx.conv.id, (preface ? preface + ' ' : '') + (ok ? "All checks passed ✅ Here's your application — please review and submit." : 'Here is your application. Some items need attention — you can still submit and our team will help.'), 'review',
    { summary: sum, ready: ok });
}

// ---------------- public handlers ----------------
export async function handleText(token, text) {
  const ctx = load(token);
  text = String(text || '').slice(0, 1000);
  if (!text.trim()) return;
  userSay(ctx.conv.id, text);
  if (ctx.state.svc) {
    const r = detectService(text);
    if (r && !['REQUESTS', 'FORM'].includes(r) && !/^(submit|cancel)/i.test(text) && !(ctx.state.svc.pending && SFIELDS[ctx.state.svc.pending]?.options)) { ctx.state.svc = null; route(ctx, text); return save(ctx); }
    if (r === 'REQUESTS' || r === 'FORM') { route(ctx, text); return save(ctx); }
    handleServiceText(ctx, text); return save(ctx);
  }
  if (ctx.app.status === 'DRAFT' && handleConfirm(ctx, text)) return save(ctx);
  if (['SUBMITTED', 'ACTIVE', 'REJECTED'].includes(ctx.app.status) || ctx.state.stage === 'SUBMITTED') {
    if (/pin/i.test(text)) { const acc = get('SELECT * FROM g2_accounts WHERE msisdn=?', normMsisdn(ctx.fields.phone)); if (acc && ctx.app.status === 'ACTIVE') { supportPinReset(ctx, acc); return save(ctx); } }
    if (route(ctx, text)) return save(ctx);
    if (ctx.app.status === 'REJECTED' && /new|again|restart|re-?apply/i.test(text)) { merchantIntro(ctx); return save(ctx); }
    await afterSubmit(ctx, text); return save(ctx);
  }
  if (['MENU', 'GREETING'].includes(ctx.state.stage || 'MENU') || !ctx.state.stage) {
    if (route(ctx, text)) return save(ctx);
    if (ctx.state.stage === 'MENU' && !/business|shop|rccm|sarl|merchant|upload|tell you/i.test(text)) {
      const u0 = rulesUnderstand(ctx, text);
      if (u0.intent === 'UNKNOWN') { say(ctx.conv.id, "I can help you with any of these — just pick one or tell me in your own words:", 'options', { options: MENU }); return save(ctx); }
    }
  } else if (/my requests?|track my|^menu$|^new request$/i.test(text)) { route(ctx, text); return save(ctx); }
  let u;
  if (aiEnabled()) { try { u = await aiUnderstand(ctx, text); } catch (e) { console.warn('AI conversation failed, rules fallback:', e.message); } }
  if (!u) u = rulesUnderstand(ctx, text);
  if (u.intent === 'STATUS') { say(ctx.conv.id, "You haven't submitted an application yet — let's finish it together. I'll ask only what's missing."); askNext(ctx); return save(ctx); }
  if (u.intent === 'HUMAN') { say(ctx.conv.id, 'Sure — a Vodacash agent can call you back. Meanwhile, I can keep filling your application so nothing is lost.'); raise({ dept: 'OPERATIONS', type: 'CALLBACK', severity: 'LOW', title: 'Customer requested a callback (onboarding)', detail: `Application #${ctx.app.id}`, rule: 'CALLBACK_' + ctx.app.id }); askNext(ctx); return save(ctx); }
  if (u.intent === 'UPLOAD') { ctx.state.stage = 'COLLECTING'; say(ctx.conv.id, 'Perfect — tap 📎 to take a photo or choose a file (RCCM certificate, ID card, proof of address). I read them instantly.', 'upload_request', { doc_types: ['RCCM', 'NATIONAL_ID'] }); return save(ctx); }
  if (u.intent === 'ABOUT') { ctx.state.stage = 'COLLECTING'; askNext(ctx, 'Great, tell me in your own words.'); return save(ctx); }
  if (u.intent === 'COMPLIANCE_DETAIL') { ctx.state.pending_group = null; ctx.state.pending_field = 'pep'; say(ctx.conv.id, 'Thanks for telling me. Let\'s take them one by one. ' + FIELD_MAP.pep.q, 'options', { options: ['Yes', 'No'] }); return save(ctx); }
  ctx.state.stage = 'COLLECTING';
  if (u.conflict_choice?.field) resolveConflict(ctx, u.conflict_choice.field, u.conflict_choice.use, false);
  const results = Object.entries(u.updates || {}).map(([k, v]) => [k, setField(ctx, k, v, 'declared')]);
  if (results.length) audit({ actor: 'TOBi', system: 'TOBi', action: 'Information collected', entity: 'application:' + ctx.app.id, new_state: results.map(([k]) => FIELD_MAP[k]?.label).join(', '), evidence: { mode: aiEnabled() ? 'AI' : 'RULES' } });
  if (!results.length && !u.reply && !u.conflict_choice) {
    const pf = ctx.state.pending_field && FIELD_MAP[ctx.state.pending_field];
    say(ctx.conv.id, pf ? `Sorry, I didn't catch that. ${pf.q}` : "Sorry, I didn't catch that — could you rephrase?", pf && optionsFor(pf) ? 'options' : 'text', pf && optionsFor(pf) ? { options: optionsFor(pf) } : null);
    return save(ctx);
  }
  const ack = !aiEnabled() && results.some(([, r]) => r === 'set') ? pickAck() : null;
  askNext(ctx, u.reply || ack, u.quick_replies);
  save(ctx);
}
const ACKS = ['Got it.', 'Thanks!', 'Perfect.', 'Noted ✓', 'Great.'];
let ackI = 0; const pickAck = () => ACKS[ackI++ % ACKS.length];

function resolveConflict(ctx, field, use, announce = true) {
  const c = (ctx.state.conflicts || []).find(x => x.field === field);
  if (!c) return;
  ctx.fields[field] = use === 'document' ? c.doc_value : c.declared_value;
  ctx.sources[field] = use === 'document' ? c.doc : 'declared';
  ctx.sources[field + '__clarified'] = { chose: use, doc_value: c.doc_value, declared_value: c.declared_value, at: iso() };
  ctx.state.conflicts = ctx.state.conflicts.filter(x => x.field !== field);
  audit({ actor: 'Customer', system: 'TOBi', action: 'Inconsistency clarified by applicant', entity: 'application:' + ctx.app.id, new_state: `${FIELD_MAP[field].label} = "${ctx.fields[field]}" (${use === 'document' ? 'document value' : 'declared value'})` });
  if (announce) userSay(ctx.conv.id, `${ctx.fields[field]}`);
}

export async function handleAction(token, action) {
  const ctx = load(token);
  const { type, value } = action || {};
  if (type === 'conflict') { resolveConflict(ctx, value.field, value.use); askNext(ctx, 'Thanks for clarifying ✓'); return save(ctx); }
  if (type === 'skip_docs') { if (ctx.state.svc) { ctx.state.svc.skip_docs = true; askService(ctx); return save(ctx); } ctx.state.skip_docs = true; askNext(ctx); return save(ctx); }
  if (type === 'submit') {
    if (ctx.app.status !== 'DRAFT') return;
    if (missingFields(ctx.fields).length) { askNext(ctx, 'A few details are still missing.'); return save(ctx); }
    userSay(ctx.conv.id, 'Submit application');
    say(ctx.conv.id, 'Submitting… I\'m creating your case and running the final checks.');
    ctx.state.stage = 'SUBMITTED'; save(ctx);
    const c = submitApplication(ctx.app.id);
    run('UPDATE conversations SET msisdn=? WHERE id=?', normMsisdn(ctx.fields.phone), ctx.conv.id);
    return { case_ref: c.ref };
  }
  if (type === 'lifecycle') return lifecycleAction(ctx, value);
  if (type === 'quiz') return quizAction(ctx, value);
  if (type === 'quick') return handleText(token, value);
}

async function afterSubmit(ctx, text) {
  const c = ctx.app.case_id ? get('SELECT * FROM cases WHERE id=?', ctx.app.case_id) : null;
  const msisdn = normMsisdn(ctx.fields.phone);
  const acc = get('SELECT * FROM g2_accounts WHERE msisdn=?', msisdn);
  const t = text.toLowerCase();
  if (/status|application|news|update|approved|created|ready/.test(t) && c) {
    const sl = slaInfo(c);
    const label = { SUBMITTED: 'Submitted', UNDER_REVIEW: 'Under review', PENDING_REVIEW: 'Under review by our team', AWAITING_CUSTOMER: 'Waiting for your reply', CREATING: 'Account being created', G2_FAILED: 'Account being created', RESOLVED: 'Approved — account active', REJECTED: 'Not approved' }[c.status] || c.status;
    const rows = [['Case', c.ref], ['Status', label], ['Submitted', new Date(c.created_at).toUTCString().slice(5, 22)]];
    if (acc) rows.push(['Merchant number', j(acc.kyc, {}).merchant_id], ['Till number', acc.till_number]);
    else if (sl) rows.push(['Expected by', new Date(c.sla_due).toUTCString().slice(5, 22)]);
    return say(ctx.conv.id, `Here's the latest on your application:`, 'card', { title: 'Application status', rows });
  }
  if (/pin/.test(t) && acc) return supportPinReset(ctx, acc);
  if (/agent|human|call|someone/.test(t)) return supportHuman(ctx, acc, text);
  if (/qr|payment|receive|how/.test(t)) return say(ctx.conv.id, `To receive a payment: the customer dials *1222#, chooses "Pay merchant" and enters your till number ${acc?.till_number || ''} — or simply scans your QR code. You get an SMS for every payment.`, 'card', { title: 'EDUCATE · Receiving payments', pillar: 'EDUCATE', rows: [['Till number', acc?.till_number || '—'], ['USSD', '*1222#'], ['Fee for customer', 'Free']] });
  if (aiEnabled()) {
    try {
      const out = await claude({ system: `You are TOBi, Vodacom DRC M-Pesa assistant, talking to an onboarded merchant (${acc ? 'till ' + acc.till_number : 'application ' + (c?.ref || '')}). Answer in English, max 2 sentences, helpful; if they need an operation (PIN reset, agent), say you can do it.`, messages: [{ role: 'user', content: text }], maxTokens: 200 });
      return say(ctx.conv.id, out.trim());
    } catch { /* fall through */ }
  }
  say(ctx.conv.id, 'I can help with: your application status, receiving payments, resetting your PIN, or connecting you to an agent.', 'options', { options: ['Application status', 'My requests', 'How do I receive payments?', 'Reset my PIN', 'Talk to an agent', 'New request'] });
}

function supportPinReset(ctx, acc) {
  const ref = createSimpleCase('SUPPORT', acc.msisdn, acc.trading_name || acc.name, 'OPERATIONS', 24, { action: 'AUTO_PROCESS', reason: ['Verified channel (TOBi session) — PIN reset'], confidence: 93 });
  run("UPDATE cases SET conv_id=?, service='PIN_RESET', team='Customer Operations', requester_type='Merchant' WHERE ref=?", ctx.conv.id, ref);
  operate(acc.msisdn, 'PIN_RESET', { operator: 'Sentinel API (TOBi)', role: 'SYSTEM', case_ref: ref });
  run("UPDATE cases SET status='RESOLVED', stage='RESOLVE', resolved_at=?, sla_status='MET' WHERE ref=?", iso(), ref);
  audit({ action: 'Support request resolved automatically', case_ref: ref, new_state: 'RESOLVED' });
  say(ctx.conv.id, `Done ✅ I've reset your PIN. You'll receive a temporary PIN by SMS on ${fmtMsisdn(acc.msisdn)} — change it at first use. Reference ${ref}.`, 'card', { title: 'SUPPORT · PIN reset', pillar: 'SUPPORT', rows: [['Reference', ref], ['Status', 'Completed'], ['Time', '< 1 min']] });
}
function supportHuman(ctx, acc, text) {
  const ref = createSimpleCase('SUPPORT', acc?.msisdn || null, acc?.trading_name || 'Merchant', 'OPERATIONS', 8, { action: 'REVIEW', reason: ['Customer asked for an agent'], confidence: 90 });
  run("UPDATE cases SET conv_id=?, team='Customer Care (call-back)' WHERE ref=?", ctx.conv.id, ref);
  raise({ dept: 'OPERATIONS', type: 'SUPPORT', severity: 'MEDIUM', title: `${ref}: merchant asked to speak to an agent`, detail: `"${text}"`, why: [{ points: 20, label: 'Customer-initiated support request' }], recommendation: 'Call back within 8h SLA', case_ref: ref, account_msisdn: acc?.msisdn, rule: 'SUPPORT_HUMAN' });
  say(ctx.conv.id, `No problem — I've opened request ${ref}. A Vodacash agent will call you within 8 hours.`);
}

function lifecycleAction(ctx, { action_id, choice }) {
  const a = respondLifecycle(action_id, choice);
  userSay(ctx.conv.id, choice);
  const acc = get('SELECT * FROM g2_accounts WHERE msisdn=?', a.msisdn);
  if (a.code === 'CHECK_IN') {
    if (/fine|good|ok/i.test(choice)) return say(ctx.conv.id, "Great to hear! I'm here 24/7 if you need anything.");
    if (/pin/i.test(choice)) return supportPinReset(ctx, acc);
    if (/payment/i.test(choice)) return afterSubmit(ctx, 'how do I receive payments');
    return supportHuman(ctx, acc, choice);
  }
  if (a.code === 'ACTIVATION_OFFER') {
    if (/activate/i.test(choice)) {
      const kyc = j(acc.kyc, {}); kyc.offers = [...(kyc.offers || []), { code: 'ZERO_FEE_30D', at: iso() }]; kyc.profile = { ...(kyc.profile || {}), daily: Math.max(4, (kyc.profile?.daily || 1) * 3) };
      run('UPDATE g2_accounts SET kyc=? WHERE msisdn=?', s(kyc), acc.msisdn);
      run('INSERT INTO g2_operations(msisdn,op,operator,case_ref,detail,ts) VALUES(?,?,?,?,?,?)', acc.msisdn, 'OFFER_ACTIVATED', 'Sentinel API (TOBi)', null, '30 days · 0% merchant fee', iso());
      audit({ actor: 'Customer', system: 'TOBi', action: 'ENGAGE offer accepted', entity: 'account:' + acc.msisdn, new_state: '0% merchant fee · 30 days' });
      return say(ctx.conv.id, 'Activated 🎉 0% merchant fee for 30 days starting today. Your free QR display will be delivered by your area sales team.', 'card', { title: 'ENGAGE · Offer active', pillar: 'ENGAGE', rows: [['Offer', '0% merchant fee'], ['Valid until', new Date(+now() + 30 * 86400000).toUTCString().slice(5, 16)], ['Till', acc.till_number]] });
    }
    return say(ctx.conv.id, 'No problem — the offer stays available for 7 days if you change your mind.');
  }
}

function quizAction(ctx, { action_id, step, answer }) {
  ctx.state.quiz = ctx.state.quiz || { score: 0 };
  if (step === 'start') { userSay(ctx.conv.id, "I'm ready"); ctx.state.quiz = { score: 0, action_id }; save(ctx); return say(ctx.conv.id, `Question 1/3 — ${QUIZ[0].q}`, 'quiz', { action_id, idx: 0, options: QUIZ[0].options }); }
  const idx = Number(step); const q = QUIZ[idx];
  userSay(ctx.conv.id, q.options[answer]);
  const ok = Number(answer) === q.a; if (ok) ctx.state.quiz.score++;
  if (idx + 1 < QUIZ.length) { save(ctx); return say(ctx.conv.id, `${ok ? '✅ Correct.' : `❌ Not quite — the right answer is "${q.options[q.a]}".`}\nQuestion ${idx + 2}/3 — ${QUIZ[idx + 1].q}`, 'quiz', { action_id, idx: idx + 1, options: QUIZ[idx + 1].options }); }
  const pct = Math.round(ctx.state.quiz.score / QUIZ.length * 100), pass = pct >= 80;
  respondLifecycle(action_id, { score: pct, pass });
  const a = get('SELECT msisdn FROM lifecycle_actions WHERE id=?', action_id);
  audit({ actor: 'Customer', system: 'TOBi', action: 'AML/CFT awareness training completed', entity: 'account:' + a.msisdn, new_state: `Score ${pct}% — ${pass ? 'PASSED' : 'FAILED'} (threshold 80%)` });
  if (!pass) raise({ dept: 'COMPLIANCE', type: 'TRAINING', severity: 'LOW', title: 'AML training below 80% threshold', detail: `Merchant ${fmtMsisdn(a.msisdn)} scored ${pct}%. Retake scheduled.`, why: [{ points: 20, label: `Score ${pct}% < 80% required by merchant agreement` }], recommendation: 'Re-send module in 7 days', account_msisdn: a.msisdn, rule: 'AML_TRAINING_FAIL' });
  save(ctx);
  say(ctx.conv.id, `${ok ? '✅ Correct.' : `❌ The right answer is "${q.options[q.a]}".`}\nYou scored ${pct}% — ${pass ? 'training completed ✓ Your attestation has been recorded.' : 'below the 80% required. I\'ll send you a short refresher.'}`, 'card',
    { title: 'EDUCATE · AML/CFT awareness', pillar: 'EDUCATE', rows: [['Score', pct + '%'], ['Result', pass ? 'Passed' : 'Retake needed'], ['Recorded for', 'Compliance']] });
}

export async function handleUpload(token, file) {
  const ctx = load(token);
  const doc = saveUpload({ application_id: ctx.app.id, filename: file.filename, mime: file.mime, data: file.data, doc_type: file.doc_type || null });
  userSay(ctx.conv.id, file.filename, 'upload', { doc_id: doc.id, mime: file.mime });
  audit({ actor: 'Customer', system: 'TOBi', action: 'Document uploaded', entity: 'application:' + ctx.app.id, new_state: file.filename });
  const ex = await extractDocument(doc, file.doc_type || null);
  const label = DOC_TYPES[ex.doc_type]?.label || 'Document';
  const shown = Object.entries(ex.fields).filter(([k]) => FIELD_MAP[k] || ['date_of_birth', 'issue_date', 'issuing_authority', 'holder_name'].includes(k))
    .map(([k, v]) => ({ label: FIELD_MAP[k]?.label || (k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' ')), value: k === 'legal_form' ? (v === 'COMPANY' ? 'Company' : 'Individual') : v, confidence: Math.round((ex.confidence[k] || 0.8) * 100) }));
  const unreadable = shown.length < 2;
  say(ctx.conv.id, !unreadable ? `I read your ${label} ✓` : `I received your file but couldn't read enough from it.`, 'extraction', { doc_id: doc.id, doc_type: ex.doc_type, label, mode: ex.mode, fields: shown, precheck: ex.precheck });
  if (unreadable) {
    run("UPDATE documents SET status='UNREADABLE' WHERE id=?", doc.id);
    ctx.state.last_unreadable = { doc_id: doc.id, doc_type: ex.doc_type };
    say(ctx.conv.id, 'Tips for a better photo: put the document flat, in good light, fill the frame and avoid reflections. Or simply type the details — our team will check the document by eye.', 'options', { options: ['Retake photo', 'Type the details instead'] });
    return save(ctx);
  }
  const expired = (ex.precheck || []).find(c => c.code === 'EXPIRY' && !c.ok);
  if (expired) say(ctx.conv.id, `⚠ This ${label} has expired (${expired.label.replace('Expired on ', '')}). A valid document is required — please send a current one.`, 'upload_request', { doc_types: [ex.doc_type] });
  if (ctx.state.svc) { serviceUpload(ctx, doc, ex); return save(ctx); }
  // post-activation renewal
  if (ctx.app.status === 'ACTIVE' || ctx.app.status === 'SUBMITTED') {
    const msisdn = normMsisdn(ctx.fields.phone);
    const r = handleRenewal(msisdn, doc, ex);
    if (r.ok) say(ctx.conv.id, `Document verified ✓ Your record is updated (valid until ${r.expiry}). Your account stays fully compliant — thank you!`, 'card', { title: 'COMPLIANCE RESTORED', pillar: 'ALERT', rows: [['Document', label], ['Valid until', r.expiry], ['Case', r.case_ref || '—'], ['Status', 'Non-compliance prevented']] });
    else say(ctx.conv.id, r.reason);
    return;
  }
  run("UPDATE documents SET replaced_by=? WHERE application_id=? AND status='UNREADABLE' AND id!=?", doc.id, ctx.app.id, doc.id);
  ctx.state.last_unreadable = null;
  let conflicts = 0, filled = 0;
  ctx.state.confirm = (ctx.state.confirm || []).filter(c => c.doc !== 'document:' + doc.id);
  for (const [k, v] of Object.entries(ex.fields)) {
    if (!FIELD_MAP[k]) continue;
    const val = normalizeValue(k, v, ctx.fields) ?? v;
    if ((ex.confidence[k] ?? 0.8) < 0.72 && !(ctx.fields[k] && compareValues(k, ctx.fields[k], val) === 'MATCH')) { ctx.state.confirm.push({ key: k, value: val, doc: 'document:' + doc.id, label: FIELD_MAP[k].label }); continue; }
    const r = setField(ctx, k, val, 'document:' + doc.id);
    if (r === 'conflict') conflicts++; if (r === 'set') filled++;
  }
  if (filled) audit({ actor: 'Sentinel AI', action: 'Application auto-populated from document', entity: 'application:' + ctx.app.id, new_state: `${filled} field(s) from ${label}` });
  ctx.state.stage = 'COLLECTING';
  const pre = filled ? `I've filled ${filled} field${filled > 1 ? 's' : ''} for you.` : null;
  if (ctx.state.confirm.length && !conflicts) { if (pre) say(ctx.conv.id, pre); askConfirm(ctx); return save(ctx); }
  const has = appDocuments(ctx.app.id).map(d => d.doc_type);
  if (!conflicts && !has.includes('NATIONAL_ID') && ex.doc_type === 'RCCM') { say(ctx.conv.id, (pre ? pre + ' ' : '') + 'Now your ID card (front side) please — or tap below to continue without it for now.', 'upload_request', { doc_types: ['NATIONAL_ID'] }); return save(ctx); }
  if (!conflicts && !has.includes('RCCM') && ex.doc_type === 'NATIONAL_ID' && ctx.fields.contract_type !== 'MR' && !ctx.state.asked_rccm) { ctx.state.asked_rccm = true; say(ctx.conv.id, (pre ? pre + ' ' : '') + 'Do you also have your RCCM certificate? Send it and I\'ll fill the business details.', 'upload_request', { doc_types: ['RCCM'] }); return save(ctx); }
  askNext(ctx, pre);
  save(ctx);
}

export function getConversation(token, since = 0) {
  const { conv, app, state, fields, sources } = load(token);
  const msgs = all('SELECT id,sender,kind,content,meta,created_at FROM messages WHERE conv_id=? AND id>? ORDER BY id', conv.id, since).map(m => ({ ...m, meta: j(m.meta) }));
  const sections = {};
  for (const f of FIELDS) {
    if (!f.req(fields) && fields[f.key] == null) continue;
    let v = fields[f.key];
    if (f.key === 'contract_type' && v) v = CONTRACT_TYPES[v] || v;
    if (f.key === 'legal_form' && v) v = v === 'COMPANY' ? 'Company' : 'Individual establishment';
    if (f.key === 'access_channel' && v) v = { USSD: 'USSD', APP: 'M-Pesa App', INTEGRATED: 'Integrated solution' }[v] || v;
    const src = sources[f.key] || null;
    (sections[f.section] ||= []).push({ key: f.key, label: f.label, value: v ?? null, source: src ? (src.startsWith('document') ? 'document' : 'declared') : null, verified: !!sources[f.key + '__verified'] || (src || '').startsWith('document'), clarified: !!sources[f.key + '__clarified'], conflict: (state.conflicts || []).some(c => c.field === f.key) });
  }
  const docs = appDocuments(app.id).map(d => ({ id: d.id, type: d.doc_type, label: DOC_TYPES[d.doc_type]?.label, filename: d.filename, status: d.status, expiry: d.expiry_date }));
  const total = FIELDS.filter(f => f.req(fields)).length, done = total - missingFields(fields).length;
  const c = app.case_id ? get('SELECT ref,status,stage FROM cases WHERE id=?', app.case_id) : null;
  const sv = state.svc ? { code: state.svc.code, label: SERVICES[state.svc.code].label, sla: slaLabel(SERVICES[state.svc.code].sla), team: SERVICES[state.svc.code].team,
    rows: SERVICES[state.svc.code].fields.map(k => ({ key: k, label: SFIELDS[k].label, value: state.svc.fields[k] || null })), docs: state.svc.docs } : null;
  return { service: sv, profile: state.profile || null, messages: msgs, application: { id: app.id, status: app.status, progress: Math.round(done / total * 100), sections, documents: docs, case: c }, stage: state.stage, ai: aiEnabled() };
}
