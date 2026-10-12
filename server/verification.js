// Document Verification Service: declared data vs documents vs other documents; expiry; completeness.
import { run, all, j, s } from './db.js';
import { iso, now, DAY } from './core.js';
import { appDocuments } from './documents.js';
import { FIELD_MAP, requiredDocs, DOC_TYPES } from './schema.js';

export const norm = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const STOP = new Set(['SARL', 'SA', 'SAS', 'SARLU', 'ETS', 'THE', 'AND', 'DE', 'DU', 'LA', 'LE', 'AVENUE', 'AV', 'NO', 'N']);
export function similarity(a, b) {
  const A = norm(a), B = norm(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  if (A.replace(/ /g, '') === B.replace(/ /g, '')) return 1;
  const ta = new Set(A.split(' ').filter(t => !STOP.has(t))), tb = new Set(B.split(' ').filter(t => !STOP.has(t)));
  if (!ta.size || !tb.size) return 0;
  let inter = 0; for (const t of ta) if (tb.has(t)) inter++;
  const small = Math.min(ta.size, tb.size);
  return Math.max(inter / Math.max(ta.size, tb.size), small >= 2 ? inter / small * 0.92 : 0);
}
const STRICT = new Set(['rccm', 'id_nat', 'id_number', 'tax_number']);
export function compareValues(key, declared, found) {
  if (STRICT.has(key)) return norm(declared).replace(/ /g, '') === norm(found).replace(/ /g, '') ? 'MATCH' : 'MISMATCH';
  const sc = similarity(declared, found);
  return sc >= 0.8 ? 'MATCH' : sc >= 0.5 ? 'PARTIAL' : 'MISMATCH';
}

// Build verification results for an application; persist & return.
export function verifyApplication(app) {
  const fields = j(app.fields, {}), sources = j(app.field_sources, {});
  const docs = appDocuments(app.id);
  const out = [];
  const add = (check_code, label, status, declared = null, found = null, source = null, detail = null) => out.push({ check_code, label, status, declared, found, source, detail });

  // 1. declared vs document
  for (const d of docs) {
    for (const [k, v] of Object.entries(d.ex_fields || {})) {
      const fk = k === 'holder_name' ? null : k;
      if (!fk || !FIELD_MAP[fk] || !fields[fk]) continue;
      const src = sources[fk] || '';
      const status = compareValues(fk, fields[fk], v);
      const clarified = (j(app.field_sources, {})[fk + '__clarified']);
      add(`DECL_${fk.toUpperCase()}`, `${FIELD_MAP[fk].label}: declared vs ${DOC_TYPES[d.doc_type]?.label || 'document'}`,
        status === 'MATCH' ? 'MATCH' : clarified ? 'CLARIFIED' : status, fields[fk], v, `document:${d.id}`, src.startsWith('document') ? 'Value taken from document' : null);
    }
  }
  // 2. cross-document
  const byType = Object.fromEntries(docs.map(d => [d.doc_type, d]));
  const id = byType.NATIONAL_ID, rc = byType.RCCM, pa = byType.PROOF_OF_ADDRESS;
  if (id && fields.owner_name && id.ex_fields.owner_name) {
    add('X_OWNER_ID', 'Owner name vs ID document', compareValues('owner_name', fields.owner_name, id.ex_fields.owner_name), fields.owner_name, id.ex_fields.owner_name, `document:${id.id}`);
  }
  if (rc && pa && rc.ex_fields.commune && pa.ex_fields.commune) {
    add('X_ADDR_RCCM_POA', 'Address: RCCM vs proof of address', compareValues('commune', rc.ex_fields.commune, pa.ex_fields.commune), rc.ex_fields.commune, pa.ex_fields.commune, `document:${pa.id}`);
  }
  // 3. expiry
  for (const d of docs) {
    if (!d.expiry_date) continue;
    const days = Math.floor((new Date(d.expiry_date) - now()) / DAY);
    const st = days < 0 ? 'EXPIRED' : days <= 30 ? 'EXPIRING' : 'VALID';
    add(`EXP_${d.doc_type}`, `${DOC_TYPES[d.doc_type]?.label} validity`, st, null, d.expiry_date, `document:${d.id}`, days < 0 ? `Expired ${-days} days ago` : `Expires in ${days} days`);
  }
  // 3b. readability — documents captured manually or unreadable need a human look
  for (const d of all("SELECT * FROM documents WHERE application_id=? AND status IN ('UNREADABLE','MANUAL_REVIEW') AND replaced_by IS NULL", app.id))
    add(`READ_${d.doc_type || 'OTHER'}`, `${DOC_TYPES[d.doc_type]?.label || 'Document'} readability`, 'REVIEW', null, d.filename, `document:${d.id}`, 'Photo unreadable — details typed by the customer, to be checked by an agent');
  // 4. completeness
  for (const t of requiredDocs(fields)) {
    if (!byType[t]) add(`DOC_${t}`, `${DOC_TYPES[t].label} provided`, 'MISSING');
    else add(`DOC_${t}`, `${DOC_TYPES[t].label} provided`, 'OK', null, byType[t].filename, `document:${byType[t].id}`);
  }
  run('DELETE FROM verifications WHERE application_id=?', app.id);
  for (const v of out) run('INSERT INTO verifications(application_id,check_code,label,status,declared,found,source,detail,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    app.id, v.check_code, v.label, v.status, v.declared, v.found, v.source, v.detail, iso());
  return out;
}

export function summary(results, fields) {
  const bad = (codes) => results.filter(r => codes.some(c => r.check_code.startsWith(c)) && ['MISMATCH', 'MISSING', 'EXPIRED', 'REVIEW'].includes(r.status));
  const item = (label, list) => ({ label, ok: list.length === 0, issues: list.map(r => r.label + ' — ' + r.status) });
  return [
    item('Identity verified', bad(['DECL_OWNER', 'DECL_ID_', 'X_OWNER', 'EXP_NATIONAL_ID', 'DOC_NATIONAL_ID'])),
    item('Business information', bad(['DECL_LEGAL_NAME', 'DECL_ADDRESS', 'DECL_COMMUNE', 'DECL_CITY', 'X_ADDR'])),
    item('RCCM verified', fields.contract_type === 'MR' ? [] : bad(['DECL_RCCM', 'DECL_ID_NAT', 'DOC_RCCM'])),
    item('Documents complete', bad(['DOC_', 'READ_'])),
    item('Document consistency', results.filter(r => r.status === 'MISMATCH')),
    (() => { const iss = [fields.terms_accepted === 'No' ? 'Terms not accepted' : null, fields.sanctions === 'Yes' ? 'Sanctions / asset freeze declared' : null].filter(Boolean); return { label: 'Eligibility', ok: !iss.length, issues: iss }; })(),
  ];
}
