import { describe, it, expect } from "vitest";
import { summarize } from "../reader";
import type { Transaction } from "../transactions";

const RATES = { rates: { JPY_PHP: 0.38, JPY_USD: 0.0065 }, updatedAt: "2026-08-01" };
const BASE = "JPY";

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

describe("summarize — savings rate", () => {
  it("OCF basis: uses ocfIncome as denominator when ocfIncome > 0", () => {
    const txs: Transaction[] = [
      tx({ type: "income", amount: 100000, category: "Income", subcategory: "Salary", stream: "ocf" }),
      tx({ amount: 30000, stream: "ocf" }),
    ];
    const s = summarize(txs, BASE, RATES);
    expect(s.savingsRateIsOCFBasis).toBe(true);
    expect(s.savingsRate).toBe(70); // (100000 - 30000) / 100000 = 70%
  });

  it("all-income fallback when ocfIncome = 0 (only ICF income)", () => {
    const txs: Transaction[] = [
      tx({ type: "income", amount: 50000, category: "Income", subcategory: "Dividends", stream: "icf" }),
      tx({ amount: 10000, stream: "ocf" }),
    ];
    const s = summarize(txs, BASE, RATES);
    expect(s.savingsRateIsOCFBasis).toBe(false);
    // (totalIncome - totalExpenses) / totalIncome = (50000 - 10000) / 50000 = 80%
    expect(s.savingsRate).toBe(80);
  });

  it("clamps savings rate to 0 when expenses exceed income", () => {
    const txs: Transaction[] = [
      tx({ type: "income", amount: 10000, category: "Income", subcategory: "Salary", stream: "ocf" }),
      tx({ amount: 50000, stream: "ocf" }),
    ];
    const s = summarize(txs, BASE, RATES);
    expect(s.savingsRate).toBe(0); // Math.max(0, ...) floor
  });

  it("returns 0% when no transactions", () => {
    const s = summarize([], BASE, RATES);
    expect(s.savingsRate).toBe(0);
    expect(s.totalIncome).toBe(0);
    expect(s.totalExpenses).toBe(0);
  });

  it("returns 0% with only expenses and no income", () => {
    const txs: Transaction[] = [tx({ amount: 5000, stream: "ocf" })];
    const s = summarize(txs, BASE, RATES);
    expect(s.savingsRate).toBe(0);
  });
});

describe("summarize — cash flow streams", () => {
  it("ocfIncome and ocfExpenses exclude ICF and FCF", () => {
    const txs: Transaction[] = [
      tx({ type: "income", amount: 200000, category: "Income", subcategory: "Salary", stream: "ocf" }),
      tx({ amount: 50000, stream: "ocf" }),   // operating expense
      tx({ amount: 30000, stream: "icf" }),   // investment
      tx({ amount: 40000, stream: "fcf" }),   // loan payment
    ];
    const s = summarize(txs, BASE, RATES);
    expect(s.ocfIncome).toBe(200000);
    expect(s.ocfExpenses).toBe(50000);
    expect(s.netICF).toBe(-30000);
    expect(s.netFinancingCF).toBe(-40000);
    expect(s.freeCashFlow).toBe(200000 - 50000 - 30000 - 40000); // 80000
  });

  it("FCF income (loan disbursement) adds to netFinancingCF, not ocfIncome", () => {
    const txs: Transaction[] = [
      tx({ type: "income", amount: 500000, category: "Income", subcategory: "Loan proceeds", stream: "fcf" }),
    ];
    const s = summarize(txs, BASE, RATES);
    expect(s.ocfIncome).toBe(0);
    expect(s.netFinancingCF).toBe(500000); // FCF income increases netFinancingCF
    expect(s.totalIncome).toBe(500000);
    expect(s.savingsRateIsOCFBasis).toBe(false); // falls back to all-income
  });

  it("multi-currency amounts are converted to base", () => {
    // 1000 PHP at JPY_PHP=0.38 → 1/0.38 ≈ 2631 JPY
    const txs: Transaction[] = [
      tx({ type: "income", amount: 10000, currency: "PHP", category: "Income", subcategory: "Freelance", stream: "ocf" }),
    ];
    const s = summarize(txs, BASE, RATES);
    // 10000 PHP → 10000 / 0.38 ≈ 26315 JPY (JPY_PHP rate = 0.38 means 1 JPY = 0.38 PHP)
    expect(s.totalIncome).toBeGreaterThan(20000); // must be a large JPY number
    expect(s.totalIncome).toBeLessThan(35000);
  });

  it("remittances counted separately under Family > Remittance", () => {
    const txs: Transaction[] = [
      tx({ type: "income", amount: 100000, category: "Income", subcategory: "Salary", stream: "ocf" }),
      tx({ amount: 30000, category: "Family", subcategory: "Remittance", stream: "ocf" }),
    ];
    const s = summarize(txs, BASE, RATES);
    expect(s.totalRemittances).toBe(30000);
  });
});

describe("summarize — net values", () => {
  it("net = totalIncome - totalExpenses regardless of stream", () => {
    const txs: Transaction[] = [
      tx({ type: "income", amount: 300000, category: "Income", subcategory: "Salary", stream: "ocf" }),
      tx({ amount: 50000, stream: "ocf" }),
      tx({ amount: 40000, stream: "fcf" }),
    ];
    const s = summarize(txs, BASE, RATES);
    expect(s.net).toBe(300000 - 50000 - 40000);
  });

  it("freeCashFlow = netOCF + netICF + netFinancingCF", () => {
    const txs: Transaction[] = [
      tx({ type: "income", amount: 200000, category: "Income", subcategory: "Salary", stream: "ocf" }),
      tx({ amount: 60000, stream: "ocf" }),
      tx({ amount: 20000, stream: "icf" }),
      tx({ amount: 15000, stream: "fcf" }),
    ];
    const s = summarize(txs, BASE, RATES);
    expect(s.freeCashFlow).toBe(s.netOCF + s.netICF + s.netFinancingCF);
  });
});

describe("summarize — income statement identity (regression guard)", () => {
  it("ocfIncome - ocfExpenses = netOCF always", () => {
    const txs: Transaction[] = [
      tx({ type: "income", amount: 200000, category: "Income", subcategory: "Salary", stream: "ocf" }),
      tx({ type: "income", amount: 50000, category: "Income", subcategory: "Dividends", stream: "icf" }),
      tx({ type: "income", amount: 300000, category: "Income", subcategory: "Loan proceeds", stream: "fcf" }),
      tx({ amount: 80000, stream: "ocf" }),
    ];
    const s = summarize(txs, BASE, RATES);
    // Core identity: must always hold
    expect(s.netOCF).toBe(s.ocfIncome - s.ocfExpenses);
    // Non-OCF income must NOT be in ocfIncome
    expect(s.ocfIncome).toBe(200000);
    expect(s.totalIncome).toBe(550000); // all streams
    // Income statement: Total Operating Revenue (ocfIncome) - Total Operating Expenses = Net Period Result (netOCF)
    expect(s.ocfIncome - s.ocfExpenses).toBe(200000 - 80000); // 120000
    // Verify totalIncome - ocfIncome = non-operating income (ICF + FCF)
    expect(s.totalIncome - s.ocfIncome).toBe(350000);
  });

  it("ocfByCategory sums exactly to ocfExpenses", () => {
    const txs: Transaction[] = [
      tx({ amount: 30000, category: "Housing", stream: "ocf" }),
      tx({ amount: 15000, category: "Food & Drink", stream: "ocf" }),
      tx({ amount: 40000, category: "Other", stream: "fcf" }), // FCF — must NOT appear in ocfByCategory
    ];
    const s = summarize(txs, BASE, RATES);
    const ocfSum = Object.values(s.ocfByCategory).reduce((a, b) => a + b, 0);
    expect(ocfSum).toBe(s.ocfExpenses);
    expect(s.ocfByCategory["Other"]).toBeUndefined(); // FCF expense excluded
    expect(s.ocfByCategory["Housing"]).toBe(30000);
    expect(s.ocfByCategory["Food & Drink"]).toBe(15000);
  });
});

describe("summarize — savingsRateIsDeficit flag", () => {
  it("isDeficit is false when savings rate is positive", () => {
    const txs: Transaction[] = [
      tx({ type: "income", amount: 300000, currency: "JPY", subcategory: "Salary", category: "Income", stream: "ocf" }),
      tx({ amount: 100000, currency: "JPY", stream: "ocf" }),
    ];
    const s = summarize(txs, BASE, RATES);
    expect(s.savingsRateIsDeficit).toBe(false);
    expect(s.savingsRate).toBe(67);
  });

  it("isDeficit is true when OCF expenses exceed OCF income (deficit month)", () => {
    const txs: Transaction[] = [
      tx({ type: "income", amount: 100000, currency: "JPY", subcategory: "Salary", category: "Income", stream: "ocf" }),
      tx({ amount: 200000, currency: "JPY", stream: "ocf" }), // spends more than earns
    ];
    const s = summarize(txs, BASE, RATES);
    expect(s.savingsRateIsDeficit).toBe(true);
    expect(s.savingsRate).toBe(0); // clamped but deficit is signaled
  });

  it("isDeficit is false when savingsRateBasis is na", () => {
    const txs: Transaction[] = [
      tx({ type: "income", amount: 500000, currency: "JPY", subcategory: "Loan", category: "Income", stream: "fcf" }),
    ];
    const s = summarize(txs, BASE, RATES);
    expect(s.savingsRateBasis).toBe("na");
    expect(s.savingsRateIsDeficit).toBe(false); // na path — no computation, no deficit signal
  });
});

describe("summarize — calcComposure stream isolation regression guard", () => {
  it("ocfByCategory excludes ICF and FCF expenses — investments and loan payments do not distort spending", () => {
    const txs: Transaction[] = [
      tx({ amount: 50000, category: "Food & Drink", stream: "ocf" }),
      tx({ amount: 100000, category: "Investing", stream: "icf" }),  // ICF — must NOT be in ocfByCategory
      tx({ amount: 90000, category: "Other", stream: "fcf" }),        // FCF — must NOT be in ocfByCategory
    ];
    const s = summarize(txs, BASE, RATES);
    // ocfByCategory must only contain Food & Drink
    expect(Object.keys(s.ocfByCategory)).toEqual(["Food & Drink"]);
    expect(s.ocfByCategory["Food & Drink"]).toBe(50000);
    expect(s.ocfByCategory["Investing"]).toBeUndefined();
    expect(s.ocfByCategory["Other"]).toBeUndefined();
    // ocfExpenses must only sum OCF
    expect(s.ocfExpenses).toBe(50000);
    // totalExpenses includes all streams
    expect(s.totalExpenses).toBe(240000);
  });
});
