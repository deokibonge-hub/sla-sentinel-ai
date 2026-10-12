import React, { useEffect, useState, useRef } from 'react';
import { api, Link, useApi, Pill, Why, Modal, fmtTime, dur, DEPT_NAMES, useToast } from './lib.jsx';

const DIM = { OPERATIONAL: 'Operational risk', COMPLIANCE: 'Compliance risk', AML_CFT: 'AML/CFT risk', FRAUD: 'Fraud risk', LEGAL: 'Legal risk', SLA_BREACH: 'SLA breach risk', OVERALL: 'Overall case risk' };
const col = (s) => s >= 80 ? '#7a0000' : s >= 60 ? '#e60000' : s >= 30 ? '#d98300' : '#0a9d58';

export default function Case360({ refId, me }) {
  const [d, load] = useApi('/cases/' + refId, [refId], 6000);
  const [focus, setFocus] = useState(null);
  const [tab, setTab] = useState('OVERVIEW'), [act, setAct] = useState(null), [dact, setDact] = useState(null), [now, setNow] = useState(Date.now());
  const [acts] = useApi('/case-actions');
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const toast = useToast();
  if (!d) return <div className="spin" />;
  const c = d.case, rec = c.recommendation || {}, f = d.application?.fields || {};
  const stageIdx = d.pipeline.indexOf(c.stage);
  const remaining = d.sla ? d.sla.remaining_ms - (c.resolved_at ? 0 : (now - Date.now() + (now - now))) : 0;
  const closed = ['RESOLVED', 'REJECTED', 'CLOSED'].includes(c.status);
  const TABS = ['OVERVIEW', 'CASE FILE', 'CUSTOMER', 'VERIFICATION', 'RISK', 'CONTROLS', 'AML', 'SLA', 'DECISIONS', 'ACTIVITY', 'AUDIT TRAIL'];
  const retry = async () => { try { await api(`/cases/${c.ref}/retry-g2`, {}); toast('G2 creation re-submitted'); load(); } catch (e) { toast(e.message, true); } };
  return <>
    <div className="card pad">
      <div className="row wrap" style={{ gap: 26 }}>
        <div><div className="kicker">Case</div><div className="mono b" style={{ fontSize: 20 }}>{c.ref}</div><div className="small mut">{(c.service || c.type).replace(/_/g, ' ')} · via {c.source}{c.requester_type ? ' · ' + c.requester_type : ''}</div>{d.application && <a className="btn sm" style={{ marginTop: 6 }} href={'/api/forms/bcf/' + c.ref} target="_blank">🖨 Merchant form (BCF)</a>}</div>
        <div><div className="kicker">Customer</div><div className="b">{c.customer_name}</div><div className="small mut mono">{c.account_msisdn ? '+' + c.account_msisdn : ''}</div></div>
        <div><div className="kicker">Status</div><Pill v={c.status} /></div>
        <div><div className="kicker">Owner</div><div className="b">{DEPT_NAMES[c.owner_dept]}</div><div className="small mut">{d.sla?.team}</div></div>
        <div><div className="kicker">SLA</div><div className="mono b" style={{ color: d.sla?.status === 'BREACHED' ? 'var(--red)' : 'inherit' }}>{d.sla ? (c.resolved_at ? d.sla.status : dur(d.sla.remaining_ms)) : '—'}</div><Pill v={d.sla?.status} /></div>
        <div><div className="kicker">SLA risk</div><div className="b" style={{ fontSize: 20 }}>{d.sla?.breach_probability ?? 0}%</div></div>
        <div><div className="kicker">Overall risk</div><Pill v={c.risk_level}>{c.risk_score}/100 {c.risk_level}</Pill></div>
      </div>
      <div className="pipeline" style={{ marginTop: 16 }}>{d.pipeline.map((p, i) => <div key={p} className={'st ' + (i < stageIdx || closed && i <= stageIdx ? 'done' : i === stageIdx ? 'cur' : '')}>{p.replace('_', '-')}</div>)}</div>
    </div>
    <div className="tabs">{TABS.map(t => <button key={t} className={'tab' + (tab === t ? ' on' : '')} onClick={() => setTab(t)}>{t}{t === 'CASE FILE' && <span className="tabn">{d.documents.length}</span>}{t === 'CASE FILE' && d.findings?.some(f => f.s === 'bad') && <span className="tabdot" />}</button>)}</div>

    {tab === 'OVERVIEW' && <div className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
      <div className="col grow" style={{ gap: 14 }}>
      {d.waiting && <div className="card pad waitbox"><div className="kicker">Why is this case waiting?</div>
        <div className="row" style={{ alignItems: 'flex-start', gap: 14, marginTop: 8 }}><div className="wicon">⏳</div><div className="grow">
          <div className="b" style={{ fontSize: 16 }}>Waiting for: {d.waiting.who}</div>
          <div style={{ marginTop: 4 }}>{d.waiting.why}</div>
          <div className="small mut" style={{ marginTop: 6 }}><b>Next step:</b> {d.waiting.next}</div></div>
          {d.sla && <div style={{ textAlign: 'right' }}><div className="tiny mut">SLA left</div><div className="mono b">{dur(d.sla.remaining_ms)}</div></div>}</div></div>}
      <div className="card pad col">
        <div className="kicker">Sentinel recommendation (AI) — distinct from human decision</div>
        <div className="row" style={{ gap: 30 }}><div><div className="small mut">Recommended action</div><div className="b" style={{ fontSize: 22 }}>{rec.action?.replace(/_/g, ' ')}</div></div><div><div className="small mut">Confidence</div><div className="b" style={{ fontSize: 22 }}>{rec.confidence}%</div></div><div><div className="small mut">Overall risk</div><div className="b" style={{ fontSize: 22 }}>{rec.risk_level || c.risk_level}</div></div><div><div className="small mut">Route</div><div className="b" style={{ fontSize: 22 }}>{DEPT_NAMES[rec.route] || DEPT_NAMES[c.owner_dept]}</div></div></div>
        <div><div className="small mut">Reason</div>{(rec.reason || []).map(r => <div key={r}>• {r}</div>)}</div>
        {rec.rule && <div className="small mono" style={{ background: '#f7f8fa', padding: 8, borderRadius: 8 }}>Policy rule: {rec.rule}</div>}
        {!closed && <><div className="kicker" style={{ marginTop: 6 }}>Human-in-the-loop decision</div><div className="row wrap">
          <button className="btn green" disabled={!(me.perms.includes('case.decide') || (c.owner_dept === 'AML' && me.role === 'AML_OFFICER'))} onClick={() => setAct('APPROVE')}>Approve</button>
          <button className="btn" disabled={!(me.perms.includes('case.reject') || (c.owner_dept === 'AML' && me.role === 'AML_OFFICER'))} title="Operations Manager — justification required" onClick={() => setAct('REJECT')}>Reject</button>
          <button className="btn" disabled={!me.perms.includes('case.request_info')} onClick={() => setAct('REQUEST_INFORMATION')}>Request information</button>
          <button className="btn" disabled={!me.perms.includes('case.escalate')} onClick={() => setAct('ESCALATE')}>Escalate</button>
          {c.status === 'G2_FAILED' && me.perms.includes('g2.create') && <button className="btn primary" onClick={retry}>↻ Retry G2 creation</button>}
        </div>
        {(acts || []).filter(a => a.action !== 'SEND_TO_G2' || (d.application && !['G2_FAILED'].includes(c.status))).length > 0 && <><div className="kicker" style={{ marginTop: 6 }}>{me.roleName} actions</div><div className="row wrap">
          {(acts || []).filter(a => a.action !== 'SEND_TO_G2' || (d.application && !['G2_FAILED'].includes(c.status))).map(a => <button key={a.action} className={'btn ' + (a.action === 'SEND_TO_G2' ? 'primary' : '')} onClick={() => setDact(a)}>{a.label}</button>)}</div></>}{!me.perms.some(p => p.startsWith('case.decide') || p === 'case.request_info') && <div className="small mut">Your role ({me.roleName}) has read/assurance access on this case.</div>}</>}
      </div></div>
      <div className="col" style={{ width: 400, gap: 14 }}>
      <Findings d={d} onOpen={(f) => { setFocus(f); setTab('CASE FILE'); }} />
      <div className="card pad">
        <div className="kicker">G2 / creation</div>
        {d.g2 ? <div className="col" style={{ gap: 4, marginTop: 6 }}><div className="b" style={{ color: d.g2.case_ref === c.ref ? 'var(--green)' : 'var(--ink)' }}>{d.g2.case_ref === c.ref ? 'ACCOUNT CREATED SUCCESSFULLY' : 'LINKED G2 ACCOUNT'}</div><div className="small">{d.g2.trading_name || d.g2.name} · {d.g2.account_type} · {d.g2.status}</div><div className="small">Merchant ID <b>{JSON.parse(d.g2.kyc || '{}').merchant_id}</b></div><div className="small">G2 reference <b className="mono">{d.g2.g2_ref}</b></div><div className="small">Till <b>{d.g2.till_number}</b> · Short code <b>{d.g2.short_code}</b></div><Link className="small" to={'/g2?q=' + d.g2.msisdn}>Open in G2 →</Link></div>
          : d.g2_requests.length ? d.g2_requests.map(r => <div key={r.id} className="small" style={{ marginTop: 6 }}><Pill v={r.status} /> {r.response?.error}</div>) : <div className="small mut" style={{ marginTop: 6 }}>No creation request yet.</div>}
        <div className="kicker" style={{ marginTop: 16 }}>Alerts on this case</div>
        {d.alerts.length ? d.alerts.map(a => <div key={a.id} className="small" style={{ padding: '6px 0', borderBottom: '1px solid #f2f3f5' }}><Pill v={a.status === 'RESOLVED' ? 'RESOLVED' : a.severity}>{a.status === 'RESOLVED' ? 'RESOLVED' : a.severity}</Pill> {DEPT_NAMES[a.dept]} — {a.title}</div>) : <div className="small mut">None</div>}
      </div></div>
    </div>}

    {tab === 'CASE FILE' && <CaseFile d={d} focus={focus} />}

    {tab === 'CUSTOMER' && <div className="card pad"><div className="kv">{d.application ? Object.entries(f).map(([k, v]) => <React.Fragment key={k}><div className="k">{k.replace(/_/g, ' ')}</div><div>{String(v)} {String(d.application.field_sources[k] || '').startsWith('document') && <Pill v="OK">FROM DOCUMENT</Pill>}{d.application.field_sources[k + '__clarified'] && <Pill v="CLARIFIED">CLARIFIED</Pill>}</div></React.Fragment>) : (d.details?.fields ? Object.entries(d.details.fields).map(([k, v]) => <React.Fragment key={k}><div className="k">{k.replace(/_/g, ' ')}</div><div>{String(v)}</div></React.Fragment>) : <div className="mut">No declared data — system-generated case.</div>)}</div>{d.application && <div className="small mut" style={{ marginTop: 12 }}>Fields marked FROM DOCUMENT were read by Document Intelligence; the rest were typed by the customer in TOBi.</div>}</div>}

    {tab === 'VERIFICATION' && <div className="col"><div className="row wrap">{d.summary.map(s => <div key={s.label} className="card pad" style={{ minWidth: 180 }}><div className="b" style={{ color: s.ok ? 'var(--green)' : 'var(--amber)' }}>{s.ok ? '✓' : '⚠'} {s.label}</div></div>)}</div>
      <div className="card"><table className="t"><thead><tr><th>Check</th><th>Result</th><th>Declared</th><th>Found</th><th>Detail</th></tr></thead><tbody>{d.verifications.map(v => <tr key={v.id}><td>{v.label}</td><td><Pill v={v.status} /></td><td className="small">{v.declared}</td><td className="small">{v.found}</td><td className="small mut">{v.detail}</td></tr>)}</tbody></table></div></div>}

    {tab === 'RISK' && <div className="riskdim">{d.risk.map(r => <div key={r.id} className="card pad col"><div className="row"><b className="grow">{DIM[r.dimension] || r.dimension}</b><Pill v={r.level} /></div><div className="row"><div className="b" style={{ fontSize: 30, color: col(r.score) }}>{r.score}</div><span className="mut">/ 100</span></div><div className="gauge"><i style={{ width: r.score + '%', background: col(r.score) }} /></div><div className="row small"><span className="mut grow">Confidence</span><b>{r.confidence ?? '—'}%</b></div>{r.recommendation && <div className="small"><span className="mut">Recommendation: </span>{r.recommendation}</div>}<div className="kicker">Why?</div><Why factors={r.factors} /></div>)}</div>}

    {tab === 'CONTROLS' && <div className="card pad col">{[['Mandatory documents', d.summary.find(s => s.label === 'Documents complete')?.ok], ['KYC completeness', !!(f.owner_name && f.id_number)], ['Document validity', !d.verifications.some(v => v.status === 'EXPIRED')], ['Declared vs document consistency', !d.verifications.some(v => v.status === 'MISMATCH')], ['Maker-checker', !d.decisions.some(x => x.role !== 'SYSTEM' && d.audit.some(a => a.actor === x.actor && /captur|creat/i.test(a.action)))], ['Approval authority', true], ['SLA compliance', d.sla?.status !== 'BREACHED'], ['AI recommendation respected (no override)', !d.decisions.some(x => x.override)]].map(([l, ok]) => <div key={l} className="row" style={{ borderBottom: '1px solid #f2f3f5', paddingBottom: 8 }}><span className="grow">{l}</span><Pill v={ok ? 'OK' : 'HIGH'}>{ok ? 'PASSED' : 'EXCEPTION'}</Pill></div>)}</div>}

    {tab === 'AML' && <div className="card pad col"><div className="row"><b className="grow">AML/CFT risk</b>{(() => { const r = d.risk.find(x => x.dimension === 'AML_CFT'); return r ? <Pill v={r.level}>{r.score}/100 {r.level}</Pill> : null; })()}</div>
      <Why factors={d.risk.find(x => x.dimension === 'AML_CFT')?.factors || []} />
      <div className="kv small"><div className="k">PEP declared</div><div>{f.pep || '—'}</div><div className="k">Sanctions / asset freeze</div><div>{f.sanctions || '—'}</div><div className="k">Convictions</div><div>{f.convictions || '—'}</div><div className="k">Sanctions screening (simulated)</div><div>No match</div><div className="k">Expected turnover</div><div>{f.monthly_turnover_usd ? f.monthly_turnover_usd + ' USD / month' : '—'}</div><div className="k">Source of funds</div><div>{f.source_of_funds || '—'}</div></div></div>}

    {tab === 'SLA' && <div className="card pad kv"><div className="k">Target</div><div>{d.sla?.target_label || c.sla_hours + ' h'}</div><div className="k">Start</div><div>{fmtTime(c.sla_start)}</div><div className="k">Due</div><div>{fmtTime(c.sla_due)}</div><div className="k">Elapsed</div><div>{d.sla ? dur(d.sla.elapsed_ms) : '—'}</div><div className="k">Remaining</div><div>{d.sla ? dur(d.sla.remaining_ms) : '—'}</div><div className="k">Status</div><div><Pill v={d.sla?.status} /></div><div className="k">Breach probability</div><div>{d.sla?.breach_probability}%</div><div className="k">Next action</div><div>{d.sla?.next_action || '—'}</div><div className="k">Responsible team</div><div>{d.sla?.team} ({DEPT_NAMES[c.owner_dept]})</div><div className="k">Recommendation</div><div>{!closed && d.sla?.breach_probability > 60 ? <b style={{ color: 'var(--red)' }}>PRIORITIZE NOW</b> : '—'}</div></div>}

    {tab === 'DECISIONS' && <div className="card"><table className="t"><thead><tr><th>Time</th><th>Decided by</th><th>AI recommendation</th><th>Human decision</th><th>Override</th><th>Reason</th></tr></thead><tbody>{d.decisions.map(x => <tr key={x.id}><td className="small">{fmtTime(x.created_at)}</td><td><b>{x.actor}</b><div className="tiny mut">{x.role}</div></td><td>{x.ai_action?.replace(/_/g, ' ')}</td><td><b>{x.action}</b></td><td>{x.override ? <Pill v="HIGH">OVERRIDE</Pill> : <Pill v="OK">ALIGNED</Pill>}</td><td className="small">{x.reason}</td></tr>)}{!d.decisions.length && <tr><td colSpan="6" className="mut">No decision yet.</td></tr>}</tbody></table></div>}

    {tab === 'ACTIVITY' && <div className="card"><table className="t"><thead><tr><th>Time</th><th>Channel</th><th>From</th><th>Activity</th></tr></thead><tbody>{(d.activity || []).map((e, i) => <tr key={i}><td className="small mono">{fmtTime(e.ts)}</td><td><Pill v={e.channel === 'G2' ? 'HIGH' : e.channel === 'TOBi' ? 'OK' : 'MEDIUM'}>{e.channel}</Pill></td><td className="small b">{e.who}</td><td className="small">{e.text}</td></tr>)}{!(d.activity || []).length && <tr><td colSpan="4" className="mut">No activity.</td></tr>}</tbody></table></div>}

    {tab === 'AUDIT TRAIL' && <div className="card pad timeline">{d.audit.map((e, i) => <div key={e.id} className="tl"><div className="small mono mut">{new Date(e.ts).toLocaleTimeString('en-GB')}</div><div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}><span className="dot" style={{ background: e.override ? 'var(--red)' : e.system === 'G2' ? '#2563eb' : e.actor.includes('Sentinel') ? 'var(--green)' : '#9aa0ab' }} />{i < d.audit.length - 1 && <span className="ln" />}</div>
      <div className="body"><b>{e.actor}</b> <span className="tiny mut">{e.system}</span><div>{e.action}{e.new_state && <span className="mut"> — {e.new_state}</span>}</div>{e.ai_recommendation && <div className="tiny">AI: {e.ai_recommendation} {e.human_decision && <>· Human: {e.human_decision}</>}</div>}{e.override_reason && <div className="tiny" style={{ color: 'var(--red)' }}>Override reason: {e.override_reason}</div>}{e.rule && <div className="tiny mut">Rule: {e.rule}</div>}</div></div>)}</div>}

    {dact && <ActionModal c={c} a={dact} onClose={() => setDact(null)} onDone={() => { setDact(null); load(); }} />}
    {act && <DecisionModal c={c} act={act} rec={rec} onClose={() => setAct(null)} onDone={() => { setAct(null); load(); }} />}
  </>;
}

function DecisionModal({ c, act, rec, onClose, onDone }) {
  const [reason, setReason] = useState(''), [err, setErr] = useState(''), [needReason, setNeed] = useState(false); const toast = useToast();
  const agrees = (act === 'APPROVE' && ['APPROVE', 'AUTO_PROCESS'].includes(rec.action)) || (act === 'REQUEST_INFORMATION' && rec.action === 'REQUEST_INFORMATION') || (act === 'ESCALATE' && ['ESCALATE', 'EDD_REQUIRED', 'LEGAL_REVIEW_REQUIRED', 'REVIEW'].includes(rec.action));
  const submit = async () => { try { await api(`/cases/${c.ref}/decision`, { action: act, reason }); toast(`${act.replace(/_/g, ' ')} recorded ✓`); onDone(); } catch (e) { if (e.code === 'OVERRIDE_REASON') setNeed(true); setErr(e.message); } };
  return <Modal title={act.replace(/_/g, ' ')} onClose={onClose}>
    <div className="small">Sentinel recommended <b>{rec.action?.replace(/_/g, ' ')}</b> ({rec.confidence}%).</div>
    {!agrees && <div className="reco small"><b>You are overriding the AI recommendation.</b> A reason is mandatory and will be visible to Internal Audit.</div>}
    {act === 'REJECT' && <div className="small mut">The justification is shown to the customer in TOBi ("My requests").</div>}
    <textarea className="input" rows={3} placeholder={act === 'REQUEST_INFORMATION' ? 'What do you need from the customer? (sent via TOBi)' : act === 'ESCALATE' ? 'Reason / target department (AML, RISK, LEGAL, COMPLIANCE, INTERNAL_CONTROL)' : agrees ? 'Comment (optional)' : 'REASON FOR OVERRIDE (required)'} value={reason} onChange={e => setReason(e.target.value)} />
    {err && <div style={{ color: 'var(--red)' }} className="small">{err}</div>}
    <button className="btn primary" onClick={submit} disabled={(!agrees || needReason || act === 'REJECT') && reason.trim().length < 5}>Confirm {act.replace(/_/g, ' ').toLowerCase()}</button>
  </Modal>;
}

function ActionModal({ c, a, onClose, onDone }) {
  const [note, setNote] = useState(''), [err, setErr] = useState(''); const toast = useToast();
  const ph = { REQUEST_EDD: 'Documents required (e.g. proof of source of funds, 3 months bank statements)', ADD_MITIGATION: 'Mitigation measure (e.g. daily limit 500 USD for 30 days)', REQUEST_REVISION: 'Clauses to revise', INITIATE_REMEDIATION: 'Corrective action to perform', CLOSE_CONTROL: 'Evidence / closure comment', AUDIT_FLAG: 'Assurance concern' }[a.action];
  const submit = async () => { try { const r = await api(`/cases/${c.ref}/action`, { action: a.action, note }); toast(`${a.label} recorded ✓${r.result?.case_ref ? ' — ' + r.result.case_ref : ''}`); onDone(); } catch (e) { setErr(e.message); } };
  return <Modal title={a.label} onClose={onClose}>
    <div className="small">Case <b className="mono">{c.ref}</b> · {c.customer_name}. Persisted in decisions and the audit trail.</div>
    {a.note && <textarea className="input" rows={3} placeholder={ph} value={note} onChange={e => setNote(e.target.value)} />}
    {err && <div style={{ color: 'var(--red)' }} className="small">{err}</div>}
    <button className="btn primary" onClick={submit} disabled={a.note && note.trim().length < 5}>Confirm</button>
  </Modal>;
}

// ======================= Case file: the real submitted documents, with Sentinel's findings highlighted =======================
const DOC_LABEL = { NATIONAL_ID: 'Identity document', RCCM: 'RCCM certificate', PROOF_OF_ADDRESS: 'Proof of address', STATEMENT: 'G2 account statement', SCREENING: 'Sanctions screening result', CONTRACT: 'Partner contract', SIM_SWAP_FORM: 'SIM swap request form', SCREENSHOT: 'Customer screenshot (SMS)', TAX: 'Tax certificate', ID_NAT: 'ID NAT certificate', OTHER: 'Other document' };
const FL = { owner_name: 'Name', full_name: 'Full name', id_number: 'Document number', id_type: 'Document type', id_expiry: 'Expiry date', date_of_birth: 'Date of birth', issuing_authority: 'Issuing authority', rccm: 'RCCM number', id_nat: 'ID NAT', tax_number: 'Tax number (NIF)', legal_name: 'Legal name', trading_name: 'Trading name', legal_form: 'Legal form', address: 'Address', commune: 'Commune', city: 'City', business_activity: 'Business activity', issue_date: 'Issue date', holder_name: 'Holder / subscriber', mrz: 'MRZ (machine-readable zone)', msisdn: 'M-Pesa number', swap_reason: 'Reason', new_iccid: 'New SIM (ICCID)', request_date: 'Request date', signature: 'Signature', agent: 'Agent', pattern: 'Pattern detected', period: 'Period', flagged_transactions: 'Flagged transactions', tx_ref: 'Transaction ID', amount: 'Amount', counterparty: 'Recipient', tx_date: 'Transaction date', match_name: 'List entry', match_score: 'Similarity score', match_birth: 'Listed date of birth', list: 'Sanctions list', partner: 'Contracting party', contract_title: 'Contract' };
const docTitle = (doc) => doc.doc_type === 'NATIONAL_ID' && doc.ex_fields?.id_type ? doc.ex_fields.id_type : (DOC_LABEL[doc.doc_type] || String(doc.doc_type || 'Document').replace(/_/g, ' '));
const S_LABEL = { bad: 'Exception', warn: 'To check', ok: 'Verified', info: 'Read' };
const docState = (doc) => { const v = Object.values(doc.marks || {}).map(m => m.s); return v.includes('bad') ? 'bad' : v.includes('warn') ? 'warn' : doc.status === 'MANUAL_REVIEW' || doc.status === 'UNREADABLE' ? 'warn' : 'ok'; };

function Findings({ d, onOpen }) {
  const list = d.findings || [];
  const bad = list.filter(f => f.s === 'bad').length, warn = list.filter(f => f.s === 'warn').length;
  return <div className="card pad">
    <div className="row"><div className="kicker grow">Key findings in the case file</div><span className="small mut">📎 {d.documents.length} document{d.documents.length !== 1 ? 's' : ''}</span></div>
    {!list.some(f => f.s === 'bad' || f.s === 'warn') && <div className="finding ok" onClick={() => onOpen(null)}><span className="fi">✓</span><div><div>All documents read and consistent with the declared data.</div>{d.waiting && <div className="tiny mut" style={{ marginTop: 3 }}>The case is still open for another reason — waiting for <b>{d.waiting.who}</b> (see “Why is this case waiting?”).</div>}</div></div>}
    {list.slice(0, 6).map((f, i) => <div key={i} className={'finding ' + f.s} onClick={() => onOpen(f)}><span className="fi">{f.s === 'bad' ? '!' : f.s === 'warn' ? '?' : 'i'}</span><div className="grow"><div className="b small">{f.label}</div>{(f.declared || f.found) && <div className="tiny mut">{f.declared ? <>declared <b>{f.declared}</b></> : ''}{f.declared && f.found ? ' · ' : ''}{f.found ? <>document <b>{f.found}</b></> : ''}</div>}</div><span className="tiny mut">View →</span></div>)}
    {list.length > 6 && <div className="tiny mut" style={{ marginTop: 6 }}>+{list.length - 6} more in the case file</div>}
    <button className="btn sm" style={{ marginTop: 10 }} onClick={() => onOpen(list[0] || null)}>Open case file{bad + warn ? ` (${bad} exception${bad !== 1 ? 's' : ''}, ${warn} to check)` : ''}</button>
  </div>;
}

function CaseFile({ d, focus }) {
  const docs = d.documents || [];
  const [sel, setSel] = useState(() => focus?.doc_id || docs.find(x => docState(x) === 'bad')?.id || docs[0]?.id);
  const [hl, setHl] = useState(focus?.field || null), [show, setShow] = useState(true), [zoom, setZoom] = useState(1);
  useEffect(() => { if (focus?.doc_id) { setSel(focus.doc_id); setHl(focus.field || null); } }, [focus]);
  const doc = docs.find(x => x.id === sel) || docs[0];
  if (!docs.length) return <div className="card pad mut">No document in this case file.</div>;
  const fields = doc ? [...new Set([...Object.keys(doc.boxes || {}), ...Object.keys(doc.ex_fields || {})])].filter(k => !['id_type'].includes(k) || !doc.boxes?.[k]) : [];
  const stOf = (k) => doc.marks?.[k]?.s || doc.boxes?.[k]?.s || (doc.boxes?.[k] ? 'info' : 'none');
  const order = { bad: 0, warn: 1, ok: 2, info: 3, none: 4 };
  fields.sort((a, b) => order[stOf(a)] - order[stOf(b)]);
  const isPdf = /pdf/.test(doc.mime || '');
  const src = '/api/documents/' + doc.id + '/file';
  const rel = (d.findings || []).filter(f => f.doc_id === doc.id);
  const flaggedN = Object.keys(doc.boxes || {}).filter(k => ['bad', 'warn'].includes(stOf(k))).length;
  return <div className="cf">
    <div className="cf-list">
      {docs.map(x => { const st = docState(x); const n = Object.values(x.marks || {}).filter(m => m.s === 'bad' || m.s === 'warn').length; return <button key={x.id} className={'cf-doc' + (x.id === doc.id ? ' on' : '')} onClick={() => { setSel(x.id); setHl(null); setZoom(1); }}>
        <div className="cf-thumb"><img src={'/api/documents/' + x.id + '/file'} alt="" onError={e => e.target.style.visibility = 'hidden'} /></div>
        <div className="grow" style={{ minWidth: 0 }}><div className="b small ell">{docTitle(x)}</div><div className="tiny mut ell">{x.filename}</div>
          <div className="row" style={{ gap: 6, marginTop: 4 }}><span className={'stchip ' + st}>{st === 'bad' ? 'Exception' : st === 'warn' ? 'To check' : 'Verified'}</span>{n > 0 && <span className="tiny mut">{n} point{n > 1 ? 's' : ''}</span>}{x.on_file && <span className="tiny mut">on file (G2)</span>}</div></div>
      </button>; })}
    </div>
    <div className="cf-view card">
      <div className="cf-bar"><div className="grow" style={{ minWidth: 0 }}><div className="b ell">{docTitle(doc)} <span className="mut small">· {doc.filename}</span></div><div className="tiny mut">Received {fmtTime(doc.uploaded_at)} · read by {doc.ex_mode === 'AI' ? 'AI vision' : doc.ex_mode || 'OCR'}{doc.expiry_date ? ` · valid until ${doc.expiry_date}` : ''}</div></div>
        <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} /> Highlights</label>
        <div className="seg sm">{[1, 1.5, 2].map(z => <button key={z} className={zoom === z ? 'on' : ''} onClick={() => setZoom(z)}>{z * 100}%</button>)}</div>
        <a className="btn sm" href={src} target="_blank">Open original ↗</a></div>
      {rel.length > 0 && <div className="cf-alerts">{(rel.length > 3 ? rel.slice(0, 2) : rel).map((f, i) => <div key={i} className={'cf-alert ' + f.s} onClick={() => setHl(f.field)}>{f.s === 'bad' ? '⛔' : f.s === 'warn' ? '⚠️' : 'ℹ️'} {f.label}{f.found && <b> — {f.found}</b>}</div>)}{rel.length > 3 && <div className="tiny mut">+ {rel.length - 2} more points highlighted on the document</div>}</div>}
      <div className="cf-stage">
        {isPdf ? <iframe src={src} className="cf-pdf" title="document" /> :
          <div className="cf-img" style={{ width: zoom * 100 + '%' }}>
            <img src={src} alt={docTitle(doc)} />
            {show && Object.entries(doc.boxes || {}).map(([k, b]) => { const st = stOf(k); const m = doc.marks?.[k]; return (b.r || []).map((r, i) => <div key={k + i} className={'hl ' + st + (hl === k ? ' act' : '') + (hl && hl !== k ? ' dim' : '')} style={{ left: r.x + '%', top: r.y + '%', width: r.w + '%', height: r.h + '%' }} onMouseEnter={() => setHl(k)} onMouseLeave={() => setHl(null)} title={`${FL[k] || b.label || k}${doc.ex_fields?.[k] ? ': ' + doc.ex_fields[k] : ''}${m?.note ? ' — ' + m.note : b.note ? ' — ' + b.note : ''}`}>
              {i === 0 && (hl === k || ((st === 'bad' || st === 'warn') && flaggedN <= 4)) && <span className="hl-tag">{st === 'bad' ? '!' : st === 'warn' ? '?' : '✓'} {FL[k] || b.label || k}</span>}
            </div>); })}
          </div>}
      </div>
    </div>
    <div className="cf-fields card">
      <div className="kicker" style={{ padding: '14px 16px 6px' }}>What Sentinel read on this document</div>
      {fields.length === 0 && <div className="pad small mut">{doc.status === 'MANUAL_REVIEW' || doc.status === 'UNREADABLE' ? 'Photo unreadable — the customer typed the details in TOBi; an agent must check them against the image.' : 'No field extracted.'}</div>}
      {fields.map(k => { const st = stOf(k), m = doc.marks?.[k], b = doc.boxes?.[k]; const v = doc.ex_fields?.[k] ?? b?.label ?? ''; return <div key={k} className={'cf-f ' + st + (hl === k ? ' act' : '')} onMouseEnter={() => setHl(k)} onMouseLeave={() => setHl(null)} onClick={() => setHl(k)}>
        <div className="row" style={{ gap: 8 }}><span className={'stdot ' + st} /><span className="tiny mut grow">{FL[k] || b?.label || k.replace(/_/g, ' ')}</span>{doc.ex_conf?.[k] != null && <span className="tiny mut">{Math.round(doc.ex_conf[k] * 100)}%</span>}{st !== 'none' && st !== 'info' && <span className={'stchip ' + st}>{S_LABEL[st]}</span>}</div>
        <div className="b small" style={{ marginLeft: 16, wordBreak: 'break-word' }}>{String(v) || '—'}</div>
        {(m?.note || (b?.note && st !== 'info')) && <div className="tiny" style={{ marginLeft: 16, color: st === 'bad' ? 'var(--red-d)' : st === 'warn' ? '#8a5300' : 'var(--mut)' }}>{m?.note || b.note}</div>}
      </div>; })}
      {doc.precheck?.length > 0 && <div style={{ padding: '10px 16px 14px' }}><div className="kicker" style={{ marginBottom: 6 }}>Pre-checks</div><div className="row wrap" style={{ gap: 6 }}>{doc.precheck.map((c, i) => <span key={i} className={'stchip ' + (c.ok ? (c.warn ? 'warn' : 'ok') : 'bad')}>{c.ok ? '✓' : '✕'} {c.label}</span>)}</div></div>}
      <div className="tiny mut" style={{ padding: '0 16px 14px' }}>Green = verified against declared data / G2 · Amber = to check · Red = exception. Hover a field to locate it on the document.</div>
    </div>
  </div>;
}
