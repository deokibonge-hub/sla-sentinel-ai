// Document Intelligence Service: upload storage, extraction (AI vision or OCR/rules), field mapping.
import { sniffMime } from './security.js';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DATA_DIR, run, get, all, s, j } from './db.js';
import { iso, audit, now } from './core.js';
import { aiEnabled, claude, parseJSON } from './ai.js';
import { DOC_TYPES } from './schema.js';
import { ocrFile, parseDocument, locateFields } from './docintel.js';

export function saveUpload({ application_id, filename, mime, data, doc_type = null }) {
  const buf = Buffer.from(String(data || ''), 'base64');
  if (buf.length > 12 * 1024 * 1024) throw new Error('File too large (max 12 MB)');
  const real = sniffMime(buf);   // the bytes decide, not the file name or the declared type
  if (!real) throw new Error('Only photos (JPG, PNG, WebP) or PDF documents are accepted.');
  mime = real;
  const ext = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'application/pdf': '.pdf' }[real];
  const safe = String(filename || 'document').replace(/[^\w.\-]+/g, '_').replace(/\.[^.]*$/, '').slice(-70) + ext;
  const name = `${Date.now()}_${safe}`;
  const p = path.join(DATA_DIR, 'uploads', name);
  fs.writeFileSync(p, buf);
  const r = run('INSERT INTO documents(application_id,doc_type,filename,mime,path,size,status,uploaded_at) VALUES(?,?,?,?,?,?,?,?)',
    application_id, doc_type, safe, mime, name, buf.length, 'RECEIVED', iso());
  return get('SELECT * FROM documents WHERE id=?', r.lastInsertRowid);
}

// OCR + parsing live in docintel.js (multi-pass OCR, FR/EN layout-agnostic parser, MRZ). Works without AI.
export { detectType } from './docintel.js';

async function aiExtract(doc, hintType) {
  const p = path.join(DATA_DIR, 'uploads', doc.path);
  const b64 = fs.readFileSync(p).toString('base64');
  const isPdf = doc.mime === 'application/pdf' || /\.pdf$/i.test(doc.filename);
  const mt = isPdf ? 'application/pdf' : (/^image\/(png|jpeg|gif|webp)$/.test(doc.mime) ? doc.mime : 'image/jpeg');
  const block = isPdf ? { type: 'document', source: { type: 'base64', media_type: mt, data: b64 } } : { type: 'image', source: { type: 'base64', media_type: mt, data: b64 } };
  const prompt = `You are the Document Intelligence Service of an M-Pesa (DRC) merchant onboarding platform.
Classify the document as one of: RCCM, NATIONAL_ID, PROOF_OF_ADDRESS, TAX, ID_NAT, OTHER${hintType ? ` (the user said it is ${hintType})` : ''}.
Extract only fields actually visible. Possible keys: legal_name, rccm, id_nat, tax_number, address, commune, city, business_activity, legal_form (COMPANY|INDIVIDUAL), issue_date (YYYY-MM-DD), owner_name (given names + surname), id_type, id_number, date_of_birth, id_expiry (YYYY-MM-DD), issuing_authority, holder_name.
Return ONLY JSON: {"doc_type":"...","fields":{...},"confidence":{"field":0.0-1.0},"notes":"short"}`;
  const txt = await claude({ system: 'Return strict JSON only.', messages: [{ role: 'user', content: [block, { type: 'text', text: prompt }] }], maxTokens: 900 });
  const out = parseJSON(txt);
  return { doc_type: out.doc_type || hintType || 'OTHER', fields: out.fields || {}, confidence: out.confidence || {}, notes: out.notes };
}

export async function extractDocument(doc, hintType = null) {
  run('UPDATE documents SET status=? WHERE id=?', 'ANALYSING', doc.id);
  let res, mode = 'OCR';
  const o = ocrFile(path.join(DATA_DIR, 'uploads', doc.path), doc.mime, doc.filename);
  const raw = o.text || '';
  if (aiEnabled()) {
    try { res = await aiExtract(doc, hintType); mode = 'AI'; } catch (e) { console.warn('AI extraction failed, falling back:', e.message); }
  }
  if (!res) res = parseDocument(raw, hintType, doc.filename, o.conf || 0);
  const type = DOC_TYPES[res.doc_type] ? res.doc_type : 'OTHER';
  const expiry = res.fields.id_expiry || res.fields.expiry_date || null;
  run('UPDATE documents SET doc_type=?, status=?, expiry_date=? WHERE id=?', type, 'EXTRACTED', expiry, doc.id);
  let boxes = {};
  try { boxes = locateFields(res.fields, o); } catch { boxes = {}; }
  run('INSERT INTO extractions(document_id,mode,doc_type,fields,confidence,raw_text,created_at,boxes) VALUES(?,?,?,?,?,?,?,?)', doc.id, mode, type, s(res.fields), s(res.confidence), raw.slice(0, 4000), iso(), s(boxes));
  const checks = precheck(doc, res, raw, expiry);
  run('UPDATE documents SET precheck=? WHERE id=?', s(checks), doc.id);
  audit({ action: 'Document analysed', entity: 'document:' + doc.id, new_state: type, evidence: { mode, ocr: mode === 'OCR' ? `${o.engine} · conf ${Math.round(o.conf)} · ${o.passes} pass(es)` : null, fields: Object.keys(res.fields), precheck: checks.map(c => `${c.code}:${c.ok ? 'OK' : 'FAIL'}`) } });
  return { doc_type: type, mode, fields: res.fields, confidence: res.confidence, precheck: checks };
}

// Pre-control: format, size, readability, validity (expiry)
export function precheck(doc, res, raw, expiry) {
  const okFmt = /^(image\/(png|jpe?g|webp)|application\/pdf)$/i.test(doc.mime || '') || /\.(png|jpe?g|webp|pdf)$/i.test(doc.filename || '');
  const mb = (doc.size || 0) / 1048576;
  const nf = Object.keys(res.fields || {}).length;
  const conf = Object.values(res.confidence || {}); const avg = conf.length ? conf.reduce((a, b) => a + Number(b), 0) / conf.length : 0;
  const readable = nf >= 2 && (avg === 0 || avg >= 0.6);
  const out = [
    { code: 'FORMAT', label: okFmt ? `Format ${String(doc.mime || '').split('/')[1]?.toUpperCase() || 'OK'}` : 'Unsupported format', ok: okFmt },
    { code: 'SIZE', label: `Size ${mb < 1 ? Math.max(1, Math.round(mb * 1024)) + ' KB' : mb.toFixed(1) + ' MB'}`, ok: mb <= 12 && (doc.size || 0) > 1024 },
    { code: 'READABLE', label: readable ? `Readable (${nf} fields${avg ? ', ' + Math.round(avg * 100) + '%' : ''})` : 'Hard to read — clearer photo needed', ok: readable },
  ];
  if (expiry) {
    const days = Math.floor((new Date(expiry) - now()) / 86400000);
    out.push({ code: 'EXPIRY', label: days < 0 ? `Expired on ${expiry}` : days < 30 ? `Expires soon (${expiry})` : `Valid until ${expiry}`, ok: days >= 0, warn: days >= 0 && days < 30 });
  }
  return out;
}

const DOC_SQL = 'SELECT d.*, e.fields AS ex_fields, e.confidence AS ex_conf, e.mode AS ex_mode, e.boxes AS ex_boxes FROM documents d LEFT JOIN extractions e ON e.id=(SELECT MAX(id) FROM extractions WHERE document_id=d.id) WHERE ';
const docMap = (d) => ({ ...d, ex_fields: j(d.ex_fields, {}), ex_conf: j(d.ex_conf, {}), boxes: j(d.ex_boxes, {}), precheck: j(d.precheck, []), ex_boxes: undefined });
export function appDocuments(application_id) {
  return all(DOC_SQL + 'd.application_id=? AND d.replaced_by IS NULL ORDER BY d.id', application_id).map(docMap);
}
// every document that belongs to a case: application documents, documents attached to the request, documents tagged with the case
export function caseDocuments(c, app) {
  const seen = new Set(), out = [];
  const push = (rows, extra = {}) => { for (const d of rows) if (!seen.has(d.id)) { seen.add(d.id); out.push({ ...docMap(d), ...extra }); } };
  if (app) push(all(DOC_SQL + 'd.application_id=? AND d.replaced_by IS NULL AND (d.case_ref IS NULL OR d.case_ref=?) ORDER BY d.id', app.id, c.ref));
  const det = j(c.details, null);
  const ids = (det?.documents || []).map(Number).filter(Boolean);
  if (ids.length) push(all(DOC_SQL + `d.id IN (${ids.map(() => '?').join(',')}) ORDER BY d.id`, ...ids));
  push(all(DOC_SQL + 'd.case_ref=? ORDER BY d.id', c.ref));
  if (!out.length && c.account_msisdn) push(all(DOC_SQL + 'd.account_msisdn=? AND d.case_ref IS NULL AND d.replaced_by IS NULL ORDER BY d.id', c.account_msisdn), { on_file: true });
  return out;
}
