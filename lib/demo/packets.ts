/**
 * Synthetic broker submission packets for the demo. Fictional companies, zero
 * real PII. Three scenarios span the interesting paths:
 *   - clean    → complete, benign losses → auto-quote
 *   - referral → high-hazard class + elevated losses → knockout / refer
 *   - gappy    → missing required fields → triggers a broker clarification email
 *
 * Each packet is materialized into REAL files on intake (ACORD/supplemental as
 * PDFs, loss run as .xlsx, cover letter as the email body) so every parsing path
 * is genuinely exercised.
 */

export interface Packet {
  scenario: string
  broker: { name: string; email: string }
  insuredName: string
  acord125Lines: string[]
  glSupplementalLines: string[]
  /** Loss-run workbook: header row + data rows. */
  lossRows: (string | number)[][]
  coverLetter: string
}

const LOSS_HEADER = ['Policy Year', 'Claim Count', 'Total Incurred (USD)', 'Status / Notes']

export const PACKETS: Record<string, Packet> = {
  clean: {
    scenario: 'clean',
    broker: { name: 'Dana Whitfield', email: 'dwhitfield@meridianbrokers.example' },
    insuredName: 'Northwind Logistics LLC',
    acord125Lines: [
      'ACORD 125 — COMMERCIAL INSURANCE APPLICATION',
      'Applicant (Named Insured): Northwind Logistics LLC',
      'Mailing Address: 4820 Cargo Way, Columbus, OH 43217',
      'FEIN: 47-3120998     NAICS: 488510 (Freight Transportation Arrangement)',
      'Entity Type: Limited Liability Company',
      'Years in Business: 11',
      'Line of Business Requested: Commercial General Liability',
      'Requested Per-Occurrence Limit: $1,000,000',
      'Requested General Aggregate Limit: $2,000,000',
      'Deductible: $2,500',
      'Requested Effective Date: 2026-08-01',
      'Prior Carrier: Continental Casualty (3 years, no lapse)',
    ],
    glSupplementalLines: [
      'GL SUPPLEMENTAL — OPERATIONS',
      'Description of Operations: Third-party freight brokerage and warehouse cross-docking.',
      'Annual Gross Sales: $14,200,000',
      'Annual Payroll: $3,100,000',
      'Number of Employees: 58',
      'Subcontractors Used: Yes — certificates of insurance required on file.',
      'GL Class Code: 11288 (Warehouses — private)',
      'Premises: 1 owned warehouse, 42,000 sq ft, sprinklered, built 2009.',
      'Hazards: forklift operations, loading docks. No manufacturing.',
    ],
    lossRows: [
      LOSS_HEADER,
      [2023, 1, 8200, 'Slip-and-fall, closed'],
      [2024, 0, 0, 'No claims'],
      [2025, 1, 14500, 'Cargo damage liability, closed'],
    ],
    coverLetter:
      'Hi — please find attached the GL submission for Northwind Logistics LLC (ACORD 125, GL supplemental, and 3-year loss runs). Clean account, incumbent is non-renewing only due to a book rollover. Targeting an 8/1 effective date. Appreciate an indication this week. Thanks, Dana.',
  },

  referral: {
    scenario: 'referral',
    broker: { name: 'Marcus Vela', email: 'mvela@keystonerisk.example' },
    insuredName: 'Apex Demolition Inc',
    acord125Lines: [
      'ACORD 125 — COMMERCIAL INSURANCE APPLICATION',
      'Applicant (Named Insured): Apex Demolition Inc',
      'Mailing Address: 1190 Foundry Rd, Newark, NJ 07105',
      'FEIN: 22-8847110     NAICS: 238910 (Site Preparation Contractors)',
      'Entity Type: Corporation',
      'Years in Business: 6',
      'Line of Business Requested: Commercial General Liability',
      'Requested Per-Occurrence Limit: $2,000,000',
      'Requested General Aggregate Limit: $4,000,000',
      'Deductible: $10,000',
      'Requested Effective Date: 2026-07-15',
      'Prior Carrier: Non-renewed by prior carrier after 2024 losses.',
    ],
    glSupplementalLines: [
      'GL SUPPLEMENTAL — OPERATIONS',
      'Description of Operations: Structural demolition, including controlled and selective demolition.',
      'Annual Gross Sales: $9,800,000',
      'Annual Payroll: $4,600,000',
      'Number of Employees: 41',
      'Use of Explosives: Occasional (licensed subcontractor).',
      'GL Class Code: 98090 (Demolition — buildings, structures).',
      'Heights Worked: up to 70 ft. Operations within 25 ft of other structures: Yes.',
      'Subcontractors: Yes. Written contracts and hold-harmless: inconsistent.',
    ],
    lossRows: [
      LOSS_HEADER,
      [2023, 2, 142000, 'Adjacent-property damage; both closed'],
      [2024, 3, 610000, 'Bodily injury + collapse claim; 1 open in litigation'],
      [2025, 2, 188000, 'Debris/dust property claims, closed'],
    ],
    coverLetter:
      'Submitting Apex Demolition Inc for GL. Full transparency: they were non-renewed after a rough 2024, including an open collapse claim. Operations are heavy demolition near occupied structures. They need a 7/15 effective date. Understand this likely needs underwriter review. — Marcus',
  },

  gappy: {
    scenario: 'gappy',
    broker: { name: 'Priya Anand', email: 'panand@harborlineins.example' },
    insuredName: 'Riverside Catering Co',
    acord125Lines: [
      'ACORD 125 — COMMERCIAL INSURANCE APPLICATION',
      'Applicant (Named Insured): Riverside Catering Co',
      'Mailing Address: 77 Market St, Providence, RI 02903',
      'Line of Business Requested: Commercial General Liability',
      'Requested Per-Occurrence Limit: $1,000,000',
      'Requested Effective Date: 2026-09-01',
      // Intentionally missing: FEIN, NAICS, aggregate limit, deductible, prior carrier.
    ],
    glSupplementalLines: [
      'GL SUPPLEMENTAL — OPERATIONS',
      'Description of Operations: Off-premises catering and event services.',
      'Annual Gross Sales: $2,400,000',
      'Liquor Served: Yes — but liquor liability question left blank.',
      'Number of Employees: 22 (seasonal up to 40).',
      // Intentionally missing: payroll, class code, years in business.
    ],
    lossRows: [
      LOSS_HEADER,
      [2024, 1, 6400, 'Guest illness claim, closed'],
      // Only one year provided; underwriting wants 3.
    ],
    coverLetter:
      'Hi, new account for you — Riverside Catering Co, GL only. The owner filled out what he could; some of the application is incomplete. Let me know what else you need and I will chase it. They cater weddings and corporate events and do serve alcohol. Thanks! Priya',
  },
}

export function getPacket(scenario: string): Packet {
  return PACKETS[scenario] ?? PACKETS.clean
}
