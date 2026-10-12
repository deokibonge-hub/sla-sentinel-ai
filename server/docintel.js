// Autonomous Document Intelligence (no AI needed): multi-pass OCR + bilingual (FR/EN), layout-agnostic parsing + MRZ.
// Works on real photos: auto-orientation, upscaling, contrast, deskew, rotation retries; picks the best OCR pass.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const has = (bin) => { try { execFileSync(process.platform === 'win32' ? 'where' : 'which', [bin], { stdio: 'ignore' }); return true; } catch { return false; } };
const TOOLS = { tesseract: has('tesseract'), convert: has('magick') ? 'magick' : has('convert') ? 'convert' : null, pdftotext: has('pdftotext'), pdftoppm: has('pdftoppm') };
const LOCAL_TESSDATA = path.join(HERE, 'tessdata');
let LANG = 'eng', TESSDIR = null;
(function pickLangs() {
  if (!TOOLS.tesseract) return;
  if (fs.existsSync(path.join(LOCAL_TESSDATA, 'fra.traineddata')) && fs.existsSync(path.join(LOCAL_TESSDATA, 'eng.traineddata'))) { TESSDIR = LOCAL_TESSDATA; LANG = 'fra+eng'; return; }
  try { const l = execFileSync('tesseract', ['--list-langs'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); if (/\bfra\b/.test(l)) LANG = 'fra+eng'; } catch { }
})();
export const capabilities = () => ({ ocr: TOOLS.tesseract, languages: LANG, preprocessing: !!TOOLS.convert, pdf: TOOLS.pdftotext });

// ---------- OCR ----------
function tess(img, psm) {
  const args = [img, 'stdout', '--psm', String(psm), '-l', LANG, ...(TESSDIR ? ['--tessdata-dir', TESSDIR] : []), '-c', 'tessedit_create_tsv=1'];
  const tsv = execFileSync('tesseract', args, { encoding: 'utf8', timeout: 45000, stdio: ['ignore', 'pipe', 'ignore'] });
  const lines = new Map(); let cs = 0, n = 0, W = 0, H = 0;
  for (const row of tsv.split('\n').slice(1)) {
    const c = row.split('\t'); if (c.length < 12) continue;
    if (c[0] === '1') { W = +c[8]; H = +c[9]; continue; }
    if (c[0] !== '5') continue;
    const word = c[11].trim(); if (!word) continue;
    const conf = Number(c[10]); if (conf >= 0) { cs += conf; n++; }
    const k = `${c[2]}.${c[3]}.${c[4]}`; if (!lines.has(k)) lines.set(k, []); lines.get(k).push({ word, conf, x: +c[6], y: +c[7], w: +c[8], h: +c[9] });
  }
  const text = [...lines.values()].map(ws => ws.map(w => w.word).join(' ')).join('\n');
  return { text, conf: n ? cs / n : 0, words: n, lines: [...lines.values()], W, H };
}
const score = (r) => r.words ? (r.conf / 100) * Math.min(1, r.words / 25) + keywordHits(r.text) * 0.08 : 0;
function prep(src, out, extra = []) {
  execFileSync(TOOLS.convert, [src, '-auto-orient', ...extra, '-resize', '2200x2200<', '-colorspace', 'Gray', '-normalize', '-deskew', '40%', '-sharpen', '0x1', out], { timeout: 30000, stdio: 'ignore' });
  return out;
}
export function ocrImage(file) {
  if (!TOOLS.tesseract) return { text: '', conf: 0, words: 0, passes: 0, engine: 'none' };
  const tmp = file + '_ocr'; const tries = []; const cleanup = [];
  const attempt = (img, psm, tag) => { try { const r = tess(img, psm); r.tag = tag; tries.push(r); return r; } catch { return null; } };
  try {
    let base = file;
    if (TOOLS.convert) { try { base = prep(file, tmp + '_p.png'); cleanup.push(base); } catch { base = file; } }
    const a = attempt(base, 4, 'prep-psm4');
    if (!a || score(a) < 0.55) attempt(base, 6, 'prep-psm6');
    if (!a || score(a) < 0.55) attempt(file, 4, 'raw-psm4');
    const best0 = tries.reduce((x, y) => (score(y) > score(x) ? y : x), { text: '', conf: 0, words: 0 });
    if (TOOLS.convert && (best0.conf < 72 || keywordHits(best0.text) === 0)) {           // probably rotated / upside-down photo
      for (const deg of [90, 270, 180]) { try { const p = prep(file, tmp + `_r${deg}.png`, ['-rotate', String(deg)]); cleanup.push(p); const r = attempt(p, 4, 'rot' + deg); if (r && score(r) > 0.6) break; } catch { } }
    }
    const best = tries.reduce((x, y) => (score(y) > score(x) ? y : x), { text: '', conf: 0, words: 0 });
    return { ...best, passes: tries.length, engine: `tesseract ${LANG}`, rotated: /^rot/.test(best.tag || '') };
  } finally { for (const f of cleanup) fs.rmSync(f, { force: true }); }
}
export function ocrFile(file, mime, filename) {
  if (mime === 'application/pdf' || /\.pdf$/i.test(filename || '')) {
    let t = '';
    if (TOOLS.pdftotext) { try { t = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8', timeout: 20000 }); } catch { } }
    if (t.trim().length >= 40) return { text: t, conf: 96, words: t.split(/\s+/).length, passes: 1, engine: 'pdf-text' };
    if (TOOLS.pdftoppm) { try { execFileSync('pdftoppm', ['-r', '220', '-png', '-f', '1', '-l', '1', file, file + '_pg']); const pg = file + '_pg-1.png'; const r = ocrImage(pg); fs.rmSync(pg, { force: true }); return r; } catch { } }
    return { text: t, conf: 0, words: 0, passes: 0, engine: 'none' };
  }
  return ocrImage(file);
}

// ---------- parsing ----------
export const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[°º]/g, ' ').replace(/[’'`´]/g, ' ').toUpperCase();
const KW = {
  RCCM: [['RCCM', 3], ['REGISTRE DU COMMERCE', 3], ['CREDIT MOBILIER', 2], ['IMMATRICULATION', 2], ['TRADE REGISTER', 3], ['DENOMINATION', 1], ['GUICHET UNIQUE', 2], ['FORME JURIDIQUE', 1], ['LEGAL FORM', 1]],
  NATIONAL_ID: [['PASSEPORT', 3], ['PASSPORT', 3], ['CARTE D ELECTEUR', 4], ['ELECTEUR', 2], ['VOTER', 3], ['CARTE D IDENTITE', 4], ['IDENTITY CARD', 4], ['NATIONAL ID', 3], ['DATE DE NAISSANCE', 2], ['DATE OF BIRTH', 2], ['POST-NOM', 2], ['GIVEN NAMES', 2], ['SURNAME', 1]],
  PROOF_OF_ADDRESS: [['FACTURE', 2], ['SNEL', 3], ['REGIDESO', 3], ['ELECTRICITE', 2], ['ABONNE', 2], ['COMPTEUR', 2], ['UTILITY', 3], ['BILL', 2], ['PROOF OF ADDRESS', 4], ['ATTESTATION DE RESIDENCE', 4], ['SERVICE ADDRESS', 2]],
  TAX: [['ATTESTATION FISCALE', 4], ['DGI', 2], ['DIRECTION GENERALE DES IMPOTS', 4], ['TAX CERTIFICATE', 4]],
};
function keywordHits(text) { const t = norm(text); let h = 0; for (const list of Object.values(KW)) for (const [k] of list) if (t.includes(k)) h++; return Math.min(h, 6); }
export function detectType(text, filename = '') {
  const t = norm(text + ' ' + filename);
  const sc = Object.fromEntries(Object.entries(KW).map(([k, list]) => [k, list.reduce((a, [w, p]) => a + (t.includes(w) ? p : 0), 0)]));
  if (findMRZ(text)) sc.NATIONAL_ID += 5;
  const best = Object.entries(sc).sort((a, b) => b[1] - a[1])[0];
  return best[1] >= 2 ? best[0] : 'OTHER';
}

const LABELS = {
  legal_name: ['DENOMINATION SOCIALE', 'DENOMINATION', 'RAISON SOCIALE', 'LEGAL NAME', 'COMPANY NAME', 'BUSINESS NAME', 'NOM DE L ENTREPRISE'],
  trading_name: ['SIGLE / NOM COMMERCIAL', 'NOM COMMERCIAL', 'TRADING NAME', 'ENSEIGNE', 'SIGLE'],
  legal_form: ['FORME JURIDIQUE', 'LEGAL FORM'],
  address: ['SIEGE SOCIAL', 'REGISTERED ADDRESS', 'SERVICE ADDRESS', 'ADRESSE', 'ADDRESS', 'SIEGE'],
  commune: ['COMMUNE'],
  city: ['VILLE / PROVINCE', 'VILLE', 'PROVINCE', 'CITY'],
  business_activity: ['OBJET SOCIAL', 'ACTIVITE PRINCIPALE', 'BUSINESS ACTIVITY', 'ACTIVITE', 'ACTIVITY'],
  issue_date: ['DATE D IMMATRICULATION', 'DATE OF REGISTRATION', 'DATE DE DELIVRANCE', 'DATE OF ISSUE', 'ISSUE DATE', 'DATE DE FACTURE', 'BILL DATE'],
  id_nat: ['IDENTIFICATION NATIONALE', 'ID NAT', 'ID. NAT'],
  tax_number: ['NUMERO IMPOT (NIF)', 'NUMERO IMPOT', 'NUMERO D IMPOT', 'TAX NUMBER', 'NIF'],
  rccm_label: ['NUMERO RCCM', 'RCCM NUMBER', 'N RCCM', 'RCCM'],
  surname: ['NOM / SURNAME', 'SURNAME', 'NOM'],
  postnom: ['POST-NOM', 'POST NOM', 'POSTNOM'],
  given: ['PRENOMS / GIVEN NAMES', 'GIVEN NAMES', 'PRENOMS', 'PRENOM', 'FIRST NAMES', 'FIRST NAME'],
  full_name: ['FULL NAME', 'NOM COMPLET', 'NAME'],
  id_number: ['N DU PASSEPORT / PASSPORT NO.', 'N DU PASSEPORT', 'PASSPORT NO', 'N DE LA CARTE', 'NUMERO DE LA CARTE', 'CARD NO', 'ID NO', 'ID NUMBER', 'DOCUMENT NO', 'N CARTE', 'NUMERO'],
  date_of_birth: ['DATE DE NAISSANCE / DATE OF BIRTH', 'DATE DE NAISSANCE', 'DATE OF BIRTH'],
  id_expiry: ['DATE D EXPIRATION / DATE OF EXPIRY', 'DATE D EXPIRATION', 'DATE OF EXPIRY', 'EXPIRY DATE', 'VALABLE JUSQU AU', 'VALID UNTIL', 'EXPIRE LE'],
  holder_name: ['ACCOUNT HOLDER', 'ABONNE', 'TITULAIRE', 'CLIENT', 'CUSTOMER'],
  issuing_authority: ['ISSUING AUTHORITY', 'AUTORITE'],
};
const ALL_LABELS = Object.entries(LABELS).flatMap(([k, ls]) => ls.map(l => ({ k, l }))).sort((a, b) => b.l.length - a.l.length);
function lev(a, b) { const m = a.length, n = b.length; const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]); for (let j = 1; j <= n; j++) d[0][j] = j; for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[m][n]; }
function matchLabel(lineN) {
  const s = lineN.replace(/^[^A-Z0-9]+/, '');
  for (const { k, l } of ALL_LABELS) {
    const head = s.slice(0, l.length);
    const ok = head === l || (l.length >= 7 && lev(head, l) <= Math.floor(l.length * 0.18));
    if (!ok) continue;
    const after = s.slice(l.length);
    if (after && !/^\s*([:;.\-|]|\s{2,}|\/|$)/.test(after) && !/^\s+\S/.test(after)) continue;   // label must end at a separator
    if (l.length <= 4 && after && !/^\s*[:;.\-|]/.test(after) && !/^\s{2,}/.test(after)) continue;  // short labels need a colon
    return { k, l, offset: lineN.length - s.length + l.length };
  }
  return null;
}
const cleanVal = (v) => String(v || '').replace(/^[\s:;.\-|/]+/, '').replace(/[\s|]+$/, '').replace(/\s{2,}/g, ' ').trim();

const MONTHS = { JAN: 1, JANV: 1, JANVIER: 1, JANUARY: 1, FEB: 2, FEV: 2, FEVR: 2, FEVRIER: 2, FEBRUARY: 2, MAR: 3, MARS: 3, MARCH: 3, APR: 4, AVR: 4, AVRIL: 4, APRIL: 4, MAY: 5, MAI: 5, JUN: 6, JUIN: 6, JUNE: 6, JUL: 7, JUIL: 7, JUILLET: 7, JULY: 7, AUG: 8, AOU: 8, AOUT: 8, AUGUST: 8, SEP: 9, SEPT: 9, SEPTEMBRE: 9, SEPTEMBER: 9, OCT: 10, OCTOBRE: 10, OCTOBER: 10, NOV: 11, NOVEMBRE: 11, NOVEMBER: 11, DEC: 12, DECEMBRE: 12, DECEMBER: 12 };
export function parseDate(v) {
  const s = norm(v).replace(/[O]/g, (m, i, str) => /\d/.test(str[i - 1] || '') || /\d/.test(str[i + 1] || '') ? '0' : m);
  let m = s.match(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/); if (m) return iso3(m[1], m[2], m[3]);
  m = s.match(/\b(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{4})\b/); if (m) return iso3(m[3], m[2], m[1]);
  m = s.match(/\b(\d{1,2})(?:ER)?\s+([A-Z]{3,9})\.?\s+(\d{4})\b/); if (m && MONTHS[m[2]]) return iso3(m[3], MONTHS[m[2]], m[1]);
  return null;
}
const iso3 = (y, mo, d) => { const Y = +y, M = +mo, D = +d; if (M < 1 || M > 12 || D < 1 || D > 31 || Y < 1900 || Y > 2100) return null; return `${Y}-${String(M).padStart(2, '0')}-${String(D).padStart(2, '0')}`; };

// ---------- MRZ (ICAO 9303 TD3 passports, TD1 ID cards) ----------
const mrzVal = (ch) => /\d/.test(ch) ? +ch : /[A-Z]/.test(ch) ? ch.charCodeAt(0) - 55 : 0;
const check = (s) => String([...s].reduce((t, ch, i) => t + mrzVal(ch) * [7, 3, 1][i % 3], 0) % 10);
const fixDigits = (s) => s.replace(/O/g, '0').replace(/[IL]/g, '1').replace(/S/g, '5').replace(/B/g, '8').replace(/Z/g, '2');
function findMRZ(text) {
  const lines = String(text).split('\n').map(l => l.replace(/\s+/g, '').replace(/[«‹]/g, '<').toUpperCase()).filter(l => /^[A-Z0-9<]{28,46}$/.test(l) && (l.match(/</g) || []).length >= 2);
  for (let i = 0; i < lines.length - 1; i++) {
    const a = lines[i], b = lines[i + 1];
    if (/^P[A-Z<]/.test(a) && b.length >= 42) return { kind: 'TD3', l1: a.padEnd(44, '<'), l2: b.padEnd(44, '<') };
    if (/^[IAC][A-Z<]/.test(a) && lines[i + 2]) return { kind: 'TD1', l1: a.padEnd(30, '<'), l2: b.padEnd(30, '<'), l3: lines[i + 2].padEnd(30, '<') };
  }
  return null;
}
const yy = (s, future) => { const n = +s.slice(0, 2), cur = new Date().getFullYear() % 100; const c = future ? (n < cur + 30 ? 2000 : 1900) : (n > cur ? 1900 : 2000); return `${c + n}-${s.slice(2, 4)}-${s.slice(4, 6)}`; };
export function parseMRZ(text) {
  const m = findMRZ(text); if (!m) return null;
  let doc, dob, exp, sex, names, ok = 0;
  if (m.kind === 'TD3') {
    doc = m.l2.slice(0, 9); const cdoc = m.l2[9]; dob = fixDigits(m.l2.slice(13, 19)); const cdob = m.l2[19]; sex = m.l2[20]; exp = fixDigits(m.l2.slice(21, 27)); const cexp = m.l2[27];
    ok = (check(doc) === cdoc) + (check(dob) === cdob) + (check(exp) === cexp); names = m.l1.slice(5);
  } else {
    doc = m.l1.slice(5, 14); const cdoc = m.l1[14]; dob = fixDigits(m.l2.slice(0, 6)); const cdob = m.l2[6]; sex = m.l2[7]; exp = fixDigits(m.l2.slice(8, 14)); const cexp = m.l2[14];
    ok = (check(doc) === cdoc) + (check(dob) === cdob) + (check(exp) === cexp); names = m.l3;
  }
  // OCR often confuses O and 0 in the document number: use the check digit to pick the right variant
  const cd0 = m.kind === 'TD3' ? m.l2[9] : m.l1[14];
  if (check(doc) !== cd0) {
    const pos = [...doc].map((ch, i) => /[0O]/.test(ch) ? i : -1).filter(i => i >= 0).slice(0, 6);
    for (let mask = 1; mask < (1 << pos.length); mask++) { const arr = [...doc]; pos.forEach((p, b) => { if (mask & (1 << b)) arr[p] = arr[p] === '0' ? 'O' : '0'; }); const v = arr.join(''); if (check(v) === cd0) { doc = v; ok++; break; } }
  }
  const [sur, giv] = names.split('<<'); const t = (x) => (x || '').replace(/<+/g, ' ').trim();
  const f = { id_number: doc.replace(/</g, ''), date_of_birth: yy(dob, false), id_expiry: yy(exp, true), owner_name: titleCase(`${t(giv)} ${t(sur)}`), id_type: m.kind === 'TD3' ? 'Passport' : 'National ID' };
  const conf = ok === 3 ? 0.98 : ok === 2 ? 0.9 : 0.7;
  return { fields: f, conf, checks: ok, kind: m.kind };
}
const titleCase = (s) => String(s || '').toLowerCase().replace(/(^|[\s-])\p{L}/gu, (c) => c.toUpperCase()).replace(/\s+/g, ' ').trim();

const RX = {
  rccm: /CD\s*[\/|]\s*[A-Z]{2,4}\s*[\/|]\s*RCCM\s*[\/|]\s*[0-9OIl]{2}\s*[-–]\s*[A-Z]\s*[-–]\s*[0-9OIl]{3,6}/i,
  id_nat: /\b\d{2}\s*[-–]\s*[A-Z0-9]{2,4}\s*[-–]\s*[A-Z0-9]{5,9}\b/,
  nif: /\bA\s?\d{7}\s?[A-Z]\b/,
};
const fixRccm = (v) => v.toUpperCase().replace(/\s+/g, '').replace(/[|]/g, '/').replace(/–/g, '-').replace(/\/(\w{2})-(\w)-(\w+)$/, (m, a, b, c) => `/${fixDigits(a)}-${b}-${fixDigits(c)}`);

export function parseDocument(text, hintType = null, filename = '', ocrConf = 85) {
  const type = hintType && hintType !== 'OTHER' ? hintType : detectType(text, filename);
  const lines = String(text || '').split('\n').map(l => l.replace(/[°º]/g, '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const N = lines.map(norm);
  const lab = {};
  for (let i = 0; i < lines.length; i++) {
    const m = matchLabel(N[i]); if (!m) continue;
    let v = cleanVal(lines[i].slice(m.offset));
    if (/^\//.test(lines[i].slice(m.offset).trim()) || !v || matchLabel(norm(v))) {          // "Nom / Surname" then value on next line
      const nx = lines[i + 1]; if (nx && !matchLabel(N[i + 1])) v = cleanVal(nx); else if (matchLabel(norm(v))) v = '';
    }
    if (v && !(m.k in lab)) lab[m.k] = v;
  }
  const f = {}, c = {};
  const base = Math.max(0.55, Math.min(0.95, ocrConf / 100));
  const set = (k, v, conf) => { if (v != null && String(v).trim() !== '') { f[k] = String(v).trim(); c[k] = Math.round(conf * 100) / 100; } };
  const T = String(text || '');
  // regex-validated identifiers; fall back to the labelled value with low confidence (TOBi will ask the customer to confirm)
  const strict = { rccm: /^CD\/[A-Z]{3}\/RCCM\/\d{2}-[A-Z]-\d{3,6}$/, id_nat: /^\d{2}-[A-Z0-9]{2,4}-[A-Z]\d{5}[A-Z]$/, tax_number: /^A\d{7}[A-Z]$/ };
  const ident = (k, rx, labVal, fix) => {
    const m = T.match(rx); let v = m ? fix(m[0]) : null, conf = 0;
    if (v) conf = strict[k].test(v) ? Math.min(0.97, base + 0.06) : 0.6;
    else if (labVal) { v = fix(labVal.replace(/[^A-Za-z0-9\/\-]/g, '')); conf = strict[k].test(v) ? base : 0.5; }
    set(k, v, conf);
  };
  if (type === 'RCCM') {
    ident('rccm', RX.rccm, lab.rccm_label, fixRccm);
    ident('id_nat', RX.id_nat, lab.id_nat, (v) => v.replace(/\s+/g, '').replace(/–/g, '-').toUpperCase());
    ident('tax_number', RX.nif, lab.tax_number, (v) => v.replace(/\s/g, '').toUpperCase());
    set('legal_name', lab.legal_name?.toUpperCase(), base);
    set('trading_name', lab.trading_name, base * 0.95);
    set('address', lab.address, base * 0.95);
    set('commune', lab.commune && titleCase(lab.commune.replace(/^commune de\s+/i, '')), base);
    set('city', lab.city && titleCase(lab.city.split(/[,/]/)[0]), base);
    set('business_activity', lab.business_activity, base * 0.9);
    const lf = lab.legal_form || '';
    if (lf) set('legal_form', /ETS|INDIVIDU|SOLE|ESTABLISHMENT|ENTREPRISE INDIVIDUELLE/i.test(norm(lf)) ? 'INDIVIDUAL' : 'COMPANY', 0.9);
    else if (/\b(SARL|SA|SAS|SARLU|SPRL)\b/.test(f.legal_name || '')) set('legal_form', 'COMPANY', 0.85);
    set('issue_date', parseDate(lab.issue_date || ''), base);
  } else if (type === 'NATIONAL_ID') {
    const mrz = parseMRZ(T);
    if (mrz) for (const [k, v] of Object.entries(mrz.fields)) set(k, v, mrz.conf);
    if (f.id_number && lab.id_number) { const viz = norm(lab.id_number).replace(/[^A-Z0-9]/g, ''); if (viz.replace(/O/g, '0') === f.id_number.replace(/O/g, '0')) f.id_number = viz; }
    const parts = [lab.given, lab.surname, lab.postnom].filter(Boolean).map(s => s.replace(/\s*\/.*$/, '').replace(/\b(PHOTO|SIGNATURE)\b/gi, '').trim());
    if (!f.owner_name) set('owner_name', parts.length ? titleCase(parts.join(' ')) : lab.full_name && titleCase(lab.full_name), base * (parts.length >= 2 ? 1 : 0.85));
    if (!f.id_number && lab.id_number) { const id = norm(lab.id_number).replace(/[^A-Z0-9]/g, ''); if (id.length >= 6) set('id_number', id, base); }
    if (!f.id_type) set('id_type', /PASSEPORT|PASSPORT/.test(norm(T)) ? 'Passport' : /ELECTEUR|VOTER/.test(norm(T)) ? 'Voter card' : 'National ID', 0.9);
    if (!f.date_of_birth) set('date_of_birth', parseDate(lab.date_of_birth || ''), base);
    if (!f.id_expiry) set('id_expiry', parseDate(lab.id_expiry || ''), base);
    set('issuing_authority', lab.issuing_authority, base * 0.8);
  } else if (type === 'PROOF_OF_ADDRESS') {
    set('holder_name', lab.holder_name && titleCase(lab.holder_name), base);
    set('address', lab.address, base);
    set('commune', lab.commune && titleCase(lab.commune.replace(/^commune de\s+/i, '')), base);
    set('city', lab.city && titleCase(lab.city), base);
    set('issue_date', parseDate(lab.issue_date || ''), base);
  } else if (type === 'TAX') {
    const x = T.match(RX.nif); set('tax_number', x ? x[0].replace(/\s/g, '') : null, 0.9);
  } else if (type === 'ID_NAT') {
    const n = T.match(RX.id_nat); set('id_nat', n ? n[0].replace(/\s+/g, '') : null, 0.9);
  }
  return { doc_type: type, fields: f, confidence: c };
}

// ---------- locate extracted values on the page (for highlighting in the case file) ----------
// Returns { field: { r: [{x,y,w,h} in % of the page] } } using the OCR word boxes.
const compact = (s) => norm(s).replace(/[^A-Z0-9]/g, '');
function dateVariants(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); if (!m) return [];
  const [, y, mo, d] = m; return [`${d}${mo}${y}`, `${y}${mo}${d}`, `${d}${mo}${y.slice(2)}`, `${+d}${['JANVIER', 'FEVRIER', 'MARS', 'AVRIL', 'MAI', 'JUIN', 'JUILLET', 'AOUT', 'SEPTEMBRE', 'OCTOBRE', 'NOVEMBRE', 'DECEMBRE'][+mo - 1]}${y}`, `${d}${['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][+mo - 1]}${y}`];
}
export function locateFields(fields, ocr) {
  const out = {};
  if (!ocr?.lines?.length || !ocr.W || !ocr.H || ocr.rotated) return out;
  const W = ocr.W, H = ocr.H;
  const rect = (ws) => { const x = Math.min(...ws.map(w => w.x)), y = Math.min(...ws.map(w => w.y)), x2 = Math.max(...ws.map(w => w.x + w.w)), y2 = Math.max(...ws.map(w => w.y + w.h)); const p = 6; return { x: +((x - p) / W * 100).toFixed(2), y: +((y - p) / H * 100).toFixed(2), w: +((x2 - x + 2 * p) / W * 100).toFixed(2), h: +((y2 - y + 2 * p) / H * 100).toFixed(2) }; };
  for (const [k, v] of Object.entries(fields || {})) {
    if (v == null || v === '' || /^(id_type|legal_form)$/.test(k)) continue;
    const targets = /date|expiry|dob/.test(k) ? dateVariants(String(v)) : [compact(v)];
    if (!targets.length || !targets[0] || targets[0].length < 2) continue;
    let best = null;
    for (const ws of ocr.lines) for (let i = 0; i < ws.length; i++) {          // contiguous windows on one line
      let acc = '';
      for (let j2 = i; j2 < Math.min(ws.length, i + 8); j2++) {
        acc += compact(ws[j2].word);
        for (const t of targets) { if (acc.length > t.length + 3) continue; const sc = 1 - lev(acc, t) / Math.max(acc.length, t.length); if (sc >= 0.8 && (!best || sc > best.sc)) best = { sc, ws: ws.slice(i, j2 + 1) }; }
      }
    }
    if (best) { out[k] = { r: [rect(best.ws)] }; continue; }
    // multi-line values (e.g. names split into NOM / POST-NOM / PRENOM): match tokens anywhere
    const toks = norm(v).split(/[^A-Z0-9]+/).filter(t => t.length >= 3);
    if (toks.length >= 2) {
      const hits = [];
      for (const t of toks) { let h = null; for (const ws of ocr.lines) { for (const w of ws) { const parts = [compact(w.word), ...norm(w.word).split(/[^A-Z0-9]+/)].filter(x => x.length >= 3); if (parts.some(cw => 1 - lev(cw, t) / Math.max(cw.length, t.length) >= 0.8)) { h = w; break; } } if (h) break; } if (h && !hits.includes(h)) hits.push(h); }
      if (hits.length >= Math.ceil(toks.length * 0.6)) out[k] = { r: hits.map(h => rect([h])) };
    }
  }
  return out;
}
