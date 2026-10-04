/**
 * Unit tests for the 2026 Canadian tax engine.
 *
 * Expected values below were hand-computed from the published 2026 tables
 * and cross-checked against taxtips.ca's combined federal+provincial
 * marginal-rate tables (which are confirmed to CRA data):
 *  - http://www.taxtips.ca/taxrates/on.htm  (ON 2026 rates, surtax, BPA)
 *  - http://www.taxtips.ca/taxrates/bc.htm  (BC 2026 rates, BPA)
 *  - http://www.taxtips.ca/taxrates/qc.htm  (QC 2026 rates, BPA, 16.5% abatement)
 *  - http://www.taxtips.ca/taxrates/yt.htm  (YT 12.93% notch bracket)
 */
import { describe, it, expect, beforeEach } from "vitest";
import { estimateTax, marginalRate, compareRrspTfsa } from "../src/tools.js";
import { federalBpa2026, onHealthPremium2026 } from "../src/tax-data.js";
import { checkAndConsumeEstimate, resetUsage } from "../src/usage.js";

describe("estimateTax", () => {
  it("matches hand computation for $100,000 in Ontario (taxtips.ca 2026)", () => {
    // Hand calc: federal (58523x14% + 41477x20.5%) - 16452x14% = 14,392.725
    // ON: (53891x5.05% + 46109x9.15%) - 12989x5.05% = 6,284.5245
    //   + 20% surtax on (6284.5245-5818) = 93.3049 -> 6,377.8294
    //   + ON health premium $750 -> 7,127.8294
    // total = 21,520.5544 -> $21,520.55. taxtips.ca 2026 basic calculator
    // (BPA-only) shows ~$21,520 for this case.
    const r = estimateTax(100000, "ON");
    expect(r.tax_year).toBe(2026);
    expect(r.total_tax).toBeCloseTo(21520.55, 1);
    expect(Math.abs(r.total_tax - 21520)).toBeLessThan(1); // task's taxtips tolerance
    expect(r.federal_tax).toBeCloseTo(14392.73, 1);
    expect(r.provincial_tax).toBeCloseTo(7127.83, 1);
    expect(r.ontario_health_premium).toBe(750);
    expect(r.after_tax_income).toBeCloseTo(78479.45, 1);
    expect(r.marginal_rate).toBeCloseTo(0.2965, 4); // statutory: 20.5% + 9.15%
    expect(r.quebec_federal_abatement_applied).toBe(false);
  });

  it("matches hand computation for $60,000 in BC", () => {
    // Federal: (58523x14% + 1477x20.5%) - 2303.28 = 6,192.725
    // BC: (50363x5.6% + 9637x7.7%) - 13216x5.6% = 2,822.281
    // total = 9,015.006 -> $9,015.01 (cross-checked via taxtips combined
    // BC marginal bands: 50363x19.6% + 8160x21.7% + 1477x28.2% - credits).
    const r = estimateTax(60000, "BC");
    expect(r.total_tax).toBeCloseTo(9015.01, 1);
    expect(r.federal_tax).toBeCloseTo(6192.73, 1);
    expect(r.provincial_tax).toBeCloseTo(2822.28, 1);
    expect(r.ontario_health_premium).toBe(0);
  });

  it("applies the 16.5% federal abatement for Quebec", () => {
    // Federal after BPA: 14,392.725 x (1-0.165) = 12,017.9254
    // QC: (54345x14% + 45655x19%) - 18952x14% = 16,282.75 - 2,653.28 = 13,629.47
    // total = 25,647.3954 -> $25,647.40
    const r = estimateTax(100000, "QC");
    expect(r.quebec_federal_abatement_applied).toBe(true);
    expect(r.federal_tax).toBeCloseTo(12017.93, 1);
    expect(r.provincial_tax).toBeCloseTo(13629.47, 1);
    expect(r.total_tax).toBeCloseTo(25647.4, 0);
  });

  it("uses the Yukon 12.93% notch bracket in the federal BPA phase-out range", () => {
    const r = marginalRate(200000, "YT");
    expect(r.marginal_rate).toBeCloseTo(0.4193, 4); // 29% + 12.93%
    expect(r.bracket_floor).toBe(181440);
    expect(r.bracket_ceiling).toBe(258482);
  });

  it("uses PEI's new 2026 $200k+ bracket at 20%", () => {
    const r = marginalRate(250000, "PE");
    expect(r.marginal_rate).toBeCloseTo(0.49, 4); // 29% + 20%
    expect(r.provincial_component).toBe(0.2);
  });

  it("returns zeros for zero income", () => {
    const r = estimateTax(0, "ON");
    expect(r.federal_tax).toBe(0);
    expect(r.provincial_tax).toBe(0);
    expect(r.total_tax).toBe(0);
    expect(r.after_tax_income).toBe(0);
    expect(r.average_rate).toBe(0);
    expect(r.marginal_rate).toBeCloseTo(0.1905, 4); // 14% + 5.05%
  });

  it("throws a clear error for an invalid province code", () => {
    expect(() => estimateTax(50000, "XX")).toThrow(/Unknown province code/);
  });

  it("throws for negative income", () => {
    expect(() => estimateTax(-1, "ON")).toThrow(/non-negative/);
  });

  it("phases out the federal BPA between $181,440 and $258,482", () => {
    // At $200,000: BPA = 16452 - (200000-181440) x 1623/77042 = 16,061.01
    // credit = 16061.01 x 14% = 2,248.54
    expect(federalBpa2026(100000)).toBe(16452);
    expect(federalBpa2026(181440)).toBe(16452);
    expect(federalBpa2026(258482)).toBe(14829);
    expect(federalBpa2026(300000)).toBe(14829);
    const r = estimateTax(200000, "ON");
    expect(r.federal_bpa_credit).toBeCloseTo(2248.54, 1);
  });

  it("computes the Ontario Health Premium bands correctly", () => {
    expect(onHealthPremium2026(15000)).toBe(0);
    expect(onHealthPremium2026(20000)).toBe(0);
    expect(onHealthPremium2026(22500)).toBeCloseTo(150, 6);
    expect(onHealthPremium2026(30000)).toBe(300);
    expect(onHealthPremium2026(100000)).toBe(750);
    expect(onHealthPremium2026(250000)).toBe(900);
  });
});

describe("marginalRate", () => {
  it("returns combined statutory rates with the containing bracket band", () => {
    const r = marginalRate(60000, "ON");
    expect(r.marginal_rate).toBeCloseTo(0.2965, 4); // 20.5% + 9.15%
    expect(r.federal_component).toBeCloseTo(0.205, 4);
    expect(r.provincial_component).toBeCloseTo(0.0915, 4);
    expect(r.bracket_floor).toBe(58523);
    expect(r.bracket_ceiling).toBe(107785);
    expect(r.tax_year).toBe(2026);
  });

  it("applies the Quebec abatement to the federal component", () => {
    const r = marginalRate(60000, "QC");
    // 20.5% x 0.835 + 19% = 36.1175% (taxtips QC table: 36.12%)
    expect(r.marginal_rate).toBeCloseTo(0.3612, 4);
    expect(r.federal_component).toBeCloseTo(0.1712, 4);
  });

  it("handles the top bracket (no ceiling)", () => {
    const r = marginalRate(1000000, "AB");
    expect(r.marginal_rate).toBeCloseTo(0.48, 4); // 33% + 15%
    expect(r.bracket_ceiling).toBeNull();
  });

  it("rejects invalid province codes", () => {
    expect(() => marginalRate(50000, "ZZ")).toThrow(/Unknown province code/);
  });
});

describe("compareRrspTfsa", () => {
  it("computes RRSP saving as contribution x combined marginal rate", () => {
    // $100k ON: marginal 29.65% -> $10,000 saves $2,965
    const r = compareRrspTfsa(100000, "ON", 10000);
    expect(r.marginal_rate).toBeCloseTo(0.2965, 4);
    expect(r.rrsp_tax_saving).toBeCloseTo(2965, 2);
    expect(r.effective_cost).toBeCloseTo(7035, 2);
    expect(r.tfsa_note).toMatch(/after-tax/i);
    expect(r.recommendation_note).toMatch(/not tax advice/i);
  });

  it("handles zero contribution", () => {
    const r = compareRrspTfsa(80000, "BC", 0);
    expect(r.rrsp_tax_saving).toBe(0);
    expect(r.effective_cost).toBe(0);
  });
});

describe("freemium quota", () => {
  beforeEach(() => {
    resetUsage();
    delete process.env.FREE_MONTHLY_LIMIT;
  });

  it("allows up to the limit then denies with the quota message", () => {
    process.env.FREE_MONTHLY_LIMIT = "2";
    expect(checkAndConsumeEstimate().allowed).toBe(true);
    expect(checkAndConsumeEstimate().allowed).toBe(true);
    const denied = checkAndConsumeEstimate();
    expect(denied.allowed).toBe(false);
    expect(denied.message).toMatch(/Free quota exceeded \(2 estimates\/month\)/);
    expect(denied.message).toMatch(/Subscribe to Pro/);
  });

  it("defaults to 10 when the env var is unset", () => {
    for (let i = 0; i < 10; i++) {
      expect(checkAndConsumeEstimate().allowed).toBe(true);
    }
    expect(checkAndConsumeEstimate().allowed).toBe(false);
  });
});
