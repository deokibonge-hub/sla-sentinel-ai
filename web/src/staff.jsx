import React, { useEffect, useState } from 'react';
import { api, nav, Link, useApi, useSearch, Pill, Dot, Why, Modal, Logo, Spark, fmtTime, ago, dur, DEPT_NAMES, DEPT_ICON, useToast } from './lib.jsx';

// ---------------- Shell ----------------
export function Shell({ me, path, children, onLogout }) {
  const [cfg] = useApi('/config', [path], 15000);
  const off = cfg?.demo_offset_days || 0;
  const items = [['/', '📊', 'Command Center'], ['/work', '🗂️', 'My Work'], ['/cases?open=1', '📁', 'Cases'], ['/g2', '🖥️', 'G2 System'], ['/audit', '🧾', 'Audit Trail'], ['/policies', '⚙️', 'Policy Engine']];
  if (me.perms.includes('demo.control')) items.push(['/demo', '⏱️', 'Demo Control']);
  return <div className="shell">
    <aside className="side">
      <div className="brand"><Logo /><div><div className="t1">SLA SENTINEL <span>AI</span></div><div className="t2">Seamless Lifecycle Assistance</div></div></div>
      {items.map(([to, ic, l]) => <Link key={to} to={to} className={'nav' + ((to === '/' ? path === '/' : path.startsWith(to.split('?')[0]) && !(to.startsWith('/cases') && path.startsWith('/case/'))) ? ' on' : '')}>{ic} {l}</Link>)}
      <div className="sep" />
      <a className="nav" href="/tobi" target="_blank">💬 Open TOBi (customer)</a>
      <Link className="nav" to="/qr">▦ QR code for TOBi</Link>
      <div className="who"><div className="b" style={{ color: '#fff' }}>{me.name}</div><div>{me.roleName}</div><button className="btn sm" style={{ marginTop: 8, width: '100%', justifyContent: 'center' }} onClick={onLogout}>Log out</button></div>
    </aside>
    <main className="main">
      <div className="topbar">
        <div className="grow b">{DEPT_NAMES[me.dept] || 'Administration'} workspace</div>
        {off > 0 && <span className="badge-ai timewarp">⏱ Demo time +{off} days</span>}
        <span className={'badge-ai' + (cfg?.ai ? ' on' : '')}>{cfg?.ai ? '● AI MODE' : '● DEMO MODE (rules)'}</span>
        <span className="clock">Sentinel time <b>{cfg ? fmtTime(cfg.clock) : '…'}</b></span>
      </div>
      <div className="content">{children}</div>
    </main>
  </div>;
}

// ---------------- Login ----------------
export function Login({ onLogin }) {
  const [users] = useApi('/users/demo');
  const [u, setU] = useState(''), [p, setP] = useState(''), [err, setErr] = useState('');
  const go = async (username, password) => { try { const r = await api('/login', { username, password }); onLogin(r.user); } catch (e) { setErr(e.message); } };
  return <div className="login">
    <div className="l"><div className="row"><Logo size={56} /><div><div style={{ fontSize: 30, fontWeight: 900 }}>SLA SENTINEL <span style={{ color: 'var(--red)' }}>AI</span></div><div style={{ color: '#00c45a', fontWeight: 600 }}>Seamless Lifecycle Assistance</div></div></div>
      <div style={{ fontSize: 34, fontWeight: 800, lineHeight: 1.15, maxWidth: 560 }}>From reactive servicing to proactive lifecycle management.</div>
      <div style={{ color: '#c5c9d1', maxWidth: 520 }}>One case. Multiple layers of intelligence — Operations, AML/CFT, Compliance, Risk, Internal Control, Legal and Audit on the same live data. Prototype for M-Pesa DRC.</div>
      <div className="row wrap"><a className="btn primary" href="/tobi">💬 Open TOBi — customer onboarding</a><a className="btn" href="/scan">▦ QR code to try it on your phone</a></div></div>
    <div className="r">
      <h1>Employee sign-in</h1>
      <form className="col" onSubmit={e => { e.preventDefault(); go(u, p); }}><input className="input" autoCapitalize="none" autoCorrect="off" autoComplete="username" placeholder="Username (e.g. admin)" value={u} onChange={e => setU(e.target.value)} /><input className="input" type="password" autoComplete="current-password" placeholder="Password (demo123)" value={p} onChange={e => setP(e.target.value)} onKeyDown={e => e.key === 'Enter' && go(u, p)} />
        {err && <div style={{ color: 'var(--red)' }}>{err}</div>}<button type="submit" className="btn primary">Sign in</button></form>
      <div className="kicker" style={{ marginTop: 10 }}>Demo accounts — password demo123</div>
      <div className="roles">{(users || []).map(x => <button key={x.username} className="role" onClick={() => go(x.username, 'demo123')}><div className="b">{x.roleName}</div><div className="small mut">{x.name} · <span className="mono">{x.username}</span></div></button>)}</div>
    </div>
  </div>;
}

// ---------------- Alert drawer ----------------
export function AlertDrawer({ id, me, onClose, onChanged }) {
  const [a, load] = useApi('/alerts/' + id, [id]);
  const toast = useToast();
  const act = async (action, extra = {}) => { try { const r = await api(`/alerts/${id}/action`, { action, ...extra }); toast(action === 'INITIATE_REMEDIATION' ? `Remediation case ${r.case_ref} created` : 'Done ✓'); load(); onChanged?.(); } catch (e) { toast(e.message, true); } };
  if (!a) return null;
  const mine = me.dept === a.dept || me.role === 'ADMIN';
  return <div className="drawer-bg" onClick={onClose}><div className="drawer" onClick={e => e.stopPropagation()}>
    <div className="dh"><div className="row"><span className="kicker">{DEPT_ICON[a.dept]} {DEPT_NAMES[a.dept]} · {a.type.replace(/_/g, ' ')}</span><span className="grow" /><button className="btn ghost sm" onClick={onClose}>✕</button></div>
      <h2 style={{ marginTop: 8 }}>{a.title}</h2><div className="row" style={{ marginTop: 8 }}><Pill v={a.severity} /><Pill v={a.status} /><span className="small mut">{ago(a.created_at)}</span></div></div>
    <div className="db">
      <div>{a.detail}</div>
      <div><div className="kicker" style={{ marginBottom: 8 }}>Why? — explainable risk drivers</div><Why factors={a.why} /></div>
      {a.recommendation && <div className="reco"><div className="kicker">Sentinel recommendation</div><div className="b" style={{ marginTop: 4 }}>{a.recommendation}</div></div>}
      {a.case_ref && <div className="row"><span className="mut">Case</span><Link to={'/case/' + a.case_ref} className="b">{a.case_ref} →</Link></div>}
      {a.account && <div className="card pad" style={{ boxShadow: 'none' }}><div className="kicker">Account (G2)</div><div className="b" style={{ marginTop: 4 }}>{a.account.trading_name || a.account.name}</div><div className="small mut">{a.account.account_type} · +{a.account.msisdn} · {a.account.status} · balance {a.account.balance} USD</div><Link to={'/g2?q=' + a.account.msisdn} className="small">Open in G2 →</Link></div>}
      {a.status !== 'RESOLVED' && <div className="row wrap">
        {mine && me.perms.includes('alert.act') && <><button className="btn" onClick={() => act('ACK')}>Acknowledge</button><button className="btn green" onClick={() => act('RESOLVE')}>Resolve</button><button className="btn" onClick={() => act('ESCALATE', { to: a.dept === 'AML' ? 'RISK' : 'AML', note: 'Escalated from dashboard' })}>Escalate</button></>}
        {mine && me.perms.includes('remediation.initiate') && <button className="btn primary" onClick={() => act('INITIATE_REMEDIATION')}>Initiate remediation</button>}
        {me.perms.includes('audit.flag') && <button className="btn dark" onClick={() => act('FLAG', { note: 'Flagged for assurance testing' })}>🏳 Audit flag</button>}
        {!mine && !me.perms.includes('audit.flag') && <div className="small mut">Read-only: only {DEPT_NAMES[a.dept]} can act on this alert.</div>}
      </div>}
      {a.history?.length > 0 && <div><div className="kicker" style={{ marginBottom: 8 }}>Related activity</div>{a.history.map(h => <div key={h.id} className="small" style={{ padding: '5px 0', borderBottom: '1px solid #f2f3f5' }}><span className="mut">{fmtTime(h.ts)}</span> · <b>{h.actor}</b> — {h.action} {h.new_state && <span className="mut">· {h.new_state}</span>}</div>)}</div>}
    </div>
  </div></div>;
}

// ---------------- Command Center ----------------
const SEV_ORDER = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
export function Command({ me }) {
  const [sel, setSel] = useState(null), [dept, setDept] = useState(null), [q, setQ] = useState(''), [showAll, setShowAll] = useState(false);
  const [d, load] = useApi('/dashboard' + (dept ? '?dept=' + dept : ''), [dept], 8000);
  const [found] = useApi(q.trim().length >= 2 ? '/cases?q=' + encodeURIComponent(q.trim()) : null, [q]);
  if (!d) return <div className="spin" />;
  const k = d.kpis;
  const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
  const attention = (dept ? d.alerts[dept] : Object.values(d.alerts).flat()).slice().sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || b.id - a.id);
  const shown = showAll ? attention : attention.slice(0, 7);
  const dq = dept ? '&dept=' + dept : '';
  const tiles = [
    { l: 'Active cases', v: k.active_cases, s: `${k.total_cases} in total`, to: '/cases?open=1' + dq },
    { l: 'SLA on track', v: pct(k.on_track, k.active_cases) + '%', s: `${k.on_track} of ${k.active_cases} active`, c: 'good', to: '/cases?open=1&sla=ON_TRACK' + dq },
    { l: 'Needs attention', v: k.at_risk, s: 'at risk of breaching', c: k.at_risk ? 'warn' : '', to: '/cases?open=1&sla=AT_RISK,CRITICAL&sort=sla' + dq },
    { l: 'SLA breached', v: k.breached, s: 'escalated to managers', c: k.breached ? 'bad' : 'good', to: '/cases?open=1&sla=BREACHED&sort=sla' + dq },
    { l: 'Automated', v: pct(k.auto_processed, k.resolved) + '%', s: `${k.auto_processed} straight-through`, c: 'good', to: '/cases?auto=1' + dq },
    { l: 'Non-compliance prevented', v: k.noncompliance_prevented, s: 'renewals before expiry', c: 'good', to: '/cases?type=DOCUMENT_RENEWAL&status=RESOLVED' },
  ];
  return <>
    <div className="cc-head">
      <div className="grow"><div className="kicker">Sentinel Command Center</div><h1>{dept ? DEPT_NAMES[dept] : 'All departments'}</h1></div>
      <div className="cc-search"><input className="input" placeholder="Search case ID, title or requester…" value={q} onChange={e => setQ(e.target.value)} />
        {q.trim().length >= 2 && found && <div className="card search-res">{found.slice(0, 8).map(c => <div key={c.ref} className="alert-row" onClick={() => nav('/case/' + c.ref)}><div className="grow"><div className="tt mono">{c.ref}</div><div className="dd">{c.customer_name} · {(c.service || c.type).replace(/_/g, ' ').toLowerCase()} · {c.status.replace(/_/g, ' ').toLowerCase()}</div></div><Pill v={c.sla_status} /></div>)}{!found.length && <div className="pad small mut">No case found</div>}</div>}</div>
    </div>
    <div className="seg">
      <button className={!dept ? 'on' : ''} onClick={() => setDept(null)}>All</button>
      {d.dept_summary.map(x => <button key={x.dept} className={dept === x.dept ? 'on' : ''} onClick={() => setDept(x.dept)}>{DEPT_NAMES[x.dept]}{x.urgent > 0 && <span className="cnt">{x.urgent}</span>}</button>)}
    </div>
    <div className="tiles">{tiles.map(t => <Link key={t.l} to={t.to} className={'card tile click ' + (t.c || '')} title="Open the matching cases"><div className="l">{t.l}</div><div className="v">{t.v}</div><div className="s">{t.s}</div><div className="go">View cases →</div></Link>)}</div>
    <div className="cc-grid">
      <div className="card">
        <div className="cc-sec"><h3 className="grow">Needs attention</h3><span className="small mut">{attention.length} open alert{attention.length !== 1 ? 's' : ''}{dept ? '' : ' across departments'}</span><Link className="btn sm" to={'/cases?open=1&sort=sla' + dq}>All open cases →</Link></div>
        {shown.map(a => <div key={a.id} className="att-row" onClick={() => setSel(a.id)}>
          <span className={'sev ' + a.severity}>{a.severity === 'CRITICAL' ? 'Critical' : a.severity === 'HIGH' ? 'High' : a.severity === 'MEDIUM' ? 'Medium' : 'Low'}</span>
          <div className="grow"><div className="tt">{a.title}</div><div className="dd">{!dept && <b>{DEPT_NAMES[a.dept]}</b>}{!dept && ' · '}{a.detail}</div></div>
          <span className="tiny mut nowrap">{ago(a.created_at, new Date(d.clock))}</span></div>)}
        {!attention.length && <div className="pad small mut">Nothing needs attention ✓</div>}
        {attention.length > 7 && <button className="btn ghost sm cc-more" onClick={() => setShowAll(v => !v)}>{showAll ? 'Show less' : `Show all ${attention.length}`}</button>}
      </div>
      <div className="col" style={{ gap: 14 }}>
        <div className="card"><div className="cc-sec"><h3>Departments</h3></div>
          {d.dept_summary.map(x => <div key={x.dept} className={'dep-row' + (dept === x.dept ? ' on' : '')} onClick={() => setDept(dept === x.dept ? null : x.dept)}>
            <span className="ic">{DEPT_ICON[x.dept]}</span><div className="grow"><div className="b small">{DEPT_NAMES[x.dept]}</div><div className="tiny mut">{x.cases ? `${x.cases} open case${x.cases > 1 ? 's' : ''} · ` : ''}{x.alerts} alert{x.alerts !== 1 ? 's' : ''}</div></div>
            {x.cases > 0 && <div className="mini" title="SLA on track"><i style={{ width: pct(x.on_track, x.cases) + '%' }} /></div>}
            {x.urgent > 0 ? <span className="cnt">{x.urgent}</span> : <span className="ok">✓</span>}
            <Link className="dep-go" to={'/cases?open=1&dept=' + x.dept} onClick={e => e.stopPropagation()} title={'Open ' + DEPT_NAMES[x.dept] + ' cases'}>Cases →</Link></div>)}
        </div>
        <div className="card pad"><h3>Live activity</h3><div style={{ marginTop: 8, maxHeight: 180, overflow: 'auto' }}>{d.recent.slice(0, 10).map(e => <div key={e.id} className="small" style={{ padding: '5px 0', borderBottom: '1px solid #f2f3f5' }}><b>{e.actor}</b> — {e.action}{e.case_ref && <> · <Link to={'/case/' + e.case_ref}>{e.case_ref}</Link></>}</div>)}</div></div>
      </div>
    </div>
    <div className="card pad"><div className="row"><h3 className="grow">Cases & alerts — last 14 days</h3><Link className="btn sm" to="/cases?open=0">Closed cases →</Link><span className="tiny"><span style={{ color: '#3a3d45' }}>━</span> created <span style={{ color: '#0a9d58' }}>━</span> resolved <span style={{ color: '#d98300' }}>━</span> alerts</span></div><Spark data={d.trend} keys={['created', 'resolved', 'alerts']} colors={['#3a3d45', '#0a9d58', '#d98300']} /></div>
    {sel && <AlertDrawer id={sel} me={me} onClose={() => setSel(null)} onChanged={load} />}
  </>;
}

// ---------------- Workbench ----------------
export function Workbench({ me }) {
  const [d, load] = useApi('/workbench', [], 8000);
  const [sel, setSel] = useState(null);
  if (!d) return <div className="spin" />;
  const sla = (s) => d.cases.filter(c => c.sla_status === s).length;
  return <>
    <div><div className="kicker">Employee workbench · {me.roleName}</div><h1>My work</h1></div>
    <div className="kpis">{[['My cases', d.cases.length], ['On track', sla('ON_TRACK'), 'green'], ['At risk', sla('AT_RISK') + sla('CRITICAL'), 'amber'], ['Breached', sla('BREACHED'), 'red'], ['My alerts', d.alerts.length, 'red'], ['My decisions', d.decisions.length]].map(([l, v, c]) => <div key={l} className={'card kpi ' + (c || '')}><div className="l">{l}</div><div className="v">{v}</div></div>)}</div>
    <div className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
      <div className="card grow" style={{ overflow: 'auto', maxHeight: 620 }}><div className="pad" style={{ paddingBottom: 8 }}><h3>My queue — prioritised by SLA risk</h3></div>
        <table className="t"><thead><tr><th>Case</th><th>Customer</th><th>Status</th><th>Risk</th><th>SLA</th><th>Breach prob.</th></tr></thead><tbody>
          {d.cases.map(c => <tr key={c.id} className="click" onClick={() => nav('/case/' + c.ref)}><td><div className="b mono">{c.ref}</div><div className="tiny mut">{c.type.replace(/_/g, ' ')}</div></td><td>{c.customer_name}</td><td><Pill v={c.status} /></td><td><Pill v={c.risk_level} /></td><td><Pill v={c.sla_status} /><div className="tiny mut mono">{c.sla ? dur(c.sla.remaining_ms) : ''}</div></td><td><b>{c.sla?.breach_probability ?? '—'}%</b></td></tr>)}
          {!d.cases.length && <tr><td colSpan="6" className="mut">Queue empty ✓</td></tr>}</tbody></table></div>
      <div className="card" style={{ width: 400, maxHeight: 620, overflow: 'auto' }}><div className="pad" style={{ paddingBottom: 6 }}><h3>My alerts</h3></div>
        {d.alerts.map(a => <div key={a.id} className="alert-row" onClick={() => setSel(a.id)}><Dot s={a.severity} /><div className="grow"><div className="tt">{a.title}</div><div className="dd">{DEPT_NAMES[a.dept]} · {ago(a.created_at)}</div></div></div>)}</div>
    </div>
    {sel && <AlertDrawer id={sel} me={me} onClose={() => setSel(null)} onChanged={load} />}
  </>;
}

// ---------------- Cases list (filterable, driven by the URL) ----------------
const TYPE_NAMES = { MERCHANT_ONBOARDING: 'Merchant onboarding', AGENT_ONBOARDING: 'Agent onboarding', KYC_UPDATE: 'KYC update', DOCUMENT_RENEWAL: 'Document renewal', AML_REVIEW: 'AML/CFT review', CONTRACT_REVIEW: 'Contract review', SIM_SWAP: 'SIM swap', SUPPORT: 'Support', REMEDIATION: 'Remediation', SIM_CREATION: 'SIM creation', PIN_RESET: 'PIN reset', CASH_OUT_REVERSAL: 'Cash-out reversal', CASH_IN_REVERSAL: 'Cash-in reversal', PARTNER_ONBOARDING: 'Partner onboarding', MERCHANT_CREATION: 'Merchant account creation' };
export const typeName = (c) => TYPE_NAMES[c.service] || TYPE_NAMES[c.type] || String(c.service || c.type || '').replace(/_/g, ' ').toLowerCase();
const SLA_OPTS = [['ON_TRACK', 'On track'], ['AT_RISK', 'At risk'], ['CRITICAL', 'Critical'], ['BREACHED', 'Breached'], ['MET', 'Met']];
const STATUS_OPTS = ['PENDING_REVIEW', 'AWAITING_CUSTOMER', 'UNDER_REVIEW', 'EDD_REQUESTED', 'G2_FAILED', 'CREATING', 'RESOLVED', 'REJECTED'];
export function Cases() {
  const search = useSearch();
  const sp = new URLSearchParams(search);
  const get = (k) => sp.get(k) || '';
  const set = (k, v) => { const n = new URLSearchParams(window.location.search); if (v === '' || v == null) n.delete(k); else n.set(k, v); const qs = n.toString(); window.history.replaceState({}, '', '/cases' + (qs ? '?' + qs : '')); window.dispatchEvent(new Event('popstate')); };
  const toggleIn = (k, v) => { const cur = get(k).split(',').filter(Boolean); set(k, (cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v]).join(',')); };
  const [q, setQ] = useState(get('q'));
  useEffect(() => { const t = setTimeout(() => { if (q !== get('q')) set('q', q); }, 300); return () => clearTimeout(t); }, [q]);
  const [d] = useApi('/cases' + (search || ''), [search], 15000);
  const open = get('open'), sla = get('sla').split(',').filter(Boolean), types = get('type'), deptF = get('dept'), risk = get('risk'), status = get('status'), auto = get('auto') === '1';
  const title = [auto ? 'Automated (straight-through)' : '', sla.length ? 'SLA ' + sla.map(x => SLA_OPTS.find(o => o[0] === x)?.[1] || x).join(' / ') : '', deptF ? DEPT_NAMES[deptF] : '', types ? types.split(',').map(t => TYPE_NAMES[t] || t).join(', ') : '', status ? status.split(',').map(x => x.replace(/_/g, ' ').toLowerCase()).join(', ') : '', risk ? risk.toLowerCase() + ' risk' : ''].filter(Boolean).join(' · ');
  const any = [...sp.keys()].some(k => !['sort'].includes(k));
  return <>
    <div className="row wrap"><div className="grow"><div className="kicker">Case management engine</div><h1>{open === '1' ? 'Open cases' : open === '0' ? 'Closed cases' : 'All cases'}{title && <span className="h1sub"> — {title}</span>}</h1><div className="small mut">{d ? `${d.length} case${d.length !== 1 ? 's' : ''}` : 'Loading…'}{any && <> · <a href="/cases" onClick={e => { e.preventDefault(); setQ(''); window.history.replaceState({}, '', '/cases'); window.dispatchEvent(new Event('popstate')); }}>clear filters</a></>}</div></div>
      <input className="input" style={{ width: 300 }} placeholder="Search ref, customer, MSISDN…" value={q} onChange={e => setQ(e.target.value)} /></div>
    <div className="card pad filters">
      <div className="fgroup"><span className="flabel">Status</span>{[['1', 'Open'], ['0', 'Closed'], ['', 'All']].map(([v, l]) => <button key={l} className={'chip' + (open === v ? ' on' : '')} onClick={() => set('open', v)}>{l}</button>)}</div>
      <div className="fgroup"><span className="flabel">SLA</span>{SLA_OPTS.map(([v, l]) => <button key={v} className={'chip sla-' + v + (sla.includes(v) ? ' on' : '')} onClick={() => toggleIn('sla', v)}>{l}</button>)}</div>
      <div className="fgroup"><span className="flabel">Filters</span>
        <select className="input sel" value={deptF} onChange={e => set('dept', e.target.value)}><option value="">All departments</option>{Object.entries(DEPT_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select className="input sel" value={types} onChange={e => set('type', e.target.value)}><option value="">All case types</option>{Object.entries(TYPE_NAMES).slice(0, 8).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select className="input sel" value={status} onChange={e => set('status', e.target.value)}><option value="">Any workflow status</option>{STATUS_OPTS.map(x => <option key={x} value={x}>{x.replace(/_/g, ' ').toLowerCase()}</option>)}</select>
        <select className="input sel" value={risk} onChange={e => set('risk', e.target.value)}><option value="">Any risk</option>{['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map(x => <option key={x} value={x}>{x.toLowerCase()}</option>)}</select>
        <button className={'chip' + (auto ? ' on' : '')} onClick={() => set('auto', auto ? '' : '1')}>⚡ Automated only</button>
        <select className="input sel" value={get('sort')} onChange={e => set('sort', e.target.value)}><option value="">Newest first</option><option value="sla">Most urgent SLA</option><option value="risk">Highest risk</option></select></div>
    </div>
    <div className="card" style={{ overflow: 'auto' }}><table className="t"><thead><tr><th>Case</th><th>Type</th><th>Customer</th><th>Owner</th><th>Status</th><th>Risk</th><th>SLA</th><th>Case file</th><th>Waiting for</th><th>Created</th></tr></thead><tbody>
      {(d || []).map(c => <tr key={c.id} className="click" onClick={() => nav('/case/' + c.ref)}><td className="b mono">{c.ref}</td><td className="small">{typeName(c)}</td><td><div className="b small">{c.customer_name}</div><div className="tiny mut mono">{c.account_msisdn ? '+' + c.account_msisdn : ''}</div></td><td className="small">{DEPT_NAMES[c.owner_dept]}</td><td><Pill v={c.status} /></td><td><Pill v={c.risk_level}>{c.risk_score} {c.risk_level}</Pill></td><td><Pill v={c.sla_status} />{c.sla && !c.resolved_at && <div className="tiny mut mono">{dur(c.sla.remaining_ms)}</div>}</td><td className="small">{c.docs ? `📎 ${c.docs} doc${c.docs > 1 ? 's' : ''}` : <span className="mut">—</span>}</td><td className="small" title={c.waiting ? c.waiting.why + ' — Next: ' + c.waiting.next : ''} style={{ maxWidth: 260 }}>{c.waiting ? <><div className="b">{c.waiting.who}</div><div className="tiny mut clamp2">{c.waiting.why}</div></> : <span className="mut">Closed · {c.recommendation?.action?.replace(/_/g, ' ').toLowerCase()}</span>}</td><td className="small mut">{fmtTime(c.created_at)}</td></tr>)}
      {d && !d.length && <tr><td colSpan="10" className="mut pad">No case matches these filters.</td></tr>}
    </tbody></table></div>
  </>;
}

// ---------------- Audit ----------------
export function Audit({ me }) {
  const [q, setQ] = useState(''), [ov, setOv] = useState(false);
  const [d] = useApi(`/audit?q=${encodeURIComponent(q)}${ov ? '&override=1' : ''}`, [q, ov], 10000);
  return <>
    <div className="row"><div className="grow"><div className="kicker">Continuous assurance</div><h1>Audit trail</h1><div className="small mut">Every recommendation, decision, override, G2 operation and system action — immutable evidence.</div></div>
      <input className="input" style={{ width: 280 }} placeholder="Search…" value={q} onChange={e => setQ(e.target.value)} /><label className="row small"><input type="checkbox" checked={ov} onChange={e => setOv(e.target.checked)} /> Overrides only</label>
      {me.perms.includes('audit.export') && <a className="btn dark" href="/api/audit/export">⬇ Export evidence (CSV)</a>}</div>
    <div className="card" style={{ overflow: 'auto', maxHeight: '72vh' }}><table className="t"><thead><tr><th>Time</th><th>Actor</th><th>System</th><th>Action</th><th>Case / entity</th><th>Result</th><th>AI rec.</th><th>Human</th><th>Override</th></tr></thead><tbody>
      {(d || []).map(e => <tr key={e.id}><td className="small mono">{fmtTime(e.ts)}</td><td className="small"><b>{e.actor}</b><div className="tiny mut">{e.role}</div></td><td className="tiny">{e.system}</td><td className="small">{e.action}{e.rule && <div className="tiny mut">rule: {e.rule}</div>}</td><td className="small mono">{e.case_ref ? <Link to={'/case/' + e.case_ref}>{e.case_ref}</Link> : e.entity}</td><td className="small">{e.new_state}</td><td className="tiny">{e.ai_recommendation}</td><td className="tiny">{e.human_decision}</td><td>{e.override ? <Pill v="HIGH">OVERRIDE</Pill> : ''}{e.override_reason && <div className="tiny mut">{e.override_reason}</div>}</td></tr>)}
    </tbody></table></div>
  </>;
}

// ---------------- Policies ----------------
export function Policies({ me }) {
  const [d, load] = useApi('/policies');
  const [edit, setEdit] = useState(null); const toast = useToast();
  const save = async () => { try { await api('/policies/' + edit.key, { value: JSON.parse(edit.text) }, 'PUT'); toast('Policy saved — new version active'); setEdit(null); load(); } catch (e) { toast(e.message, true); } };
  return <>
    <div><div className="kicker">Policy engine</div><h1>Configurable rules</h1><div className="small mut">Thresholds, SLAs, required documents, lifecycle timings, AML and control rules. {me.perms.includes('policy.manage') ? 'You can edit (versioned & audited).' : 'Read-only for your role.'}</div></div>
    <div className="depts">{(d || []).map(p => <div key={p.key} className="card pad col"><div className="row"><span className="kicker grow">{p.category}</span><span className="tiny mut">v{p.version}</span></div><h3 className="mono">{p.key}</h3><div className="small mut">{p.description}</div>
      <pre className="mono small" style={{ background: '#f7f8fa', padding: 10, borderRadius: 8, margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(p.value, null, 1)}</pre>
      {me.perms.includes('policy.manage') && <button className="btn sm" onClick={() => setEdit({ key: p.key, text: JSON.stringify(p.value, null, 2) })}>Edit</button>}</div>)}</div>
    {edit && <Modal title={'Edit ' + edit.key} onClose={() => setEdit(null)}><textarea className="input mono" rows={12} value={edit.text} onChange={e => setEdit({ ...edit, text: e.target.value })} /><button className="btn primary" onClick={save}>Save new version</button></Modal>}
  </>;
}

// ---------------- Demo control ----------------
export function Demo() {
  const [st, load] = useApi('/demo/state', [], 5000); const toast = useToast();
  const go = async (path, body, msg) => { try { const r = await api(path, body); toast(msg || 'Done ✓'); load(); return r; } catch (e) { toast(e.message, true); } };
  return <>
    <div><div className="kicker">Testing & presentation utilities — not part of production UI</div><h1>Demo control panel</h1></div>
    <div className="card pad col"><h3>Time travel</h3><div className="small mut">Current Sentinel time: <b>{st ? fmtTime(st.clock) : '…'}</b> (offset +{st?.offset_days} days). Advancing time runs monitoring rules: transactions, lifecycle (Educate · Support · Engage), document expiry, inactivity, SLA.</div>
      <div className="row wrap">{[[0, 1, '+1 hour'], [1, 0, '+1 day'], [3, 0, '+3 days'], [5, 0, '+5 days'], [7, 0, '+7 days'], [30, 0, '+30 days'], [90, 0, '+90 days']].map(([dd, hh, l]) => <button key={l} className="btn" onClick={() => go('/demo/advance', { days: dd, hours: hh }, 'Time advanced ' + l)}>{l}</button>)}</div></div>
    <div className="card pad col"><h3>Simulate events</h3><div className="row wrap">
      <button className="btn" onClick={() => go('/demo/simulate', { kind: 'SLA_RISK' }, 'SLA risk injected')}>⏳ Simulate SLA risk</button>
      <button className="btn" onClick={() => go('/demo/simulate', { kind: 'AML_ALERT' }, 'Account-takeover pattern injected')}>🛡️ Simulate AML alert (SIM swap → PIN reset → cash-out)</button>
      <button className="btn" onClick={() => go('/demo/simulate', { kind: 'CONTROL_EXCEPTION' }, 'Uncontrolled G2 operation injected')}>🔍 Simulate control exception</button>
      <button className="btn" onClick={() => go('/demo/simulate', { kind: 'G2_FAILURE' }, 'Next G2 creation will fail')}>🖥️ Next G2 call fails {st?.g2_fail_next ? '(armed)' : ''}</button>
      <button className="btn" onClick={() => go('/demo/simulate', { kind: 'TICK' }, 'Monitoring cycle executed')}>▶ Run monitoring cycle now</button></div></div>
    <div className="card pad col"><h3>Reset</h3><div className="small mut">Restores the seeded demo data (≈170 cases, 112 G2 accounts, cross-department alerts) and resets the clock.</div><button className="btn primary" style={{ alignSelf: 'flex-start' }} onClick={() => confirm('Reset all demo data?') && go('/demo/reset', {}, 'Demo data reset').then(() => location.reload())}>Reset demo data</button></div>
  </>;
}

export function QR() {
  const [cfg] = useApi('/config');
  const url = (cfg?.public_url || location.origin).replace(/\/$/, '') + '/tobi';
  return <div className="col" style={{ alignItems: 'center', textAlign: 'center', paddingTop: 20 }}><div className="kicker">Scan to talk to TOBi</div><h1>Open your M-Pesa Business account</h1>
    <img src={'/api/qr?text=' + encodeURIComponent(url)} style={{ width: 340, height: 340, borderRadius: 16, boxShadow: 'var(--sh)' }} /><div className="mono small">{url}</div>
    <div className="small mut" style={{ maxWidth: 460 }}>The QR code points to this server's address. On the competition server, set PUBLIC_URL / use the public HTTPS domain so phones can reach it.</div></div>;
}

// Public page (no login): QR code to try TOBi on a phone + how to explore the staff side
export function Scan() {
  const [cfg] = useApi('/config');
  const base = (cfg?.public_url || location.origin).replace(/\/$/, '');
  const url = base + '/tobi';
  return <div className="scan">
    <div className="scan-card">
      <div className="row" style={{ justifyContent: 'center' }}><Logo size={46} /><div style={{ textAlign: 'left' }}><div style={{ fontSize: 24, fontWeight: 900 }}>SLA SENTINEL <span style={{ color: 'var(--red)' }}>AI</span></div><div style={{ color: '#0a9d58', fontWeight: 700, fontSize: 13 }}>Seamless Lifecycle Assistance</div></div></div>
      <h1 style={{ margin: '18px 0 4px' }}>Try TOBi on your phone</h1>
      <div className="mut">Scan the code, open an M-Pesa merchant account, send a document photo, ask for a SIM swap…</div>
      <img src={'/api/qr?text=' + encodeURIComponent(url)} alt="QR code to TOBi" className="scan-qr" />
      <a className="btn primary" href="/tobi" style={{ justifyContent: 'center' }}>💬 Open TOBi</a>
      <div className="mono small mut" style={{ marginTop: 8 }}>{url}</div>
      <div className="scan-staff"><b>Then see your request on the staff side</b><div className="small mut">Open <a href={base}>{base.replace(/^https?:\/\//, '')}</a> and click a role (Operations, AML/CFT, Compliance, Risk, Internal Control, Legal, Audit) — password <b>demo123</b>. Your case appears in the Command Center within seconds.</div></div>
      <div className="tiny mut" style={{ marginTop: 14 }}>Hackathon prototype · all data is fictional · do not upload real personal documents.</div>
    </div>
  </div>;
}
