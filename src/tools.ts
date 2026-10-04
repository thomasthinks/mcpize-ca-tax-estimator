/**
 * Pure tool functions — business logic only, no MCP dependency.
 * Each function is registered as an MCP tool in index.ts.
 *
 * Tax math: standard progressive-bracket calculation with the basic
 * personal amount (BPA) applied as a non-refundable credit at the lowest
 * bracket rate. Federal BPA phases out $181,440 -> $258,482; Manitoba and
 * Yukon BPAs have their own phase-outs (see tax-data.ts).
 */

import {
  FEDERAL_BRACKETS_2026,
  FEDERAL_LOWEST_RATE,
  PROVINCES_2026,
  PROVINCE_CODES,
  QC_FEDERAL_ABATEMENT,
  TaxBracket,
  federalBpa2026,
  onHealthPremium2026,
  provincialBpa2026,
  ON_SURTAX1_THRESHOLD,
  ON_SURTAX1_RATE,
  ON_SURTAX2_THRESHOLD,
  ON_SURTAX2_RATE,
} from "./tax-data.js";

export const TAX_YEAR = 2026;

const round2 = (n: number): number => Math.round(n * 100) / 100;
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

function assertValidProvince(code: string): void {
  if (!PROVINCE_CODES.includes(code)) {
    throw new Error(
      `Unknown province code "${code}". Must be one of: ${PROVINCE_CODES.join(", ")}.`
    );
  }
}

function assertNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number; got ${value}.`);
  }
}

/** Progressive tax on income across the given brackets. */
function bracketTax(income: number, brackets: TaxBracket[]): number {
  let tax = 0;
  let floor = 0;
  for (const b of brackets) {
    const ceiling = b.upTo ?? Infinity;
    const taxableInBracket = Math.min(income, ceiling) - floor;
    if (taxableInBracket > 0) tax += taxableInBracket * b.rate;
    if (income <= ceiling) break;
    floor = ceiling;
  }
  return tax;
}

/** Bracket containing `income`: { rate, floor, ceiling }. */
function bracketAt(
  income: number,
  brackets: TaxBracket[]
): { rate: number; floor: number; ceiling: number | null } {
  let floor = 0;
  for (const b of brackets) {
    const ceiling = b.upTo;
    if (ceiling === null || income <= ceiling) {
      return { rate: b.rate, floor, ceiling };
    }
    floor = ceiling;
  }
  // Unreachable (last bracket has no ceiling), but keep TS happy.
  const last = brackets[brackets.length - 1];
  return { rate: last.rate, floor, ceiling: null };
}

export interface EstimateTaxResult {
  [key: string]: unknown;
  income: number;
  province: string;
  tax_year: number;
  federal_tax: number;
  provincial_tax: number;
  total_tax: number;
  after_tax_income: number;
  marginal_rate: number;
  average_rate: number;
  federal_bpa_credit: number;
  provincial_bpa_credit: number;
  ontario_health_premium: number;
  quebec_federal_abatement_applied: boolean;
  notes: string[];
}

/**
 * Full 2026 federal + provincial/territorial income tax estimate for a single
 * income figure, BPA credits only. Returns dollars rounded to cents and rates
 * as decimals (0.4341 = 43.41%).
 */
export function estimateTax(income: number, provinceCode: string): EstimateTaxResult {
  assertNonNegative(income, "income");
  assertValidProvince(provinceCode);
  const prov = PROVINCES_2026[provinceCode];
  const notes: string[] = [];

  // Federal
  const federalBefore = bracketTax(income, FEDERAL_BRACKETS_2026);
  const federalBpa = federalBpa2026(income);
  const federalBpaCredit = federalBpa * FEDERAL_LOWEST_RATE;
  let federalTax = federalBefore - federalBpaCredit;
  const isQuebec = provinceCode === "QC";
  if (isQuebec) {
    federalTax *= 1 - QC_FEDERAL_ABATEMENT;
    notes.push(
      "Quebec residents get a 16.5% federal abatement; federal tax above reflects it."
    );
  }
  if (income > 181440) {
    notes.push(
      `Federal basic personal amount phased down to $${round2(federalBpa).toLocaleString("en-CA")} at this income (fully $16,452 up to $181,440; $14,829 at/above $258,482).`
    );
  }

  // Provincial / territorial
  const provBefore = bracketTax(income, prov.brackets);
  const provBpa = provincialBpa2026(prov, income);
  const provBpaCredit = provBpa * prov.bpaRate;
  let provincialTax = provBefore - provBpaCredit;
  let healthPremium = 0;
  if (provinceCode === "ON") {
    const surtax1 = Math.max(0, provincialTax - ON_SURTAX1_THRESHOLD) * ON_SURTAX1_RATE;
    const surtax2 = Math.max(0, provincialTax - ON_SURTAX2_THRESHOLD) * ON_SURTAX2_RATE;
    provincialTax += surtax1 + surtax2;
    if (surtax1 > 0 || surtax2 > 0) {
      notes.push(
        "Ontario surtax applied: 20% on Ontario tax above $5,818 plus 36% on Ontario tax above $7,446."
      );
    }
    healthPremium = onHealthPremium2026(income);
    provincialTax += healthPremium;
    if (healthPremium > 0) {
      notes.push(
        `Ontario Health Premium of $${round2(healthPremium).toLocaleString("en-CA")} included in provincial tax (part of Ontario tax payable).`
      );
    }
  }
  if (provinceCode === "MB" && income > 200000) {
    notes.push(
      "Manitoba basic personal amount phases out to $0 between $200,000 and $400,000 of net income."
    );
  }
  if (provinceCode === "YT" && income > 181440) {
    notes.push(
      "Yukon basic personal amount mirrors the federal phase-out ($181,440-$258,482)."
    );
  }

  const totalTax = Math.max(0, federalTax) + Math.max(0, provincialTax);
  const afterTax = income - totalTax;

  // Statutory combined marginal rate (federal + provincial bracket rates).
  const fedBracket = bracketAt(income, FEDERAL_BRACKETS_2026);
  const provBracket = bracketAt(income, prov.brackets);
  const marginalRate =
    fedBracket.rate * (isQuebec ? 1 - QC_FEDERAL_ABATEMENT : 1) + provBracket.rate;
  const averageRate = income > 0 ? totalTax / income : 0;

  notes.unshift(
    `2026 estimate for a ${prov.name} resident with $${income.toLocaleString("en-CA")} of taxable income. Federal + provincial/territorial tax only; basic personal amount is the only credit applied. Estimates only — not tax advice; verify against CRA.`
  );

  return {
    income: round2(income),
    province: provinceCode,
    tax_year: TAX_YEAR,
    federal_tax: round2(Math.max(0, federalTax)),
    provincial_tax: round2(Math.max(0, provincialTax)),
    total_tax: round2(totalTax),
    after_tax_income: round2(afterTax),
    marginal_rate: round4(marginalRate),
    average_rate: round4(averageRate),
    federal_bpa_credit: round2(federalBpaCredit * (isQuebec ? 1 - QC_FEDERAL_ABATEMENT : 1)),
    provincial_bpa_credit: round2(provBpaCredit),
    ontario_health_premium: round2(healthPremium),
    quebec_federal_abatement_applied: isQuebec,
    notes,
  };
}

export interface MarginalRateResult {
  [key: string]: unknown;
  income: number;
  province: string;
  tax_year: number;
  marginal_rate: number;
  federal_component: number;
  provincial_component: number;
  bracket_floor: number;
  bracket_ceiling: number | null;
  notes: string[];
}

/**
 * Combined federal + provincial/territorial statutory marginal rate on the
 * next dollar of income. BPA phase-outs, surtaxes and the Ontario Health
 * Premium are NOT reflected here (they are in estimate_tax); use
 * estimate_tax for effective dollar figures.
 */
export function marginalRate(income: number, provinceCode: string): MarginalRateResult {
  assertNonNegative(income, "income");
  assertValidProvince(provinceCode);
  const prov = PROVINCES_2026[provinceCode];
  const isQuebec = provinceCode === "QC";

  const fed = bracketAt(income, FEDERAL_BRACKETS_2026);
  const prv = bracketAt(income, prov.brackets);
  const federalComponent = fed.rate * (isQuebec ? 1 - QC_FEDERAL_ABATEMENT : 1);
  const marginal = federalComponent + prv.rate;

  return {
    income: round2(income),
    province: provinceCode,
    tax_year: TAX_YEAR,
    marginal_rate: round4(marginal),
    federal_component: round4(federalComponent),
    provincial_component: round4(prv.rate),
    bracket_floor: Math.max(fed.floor, prv.floor),
    bracket_ceiling:
      fed.ceiling === null ? prv.ceiling : prv.ceiling === null ? fed.ceiling : Math.min(fed.ceiling, prv.ceiling),
    notes: [
      "Statutory combined marginal rate on the next dollar (federal bracket rate + provincial/territorial bracket rate).",
      "Excludes BPA phase-out effects, Ontario surtax, and the Ontario Health Premium — see estimate_tax for dollar figures.",
    ],
  };
}

export interface CompareRrspTfsaResult {
  [key: string]: unknown;
  income: number;
  province: string;
  tax_year: number;
  contribution: number;
  marginal_rate: number;
  rrsp_tax_saving: number;
  effective_cost: number;
  tfsa_note: string;
  recommendation_note: string;
}

/**
 * RRSP-vs-TFSA contribution comparison: the RRSP deduction saves tax at the
 * contributor's combined marginal rate; the TFSA gives no deduction but
 * tax-free growth and withdrawals.
 */
export function compareRrspTfsa(
  income: number,
  provinceCode: string,
  contribution: number
): CompareRrspTfsaResult {
  assertNonNegative(income, "income");
  assertNonNegative(contribution, "contribution");
  assertValidProvince(provinceCode);

  const m = marginalRate(income, provinceCode).marginal_rate;
  const saving = contribution * m;

  let recommendation: string;
  if (m >= 0.4) {
    recommendation =
      "At this marginal rate an RRSP contribution is often attractive if you expect to withdraw at a lower rate in retirement; compare against your expected retirement marginal rate. General information only — not tax advice.";
  } else if (m >= 0.25) {
    recommendation =
      "At this middle marginal rate the choice depends on your expected retirement tax rate and need for flexibility: RRSP if you expect a lower rate later, TFSA if you value tax-free, penalty-free access. General information only — not tax advice.";
  } else {
    recommendation =
      "At this lower marginal rate the TFSA is often the more flexible choice (no deduction to give up, tax-free withdrawals), unless you expect a much higher rate later. General information only — not tax advice.";
  }

  return {
    income: round2(income),
    province: provinceCode,
    tax_year: TAX_YEAR,
    contribution: round2(contribution),
    marginal_rate: m,
    rrsp_tax_saving: round2(saving),
    effective_cost: round2(contribution - saving),
    tfsa_note:
      "A TFSA contribution is made with after-tax dollars (no deduction). Investment growth and qualifying withdrawals are tax-free, and withdrawals do not affect federal benefits.",
    recommendation_note: recommendation,
  };
}
