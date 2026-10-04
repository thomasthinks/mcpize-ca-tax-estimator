/**
 * 2026 Canadian federal + provincial/territorial personal income tax tables.
 *
 * All figures below were researched and verified against authoritative sources
 * in October 2026. Every jurisdiction below is the 2026 tax year — no
 * fallbacks to 2025 were needed.
 *
 * Primary sources (see README.md for the full citation list):
 *  - Federal brackets + BPA: CRA payroll deduction tables (canada.ca) and
 *    http://www.taxtips.ca/taxrates/federal.htm (via province pages)
 *  - Provincial/territorial brackets + BPAs: http://www.taxtips.ca/taxrates/<xx>.htm
 *    (ab, bc, mb, nb, nl, ns, nt, nu, on, pe, qc, sk, yt) — each page's 2026
 *    column, confirmed to CRA information
 *  - Cross-check: Tax Templates Inc. "2026 Tax Facts and Tables"
 *    (files.ttiworksheets.ca/2026-Tax-Facts-and-Tables-provided-by-TTI.pdf)
 *
 * Notable 2026 changes captured here (the TTI Feb-2026 PDF predates some):
 *  - Federal lowest bracket is 14% (down from 15%); BPA $16,452/$14,829.
 *  - BC lowest bracket raised 5.06% -> 5.60% (BC 2026 Budget, Bill 2).
 *  - PEI added a new $200,000+ bracket at 20% (PEI 2026 Budget).
 *  - Yukon has a 12.93% "notch" bracket for $181,440-$258,482 (mirrors the
 *    federal BPA phase-out range); YT BPA mirrors the federal BPA phase-out.
 */

export interface TaxBracket {
  /** Upper bound of taxable income for this bracket (inclusive). null = no ceiling. */
  upTo: number | null;
  /** Marginal rate as a decimal, e.g. 0.14 for 14%. */
  rate: number;
}

export interface ProvinceTaxData {
  code: string;
  name: string;
  brackets: TaxBracket[];
  /** Basic personal amount (base $) for 2026. */
  bpa: number;
  /** Alternate BPA values for jurisdictions whose BPA phases out. */
  bpaMin?: number; // minimum BPA at/above bpaPhaseOutEnd
  bpaPhaseOutStart?: number; // net income where phase-out begins
  bpaPhaseOutEnd?: number; // net income where BPA reaches bpaMin
  /** Rate at which the BPA credit is applied (lowest bracket rate). */
  bpaRate: number;
}

// ---------------------------------------------------------------------------
// Federal 2026
// Source: CRA 2026 payroll deduction tables (T4032 guides, canada.ca) and
// taxtips.ca federal tax rates page. Indexation factor 2.0%.
// BPA: $16,452 max for net income <= $181,440, phasing down linearly to
// $14,829 for net income >= $258,482.
// ---------------------------------------------------------------------------
export const FEDERAL_BRACKETS_2026: TaxBracket[] = [
  { upTo: 58523, rate: 0.14 },
  { upTo: 117045, rate: 0.205 },
  { upTo: 181440, rate: 0.26 },
  { upTo: 258482, rate: 0.29 },
  { upTo: null, rate: 0.33 },
];

export const FEDERAL_BPA_MAX = 16452;
export const FEDERAL_BPA_MIN = 14829;
export const FEDERAL_BPA_PHASE_OUT_START = 181440;
export const FEDERAL_BPA_PHASE_OUT_END = 258482;
export const FEDERAL_LOWEST_RATE = 0.14;

/** Federal basic personal amount for 2026 given net (taxable) income. */
export function federalBpa2026(income: number): number {
  if (income <= FEDERAL_BPA_PHASE_OUT_START) return FEDERAL_BPA_MAX;
  if (income >= FEDERAL_BPA_PHASE_OUT_END) return FEDERAL_BPA_MIN;
  const frac =
    (income - FEDERAL_BPA_PHASE_OUT_START) /
    (FEDERAL_BPA_PHASE_OUT_END - FEDERAL_BPA_PHASE_OUT_START);
  return FEDERAL_BPA_MAX - frac * (FEDERAL_BPA_MAX - FEDERAL_BPA_MIN);
}

// ---------------------------------------------------------------------------
// Provincial / territorial 2026 tables
// ---------------------------------------------------------------------------
export const PROVINCES_2026: Record<string, ProvinceTaxData> = {
  // BC: lowest bracket 5.60% for 2026 (raised from 5.06% by the BC 2026 Budget).
  // Source: http://www.taxtips.ca/taxrates/bc.htm
  BC: {
    code: "BC",
    name: "British Columbia",
    brackets: [
      { upTo: 50363, rate: 0.056 },
      { upTo: 100728, rate: 0.077 },
      { upTo: 115648, rate: 0.105 },
      { upTo: 140430, rate: 0.1229 },
      { upTo: 190405, rate: 0.147 },
      { upTo: 265545, rate: 0.168 },
      { upTo: null, rate: 0.205 },
    ],
    bpa: 13216,
    bpaRate: 0.056,
  },
  // AB: graduated since 2025; BPA flat $22,769 (no phase-out).
  // Source: http://www.taxtips.ca/taxrates/ab.htm and CRA T4032-AB (canada.ca).
  AB: {
    code: "AB",
    name: "Alberta",
    brackets: [
      { upTo: 61200, rate: 0.08 },
      { upTo: 154259, rate: 0.1 },
      { upTo: 185111, rate: 0.12 },
      { upTo: 246813, rate: 0.13 },
      { upTo: 370220, rate: 0.14 },
      { upTo: null, rate: 0.15 },
    ],
    bpa: 22769,
    bpaRate: 0.08,
  },
  // SK: source saskatchewan.ca "2026 Personal Income Tax Structure",
  // CRA T4032-SK, http://www.taxtips.ca/taxrates/sk.htm
  SK: {
    code: "SK",
    name: "Saskatchewan",
    brackets: [
      { upTo: 54532, rate: 0.105 },
      { upTo: 155805, rate: 0.125 },
      { upTo: null, rate: 0.145 },
    ],
    bpa: 20381,
    bpaRate: 0.105,
  },
  // MB: BPA $15,780 phases out to $0 over $200,000-$400,000 (2025+).
  // Source: http://www.taxtips.ca/taxrates/mb.htm (confirmed to CRA).
  MB: {
    code: "MB",
    name: "Manitoba",
    brackets: [
      { upTo: 47000, rate: 0.108 },
      { upTo: 100000, rate: 0.1275 },
      { upTo: null, rate: 0.174 },
    ],
    bpa: 15780,
    bpaMin: 0,
    bpaPhaseOutStart: 200000,
    bpaPhaseOutEnd: 400000,
    bpaRate: 0.108,
  },
  // ON: surtax 20% on ON tax > $5,818 and 36% on ON tax > $7,446;
  // Ontario Health Premium added per CRA ON428 chart (see onHealthPremium()).
  // Source: http://www.taxtips.ca/taxrates/on.htm
  ON: {
    code: "ON",
    name: "Ontario",
    brackets: [
      { upTo: 53891, rate: 0.0505 },
      { upTo: 107785, rate: 0.0915 },
      { upTo: 150000, rate: 0.1116 },
      { upTo: 220000, rate: 0.1216 },
      { upTo: null, rate: 0.1316 },
    ],
    bpa: 12989,
    bpaRate: 0.0505,
  },
  // QC: federal abatement of 16.5% applies to QC residents' federal tax.
  // Source: http://www.taxtips.ca/taxrates/qc.htm
  QC: {
    code: "QC",
    name: "Quebec",
    brackets: [
      { upTo: 54345, rate: 0.14 },
      { upTo: 108680, rate: 0.19 },
      { upTo: 132245, rate: 0.24 },
      { upTo: null, rate: 0.2575 },
    ],
    bpa: 18952,
    bpaRate: 0.14,
  },
  // NB: source http://www.taxtips.ca/taxrates/nb.htm (confirmed to CRA).
  NB: {
    code: "NB",
    name: "New Brunswick",
    brackets: [
      { upTo: 52333, rate: 0.094 },
      { upTo: 104666, rate: 0.14 },
      { upTo: 193861, rate: 0.16 },
      { upTo: null, rate: 0.195 },
    ],
    bpa: 13664,
    bpaRate: 0.094,
  },
  // NS: source http://www.taxtips.ca/taxrates/ns.htm
  NS: {
    code: "NS",
    name: "Nova Scotia",
    brackets: [
      { upTo: 30995, rate: 0.0879 },
      { upTo: 61991, rate: 0.1495 },
      { upTo: 97417, rate: 0.1667 },
      { upTo: 157124, rate: 0.175 },
      { upTo: null, rate: 0.21 },
    ],
    bpa: 11932,
    bpaRate: 0.0879,
  },
  // PE: NEW $200,000+ bracket at 20% introduced by the PEI 2026 Budget
  // (annual rate; payroll used a prorated 21% for Jul-Dec 2026 only).
  // Source: http://www.taxtips.ca/taxrates/pe.htm,
  // princeedwardisland.ca, CRA T4032-PE.
  PE: {
    code: "PE",
    name: "Prince Edward Island",
    brackets: [
      { upTo: 33928, rate: 0.095 },
      { upTo: 65820, rate: 0.1347 },
      { upTo: 106890, rate: 0.166 },
      { upTo: 142520, rate: 0.1762 },
      { upTo: 200000, rate: 0.19 },
      { upTo: null, rate: 0.2 },
    ],
    bpa: 15000,
    bpaRate: 0.095,
  },
  // NL: source http://www.taxtips.ca/taxrates/nl.htm
  NL: {
    code: "NL",
    name: "Newfoundland and Labrador",
    brackets: [
      { upTo: 44678, rate: 0.087 },
      { upTo: 89354, rate: 0.145 },
      { upTo: 159528, rate: 0.158 },
      { upTo: 223340, rate: 0.178 },
      { upTo: 285319, rate: 0.198 },
      { upTo: 570638, rate: 0.208 },
      { upTo: 1141275, rate: 0.213 },
      { upTo: null, rate: 0.218 },
    ],
    bpa: 11188,
    bpaRate: 0.087,
  },
  // YT: 12.93% notch bracket $181,440-$258,482 (mirrors federal BPA
  // phase-out range); YT BPA mirrors the federal BPA incl. phase-out.
  // Source: http://www.taxtips.ca/taxrates/yt.htm (confirmed to CRA).
  YT: {
    code: "YT",
    name: "Yukon",
    brackets: [
      { upTo: 58523, rate: 0.064 },
      { upTo: 117045, rate: 0.09 },
      { upTo: 181440, rate: 0.109 },
      { upTo: 258482, rate: 0.1293 },
      { upTo: 500000, rate: 0.128 },
      { upTo: null, rate: 0.15 },
    ],
    bpa: FEDERAL_BPA_MAX,
    bpaMin: FEDERAL_BPA_MIN,
    bpaPhaseOutStart: FEDERAL_BPA_PHASE_OUT_START,
    bpaPhaseOutEnd: FEDERAL_BPA_PHASE_OUT_END,
    bpaRate: 0.064,
  },
  // NT: source http://www.taxtips.ca/taxrates/nt.htm
  NT: {
    code: "NT",
    name: "Northwest Territories",
    brackets: [
      { upTo: 53003, rate: 0.059 },
      { upTo: 106009, rate: 0.086 },
      { upTo: 172346, rate: 0.122 },
      { upTo: null, rate: 0.1405 },
    ],
    bpa: 18198,
    bpaRate: 0.059,
  },
  // NU: source http://www.taxtips.ca/taxrates/nu.htm
  NU: {
    code: "NU",
    name: "Nunavut",
    brackets: [
      { upTo: 55801, rate: 0.04 },
      { upTo: 111602, rate: 0.07 },
      { upTo: 181439, rate: 0.09 },
      { upTo: null, rate: 0.115 },
    ],
    bpa: 19659,
    bpaRate: 0.04,
  },
};

export const PROVINCE_CODES = Object.keys(PROVINCES_2026);

// ---------------------------------------------------------------------------
// Ontario specifics
// ---------------------------------------------------------------------------
export const ON_SURTAX1_THRESHOLD = 5818;
export const ON_SURTAX1_RATE = 0.2;
export const ON_SURTAX2_THRESHOLD = 7446;
export const ON_SURTAX2_RATE = 0.36;

/**
 * Ontario Health Premium for 2026 (CRA Form ON428 chart; thresholds unchanged
 * since 2004). This is part of Ontario tax payable on the return.
 * Source: canada.ca (CRA T2203-ON) and ontario.ca health premium rates.
 */
export function onHealthPremium2026(taxableIncome: number): number {
  const x = taxableIncome;
  if (x <= 20000) return 0;
  if (x <= 25000) return (x - 20000) * 0.06;
  if (x <= 36000) return 300;
  if (x <= 38500) return 300 + (x - 36000) * 0.06;
  if (x <= 48000) return 450;
  if (x <= 48600) return 450 + (x - 48000) * 0.25;
  if (x <= 72000) return 600;
  if (x <= 72600) return 600 + (x - 72000) * 0.25;
  if (x <= 200000) return 750;
  if (x <= 200600) return 750 + (x - 200000) * 0.25;
  return 900;
}

/** Federal abatement for Quebec residents: 16.5% of federal tax. */
export const QC_FEDERAL_ABATEMENT = 0.165;

/** Provincial BPA for 2026 given income (handles MB/YT phase-outs). */
export function provincialBpa2026(prov: ProvinceTaxData, income: number): number {
  if (
    prov.bpaMin !== undefined &&
    prov.bpaPhaseOutStart !== undefined &&
    prov.bpaPhaseOutEnd !== undefined
  ) {
    if (income <= prov.bpaPhaseOutStart) return prov.bpa;
    if (income >= prov.bpaPhaseOutEnd) return prov.bpaMin;
    const frac =
      (income - prov.bpaPhaseOutStart) / (prov.bpaPhaseOutEnd - prov.bpaPhaseOutStart);
    return prov.bpa - frac * (prov.bpa - prov.bpaMin);
  }
  return prov.bpa;
}
