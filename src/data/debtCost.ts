// Pure debt cost analysis functions — no Obsidian imports

export interface AmortizationSummary {
  monthlyInterest: number;
  principalThisMonth: number;
  monthsToPayoff: number;
  payoffDate: string;         // YYYY-MM
  totalInterest: number;
  totalCost: number;
  canAmortize: boolean;       // false if payment doesn't cover interest
}

export interface ExtraPaymentScenario {
  monthsToPayoff: number;
  payoffDate: string;
  totalInterest: number;
  monthsSaved: number;
  interestSaved: number;
}

export interface DebtPriority {
  accountId: string;
  name: string;
  balance: number;
  apr: number;
  avalancheRank: number;
  snowballRank: number;
}

export function calcAmortization(
  balance: number,
  apr: number,            // e.g. 15.9 for 15.9%
  monthlyPayment: number,
  fromMonth: string       // "YYYY-MM"
): AmortizationSummary {
  const monthlyRate = apr / 100 / 12;
  const monthlyInterest = balance * monthlyRate;
  const principalThisMonth = monthlyPayment - monthlyInterest;

  if (principalThisMonth <= 0) {
    return {
      monthlyInterest,
      principalThisMonth: 0,
      monthsToPayoff: 0,
      payoffDate: "",
      totalInterest: 0,
      totalCost: 0,
      canAmortize: false,
    };
  }

  // Standard annuity payoff formula
  const months = monthlyRate > 0
    ? Math.ceil(Math.log(monthlyPayment / (monthlyPayment - balance * monthlyRate)) / Math.log(1 + monthlyRate))
    : Math.ceil(balance / monthlyPayment);

  const totalCost = monthlyPayment * months;
  const totalInterest = totalCost - balance;
  const payoffDate = window.moment(fromMonth).add(months, "months").format("YYYY-MM");

  return {
    monthlyInterest,
    principalThisMonth,
    monthsToPayoff: months,
    payoffDate,
    totalInterest: Math.max(0, totalInterest),
    totalCost,
    canAmortize: true,
  };
}

export function calcExtraPayment(
  balance: number,
  apr: number,
  monthlyPayment: number,
  extraMonthly: number,
  fromMonth: string
): ExtraPaymentScenario {
  const base = calcAmortization(balance, apr, monthlyPayment, fromMonth);
  const withExtra = calcAmortization(balance, apr, monthlyPayment + extraMonthly, fromMonth);

  return {
    monthsToPayoff: withExtra.monthsToPayoff,
    payoffDate: withExtra.payoffDate,
    totalInterest: withExtra.totalInterest,
    monthsSaved: base.monthsToPayoff - withExtra.monthsToPayoff,
    interestSaved: base.totalInterest - withExtra.totalInterest,
  };
}

export function rankDebts(
  debts: { id: string; name: string; balance: number; apr: number }[]
): DebtPriority[] {
  const byApr = [...debts].sort((a, b) => b.apr - a.apr);
  const byBalance = [...debts].sort((a, b) => a.balance - b.balance);

  return debts.map((d) => ({
    accountId: d.id,
    name: d.name,
    balance: d.balance,
    apr: d.apr,
    avalancheRank: byApr.findIndex((x) => x.id === d.id) + 1,
    snowballRank: byBalance.findIndex((x) => x.id === d.id) + 1,
  }));
}
