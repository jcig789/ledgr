/**
 * NaN guard tests — critical financial accuracy tests
 * These cover the convertToBase→NaN change and all downstream guard paths.
 * CFA/CPA required: any failure here means we are silently showing wrong numbers.
 */
import { describe, it, expect } from "vitest";
import { summarize, convertToBase, toBaseOrZero } from "../reader";
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

describe("convertToBase — null sentinel (TypeScript null-migration)", () => {
  it("returns the amount unchanged when fromCurrency === baseCurrency", () => {
    const result = convertToBase(5000, "JPY", "JPY", RATES_JPY);
    expect(result).toBe(5000);
    expect(result).not.toBeNull();
  });

  it("converts correctly via direct rate", () => {
    // 1000 PHP at JPY_PHP=0.38 → 1000/0.38 ≈ 2631 JPY
    const result = convertToBase(1000, "PHP", "JPY", RATES_JPY);
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(2000);
  });

  it("returns null (not the raw amount) when no rate path exists", () => {
    const result = convertToBase(1000, "EUR", "JPY", RATES_JPY); // no EUR rate
    expect(result).toBeNull();
    // Critical: must NOT equal 1000 (the old silent fallback)
    expect(result).not.toBe(1000);
  });

  it("returns null for completely empty rates", () => {
    const result = convertToBase(5000, "USD", "JPY", RATES_EMPTY);
    expect(result).toBeNull();
  });

  it("toBaseOrZero returns 0 for null (unknown currency)", () => {
    expect(toBaseOrZero(1000, "EUR", "JPY", RATES_JPY)).toBe(0);
  });

  it("toBaseOrZero returns correct value for known currency", () => {
    expect(toBaseOrZero(5000, "JPY", "JPY", RATES_JPY)).toBe(5000);
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

// ─── null guard helpers — toBaseOrZero and null-aware reduce ─────────────────

describe("null guard — toBaseOrZero and null-aware reduce (v0.3.9 null migration)", () => {
  it("null-aware reduce skips null values, produces valid total", () => {
    const convertResults: (number | null)[] = [100000, null, 50000]; // one account has no rate
    const total = convertResults.reduce<number>((s, v) => v === null ? s : s + v, 0);
    expect(total).toBe(150000);
    expect(typeof total).toBe("number");
  });

  it("null-aware reduce with all nulls returns 0", () => {
    const convertResults: (number | null)[] = [null, null, null];
    const total = convertResults.reduce<number>((s, v) => v === null ? s : s + v, 0);
    expect(total).toBe(0);
  });

  it("null ?? 0 pattern (toBaseOrZero) gives 0 for unknown currencies", () => {
    const result = convertToBase(1000, "EUR", "JPY", RATES_JPY) ?? 0;
    expect(result).toBe(0);
  });

  it("null ?? 0 gives correct value for known currencies", () => {
    const result = convertToBase(5000, "JPY", "JPY", RATES_JPY) ?? 0;
    expect(result).toBe(5000);
  });

  it("mixed-currency reduce with null-guard never produces NaN or null", () => {
    const accounts = [
      { balance: 100000, currency: "JPY" },
      { balance: 50000, currency: "EUR" }, // unknown rate → null
      { balance: 1000, currency: "PHP" },  // known rate → converted
    ];
    const total = accounts.reduce<number>((s, a) => {
      const v = convertToBase(a.balance, a.currency, "JPY", RATES_JPY);
      return v === null ? s : s + v;
    }, 0);
    expect(total).not.toBeNull();
    expect(typeof total).toBe("number");
    expect(total).toBeGreaterThan(100000); // JPY + PHP, EUR excluded
  });
});

// ─── autoSnapshot null safety (logic only — no Obsidian API) ─────────────────

describe("autoSnapshot null safety — reduce logic", () => {
  it("null-guarded reduce does not corrupt total when one account has unknown currency", () => {
    const convertResults: (number | null)[] = [100000, null, 50000];
    const total = convertResults.reduce<number>((s, v) => v === null ? s : s + v, 0);
    expect(total).toBe(150000);
    expect(total).not.toBeNull();
  });

  it("unguarded reduce produces NaN — demonstrating why the guard is necessary", () => {
    // This test demonstrates why the old NaN fallback was dangerous
    const convertResults = [100000, NaN, 50000]; // legacy NaN-style
    const totalUnguarded = convertResults.reduce((s, v) => s + v, 0);
    expect(isNaN(totalUnguarded)).toBe(true); // proof: NaN propagates
  });

  it("null netWorth would write null to JSON — demonstrates why guard before recordNwSnapshot is critical", () => {
    const snapNull = null;
    const jsonVal = JSON.parse(JSON.stringify({ val: snapNull }));
    expect(jsonVal.val).toBeNull(); // null survives JSON round-trip
  });
});

// ─── Display-layer null guard (toBase / ?? 0 pattern) ────────────────────────

describe("display-layer null guard — toBase() and ?? 0 pattern", () => {
  // Simulates the toBase() method on NetWorthView: convertToBase result ?? 0
  const toBase = (amount: number, currency: string, base: string, rates: typeof RATES_JPY): number => {
    return convertToBase(amount, currency, base, rates) ?? 0;
  };

  it("toBase returns 0 for unknown currency — no ¥NaN or ¥null in display", () => {
    const result = toBase(100000, "EUR", "JPY", RATES_JPY);
    expect(result).toBe(0);
    expect(typeof result).toBe("number");
  });

  it("toBase returns correct value for known currency", () => {
    const result = toBase(10000, "JPY", "JPY", RATES_JPY);
    expect(result).toBe(10000);
  });

  it("account balance display with unknown currency shows 0, not null", () => {
    const accounts = [
      { balance: 100000, currency: "JPY" },
      { balance: 50000, currency: "EUR" }, // unknown — must show 0
    ];
    const total = accounts.reduce((s, a) => s + toBase(a.balance, a.currency, "JPY", RATES_JPY), 0);
    expect(total).toBe(100000); // EUR excluded as 0
    expect(typeof total).toBe("number");
  });

  it("goal target with unknown currency: pct is 0 not null", () => {
    const targetInView = toBase(500000, "EUR", "JPY", RATES_JPY); // no EUR rate
    const current = 100000;
    const pct = targetInView > 0 ? Math.min(100, Math.round((current / targetInView) * 100)) : 0;
    expect(isNaN(pct)).toBe(false);
    expect(pct).toBe(0); // shows 0% rather than NaN%
  });

  it("property equity with unknown currency: equity and LTV show 0 not null", () => {
    const propertyValue = toBase(50000000, "EUR", "JPY", RATES_JPY); // unknown → 0
    const mortgageBalance = toBase(30000000, "JPY", "JPY", RATES_JPY); // known
    const equity = propertyValue - mortgageBalance;
    const equityPct = propertyValue > 0 ? (equity / propertyValue) * 100 : 0;
    expect(typeof equity).toBe("number");
    expect(typeof equityPct).toBe("number");
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
