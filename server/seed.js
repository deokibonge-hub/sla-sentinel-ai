// Realistic FICTIONAL demo data. No real customer data.
import { backfillCalls } from './trust.js';
import fs from 'node:fs';
import path from 'node:path';
import { run, get, all, s, wipe, setSetting, DATA_DIR, db } from './db.js';
import { hashPw, ROLES, PERMS, DAY, HOUR } from './core.js';
import { initDossier, buildCase, identity, business, accountIdDoc, accountRccmDoc } from './dossier.js';
export const USERS = [['ops', 'Aline Kapinga', 'OPS_AGENT'], ['opsmanager', 'Robert Mbala', 'OPS_MANAGER'], ['aml', 'Sylvie Mwamba', 'AML_OFFICER'], ['compliance', 'Didier Kasongo', 'COMPLIANCE_OFFICER'], ['risk', 'Mireille Lukusa', 'RISK_MANAGER'], ['control', 'Patrick Ilunga', 'IC_OFFICER'], ['legal', 'Maître Esther Nzuzi', 'LEGAL_OFFICER'], ['audit', 'Joseph Kabongo', 'AUDITOR'], ['admin', 'Sentinel Admin', 'ADMIN']];

let seedN = 20261008;
const rnd = () => { seedN = (seedN * 16807) % 2147483647; return seedN / 2147483647; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pad = (n, l) => String(n).padStart(l, '0');

const FIRST = ['Jean-Paul', 'Grace', 'Patrick', 'Esther', 'Dieudonné', 'Merveille', 'Christian', 'Nathalie', 'Fiston', 'Rachel', 'Héritier', 'Chantal', 'Junior', 'Sarah', 'Glody', 'Bénédicte', 'Trésor', 'Divine', 'Cédric', 'Ornella', 'Joël', 'Prisca', 'Arsène', 'Gloire', 'Serge', 'Naomie', 'Blaise', 'Ruth'];
const LAST = ['Mukendi', 'Kabeya', 'Ilunga', 'Mbuyi', 'Kasongo', 'Lukusa', 'Ngalula', 'Kalala', 'Mutombo', 'Tshiala', 'Banza', 'Kayembe', 'Mwamba', 'Nzuzi', 'Makiese', 'Lokonga', 'Bokele', 'Kabongo', 'Mpiana', 'Nsimba', 'Matondo', 'Kiala', 'Luzolo', 'Mavinga'];
const SHOP = ['Alimentation', 'Pharmacie', 'Boutique', 'Quincaillerie', 'Ets', 'Super Marché', 'Restaurant', 'Cosmétiques', 'Phone Center', 'Boulangerie', 'Dépôt', 'Salon'];
const SHOP2 = ['La Grâce', 'Bon Prix', 'Elikia', 'Mama Nzambe', 'Victoire', 'Kin Lumière', 'Tout-Va-Bien', 'Espoir', 'Matonge Star', 'Bondeko', 'Excellence', 'Nouvelle Vision', 'Le Bon Berger', 'Ya Biso', 'Bilembo', 'Kitoko'];
const COMMUNES = ['Gombe', 'Limete', 'Kintambo', 'Ngaliema', 'Bandalungwa', 'Lingwala', 'Kalamu', 'Masina', 'Lemba', 'Matete', 'Kasa-Vubu', 'Barumbu', 'Ngiri-Ngiri', 'Kinshasa'];
const AVES = ['du Commerce', 'Kasa-Vubu', 'de la Libération', 'Kabambare', 'des Huileries', 'Lumumba', 'Bokasa', 'de la Paix', 'Tombalbaye', 'Kianza'];
const name = () => `${pick(FIRST)} ${pick(LAST)}`;
const shop = () => `${pick(SHOP)} ${pick(SHOP2)}`;
const msisdn = () => '243' + pick(['81', '82', '83', '97', '99', '84', '85']) + pad(int(0, 9999999), 7);

export function seed(reset = false) {
  if (reset) wipe();
  db.exec('BEGIN');
  try { seedInner(); run('DELETE FROM integration_calls'); backfillCalls(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
}
function seedInner() {
  seedN = 20261008;
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  setSetting('clock_offset_ms', 0); setSetting('last_tick_ms', now); setSetting('noncompliance_prevented', 0); setSetting('g2_fail_next', false);

  // ---- roles, permissions, users ----
  for (const [code, r] of Object.entries(ROLES)) { run('INSERT INTO roles(code,name,department) VALUES(?,?,?)', code, r.name, r.dept); for (const p of PERMS[code]) run('INSERT INTO permissions(role,permission) VALUES(?,?)', code, p); }
  for (const [u, n, r] of USERS) { const { hash, salt } = hashPw('demo123'); run('INSERT INTO users(username,password_hash,salt,name,role) VALUES(?,?,?,?,?)', u, hash, salt, n, r); }

  // ---- policies (configurable rules) ----
  const P = [
    ['decision_policy', 'DECISION', { stp_enabled: true, auto_max: 30, specialist: 60, aml_edd: 70, compliance: 80, legal: 60 }, 'Risk thresholds for straight-through processing and routing'],
    ['sla_hours', 'SLA', { MERCHANT_ONBOARDING: 48, AGENT_ONBOARDING: 72, KYC_UPDATE: 72, SIM_SWAP: 4, PIN_RESET: 2, DOCUMENT_RENEWAL: 720, AML_REVIEW: 72, CONTRACT_REVIEW: 120, SUPPORT: 8 }, 'SLA targets per case type (hours)'],
    ['expiry_thresholds', 'MONITORING', [90, 30, 7, 0], 'Document expiry thresholds (days): EXPIRING SOON / ACTION REQUIRED / COMPLIANCE AT RISK / EXPIRED'],
    ['lifecycle', 'LIFECYCLE', { educate_days: 3, training_days: 4, support_days: 5, engage_days: 7 }, 'Days after activation for EDUCATE / AML training / SUPPORT check-in / ENGAGE offer'],
    ['required_documents', 'DOCUMENTS', { MI: ['NATIONAL_ID', 'RCCM', 'PROOF_OF_ADDRESS'], MD: ['NATIONAL_ID', 'RCCM', 'PROOF_OF_ADDRESS'], MA: ['NATIONAL_ID', 'RCCM', 'PROOF_OF_ADDRESS'], MIL: ['NATIONAL_ID', 'RCCM', 'PROOF_OF_ADDRESS'], MR: ['NATIONAL_ID'] }, 'Required documents per merchant contract type (BCF)'],
    ['aml_rules', 'AML', { structuring_band: [900, 999], structuring_count_24h: 3, ato_cash_out_usd: 800, high_turnover_usd: 10000, audited_statements_above_usd_year: 10000 }, 'AML/CFT monitoring rules'],
    ['control_rules', 'CONTROL', { maker_checker: true, sensitive_g2_ops_require_case: ['SIM_SWAP', 'PIN_RESET', 'DELETE', 'SUSPEND'], override_rate_threshold_pct: 8, aml_training_pass_pct: 80 }, 'Continuous control monitoring'],
  ];
  for (const [k, c, v, d] of P) run('INSERT INTO policies(key,category,value,description,updated_by,updated_at) VALUES(?,?,?,?,?,?)', k, c, s(v), d, 'seed', iso(now));

  // ---- G2 accounts ----
  const accounts = [];
  initDossier({ rnd, pick, int, now, FIRST, LAST, SHOP, SHOP2, COMMUNES, AVES, msisdn });
  const addAcc = (type, i) => {
    const p = identity(pick(FIRST), pick(LAST).split(' ')[0]);
    const owner = `${p.given} ${p.surname}`;
    const commune = pick(COMMUNES), address = `${int(1, 250)}, Avenue ${pick(AVES)}`;
    const trading = type === 'CUSTOMER' ? null : type === 'AGENT' ? `Agent ${pick(SHOP2)} ${commune}` : shop();
    const company = type === 'MERCHANT' ? rnd() < 0.5 : rnd() < 0.25;
    const biz = trading ? business(trading, `${owner} ${p.postnom}`, commune, address, company) : null;
    if (biz && type === 'AGENT') biz.activity = 'Agent M-Pesa — dépôts et retraits (cash-in / cash-out)';
    const created = now - int(12, 700) * DAY;
    const acc = { msisdn: msisdn(), account_type: type, name: type === 'CUSTOMER' ? owner : biz.legal_name, trading_name: trading, owner, created_at: iso(created) };
    const id_number = p.id_number;
    const profile = type === 'CUSTOMER' ? { daily: 0.6 + rnd() * 1.5, avg: int(5, 60) } : type === 'AGENT' ? { daily: int(8, 30), avg: int(20, 120) } : { daily: rnd() < 0.2 ? 0.3 : int(2, 25), avg: int(4, 60) };
    const r0 = rnd();
    const idExp = type === 'CUSTOMER' ? now + int(200, 2500) * DAY : r0 < 0.06 ? now - int(1, 40) * DAY : r0 < 0.16 ? now + int(2, 29) * DAY : r0 < 0.28 ? now + int(31, 89) * DAY : now + int(120, 1500) * DAY;
    const kyc = { owner_name: `${owner} ${p.postnom}`, id_type: p.id_type, id_number, id_expiry: iso(idExp).slice(0, 10), commune, city: 'Kinshasa', address, merchant_id: type === 'MERCHANT' ? '0' + pad(int(100000, 999999), 6) : type === 'AGENT' ? 'AGT-' + pad(int(100000, 999999), 6) : null, profile, person: p, business: biz };
    run(`INSERT INTO g2_accounts(msisdn,account_type,short_code,till_number,name,trading_name,contract_type,kyc,status,balance,float_balance,currency,sim_iccid,pin_status,region,g2_ref,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      acc.msisdn, type, type === 'CUSTOMER' ? null : String(700000 + int(0, 299999)), type === 'MERCHANT' ? String(int(100000, 999999)) : null, acc.name, trading, type === 'MERCHANT' ? pick(['MI', 'MI', 'MR', 'MA', 'MD']) : null, s(kyc), 'ACTIVE', 0, type === 'AGENT' ? int(50, 3000) : 0, 'USD', '8924301' + pad(int(0, 999999999), 12), 'SET', 'Kinshasa', 'G2-CR-' + pad(int(0, 999999), 6), acc.created_at, acc.created_at);
    // transactions (last 30 days)
    let bal = int(5, 400);
    for (let d = 30; d >= 0; d--) {
      const n = Math.min(12, Math.round(profile.daily * (0.5 + rnd())));
      for (let k = 0; k < n; k++) {
        const amt = Math.max(1, Math.round(profile.avg * (0.4 + rnd() * 1.2)));
        const t = type === 'MERCHANT' ? (rnd() < 0.9 ? 'PAYMENT_RECEIVED' : 'CASH_OUT') : type === 'AGENT' ? pick(['CASH_IN', 'CASH_OUT']) : pick(['P2P_SEND', 'P2P_RECEIVE', 'CASH_IN', 'CASH_OUT', 'PAYMENT_SENT']);
        const credit = ['CASH_IN', 'PAYMENT_RECEIVED', 'P2P_RECEIVE'].includes(t); bal = Math.max(0, bal + (credit ? amt : -amt));
        run('INSERT INTO g2_transactions(msisdn,tx_ref,type,amount,counterparty,balance_after,ts) VALUES(?,?,?,?,?,?,?)', acc.msisdn, 'TX' + pad(int(0, 999999999), 9), t, amt, 'Customer +243 ' + pick(['81', '82', '97', '99']) + ' ' + pad(int(0, 999), 3) + ' ' + pad(int(0, 9999), 4), bal, iso(now - d * DAY - int(0, 20) * HOUR));
      }
    }
    run('UPDATE g2_accounts SET balance=? WHERE msisdn=?', bal, acc.msisdn);
    run('INSERT INTO g2_operations(msisdn,op,operator,case_ref,detail,ts) VALUES(?,?,?,?,?,?)', acc.msisdn, 'ACCOUNT_CREATED', 'G2 legacy batch', null, 'Migrated account', acc.created_at);
    if (type !== 'CUSTOMER') {
      accountIdDoc(acc, kyc, idExp, acc.created_at);
      if (type === 'MERCHANT' || rnd() < 0.5) accountRccmDoc(acc, kyc, acc.created_at);
    }
    accounts.push({ ...acc, kyc, id_number });
    return acc;
  };
  for (let i = 0; i < 46; i++) addAcc('MERCHANT', i);
  for (let i = 0; i < 26; i++) addAcc('AGENT', i);
  for (let i = 0; i < 40; i++) addAcc('CUSTOMER', i);
  // related accounts: same ID on 3 accounts
  const rel = accounts.filter(a => a.account_type === 'CUSTOMER').slice(0, 3);
  const relId = rel[0].kyc.id_number;
  for (const a of rel) { const k = { ...a.kyc, id_number: relId }; run('UPDATE g2_accounts SET kyc=? WHERE msisdn=?', s(k), a.msisdn); }
  // structuring agent
  const structAgent = accounts.filter(a => a.account_type === 'AGENT')[2];
  for (let k = 0; k < 4; k++) run('INSERT INTO g2_transactions(msisdn,tx_ref,type,amount,counterparty,balance_after,ts) VALUES(?,?,?,?,?,?,?)', structAgent.msisdn, 'TX' + pad(int(0, 999999999), 9), 'CASH_IN', 940 + int(0, 55), 'Walk-in depositor', 0, iso(now - (10 - k) * HOUR));

  // ---- cases ----
  const TYPES = [['MERCHANT_ONBOARDING', 'MP-ONB', 'OPERATIONS', 48, 34], ['AGENT_ONBOARDING', 'MP-AGT', 'OPERATIONS', 72, 22], ['SIM_SWAP', 'MP-SWP', 'OPERATIONS', 48, 22], ['KYC_UPDATE', 'MP-KYC', 'COMPLIANCE', 72, 18], ['DOCUMENT_RENEWAL', 'MP-REN', 'COMPLIANCE', 720, 18], ['AML_REVIEW', 'MP-AML', 'AML', 72, 16], ['CONTRACT_REVIEW', 'MP-LEG', 'LEGAL', 120, 10], ['SUPPORT', 'MP-SUP', 'OPERATIONS', 8, 14]];
  let seq = 900;
  const DEC_USERS = [['Aline Kapinga', 'OPS_AGENT'], ['Robert Mbala', 'OPS_MANAGER'], ['Sylvie Mwamba', 'AML_OFFICER'], ['Didier Kasongo', 'COMPLIANCE_OFFICER'], ['Pascal Tshimanga', 'OPS_AGENT']];
  for (const [type, pre, dept, hours, count] of TYPES) {
    for (let i = 0; i < count; i++) {
      const acc = pick(accounts.filter(a => type.includes('AGENT') ? a.account_type === 'AGENT' : type === 'SIM_SWAP' || type === 'SUPPORT' ? true : a.account_type !== 'CUSTOMER'));
      const created = now - rnd() * (type === 'DOCUMENT_RENEWAL' ? 25 : 14) * DAY;
      const roll = rnd();
      const resolved = roll < 0.7;
      const breachedRes = resolved && rnd() < 0.06;
      const resolvedAt = resolved ? created + hours * HOUR * (breachedRes ? 1.1 + rnd() * 0.6 : 0.15 + rnd() * 0.75) : null;
      let start = created, due = created + hours * HOUR;
      if (!resolved) { // spread SLA states for open cases
        const st = rnd(); const frac = st < 0.7 ? 0.1 + rnd() * 0.5 : st < 0.88 ? 0.66 + rnd() * 0.23 : st < 0.94 ? 0.91 + rnd() * 0.08 : 1.05 + rnd() * 0.5;
        start = now - frac * hours * HOUR; due = start + hours * HOUR;
      }
      const frac = ((resolvedAt || now) - start) / (due - start);
      const sla = resolved ? (resolvedAt <= due ? 'MET' : 'BREACHED') : frac > 1 ? 'BREACHED' : frac > 0.9 ? 'CRITICAL' : frac > 0.65 ? 'AT_RISK' : 'ON_TRACK';
      const risk = type === 'AML_REVIEW' ? int(55, 92) : Math.round(5 + Math.pow(rnd(), 1.8) * 68);
      const lvl = risk >= 80 ? 'CRITICAL' : risk >= 60 ? 'HIGH' : risk >= 30 ? 'MEDIUM' : 'LOW';
      const status = resolved ? (rnd() < 0.08 ? 'REJECTED' : 'RESOLVED') : pick(['PENDING_REVIEW', 'PENDING_REVIEW', 'UNDER_REVIEW', 'AWAITING_CUSTOMER']);
      const stage = resolved ? pick(['MONITOR', 'RESOLVE', 'LEARN']) : pick(['VERIFY', 'RISK_SCORE', 'DECIDE', 'ORCHESTRATE']);
      const recAct = risk < 30 ? 'AUTO_PROCESS' : risk < 60 ? 'APPROVE' : type === 'AML_REVIEW' ? 'EDD_REQUIRED' : 'ESCALATE';
      const ref = `${pre}-2026-${pad(++seq, 6)}`;
      const c = run(`INSERT INTO cases(ref,type,account_msisdn,customer_name,status,stage,owner_dept,priority,risk_score,risk_level,sla_hours,sla_start,sla_due,sla_status,resolved_at,recommendation,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ref, type, acc.msisdn, acc.trading_name || acc.name, status, stage, dept, lvl === 'LOW' ? 'NORMAL' : lvl === 'MEDIUM' ? 'HIGH' : 'URGENT', risk, lvl, hours, iso(start), iso(due), sla, resolvedAt ? iso(resolvedAt) : null,
        s({ action: recAct, confidence: int(70, 97), reason: [recAct === 'AUTO_PROCESS' ? 'All documents verified, no exceptions' : 'Risk drivers require review'], rule: 'seed' }), 'SEED', iso(created), iso(resolvedAt || created));
      const cid = c.lastInsertRowid;
      for (const d of ['OPERATIONAL', 'COMPLIANCE', 'AML_CFT', 'FRAUD', 'LEGAL']) { const sc = Math.max(2, Math.min(100, risk + int(-35, 15))); run('INSERT INTO risk_assessments(case_id,dimension,score,level,factors,created_at) VALUES(?,?,?,?,?,?)', cid, d, sc, sc >= 80 ? 'CRITICAL' : sc >= 60 ? 'HIGH' : sc >= 30 ? 'MEDIUM' : 'LOW', s([]), iso(created)); }
      run('INSERT INTO audit_events(ts,actor,role,system,action,case_ref,new_state) VALUES(?,?,?,?,?,?,?)', iso(created), 'Sentinel AI', 'SYSTEM', 'SENTINEL', 'Case created', ref, 'SUBMITTED');
      run('INSERT INTO audit_events(ts,actor,role,system,action,case_ref,new_state,risk_score,ai_recommendation) VALUES(?,?,?,?,?,?,?,?,?)', iso(created + 4000), 'Sentinel AI', 'SYSTEM', 'SENTINEL', 'Risk assessment', ref, `Overall risk ${risk}/100 (${lvl})`, risk, recAct);
      if (resolved) {
        const auto = recAct === 'AUTO_PROCESS' && rnd() < 0.8;
        const [dn, dr] = auto ? ['Sentinel AI (policy STP)', 'SYSTEM'] : pick(DEC_USERS);
        const night = !auto && rnd() < 0.07;
        const decAt = night ? new Date(new Date(resolvedAt).setUTCHours(1, int(0, 59))).getTime() : resolvedAt - 60000;
        const override = !auto && rnd() < 0.09;
        const act = status === 'REJECTED' ? 'REJECT' : 'APPROVE';
        run('INSERT INTO decisions(case_id,actor,role,action,ai_action,override,reason,created_at) VALUES(?,?,?,?,?,?,?,?)', cid, dn, dr, act, recAct, override ? 1 : 0, override ? pick(['Customer known to branch manager', 'Business urgency — sales campaign', 'Document accepted after phone call', 'Risk accepted by supervisor']) : null, iso(decAt));
        run('INSERT INTO audit_events(ts,actor,role,system,action,case_ref,ai_recommendation,human_decision,override,override_reason,risk_score) VALUES(?,?,?,?,?,?,?,?,?,?,?)', iso(decAt), dn, dr, 'SENTINEL', auto ? 'Straight-through processing' : 'Human decision: ' + act, ref, recAct, act, override ? 1 : 0, override ? 'see decision' : null, risk);
        run('INSERT INTO audit_events(ts,actor,role,system,action,case_ref,new_state) VALUES(?,?,?,?,?,?,?)', iso(resolvedAt), status === 'REJECTED' ? dn : 'G2 Simulator', status === 'REJECTED' ? dr : 'SYSTEM', status === 'REJECTED' ? 'SENTINEL' : 'G2', status === 'REJECTED' ? 'Case rejected' : 'Account operation completed', ref, status);
      }
      buildCase({ type, ref, cid: Number(cid), acc, resolved, status, created: iso(created) });
    }
  }

  // ---- alerts (cross-department intelligence feed) ----
  const A = (dept, severity, type, title, detail, why, recommendation, extra = {}) => run('INSERT INTO alerts(dept,type,severity,title,detail,why,recommendation,case_ref,account_msisdn,status,rule,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
    dept, type, severity, title, detail, s(why), recommendation, extra.case_ref || null, extra.msisdn || null, extra.status || 'OPEN', extra.rule || ('SEED_' + type + '_' + int(0, 1e9)), iso(now - (extra.ago ?? int(1, 60)) * HOUR), iso(now));
  const W = (...p) => p.map(([points, label]) => ({ points, label }));
  const openCases = all("SELECT * FROM cases WHERE status NOT IN ('RESOLVED','REJECTED','CLOSED')");
  for (const c of openCases.filter(c => ['AT_RISK', 'CRITICAL', 'BREACHED'].includes(c.sla_status))) {
    const frac = (now - new Date(c.sla_start)) / (new Date(c.sla_due) - new Date(c.sla_start));
    A(c.owner_dept === 'OPERATIONS' ? 'OPERATIONS' : c.owner_dept, c.sla_status === 'BREACHED' ? 'CRITICAL' : c.sla_status === 'CRITICAL' ? 'HIGH' : 'MEDIUM', 'SLA', `SLA ${c.sla_status.replace('_', ' ')}: ${c.ref} (${c.customer_name})`,
      c.sla_status === 'BREACHED' ? `Breached ${Math.round((frac - 1) * c.sla_hours)} h ago · next action: ${c.stage}` : `Breach probability ${Math.round(100 / (1 + Math.exp(-10 * (frac - 0.72))))}% · next action: ${c.stage}`,
      W([Math.round(frac * 50), `${Math.round(frac * 100)}% of SLA consumed`], [15, `Stage: ${c.stage}`], [10, `${c.type.replace(/_/g, ' ').toLowerCase()}`]), c.sla_status === 'BREACHED' ? 'Escalate to Operations Manager' : 'PRIORITIZE NOW', { case_ref: c.ref, rule: 'SLA_' + c.sla_status, ago: int(0, 6) });
  }
  const M = accounts.filter(a => a.account_type === 'MERCHANT'), AG = accounts.filter(a => a.account_type === 'AGENT'), CU = accounts.filter(a => a.account_type === 'CUSTOMER');
  const amlCase = openCases.find(c => c.type === 'AML_REVIEW');
  // OPERATIONS
  const g2f = openCases.find(c => c.status === 'G2_FAILED') || openCases[3];
  A('OPERATIONS', 'HIGH', 'G2_FAILURE', `${g2f?.ref}: G2 creation failed`, 'G2-ERR-503 Upstream timeout while provisioning till number', W([50, 'G2-ERR-503 timeout'], [10, '2nd attempt']), 'Retry creation from Case 360', { case_ref: g2f?.ref, ago: 3 });
  A('OPERATIONS', 'MEDIUM', 'FLOAT', `Agent float below threshold: ${AG[4].trading_name}`, 'Float 38 USD vs 7-day average withdrawals of 610 USD/day — customers will be turned away.', W([40, 'Float < 10% of daily cash-out'], [20, 'Peak hours approaching']), 'Notify super agent / propose float top-up via TOBi', { msisdn: AG[4].msisdn, ago: 2 });
  A('OPERATIONS', 'MEDIUM', 'BACKLOG', 'Backlog building: Agent onboarding — Document review stage', '23 cases waiting at VERIFY for > 24h (+41% vs last week).', W([30, '23 cases > 24h at VERIFY'], [20, '+41% week on week']), 'Re-balance queue: assign 2 agents to document review', { ago: 5 });
  A('OPERATIONS', 'LOW', 'CALLBACK', 'Customer requested a callback (onboarding)', 'Applicant asked to talk to an agent from TOBi.', W([15, 'Customer-initiated']), 'Call back within 8h', { ago: 1 });
  // AML
  const amlSan = openCases.find(c => c.type === 'AML_REVIEW' && (c.details || '').includes('Sanctions screening'));
  A('AML', 'CRITICAL', 'AML_ALERT', `Sanctions screening — potential match: ${amlSan ? JSON.parse(amlSan.details).fields.kyc_owner : M[7].owner}`, 'Name similarity 91% with an entry on a consolidated sanctions list (simulated screening provider).', W([45, 'Fuzzy name match 91%'], [20, 'Date of birth partially matches'], [15, 'Cross-border P2P activity']), 'Hold the account, perform manual disposition, document rationale', { case_ref: amlSan?.ref || amlCase?.ref, msisdn: amlSan?.account_msisdn, ago: 4 });
  A('AML', 'HIGH', 'AML_ALERT', `Possible structuring: ${structAgent.trading_name}`, '4 cash-ins between 940–995 USD in 10 hours (total 3,870 USD).', W([35, '4 deposits just below 1,000 USD'], [25, 'Threshold-avoidance pattern'], [12, 'Same-day concentration']), 'Enhanced due diligence; consider SAR to MLRO', { msisdn: structAgent.msisdn, rule: 'AML_STRUCTURING', ago: 2 });
  A('AML', 'HIGH', 'AML_ALERT', 'Related accounts: one ID document used on 3 wallets', `ID ${relId} linked to ${rel.map(a => a.name).join(', ')}.`, W([30, '3 wallets, 1 identity'], [25, 'Different names on same ID'], [17, 'Funds pooled to one wallet']), 'Freeze secondary wallets pending KYC re-verification', { msisdn: rel[0].msisdn, ago: 9 });
  A('AML', 'HIGH', 'PEP', `PEP declared at onboarding: ${M[11].trading_name}`, 'Owner declared a family link with a provincial official (BCF compliance questionnaire).', W([45, 'PEP declared'], [15, 'Expected turnover 18,000 USD/month']), 'EDD + senior management approval required', { msisdn: M[11].msisdn, ago: 20 });
  A('AML', 'MEDIUM', 'AML_ALERT', `Dormant wallet reactivated with high inflow: ${CU[8].name}`, 'No activity for 142 days, then 2,300 USD received from 9 different senders in 2 days.', W([30, 'Dormancy 142 days'], [25, '9 unique senders'], [10, 'Immediate cash-out']), 'Review source of funds', { msisdn: CU[8].msisdn, ago: 14 });
  // COMPLIANCE
  const expDocs = all("SELECT d.*, g.trading_name, g.name gname FROM documents d JOIN g2_accounts g ON g.msisdn=d.account_msisdn WHERE d.expiry_date IS NOT NULL AND d.replaced_by IS NULL AND d.expiry_date < ? ORDER BY d.expiry_date", iso(now + 30 * DAY).slice(0, 10));
  for (const d of expDocs.slice(0, 9)) {
    const days = Math.floor((new Date(d.expiry_date) - now) / DAY);
    A('COMPLIANCE', days < 0 ? 'CRITICAL' : days <= 7 ? 'HIGH' : 'MEDIUM', 'DOCUMENT_EXPIRY', `${days < 0 ? 'EXPIRED' : days <= 7 ? 'COMPLIANCE AT RISK' : 'ACTION REQUIRED'}: ID document — ${d.trading_name || d.gname}`, `Document expiry ${d.expiry_date}. TOBi renewal request sent.`, W([days < 0 ? 40 : 25, days < 0 ? `Expired ${-days} days ago` : `Expires in ${days} days`], [14, 'KYC validity is a mandatory control']), 'Renewal requested via TOBi', { msisdn: d.account_msisdn, rule: 'DOC_EXPIRY_' + d.id, ago: int(1, 30) });
  }
  A('COMPLIANCE', 'MEDIUM', 'TRAINING', '17 merchants have not completed AML/CFT awareness training', 'Required by the merchant agreement (score ≥ 80%). TOBi reminders scheduled.', W([25, '17 merchants without attestation'], [10, '3 scored below 80%']), 'Send TOBi training module + reminder', { ago: 30 });
  A('COMPLIANCE', 'MEDIUM', 'PARTNER_DD', 'Business partner due-diligence questionnaire overdue (VBU)', 'Annual identification & due-diligence questionnaire not renewed for 2 business partners.', W([25, 'Periodic review > 12 months'], [15, 'Partners with > 10k USD/year volume']), 'Request updated questionnaire + audited statements', { ago: 48 });
  A('COMPLIANCE', 'LOW', 'KYC_UPDATE', 'KYC update due: 42 customers (address change detected)', 'Address on recent SIM registration differs from wallet KYC.', W([15, 'KYC data drift']), 'TOBi KYC update campaign', { ago: 70 });
  // RISK
  for (const a of M.filter(m => m.kyc.profile.daily < 1).slice(0, 3)) A('RISK', 'MEDIUM', 'INACTIVITY_PREDICTED', `Inactivity predicted: ${a.trading_name}`, 'Probability of becoming dormant within 60 days: 78%. Dormant numbers are recycled after 6 months.', W([35, 'Fewer than 6 transactions in 7 days'], [20, 'Declining trend 3 weeks'], [10, 'Below segment median']), 'ENGAGE: activation offer via TOBi', { msisdn: a.msisdn, rule: 'RISK_INACTIVITY', ago: int(2, 40) });
  A('RISK', 'HIGH', 'EMERGING_RISK', 'Emerging risk: document exceptions +38% week on week', '72% of high-risk onboarding exceptions originate from the Document Verification stage (RCCM number mismatches).', W([30, '+38% exceptions w/w'], [25, '72% concentrated in one stage'], [10, 'Mostly agent-assisted channel']), 'Add RCCM format validation at capture; brief recruiting agents', { ago: 26 });
  A('RISK', 'HIGH', 'FRAUD_RISK', 'SIM swap fraud trend: Limete agent cluster', '11 SIM swaps followed by cash-out within 6h across 3 agents in Limete this week.', W([35, '11 SIM-swap→cash-out sequences'], [25, 'Concentrated on 3 agents'], [15, 'Night-time operations']), 'Temporary 24h cash-out hold after SIM swap for this cluster', { ago: 11 });
  A('RISK', 'MEDIUM', 'CONCENTRATION', 'Concentration risk: super agent float dependency', '38% of Gombe agent float provided by a single super agent.', W([30, 'Single point of failure'], [15, 'Liquidity risk at month end']), 'Diversify float providers', { ago: 60 });
  // INTERNAL CONTROL
  A('INTERNAL_CONTROL', 'HIGH', 'CONTROL_EXCEPTION', 'Maker-checker violation: same user created and approved', `User "Pascal Tshimanga" captured and approved ${openCases[5]?.ref || 'a merchant case'}.`, W([45, 'Segregation of duties breached'], [20, 'Approval within 2 minutes of capture']), 'Reverse approval, re-review by a second officer', { case_ref: openCases[5]?.ref, ago: 7 });
  A('INTERNAL_CONTROL', 'MEDIUM', 'CONTROL_EXCEPTION', `G2 SIM SWAP performed without a case — ${M[3].trading_name}`, 'backoffice.user3 performed a SIM swap with no supporting request or signature specimen.', W([40, 'Sensitive G2 operation'], [35, 'No case / ticket reference'], [10, 'Maker-checker not evidenced']), 'Obtain evidence or reverse the operation', { msisdn: M[3].msisdn, ago: 16 });
  A('INTERNAL_CONTROL', 'MEDIUM', 'CONTROL_EXCEPTION', 'Override frequency above threshold (11.4% vs 8%)', 'AI recommendations overridden on 11.4% of onboarding decisions this month.', W([30, 'Override rate 11.4%'], [15, 'Concentrated on 2 users']), 'Review override reasons; refresher on policy', { ago: 30 });
  A('INTERNAL_CONTROL', 'HIGH', 'CONTROL_EXCEPTION', `Signature specimen mismatch on super agent SIM swap request — ${AG[1].trading_name}`, 'E-mailed SIM swap request signature does not match the specimen on file.', W([40, 'Signature mismatch'], [25, 'Request from a non-registered e-mail']), 'Block request; confirm with super agent by phone', { msisdn: AG[1].msisdn, ago: 6 });
  A('INTERNAL_CONTROL', 'MEDIUM', 'CONTROL_EXCEPTION', 'Approval authority exceeded', 'Operations Agent approved a merchant with expected turnover 25,000 USD/month (limit 10,000).', W([35, 'Above delegated authority']), 'Re-approve at manager level', { ago: 40 });
  // LEGAL
  const CT = [['Kin Distribution SARL', 'Super-agent distribution agreement', 'HIGH', [['Unlimited liability', 'HIGH', 'Clause 12.3 — partner liability not capped'], ['Missing data protection clause', 'HIGH', 'No DPA / personal data processing terms'], ['Non-standard termination', 'MEDIUM', '90-day notice vs 30-day template']]], ['Mbote Retail Group', 'Merchant aggregation agreement', 'MEDIUM', [['Deviation from approved template', 'MEDIUM', 'Fee schedule modified'], ['Governing law', 'LOW', 'Arbitration seat outside DRC']]], ['Elikia Pay SA', 'API integration (business partner)', 'HIGH', [['Indemnification risk', 'HIGH', 'Vodacash indemnifies partner for third-party claims'], ['SLA obligations', 'MEDIUM', '99.9% availability penalty clause']]], ['Bondeko Logistics', 'Float logistics services', 'LOW', [['Confidentiality', 'LOW', 'Standard']]]];
  for (const [p, t, r, cl] of CT) {
    run('INSERT INTO contracts(partner,title,risk_level,clauses,status,created_at) VALUES(?,?,?,?,?,?)', p, t, r, s(cl.map(([c, l, d]) => ({ clause: c, risk: l, detail: d }))), r === 'LOW' ? 'APPROVED' : 'UNDER_REVIEW', iso(now - int(2, 20) * DAY));
    if (r !== 'LOW') A('LEGAL', r, 'CONTRACT_RISK', `Contract risk ${r}: ${t} — ${p}`, `${cl.filter(x => x[1] !== 'LOW').length} clause(s) require review: ${cl.map(x => x[0]).join(', ')}.`, cl.map(([c, l, d]) => ({ points: l === 'HIGH' ? 30 : l === 'MEDIUM' ? 15 : 5, label: `${c} — ${d}` })), 'ESCALATE TO LEGAL COUNSEL', { ago: int(5, 90) });
  }
  A('LEGAL', 'MEDIUM', 'CONTRACT_EXPIRY', 'Partner agreement expires in 30 days: Mbote Retail Group', 'Renewal not initiated; 1,240 merchants depend on this aggregator.', W([25, 'Expiry in 30 days'], [15, 'High dependency']), 'Start renewal negotiation', { ago: 52 });
  A('LEGAL', 'MEDIUM', 'DPA', 'Data Protection Agreement not signed: 2 business partners', 'Partners onboarded via VBU without signed DPA.', W([30, 'Personal data shared without DPA']), 'Obtain signed DPA before next data exchange', { ago: 75 });
  // AUDIT
  A('AUDIT', 'MEDIUM', 'AUDIT_PATTERN', 'Unusual approval pattern: approvals between 00:00–04:00', '6 approvals outside business hours by 2 users this month.', W([30, 'Out-of-hours approvals'], [15, 'Same 2 users']), 'Sample and test evidence for these decisions', { ago: 18 });
  A('AUDIT', 'MEDIUM', 'OVERRIDE', 'AI overrides without sufficient rationale', '4 overrides with reasons shorter than 20 characters.', W([25, 'Weak override justification']), 'Request supporting evidence', { ago: 36 });
  A('AUDIT', 'LOW', 'RECURRING', 'Recurring exception: RCCM mismatch at agent channel', 'Same exception type in 3 consecutive months.', W([20, 'Recurring control weakness']), 'Raise audit finding; track action plan', { ago: 100 });
  // resolved samples (history)
  A('OPERATIONS', 'MEDIUM', 'SLA', 'SLA AT RISK: resolved after prioritisation', 'Prioritised by Sentinel, met with 3h to spare.', W([30, '68% SLA consumed']), 'PRIORITIZE NOW', { status: 'RESOLVED', ago: 70 });

  // notifications
  run('INSERT INTO notifications(channel,recipient,title,body,created_at) VALUES(?,?,?,?,?)', 'WHATSAPP', '+243 81 *** 4412', 'Document expiring', 'Your ID document expires in 21 days. Reply to TOBi to renew.', iso(now - 2 * HOUR));
  run('INSERT INTO audit_events(ts,actor,role,system,action,new_state) VALUES(?,?,?,?,?,?)', iso(now), 'System', 'SYSTEM', 'SENTINEL', 'Demo data seeded', `${accounts.length} G2 accounts · ${all('SELECT id FROM cases').length} cases`);
}
