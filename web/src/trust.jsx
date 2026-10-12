import React from 'react';
import { api, useApi, useToast, Pill, fmtTime, ago, nav, Link } from './lib.jsx';

const usd = (n) => '$' + (n >= 1000 ? Math.round(n / 1000) + 'K' : n);
const SEG = ['#e60000', '#0a9d58', '#2563eb', '#7c3aed', '#d98300', '#9aa0ab'];
const TIER = { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH', CRITICAL: 'CRITICAL' };

// ---------------- DRC pilot programme ----------------
export function Programme() {
  const [d] = useApi('/programme', [], 10000);
  if (!d) return <div className="spin" />;
  const b = d.budget;
  return <div className="col" style={{ gap: 16 }}>
    <div><div className="kicker">DRC pilot programme</div><h1 className="pg-h1">Development cost <span className="pg-big">{usd(b.total)}</span> · pilot market: the DRC</h1></div>
    <div className="pg-grid">
      <div className="card pad col">
        <div className="row"><b className="grow">Development cost — breakdown</b><span className="mono b">{b.total.toLocaleString('en-US')} USD</span></div>
        <div className="pg-bar">{b.lines.map(([l, v], i) => <i key={l} style={{ width: (v / b.total * 100) + '%', background: SEG[i] }} title={l} />)}</div>
        <div className="pg-lines">{b.lines.map(([l, v], i) => <div key={l} className="row small"><span className="pg-sw" style={{ background: SEG[i] }} /><span className="grow">{l}</span><b className="mono">{usd(v)}</b><span className="mut tiny" style={{ width: 34, textAlign: 'right' }}>{Math.round(v / b.total * 100)}%</span></div>)}</div>
      </div>
      <div className="card pad col">
        <b>Pilot market</b>
        <div className="pg-map"><DrcMap /><div className="col" style={{ gap: 4 }}><div className="pg-country">🇨🇩 DRC</div><div className="small mut">{d.market.city} · {d.market.phase}</div><div className="small"><b>{d.accounts}</b> accounts monitored · <b>{d.cases}</b> cases</div></div></div>
        <div className="pg-path"><span className="on">DRC pilot · Y1–Y2</span>{d.market.next.map(n => <span key={n}>→ {n}</span>)}</div>
        <Link to="/systems" className="pg-sys"><span className="b">{d.connected} systems connected</span><span className="small mut">{d.systems.join(' · ')} →</span></Link>
      </div>
    </div>
    <div className="card pad col">
      <div className="row"><b className="grow">DRC pilot KPIs</b><span className="tiny mut">live from Sentinel data</span></div>
      <div className="pg-kpis">{d.kpis.map(k => { const ok = k.value != null && (k.lower ? k.value <= k.target : k.value >= k.target); const pct = k.value == null ? 0 : k.lower ? Math.min(100, k.target === 0 ? (k.value === 0 ? 100 : 0) : k.target / Math.max(k.value, .01) * 100) : Math.min(100, k.value / k.target * 100); return <div key={k.label} className="pg-kpi"><div className="small mut">{k.label}</div><div className="row"><b className="pg-kv">{k.value ?? '—'}{k.unit}</b><span className="small mut">target {k.lower ? '≤' : '≥'} {k.target}{k.unit}</span></div><div className="gauge"><i style={{ width: pct + '%', background: ok ? 'var(--green)' : 'var(--amber)' }} /></div><Pill v={ok ? 'MET' : 'ON_TRACK'}>{ok ? 'MET' : 'IN PROGRESS'}</Pill></div>; })}</div>
    </div>
  </div>;
}
function DrcMap() {
  // simplified outline of the DRC, Kinshasa marked
  return <svg viewBox="0 0 120 110" className="pg-drc" role="img" aria-label="Map of the DRC with Kinshasa marked"><path d="M18 52 L30 44 L36 30 L52 22 L66 12 L84 14 L98 22 L108 36 L104 52 L110 64 L100 76 L96 92 L80 98 L70 90 L58 96 L52 84 L40 82 L32 72 L22 70 L12 66 L6 60 Z" fill="#e60000" fillOpacity=".12" stroke="#e60000" strokeWidth="2" strokeLinejoin="round" /><circle cx="20" cy="62" r="5" fill="#e60000" /><circle cx="20" cy="62" r="10" fill="none" stroke="#e60000" strokeOpacity=".4" strokeWidth="2" /><text x="30" y="66" fontSize="9" fontWeight="700" fill="#1a1b1f">Kinshasa</text></svg>;
}

// ---------------- Connected systems ----------------
export function Systems() {
  const [d] = useApi('/systems', [], 3000);
  if (!d) return <div className="spin" />;
  return <div className="col" style={{ gap: 16 }}>
    <div><div className="kicker">Connected systems</div><h1>Sentinel connects what already exists</h1><div className="small mut">TOBi, G2, iCAP, IRM and every transactional and control system — each call goes through the API gateway (mTLS 1.3 + OAuth2) under a dedicated machine identity, with only the scopes it needs.</div></div>
    <div className="sys-hub">
      <div className="sys-core"><div className="b">SLA SENTINEL <span style={{ color: 'var(--red)' }}>AI</span></div><div className="tiny mut">orchestrator · API gateway</div></div>
      <div className="sys-grid">{d.systems.map(x => <div key={x.code} className={'card sys-card' + (x.code === 'TOBI' ? ' tobi' : '')}>
        <div className="row"><span className="sys-dot" /><b className="grow" style={{ fontSize: 17 }}>{x.name}</b><Pill v="OK">CONNECTED</Pill></div>
        <div className="small mut">{x.role}</div>
        <div className="row wrap sys-scopes">{x.scopes.map(sc => <span key={sc} className="mono tiny">{sc}</span>)}</div>
        <div className="row small"><span className="mut">Identity</span><span className="mono grow ell">{x.identity}</span><Pill v={x.tier}>{x.tier}</Pill></div>
        <div className="sys-stats"><div><b>{x.calls_24h}</b><span>calls 24h</span></div><div><b>{x.avg_ms} ms</b><span>avg latency</span></div><div><b>{x.errors}</b><span>errors</span></div></div>
        {x.items && <div className="row wrap sys-items">{x.items.map(i => <span key={i}>{i}</span>)}</div>}
        {x.hitl && <div className="tiny" style={{ color: 'var(--amber)' }}>🔒 {x.hitl}</div>}
      </div>)}</div>
    </div>
    <div className="card"><div className="pad row" style={{ paddingBottom: 8 }}><b className="grow">Live calls</b><span className="tiny mut">refreshes every 3 s</span></div>
      <table className="t"><thead><tr><th>Time</th><th>System</th><th>Operation</th><th>Identity</th><th>Tier</th><th>Case</th><th>Latency</th><th>Status</th></tr></thead><tbody>
        {d.calls.filter(c => c.system !== 'GATEWAY').slice(0, 14).map(c => <tr key={c.id}><td className="small mono">{fmtTime(c.ts)}</td><td className="b">{d.systems.find(s => s.code === c.system)?.name || c.system}</td><td className="mono small">{c.operation}</td><td className="mono small">{c.identity}</td><td><Pill v={c.tier}>{c.tier}</Pill></td><td className="mono small">{c.case_ref ? <a href={'/case/' + c.case_ref} onClick={(e) => { e.preventDefault(); nav('/case/' + c.case_ref); }}>{c.case_ref}</a> : '—'}</td><td className="small">{c.latency_ms} ms</td><td><Pill v={c.status === 'OK' ? 'OK' : 'FAILED'}>{c.status}</Pill></td></tr>)}
      </tbody></table></div>
  </div>;
}

// ---------------- Security & Trust ----------------
export function Security({ me }) {
  const [d, load] = useApi('/trust', [], 5000); const toast = useToast();
  if (!d) return <div className="spin" />;
  const canKill = me.perms.includes('policy.manage');
  const kill = async (k) => { try { await api('/trust/kill', { key: k.key, on: !k.engaged }); toast(k.engaged ? `${k.label} released` : `${k.label} stopped — its work now goes to people`); load(); } catch (e) { toast(e.message, true); } };
  const tiles = [
    { l: 'Audit trail', v: d.audit.ok ? 'Verified ✓' : 'BROKEN', s: `${d.audit.checked.toLocaleString('en-US')} events hash-chained`, c: d.audit.ok ? 'good' : 'bad', mono: d.audit.head?.slice(0, 16) + '…' },
    { l: 'Prompt injections blocked', v: d.guardrails.injections_blocked, s: 'OWASP LLM01 filter on every message', c: 'good' },
    { l: 'Personal data masked', v: d.guardrails.pii_masked, s: 'phone & ID numbers masked before AI', c: 'good' },
    { l: 'Direct writes by AI', v: d.guardrails.ai_writes, s: 'agents read & recommend only', c: 'good' },
    { l: 'Decisions', v: `${d.decisions.automatic} / ${d.decisions.human}`, s: 'automatic (policy) / human', c: '' },
  ];
  return <div className="col" style={{ gap: 16 }}>
    <div><div className="kicker">Security & Trust</div><h1>Every step secured, permissioned and logged</h1><div className="small mut">Zero Trust · least privilege · human-in-the-loop for High and Critical actions · AI, LLM & RPA Security & Governance Standard</div></div>
    <div className="tiles sec-tiles">{tiles.map(t => <div key={t.l} className={'card tile ' + (t.c || '')}><div className="kicker">{t.l}</div><div className="v">{t.v}</div><div className="small mut">{t.s}</div>{t.mono && <div className="mono tiny mut">{t.mono}</div>}</div>)}</div>
    <div className="sec-2">
      <div className="card"><div className="pad" style={{ paddingBottom: 6 }}><b>Tool trust framework</b><div className="tiny mut">What each kind of action needs before it runs</div></div>
        <table className="t"><thead><tr><th>Action</th><th>Tier</th><th>How it runs</th></tr></thead><tbody>{d.tools.map(t => <tr key={t.tool}><td className="small b">{t.tool}</td><td><Pill v={t.tier}>{t.tier}</Pill></td><td className="small">{t.mode}</td></tr>)}</tbody></table></div>
      <div className="card"><div className="pad" style={{ paddingBottom: 6 }}><b>Segregated identities</b><div className="tiny mut">Developers, AI, robots and admins never share credentials</div></div>
        <table className="t"><thead><tr><th>Identity</th><th>Type</th><th>Access</th><th>Auth</th></tr></thead><tbody>{d.identities.map(i => <tr key={i.id}><td className="mono small">{i.id}</td><td className="small b">{i.type}</td><td className="small">{i.access}</td><td className="small">{i.auth}</td></tr>)}</tbody></table></div>
    </div>
    <div className="sec-2">
      <div className="card pad col"><div className="row"><b className="grow">Kill switches</b><span className="tiny mut">fail-secure: a stopped agent's work goes to people</span></div>
        {d.kill.map(k => <div key={k.key} className="row" style={{ borderTop: '1px solid #f0f1f3', paddingTop: 8 }}><span className="grow small b">{k.label}</span><Pill v={k.engaged ? 'HIGH' : 'OK'}>{k.engaged ? 'STOPPED' : 'RUNNING'}</Pill>{canKill && <button className="btn sm" onClick={() => kill(k)}>{k.engaged ? 'Release' : 'Stop'}</button>}</div>)}</div>
      <div className="card pad col"><b>Recent guardrail events</b>
        {d.recent_guardrails.length ? d.recent_guardrails.map(g => <div key={g.id} className="row small" style={{ borderTop: '1px solid #f0f1f3', paddingTop: 6 }}><Pill v={g.action === 'BLOCKED' ? 'HIGH' : 'LOW'}>{g.action}</Pill><span className="grow">{g.kind === 'PROMPT_INJECTION' ? 'Prompt-injection attempt' : 'Personal data masked'}{g.detail ? <span className="mut"> — “{g.detail}”</span> : null}</span><span className="tiny mut">{ago(g.ts)}</span></div>) : <div className="small mut">No event yet.</div>}
        <div className="kicker" style={{ marginTop: 8 }}>Mapped to</div><div className="row wrap">{d.standards.map(x => <span key={x} className="sec-std">{x}</span>)}</div></div>
    </div>
  </div>;
}

// ---------------- Orchestration trace (Case 360) ----------------
const ACTOR = { 1: 'ai', 2: 'gate', 3: 'core', 4: 'ai', 5: 'core', 6: 'ppl', 7: 'rpa', 8: 'ai', 9: 'sec' };
const ACTOR_L = { ai: 'AI agent', gate: 'Gateway', core: 'Orchestrator', ppl: 'People', rpa: 'Robot', sec: 'Security' };
export function CaseTrace({ steps }) {
  if (!steps) return <div className="card pad mut">No orchestration trace.</div>;
  return <div className="card pad"><div className="row" style={{ marginBottom: 10 }}><b className="grow">End-to-end orchestration — 9 steps</b><span className="tr-leg">{Object.entries(ACTOR_L).map(([k, l]) => <span key={k}><i className={'tr-c ' + k} />{l}</span>)}</span></div>
    <div className="tr">{steps.map(s => <div key={s.n} className={'tr-step ' + ACTOR[s.n] + ' st-' + s.status}>
      <div className="tr-n">{s.n}</div>
      <div className="tr-body">
        <div className="row wrap"><b className="grow">{s.title}</b><Pill v={{ DONE: 'OK', SKIPPED: 'ACKNOWLEDGED', WAITING: 'PENDING_REVIEW', PENDING: 'ACKNOWLEDGED', FAILED: 'FAILED', ACTIVE: 'ACTIVE', SCHEDULED: 'ON_TRACK' }[s.status]}>{s.status === 'SKIPPED' ? 'NOT NEEDED' : s.status}</Pill></div>
        <div className="small"><span className="b">{s.actor}</span>{s.identity && s.identity !== '—' && <span className="mono tiny mut"> · {s.identity}</span>}{s.ts && <span className="tiny mut"> · {fmtTime(s.ts)}</span>}</div>
        <div className="small mut">{s.detail}</div>
        {s.branch && <div className="tr-branch"><span className={s.branch === 'ROBOT' ? 'on rpa' : ''}>🤖 Robot — low risk</span><span className={s.branch === 'HUMAN' ? 'on ppl' : ''}>👤 Person — sensitive</span></div>}
        {s.systems?.length > 0 && <div className="row wrap" style={{ gap: 6 }}>{s.systems.map(x => <span key={x} className="tr-sys">{{ TOBI: 'TOBi', ICAP: 'iCAP', CONTROL: 'Control systems', TRANSACTIONAL: 'Transactional' }[x] || x} ✓</span>)}</div>}
        {s.pillars && <div className="row wrap" style={{ gap: 6 }}>{s.pillars.map(p => <span key={p} className="tr-pil">{p}</span>)}</div>}
      </div></div>)}</div></div>;
}
