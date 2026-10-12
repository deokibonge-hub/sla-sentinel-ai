// Realistic FICTIONAL document renderers (SVG). Every rendered value can carry a "field" tag:
// its exact position is recorded so the case viewer can highlight it on the document.
// All documents carry a faint SPECIMEN watermark — demo data only, no real person.

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cw = (ch) => /[MW@%]/.test(ch) ? 0.8 : /[A-Z0-9#&]/.test(ch) ? 0.64 : /[il.,:;'|!]/.test(ch) ? 0.28 : ch === ' ' ? 0.28 : /[mw]/.test(ch) ? 0.82 : /[ÉÈÀÂÔÛÇ]/.test(ch) ? 0.68 : 0.54;
export const textWidth = (str, size, weight = 400, mono = false) => mono ? String(str).length * size * 0.6 : [...String(str)].reduce((a, ch) => a + cw(ch), 0) * size * (weight >= 600 ? 1.04 : 1);
export const fmtDate = (iso) => iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '—';
const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const longDateFr = (iso) => `${+iso.slice(8, 10)} ${MONTHS_FR[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;

export class Doc {
  constructor(w, h, rng) { this.w = w; this.h = h; this.p = []; this.boxes = {}; this.rng = rng || Math.random; this.defs = []; }
  add(s) { this.p.push(s); return this; }
  box(field, x, y, w, h, extra = {}) {
    if (!field) return;
    const b = this.boxes[field] || (this.boxes[field] = { r: [] });
    b.r.push({ x, y, w, h });
    Object.assign(b, extra);
  }
  pct() {   // boxes in % of the final page size (page height may be adjusted after layout)
    const out = {};
    for (const [k, b] of Object.entries(this.boxes)) out[k] = { ...b, r: b.r.map(r => ({ x: +(r.x / this.w * 100).toFixed(2), y: +(r.y / this.h * 100).toFixed(2), w: +(r.w / this.w * 100).toFixed(2), h: +(r.h / this.h * 100).toFixed(2) })) };
    return out;
  }
  text(x, y, str, o = {}) {
    const size = o.size || 16, weight = o.weight || 400, mono = !!o.mono, anchor = o.anchor || 'start';
    const fam = mono ? "'OCR B','OCR-B','Courier New',monospace" : o.serif ? "Georgia,'Times New Roman',serif" : 'Arial,Helvetica,sans-serif';
    this.add(`<text x="${x}" y="${y}" font-family="${fam}" font-size="${size}" font-weight="${weight}" fill="${o.fill || '#1d1f24'}" text-anchor="${anchor}"${o.ls ? ` letter-spacing="${o.ls}"` : ''}${o.italic ? ' font-style="italic"' : ''}${o.op ? ` opacity="${o.op}"` : ''}>${esc(str)}</text>`);
    const w = textWidth(str, size, weight, mono) + (o.ls ? o.ls * String(str).length : 0);
    const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
    if (o.field) this.box(o.field, x0 - 5, y - size * 0.92, w + 10, size * 1.28, o.boxExtra || {});
    return { x: x0, w };
  }
  rect(x, y, w, h, fill, o = {}) { this.add(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${o.rx ? ` rx="${o.rx}"` : ''}${o.stroke ? ` stroke="${o.stroke}" stroke-width="${o.sw || 1}"` : ''}${o.op ? ` opacity="${o.op}"` : ''}/>`); return this; }
  line(x1, y1, x2, y2, stroke = '#c9ccd3', sw = 1, dash) { this.add(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${sw}"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`); return this; }
  svg(extraFilter = '') {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${this.w} ${this.h}" width="${this.w}" height="${this.h}"><defs>${this.defs.join('')}</defs><g${extraFilter}>${this.p.join('')}</g></svg>`;
  }
}

// ---------- decorative primitives ----------
export function flag(d, x, y, w = 90) {
  const h = w * 0.75, id = 'fl' + Math.floor(d.rng() * 1e9);
  d.defs.push(`<clipPath id="${id}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath>`);
  d.add(`<g clip-path="url(#${id})"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#007fff"/><polygon points="${x},${y + h} ${x},${y + h * 0.78} ${x + w * 0.9},${y} ${x + w},${y} ${x + w},${y + h * 0.22} ${x + w * 0.1},${y + h}" fill="#f7d618"/><polygon points="${x},${y + h} ${x},${y + h * 0.86} ${x + w * 0.94},${y} ${x + w},${y} ${x + w},${y + h * 0.14} ${x + w * 0.06},${y + h}" fill="#ce1021"/>${star(x + w * 0.2, y + h * 0.27, w * 0.13, '#f7d618')}</g>`);
}
export const star = (cx, cy, r, fill) => { const pts = []; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.4 : r; pts.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`); } return `<polygon points="${pts.join(' ')}" fill="${fill}"/>`; };
export function guilloche(d, x, y, w, h, color = '#8fb3e6', op = 0.35) {
  let paths = '';
  for (let k = 0; k < 14; k++) { let s = ''; for (let i = 0; i <= 80; i++) { const px = x + i / 80 * w, py = y + h / 2 + Math.sin(i / 80 * Math.PI * 6 + k * 0.45) * h * 0.42 * Math.cos(k * 0.22); s += (i ? 'L' : 'M') + px.toFixed(1) + ',' + py.toFixed(1); } paths += `<path d="${s}" fill="none" stroke="${color}" stroke-width="0.8"/>`; }
  d.add(`<g opacity="${op}">${paths}</g>`);
}
export function photo(d, x, y, w, h, tone = '#6b4a35', bg = '#cfe0f5') {
  d.rect(x, y, w, h, bg, { stroke: '#8a94a6' });
  const cx = x + w / 2;
  d.add(`<ellipse cx="${cx}" cy="${y + h * 0.36}" rx="${w * 0.2}" ry="${h * 0.19}" fill="${tone}"/>`);
  d.add(`<path d="M${x + w * 0.1},${y + h} Q${x + w * 0.12},${y + h * 0.62} ${cx},${y + h * 0.6} Q${x + w * 0.88},${y + h * 0.62} ${x + w * 0.9},${y + h} Z" fill="#2c3e57"/>`);
  d.add(`<path d="M${cx - w * 0.09},${y + h * 0.6} L${cx},${y + h * 0.74} L${cx + w * 0.09},${y + h * 0.6} Z" fill="#f2f2f2"/>`);
  d.add(`<ellipse cx="${cx}" cy="${y + h * 0.22}" rx="${w * 0.2}" ry="${h * 0.07}" fill="#1b1b1b" opacity=".85"/>`);
}
export function signature(d, x, y, w = 160, color = '#1f3b8f', field) {
  let s = `M${x},${y}`; let px = x;
  for (let i = 0; i < 7; i++) { const nx = px + w / 7; s += ` C${px + 8},${y - 20 - d.rng() * 18} ${nx - 10},${y + 16 + d.rng() * 10} ${nx},${y - 4 + d.rng() * 8}`; px = nx; }
  s += ` M${x + w * 0.15},${y + 10} L${x + w * 0.9},${y + 4}`;
  d.add(`<path d="${s}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round"/>`);
  if (field) d.box(field, x - 6, y - 40, w + 12, 62);
}
export function stamp(d, cx, cy, r, text, color = '#3346a8', rot = -12) {
  const id = 'st' + Math.floor(d.rng() * 1e9);
  d.defs.push(`<path id="${id}" d="M${cx - r * 0.78},${cy} a${r * 0.78},${r * 0.78} 0 1,1 ${r * 1.56},0 a${r * 0.78},${r * 0.78} 0 1,1 ${-r * 1.56},0"/>`);
  d.add(`<g transform="rotate(${rot} ${cx} ${cy})" opacity=".72"><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="3"/><circle cx="${cx}" cy="${cy}" r="${r * 0.62}" fill="none" stroke="${color}" stroke-width="1.5"/><text font-family="Arial" font-size="${r * 0.17}" font-weight="700" fill="${color}" letter-spacing="1"><textPath href="#${id}">${esc(text)}</textPath></text>${star(cx, cy, r * 0.28, color)}</g>`);
}
export function qr(d, x, y, size, seedStr = '') {
  const n = 25, c = size / n; let h = 0; for (const ch of seedStr) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const r = () => { h = (h * 1103515245 + 12345) >>> 0; return (h >>> 16) / 65536; };
  let s = `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="#fff"/>`;
  const finder = (fx, fy) => `<rect x="${x + fx * c}" y="${y + fy * c}" width="${7 * c}" height="${7 * c}" fill="#111"/><rect x="${x + (fx + 1) * c}" y="${y + (fy + 1) * c}" width="${5 * c}" height="${5 * c}" fill="#fff"/><rect x="${x + (fx + 2) * c}" y="${y + (fy + 2) * c}" width="${3 * c}" height="${3 * c}" fill="#111"/>`;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const inF = (i < 8 && j < 8) || (i < 8 && j > n - 9) || (i > n - 9 && j < 8); if (!inF && r() < 0.48) s += `<rect x="${(x + i * c).toFixed(1)}" y="${(y + j * c).toFixed(1)}" width="${c.toFixed(2)}" height="${c.toFixed(2)}" fill="#111"/>`; }
  d.add(s + finder(0, 0) + finder(n - 7, 0) + finder(0, n - 7));
}
export function barcode(d, x, y, w, h, seedStr = '') {
  let hh = 7; for (const ch of seedStr) hh = (hh * 33 + ch.charCodeAt(0)) >>> 0;
  let px = x, s = ''; while (px < x + w) { hh = (hh * 1664525 + 1013904223) >>> 0; const bw = 1 + (hh >>> 29); if ((hh >>> 8) & 1) s += `<rect x="${px.toFixed(1)}" y="${y}" width="${bw}" height="${h}" fill="#111"/>`; px += bw + 1; }
  d.add(s);
}
export const watermark = (d, txt = 'SPECIMEN · FICTIONAL DEMO DATA') => d.add(`<text x="${d.w / 2}" y="${d.h / 2}" font-family="Arial" font-size="${Math.round(d.w / 18)}" font-weight="700" fill="#c00" opacity=".07" text-anchor="middle" transform="rotate(-24 ${d.w / 2} ${d.h / 2})">${esc(txt)}</text>`);
const labVal = (d, x, y, label, value, o = {}) => { d.text(x, y, label, { size: o.ls || 12, fill: o.lc || '#5b6474', weight: 700, ls: 0.6 }); return d.text(x, y + (o.gap || 28), value, { size: o.size || 22, weight: o.weight || 700, field: o.field, fill: o.fill, mono: o.mono, boxExtra: o.boxExtra }); };

// ---------- MRZ ----------
const mv = (ch) => /\d/.test(ch) ? +ch : /[A-Z]/.test(ch) ? ch.charCodeAt(0) - 55 : 0;
export const mrzCheck = (s) => String([...s].reduce((t, ch, i) => t + mv(ch) * [7, 3, 1][i % 3], 0) % 10);
const mrzName = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z ]/g, ' ').trim().replace(/\s+/g, '<');
export function mrzTD3({ surname, given, number, dob, sex, expiry }) {
  const l1 = ('P<COD' + mrzName(surname) + '<<' + mrzName(given)).padEnd(44, '<').slice(0, 44);
  const doc = number.padEnd(9, '<').slice(0, 9), b = dob.slice(2).replace(/-/g, ''), e = expiry.slice(2).replace(/-/g, ''), pers = ''.padEnd(14, '<');
  const part = doc + mrzCheck(doc) + 'COD' + b + mrzCheck(b) + (sex || '<') + e + mrzCheck(e) + pers + mrzCheck(pers);
  const comp = doc + mrzCheck(doc) + b + mrzCheck(b) + e + mrzCheck(e) + pers + mrzCheck(pers);
  return [l1, part + mrzCheck(comp)];
}

// ---------- documents ----------
// p: { surname, postnom, given, sex, dob, pob, address, commune, city, id_number, issue, expiry, tone, blur }
export function voterCard(p, rng) {
  const d = new Doc(1000, 630, rng);
  d.rect(0, 0, 1000, 630, '#f1f6fd', { rx: 26 }); guilloche(d, 0, 120, 1000, 480);
  d.add(`<rect x="0" y="0" width="1000" height="112" rx="26" fill="#0b4ea2"/><rect x="0" y="80" width="1000" height="32" fill="#0b4ea2"/>`);
  flag(d, 26, 20, 92);
  d.text(140, 50, 'RÉPUBLIQUE DÉMOCRATIQUE DU CONGO', { size: 26, weight: 800, fill: '#fff' });
  d.text(140, 82, 'COMMISSION ÉLECTORALE NATIONALE INDÉPENDANTE — CENI', { size: 15, weight: 600, fill: '#d6e6ff' });
  d.text(974, 52, "CARTE D'ÉLECTEUR", { size: 22, weight: 800, fill: '#f7d618', anchor: 'end' });
  d.text(974, 80, 'VOTER CARD', { size: 13, weight: 700, fill: '#d6e6ff', anchor: 'end', ls: 2 });
  photo(d, 34, 140, 230, 290, p.tone);
  labVal(d, 300, 152, 'NOM', p.surname.toUpperCase(), { field: 'owner_name' });
  labVal(d, 300, 217, 'POST-NOM', (p.postnom || '—').toUpperCase(), { field: p.postnom ? 'owner_name' : null });
  labVal(d, 300, 282, 'PRÉNOM', p.given, { field: 'owner_name' });
  labVal(d, 300, 347, 'SEXE', p.sex);
  d.text(430, 347, 'DATE ET LIEU DE NAISSANCE', { size: 12, fill: '#5b6474', weight: 700, ls: 0.6 });
  const dd = d.text(430, 375, fmtDate(p.dob), { size: 22, weight: 700, field: 'date_of_birth' });
  d.text(dd.x + dd.w + 14, 375, '— ' + (p.pob || 'Kinshasa'), { size: 22, weight: 700 });
  d.text(300, 412, 'ADRESSE', { size: 12, fill: '#5b6474', weight: 700, ls: 0.6 });
  const ad = d.text(300, 440, p.address, { size: 20, weight: 700, field: 'address' });
  d.text(ad.x + ad.w + 12, 440, 'C/', { size: 20, weight: 700 });
  d.text(ad.x + ad.w + 36, 440, p.commune, { size: 20, weight: 700, field: 'commune' });
  d.line(34, 470, 966, 470, '#9fb6d8', 1.5);
  labVal(d, 34, 502, 'N° DE LA CARTE', p.id_number.replace(/(\d{4})(\d{4})(\d+)/, '$1 $2 $3'), { size: 28, mono: true, field: 'id_number' });
  labVal(d, 420, 502, 'DÉLIVRÉE LE', fmtDate(p.issue));
  labVal(d, 640, 502, "VALABLE JUSQU'AU", fmtDate(p.expiry), { field: 'id_expiry' });
  d.text(34, 600, 'Signature du titulaire', { size: 12, fill: '#5b6474' }); signature(d, 200, 598, 150);
  barcode(d, 640, 560, 320, 46, p.id_number);
  watermark(d);
  return { d, fields: { owner_name: [p.given, p.surname, p.postnom].filter(Boolean).join(' '), id_type: 'Voter card', id_number: p.id_number, date_of_birth: p.dob, id_expiry: p.expiry, address: p.address, commune: p.commune, issuing_authority: 'CENI' } };
}

export function passport(p, rng) {
  const d = new Doc(1000, 680, rng);
  d.rect(0, 0, 1000, 680, '#f6f1e4', { rx: 18 }); guilloche(d, 0, 90, 1000, 420, '#c9a86a', 0.32);
  d.rect(0, 0, 1000, 84, '#13385e', { rx: 18 }); d.rect(0, 60, 1000, 24, '#13385e');
  flag(d, 24, 14, 74);
  d.text(118, 40, 'RÉPUBLIQUE DÉMOCRATIQUE DU CONGO', { size: 22, weight: 800, fill: '#fff' });
  d.text(118, 66, 'DEMOCRATIC REPUBLIC OF THE CONGO', { size: 14, weight: 600, fill: '#c9d8ee', ls: 1 });
  d.text(976, 52, 'PASSEPORT / PASSPORT', { size: 20, weight: 800, fill: '#f7d618', anchor: 'end' });
  photo(d, 34, 110, 210, 270, p.tone, '#e8e3d5');
  const L = (x, y, a, b, v, o = {}) => { d.text(x, y, a + ' / ' + b, { size: 11, fill: '#6d6250', weight: 700 }); return d.text(x, y + 26, v, { size: o.size || 20, weight: 700, field: o.field, mono: o.mono }); };
  L(280, 116, 'Type', 'Type', 'P'); L(380, 116, 'Code', 'Code', 'COD');
  L(560, 116, 'N° du passeport', 'Passport No.', p.id_number, { field: 'id_number', size: 24, mono: true });
  L(280, 176, 'Nom', 'Surname', p.surname.toUpperCase(), { field: 'owner_name' });
  L(280, 236, 'Prénoms', 'Given names', [p.given, p.postnom].filter(Boolean).join(' ').toUpperCase(), { field: 'owner_name' });
  L(280, 296, 'Nationalité', 'Nationality', 'CONGOLAISE');
  L(560, 296, 'Sexe', 'Sex', p.sex);
  L(280, 356, 'Date de naissance', 'Date of birth', fmtDate(p.dob), { field: 'date_of_birth' });
  L(560, 356, 'Lieu de naissance', 'Place of birth', (p.pob || 'Kinshasa').toUpperCase());
  L(280, 416, 'Date de délivrance', 'Date of issue', fmtDate(p.issue));
  L(560, 416, "Date d'expiration", 'Date of expiry', fmtDate(p.expiry), { field: 'id_expiry' });
  L(34, 416, 'Autorité', 'Authority', 'MINAFFET — KINSHASA', { size: 15 });
  signature(d, 60, 470, 150);
  const [l1, l2] = mrzTD3({ surname: p.surname, given: [p.given, p.postnom].filter(Boolean).join(' '), number: p.id_number, dob: p.dob, sex: p.sex, expiry: p.expiry });
  d.rect(0, 520, 1000, 160, '#fbf8ef'); d.rect(0, 660, 1000, 20, '#fbf8ef', { rx: 18 });
  d.text(40, 578, l1, { size: 34, mono: true, field: 'mrz' }); d.text(40, 630, l2, { size: 34, mono: true, field: 'mrz' });
  watermark(d);
  return { d, fields: { owner_name: [p.given, p.postnom, p.surname].filter(Boolean).join(' '), id_type: 'Passport', id_number: p.id_number, date_of_birth: p.dob, id_expiry: p.expiry, issuing_authority: 'MINAFFET', mrz: 'Valid — 4/4 check digits' }, mrz: [l1, l2] };
}

// b: { rccm, id_nat, nif, legal_name, trading_name, legal_form_label, address, commune, city, activity, owner, issue }
export function rccmCert(b, rng) {
  const d = new Doc(900, 1220, rng);
  d.rect(0, 0, 900, 1220, '#fffdf8'); d.rect(18, 18, 864, 1184, 'none', { stroke: '#2f5d9e', sw: 3 }); d.rect(28, 28, 844, 1164, 'none', { stroke: '#9cb4d6', sw: 1 });
  guilloche(d, 30, 400, 840, 500, '#9cb4d6', 0.12);
  flag(d, 60, 56, 84);
  d.text(470, 82, 'RÉPUBLIQUE DÉMOCRATIQUE DU CONGO', { size: 22, weight: 800, anchor: 'middle' });
  d.text(470, 110, 'GUICHET UNIQUE DE CRÉATION D’ENTREPRISE', { size: 15, weight: 700, anchor: 'middle', fill: '#2f5d9e', ls: 1 });
  d.text(470, 132, 'Greffe du Tribunal de Commerce de Kinshasa', { size: 13, anchor: 'middle', fill: '#5b6474', italic: true });
  d.line(60, 160, 840, 160, '#2f5d9e', 2);
  d.text(450, 212, 'CERTIFICAT D’IMMATRICULATION', { size: 30, weight: 800, anchor: 'middle', serif: true });
  d.text(450, 244, 'au Registre du Commerce et du Crédit Mobilier (RCCM)', { size: 17, anchor: 'middle', serif: true, italic: true });
  const rows = [['Numéro RCCM', b.rccm, 'rccm', true], ['Identification nationale (ID NAT)', b.id_nat, 'id_nat', true], ['Numéro impôt (NIF)', b.nif || '—', b.nif ? 'tax_number' : null, true], ['Dénomination sociale', b.legal_name, 'legal_name'], ['Sigle / Nom commercial', b.trading_name, 'trading_name'], ['Forme juridique', b.legal_form_label, 'legal_form'], ['Siège social', b.address, 'address'], ['Commune', b.commune, 'commune'], ['Ville / Province', b.city + ' / Kinshasa', 'city'], ['Objet social', b.activity, 'business_activity'], ['Gérant / Exploitant', b.owner, 'owner_name'], ['Date d’immatriculation', fmtDate(b.issue), 'issue_date']];
  let y = 300;
  for (const [l, v, f, mono] of rows) {
    d.rect(70, y - 30, 760, 52, rows.indexOf(rows.find(r => r[0] === l)) % 2 ? '#f7f9fc' : '#ffffff', { stroke: '#e1e6ee' });
    d.text(86, y, l, { size: 15, fill: '#4c5566', weight: 700 });
    d.text(400, y, v, { size: mono ? 19 : 18, weight: 700, mono, field: f });
    y += 52;
  }
  d.text(70, y + 40, `Le présent certificat atteste l’immatriculation de l’entreprise ci-dessus désignée conformément à l’Acte uniforme OHADA`, { size: 13, fill: '#4c5566' });
  d.text(70, y + 60, `relatif au droit commercial général. Toute modification doit être déclarée au Guichet Unique dans les 30 jours.`, { size: 13, fill: '#4c5566' });
  d.text(560, y + 120, `Fait à Kinshasa, le ${longDateFr(b.issue)}`, { size: 15, italic: true });
  d.text(560, y + 146, 'Le Greffier en chef', { size: 15, weight: 700 });
  stamp(d, 640, y + 220, 70, 'GUICHET UNIQUE · KINSHASA · RCCM ·'); signature(d, 590, y + 230, 170);
  qr(d, 80, y + 130, 130, b.rccm); d.text(80, y + 285, 'Vérification : guichetunique.cd (simulé)', { size: 11, fill: '#5b6474' });
  watermark(d);
  return { d, fields: { rccm: b.rccm, id_nat: b.id_nat, ...(b.nif ? { tax_number: b.nif } : {}), legal_name: b.legal_name, trading_name: b.trading_name, legal_form: b.legal_form, address: b.address, commune: b.commune, city: b.city, business_activity: b.activity, issue_date: b.issue } };
}

// u: { kind: SNEL|REGIDESO, holder, address, commune, city, issue, period, account_no, meter, amount_cdf, usage }
export function utilityBill(u, rng) {
  const d = new Doc(900, 1180, rng);
  const snel = u.kind === 'SNEL', main = snel ? '#e07b00' : '#0a7ea4', light = snel ? '#fff4e5' : '#e6f6fb';
  d.rect(0, 0, 900, 1180, '#ffffff'); d.rect(0, 0, 900, 150, main);
  d.add(`<circle cx="90" cy="75" r="46" fill="#fff"/>`); d.text(90, 86, snel ? 'SNEL' : 'RGD', { size: snel ? 26 : 24, weight: 900, fill: main, anchor: 'middle' });
  d.text(160, 62, snel ? 'SOCIÉTÉ NATIONALE D’ÉLECTRICITÉ' : 'RÉGIE DE DISTRIBUTION D’EAU', { size: 24, weight: 800, fill: '#fff' });
  d.text(160, 94, snel ? 'Direction Commerciale — Distribution Kinshasa' : 'Direction Provinciale — Kinshasa', { size: 15, fill: '#fff' });
  d.text(160, 120, 'Service clientèle : 1503 (simulé)', { size: 13, fill: '#fff', op: 0.9 });
  d.text(450, 210, snel ? 'FACTURE D’ÉLECTRICITÉ' : 'FACTURE D’EAU', { size: 28, weight: 800, anchor: 'middle' });
  d.rect(50, 240, 470, 250, light, { rx: 10 });
  d.text(70, 276, 'ABONNÉ', { size: 12, weight: 700, fill: '#5b6474', ls: 1 }); d.text(70, 306, u.holder.toUpperCase(), { size: 21, weight: 800, field: 'holder_name' });
  d.text(70, 346, 'ADRESSE DE CONSOMMATION', { size: 12, weight: 700, fill: '#5b6474', ls: 1 }); d.text(70, 374, u.address, { size: 18, weight: 700, field: 'address' });
  d.text(70, 410, 'COMMUNE', { size: 12, weight: 700, fill: '#5b6474', ls: 1 }); d.text(70, 436, u.commune, { size: 18, weight: 700, field: 'commune' });
  d.text(290, 410, 'VILLE', { size: 12, weight: 700, fill: '#5b6474', ls: 1 }); d.text(290, 436, u.city, { size: 18, weight: 700, field: 'city' });
  d.text(70, 470, `N° abonné ${u.account_no} · ${snel ? 'Compteur' : 'Compteur eau'} ${u.meter}`, { size: 13, fill: '#5b6474' });
  const R = (y, l, v, f) => { d.text(560, y, l, { size: 13, fill: '#5b6474', weight: 700 }); d.text(850, y, v, { size: 16, weight: 700, anchor: 'end', field: f }); d.line(560, y + 10, 850, y + 10, '#eceff3'); };
  R(276, 'Date de facture', fmtDate(u.issue), 'issue_date'); R(316, 'Période', u.period); R(356, 'Échéance', fmtDate(u.due)); R(396, 'N° facture', u.invoice); R(436, 'Tarif', snel ? 'Basse tension — Domestique' : 'Domestique T1');
  d.rect(50, 530, 800, 44, main); ['Désignation', 'Ancien index', 'Nouvel index', snel ? 'kWh' : 'm³', 'Montant (CDF)'].forEach((h, i) => d.text([66, 300, 450, 600, 834][i], 558, h, { size: 14, weight: 700, fill: '#fff', anchor: i === 4 ? 'end' : 'start' }));
  const lines = [[snel ? 'Consommation énergie' : 'Consommation eau', u.usage[0], u.usage[1], u.usage[1] - u.usage[0], u.amount_cdf * 0.78], ['Redevance compteur', '', '', '', u.amount_cdf * 0.06], ['TVA 16 %', '', '', '', u.amount_cdf * 0.16]];
  let y = 610; for (const l of lines) { l.forEach((v, i) => d.text([66, 300, 450, 600, 834][i], y, typeof v === 'number' ? Math.round(v).toLocaleString('fr-FR').replace(/ /g, ' ') : v, { size: 15, anchor: i === 4 ? 'end' : 'start' })); d.line(50, y + 14, 850, y + 14, '#eceff3'); y += 46; }
  d.rect(470, y + 10, 380, 70, light, { rx: 8 }); d.text(490, y + 54, 'NET À PAYER', { size: 16, weight: 800 }); d.text(834, y + 56, Math.round(u.amount_cdf).toLocaleString('fr-FR').replace(/ /g, ' ') + ' CDF', { size: 24, weight: 900, anchor: 'end', fill: main });
  d.text(50, y + 140, 'Paiement possible par M-Pesa : *1222# › Factures › ' + (snel ? 'SNEL' : 'REGIDESO') + ' (simulé).', { size: 13, fill: '#5b6474' });
  barcode(d, 50, 1060, 420, 60, u.invoice); d.text(50, 1140, u.invoice, { size: 14, mono: true });
  stamp(d, 740, 1080, 58, (snel ? 'SNEL · KINSHASA · PAYÉ ·' : 'REGIDESO · KINSHASA ·'), main, 10);
  watermark(d);
  return { d, fields: { holder_name: u.holder, address: u.address, commune: u.commune, city: u.city, issue_date: u.issue } };
}

// f: { full_name, msisdn, id_number, id_type, reason, new_iccid, date, agent, agent_code, sig_mismatch }
export function simSwapForm(f, rng) {
  const d = new Doc(900, 1180, rng);
  d.rect(0, 0, 900, 1180, '#fff'); d.rect(0, 0, 900, 120, '#e60000');
  d.add(`<circle cx="80" cy="60" r="36" fill="#fff"/><path d="M84,40 c-14,0 -24,10 -24,22 c0,12 9,20 21,20 c10,0 18,-7 18,-16 c0,-8 -6,-13 -14,-13 c3,-6 4,-9 -1,-13z" fill="#e60000"/>`);
  d.text(136, 56, 'VODACOM CONGO (RDC) S.A. — M-PESA', { size: 22, weight: 800, fill: '#fff' });
  d.text(136, 88, 'Formulaire de remplacement de carte SIM (SIM swap)', { size: 16, fill: '#fff' });
  const fld = (y, label, value, field, o = {}) => { d.text(60, y, label, { size: 13, weight: 700, fill: '#5b6474' }); d.rect(60, y + 10, 780, 46, '#f7f8fa', { stroke: '#d9dce2', rx: 6 }); d.text(76, y + 42, value, { size: 20, weight: 700, mono: o.mono, field, boxExtra: o.boxExtra }); };
  d.text(60, 170, '1. IDENTIFICATION DU TITULAIRE', { size: 15, weight: 800, fill: '#e60000' });
  fld(200, 'Nom complet (tel que sur la pièce d’identité)', f.full_name, 'full_name');
  fld(280, 'Numéro M-Pesa concerné', f.msisdn, 'msisdn', { mono: true });
  fld(360, `Pièce d’identité — ${f.id_type || 'Carte d’électeur'} — numéro`, f.id_number, 'id_number', { mono: true });
  d.text(60, 470, '2. MOTIF DE LA DEMANDE', { size: 15, weight: 800, fill: '#e60000' });
  ['Perte de la carte SIM', 'Vol du téléphone', 'Carte SIM endommagée', 'Migration 4G / eSIM'].forEach((r, i) => { const x = 60 + (i % 2) * 400, y = 510 + Math.floor(i / 2) * 44; const on = r === f.reason_fr; d.rect(x, y - 20, 24, 24, '#fff', { stroke: '#8a94a6', sw: 1.5, rx: 4 }); if (on) d.add(`<path d="M${x + 4},${y - 8} l6,7 l12,-14" fill="none" stroke="#e60000" stroke-width="3.5"/>`); d.text(x + 36, y, r, { size: 17, weight: on ? 800 : 400, field: on ? 'swap_reason' : null }); });
  d.text(60, 640, '3. NOUVELLE CARTE SIM', { size: 15, weight: 800, fill: '#e60000' });
  fld(670, 'ICCID de la nouvelle carte', f.new_iccid, 'new_iccid', { mono: true });
  d.text(60, 790, '4. DÉCLARATION ET SIGNATURE', { size: 15, weight: 800, fill: '#e60000' });
  d.text(60, 822, 'Je certifie que les informations ci-dessus sont exactes et j’autorise le transfert de ma ligne et de mon compte M-Pesa.', { size: 13 });
  d.text(60, 870, `Fait à Kinshasa, le ${fmtDate(f.date)}`, { size: 16, field: 'request_date' });
  d.rect(470, 850, 370, 120, '#fff', { stroke: '#d9dce2', rx: 6 }); d.text(480, 872, 'Signature du titulaire', { size: 12, fill: '#5b6474' }); signature(d, 520, 930, 220, '#1f3b8f', 'signature');
  if (f.sig_mismatch) d.boxes.signature.s = 'bad', d.boxes.signature.note = 'Does not match the specimen on file';
  d.rect(40, 1010, 820, 130, '#fff8e6', { stroke: '#f0c56b', rx: 8 }); d.text(60, 1040, 'CADRE RÉSERVÉ À L’AGENT / AU SHOP', { size: 13, weight: 800, fill: '#8a5a00' });
  d.text(60, 1072, `Agent : ${f.agent}   ·   Code : ${f.agent_code}`, { size: 15, field: 'agent' }); d.text(60, 1102, 'Pièce originale vue : ☑   Photo prise : ☑   Ancien ICCID bloqué : ☐', { size: 15 });
  watermark(d);
  return { d, fields: { full_name: f.full_name, msisdn: f.msisdn, id_number: f.id_number, swap_reason: f.reason, new_iccid: f.new_iccid, request_date: f.date, signature: 'Handwritten signature present', agent: `${f.agent} · ${f.agent_code}` } };
}

// st: { holder, msisdn, period, rows:[{ts,ref,type,cp,amount,bal,flag}] }
export function statement(st, rng) {
  const h = 330 + st.rows.length * 36 + 170; const d = new Doc(960, h, rng);
  d.rect(0, 0, 960, h, '#fff'); d.rect(0, 0, 960, 96, '#121317');
  d.add(`<circle cx="62" cy="48" r="28" fill="#e60000"/>`); d.text(62, 56, 'M', { size: 26, weight: 900, fill: '#fff', anchor: 'middle' });
  d.text(110, 44, 'M-PESA G2 — RELEVÉ DE COMPTE / ACCOUNT STATEMENT', { size: 20, weight: 800, fill: '#fff' });
  d.text(110, 72, 'Extraction Sentinel AML/CFT · usage interne · confidentiel', { size: 13, fill: '#b9bec8' });
  d.text(40, 140, 'Titulaire', { size: 12, weight: 700, fill: '#5b6474' }); d.text(40, 166, st.holder, { size: 19, weight: 800, field: 'holder_name' });
  d.text(480, 140, 'Numéro', { size: 12, weight: 700, fill: '#5b6474' }); d.text(480, 166, st.msisdn, { size: 19, weight: 800, mono: true, field: 'msisdn' });
  d.text(700, 140, 'Période', { size: 12, weight: 700, fill: '#5b6474' }); d.text(700, 166, st.period, { size: 16, weight: 700 });
  d.text(40, 206, st.type_label || '', { size: 13, fill: '#5b6474' });
  const X = [40, 190, 350, 480, 790, 920];
  d.rect(30, 236, 900, 40, '#f2f3f5'); ['Date / heure', 'Référence', 'Type', 'Contrepartie', 'Montant USD', 'Solde'].forEach((t, i) => d.text(X[i], 262, t, { size: 13, weight: 800, anchor: i >= 4 ? 'end' : 'start' }));
  let y = 302;
  st.rows.forEach((r, i) => {
    if (r.flag) d.rect(30, y - 24, 900, 34, '#fff1f1');
    const cells = [r.ts, r.ref, r.type.replace(/_/g, ' '), r.cp, (r.credit ? '+' : '−') + r.amount.toFixed(2), r.bal.toFixed(2)];
    cells.forEach((t, k) => d.text(X[k], y, t, { size: 13.5, weight: r.flag && k === 4 ? 800 : 400, mono: k === 1, anchor: k >= 4 ? 'end' : 'start', fill: r.flag && k === 4 ? '#b00000' : '#1d1f24' }));
    if (r.flag) d.box('tx_' + i, 32, y - 24, 896, 34, { s: 'bad', note: r.flag, label: `${r.ref} · ${r.amount.toFixed(2)} USD` });
    d.line(30, y + 10, 930, y + 10, '#eef0f3'); y += 36;
  });
  d.rect(30, y + 10, 900, 110, '#f7f8fa', { rx: 8 });
  st.summary.forEach((t, i) => d.text(50, y + 44 + i * 28, t.text, { size: 15, weight: t.bold ? 800 : 400, fill: t.bad ? '#b00000' : '#1d1f24', field: t.field, boxExtra: t.field ? { s: t.bad ? 'bad' : 'info', note: t.note } : {} }));
  watermark(d);
  return { d, fields: { holder_name: st.holder, msisdn: st.msisdn, period: st.period, flagged_transactions: String(st.rows.filter(r => r.flag).length), ...(st.summary?.[0]?.field ? { pattern: st.summary[0].text } : {}) } };
}

// s: { holder, birth, candidate, list, score, nat }
export function screeningReport(s, rng) {
  const d = new Doc(900, 900, rng);
  d.rect(0, 0, 900, 900, '#fff'); d.rect(0, 0, 900, 90, '#1e293b');
  d.text(40, 42, 'SANCTIONS & PEP SCREENING — RESULT', { size: 22, weight: 800, fill: '#fff' }); d.text(40, 70, 'Screening provider (simulated) · consolidated lists: UN · EU · OFAC · DRC national', { size: 13, fill: '#cbd5e1' });
  const R = (y, l, v, f, o = {}) => { d.text(40, y, l, { size: 13, weight: 700, fill: '#5b6474' }); d.text(300, y, v, { size: 17, weight: 700, field: f, boxExtra: o.box, fill: o.fill }); d.line(40, y + 14, 860, y + 14, '#eef0f3'); };
  R(140, 'Screened party', s.holder, 'holder_name'); R(180, 'Date of birth (KYC)', fmtDate(s.birth), 'date_of_birth'); R(220, 'Nationality', 'Congolese (COD)');
  d.rect(30, 260, 840, 260, '#fff7ed', { stroke: '#fdba74', rx: 10 });
  d.text(50, 296, 'POTENTIAL MATCH', { size: 15, weight: 800, fill: '#c2410c' });
  R(336, 'List entry', s.candidate, 'match_name', { box: { s: 'bad', note: `Name similarity ${s.score}%` } });
  R(376, 'List', s.list); R(416, 'Listed date of birth', s.cand_birth, 'match_birth', { box: { s: 'warn', note: 'Year matches, day/month differ' } });
  R(456, 'Similarity score', s.score + ' %', 'match_score', { fill: '#c2410c', box: { s: 'bad', note: 'Above 85 % alert threshold' } });
  R(496, 'Status', 'OPEN — awaiting analyst disposition');
  d.text(40, 580, 'Analyst guidance', { size: 15, weight: 800 });
  d.h = 720; d.p[0] = `<rect x="0" y="0" width="900" height="720" fill="#fff"/>`;
  ['1. Compare full identity (date and place of birth, ID number, photo) with the list entry.', '2. Request additional identification if needed (EDD).', '3. Record the disposition (true match / false positive) with the rationale — mandatory for audit.'].forEach((t, i) => d.text(40, 612 + i * 28, t, { size: 14 }));
  watermark(d);
  return { d, fields: { holder_name: s.holder, match_name: s.candidate, match_score: s.score + '%', list: s.list } };
}

// c: { title, partner, rccm, date, clauses:[{n,title,text:[...], risk, note}] }
export function contract(c, rng) {
  const d = new Doc(900, 1250, rng);
  d.rect(0, 0, 900, 1250, '#fff'); d.line(60, 120, 840, 120, '#1d1f24', 2);
  d.text(60, 70, 'VODACASH S.A. — M-PESA RDC', { size: 15, weight: 800, fill: '#e60000' }); d.text(840, 70, 'Projet — version partenaire', { size: 13, anchor: 'end', fill: '#5b6474', italic: true });
  d.text(450, 170, c.title.toUpperCase(), { size: 22, weight: 800, anchor: 'middle', serif: true });
  d.text(450, 204, 'ENTRE', { size: 13, anchor: 'middle', weight: 700, fill: '#5b6474' });
  d.text(450, 232, 'VODACASH S.A., société de monnaie électronique agréée par la Banque Centrale du Congo, ci-après « M-Pesa »,', { size: 13, anchor: 'middle' });
  d.text(450, 256, 'ET', { size: 13, anchor: 'middle', weight: 700, fill: '#5b6474' });
  d.text(450, 284, `${c.partner}, RCCM ${c.rccm}, ci-après « le Partenaire ».`, { size: 14, anchor: 'middle', weight: 700, field: 'partner' });
  let y = 340;
  for (const cl of c.clauses) {
    const start = y;
    d.text(60, y, `Article ${cl.n} — ${cl.title}`, { size: 16, weight: 800, serif: true }); y += 28;
    for (const t of cl.text) { d.text(60, y, t, { size: 14, serif: true }); y += 22; }
    if (cl.risk) d.box('clause_' + cl.n, 50, start - 22, 800, y - start + 8, { s: cl.risk === 'HIGH' ? 'bad' : cl.risk === 'MEDIUM' ? 'warn' : 'info', note: cl.note, label: `Art. ${cl.n} — ${cl.title}` });
    y += 18;
  }
  d.text(60, y + 30, `Fait à Kinshasa, le ${fmtDate(c.date)}, en deux exemplaires originaux.`, { size: 14, serif: true, italic: true });
  d.text(120, y + 80, 'Pour M-Pesa', { size: 14, weight: 700 }); d.text(560, y + 80, 'Pour le Partenaire', { size: 14, weight: 700 });
  d.text(120, y + 110, '(non signé — en revue juridique)', { size: 12, italic: true, fill: '#9aa0ab' }); signature(d, 560, y + 130, 170);
  d.h = Math.max(900, y + 200); d.p[0] = `<rect x="0" y="0" width="900" height="${d.h}" fill="#fff"/>`;
  watermark(d);
  return { d, fields: { partner: c.partner, contract_title: c.title } };
}

// r: { sms:[{from,text,t}], tx_ref, amount, cp, date, msisdn, note }
export function phoneReceipt(r, rng) {
  const d = new Doc(620, 1100, rng);
  d.rect(0, 0, 620, 1100, '#1b1c20', { rx: 60 }); d.rect(24, 24, 572, 1052, '#eef1f5', { rx: 44 });
  d.rect(24, 24, 572, 120, '#ffffff', { rx: 44 }); d.rect(24, 100, 572, 44, '#ffffff');
  d.text(310, 70, 'M-PESA', { size: 22, weight: 900, anchor: 'middle', fill: '#e60000' }); d.text(310, 100, 'SMS · ' + r.msisdn, { size: 14, anchor: 'middle', fill: '#5b6474' });
  let y = 190;
  for (const m of r.sms) {
    const lines = []; let cur = ''; for (const w of m.text.split(' ')) { if (textWidth(cur + ' ' + w, 17) > 400) { lines.push(cur.trim()); cur = w; } else cur += ' ' + w; } if (cur.trim()) lines.push(cur.trim());
    const mine = m.from === 'me', bw = 450, bh = lines.length * 26 + 30, bx = mine ? 596 - 30 - bw : 54;
    d.rect(bx, y, bw, bh, mine ? '#d9fdd3' : '#ffffff', { rx: 18 });
    lines.forEach((l, i) => {
      const ty = y + 32 + i * 26, x0 = bx + 18;
      d.text(x0, ty, l, { size: 17 });
      if (m.from !== 'me') for (const [field, val] of [['tx_ref', r.tx_ref], ['amount', r.amount_txt], ['counterparty', r.cp], ['tx_date', r.date_txt]]) {
        const at = l.indexOf(val); if (at < 0) continue;
        const px = x0 + textWidth(l.slice(0, at), 17), w = textWidth(val, 17);
        d.box(field, px - 4, ty - 17, w + 8, 23);
      }
    });
    d.text(mine ? 596 - 40 : 70 + bw - 30, y + bh - 8, m.t, { size: 11, fill: '#8a94a6', anchor: 'end' });
    y += bh + 22;
  }
  d.h = Math.max(700, y + 80); d.p[0] = `<rect x="0" y="0" width="620" height="${d.h}" fill="#1b1c20" rx="60"/>`; d.p[1] = `<rect x="24" y="24" width="572" height="${d.h - 48}" fill="#eef1f5" rx="44"/>`;
  watermark(d, 'SPECIMEN');
  return { d, fields: { tx_ref: r.tx_ref, amount: r.amount_txt + ' USD', counterparty: r.cp, tx_date: r.date_txt } };
}
