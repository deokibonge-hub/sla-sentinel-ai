import React, { useEffect, useRef, useState } from 'react';
import { api } from './lib.jsx';

const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { } } };
const SAMPLES = [
  { file: 'sample_rccm_kin_market.png', label: 'RCCM certificate — Kin Market SARL' },
  { file: 'sample_id_jean_paul_mukendi.png', label: 'ID card — Jean-Paul Mukendi' },
  { file: 'sample_proof_of_address.png', label: 'Proof of address — utility bill' },
  { file: 'sample_id_renewed.png', label: 'Renewed ID card (valid 2031)' },
  { file: 'photo_rccm_fr.jpg', label: 'Photo · RCCM certificate (French, Boulangerie La Confiance)', real: true },
  { file: 'photo_passport.jpg', label: 'Photo · Passport with MRZ (Marie Kabeya)', real: true },
  { file: 'photo_voter_card.jpg', label: 'Photo · Voter card (CENI)', real: true },
  { file: 'photo_snel_bill.jpg', label: 'Photo · SNEL electricity bill', real: true },
  { file: 'photo_blurry.jpg', label: 'Photo · Blurry / unreadable', real: true },
];
const STAGES = ['Document received', 'Analysing document…', 'Information extracted', 'Verification in progress'];

export default function Tobi() {
  const [token, setToken] = useState(() => new URLSearchParams(location.search).get('t') || store.get('tobi_token'));
  const [conv, setConv] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(-1);
  const [sheet, setSheet] = useState(false);
  const [menu, setMenu] = useState(false);
  const [reqs, setReqs] = useState(null);
  useEffect(() => { if (!reqs || !token) return; const load = () => api(`/tobi/${token}/requests`).then(r => setReqs(r)).catch(() => { }); const i = setInterval(load, 5000); return () => clearInterval(i); }, [!!reqs, token]);
  const openReqs = async () => setReqs(await api(`/tobi/${token}/requests`));
  const fileRef = useRef(); const listRef = useRef(); const pendingType = useRef(null);

  useEffect(() => { (async () => {
    let t = token;
    if (t) { try { setConv(await api('/tobi/' + t)); return; } catch { t = null; } }
    const r = await api('/tobi/start', {}); store.set('tobi_token', r.token); setToken(r.token); setConv(await api('/tobi/' + r.token));
  })(); }, []);
  useEffect(() => { if (!token) return; const i = setInterval(() => { if (!busy) api('/tobi/' + token).then(setConv).catch(() => { }); }, 4000); return () => clearInterval(i); }, [token, busy]);
  const lastId = conv?.messages?.at(-1)?.id;
  useEffect(() => { const el = listRef.current; if (!el) return; requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; setTimeout(() => { el.scrollTop = el.scrollHeight; }, 260); }); }, [lastId, conv?.messages?.length, busy, stage]);

  const run = async (fn) => { setBusy(true); try { const d = await fn(); if (d) setConv(d); } catch (e) { alert(e.message); } finally { setBusy(false); } };
  const send = (t) => { if (!t.trim() || busy) return; setText(''); setConv(c => ({ ...c, messages: [...c.messages, { id: 'tmp', sender: 'user', kind: 'text', content: t }] })); run(() => api(`/tobi/${token}/message`, { text: t })); };
  const action = (a) => run(() => api(`/tobi/${token}/action`, a));
  const upload = async (file, name) => {
    setMenu(false); if (!file) return;
    const data = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(file); });
    setConv(c => ({ ...c, messages: [...c.messages, { id: 'tmp', sender: 'user', kind: 'upload', content: name || file.name }] }));
    setBusy(true); setStage(0);
    const t1 = setTimeout(() => setStage(1), 700);
    try {
      const d = await api(`/tobi/${token}/upload`, { filename: name || file.name, mime: file.type || 'image/png', data, doc_type: pendingType.current });
      clearTimeout(t1); setStage(2); await new Promise(r => setTimeout(r, 650)); setStage(3); await new Promise(r => setTimeout(r, 750));
      setConv(d);
    } catch (e) { alert(e.message); } finally { setStage(-1); setBusy(false); pendingType.current = null; }
  };
  const sample = async (s) => { const b = await (await fetch('/samples/' + s.file)).blob(); upload(new File([b], s.file, { type: /\.jpe?g$/i.test(s.file) ? 'image/jpeg' : 'image/png' }), s.file); };
  const restart = async () => { if (!confirm('Start a new conversation?')) return; store.set('tobi_token', null); const r = await api('/tobi/start', {}); store.set('tobi_token', r.token); setToken(r.token); setConv(await api('/tobi/' + r.token)); };

  if (!conv) return <div className="tobi-wrap"><div className="phone" style={{ alignItems: 'center', justifyContent: 'center' }}><div className="spin" /></div></div>;
  const msgs = conv.messages;
  const lastUser = Math.max(-1, ...msgs.map((m, i) => m.sender === 'user' ? i : -1));
  const app = conv.application;

  return <div className="tobi-wrap"><div className="phone">
    <div className="th">
      <img src="/tobi.png" alt="TOBi" />
      <div className="grow"><div className="nm">TOBi</div><div className="sb">{conv.service ? conv.service.label + ' · online' : app.status === 'ACTIVE' ? 'M-Pesa Business assistant · online' : 'M-Pesa assistant · online'}</div>
        {app.status === 'DRAFT' && !conv.service && !['MENU', 'GREETING'].includes(conv.stage) && <div className="prog"><i style={{ width: app.progress + '%' }} /></div>}</div>
      <button className="btn sm" style={{ background: 'rgba(255,255,255,.18)', color: '#fff', border: 'none' }} onClick={openReqs} title="My requests">Requests</button>
      <button className="btn sm" style={{ background: 'rgba(255,255,255,.18)', color: '#fff', border: 'none' }} onClick={() => setSheet(true)}>📄 {app.status === 'DRAFT' && !conv.service && !['MENU', 'GREETING'].includes(conv.stage) ? app.progress + '%' : 'Info'}</button>
      <button className="btn sm ghost" style={{ color: '#fff' }} title="New conversation" onClick={restart}>↻</button>
    </div>
    <div className="msgs" ref={listRef}>
      {msgs.map((m, i) => <Msg key={m.id + '_' + i} m={m} live={i > lastUser} token={token} onSend={send} onAction={action} onAttach={(t) => { pendingType.current = t || null; setMenu(true); }} />)}
      {stage >= 0 && <div className="mcard"><div className="hd ALERT">DOCUMENT INTELLIGENCE</div><div className="bd stages">{STAGES.map((s, i) => <div key={s} className={'s ' + (i < stage ? 'done' : i === stage ? 'on' : '')}>{i < stage ? '✓' : i === stage ? <span className="spin" /> : '○'} {s}</div>)}</div></div>}
      {busy && stage < 0 && <div className="typing"><i /><i /><i /></div>}
    </div>
    {menu && <div className="attach-menu">
      <button onClick={() => fileRef.current.click()}>📷 Take photo / choose file</button>
      <div className="tiny mut" style={{ padding: '6px 10px 2px' }}>DEMO SAMPLE DOCUMENTS (FICTIONAL)</div>
      {SAMPLES.filter(s => !s.real).map(s => <button key={s.file} onClick={() => sample(s)}>🗂️ {s.label}</button>)}
      <div className="tiny mut" style={{ padding: '6px 10px 2px' }}>REAL-WORLD PHOTOS (FICTIONAL, FRENCH LAYOUTS)</div>
      {SAMPLES.filter(s => s.real).map(s => <button key={s.file} onClick={() => sample(s)}>📷 {s.label}</button>)}
      <button className="mut" onClick={() => setMenu(false)}>Cancel</button>
    </div>}
    <div className="composer">
      <button className="icon-btn" title="Attach a document" onClick={() => setMenu(v => !v)}>📎</button>
      <input ref={fileRef} type="file" accept="image/*,application/pdf" capture="environment" style={{ display: 'none' }} onChange={e => upload(e.target.files[0])} />
      <textarea rows={1} placeholder="Message TOBi…" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text); } }} />
      <button className="icon-btn send" onClick={() => send(text)} disabled={busy}>➤</button>
    </div>
    {sheet && <div className="sheet-bg" onClick={() => setSheet(false)}><div className="sheet" onClick={e => e.stopPropagation()}>
      <div className="row"><h2 className="grow">Information collected</h2><button className="btn sm" onClick={() => setSheet(false)}>Close</button></div>
      {conv.service ? <>
        <div className="small mut" style={{ marginTop: 4 }}>{conv.service.label} · target {conv.service.sla} · {conv.service.team}</div>
        <div className="sec"><div className="st">Request</div>{conv.service.rows.map(r => <div className="frow" key={r.key}><div>{r.label}<div className="src" style={{ color: r.value ? '#2563eb' : '#b0b4bd' }}>{r.value ? '✓ COLLECTED' : 'MISSING'}</div></div><div className="fv">{r.value ?? <span className="mut">—</span>}</div></div>)}</div>
        <div className="sec"><div className="st">Documents</div>{conv.service.docs.length ? conv.service.docs.map(d => <div className="frow" key={d.id}><div>{d.doc_type}</div><div className="fv">{d.ok ? '✓ verified' : '⚠ check'}</div></div>) : <div className="small mut">No documents yet.</div>}</div>
      </> : <>
      <div className="small mut" style={{ marginTop: 4 }}>TOBi structures your answers and documents into the M-Pesa merchant application (BCF). {app.case && <b>Case {app.case.ref}</b>} {app.status !== 'DRAFT' && <a href={`/api/tobi/${token}/form`} target="_blank">Open merchant form ↗</a>}</div>
      <div className="prog" style={{ background: '#eee', height: 6, marginTop: 10 }}><i style={{ width: app.progress + '%', background: 'var(--red)' }} /></div>
      {Object.entries(app.sections).map(([sec, rows]) => <div className="sec" key={sec}><div className="st">{sec}</div>
        {rows.map(r => <div className="frow" key={r.key}><div>{r.label}<div className="src" style={{ color: r.conflict ? 'var(--red)' : r.source === 'document' ? 'var(--green)' : r.source ? '#2563eb' : '#b0b4bd' }}>{r.conflict ? '⚠ NEEDS CLARIFICATION' : r.source === 'document' ? '✓ FROM DOCUMENT' : r.source ? (r.clarified ? '✓ CLARIFIED' : '✎ DECLARED') : 'MISSING'}</div></div><div className="fv">{r.value ?? <span className="mut">—</span>}</div></div>)}
      </div>)}
      <div className="sec"><div className="st">Documents</div>{app.documents.length ? app.documents.map(d => <div className="frow" key={d.id}><div>{d.label || d.type}<div className="src mut">{d.filename}</div></div><div className="fv">{d.expiry ? 'exp. ' + d.expiry : '✓'}</div></div>) : <div className="small mut">No documents yet.</div>}</div>
      </>}
    </div></div>}
    {reqs && <div className="sheet-bg" onClick={() => setReqs(null)}><div className="sheet" onClick={e => e.stopPropagation()}>
      <div className="row"><h2 className="grow">My requests</h2><button className="btn sm" onClick={() => setReqs(null)}>Close</button></div>
      <div className="small mut" style={{ marginTop: 4 }}>Only your own requests · refreshed automatically</div>
      {reqs.length ? reqs.map(r => <ReqCard key={r.ref} r={r} />) : <div className="small mut" style={{ marginTop: 14 }}>No request yet.</div>}
      <button className="btn" style={{ marginTop: 14, justifyContent: 'center' }} onClick={() => { setReqs(null); send('New request'); }}>+ New request</button>
    </div></div>}
  </div></div>;
}

function Msg({ m, live, onSend, onAction, onAttach, token }) {
  const meta = m.meta || {};
  if (m.sender === 'user') return m.kind === 'upload' ? <div className="m u">📎 {m.content}</div> : <div className="m u">{m.content}</div>;
  const text = m.content ? <div className="m t">{m.content}</div> : null;
  switch (m.kind) {
    case 'options': return <>{text}{live && <div className="chips">{meta.options.map(o => <button key={o} className="chip" onClick={() => meta.action_id ? onAction({ type: 'lifecycle', value: { action_id: meta.action_id, choice: o } }) : onSend(o)}>{o}</button>)}</div>}</>;
    case 'conflict': return <>{text}{live && <div className="chips">{meta.options.map(o => <button key={o.use} className="chip" onClick={() => onAction({ type: 'conflict', value: { field: meta.field, use: o.use } })}>{o.label}</button>)}</div>}</>;
    case 'upload_request': return <>{text}{live && <div className="chips"><button className="chip" onClick={() => onAttach(meta.doc_types?.[0])}>📎 Upload {meta.doc_types?.length === 1 ? '' : 'documents'}</button><button className="chip" style={{ borderColor: '#aaa', color: '#555' }} onClick={() => onAction({ type: 'skip_docs' })}>Continue without</button></div>}</>;
    case 'extraction': return <div className="mcard"><div className="hd">📄 {meta.label?.toUpperCase()} · {meta.mode === 'AI' ? 'AI VISION' : 'OCR'}</div><div className="bd">
      <div>{m.content}</div>
      {(meta.fields || []).map((f, i) => <div className="rw" key={i}><span>{f.label}</span><span className="row" style={{ gap: 6 }}><b>{f.value}</b><span className="conf" title={f.confidence + '%'}><i style={{ width: f.confidence + '%' }} /></span></span></div>)}
      {meta.precheck && <div className="pchk">{meta.precheck.map(c => <span key={c.code} className={c.ok ? (c.warn ? 'w' : 'ok') : 'ko'}>{c.ok ? (c.warn ? '⚠' : '✓') : '✕'} {c.label}</span>)}</div>}
      <a className="tiny mut" href={`/api/tobi/${token}/doc/${meta.doc_id}`} target="_blank">View document</a></div></div>;
    case 'review': return <>{text}<div className="mcard"><div className="hd">VERIFICATION SUMMARY</div><div className="bd">
      {meta.summary.map(s => <div key={s.label} className="rw"><span style={{ color: 'var(--ink)' }}>{s.label}</span><b style={{ color: s.ok ? 'var(--green)' : 'var(--amber)' }}>{s.ok ? '✓' : '⚠'}</b></div>)}
      {meta.summary.filter(s => !s.ok).flatMap(s => s.issues).map((i, k) => <div key={k} className="tiny" style={{ color: '#8a5300' }}>• {i}</div>)}
      <div className="b" style={{ textAlign: 'center', fontSize: 12, letterSpacing: '.08em', color: meta.ready ? 'var(--green)' : 'var(--amber)' }}>{meta.ready ? 'APPLICATION READY FOR SUBMISSION' : 'SUBMISSION WITH EXCEPTIONS'}</div>
      {live && <button className="btn primary" style={{ justifyContent: 'center' }} onClick={() => onAction({ type: 'submit' })}>SUBMIT APPLICATION</button>}</div></div></>;
    case 'card': return <div className="mcard"><div className={'hd ' + (meta.pillar || '')}>{meta.title?.toUpperCase()}</div><div className="bd"><div>{m.content}</div>{(meta.rows || []).map(([k, v]) => <div className="rw" key={k}><span>{k}</span><b>{v}</b></div>)}{meta.form_link && <a className="btn sm" style={{ alignSelf: 'flex-start' }} href={`/api/tobi/${token}/form`} target="_blank">📄 Merchant form (BCF)</a>}</div></div>;
    case 'link': return <>{text}<a className="btn primary sm" style={{ alignSelf: 'flex-start', marginLeft: 4 }} href={meta.href} target="_blank">📄 {meta.label}</a></>;
    case 'requests': return <>{text}{(meta.items || []).map(r => <ReqCard key={r.ref} r={r} compact />)}</>;
    case 'offer': return <div className="mcard"><div className="hd ENGAGE">ENGAGE · {meta.title?.toUpperCase()}</div><div className="bd"><div>{m.content}</div>{live && <div className="row">{meta.options.map((o, i) => <button key={o} className={'btn ' + (i === 0 ? 'primary' : '')} onClick={() => onAction({ type: 'lifecycle', value: { action_id: meta.action_id, choice: o } })}>{o}</button>)}</div>}</div></div>;
    case 'quiz_intro': return <div className="mcard"><div className="hd EDUCATE">EDUCATE · AML/CFT AWARENESS</div><div className="bd"><div>{m.content}</div>{live && <button className="btn primary" onClick={() => onAction({ type: 'quiz', value: { action_id: meta.action_id, step: 'start' } })}>Start (3 questions)</button>}</div></div>;
    case 'quiz': return <>{text}{live && <div className="chips">{meta.options.map((o, i) => <button key={o} className="chip" onClick={() => onAction({ type: 'quiz', value: { action_id: meta.action_id, step: meta.idx, answer: i } })}>{o}</button>)}</div>}</>;
    case 'action': return <div className="mcard"><div className="hd ALERT">⚠ {meta.title}</div><div className="bd"><div>{m.content}</div>{live && <button className="btn primary" onClick={() => onAttach(meta.doc_type)}>📎 {meta.button}</button>}</div></div>;
    default: return text;
  }
}

const fmtLeft = (ms) => { if (ms == null) return null; const neg = ms < 0; ms = Math.abs(ms); const h = Math.floor(ms / 3600000), d = Math.floor(h / 24); const s = d >= 1 ? `${d}d ${h % 24}h` : `${h}h ${Math.floor(ms / 60000) % 60}m`; return neg ? `overdue by ${s}` : `${s} left`; };
function ReqCard({ r, compact }) {
  const col = r.status === 'RESOLVED' ? 'var(--green)' : r.status === 'REJECTED' ? 'var(--red)' : r.status === 'AWAITING_CUSTOMER' || r.status === 'EDD_REQUESTED' ? 'var(--amber)' : '#2563eb';
  const slaCol = { ON_TRACK: 'var(--green)', AT_RISK: 'var(--amber)', CRITICAL: 'var(--red)', BREACHED: 'var(--red)', MET: 'var(--green)' }[r.sla_status] || '#888';
  return <div className="mcard" style={{ marginTop: compact ? 0 : 12 }}><div className="hd" style={{ background: col }}>{r.service.toUpperCase()} · {r.ref}</div><div className="bd">
    <div className="rw"><span>Status</span><b style={{ color: col }}>{r.status_label}</b></div>
    <div className="rw"><span>Target</span><b>{r.sla_label}</b></div>
    {r.resolved ? <div className="rw"><span>Completed</span><b>{new Date(r.resolved).toUTCString().slice(5, 22)}</b></div> : <div className="rw"><span>SLA</span><b style={{ color: slaCol }}>{fmtLeft(r.remaining_ms)} · due {new Date(r.due).toUTCString().slice(5, 22)}</b></div>}
    <div className="rw"><span>Handled by</span><b>{r.team}</b></div>
    {r.reasons?.length > 0 && <div className="tiny" style={{ color: '#8a5300', marginTop: 4 }}>{r.status === 'REJECTED' ? 'Reason' : 'Needed from you'}: {r.reasons.join(' · ')}</div>}
  </div></div>;
}
