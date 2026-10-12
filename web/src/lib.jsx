import React, { useEffect, useState, useCallback, createContext, useContext } from 'react';

export async function api(path, body, method) {
  const r = await fetch('/api' + path, { method: method || (body ? 'POST' : 'GET'), headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  const data = await r.json().catch(() => null);
  if (!r.ok) { const e = new Error(data?.error || r.statusText); e.status = r.status; e.code = data?.code; throw e; }
  return data;
}
export function nav(to) { window.history.pushState({}, '', to); window.dispatchEvent(new Event('popstate')); }
export function usePath() { const [p, setP] = useState(window.location.pathname); useEffect(() => { const f = () => setP(window.location.pathname); window.addEventListener('popstate', f); return () => window.removeEventListener('popstate', f); }, []); return p; }
export function useSearch() { const [q, setQ] = useState(window.location.search); useEffect(() => { const f = () => setQ(window.location.search); window.addEventListener('popstate', f); return () => window.removeEventListener('popstate', f); }, []); return q; }
export function Link({ to, children, className, ...rest }) { return <a href={to} className={className} onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); nav(to); }} {...rest}>{children}</a>; }

export function useApi(path, deps = [], interval = 0) {
  const [data, setData] = useState(null), [err, setErr] = useState(null);
  const load = useCallback(() => path ? api(path).then(d => { setData(d); setErr(null); }).catch(setErr) : Promise.resolve(setData(null)), [path]);
  useEffect(() => { load(); if (interval) { const t = setInterval(load, interval); return () => clearInterval(t); } }, [load, ...deps]);
  return [data, load, err];
}

const ToastCtx = createContext(() => { });
export const useToast = () => useContext(ToastCtx);
export function ToastHost({ children }) {
  const [t, setT] = useState(null);
  const show = useCallback((msg, err = false) => { setT({ msg, err }); setTimeout(() => setT(null), 3200); }, []);
  return <ToastCtx.Provider value={show}>{children}{t && <div className={'toast' + (t.err ? ' err' : '')}>{t.msg}</div>}</ToastCtx.Provider>;
}

export const Pill = ({ v, children }) => <span className={'pill p-' + v}>{children || String(v || '').replace(/_/g, ' ')}</span>;
export const Dot = ({ s }) => <span className={'sev-dot sev-' + s} />;
export const fmtTime = (t) => t ? new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
export const ago = (t, now = Date.now()) => { if (!t) return ''; const m = Math.round((now - new Date(t)) / 60000); if (m < 1) return 'just now'; if (m < 60) return m + ' min ago'; const h = Math.round(m / 60); if (h < 48) return h + ' h ago'; return Math.round(h / 24) + ' days ago'; };
export const dur = (ms) => { const neg = ms < 0; ms = Math.abs(ms); const h = Math.floor(ms / 3600000), m = Math.floor(ms % 3600000 / 60000), s = Math.floor(ms % 60000 / 1000); const str = h >= 48 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; return (neg ? '-' : '') + str; };
export const DEPT_NAMES = { OPERATIONS: 'Operations', AML: 'AML / CFT', COMPLIANCE: 'Compliance', RISK: 'Risk Management', INTERNAL_CONTROL: 'Internal Control', LEGAL: 'Legal', AUDIT: 'Internal Audit' };
export const DEPT_ICON = { OPERATIONS: '⚙️', AML: '🛡️', COMPLIANCE: '📋', RISK: '📈', INTERNAL_CONTROL: '🔍', LEGAL: '⚖️', AUDIT: '🧾' };

export function Why({ factors = [] }) {
  const max = Math.max(30, ...factors.map(f => f.points));
  if (!factors.length) return <div className="mut small">No risk drivers.</div>;
  return <div className="why">{factors.map((f, i) => <div className="f" key={i}><div className="p">+{f.points}</div><div><div>{f.label}</div><div className="bar"><i style={{ width: (f.points / max * 100) + '%' }} /></div></div></div>)}</div>;
}
export function Modal({ title, children, onClose }) { return <div className="modal-bg" onClick={onClose}><div className="modal" onClick={e => e.stopPropagation()}><div className="row"><h2 className="grow">{title}</h2><button className="btn ghost sm" onClick={onClose}>✕</button></div>{children}</div></div>; }
export function Logo({ size = 34 }) {
  return <svg width={size} height={size} viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="none" stroke="#00c45a" strokeOpacity=".2" strokeWidth="4" /><circle cx="50" cy="50" r="36" fill="none" stroke="#00c45a" strokeWidth="9" strokeDasharray="70 5.4" strokeLinecap="round" transform="rotate(-80 50 50)" /><circle cx="50" cy="50" r="20" fill="none" stroke="#00c45a" strokeOpacity=".5" strokeWidth="4" /><circle cx="50" cy="50" r="8" fill="#00e66a" /><circle cx="75.5" cy="24.5" r="7" fill="#e60000" stroke="#121317" strokeWidth="3" /></svg>;
}
export function Spark({ data, keys, colors, h = 120 }) {
  const w = 560, max = Math.max(1, ...data.flatMap(d => keys.map(k => d[k])));
  const x = (i) => 30 + i * (w - 40) / Math.max(1, data.length - 1), y = (v) => h - 22 - v / max * (h - 34);
  return <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: h }}>
    {[0, .5, 1].map(f => <line key={f} x1="30" x2={w - 10} y1={y(max * f)} y2={y(max * f)} stroke="#eef0f3" />)}
    {keys.map((k, ki) => <polyline key={k} fill="none" stroke={colors[ki]} strokeWidth="2.5" strokeLinejoin="round" points={data.map((d, i) => `${x(i)},${y(d[k])}`).join(' ')} />)}
    {data.map((d, i) => i % 2 === 0 && <text key={i} x={x(i)} y={h - 5} fontSize="10" textAnchor="middle" fill="#9aa0ab">{d.day}</text>)}
    <text x="4" y={y(max) + 4} fontSize="10" fill="#9aa0ab">{max}</text>
  </svg>;
}
