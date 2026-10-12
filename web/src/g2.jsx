import React, { useEffect, useMemo, useState } from 'react';
import { api, nav, useApi, useToast } from './lib.jsx';

// G2 simulator — styled after the M-Pesa CPS Service Provider Portal (fictional data, simulator only).
const fmt = (m) => m && String(m).length === 12 ? `+${m.slice(0, 3)} ${m.slice(3, 5)} ${m.slice(5, 8)} ${m.slice(8)}` : m;
const dt = (v) => v ? new Date(v).toLocaleString('en-GB').replace(',', '') : '';
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const OPS = [['SIM_SWAP', 'SIM Swap'], ['PIN_RESET', 'Reset PIN'], ['SUSPEND', 'Freeze'], ['REACTIVATE', 'Unfreeze'], ['FLOAT_TOPUP', 'Float Top-up'], ['DELETE', 'Close Account']];
const TYPE_LABEL = { CUSTOMER: 'Customer', MERCHANT: 'Organization (Merchant)', AGENT: 'Organization (Agent)' };

export default function G2({ me }) {
  const [ok, setOk] = useState(() => { try { return sessionStorage.getItem('g2_ok') === me.username; } catch { return false; } });
  if (!ok) return <CpsLogin me={me} onOk={() => { try { sessionStorage.setItem('g2_ok', me.username); } catch { } setOk(true); }} />;
  return <Cps me={me} />;
}

// ---------------- login ----------------
function Captcha({ code }) {
  const lines = useMemo(() => [...Array(7)].map(() => [Math.random() * 100, Math.random() * 34, Math.random() * 100, Math.random() * 34, ['#c33', '#393', '#36c', '#999'][Math.floor(Math.random() * 4)]]), [code]);
  return <svg width="100" height="34" style={{ background: '#f4f1ea', border: '1px solid #ccc' }}>{[...code].map((c, i) => <text key={i} x={10 + i * 21} y={25 + (i % 2 ? -3 : 3)} fontSize="22" fontFamily="Georgia" fill={['#5b1d3a', '#333', '#6b2d1a', '#2d3b6b'][i]} transform={`rotate(${(i % 2 ? 8 : -10)} ${14 + i * 21} 20)`}>{c}</text>)}{lines.map((l, i) => <line key={i} x1={l[0]} y1={l[1]} x2={l[2]} y2={l[3]} stroke={l[4]} strokeWidth="1" />)}</svg>;
}
function CpsLogin({ me, onOk }) {
  const gen = () => String(1000 + Math.floor(Math.random() * 9000));
  const [code, setCode] = useState(gen), [u, setU] = useState(me.username), [p, setP] = useState(''), [v, setV] = useState(''), [err, setErr] = useState('');
  const go = async (e) => { e.preventDefault(); if (!u.trim() || !p.trim()) return setErr('Please enter the user name and password.'); if (v.trim() !== code) { setCode(gen()); setV(''); return setErr('The verification code is incorrect.'); } try { await api('/reauth', { password: p }); onOk(); } catch (er) { setCode(gen()); setV(''); setP(''); setErr(er.message); } };
  return <div className="cps-login-bg"><form className="cps-login" onSubmit={go}>
    <div className="cps-lt"><div className="t1">CPS</div><div className="t2">Service Provider Portal</div></div>
    <div className="cps-banner"><img src="/logo_crop.png" alt="Vodacom · M-Pesa" /><svg viewBox="0 0 600 260" preserveAspectRatio="none"><path d="M120 190 Q 380 210 600 160 L600 260 L120 260 Z" fill="#e6e6e6" /><path d="M0 200 Q 260 180 420 120 Q 520 70 600 0 L 600 150 Q 360 220 0 200 Z" fill="#d2d2d2" /><path d="M330 120 L 380 60 L 430 125 Z" fill="#ececec" /></svg></div>
    <div className="cps-form">
      <label>Language:</label><select className="cps-in"><option>English</option><option>Français</option></select>
      <label>User Name:</label><input className="cps-in" value={u} onChange={e => setU(e.target.value)} autoCapitalize="none" />
      <label>Password:</label><div className="row" style={{ gap: 10 }}><input className="cps-in" type="password" value={p} onChange={e => setP(e.target.value)} placeholder="your Sentinel password" /><a className="cps-link" href="#" onClick={e => { e.preventDefault(); setErr('Use the same password as your Sentinel sign-in.'); }}>Forgot password?</a></div>
      <label>Verification Code:</label><div className="row" style={{ gap: 8 }}><input className="cps-in" style={{ width: 170 }} value={v} onChange={e => setV(e.target.value)} /><Captcha code={code} /><button type="button" className="cps-refresh" title="Refresh" onClick={() => setCode(gen())}>⟳</button></div>
      <span /><div><button className="cps-btn" type="submit" style={{ minWidth: 128 }}>Login</button>{err && <div className="cps-err">{err}</div>}</div>
    </div>
    <div className="cps-copy">G2 Simulator · SLA Sentinel AI prototype — fictional data. Recommended screen resolution: 1280 × 768 or higher.</div>
  </form></div>;
}

// ---------------- shell with tabs ----------------
function Cps({ me }) {
  const q0 = new URLSearchParams(location.search).get('q');
  const [tabs, setTabs] = useState(() => q0 ? [{ id: 'P:' + q0, kind: 'PROFILE', title: 'Profile', msisdn: q0 }] : []);
  const [active, setActive] = useState(() => q0 ? 'P:' + q0 : 'HOME');
  const [menu, setMenu] = useState(null);
  const open = (t) => { setTabs(ts => ts.some(x => x.id === t.id) ? ts : [...ts, t]); setActive(t.id); setMenu(null); };
  const close = (id) => { setTabs(ts => ts.filter(x => x.id !== id)); if (active === id) setActive('HOME'); };
  const openProfile = (msisdn, name) => open({ id: 'P:' + msisdn, kind: 'PROFILE', title: name ? String(name).slice(0, 18) : fmt(msisdn), msisdn });
  const MENUS = {
    'My Tasks': [['TASKS', 'My Tasks'], ['HISTORY', 'Task History']],
    'Transaction': [['TX', 'Transaction Search']],
    'Search': [['SEARCH_CUSTOMER', 'Customer'], ['SEARCH_MERCHANT', 'Organization (Merchant)'], ['SEARCH_AGENT', 'Organization (Agent)']],
    'My Functions': [['OPS', 'Operation Support'], ['BULK', 'Bulk']],
  };
  const T = tabs.find(t => t.id === active);
  return <div className="cps" onClick={() => menu && setMenu(null)}>
    <div className="cps-top">
      <div className="cps-logo"><span className="mk">G2</span><span className="nm">CPS</span></div>
      <div className="cps-menu">{Object.entries(MENUS).map(([m, items], i) => <React.Fragment key={m}>{i > 0 && <span className="sep">┆</span>}
        <div className="mi"><button className={menu === m ? 'on' : ''} onClick={e => { e.stopPropagation(); setMenu(menu === m ? null : m); }}>{m}</button>
          {menu === m && <div className="dd" onClick={e => e.stopPropagation()}>{items.map(([k, l]) => <button key={k} onClick={() => open({ id: k, kind: k, title: l })}>{l}</button>)}</div>}</div></React.Fragment>)}</div>
      <div className="cps-user">CPS Service Provider Portal <span className="un">{me.username}</span> <a href="#" onClick={e => e.preventDefault()}>My Preference</a> <span className="help">?</span><span className="sep">|</span><button className="cps-exit" title="Exit to Sentinel" onClick={() => nav('/')}>⇥</button></div>
    </div>
    <div className="cps-tabs">
      <button className={'cps-tab' + (active === 'HOME' ? ' on' : '')} onClick={() => setActive('HOME')}><span className="home">⌂</span> Home</button>
      {tabs.map(t => <div key={t.id} className={'cps-tab' + (active === t.id ? ' on' : '')} onClick={() => setActive(t.id)}>{t.title}<button className="x" onClick={e => { e.stopPropagation(); close(t.id); }}>×</button></div>)}
    </div>
    <div className="cps-body">
      {active === 'HOME' && <Home me={me} open={open} openProfile={openProfile} />}
      {T?.kind === 'TASKS' && <Tasks pending openProfile={openProfile} />}
      {T?.kind === 'HISTORY' && <Tasks openProfile={openProfile} />}
      {T?.kind === 'TX' && <TxSearch openProfile={openProfile} />}
      {T?.kind?.startsWith('SEARCH_') && <AccSearch key={T.kind} type={T.kind.replace('SEARCH_', '')} openProfile={openProfile} />}
      {T?.kind === 'OPS' && <OpsSupport openProfile={openProfile} />}
      {T?.kind === 'BULK' && <Bulk />}
      {T?.kind === 'PROFILE' && <Profile key={T.msisdn} me={me} msisdn={T.msisdn} />}
    </div>
  </div>;
}

// ---------------- shared bits ----------------
const Title = ({ t, d }) => <><h2 className="cps-h">{t}</h2>{d && <div className="cps-d">{d}</div>}</>;
const Bar = ({ t }) => <div className="cps-bar"><span className="dot">◕</span>{t}</div>;
function Grid({ rows }) { return <div className="cps-grid">{rows.map(([l, el], i) => <React.Fragment key={i}><div className="gl">{l}</div><div className="gv">{el}</div></React.Fragment>)}</div>; }
function Table({ cols, rows, empty = 'No records found.', onRow, pageSize = 10 }) {
  const [ps, setPs] = useState(pageSize), [pg, setPg] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / ps)); const cur = Math.min(pg, pages - 1);
  const view = rows.slice(cur * ps, cur * ps + ps);
  return <div className="cps-tbl"><div style={{ overflowX: 'auto' }}><table><thead><tr>{cols.map(c => <th key={c[0]}>{c[1]}</th>)}</tr></thead>
    <tbody>{view.length ? view.map((r, i) => <tr key={i} className={onRow ? 'click' : ''} onClick={() => onRow && onRow(r)}>{cols.map(c => <td key={c[0]}>{c[2] ? c[2](r) : r[c[0]]}</td>)}</tr>) : <tr><td colSpan={cols.length} className="empty">{empty}</td></tr>}</tbody></table></div>
    <div className="cps-pg"><span>Total records: {rows.length}</span><span className="grow" />
      <select value={ps} onChange={e => { setPs(+e.target.value); setPg(0); }}>{[10, 20, 50].map(n => <option key={n}>{n}</option>)}</select> records
      <button onClick={() => setPg(0)} disabled={cur === 0}>|‹</button><button onClick={() => setPg(cur - 1)} disabled={cur === 0}>‹</button>
      <span className="pgn">{rows.length ? cur + 1 : 0}/{rows.length ? pages : 0}</span>
      <button onClick={() => setPg(cur + 1)} disabled={cur >= pages - 1}>›</button><button onClick={() => setPg(pages - 1)} disabled={cur >= pages - 1}>›|</button></div></div>;
}
const In = (p) => <input className="cps-in" {...p} />;
const Btn = ({ children, ...p }) => <button className="cps-btn" {...p}>{children}</button>;
const St = ({ v }) => <span className={'cps-st ' + String(v || '').toLowerCase()}>{v}</span>;

// ---------------- home ----------------
function Home({ open, openProfile }) {
  const [reqs] = useApi('/g2/requests', [], 8000);
  const [ops] = useApi('/g2/operations', [], 10000);
  return <div className="cps-home">
    <div className="cps-home-l">
      <Title t="Welcome" d="G2 simulator connected to SLA Sentinel AI through the integration adapter. Account creations requested by Sentinel arrive here automatically." />
      <div className="cps-quick">{[['TASKS', 'My Tasks', '📥'], ['SEARCH_MERCHANT', 'Organization (Merchant)', '🏪'], ['SEARCH_CUSTOMER', 'Customer', '👤'], ['TX', 'Transaction Search', '💱'], ['OPS', 'Operation Support', '🛠️'], ['HISTORY', 'Task History', '🗂️']].map(([k, l, ic]) => <button key={k} onClick={() => open({ id: k, kind: k, title: l })}><span>{ic}</span>{l}</button>)}</div>
    </div>
    <div className="cps-side">
      <div className="cps-panel"><div className="ph">Broadcast <span>⟳ – + ×</span></div><div className="pb">{(reqs || []).slice(0, 8).map(r => <div key={r.id} className="bc" onClick={() => r.response?.msisdn && openProfile(r.response.msisdn, r.payload?.fields?.trading_name)}>
        <b>{dt(r.created_at)}</b> — Sentinel request {r.case_ref}: {r.payload?.type?.toLowerCase()} {r.payload?.fields?.trading_name || ''} → <St v={r.status} /></div>)}{!(reqs || []).length && <div className="mut small">No broadcast.</div>}</div></div>
      <div className="cps-panel"><div className="ph">System message <span>– + ×</span></div><div className="pb">{(ops || []).slice(0, 6).map(o => <div key={o.id} className="bc">{dt(o.ts)} — {o.op.replace(/_/g, ' ')} on {fmt(o.msisdn)} by {o.operator}{!o.case_ref && ['SIM_SWAP', 'PIN_RESET', 'DELETE', 'SUSPEND'].includes(o.op) ? <b style={{ color: '#b00' }}> (no case ref)</b> : ''}</div>)}</div></div>
    </div>
  </div>;
}

// ---------------- tasks (Sentinel creation requests + operations) ----------------
function Tasks({ pending, openProfile }) {
  const [f, setF] = useState({ no: '%', from: daysAgo(7), to: today(), status: 'All' });
  const [q, setQ] = useState(f);
  const [reqs] = useApi('/g2/requests', [], 8000);
  const [ops] = useApi(`/g2/operations?from=${q.from}&to=${q.to}`, [q], 10000);
  const [sel, setSel] = useState(null);
  const rows = useMemo(() => {
    const a = (reqs || []).map(r => ({ no: 'T' + String(r.id).padStart(8, '0'), desc: `Create ${String(r.payload?.type || '').toLowerCase()} — ${r.payload?.fields?.trading_name || r.payload?.fields?.legal_name || ''}`, priority: 'Normal', created: r.created_at, completed: r.completed_at, initiator: 'Sentinel API', status: r.status === 'COMPLETED' ? 'Completed' : r.status === 'FAILED' ? 'Rejected' : 'Pending', result: r.response?.ok ? `Merchant ${r.response.merchant_id}` : r.response?.error || '', owner: 'G2 adapter', category: 'Account Creation', raw: r }));
    const b = (ops || []).filter(o => !(o.op === 'ACCOUNT_CREATED' && o.operator === 'Sentinel API')).map(o => ({ no: 'O' + String(o.id).padStart(8, '0'), desc: `${o.op.replace(/_/g, ' ')} — ${o.trading_name || o.name || fmt(o.msisdn)}`, priority: ['SIM_SWAP', 'DELETE'].includes(o.op) ? 'High' : 'Normal', created: o.ts, completed: o.ts, initiator: o.operator, status: 'Completed', result: o.detail, owner: o.case_ref || '—', category: 'Operation Support', msisdn: o.msisdn }));
    return [...a, ...b].filter(r => pending ? r.status === 'Pending' || r.status === 'Rejected' : r.status !== 'Pending')
      .filter(r => q.no === '%' || !q.no || r.no.includes(q.no.replace(/%/g, '')) || r.desc.toLowerCase().includes(q.no.replace(/%/g, '').toLowerCase()))
      .filter(r => q.status === 'All' || r.status === q.status)
      .filter(r => !q.from || String(r.created) >= q.from).filter(r => !q.to || String(r.created).slice(0, 10) <= q.to)
      .sort((x, y) => String(y.created).localeCompare(String(x.created)));
  }, [reqs, ops, q, pending]);
  return <div className="cps-page">
    <Title t={pending ? 'My Tasks' : 'Task History'} d={pending ? 'Tasks waiting for processing or that failed in G2.' : 'You can query historical records of canceled, completed, expired and rejected tasks.'} />
    <Bar t={pending ? 'Search for Task' : 'Search for History Task'} />
    <div className="cps-box"><Grid rows={[['Task No.', <In value={f.no} onChange={e => setF({ ...f, no: e.target.value })} />], ['Status', <select className="cps-in" value={f.status} onChange={e => setF({ ...f, status: e.target.value })}>{['All', 'Completed', 'Rejected', 'Pending'].map(s => <option key={s}>{s}</option>)}</select>],
      ['Creation Time', <div className="row" style={{ gap: 6 }}><In type="date" value={f.from} onChange={e => setF({ ...f, from: e.target.value })} /> ~ <In type="date" value={f.to} onChange={e => setF({ ...f, to: e.target.value })} /></div>], ['Sorting Query Results By', <select className="cps-in"><option>Create Time Latest</option></select>]]} />
      <div className="cps-actions"><Btn onClick={() => setQ(f)}>Search</Btn><Btn onClick={() => { const d = { no: '%', from: daysAgo(7), to: today(), status: 'All' }; setF(d); setQ(d); }}>Reset</Btn></div></div>
    <Table rows={rows} onRow={r => r.raw ? setSel(r.raw) : r.msisdn && openProfile(r.msisdn)} cols={[['no', 'Task No.'], ['desc', 'Description'], ['priority', 'Priority'], ['created', 'Creation Time', r => dt(r.created)], ['completed', 'Completion Time', r => dt(r.completed)], ['initiator', 'Initiator'], ['status', 'Status', r => <St v={r.status} />], ['result', 'Process Result'], ['owner', 'Owner'], ['category', 'Category'], ['op', 'Operation', r => <span className="cps-link">View</span>]]} />
    {sel && <div className="cps-modal-bg" onClick={() => setSel(null)}><div className="cps-modal" onClick={e => e.stopPropagation()}>
      <div className="mh">Task detail — {sel.case_ref}<button onClick={() => setSel(null)}>×</button></div>
      <div className="mb"><Grid rows={[['Received', dt(sel.created_at)], ['Account type', sel.payload?.type], ['Status', <St v={sel.status} />], ['Result', sel.response?.ok ? `Merchant no. ${sel.response.merchant_id} · Till ${sel.response.till_number} · SIM ${fmt(sel.response.merchant_sim || '')} · ${sel.response.g2_ref}` : sel.response?.error || '—']]} />
        <Bar t="Form fields received (generated by Sentinel from TOBi)" /><table className="kvt"><tbody>{Object.entries(sel.payload?.fields || {}).map(([k, v]) => <tr key={k}><td>{k.replace(/_/g, ' ')}</td><td><b>{String(v)}</b></td></tr>)}</tbody></table>
        <Bar t="Documents used" /><table className="kvt"><tbody>{(sel.documents || []).map(d => <tr key={d.id}><td>{d.doc_type}</td><td>{d.filename}</td><td>{d.expiry_date ? 'exp. ' + d.expiry_date : ''}</td><td><a className="cps-link" href={'/api/documents/' + d.id + '/file'} target="_blank">View</a></td></tr>)}</tbody></table>
        {sel.response?.msisdn && <div className="cps-actions"><Btn onClick={() => { openProfile(sel.response.msisdn, sel.payload?.fields?.trading_name); setSel(null); }}>Open profile</Btn></div>}</div></div></div>}
  </div>;
}

// ---------------- transaction search ----------------
function TxSearch({ openProfile }) {
  const [f, setF] = useState({ msisdn: '', ref: '', type: '', from: daysAgo(30), to: today() });
  const [q, setQ] = useState(null);
  const [rows] = useApi(q ? `/g2/transactions?msisdn=${encodeURIComponent(q.msisdn)}&ref=${encodeURIComponent(q.ref)}&type=${q.type}&from=${q.from}&to=${q.to}` : null, [q]);
  return <div className="cps-page"><Title t="Transaction Search" d="Query financial transactions by MSISDN, receipt number, type and period." />
    <Bar t="Search for Transaction" />
    <div className="cps-box"><Grid rows={[['MSISDN', <In value={f.msisdn} onChange={e => setF({ ...f, msisdn: e.target.value })} placeholder="243…" />], ['Receipt No.', <In value={f.ref} onChange={e => setF({ ...f, ref: e.target.value })} placeholder="TX…" />],
      ['Transaction Type', <select className="cps-in" value={f.type} onChange={e => setF({ ...f, type: e.target.value })}><option value="">All</option>{['PAYMENT_RECEIVED', 'CASH_IN', 'CASH_OUT', 'P2P_SEND', 'P2P_RECEIVE', 'FLOAT_TOPUP', 'BILL_PAY'].map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}</select>],
      ['Transaction Time', <div className="row" style={{ gap: 6 }}><In type="date" value={f.from} onChange={e => setF({ ...f, from: e.target.value })} /> ~ <In type="date" value={f.to} onChange={e => setF({ ...f, to: e.target.value })} /></div>]]} />
      <div className="cps-actions"><Btn onClick={() => setQ({ ...f })}>Search</Btn><Btn onClick={() => { setF({ msisdn: '', ref: '', type: '', from: daysAgo(30), to: today() }); setQ(null); }}>Reset</Btn></div></div>
    <Table rows={rows || []} empty={q ? 'No records found.' : 'Enter criteria and click Search.'} onRow={r => openProfile(r.msisdn, r.trading_name || r.name)}
      cols={[['tx_ref', 'Receipt No.'], ['ts', 'Completion Time', r => dt(r.ts)], ['msisdn', 'MSISDN', r => fmt(r.msisdn)], ['name', 'Account', r => r.trading_name || r.name], ['type', 'Type', r => r.type.replace(/_/g, ' ')], ['amount', 'Amount (USD)', r => Number(r.amount).toFixed(2)], ['counterparty', 'Opposite Party'], ['balance_after', 'Balance', r => Number(r.balance_after).toFixed(2)], ['st', 'Status', () => <St v="Completed" />]]} />
  </div>;
}

// ---------------- account search ----------------
function AccSearch({ type, openProfile }) {
  const [f, setF] = useState({ q: '' }); const [q, setQ] = useState(type === 'MERCHANT' ? '' : null);
  const [rows] = useApi(q != null ? `/g2/search?type=${type}&q=${encodeURIComponent(q)}` : null, [q]);
  const label = TYPE_LABEL[type];
  return <div className="cps-page"><Title t={`Search ${label}`} d={`Find a ${label.toLowerCase()} by MSISDN, ${type === 'CUSTOMER' ? 'name or ID' : 'short code, till number, merchant number or name'}.`} />
    <Bar t={`Search for ${label}`} />
    <div className="cps-box"><Grid rows={[['Identifier', <select className="cps-in"><option>MSISDN / Short Code / Till / Name</option></select>], ['Value', <In value={f.q} onChange={e => setF({ q: e.target.value })} onKeyDown={e => e.key === 'Enter' && setQ(f.q)} />]]} />
      <div className="cps-actions"><Btn onClick={() => setQ(f.q)}>Search</Btn><Btn onClick={() => { setF({ q: '' }); setQ(type === 'MERCHANT' ? '' : null); }}>Reset</Btn></div></div>
    <Table rows={rows || []} empty={q != null ? 'No records found.' : 'Enter a value and click Search.'} onRow={r => openProfile(r.msisdn, r.trading_name || r.name)}
      cols={[['msisdn', 'MSISDN', r => fmt(r.msisdn)], ['name', type === 'CUSTOMER' ? 'Customer Name' : 'Organization Name', r => r.trading_name || r.name], ...(type !== 'CUSTOMER' ? [['merchant_id', type === 'AGENT' ? 'Agent ID' : 'Merchant No.'], ['short_code', 'Short Code'], ['till_number', 'Till']] : [['owner', 'Owner']]), ['region', 'Region'], ['status', 'Status', r => <St v={r.status} />], ['created_at', 'Created', r => dt(r.created_at)], ['op', 'Operation', () => <span className="cps-link">View</span>]]} />
  </div>;
}

// ---------------- operation support (quick MSISDN lookup) ----------------
function OpsSupport({ openProfile }) {
  const [v, setV] = useState(''); const toast = useToast();
  const go = async () => { try { const r = await api('/g2/search?q=' + encodeURIComponent(v)); if (!r.length) return toast('No account found', true); openProfile(r[0].msisdn, r[0].trading_name || r[0].name); } catch (e) { toast(e.message, true); } };
  return <div className="cps-page"><Title t="Operation Support" d="SIM swap, PIN reset, freeze / unfreeze, float top-up and account closure. Sensitive operations require a case or ticket reference (maker-checker)." />
    <Bar t="Identify the account" /><div className="cps-box"><Grid rows={[['MSISDN / Short Code / Till', <In value={v} onChange={e => setV(e.target.value)} onKeyDown={e => e.key === 'Enter' && go()} placeholder="243812345678" />]]} /><div className="cps-actions"><Btn onClick={go}>Open</Btn></div></div></div>;
}

// ---------------- bulk (simulated) ----------------
function Bulk() {
  const [side, setSide] = useState('Create Bulk Task Plan');
  const [accs] = useApi('/g2/accounts');
  const plans = useMemo(() => (accs || []).filter(a => a.account_type !== 'CUSTOMER').slice(0, 12).map((a, i) => ({ id: 817792 - i * 2, type: i % 4 === 3 ? 'Bulk Disbursement' : 'Bulk Payment', name: `${String(a.trading_name || a.name).toUpperCase().slice(0, 14)} ${['SALAIRES', 'FOURNISS.', 'REGUL', 'PRIMES'][i % 4]}`, tpl: 'BULK_PAYMENT_V2.xlsx', sched: i % 3 === 1 ? new Date(Date.now() + 864e5).toISOString() : '', status: i % 5 === 0 ? 'Completed' : 'Wait Active' })), [accs]);
  return <div className="cps-bulk">
    <div className="cps-sidenav"><div className="col-h">«</div>{['Create Bulk Task Plan', 'Bulk Task Plan History', 'Bulk Type and Service Mapping', 'Bulk Task Template Download', 'Bulk Type Configuration'].map(s => <button key={s} className={side === s ? 'on' : ''} onClick={() => setSide(s)}>{s}{side === s && <span>›</span>}</button>)}</div>
    <div className="cps-page grow"><Title t={side} d="You can create bulk task plans and view plan status and plan execution information. (Simulated in this prototype.)" />
      <Bar t="Search for Bulk Task Plan" /><div className="cps-box"><Grid rows={[['Plan Name', <In />], ['Bulk Type', <select className="cps-in"><option>All</option><option>Bulk Payment</option><option>Bulk Disbursement</option></select>], ['Created By', <In />], ['Approved By', <In />]]} /><div className="cps-actions"><Btn>Search</Btn><Btn>Reset</Btn></div></div>
      <div className="cps-toolbar"><button>＋ Add</button><button>▶ Resume</button><button>⏸ Suspend</button><button>⟳ Refresh</button></div>
      <Table rows={plans} cols={[['id', 'Bulk Plan ID'], ['type', 'Bulk Type'], ['name', 'Plan Name'], ['tpl', 'File Template'], ['sched', 'Schedule Time', r => dt(r.sched)], ['status', 'Status', r => <St v={r.status} />], ['op', 'Operation', () => <span className="cps-link">🔍</span>]]} />
    </div></div>;
}

// ---------------- profile ----------------
function Profile({ me, msisdn }) {
  const [acc, setAcc] = useState(null), [tab, setTab] = useState('BASIC'), [caseRef, setCaseRef] = useState(''), [confirmOp, setConfirmOp] = useState(null);
  const toast = useToast();
  const load = async () => { try { setAcc(await api('/g2/accounts/' + msisdn)); } catch (e) { toast(e.message, true); } };
  useEffect(() => { load(); }, [msisdn]);
  if (!acc) return <div className="cps-page"><div className="spin" /></div>;
  const a = acc.account, k = a.kyc || {};
  const doOp = async (o) => { try { await api(`/g2/accounts/${a.msisdn}/op`, { op: o, case_ref: caseRef || null, amount: 500 }); toast(`${o.replace('_', ' ')} executed${caseRef ? '' : ' — no case reference: control exception raised to Internal Control'}`); setConfirmOp(null); load(); } catch (e) { toast(e.message, true); setConfirmOp(null); } };
  const TABS = [['BASIC', 'Basic Information'], ['KYC', 'KYC & Documents'], ['TX', 'Transactions'], ['OPS', 'Operation Log']];
  return <div className="cps-page">
    <Title t={`${TYPE_LABEL[a.account_type] || a.account_type} Profile`} d={`${a.trading_name || a.name} · ${fmt(a.msisdn)}`} />
    <div className="cps-subtabs">{TABS.map(([kk, l]) => <button key={kk} className={tab === kk ? 'on' : ''} onClick={() => setTab(kk)}>{l}</button>)}</div>
    {tab === 'BASIC' && <><Bar t="Account" /><div className="cps-box"><div className="cps-2col">
      <Grid rows={[['MSISDN', fmt(a.msisdn)], ['Account Name', a.name], ['Trading Name', a.trading_name || '—'], [a.account_type === 'AGENT' ? 'Agent ID' : 'Merchant No.', k.merchant_id || '—'], ['Short Code', a.short_code || '—'], ['Till Number', a.till_number || '—'], ['Contract', a.contract_type || '—'], ['Status', <St v={a.status} />]]} />
      <Grid rows={[['Balance', <b className="ok">{Number(a.balance).toFixed(2)} {a.currency}</b>], ...(a.account_type === 'AGENT' ? [['Float', Number(a.float_balance).toFixed(2) + ' USD']] : []), ['SIM ICCID', a.sim_iccid], ['Merchant SIM', k.merchant_sim ? fmt(k.merchant_sim) : '—'], ['PIN Status', a.pin_status], ['G2 Reference', a.g2_ref], ['Sentinel Case', a.case_ref ? <a className="cps-link" href={'/case/' + a.case_ref} onClick={e => { e.preventDefault(); nav('/case/' + a.case_ref); }}>{a.case_ref}</a> : '—'], ['Created', dt(a.created_at)], ['Txn (30d)', `${acc.summary.count} · in ${acc.summary.inflow} USD`]]} />
    </div></div>
      <Bar t="Operations" /><div className="cps-box"><div className="row wrap" style={{ gap: 8 }}><span>Case / ticket ref:</span><In value={caseRef} onChange={e => setCaseRef(e.target.value)} placeholder="MP-SWP-2026-…" style={{ width: 200 }} />
        {OPS.map(([o, l]) => <Btn key={o} disabled={!me.perms.includes(o === 'DELETE' ? 'g2.delete' : 'g2.operate') || a.status === 'DELETED'} onClick={() => setConfirmOp(o)}>{l}</Btn>)}</div>
        {!me.perms.includes('g2.operate') && <div className="cps-d" style={{ marginTop: 6 }}>Read-only profile ({me.roleName}).</div>}</div></>}
    {tab === 'KYC' && <><Bar t="KYC" /><div className="cps-box"><Grid rows={[['Owner', k.owner_name || '—'], ['ID Document', `${k.id_type || ''} ${k.id_number || '—'} ${k.id_expiry ? '(exp. ' + k.id_expiry + ')' : ''}`], ['RCCM / ID NAT', `${k.rccm || '—'} / ${k.id_nat || '—'}`], ['Address', `${k.address || '—'}, ${k.commune || ''} ${k.city || ''}`], ['Activity', k.business_activity || '—'], ['PEP / Sanctions', `${k.pep || 'No'} / ${k.sanctions || 'No'}`], ['E-mail', k.email || '—']]} /></div>
      <Bar t="ID uploads" /><Table rows={acc.documents} cols={[['doc_type', 'Type'], ['filename', 'File'], ['expiry_date', 'Expiry'], ['uploaded_at', 'Uploaded', r => dt(r.uploaded_at)], ['v', 'Operation', r => <a className="cps-link" href={'/api/documents/' + r.id + '/file'} target="_blank" onClick={e => e.stopPropagation()}>View</a>]]} /></>}
    {tab === 'TX' && <Table rows={acc.transactions} cols={[['tx_ref', 'Receipt No.'], ['ts', 'Completion Time', r => dt(r.ts)], ['type', 'Type', r => r.type.replace(/_/g, ' ')], ['amount', 'Amount', r => Number(r.amount).toFixed(2)], ['counterparty', 'Opposite Party'], ['balance_after', 'Balance', r => Number(r.balance_after).toFixed(2)]]} />}
    {tab === 'OPS' && <Table rows={acc.operations} cols={[['ts', 'Time', r => dt(r.ts)], ['op', 'Operation', r => r.op.replace(/_/g, ' ')], ['operator', 'Operator'], ['case_ref', 'Case Ref', r => r.case_ref || <b style={{ color: '#b00' }}>none</b>], ['detail', 'Detail']]} />}
    {confirmOp && <div className="cps-modal-bg" onClick={() => setConfirmOp(null)}><div className="cps-modal sm" onClick={e => e.stopPropagation()}><div className="mh">Confirm<button onClick={() => setConfirmOp(null)}>×</button></div>
      <div className="mb">Execute <b>{OPS.find(x => x[0] === confirmOp)[1]}</b> on {fmt(a.msisdn)} ({a.trading_name || a.name})?{!caseRef && ['SIM_SWAP', 'PIN_RESET', 'DELETE', 'SUSPEND'].includes(confirmOp) && <div className="cps-err" style={{ marginTop: 8 }}>No case / ticket reference — Sentinel will raise a control exception.</div>}
        <div className="cps-actions"><Btn onClick={() => doOp(confirmOp)}>OK</Btn><Btn onClick={() => setConfirmOp(null)}>Cancel</Btn></div></div></div></div>}
  </div>;
}
