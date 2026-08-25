import { describe, it, expect, beforeAll } from "vitest";
import { calcAmortization, calcExtraPayment, rankDebts } from "../debtCost";

// Stub window.moment so debtCost.ts can call it without a browser
beforeAll(() => {
  (globalThis as Record<string, unknown>).window = {
    moment: (d: string) => ({
      add: (n: number, unit: string) => ({
        format: () => {
          const date = new Date(d + "-01");
          date.setMonth(date.getMonth() + n);
          return date.toISOString().slice(0, 7);
        },
      }),
    }),
  };
});

describe("calcAmortization", () => {
  it("returns canAmortize:false when payment does not cover monthly interest", () => {
    // balance=100000, APR=24% (2%/mo), payment=1500 → interest=2000 → principal=-500
    const result = calcAmortization(100000, 24, 1500, "2026-01");
    expect(result.canAmortize).toBe(false);
    expect(result.monthsToPayoff).toBe(0);
    expect(result.totalCost).toBe(0);
  });

  it("computes correct payoff months at 0% APR", () => {
    const result = calcAmortization(10000, 0, 1000, "2026-01");
    expect(result.canAmortize).toBe(true);
    expect(result.monthsToPayoff).toBe(10);
    expect(result.totalInterest).toBe(0);
    expect(result.totalCost).toBeCloseTo(10000, 0);
  });

  it("does not overstate totalCost at APR>0 (exact last payment)", () => {
    // balance=1000, APR=12% (1%/mo), payment=100
    // n_float ≈ 10.589, monthsFull=10, months=11
    const result = calcAmortization(1000, 12, 100, "2026-01");
    expect(result.canAmortize).toBe(true);
    expect(result.monthsToPayoff).toBe(11);
    // totalCost must be < 11 × 100 = 1100 (old ceiling formula)
    expect(result.totalCost).toBeLessThan(1100);
    // totalCost must be ≥ original balance
    expect(result.totalCost).toBeGreaterThanOrEqual(1000);
    // totalInterest = totalCost - balance, must be non-negative
    expect(result.totalInterest).toBeGreaterThanOrEqual(0);
    expect(result.totalInterest).toBeCloseTo(result.totalCost - 1000, 0);
  });

  it("handles single-payment APR>0 correctly (monthsFull=0)", () => {
    // balance=500, APR=12% (1%/mo), payment=600 → paid off in <1 month
    const result = calcAmortization(500, 12, 600, "2026-01");
    expect(result.canAmortize).toBe(true);
    expect(result.monthsToPayoff).toBe(1);
    // Cost should include one month's interest: 500 * 1.01 = 505
    expect(result.totalCost).toBeCloseTo(505, 0);
    expect(result.totalInterest).toBeCloseTo(5, 0);
  });

  it("returns zero balance correctly", () => {
    const result = calcAmortization(0, 12, 100, "2026-01");
    // 0 balance: principalThisMonth = payment - 0 = 100 > 0, canAmortize:true
    expect(result.canAmortize).toBe(true);
    expect(result.monthsToPayoff).toBe(0);
    expect(result.totalInterest).toBe(0);
    expect(result.totalCost).toBeCloseTo(0, 0);
  });

  it("calculates a realistic mortgage scenario", () => {
    // balance=30,000,000 JPY, APR=1.0% (0.0833%/mo), payment=90,000/mo
    const result = calcAmortization(30_000_000, 1.0, 90_000, "2026-01");
    expect(result.canAmortize).toBe(true);
    expect(result.monthsToPayoff).toBeGreaterThan(300); // ~35 years
    expect(result.monthsToPayoff).toBeLessThan(500);
    expect(result.totalInterest).toBeGreaterThan(0);
    expect(result.totalCost).toBeGreaterThan(30_000_000);
    // totalCost must not equal monthsToPayoff * 90000 (that was the bug)
    expect(result.totalCost).not.toBe(result.monthsToPayoff * 90_000);
  });
});

describe("calcExtraPayment", () => {
  it("extra payment reduces months and interest", () => {
    const base = calcAmortization(10000, 12, 300, "2026-01");
    const extra = calcExtraPayment(10000, 12, 300, 100, "2026-01");
    expect(extra.monthsToPayoff).toBeLessThan(base.monthsToPayoff);
    expect(extra.totalInterest).toBeLessThan(base.totalInterest);
    expect(extra.monthsSaved).toBeGreaterThan(0);
    expect(extra.interestSaved).toBeGreaterThan(0);
  });

  it("extra payment savings are non-negative", () => {
    const extra = calcExtraPayment(5000, 18, 200, 50, "2026-01");
    expect(extra.monthsSaved).toBeGreaterThanOrEqual(0);
    expect(extra.interestSaved).toBeGreaterThanOrEqual(0);
  });
});

describe("rankDebts", () => {
  it("avalanche ranks by highest APR first", () => {
    const debts = [
      { id: "a", name: "A", balance: 1000, apr: 5 },
      { id: "b", name: "B", balance: 2000, apr: 18 },
      { id: "c", name: "C", balance: 500, apr: 12 },
    ];
    const ranked = rankDebts(debts);
    const byId = Object.fromEntries(ranked.map((r) => [r.accountId, r]));
    expect(byId["b"].avalancheRank).toBe(1); // highest APR
    expect(byId["c"].avalancheRank).toBe(2);
    expect(byId["a"].avalancheRank).toBe(3);
  });

  it("snowball ranks by lowest balance first", () => {
    const debts = [
      { id: "a", name: "A", balance: 1000, apr: 5 },
      { id: "b", name: "B", balance: 2000, apr: 18 },
      { id: "c", name: "C", balance: 500, apr: 12 },
    ];
    const ranked = rankDebts(debts);
    const byId = Object.fromEntries(ranked.map((r) => [r.accountId, r]));
    expect(byId["c"].snowballRank).toBe(1); // lowest balance
    expect(byId["a"].snowballRank).toBe(2);
    expect(byId["b"].snowballRank).toBe(3);
  });
});
