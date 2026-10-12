// Builds a complete, realistic (fictional) case file for every seeded case:
// identity, business, documents rendered with the applicant's data (with field positions for highlighting),
// OCR-style extractions, declared data, verification results, risk drivers and Sentinel recommendation —
// produced by the SAME verification / risk / policy engines used for live TOBi cases.
import fs from 'node:fs';
import path from 'node:path';
import { run, get, all, s, j, DATA_DIR } from './db.js';
import { DAY, HOUR } from './core.js';
import * as R from './docs_render.js';

let ctx;   // { rnd, pick, int, pad, now }
export function initDossier(c) { ctx = c; }
const rnd = () => ctx.rnd(), pick = (a) => ctx.pick(a), int = (a, b) => ctx.int(a, b), pad = (n, l) => String(n).padStart(l, '0');
const isoD = (ms) => new Date(ms).toISOString().slice(0, 10);
const iso = (ms) => new Date(ms).toISOString();
const L = 'ABCDEFGHJKLMNPRSTUVWXYZ';

// ---------- identities ----------
export const FEMALE = new Set(['Grace', 'Esther', 'Merveille', 'Nathalie', 'Rachel', 'Chantal', 'Sarah', 'Bénédicte', 'Divine', 'Ornella', 'Prisca', 'Gloire', 'Naomie', 'Ruth']);
const POSTNOM = ['Kabongo', 'Tshibanda', 'Mbuyi', 'Kalala', 'Ngoy', 'Kazadi', 'Lumbala', 'Mwanza', 'Kanku', 'Nkulu', 'Mulamba', 'Kapinga', 'Nsimba', 'Makiese', 'Luzolo', 'Mayala'];
const POB = ['Kinshasa', 'Kinshasa', 'Kinshasa', 'Kananga', 'Lubumbashi', 'Mbuji-Mayi', 'Kikwit', 'Matadi', 'Bukavu', 'Kisangani', 'Mbandaka', 'Boma'];
const TONES = ['#5a3b28', '#6b4a35', '#4a3020', '#7a5236', '#3f2a1d', '#61412c'];
export function identity(given, surname, idKind) {
  const sex = FEMALE.has(given) ? 'F' : 'M';
  const dob = isoD(Date.UTC(int(1966, 2001), int(0, 11), int(1, 28)));
  const passport = idKind ? idKind === 'Passport' : rnd() < 0.22;
  return { given, surname, postnom: pick(POSTNOM), sex, dob, pob: pick(POB), tone: pick(TONES), id_type: passport ? 'Passport' : 'Voter card', id_number: passport ? 'OB' + pad(int(1000000, 9999999), 7) : pad(int(10000000, 99999999), 8) + pad(int(1000, 9999), 4) };
}
export const fullName = (p) => [p.given, p.surname, p.postnom].filter(Boolean).join(' ');
const SHOP_ACT = { Alimentation: 'Commerce général — alimentation', Pharmacie: 'Pharmacie et produits de santé', Boutique: 'Commerce de détail — habillement', Quincaillerie: 'Quincaillerie et matériaux de construction', Ets: 'Commerce général — import / distribution', 'Super Marché': 'Supermarché — commerce de détail', Restaurant: 'Restauration', Cosmétiques: 'Vente de produits cosmétiques', 'Phone Center': 'Vente de téléphones, accessoires et crédit', Boulangerie: 'Boulangerie — pâtisserie', Dépôt: 'Dépôt de boissons', Salon: 'Salon de coiffure et esthétique' };
export const activityFor = (trading) => SHOP_ACT[Object.keys(SHOP_ACT).find(k => trading.startsWith(k))] || 'Commerce général';
export function business(trading, owner, commune, address, company) {
  const yy = int(15, 25);
  return { trading_name: trading, legal_form: company ? 'COMPANY' : 'INDIVIDUAL', legal_form_label: company ? 'Société à responsabilité limitée (SARL)' : 'Établissement individuel (Ets)', legal_name: company ? `${trading.toUpperCase()} SARL` : `ETS ${trading.toUpperCase()}`,
    rccm: `CD/KIN/RCCM/${yy}-${company ? 'B' : 'A'}-${pad(int(1000, 99999), 5)}`, id_nat: `01-${pick(['83', '128', 'G4', 'F4', '7'])}-N${pad(int(10000, 99999), 5)}${pick(L)}`.replace(/^01-7-/, '01-71-'), nif: company ? `A${pad(int(1000000, 9999999), 7)}${pick(L)}` : null,
    commune, city: 'Kinshasa', address, activity: activityFor(trading), owner, issue: isoD(Date.UTC(2000 + yy, int(0, 11), int(1, 28))) };
}

// ---------- persistence ----------
let docSeq = 0;
export function saveDoc(rendered, meta) {
  const { d } = rendered;
  let svg = d.svg();
  if (meta.photo) {   // looks like a phone photo of the paper: slight rotation, shadow, optional blur
    const pad2 = 60, W = d.w + pad2 * 2, H = d.h + pad2 * 2, rot = meta.rot ?? (rnd() * 3 - 1.5);
    const inner = svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
    svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><defs><filter id="ph"><feGaussianBlur stdDeviation="${meta.blur || 0}"/></filter><filter id="sh"><feDropShadow dx="6" dy="10" stdDeviation="10" flood-opacity=".35"/></filter><linearGradient id="tb" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#6b5a46"/><stop offset="1" stop-color="#3d3127"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#tb)"/><g transform="translate(${pad2} ${pad2}) rotate(${rot.toFixed(2)} ${d.w / 2} ${d.h / 2})" filter="url(#sh)"><g filter="url(#ph)">${inner}</g></g><rect width="${W}" height="${H}" fill="#fff" opacity="${meta.blur ? 0.12 : 0.04}"/></svg>`;
    // boxes shift with the padding (rotation is small; boxes stay approximately aligned)
    const shift = (b) => ({ ...b, r: b.r.map(r => ({ x: r.x + pad2, y: r.y + pad2, w: r.w, h: r.h })) });
    for (const k of Object.keys(d.boxes)) d.boxes[k] = shift(d.boxes[k]);
    d.w = W; d.h = H;
  }
  const fn = `case_${++docSeq}_${(meta.doc_type || 'DOC').toLowerCase()}.svg`;
  fs.writeFileSync(path.join(DATA_DIR, 'uploads', fn), svg);
  const fields = { ...rendered.fields, ...(meta.fields || {}) };
  const conf = Object.fromEntries(Object.keys(fields).map(k => [k, meta.blur ? +(0.42 + rnd() * 0.15).toFixed(2) : +(0.88 + rnd() * 0.1).toFixed(2)]));
  const boxes = d.pct();
  for (const [k, v] of Object.entries(meta.marks || {})) if (boxes[k]) Object.assign(boxes[k], v);
  const r = run('INSERT INTO documents(application_id,account_msisdn,doc_type,filename,mime,path,size,status,expiry_date,uploaded_at,case_ref,precheck) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
    meta.application_id || null, meta.case_ref ? null : (meta.msisdn || null), meta.doc_type, meta.filename || fn, 'image/svg+xml', fn, svg.length, meta.status || 'EXTRACTED', meta.expiry || null, meta.at, meta.case_ref || null,
    s([{ code: 'FORMAT', label: 'Format & size accepted', ok: true }, { code: 'READABLE', label: meta.blur ? 'Photo blurred — details typed by the customer' : 'Readable', ok: !meta.blur }, ...(meta.expiry ? [{ code: 'EXPIRY', label: meta.expiry < isoD(ctx.now) ? 'Document expired' : 'Not expired', ok: meta.expiry >= isoD(ctx.now) }] : [])]));
  const id = Number(r.lastInsertRowid);
  run('INSERT INTO extractions(document_id,mode,doc_type,fields,confidence,raw_text,created_at,boxes) VALUES(?,?,?,?,?,?,?,?)', id, meta.mode || 'OCR', meta.doc_type, s(meta.blur ? {} : fields), s(meta.blur ? {} : conf), '', meta.at, s(boxes));
  run('INSERT INTO audit_events(ts,actor,role,system,action,case_ref,entity,new_state,evidence) VALUES(?,?,?,?,?,?,?,?,?)', meta.at, 'Document Intelligence', 'SYSTEM', 'SENTINEL', 'Document analysed', meta.case_ref || meta.ref || null, 'document:' + id, meta.doc_type,
    s({ mode: meta.mode || 'OCR', ocr: meta.blur ? 'tesseract fra+eng · conf 38 · unreadable' : `tesseract fra+eng · conf ${int(84, 96)}`, fields: Object.keys(meta.blur ? {} : fields) }));
  return id;
}

// ---------- risk writer for non-application cases ----------
const lvl = (x) => x >= 80 ? 'CRITICAL' : x >= 60 ? 'HIGH' : x >= 30 ? 'MEDIUM' : 'LOW';
export function writeRisk(cid, dims, conf = 88) {
  const out = {};
  for (const D of ['OPERATIONAL', 'COMPLIANCE', 'AML_CFT', 'FRAUD', 'LEGAL']) { const f = (dims[D] || []).map(([points, label]) => ({ points, label })); const sc = Math.min(100, f.reduce((a, b) => a + b.points, 0) + (D === 'OPERATIONAL' ? 4 : 2)); out[D] = { score: sc, level: lvl(sc), factors: f }; }
  const vals = Object.values(out).map(x => x.score);
  const overall = Math.min(100, Math.round(Math.max(...vals) * 0.75 + vals.reduce((a, b) => a + b, 0) / vals.length * 0.25));
  run('DELETE FROM risk_assessments WHERE case_id=?', cid);
  const t = get('SELECT created_at FROM cases WHERE id=?', cid).created_at;
  for (const [D, x] of Object.entries(out)) run('INSERT INTO risk_assessments(case_id,dimension,score,level,factors,created_at,confidence) VALUES(?,?,?,?,?,?,?)', cid, D, x.score, x.level, s(x.factors), t, Math.max(62, conf - (D === 'AML_CFT' ? 5 : 0)));
  run('INSERT INTO risk_assessments(case_id,dimension,score,level,factors,created_at,confidence) VALUES(?,?,?,?,?,?,?)', cid, 'OVERALL', overall, lvl(overall), s(Object.values(out).flatMap(x => x.factors).sort((a, b) => b.points - a.points).slice(0, 5)), t, conf);
  return { overall, level: lvl(overall), dims: out };
}
export function writeEngineRisk(cid, risk, conf) {
  run('DELETE FROM risk_assessments WHERE case_id=?', cid);
  const t = get('SELECT created_at FROM cases WHERE id=?', cid).created_at;
  for (const [D, x] of Object.entries(risk.dims)) run('INSERT INTO risk_assessments(case_id,dimension,score,level,factors,created_at,confidence) VALUES(?,?,?,?,?,?,?)', cid, D, x.score, x.level, s(x.factors), t, x.confidence ?? conf);
  run('INSERT INTO risk_assessments(case_id,dimension,score,level,factors,created_at,confidence) VALUES(?,?,?,?,?,?,?)', cid, 'OVERALL', risk.overall, risk.level, s(Object.values(risk.dims).flatMap(x => x.factors).sort((a, b) => b.points - a.points).slice(0, 5)), t, conf);
}

// ---------- G2 account documents (re-used by renewal / KYC / SIM swap cases) ----------
export function accountIdDoc(acc, kyc, expiryMs, at) {
  const p = kyc.person;
  const ex = isoD(expiryMs);
  const issue = isoD(expiryMs - (p.id_type === 'Passport' ? 5 : 8) * 365 * DAY);
  const r = p.id_type === 'Passport' ? R.passport({ ...p, issue, expiry: ex }, rnd) : R.voterCard({ ...p, address: kyc.address, commune: kyc.commune, issue, expiry: ex }, rnd);
  return saveDoc(r, { doc_type: 'NATIONAL_ID', msisdn: acc.msisdn, expiry: ex, at, status: 'VERIFIED', filename: (p.id_type === 'Passport' ? 'passport_' : 'voter_card_') + p.surname.toLowerCase() + '.jpg', photo: true, rot: rnd() * 2 - 1 });
}
export function accountRccmDoc(acc, kyc, at) {
  const b = kyc.business; if (!b) return null;
  return saveDoc(R.rccmCert(b, rnd), { doc_type: 'RCCM', msisdn: acc.msisdn, at, status: 'VERIFIED', filename: 'rccm_' + b.trading_name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_') + '_scan.png' });
}

// =====================================================================================
// Case builders — one per case type. Each writes documents, declared data, checks, risk
// and the Sentinel recommendation, and returns updates for the case row.
// =====================================================================================
import { verifyApplication } from './verification.js';
import { assessRisk, recommend } from './cases.js';

const fmtMsisdn = (m) => `+${m.slice(0, 3)} ${m.slice(3, 5)} ${m.slice(5, 8)} ${m.slice(8)}`;
const daysFromNow = (iso10) => Math.round((new Date(iso10) - ctx.now) / DAY);
const AUD = (ts, actor, action, ref, extra = {}) => run('INSERT INTO audit_events(ts,actor,role,system,action,case_ref,new_state,ai_recommendation,rule,evidence) VALUES(?,?,?,?,?,?,?,?,?,?)', iso(ts), actor, extra.role || 'SYSTEM', extra.system || 'SENTINEL', action, ref, extra.state || null, extra.ai || null, extra.rule || null, extra.ev ? s(extra.ev) : null);
const STATUS_FOR = { REQUEST_INFORMATION: ['AWAITING_CUSTOMER', 'VERIFY'], EDD_REQUIRED: ['EDD_REQUESTED', 'RISK_SCORE'], LEGAL_REVIEW_REQUIRED: ['PENDING_REVIEW', 'DECIDE'], REVIEW: ['PENDING_REVIEW', 'DECIDE'], ESCALATE: ['UNDER_REVIEW', 'DECIDE'], APPROVE: ['PENDING_REVIEW', 'DECIDE'], AUTO_PROCESS: ['CREATING', 'ORCHESTRATE'] };
const altGiven = (g) => ({ 'Jean-Paul': 'Jean-Pierre', Grace: 'Gracia', Patrick: 'Patience', Esther: 'Estelle', Christian: 'Christine', Nathalie: 'Natacha', Junior: 'Jonathan', Sarah: 'Sandra', Trésor: 'Thérèse', Cédric: 'Cédrick', Joël: 'Joëlle' }[g] || 'Emmanuel');
const newAddress = () => `${int(1, 260)}, Avenue ${pick(ctx.AVES)}`;
const finishOpen = (o, rec, extra = {}) => { const [st, stage] = extra.status ? [extra.status, extra.stage || 'DECIDE'] : (STATUS_FOR[rec.action] || ['PENDING_REVIEW', 'DECIDE']); return { status: st, stage }; };

export function buildCase(o) {
  const f = { MERCHANT_ONBOARDING: onboarding, AGENT_ONBOARDING: onboarding, KYC_UPDATE: kycUpdate, DOCUMENT_RENEWAL: renewal, AML_REVIEW: amlReview, CONTRACT_REVIEW: contractReview, SIM_SWAP: simSwap, SUPPORT: support }[o.type];
  return f ? f(o) : null;
}
function applyCase(o, u) {
  const sets = [], p = [];
  for (const [k, v] of Object.entries(u)) { if (v === undefined) continue; sets.push(k + '=?'); p.push(v); }
  run(`UPDATE cases SET ${sets.join(',')} WHERE id=?`, ...p, o.cid);
  // align recorded decisions with the real recommendation
  if (u.recommendation) { const rec = JSON.parse(u.recommendation); for (const d of all('SELECT * FROM decisions WHERE case_id=?', o.cid)) { const agrees = d.action === 'APPROVE' ? ['APPROVE', 'AUTO_PROCESS'].includes(rec.action) : d.action === 'REJECT' ? !['APPROVE', 'AUTO_PROCESS'].includes(rec.action) : true; run('UPDATE decisions SET ai_action=?, override=?, reason=? WHERE id=?', rec.action, agrees ? 0 : 1, agrees ? (d.reason && !d.override ? d.reason : null) : (d.reason || 'Customer known to branch manager'), d.id); } }
}

// ---------- merchant & agent onboarding (application-based, real engines) ----------
function onboarding(o) {
  const agent = o.type === 'AGENT_ONBOARDING';
  const scen = o.resolved ? (o.status === 'REJECTED' ? pick(['expired_id', 'name_mismatch', 'rccm_mismatch']) : pick(['clean', 'clean', 'clean', 'clarified']))
    : pick(['rccm_mismatch', 'expired_id', 'address_mismatch', 'name_mismatch', 'missing_poa', 'blurry_poa', 'blurry_poa', 'pep', 'pep_high', 'g2_failed', 'clarified_review']);
  let p, b, msisdn;
  if (o.resolved && o.acc.kyc?.person && o.acc.kyc.business) { p = o.acc.kyc.person; b = { ...o.acc.kyc.business }; msisdn = o.acc.msisdn; }
  else {
    p = identity(pick(ctx.FIRST), pick(ctx.LAST).split(' ')[0]);
    const commune = pick(ctx.COMMUNES), trading = agent ? `Agent ${pick(ctx.SHOP2)} ${commune}` : `${pick(ctx.SHOP)} ${pick(ctx.SHOP2)}`;
    b = business(trading, `${p.given} ${p.surname} ${p.postnom}`, commune, newAddress(), agent ? rnd() < 0.3 : rnd() < 0.6);
    msisdn = ctx.msisdn();
  }
  if (agent) b.activity = 'Agent M-Pesa — dépôts et retraits (cash-in / cash-out)';
  if (scen === 'pep_high') b.activity = 'Bureau de change et transfert d’argent';
  const t0 = new Date(o.created).getTime();
  const idExp = isoD(scen === 'expired_id' ? ctx.now - int(6, 75) * DAY : ctx.now + int(420, 2600) * DAY);
  const idP = scen === 'name_mismatch' ? { ...p, given: altGiven(p.given) } : p;
  const turnover = scen === 'pep_high' ? int(16, 30) * 1000 : agent ? int(30, 90) * 100 : int(5, 60) * 100;
  const declaredRccm = scen === 'rccm_mismatch' ? b.rccm.replace(/(\d)(\d)$/, (m, a, c) => `${c}${a}`) .replace(/(\d)$/, (d) => String((+d + 3) % 10)) : b.rccm;
  const fields = {
    legal_name: b.legal_name, trading_name: b.trading_name, contract_type: agent ? 'MI' : pick(['MI', 'MI', 'MA', 'MIL']), owner_name: `${p.given} ${p.surname}`, representative_name: `${p.given} ${p.surname}`,
    id_type: p.id_type, id_number: p.id_number, id_expiry: idExp, phone: fmtMsisdn(msisdn), email: `${p.given}.${p.surname}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z.]/g, '') + pick(['@gmail.com', '@yahoo.fr', '@outlook.com']),
    address: b.address, commune: scen === 'clarified' || scen === 'clarified_review' ? 'Kinshasa' : b.commune, city: 'Kinshasa', legal_form: b.legal_form, rccm: declaredRccm, id_nat: b.id_nat, tax_number: b.nif || 'none', business_activity: b.activity,
    monthly_turnover_usd: String(turnover), source_of_funds: agent ? 'Agent commissions and float' : scen === 'pep_high' ? 'Currency exchange margins' : 'Retail sales', daughter_sims: rnd() < 0.3 ? 'Yes' : 'No', access_channel: pick(['USSD', 'USSD', 'APP', 'INTEGRATED']),
    bank_name: pick(['Rawbank', 'Equity BCDC', 'TMB', 'Ecobank', 'Access Bank', 'none']), other_mm_operator: rnd() < 0.2 ? 'Orange Money' : 'No', pep: scen.startsWith('pep') ? 'Yes' : 'No', sanctions: 'No', convictions: 'No', terms_accepted: 'Yes',
  };
  const sources = { legal_name: 'document:RCCM', rccm: scen === 'rccm_mismatch' ? 'typed' : 'document:RCCM', id_nat: 'document:RCCM', owner_name: 'typed', id_number: 'document:NATIONAL_ID', id_expiry: 'document:NATIONAL_ID', address: 'document:RCCM', commune: 'typed', business_activity: 'document:RCCM' };
  if (scen === 'clarified') sources.commune__clarified = 'Applicant: “Kinshasa is the city, the shop is in ' + b.commune + '” — confirmed';
  const app = run('INSERT INTO applications(conv_id,status,fields,field_sources,case_id,created_at,updated_at,submitted_at) VALUES(?,?,?,?,?,?,?,?)', null, 'SUBMITTED', s(fields), s(sources), o.cid, iso(t0 - 40 * 60000), iso(t0), iso(t0));
  const appId = Number(app.lastInsertRowid);
  const base = { application_id: appId, msisdn, case_ref: o.ref, status: o.resolved ? 'VERIFIED' : 'EXTRACTED' };
  // documents as the applicant uploaded them through TOBi
  const idR = idP.id_type === 'Passport' ? R.passport({ ...idP, issue: isoD(new Date(idExp) - 5 * 365 * DAY), expiry: idExp }, rnd) : R.voterCard({ ...idP, address: b.address, commune: b.commune, issue: isoD(new Date(idExp) - 8 * 365 * DAY), expiry: idExp }, rnd);
  saveDoc(idR, { ...base, doc_type: 'NATIONAL_ID', expiry: idExp, at: iso(t0 - 30 * 60000), photo: true, filename: `IMG_${int(1000, 9999)}.jpg`, ref: o.ref });
  if (!agent || b.legal_form === 'COMPANY' || rnd() < 0.7) saveDoc(R.rccmCert(b, rnd), { ...base, doc_type: 'RCCM', at: iso(t0 - 28 * 60000), filename: `RCCM_${b.trading_name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '_')}_scan.png`, ref: o.ref });
  if (scen !== 'missing_poa') {
    const moved = scen === 'address_mismatch';
    const commune2 = moved ? pick(ctx.COMMUNES.filter(c => c !== b.commune)) : b.commune;
    const bill = { kind: rnd() < 0.65 ? 'SNEL' : 'REGIDESO', holder: `${p.given} ${p.surname}`, address: moved ? newAddress() : b.address, commune: commune2, city: 'Kinshasa', issue: isoD(t0 - int(8, 60) * DAY), period: '', account_no: `${pad(int(100, 9999), 4)}-${pad(int(10000, 99999), 5)}`, meter: 'KIN-' + pad(int(100000, 999999), 6), invoice: `INV-2026-${pad(int(100000, 999999), 6)}`, amount_cdf: int(25, 180) * 1000, usage: [int(8000, 20000), 0] };
    bill.usage[1] = bill.usage[0] + int(120, 480); bill.due = isoD(new Date(bill.issue).getTime() + 20 * DAY); bill.period = ['Juillet', 'Août', 'Septembre'][int(0, 2)] + ' 2026';
    const blur = scen === 'blurry_poa';
    saveDoc(R.utilityBill(bill, rnd), { ...base, doc_type: 'PROOF_OF_ADDRESS', at: iso(t0 - 25 * 60000), photo: true, blur: blur ? 3.4 : 0, rot: blur ? 4.5 : undefined, status: blur ? 'MANUAL_REVIEW' : base.status, filename: `IMG_${int(1000, 9999)}.jpg`, ref: o.ref });
  }
  const appRow = get('SELECT * FROM applications WHERE id=?', appId);
  const verifs = verifyApplication(appRow);
  const docs = all('SELECT d.*, e.fields AS ex_fields FROM documents d LEFT JOIN extractions e ON e.document_id=d.id WHERE d.application_id=?', appId).map(d => ({ ...d, ex_fields: j(d.ex_fields, {}) }));
  const riskFields = o.resolved ? { ...fields, phone: '', id_number: '' } : fields;
  const risk = assessRisk(riskFields, verifs, docs);
  const rec = recommend(risk, verifs);
  writeEngineRisk(o.cid, risk, rec.confidence);
  const exc = verifs.filter(v => ['MISMATCH', 'MISSING', 'EXPIRED', 'REVIEW'].includes(v.status));
  AUD(t0, 'TOBi', 'Application submitted via TOBi', o.ref, { system: 'TOBi', state: `${docs.length} documents · ${Object.keys(fields).length} fields` });
  AUD(t0 + 3000, 'Sentinel AI', 'Verification completed', o.ref, { state: `${verifs.length} checks · ${exc.length} exception(s)`, ev: exc.map(v => `${v.label}: ${v.status}`) });
  AUD(t0 + 5000, 'Sentinel AI', 'Sentinel recommendation', o.ref, { state: `${rec.action} (${rec.confidence}%) → ${rec.route}`, ai: rec.action, rule: rec.rule });
  let st = {};
  if (!o.resolved) {
    st = scen === 'g2_failed' ? { status: 'G2_FAILED', stage: 'ORCHESTRATE' } : finishOpen(o, rec);
    if (st.status === 'AWAITING_CUSTOMER') AUD(t0 + 9000, 'TOBi', 'Customer asked to resolve exceptions', o.ref, { system: 'TOBi', state: exc.map(v => v.status === 'EXPIRED' ? 'Upload a valid ID — the one received expired on ' + (v.found || '') : v.status === 'MISSING' ? v.label.replace(' provided', '') + ' — please upload it' : v.status === 'MISMATCH' ? `Please confirm: ${v.label.split(':')[0]} declared “${v.declared}” but the document shows “${v.found}”` : v.label).join(' · ') });
    if (st.status === 'G2_FAILED') { run('INSERT INTO g2_requests(case_ref,payload,status,response,created_at,completed_at) VALUES(?,?,?,?,?,?)', o.ref, s({ type: agent ? 'AGENT' : 'MERCHANT', name: b.legal_name }), 'FAILED', s({ error: 'G2-ERR-503 Upstream timeout while provisioning till number' }), iso(t0 + 60000), iso(t0 + 90000)); AUD(t0 + 90000, 'G2 Simulator', 'G2 creation failed', o.ref, { system: 'G2', state: 'G2-ERR-503 Upstream timeout' }); }
  }
  applyCase(o, { application_id: appId, account_msisdn: msisdn, customer_name: b.trading_name, risk_score: risk.overall, risk_level: risk.level, recommendation: s(rec), owner_dept: o.resolved ? undefined : (st.status === 'G2_FAILED' ? 'OPERATIONS' : rec.route), status: st.status, stage: st.stage, priority: risk.level === 'LOW' ? 'NORMAL' : risk.level === 'MEDIUM' ? 'HIGH' : 'URGENT', source: pick(['TOBi', 'TOBi', 'TOBi (agent-assisted)']), service: agent ? null : 'MERCHANT_CREATION', requester_type: agent ? 'Agent' : 'Merchant' });
  return { scen };
}

// ---------- shared: details-based cases ----------
function detailsCase(o, { fields, docs, checks, dims, rec, status, stage, dept, source, customer }) {
  const risk = writeRisk(o.cid, dims, rec.confidence);
  rec = { ...rec, risk_level: risk.level, overall: risk.overall };
  const t0 = new Date(o.created).getTime();
  AUD(t0 + 2000, 'Sentinel AI', 'Verification completed', o.ref, { state: `${checks.length} checks · ${checks.filter(c => !c.ok && !c.info).length} exception(s)`, ev: checks.map(c => `${c.label}: ${c.ok ? 'OK' : 'EXCEPTION'}`) });
  AUD(t0 + 4000, 'Sentinel AI', 'Sentinel recommendation', o.ref, { state: `${rec.action} (${rec.confidence}%)`, ai: rec.action, rule: rec.rule });
  applyCase(o, { details: s({ fields, documents: docs, checks }), risk_score: risk.overall, risk_level: risk.level, recommendation: s(rec), status: o.resolved ? undefined : status, stage: o.resolved ? undefined : stage, owner_dept: o.resolved ? undefined : dept, source, customer_name: customer, priority: risk.level === 'LOW' ? 'NORMAL' : risk.level === 'MEDIUM' ? 'HIGH' : 'URGENT' });
}
const person = (acc) => acc.kyc.person;
const ownerOf = (acc) => `${person(acc).given} ${person(acc).surname}`;
const caseIdDoc = (o, acc, expiry, at, extra = {}) => { const p = { ...person(acc), ...(extra.p || {}) }; const ex = expiry; const issue = isoD(new Date(ex) - (p.id_type === 'Passport' ? 5 : 8) * 365 * DAY);
  const r = p.id_type === 'Passport' ? R.passport({ ...p, issue, expiry: ex }, rnd) : R.voterCard({ ...p, address: acc.kyc.address, commune: acc.kyc.commune, issue, expiry: ex }, rnd);
  return saveDoc(r, { doc_type: 'NATIONAL_ID', msisdn: acc.msisdn, case_ref: o.ref, expiry: ex, at, photo: true, filename: extra.filename || `IMG_${int(1000, 9999)}.jpg`, status: o.resolved ? 'VERIFIED' : 'EXTRACTED' }); };

// ---------- KYC update (address change) ----------
function kycUpdate(o) {
  const acc = o.acc, p = person(acc), t0 = new Date(o.created).getTime();
  const scen = o.resolved ? 'ok' : pick(['not_in_name', 'pending_check', 'pending_check', 'old_bill']);
  const commune = pick(ctx.COMMUNES.filter(c => c !== acc.kyc.commune)), address = newAddress();
  const holder = scen === 'not_in_name' ? `${pick(ctx.FIRST)} ${pick(ctx.LAST).split(' ')[0]}` : ownerOf(acc);
  const issue = isoD(scen === 'old_bill' ? t0 - int(130, 260) * DAY : t0 - int(5, 50) * DAY);
  const bill = { kind: rnd() < 0.6 ? 'SNEL' : 'REGIDESO', holder, address, commune, city: 'Kinshasa', issue, due: isoD(new Date(issue).getTime() + 20 * DAY), period: 'Août 2026', account_no: `${pad(int(100, 9999), 4)}-${pad(int(10000, 99999), 5)}`, meter: 'KIN-' + pad(int(100000, 999999), 6), invoice: `INV-2026-${pad(int(100000, 999999), 6)}`, amount_cdf: int(25, 160) * 1000, usage: [12000, 12340] };
  const billId = saveDoc(R.utilityBill(bill, rnd), { doc_type: 'PROOF_OF_ADDRESS', msisdn: acc.msisdn, case_ref: o.ref, at: iso(t0 - 20 * 60000), photo: true, filename: `IMG_${int(1000, 9999)}.jpg`, status: o.resolved ? 'VERIFIED' : 'EXTRACTED' });
  const idExp = acc.kyc.id_expiry;
  const idId = caseIdDoc(o, acc, idExp, iso(t0 - 22 * 60000));
  const nameOk = scen !== 'not_in_name', fresh = scen !== 'old_bill', idOk = idExp >= isoD(ctx.now);
  const checks = [
    { code: 'HOLDER', label: 'Bill holder = account owner', ok: nameOk, declared: ownerOf(acc), found: holder, doc_id: billId, field: 'holder_name' },
    { code: 'BILL_DATE', label: 'Bill issued less than 3 months ago', ok: fresh, found: R.fmtDate(issue), doc_id: billId, field: 'issue_date' },
    { code: 'NEW_ADDRESS', label: 'New address (differs from G2 KYC)', ok: true, info: true, declared: `${acc.kyc.address}, ${acc.kyc.commune}`, found: `${address}, ${commune}`, doc_id: billId, field: 'address' },
    { code: 'ID_VALID', label: 'ID document valid', ok: idOk, found: R.fmtDate(idExp), doc_id: idId, field: 'id_expiry' },
    { code: 'ID_NAME', label: 'ID name = account owner', ok: true, declared: ownerOf(acc), found: fullName(p), doc_id: idId, field: 'owner_name' },
  ];
  const dims = { COMPLIANCE: [[8, 'Address change — KYC refresh required']] };
  if (!nameOk) dims.COMPLIANCE.push([30, 'Proof of address not in the customer’s name']);
  if (!fresh) dims.COMPLIANCE.push([22, 'Proof of address older than 3 months']);
  if (!idOk) dims.COMPLIANCE.push([35, 'ID document expired']);
  const bad = checks.filter(c => !c.ok);
  const rec = bad.length ? { action: 'REQUEST_INFORMATION', route: 'COMPLIANCE', rule: 'KYC evidence incomplete', reason: bad.map(c => c.label + ' — not satisfied'), confidence: 90 } : { action: 'APPROVE', route: 'COMPLIANCE', rule: 'KYC evidence consistent → update G2 KYC after review', reason: ['Proof of address in the customer’s name and recent', 'ID valid and consistent'], confidence: 93 };
  detailsCase(o, { fields: { full_name: ownerOf(acc), msisdn: fmtMsisdn(acc.msisdn), request: 'Address change', current_address: `${acc.kyc.address}, ${acc.kyc.commune}`, new_address: `${address}, ${commune}`, requester_type: acc.account_type === 'AGENT' ? 'Agent' : 'Merchant' }, docs: [billId, idId], checks, dims, rec, status: bad.length ? 'AWAITING_CUSTOMER' : 'PENDING_REVIEW', stage: bad.length ? 'VERIFY' : 'DECIDE', dept: 'COMPLIANCE', source: 'TOBi', customer: acc.trading_name || acc.name });
}

// ---------- document renewal (expired / expiring ID) ----------
function renewal(o) {
  const acc = o.acc, p = person(acc), t0 = new Date(o.created).getTime();
  const oldExp = isoD(o.resolved ? t0 + int(3, 25) * DAY : rnd() < 0.6 ? ctx.now - int(2, 45) * DAY : ctx.now + int(3, 28) * DAY);
  const uploaded = o.resolved || rnd() < 0.45;
  const d0 = daysFromNow(oldExp);
  const oldId = caseIdDoc(o, acc, oldExp, acc.created_at, { filename: 'G2_KYC_ID_on_file.jpg' });
  // keep G2 consistent with the case: the account's KYC document on file carries the same expiry (or the renewed one once approved)
  const g2Exp = o.resolved ? null : oldExp;
  const docs = [oldId], checks = [{ code: 'OLD_ID', label: d0 < 0 ? `ID on file expired ${-d0} days ago` : `ID on file expires in ${d0} days`, ok: false, found: R.fmtDate(oldExp), doc_id: oldId, field: 'id_expiry', sev: d0 < 0 ? 'bad' : 'warn' }];
  let newId = null, newExp = null;
  if (uploaded) {
    newExp = isoD(ctx.now + int(1800, 2900) * DAY);
    const np = { ...p, id_number: p.id_type === 'Passport' ? 'OB' + pad(int(1000000, 9999999), 7) : pad(int(10000000, 99999999), 8) + pad(int(1000, 9999), 4) };
    newId = caseIdDoc(o, acc, newExp, iso(t0 + 2 * HOUR), { p: np });
    docs.push(newId);
    checks.push({ code: 'NEW_ID', label: 'Renewed ID received via TOBi — valid', ok: true, found: R.fmtDate(newExp), doc_id: newId, field: 'id_expiry' }, { code: 'NEW_NAME', label: 'Name on renewed ID = G2 KYC', ok: true, declared: ownerOf(acc), found: fullName(p), doc_id: newId, field: 'owner_name' }, { code: 'NEW_NUMBER', label: 'New document number — G2 KYC to be updated', ok: true, info: true, declared: p.id_number, found: np.id_number, doc_id: newId, field: 'id_number' });
  }
  const dims = { COMPLIANCE: [[d0 < 0 ? 40 : 25, d0 < 0 ? `ID expired ${-d0} days ago` : `ID expires in ${d0} days`], [14, 'KYC validity is a mandatory control']] };
  if (d0 < 0 && !uploaded) dims.OPERATIONAL = [[20, 'Account may be restricted until renewal']];
  if (uploaded) dims.COMPLIANCE = [[15, 'Renewed ID received — G2 KYC update pending review'], [14, 'KYC validity is a mandatory control']];
  const rec = uploaded ? { action: 'APPROVE', route: 'COMPLIANCE', rule: 'Renewed ID valid and consistent → update G2 KYC', reason: ['Renewed ID received and readable', 'Name matches G2 KYC'], confidence: 94 } : { action: 'REQUEST_INFORMATION', route: 'COMPLIANCE', rule: 'Expiry thresholds 90/30/7/0 days', reason: ['TOBi renewal reminder sent', d0 < 0 ? 'Restrict account if not renewed within 15 days' : 'Renewal before expiry prevents non-compliance'], confidence: 92 };
  syncG2Id(acc, o.resolved ? newExp : g2Exp);
  AUD(t0, 'Sentinel AI', 'Document expiry detected → renewal requested via TOBi', o.ref, { state: `Expiry ${R.fmtDate(oldExp)}`, rule: 'DOC_EXPIRY' });
  if (uploaded) AUD(t0 + 2 * HOUR, 'TOBi', 'Renewed ID uploaded by the customer', o.ref, { system: 'TOBi' });
  detailsCase(o, { fields: { full_name: ownerOf(acc), msisdn: fmtMsisdn(acc.msisdn), document: p.id_type, current_expiry: oldExp, ...(newExp ? { renewed_expiry: newExp } : {}) }, docs, checks, dims, rec, status: uploaded ? 'PENDING_REVIEW' : 'AWAITING_CUSTOMER', stage: uploaded ? 'DECIDE' : 'MONITOR', dept: 'COMPLIANCE', source: 'Sentinel monitoring', customer: acc.trading_name || acc.name });
}

function syncG2Id(acc, expIso) {
  if (!expIso) return;
  const cur = get("SELECT id FROM documents WHERE account_msisdn=? AND doc_type='NATIONAL_ID' AND case_ref IS NULL AND replaced_by IS NULL ORDER BY id DESC", acc.msisdn);
  acc.kyc.id_expiry = expIso;
  const k = j(get('SELECT kyc FROM g2_accounts WHERE msisdn=?', acc.msisdn)?.kyc, {}); k.id_expiry = expIso; run('UPDATE g2_accounts SET kyc=? WHERE msisdn=?', s(k), acc.msisdn);
  const nid = accountIdDoc(acc, acc.kyc, new Date(expIso).getTime(), acc.created_at);
  if (cur) run('UPDATE documents SET replaced_by=? WHERE id=?', nid, cur.id);
}

// ---------- AML/CFT review ----------
function amlReview(o) {
  const acc = o.acc, p = person(acc), t0 = new Date(o.created).getTime();
  const scen = pick(acc.account_type === 'AGENT' ? ['structuring', 'structuring', 'sanctions', 'rapid'] : ['structuring', 'sanctions', 'rapid', 'rapid', 'pep_volume']);
  const tx = all('SELECT * FROM g2_transactions WHERE msisdn=? AND ts<=? ORDER BY ts DESC LIMIT 8', acc.msisdn, iso(t0)).reverse();
  const rows = tx.map(t => ({ ts: R.fmtDate(t.ts.slice(0, 10)).slice(0, 5) + ' ' + t.ts.slice(11, 16), ref: t.tx_ref, type: t.type, cp: t.counterparty.replace('Customer ', ''), amount: t.amount, credit: ['CASH_IN', 'PAYMENT_RECEIVED', 'P2P_RECEIVE'].includes(t.type), bal: t.balance_after }));
  let bal = rows.length ? rows[rows.length - 1].bal : 200; const inj = [];
  const add = (hAgo, type, cp, amt, flag) => { const ts = t0 - hAgo * HOUR; const credit = ['CASH_IN', 'P2P_RECEIVE', 'PAYMENT_RECEIVED'].includes(type); bal = Math.max(0, bal + (credit ? amt : -amt)); const ref = 'TX' + pad(int(0, 999999999), 9); run('INSERT INTO g2_transactions(msisdn,tx_ref,type,amount,counterparty,balance_after,ts) VALUES(?,?,?,?,?,?,?)', acc.msisdn, ref, type, amt, cp, bal, iso(ts)); inj.push({ ts: R.fmtDate(isoD(ts)).slice(0, 5) + ' ' + iso(ts).slice(11, 16), ref, type, cp, amount: amt, credit, bal, flag }); };
  let summary = [], checks = [], dims = {}, flagsField = 'pattern';
  if (scen === 'structuring') { for (let k = 0; k < 4; k++) add(10 - k * 3, 'CASH_IN', 'Walk-in depositor', 940 + int(0, 55), 'Just below the 1,000 USD reporting threshold'); const tot = inj.reduce((a, r) => a + r.amount, 0);
    summary = [{ text: `${inj.length} cash-ins between 940 and 995 USD within 10 hours — total ${tot.toLocaleString('en-US')} USD`, bad: true, bold: true, field: 'pattern', note: 'Threshold-avoidance (structuring) pattern' }, { text: `Usual cash-in on this account: ${Math.round(rows.reduce((a, r) => a + r.amount, 0) / Math.max(1, rows.length))} USD on average` }];
    dims = { AML_CFT: [[35, '4 deposits just below 1,000 USD'], [25, 'Threshold-avoidance pattern'], [12, 'Same-day concentration']] }; }
  else if (scen === 'rapid') { for (let k = 0; k < 6; k++) add(40 - k * 4, 'P2P_RECEIVE', '+243 ' + pick(['81', '82', '97', '99']) + ' ' + pad(int(0, 999), 3) + ' ' + pad(int(0, 9999), 4), int(280, 520), k < 5 ? 'Inflow from a new sender' : 'Inflow from a new sender'); add(8, 'CASH_OUT', 'Agent Limete 0412', int(1900, 2400), 'Immediate cash-out of pooled funds'); const tot = inj.filter(r => r.credit).reduce((a, r) => a + r.amount, 0);
    summary = [{ text: `${inj.length - 1} inflows from ${inj.length - 1} different senders (${tot.toLocaleString('en-US')} USD) then one cash-out within 2 days`, bad: true, bold: true, field: 'pattern', note: 'Pass-through / mule pattern' }, { text: 'Account dormant for 142 days before this activity' }];
    dims = { AML_CFT: [[30, 'Dormant 142 days, then high inflow'], [25, 'Many unique senders'], [15, 'Immediate cash-out']], FRAUD: [[20, 'Possible money-mule account']] }; }
  else if (scen === 'pep_volume') { for (let k = 0; k < 3; k++) add(30 - k * 8, 'PAYMENT_RECEIVED', 'Corporate payer ' + pick(['SOKIMO', 'Kin Import', 'Elikia Holding']), int(3500, 6800), 'Large payment — above declared profile');
    summary = [{ text: `Payments received exceed the declared turnover profile by ${int(220, 410)} %`, bad: true, bold: true, field: 'pattern', note: 'Activity inconsistent with KYC profile' }, { text: 'Owner declared as politically exposed person (PEP) at onboarding' }];
    dims = { AML_CFT: [[45, 'Politically exposed person'], [25, 'Volume above declared profile']] }; }
  else { add(30, 'PAYMENT_RECEIVED', 'Customer +243 81 220 1187', 140, null); summary = [{ text: 'No unusual transaction pattern — alert raised by sanctions screening', field: 'pattern', note: 'Screening alert' }]; dims = { AML_CFT: [[45, 'Fuzzy name match 91 % on a sanctions list'], [20, 'Year of birth matches']] }; }
  const allRows = [...rows, ...inj].sort((a, b) => a.ts.localeCompare(b.ts)).slice(-14);
  const stId = saveDoc(R.statement({ holder: acc.trading_name || acc.name, msisdn: fmtMsisdn(acc.msisdn), period: `${R.fmtDate(isoD(t0 - 14 * DAY))} – ${R.fmtDate(isoD(t0))}`, type_label: `${acc.account_type} account · KYC: ${ownerOf(acc)} · ID ${p.id_number}`, rows: allRows, summary }, rnd), { doc_type: 'STATEMENT', msisdn: acc.msisdn, case_ref: o.ref, at: iso(t0), filename: `G2_statement_${acc.msisdn}.png`, mode: 'G2 export' });
  const docs = [stId];
  const flagged = allRows.map((r, i) => r.flag ? i : -1).filter(i => i >= 0);
  if (flagged.length) checks.push({ code: 'PATTERN', label: summary[0].text, ok: false, doc_id: stId, field: 'pattern', sev: 'bad' });
  if (scen === 'sanctions') {
    const sc = saveDoc(R.screeningReport({ holder: ownerOf(acc), birth: p.dob, candidate: `${p.surname.toUpperCase()}, ${p.given.split('-')[0]} ${pick(['K.', 'M.', 'N.'])}`, list: pick(['UN Security Council Consolidated List', 'OFAC SDN List', 'EU Consolidated List']), score: int(86, 94), cand_birth: `${p.dob.slice(0, 4)} (exact date unknown)` }, rnd), { doc_type: 'SCREENING', msisdn: acc.msisdn, case_ref: o.ref, at: iso(t0), filename: 'screening_result.png', mode: 'Screening API' });
    docs.push(sc); checks.push({ code: 'SCREEN', label: 'Potential sanctions match — disposition required', ok: false, doc_id: sc, field: 'match_score', sev: 'bad' });
  }
  const idId = caseIdDoc(o, acc, acc.kyc.id_expiry, iso(new Date(acc.created_at).getTime()), { filename: 'G2_KYC_ID_on_file.jpg' }); docs.push(idId);
  checks.push({ code: 'KYC_ID', label: 'KYC identity on file', ok: true, info: true, found: fullName(p), doc_id: idId, field: 'owner_name' });
  if (scen === 'sanctions') checks.push({ code: 'DOB', label: 'Date of birth to compare with the list entry', ok: true, info: true, found: R.fmtDate(p.dob), doc_id: idId, field: 'date_of_birth' });
  const rec = { action: 'EDD_REQUIRED', route: 'AML', rule: 'AML/CFT risk ≥ 70', reason: scen === 'sanctions' ? ['Hold, compare identity with list entry, record disposition'] : ['Enhanced due diligence on source of funds', 'Consider a suspicious activity report to the MLRO'], confidence: int(84, 93) };
  AUD(t0, 'Sentinel AI', 'AML monitoring rule triggered', o.ref, { state: summary[0].text, rule: 'AML_' + scen.toUpperCase() });
  detailsCase(o, { fields: { account: acc.trading_name || acc.name, msisdn: fmtMsisdn(acc.msisdn), account_type: acc.account_type, kyc_owner: ownerOf(acc), alert: { structuring: 'Structuring', rapid: 'Pass-through / mule', pep_volume: 'PEP — activity above profile', sanctions: 'Sanctions screening' }[scen] }, docs, checks, dims, rec, status: pick(['UNDER_REVIEW', 'EDD_REQUESTED']), stage: 'RISK_SCORE', dept: 'AML', source: 'Sentinel AML monitoring', customer: acc.trading_name || acc.name });
}

// ---------- contract review (legal) ----------
const CLAUSES = {
  liability: { title: 'Responsabilité', text: ['Le Partenaire est responsable, sans limitation de montant, de tout dommage subi par M-Pesa,', 'y compris les dommages indirects, pertes d’exploitation et pertes de données.'], risk: 'HIGH', note: 'Unlimited liability — not capped (template: 12 months of commissions)', label: 'Unlimited liability' },
  dpa: { title: 'Données personnelles', text: ['Les Parties échangent les données des clients nécessaires à l’exécution du présent contrat.', '[Aucune référence à un accord de traitement des données (DPA) ni à la loi applicable.]'], risk: 'HIGH', note: 'No data processing agreement (DPA)', label: 'Missing data protection clause' },
  termination: { title: 'Résiliation', text: ['Chaque Partie peut résilier le contrat moyennant un préavis de quatre-vingt-dix (90) jours.'], risk: 'MEDIUM', note: '90-day notice vs 30-day template', label: 'Non-standard termination' },
  fees: { title: 'Commissions', text: ['Les commissions sont fixées à 1,8 % du volume traité, révisables unilatéralement par le Partenaire.'], risk: 'MEDIUM', note: 'Fee schedule modified — unilateral revision', label: 'Deviation from approved template' },
  law: { title: 'Droit applicable', text: ['Tout litige sera tranché par arbitrage CCI avec siège à Paris.'], risk: 'LOW', note: 'Arbitration seat outside DRC', label: 'Governing law' },
  indemnity: { title: 'Garantie', text: ['M-Pesa garantit le Partenaire contre toute réclamation de tiers liée au service.'], risk: 'HIGH', note: 'M-Pesa indemnifies the partner for third-party claims', label: 'Indemnification risk' },
};
function contractReview(o) {
  const acc = o.acc, t0 = new Date(o.created).getTime();
  const title = pick(['Contrat de distribution super-agent', 'Contrat d’agrégation marchands', 'Contrat d’intégration API (partenaire)', 'Contrat de services de logistique de float']);
  const issues = o.resolved ? [] : pick([['liability', 'dpa', 'termination'], ['fees', 'law'], ['indemnity', 'termination'], ['dpa'], ['liability']]);
  const std = [{ n: 1, title: 'Objet', text: ['Le présent contrat définit les conditions dans lesquelles le Partenaire distribue les services M-Pesa.'] }, { n: 4, title: 'Obligations LBC/FT', text: ['Le Partenaire applique la politique LBC/FT de M-Pesa et forme son personnel chaque année.'] }];
  let n = 6; const clauses = [...std, ...issues.map(k => ({ n: n++ * 2, ...CLAUSES[k] })), { n: 20, title: 'Confidentialité', text: ['Les Parties s’engagent à garder confidentielles les informations échangées.'] }];
  const kb = acc.kyc.business || business(acc.trading_name || 'Partenaire', ownerOf(acc), acc.kyc.commune, acc.kyc.address, true);
  const cId = saveDoc(R.contract({ title, partner: kb.legal_name, rccm: kb.rccm, date: isoD(t0), clauses }, rnd), { doc_type: 'CONTRACT', msisdn: acc.msisdn, case_ref: o.ref, at: iso(t0), filename: title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z]+/g, '_') + '_page1.png', mode: 'OCR' });
  const rId = saveDoc(R.rccmCert(kb, rnd), { doc_type: 'RCCM', msisdn: acc.msisdn, case_ref: o.ref, at: iso(t0), filename: 'RCCM_partner_scan.png' });
  const checks = issues.map(k => ({ code: 'CLAUSE_' + k.toUpperCase(), label: `${CLAUSES[k].label} — ${CLAUSES[k].note}`, ok: false, doc_id: cId, field: 'clause_' + clauses.find(c => c.label === CLAUSES[k].label).n, sev: CLAUSES[k].risk === 'HIGH' ? 'bad' : 'warn' }));
  checks.push({ code: 'PARTNER_ID', label: 'Partner identified (RCCM) — matches contract party', ok: true, found: kb.rccm, doc_id: rId, field: 'rccm' });
  const dims = { LEGAL: issues.map(k => [CLAUSES[k].risk === 'HIGH' ? 30 : CLAUSES[k].risk === 'MEDIUM' ? 15 : 5, `${CLAUSES[k].label} — ${CLAUSES[k].note}`]) };
  if (issues.includes('dpa')) dims.COMPLIANCE = [[25, 'Personal data shared without DPA']];
  const high = issues.some(k => CLAUSES[k].risk === 'HIGH');
  const rec = issues.length ? { action: high ? 'LEGAL_REVIEW_REQUIRED' : 'REVIEW', route: 'LEGAL', rule: high ? 'High-risk clause detected' : 'Deviation from approved template', reason: issues.map(k => CLAUSES[k].label), confidence: int(84, 92) } : { action: 'APPROVE', route: 'LEGAL', rule: 'Contract conforms to the approved template', reason: ['No deviation detected'], confidence: 95 };
  detailsCase(o, { fields: { partner: kb.legal_name, contract: title, rccm: kb.rccm, deviations: String(issues.length) }, docs: [cId, rId], checks, dims, rec, status: 'PENDING_REVIEW', stage: 'DECIDE', dept: 'LEGAL', source: 'VBU Partnerships', customer: kb.legal_name });
}

// ---------- SIM swap ----------
function simSwap(o) {
  const acc = o.acc, p = person(acc), t0 = new Date(o.created).getTime();
  const scen = o.resolved ? 'ok' : pick(['callback', 'callback', 'id_mismatch', 'sig_mismatch', 'recent_activity']);
  const reasons = [['Lost SIM', 'Perte de la carte SIM'], ['Stolen phone', 'Vol du téléphone'], ['Damaged SIM', 'Carte SIM endommagée'], ['Upgrade to 4G/eSIM', 'Migration 4G / eSIM']];
  const [reason, reason_fr] = pick(reasons);
  const formIdNum = scen === 'id_mismatch' ? p.id_number.replace(/\d{3}$/, pad(int(100, 999), 3)) : p.id_number;
  const agentName = `Agent ${pick(ctx.SHOP2)} ${pick(ctx.COMMUNES)}`, agentCode = 'AGT-' + pad(int(100000, 999999), 6);
  const formId = saveDoc(R.simSwapForm({ full_name: ownerOf(acc), msisdn: fmtMsisdn(acc.msisdn), id_number: formIdNum, id_type: p.id_type === 'Passport' ? 'Passeport' : 'Carte d’électeur', reason, reason_fr, new_iccid: '8924301' + pad(int(0, 999999999), 13), date: isoD(t0), agent: agentName, agent_code: agentCode, sig_mismatch: scen === 'sig_mismatch' }, rnd), { doc_type: 'SIM_SWAP_FORM', msisdn: acc.msisdn, case_ref: o.ref, at: iso(t0), photo: true, filename: `IMG_${int(1000, 9999)}.jpg` });
  const idId = caseIdDoc(o, acc, acc.kyc.id_expiry, iso(t0 + 60000));
  const checks = [
    { code: 'ID_NUM', label: 'ID number on form = G2 KYC', ok: scen !== 'id_mismatch', declared: p.id_number, found: formIdNum, doc_id: formId, field: 'id_number', sev: 'bad' },
    { code: 'ID_DOC', label: 'ID presented = G2 KYC identity', ok: true, declared: ownerOf(acc), found: fullName(p), doc_id: idId, field: 'owner_name' },
    { code: 'ID_VALID', label: 'ID document valid', ok: acc.kyc.id_expiry >= isoD(ctx.now), found: R.fmtDate(acc.kyc.id_expiry), doc_id: idId, field: 'id_expiry' },
    { code: 'SIGNATURE', label: 'Signature matches specimen on file', ok: scen !== 'sig_mismatch', doc_id: formId, field: 'signature', sev: 'bad' },
    { code: 'MSISDN', label: 'Line exists in G2 and is active', ok: true, found: fmtMsisdn(acc.msisdn), doc_id: formId, field: 'msisdn' },
  ];
  if (scen === 'recent_activity') checks.push({ code: 'ATO', label: 'PIN reset attempt 2 h before this SIM swap — account-takeover pattern (G2 log)', ok: false, found: 'PIN_RESET ' + iso(t0 - 2 * HOUR).slice(11, 16) });
  if (scen === 'callback') checks.push({ code: 'CALLBACK', label: 'Callback on the alternative number registered in KYC — pending', ok: false, sev: 'warn' });
  const dims = { FRAUD: [[12, `SIM swap requested (${reason.toLowerCase()})`]], OPERATIONAL: [] };
  if (scen === 'id_mismatch') dims.FRAUD.push([35, 'ID number on the form differs from KYC']);
  if (scen === 'sig_mismatch') dims.FRAUD.push([35, 'Signature differs from specimen']);
  if (scen === 'recent_activity') { dims.FRAUD.push([30, 'PIN reset attempt 2 h before the request'], [15, 'Balance 1,240 USD — high-value target']); }
  if (scen === 'callback') dims.OPERATIONAL.push([10, 'Identity callback on registered alternative number pending']);
  const bad = checks.filter(c => !c.ok && c.code !== 'CALLBACK');
  const rec = bad.length || scen === 'recent_activity' ? { action: 'ESCALATE', route: 'RISK', rule: 'Identity doubt on a sensitive G2 operation', reason: [...bad.map(c => c.label + ' — failed'), ...(scen === 'recent_activity' ? ['Account-takeover pattern: PIN reset then SIM swap'] : [])], confidence: 89 } : o.resolved ? { action: 'AUTO_PROCESS', route: 'OPERATIONS', rule: 'All identity checks passed → SIM swap executed in G2', reason: ['ID and signature verified'], confidence: 95 } : { action: 'APPROVE', route: 'OPERATIONS', rule: 'Sensitive operation → callback before execution', reason: ['Documents consistent', 'Callback to confirm the request'], confidence: 91 };
  detailsCase(o, { fields: { full_name: ownerOf(acc), msisdn: fmtMsisdn(acc.msisdn), id_number: formIdNum, swap_reason: reason, agent: `${agentName} (${agentCode})`, requester_type: acc.account_type === 'CUSTOMER' ? 'Customer' : acc.account_type === 'AGENT' ? 'Agent' : 'Merchant' }, docs: [formId, idId], checks, dims, rec, status: rec.action === 'ESCALATE' ? 'UNDER_REVIEW' : 'PENDING_REVIEW', stage: 'VERIFY', dept: rec.action === 'ESCALATE' ? 'RISK' : 'OPERATIONS', source: 'Agent shop', customer: acc.trading_name || acc.name });
}

// ---------- support (reversal / PIN) ----------
function support(o) {
  const acc = o.acc, t0 = new Date(o.created).getTime();
  if (rnd() < 0.62) {
    const amt = (int(15, 380) + (rnd() < 0.5 ? 0.5 : 0)).toFixed(2), cp = '0' + pick(['81', '82', '97', '99', '84']) + pad(int(0, 9999999), 7), ref = 'TX' + pad(int(10000000, 99999999), 8), when = t0 - int(1, 20) * HOUR;
    const right = cp.slice(0, -2) + cp.slice(-1) + cp.slice(-2, -1);
    run('INSERT INTO g2_transactions(msisdn,tx_ref,type,amount,counterparty,balance_after,ts) VALUES(?,?,?,?,?,?,?)', acc.msisdn, ref, 'P2P_SEND', +amt, 'Customer +243 ' + cp.slice(1, 3) + ' ' + cp.slice(3, 6) + ' ' + cp.slice(6), 42.1, iso(when));
    const dt = R.fmtDate(isoD(when)).replace(/\/20(\d\d)$/, '/$1');
    const recip = pick(ctx.LAST).split(' ')[0].toUpperCase();
    const smsId = saveDoc(R.phoneReceipt({ msisdn: fmtMsisdn(acc.msisdn), tx_ref: ref, amount_txt: amt, cp, date_txt: dt, sms: [{ from: 'mpesa', text: `${ref} Confirmed. You have sent ${amt} USD to ${cp} ${recip} on ${dt} at ${iso(when).slice(11, 16)}. New balance is 42.10 USD.`, t: iso(when).slice(11, 16) }, { from: 'me', text: `Wrong number! I wanted to send to ${right}. Please reverse.`, t: iso(when + 4 * 60000).slice(11, 16) }] }, rnd), { doc_type: 'SCREENSHOT', msisdn: acc.msisdn, case_ref: o.ref, at: iso(t0), filename: 'Screenshot_' + isoD(t0).replace(/-/g, '') + '.png' });
    const recipientSpent = !o.resolved && rnd() < 0.35;
    const checks = [{ code: 'TX_FOUND', label: 'Transaction found in G2', ok: true, found: ref, doc_id: smsId, field: 'tx_ref' }, { code: 'AMOUNT', label: 'Amount matches G2', ok: true, found: amt + ' USD', doc_id: smsId, field: 'amount' }, { code: 'WINDOW', label: 'Reported within 24 h', ok: true, found: dt, doc_id: smsId, field: 'tx_date' }, { code: 'RECIPIENT', label: recipientSpent ? 'Recipient balance insufficient — funds already withdrawn' : 'Recipient balance sufficient — funds can be held', ok: !recipientSpent, found: cp, doc_id: smsId, field: 'counterparty', sev: 'warn' }];
    const rec = recipientSpent ? { action: 'ESCALATE', route: 'OPERATIONS', rule: 'Reversal not possible automatically', reason: ['Recipient has withdrawn the funds — contact recipient / partial reversal'], confidence: 86 } : { action: 'APPROVE', route: 'OPERATIONS', rule: 'Wrong-number transfer reported < 24 h, funds available', reason: ['Hold funds on recipient wallet', 'Reverse after recipient notification'], confidence: 93 };
    detailsCase(o, { fields: { full_name: acc.kyc.person ? ownerOf(acc) : acc.name, msisdn: fmtMsisdn(acc.msisdn), request: 'Wrong-number transfer — reversal', tx_ref: ref, amount: amt + ' USD', counterparty: cp, intended_recipient: right }, docs: [smsId], checks, dims: { OPERATIONAL: [[12, 'Reversal request — funds at risk of withdrawal'], ...(recipientSpent ? [[25, 'Recipient already cashed out']] : [])], FRAUD: [[6, 'Reversal requests are a known fraud vector — verify sender']] }, rec, status: recipientSpent ? 'UNDER_REVIEW' : 'PENDING_REVIEW', stage: 'DECIDE', dept: 'OPERATIONS', source: 'TOBi', customer: acc.trading_name || acc.name });
  } else {
    const idId = caseIdDoc(o, acc, acc.kyc.id_expiry, iso(t0));
    const checks = [{ code: 'ID_NAME', label: 'Name on ID = G2 KYC', ok: true, declared: ownerOf(acc), found: fullName(person(acc)), doc_id: idId, field: 'owner_name' }, { code: 'ID_NUM', label: 'ID number = G2 KYC', ok: true, found: person(acc).id_number, doc_id: idId, field: 'id_number' }, { code: 'ID_VALID', label: 'ID document valid', ok: acc.kyc.id_expiry >= isoD(ctx.now), found: R.fmtDate(acc.kyc.id_expiry), doc_id: idId, field: 'id_expiry' }];
    const ok = checks.every(c => c.ok);
    if (ok && !o.resolved) {   // same rule as live TOBi: verified identity → PIN reset done automatically in G2 (STP)
      const t1 = t0 + int(40, 90) * 1000;
      run("UPDATE cases SET status='RESOLVED', stage='RESOLVE', resolved_at=?, sla_status='MET' WHERE id=?", iso(t1), o.cid);
      run('INSERT INTO decisions(case_id,actor,role,action,ai_action,override,reason,created_at) VALUES(?,?,?,?,?,?,?,?)', o.cid, 'Sentinel AI (policy STP)', 'SYSTEM', 'APPROVE', 'AUTO_PROCESS', 0, 'Identity verified → PIN reset in G2', iso(t1));
      run('INSERT INTO g2_operations(msisdn,op,operator,case_ref,detail,ts) VALUES(?,?,?,?,?,?)', acc.msisdn, 'PIN_RESET', 'Sentinel API (TOBi)', o.ref, 'PIN reset — temporary PIN sent by SMS', iso(t1));
      AUD(t1, 'Sentinel AI (policy STP)', 'Straight-through processing — PIN reset executed in G2', o.ref, { state: 'RESOLVED · SLA MET' });
      o.resolved = true;
    }
    detailsCase(o, { fields: { full_name: ownerOf(acc), msisdn: fmtMsisdn(acc.msisdn), request: 'PIN locked after 3 wrong attempts — reset', id_number: person(acc).id_number }, docs: [idId], checks, dims: { FRAUD: [[10, 'PIN reset is a sensitive operation']], ...(ok ? {} : { COMPLIANCE: [[35, 'ID document expired']] }) }, rec: ok ? { action: 'AUTO_PROCESS', route: 'OPERATIONS', rule: 'Identity verified → PIN reset in G2 (straight-through)', reason: ['ID consistent with KYC'], confidence: 94 } : { action: 'REQUEST_INFORMATION', route: 'OPERATIONS', rule: 'ID expired', reason: ['Ask for a valid ID before reset'], confidence: 90 }, status: ok ? 'PENDING_REVIEW' : 'AWAITING_CUSTOMER', stage: 'VERIFY', dept: 'OPERATIONS', source: 'TOBi', customer: acc.trading_name || acc.name });
  }
}
