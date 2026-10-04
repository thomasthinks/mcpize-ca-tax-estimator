# ca-tax-estimator — Canadian Tax Estimator 2026

[![MCPize](https://mcpize.com/badge/@mcpize/mcpize?type=hosted)](https://mcpize.com)

An MCP server that estimates **2026 Canadian personal income tax** — federal +
provincial/territorial — for all 13 jurisdictions, from real, verified 2026
tax tables. Also computes combined marginal rates and RRSP-vs-TFSA
contribution comparisons.

## What it does

Real reference-data computation, not estimates from memory: every bracket,
rate, and basic personal amount is encoded from 2026 CRA/taxtips.ca tables
(see Data sources), including the tricky bits — Ontario's surtax + health
premium, Quebec's 16.5% federal abatement, Yukon's 12.93% notch bracket,
PEI's new 2026 $200k bracket, and the federal/Manitoba/Yukon BPA phase-outs.

## Tools

| Tool | Description |
|------|-------------|
| `estimate_tax(income, province)` | Full 2026 federal + provincial/territorial estimate: `federal_tax`, `provincial_tax`, `total_tax`, `after_tax_income`, `marginal_rate`, `average_rate`, BPA credits applied, notes. Counts against the Free-plan quota (10 estimates/month). |
| `compare_rrsp_tfsa(income, province, contribution)` | RRSP tax saving (= contribution × combined marginal rate), effective after-tax cost, TFSA mechanics note, and a general-information recommendation note. |
| `marginal_rate(income, province)` | Combined federal + provincial/territorial statutory marginal rate on the next dollar, with the containing bracket `bracket_floor`/`bracket_ceiling`. Excludes BPA phase-out effects, surtaxes, and the Ontario Health Premium (those live in `estimate_tax`). |

Inputs are validated with Zod: `income >= 0`, `contribution >= 0`, `province`
must be a 2-letter Canadian code (`BC AB SK MB ON QC NB NS PE NL YT NT NU`).
All tools return structured JSON (`content` + `structuredContent`) and never
crash — bad input yields `isError: true` with an LLM-friendly message.

## Data sources

**All 13 jurisdictions are the 2026 tax year** (no 2025 fallbacks were needed).
`tax_year: 2026` is returned on every tool result.

| Jurisdiction | 2026 brackets (rate → threshold) | 2026 BPA | Source |
|---|---|---|---|
| Federal | 14% → $58,523; 20.5% → $117,045; 26% → $181,440; 29% → $258,482; 33% over | $16,452 max, phases to $14,829 over $181,440–$258,482 | CRA 2026 payroll deduction tables (canada.ca); taxtips.ca federal rates |
| BC | 5.60% → $50,363; 7.70% → $100,728; 10.50% → $115,648; 12.29% → $140,430; 14.70% → $190,405; 16.80% → $265,545; 20.50% over | $13,216 | http://www.taxtips.ca/taxrates/bc.htm (BC 2026 Budget raised lowest bracket 5.06% → 5.60%) |
| AB | 8% → $61,200; 10% → $154,259; 12% → $185,111; 13% → $246,813; 14% → $370,220; 15% over | $22,769 | http://www.taxtips.ca/taxrates/ab.htm; CRA T4032-AB |
| SK | 10.5% → $54,532; 12.5% → $155,805; 14.5% over | $20,381 | saskatchewan.ca "2026 Personal Income Tax Structure"; CRA T4032-SK; http://www.taxtips.ca/taxrates/sk.htm |
| MB | 10.8% → $47,000; 12.75% → $100,000; 17.4% over | $15,780, phases to $0 over $200k–$400k | http://www.taxtips.ca/taxrates/mb.htm |
| ON | 5.05% → $53,891; 9.15% → $107,785; 11.16% → $150,000; 12.16% → $220,000; 13.16% over; +20%/36% surtax over $5,818/$7,446; + ON Health Premium | $12,989 | http://www.taxtips.ca/taxrates/on.htm; CRA ON428 health premium chart |
| QC | 14% → $54,345; 19% → $108,680; 24% → $132,245; 25.75% over; 16.5% federal abatement | $18,952 | http://www.taxtips.ca/taxrates/qc.htm |
| NB | 9.4% → $52,333; 14% → $104,666; 16% → $193,861; 19.5% over | $13,664 | http://www.taxtips.ca/taxrates/nb.htm |
| NS | 8.79% → $30,995; 14.95% → $61,991; 16.67% → $97,417; 17.50% → $157,124; 21% over | $11,932 | http://www.taxtips.ca/taxrates/ns.htm |
| PE | 9.5% → $33,928; 13.47% → $65,820; 16.6% → $106,890; 17.62% → $142,520; 19% → $200,000; **20% over $200,000 (new 2026 bracket)** | $15,000 | http://www.taxtips.ca/taxrates/pe.htm; princeedwardisland.ca; CRA T4032-PE |
| NL | 8.7% → $44,678; 14.5% → $89,354; 15.8% → $159,528; 17.8% → $223,340; 19.8% → $285,319; 20.8% → $570,638; 21.3% → $1,141,275; 21.8% over | $11,188 | http://www.taxtips.ca/taxrates/nl.htm |
| YT | 6.4% → $58,523; 9% → $117,045; 10.9% → $181,440; **12.93% → $258,482 (notch)**; 12.8% → $500,000; 15% over | mirrors federal ($16,452 → $14,829) | http://www.taxtips.ca/taxrates/yt.htm |
| NT | 5.9% → $53,003; 8.6% → $106,009; 12.2% → $172,346; 14.05% over | $18,198 | http://www.taxtips.ca/taxrates/nt.htm |
| NU | 4% → $55,801; 7% → $111,602; 9% → $181,439; 11.5% over | $19,659 | http://www.taxtips.ca/taxrates/nu.htm |

Cross-checked against Tax Templates Inc. "2026 Tax Facts and Tables"
(files.ttiworksheets.ca/2026-Tax-Facts-and-Tables-provided-by-TTI.pdf) and
taxtips.ca's combined marginal-rate tables (which reproduce exactly from
these figures, e.g. ON 43.41%/44.97%/48.26%/49.82%/53.53% bands).

**Validation:** `estimate_tax(100000, "ON")` = **$21,520.55** total —
hand-computed from the tables above and cross-checked against taxtips.ca's
2026 combined marginal bands (BPA-only basis, incl. ON surtax + health
premium). Matches taxtips.ca's 2026 basic calculator within $1.

## Limitations

- **Estimates only — not tax advice.** Verify against CRA before filing or making financial decisions.
- **Federal + provincial/territorial income tax only.** No CPP/QPP, EI, or other payroll deductions.
- **Basic personal amount is the only credit applied** (at the lowest bracket rate, with the federal/MB/YT phase-outs). No age, medical, tuition, donation, dividend, CPP/EI, or Canada employment credits.
- Ontario Health Premium **is** included for ON (it is part of Ontario tax payable). The BC Tax Reduction credit and PEI Low-Income Tax Reduction are **not** modeled (non-BPA credits), so low-income BC/PEI estimates may read slightly high vs. a full return.
- Assumes a single income figure = taxable income, resident in the given province on Dec 31, 2026. No income splitting, attribution, or multi-jurisdiction allocation.
- Quebec: federal abatement (16.5%) applied; Quebec's separate return nuances (e.g. QPP, HSF) are out of scope.

## Pricing

- **Free:** 10 estimates/month (`estimate_tax` calls; configurable via `FREE_MONTHLY_LIMIT`, default 10). Over quota returns a structured error inviting a Pro upgrade.
- **Pro:** $15/month, unlimited.
- No per-call (x402) billing.

## Quick Start

```bash
npm install
npm run dev     # Start with hot reload (http://localhost:8080/mcp)
npm test        # Unit tests (vitest)
bash test-mcp.sh  # MCP protocol smoke test (server must be running)
```

## Development

```bash
npm run dev     # Development mode with hot reload
npm run build   # Compile TypeScript
npm start       # Run compiled server
```

Server runs at `http://localhost:8080/mcp` · Health: `http://localhost:8080/health`
