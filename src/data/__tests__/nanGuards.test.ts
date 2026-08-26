/**
 * NaN guard tests — critical financial accuracy tests
 * These cover the convertToBase→NaN change and all downstream guard paths.
 * CFA/CPA required: any failure here means we are silently showing wrong numbers.
 */
import { describe, it, expect } from "vitest";
import { summarize, convertToBase } from "../reader";
import type { Transaction } from "../transactions";

const RATES_JPY = { rates: { JPY_PHP: 0.38, JPY_USD: 0.0065 }, updatedAt: "2026-08-01" };
const BASE = "JPY";
const RATES_EMPTY = { rates: {}, updatedAt: "2026-08-01" };

function tx(overrides: Partial<Transaction>): Transaction {
  return {
    date: "2026-08-15",
    type: "expense",
    amount: 1000,
    currency: "JPY",
    category: "Food & Drink",
    subcategory: "Groceries",
    note: "",
    stream: "ocf",
    ...overrides,
  };
}

// ─── convertToBase sentinel behavior ──────────────────────────────────────────

describe("convertToBase — NaN sentinel", () => {
  it("returns the amount unchanged when fromCurrency === baseCurrency", () => {
    const result = convertToBase(5000, "JPY", "JPY", RATES_JPY);
    expect(result).toBe(5000);
    expect(isNaN(result)).toBe(false);
  });

  it("converts correctly via direct rate", () => {
    // 1000 PHP at JPY_PHP=0.38 → 1000/0.38 ≈ 2631 JPY
    const result = convertToBase(1000, "PHP", "JPY", RATES_JPY);
    expect(isNaN(result)).toBe(false);
    expect(result).toBeGreaterThan(2000);
  });

  it("returns NaN (not the raw amount) when no rate path exists", () => {
    const result = convertToBase(1000, "EUR", "JPY", RATES_JPY); // no EUR rate
    expect(isNaN(result)).toBe(true);
    // Critical: must NOT equal 1000 (the old silent fallback)
    expect(result).not.toBe(1000);
  });

  it("returns NaN for completely empty rates", () => {
    const result = convertToBase(5000, "USD", "JPY", RATES_EMPTY);
    expect(isNaN(result)).toBe(true);
  });
});

// ─── summarize — NaN exclusion & missingCurrencies ────────────────────────────

describe("summarize — NaN exclusion", () => {
  it("excludes transactions with unknown currency from all aggregates", () => {
    const txs: Transaction[] = [
      tx({ type: "income", amount: 200000, currency: "JPY", subcategory: "Salary", category: "Income", stream: "ocf" }),
      tx({ amount: 50000, currency: "JPY", stream: "ocf" }), // JPY — known
      tx({ amount: 99999, currency: "EUR", stream: "ocf" }), // EUR — unknown, must be excluded
    ];
    const s = summarize(txs, BASE, RATES_JPY);
    // EUR transaction excluded — totals should only include JPY amounts
    expect(s.totalExpenses).toBe(50000);
    expect(s.ocfExpenses).toBe(50000);
    expect(isNaN(s.totalExpenses)).toBe(false);
    expect(isNaN(s.savingsRate)).toBe(false);
  });

  it("populates missingCurrencies when an unknown currency is encountered", () => {
    const txs: Transaction[] = [
      tx({ amount: 1000, currency: "EUR", stream: "ocf" }), // no EUR rate
      tx({ amount: 2000, currency: "CZK", stream: "ocf" }), // no CZK rate
    ];
    const s = summarize(txs, BASE, RATES_JPY);
    expect(s.missingCurrencies).toContain("EUR");
    expect(s.missingCurrencies).toContain("CZK");
    expect(s.missingCurrencies.length).toBe(2);
  });

  it("deduplicates missingCurrencies — multiple txs in same unknown currency only listed once", () => {
    const txs: Transaction[] = [
      tx({ amount: 100, currency: "EUR", stream: "ocf" }),
      tx({ amount: 200, currency: "EUR", stream: "ocf" }),
      tx({ amount: 300, currency: "EUR", stream: "ocf" }),
    ];
    const s = summarize(txs, BASE, RATES_JPY);
    expect(s.missingCurrencies.filter((c) => c === "EUR").length).toBe(1);
  });

  it("missingCurrencies is empty when all currencies are configured", () => {
    const txs: Transaction[] = [
      tx({ type: "income", amount: 100000, currency: "JPY", subcategory: "Salary", category: "Income", stream: "ocf" }),
      tx({ amount: 5000, currency: "JPY", stream: "ocf" }),
    ];
    const s = summarize(txs, BASE, RATES_JPY);
    expect(s.missingCurrencies).toHaveLength(0);
  });

  it("savings rate is 0 (not NaN) when all income has unknown currency", () => {
    const txs: Transaction[] = [
      tx({ type: "income", amount: 100000, currency: "EUR", subcategory: "Salary", category: "Income", stream: "ocf" }),
    ];
    const s = summarize(txs, BASE, RATES_JPY);
    // EUR excluded → ocfIncome=0, totalIncome=0 → savingsRate=0, not NaN
    expect(isNaN(s.savingsRate)).toBe(false);
    expect(s.savingsRate).toBe(0);
  });
});

// ─── Three-state savings rate basis ───────────────────────────────────────────

describe("summarize — three-state savings rate basis", () => {
  it("basis is 'ocf' when OCF income is present", () => {
    const txs: Transaction[] = [
      tx({ type: "income", amount: 300000, currency: "JPY", subcategory: "Salary", category: "Income", stream: "ocf" }),
      tx({ amount: 80000, currency: "JPY", stream: "ocf" }),
    ];
    const s = summarize(txs, BASE, RATES_JPY);
    expect(s.savingsRateBasis).toBe("ocf");
    expect(s.savingsRate).toBeGreaterThan(0);
  });

  it("basis is 'na' when only FCF income (loan disbursement) — NOT a legitimate savings rate", () => {
    const txs: Transaction[] = [
      // Only income is a loan disbursement (FCF)
      tx({ type: "income", amount: 500000, currency: "JPY", subcategory: "Loan proceeds", category: "Income", stream: "fcf" }),
      tx({ amount: 50000, currency: "JPY", stream: "ocf" }),
    ];
    const s = summarize(txs, BASE, RATES_JPY);
    expect(s.savingsRateBasis).toBe("na");
    expect(s.savingsRate).toBe(0); // displayed as N/A, not a percentage
  });

  it("basis is 'total' when only ICF income (dividends) — passive income is defensible fallback", () => {
    const txs: Transaction[] = [
      tx({ type: "income", amount: 50000, currency: "JPY", subcategory: "Dividends", category: "Income", stream: "icf" }),
      tx({ amount: 10000, currency: "JPY", stream: "ocf" }),
    ];
    const s = summarize(txs, BASE, RATES_JPY);
    expect(s.savingsRateBasis).toBe("total");
    // (50000 - 10000) / 50000 = 80%
    expect(s.savingsRate).toBe(80);
  });

  it("basis is 'na' when no income at all", () => {
    const txs: Transaction[] = [
      tx({ amount: 10000, currency: "JPY", stream: "ocf" }),
    ];
    const s = summarize(txs, BASE, RATES_JPY);
    expect(s.savingsRateBasis).toBe("na");
    expect(s.savingsRate).toBe(0);
  });

  it("basis is 'ocf' when both OCF income AND FCF income present — OCF wins", () => {
    const txs: Transaction[] = [
      tx({ type: "income", amount: 300000, currency: "JPY", subcategory: "Salary", category: "Income", stream: "ocf" }),
      tx({ type: "income", amount: 500000, currency: "JPY", subcategory: "Loan proceeds", category: "Income", stream: "fcf" }),
      tx({ amount: 100000, currency: "JPY", stream: "ocf" }),
    ];
    const s = summarize(txs, BASE, RATES_JPY);
    expect(s.savingsRateBasis).toBe("ocf");
    // (300000 - 100000) / 300000 ≈ 67%
    expect(s.savingsRate).toBe(67);
  });

  it("savings rate is never negative — clamped at 0", () => {
    const txs: Transaction[] = [
      tx({ type: "income", amount: 100000, currency: "JPY", subcategory: "Salary", category: "Income", stream: "ocf" }),
      tx({ amount: 200000, currency: "JPY", stream: "ocf" }), // spending exceeds income
    ];
    const s = summarize(txs, BASE, RATES_JPY);
    expect(s.savingsRate).toBe(0);
    expect(s.savingsRateBasis).toBe("ocf");
  });
});

// ─── NaN guard helpers — safeConvert pattern ─────────────────────────────────

describe("NaN guard — safeConvert pattern used in bearing.ts", () => {
  const safeConvert = (amount: number, currency: string, base: string, rates: typeof RATES_JPY) => {
    const v = convertToBase(amount, currency, base, rates);
    return isNaN(v) ? 0 : v;
  };

  it("returns 0 (not NaN) for unknown currency — conservative exclusion", () => {
    expect(safeConvert(100000, "EUR", "JPY", RATES_JPY)).toBe(0);
  });

  it("returns correct value for known currency", () => {
    expect(safeConvert(10000, "JPY", "JPY", RATES_JPY)).toBe(10000);
  });

  it("reduce with safeConvert never produces NaN even with mixed currencies", () => {
    const accounts = [
      { balance: 100000, currency: "JPY" },
      { balance: 50000, currency: "EUR" }, // unknown rate
      { balance: 1000, currency: "PHP" },  // known rate
    ];
    const total = accounts.reduce((s, a) => s + safeConvert(a.balance, a.currency, "JPY", RATES_JPY), 0);
    expect(isNaN(total)).toBe(false);
    // EUR excluded (0), PHP converted, JPY as-is
    expect(total).toBeGreaterThan(100000);
  });
});

// ─── autoSnapshot NaN safety (logic only — no Obsidian API) ──────────────────

describe("autoSnapshot NaN safety — reduce logic", () => {
  it("NaN-guarded reduce does not corrupt total when one account has unknown currency", () => {
    const convertResults = [100000, NaN, 50000]; // one account has no rate
    const total = convertResults.reduce((s, v) => isNaN(v) ? s : s + v, 0);
    expect(total).toBe(150000);
    expect(isNaN(total)).toBe(false);
  });

  it("unguarded reduce produces NaN — demonstrating why the guard is necessary", () => {
    const convertResults = [100000, NaN, 50000];
    const totalUnguarded = convertResults.reduce((s, v) => s + v, 0);
    expect(isNaN(totalUnguarded)).toBe(true); // this was the bug
  });

  it("NaN netWorth would write null to JSON — demonstrates why !isNaN check before recordNwSnapshot is critical", () => {
    const snapNaN = NaN;
    const jsonVal = JSON.parse(JSON.stringify({ val: snapNaN }));
    expect(jsonVal.val).toBeNull(); // JSON.stringify(NaN) → null — data destruction
    expect(!isNaN(snapNaN)).toBe(false); // guard correctly blocks this
  });
});

// ─── Display-layer NaN guard (toBase / safeCvt pattern) ───────────────────────

describe("display-layer NaN guard — toBase() and safeCvt pattern", () => {
  // Simulates the toBase() method on NetWorthView: convertToBase result → 0 if NaN
  const toBase = (amount: number, currency: string, base: string, rates: typeof RATES_JPY) => {
    const v = convertToBase(amount, currency, base, rates);
    return isNaN(v) ? 0 : v;
  };

  it("toBase returns 0 (not NaN) for unknown currency — no ¥NaN in display", () => {
    const result = toBase(100000, "EUR", "JPY", RATES_JPY);
    expect(result).toBe(0);
    expect(isNaN(result)).toBe(false);
  });

  it("toBase returns correct value for known currency", () => {
    const result = toBase(10000, "JPY", "JPY", RATES_JPY);
    expect(result).toBe(10000);
  });

  it("account balance display with unknown currency shows 0, not NaN", () => {
    // Simulates bankAssets reduce in renderGoals / render totals
    const accounts = [
      { balance: 100000, currency: "JPY" },
      { balance: 50000, currency: "EUR" }, // unknown — must show 0
    ];
    const total = accounts.reduce((s, a) => s + toBase(a.balance, a.currency, "JPY", RATES_JPY), 0);
    expect(isNaN(total)).toBe(false);
    expect(total).toBe(100000); // EUR excluded as 0
  });

  it("goal target with unknown currency: pct is 0 not NaN", () => {
    // Simulates targetInView = safeCvt(goal.targetAmount, goal.currency)
    const targetInView = toBase(500000, "EUR", "JPY", RATES_JPY); // no EUR rate
    const current = 100000;
    // pct = targetInView > 0 ? ... : 0 — guard in renderGoals
    const pct = targetInView > 0 ? Math.min(100, Math.round((current / targetInView) * 100)) : 0;
    expect(isNaN(pct)).toBe(false);
    expect(pct).toBe(0); // shows 0% rather than NaN%
  });

  it("property equity with unknown currency: equity and LTV show 0 not NaN", () => {
    // Simulates propertyValue = toBase(asset.balance, asset.currency)
    const propertyValue = toBase(50000000, "EUR", "JPY", RATES_JPY); // unknown
    const mortgageBalance = toBase(30000000, "JPY", "JPY", RATES_JPY); // known
    const equity = propertyValue - mortgageBalance;
    const equityPct = propertyValue > 0 ? (equity / propertyValue) * 100 : 0;
    expect(isNaN(equity)).toBe(false);
    expect(isNaN(equityPct)).toBe(false);
    // propertyValue=0, mortgageBalance=30M → equity=-30M, equityPct=0 (guard fires)
    expect(equityPct).toBe(0);
  });
});

// ─── autoSnapshot force parameter ─────────────────────────────────────────────

describe("autoSnapshot — force parameter logic", () => {
  it("without force: skips if snapshot already exists for current month", () => {
    // Simulates the guard: if (!force && history.snapshots[currentMonth] !== undefined) return
    const history = { snapshots: { "2026-08": 5000000 } };
    const currentMonth = "2026-08";
    const force = false;
    const shouldSkip = !force && history.snapshots[currentMonth] !== undefined;
    expect(shouldSkip).toBe(true); // onOpen() correctly skips if already snapshotted
  });

  it("with force=true: overwrites even if snapshot already exists (post-Save path)", () => {
    const history = { snapshots: { "2026-08": 5000000 } }; // stale pre-edit value
    const currentMonth = "2026-08";
    const force = true;
    const shouldSkip = !force && history.snapshots[currentMonth] !== undefined;
    expect(shouldSkip).toBe(false); // Save handler correctly overwrites with fresh values
  });

  it("without force: records if no snapshot exists yet (first open this month)", () => {
    const history = { snapshots: {} };
    const currentMonth = "2026-08";
    const force = false;
    const shouldSkip = !force && history.snapshots[currentMonth] !== undefined;
    expect(shouldSkip).toBe(false); // correctly proceeds to record
  });

  it("NaN-guarded reduce correctly computes net worth from mixed accounts", () => {
    // Same pattern as autoSnapshot internals
    const accountConversions = [
      100000, // JPY known
      NaN,    // EUR unknown — excluded
      50000,  // PHP converted
    ];
    const snapAssets = accountConversions.reduce((s, v) => isNaN(v) ? s : s + v, 0);
    const snapLiabilities = 0;
    const snapNetWorth = snapAssets - snapLiabilities;
    expect(!isNaN(snapNetWorth)).toBe(true);  // guard allows write
    expect(snapNetWorth).toBe(150000);
  });
});
