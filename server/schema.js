// Merchant onboarding schema — derived from the Vodacash "Formulaire de demande de création de compte marchand M-PESA" (BCF).
// Each field: key, label, section, question (TOBi asks), type, required(fields)->bool, docs that can supply it.
export const CONTRACT_TYPES = {
  MI: 'Independent Merchant (MI)', MD: 'Dependent Merchant (MD)', MR: 'Street Merchant (MR)', MA: 'Autonomous Merchant (MA)', MIL: 'Independent Merchant Light',
};
const notStreet = (f) => f.contract_type !== 'MR';
const isDependent = (f) => f.contract_type === 'MD';
const isCompany = (f) => f.legal_form !== 'INDIVIDUAL';

export const FIELDS = [
  // 1. Applicant profile
  { key: 'legal_name', label: 'Legal name', section: 'Applicant profile', q: "What is the registered (legal) name of your business?", req: () => true, docs: ['RCCM'] },
  { key: 'trading_name', label: 'Trading name', section: 'Applicant profile', q: 'What name do your customers know your shop by (trading name)?', req: () => true },
  { key: 'contract_type', label: 'Merchant contract', section: 'Applicant profile', q: 'Which merchant contract fits you best?', type: 'choice', options: Object.entries(CONTRACT_TYPES).map(([v, l]) => ({ v, l })), req: () => true },
  { key: 'parent_name', label: 'Parent company', section: 'Applicant profile', q: 'As a dependent merchant, what is the name of your parent company?', req: isDependent },
  { key: 'owner_name', label: 'Owner name', section: 'Applicant profile', q: 'What is the full name of the business owner?', req: () => true, docs: ['NATIONAL_ID'] },
  { key: 'representative_name', label: 'Authorised representative', section: 'Applicant profile', q: 'Who will sign for the business (authorised representative)? If it is you, just say "me".', req: () => true },
  { key: 'id_type', label: 'ID type', section: 'Applicant profile', q: 'Which ID document will you use (national ID, voter card, passport)?', req: () => true, docs: ['NATIONAL_ID'] },
  { key: 'id_number', label: 'ID number', section: 'Applicant profile', q: 'What is the number on that ID document?', req: () => true, docs: ['NATIONAL_ID'] },
  { key: 'id_expiry', label: 'ID expiry date', section: 'Applicant profile', q: 'When does your ID expire?', req: () => false, docs: ['NATIONAL_ID'] },
  // 2. Contact & address
  { key: 'phone', label: 'Phone (MSISDN)', section: 'Contact & address', q: 'Which phone number (M-Pesa line) should we register? e.g. +243 81 234 5678', req: () => true },
  { key: 'email', label: 'Email', section: 'Contact & address', q: 'What email address can we use for the account?', req: notStreet },
  { key: 'address', label: 'Business address', section: 'Contact & address', q: 'What is the business address (number, avenue, quartier)?', req: () => true, docs: ['RCCM', 'PROOF_OF_ADDRESS'] },
  { key: 'commune', label: 'Commune', section: 'Contact & address', q: 'Which commune is it in?', req: () => true, docs: ['RCCM', 'PROOF_OF_ADDRESS'] },
  { key: 'city', label: 'City / Province', section: 'Contact & address', q: 'Which city and province?', req: () => true, docs: ['RCCM', 'PROOF_OF_ADDRESS'] },
  // 3. Legal form
  { key: 'legal_form', label: 'Legal form', section: 'Legal form', q: 'Is the business a registered company or an individual establishment?', type: 'choice', options: [{ v: 'COMPANY', l: 'Company (SARL, SA…)' }, { v: 'INDIVIDUAL', l: 'Individual establishment' }], req: () => true, docs: ['RCCM'] },
  { key: 'rccm', label: 'RCCM number', section: 'Legal form', q: 'What is your RCCM number?', req: notStreet, docs: ['RCCM'] },
  { key: 'id_nat', label: 'ID NAT', section: 'Legal form', q: 'What is your national identification number (ID NAT)?', req: notStreet, docs: ['RCCM', 'ID_NAT'] },
  { key: 'tax_number', label: 'Tax number (NIF)', section: 'Legal form', q: 'What is your tax number (NIF)? Say "none" if not applicable.', req: (f) => notStreet(f) && isCompany(f), docs: ['TAX'] },
  // 4. Requested account
  { key: 'business_activity', label: 'Business activity', section: 'M-Pesa Business account', q: 'What does your business sell or do?', req: () => true, docs: ['RCCM'] },
  { key: 'monthly_turnover_usd', label: 'Expected monthly turnover (USD)', section: 'M-Pesa Business account', q: 'Roughly how much do you expect to collect through M-Pesa per month, in USD?', req: () => true },
  { key: 'source_of_funds', label: 'Source of funds', section: 'M-Pesa Business account', q: 'What is the main source of the funds (e.g. retail sales, services)?', req: () => true },
  { key: 'daughter_sims', label: 'Daughter SIMs needed', section: 'M-Pesa Business account', q: 'Do you need daughter SIMs for your staff or other tills?', type: 'yesno', req: notStreet },
  { key: 'access_channel', label: 'Access channel', section: 'M-Pesa Business account', q: 'How will you use M-Pesa: USSD, the app, or an integrated solution?', type: 'choice', options: [{ v: 'USSD', l: 'USSD' }, { v: 'APP', l: 'M-Pesa App' }, { v: 'INTEGRATED', l: 'Integrated solution / API' }], req: () => true },
  // 5. Bank
  { key: 'bank_name', label: 'Bank', section: 'Bank details', q: 'Which bank does the business use? Say "none" if you do not have one.', req: notStreet },
  { key: 'other_mm_operator', label: 'Other mobile money contract', section: 'Bank details', q: 'Do you already have a contract with another mobile money operator? If yes, which one?', req: notStreet },
  // 6. Compliance (CMT questionnaire)
  { key: 'pep', label: 'Politically exposed person', section: 'Compliance questionnaire', q: 'Is the owner, a partner, shareholder or director a politically exposed person (PEP) or linked to a public official?', type: 'yesno', req: () => true },
  { key: 'sanctions', label: 'Asset freeze / sanctions', section: 'Compliance questionnaire', q: 'Has anyone in the business ever been subject to an asset freeze, sanctions or a terrorism listing?', type: 'yesno', req: () => true },
  { key: 'convictions', label: 'Convictions (ML, corruption, TF)', section: 'Compliance questionnaire', q: 'Has anyone in the business been convicted of money laundering, corruption, terrorist financing or an economic crime?', type: 'yesno', req: () => true },
  { key: 'terms_accepted', label: 'Terms, AML policy & data protection accepted', section: 'Declaration', q: 'Do you accept the M-Pesa terms, the Vodacash AML/CFT policy and the data protection agreement?', type: 'yesno', req: () => true },
];
export const FIELD_MAP = Object.fromEntries(FIELDS.map(f => [f.key, f]));

export const DOC_TYPES = {
  NATIONAL_ID: { label: 'National ID / Passport', req: () => true },
  RCCM: { label: 'RCCM certificate', req: notStreet },
  ID_NAT: { label: 'ID NAT certificate', req: () => false },
  TAX: { label: 'Tax document (NIF)', req: () => false },
  PROOF_OF_ADDRESS: { label: 'Proof of address', req: notStreet },
  OTHER: { label: 'Other supporting document', req: () => false },
};

export function missingFields(fields) { return FIELDS.filter(f => f.req(fields) && (fields[f.key] == null || fields[f.key] === '')); }
export function requiredDocs(fields) { return Object.entries(DOC_TYPES).filter(([, d]) => d.req(fields)).map(([k]) => k); }
