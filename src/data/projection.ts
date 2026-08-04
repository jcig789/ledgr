// Cash flow projection engine — pure functions, no side effects
// Methodology: structural baseline (exact) + behavioral overlay (3-month trimmed mean)

export interface MonthlyOcfHistory {
  month: string;
  income: number;
  expenses: number;
}

export interface ScenarioItem {
  id: string;
  label: string;
  monthlyDelta: number;    // positive = income/gain, negative = expense/cost
  startMonth: string;      // "YYYY-MM"
  endMonth?: string;       // undefined = ongoing through projection horizon
}

export interface ProjectionInput {
  monthlyOcfHistory: MonthlyOcfHistory[];
  fixedCommitments: number;        // sum of recurring templates + liability payments/mo
  currentLiquidBalance: number;
  reserveFloorMonths: number;      // default 3 (months of avg expenses)
  ocfCommitment?: number;          // user's monthly OCF commitment target
  scenarios: ScenarioItem[];
  liabilityPayoffEvents?: LiabilityPayoffEvent[];  // months when liabilities pay off
}

export interface ProjectedMonth {
  month: string;
  projectedNet: number;
  projectedBalance: number;
  confidenceLow: number;
  confidenceHigh: number;
  scenariosActive: string[];
  belowReserveFloor: boolean;
  belowCommitmentFloor: boolean;
}

export interface LiabilityPayoffEvent {
  month: string;
  label: string;
  freedCash: number;
}

export interface ProjectionResult {
  months: ProjectedMonth[];
  commitmentFloor: number;
  reserveFloor: number;
  runwayMonth: string | null;
  runwayConditions: { met: boolean; label: string }[];
  dataQuality: "insufficient" | "thin" | "building" | "full";
  baselineMonthlyNet: number;
  avgMonthlyIncome: number;
  avgMonthlyExpenses: number;
  payoffEvents: LiabilityPayoffEvent[];
}

// ── Math helpers ──────────────────────────────────────────────────────────────

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function trimmedMean(arr: number[]): number {
  // Only trim when 4+ data points — at 3 months dropping one is 33% data loss
  if (arr.length < 4) return mean(arr);
  const sorted = [...arr].sort((a, b) => a - b);
  return mean(sorted.slice(0, -1));
}

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}

// ── Main projection function ──────────────────────────────────────────────────

export function buildProjection(
  input: ProjectionInput,
  horizonMonths: 3 | 6 | 12
): ProjectionResult {
  const { monthlyOcfHistory, fixedCommitments, currentLiquidBalance,
          reserveFloorMonths, ocfCommitment, scenarios } = input;

  // Data quality assessment
  const dataQuality: ProjectionResult["dataQuality"] =
    monthlyOcfHistory.length < 2 ? "insufficient" :
    monthlyOcfHistory.length < 3 ? "thin" :
    monthlyOcfHistory.length < 6 ? "building" : "full";

  if (dataQuality === "insufficient") {
    return {
      months: [], commitmentFloor: fixedCommitments,
      reserveFloor: 0, runwayMonth: null, runwayConditions: [],
      dataQuality, baselineMonthlyNet: 0, avgMonthlyIncome: 0, avgMonthlyExpenses: 0,
      payoffEvents: [],
    };
  }

  // Use last 3 months (or all available if < 3)
  const recent = [...monthlyOcfHistory].sort((a, b) => b.month.localeCompare(a.month)).slice(0, 3);
  const incomeValues = recent.map((m) => m.income);
  const expenseValues = recent.map((m) => m.expenses);

  const avgIncome = trimmedMean(incomeValues);
  const avgExpenses = trimmedMean(expenseValues);
  const incomeSD = stdDev(incomeValues);
  const expenseSD = stdDev(expenseValues);

  const baselineNet = avgIncome - avgExpenses;
  const reserveFloor = avgExpenses * reserveFloorMonths;
  const commitmentFloor = ocfCommitment ?? fixedCommitments;

  // Build projected months
  const currentMonth = recent[0].month;
  const projectedMonths: ProjectedMonth[] = [];
  let runningBalance = currentLiquidBalance;
  let runwayMonth: string | null = null;

  // Track cumulative freed cash from liability payoffs
  const payoffEventsByMonth = new Map<string, LiabilityPayoffEvent[]>();
  for (const evt of (input.liabilityPayoffEvents ?? [])) {
    if (!payoffEventsByMonth.has(evt.month)) payoffEventsByMonth.set(evt.month, []);
    payoffEventsByMonth.get(evt.month)!.push(evt);
  }
  let cumulativeFreedCash = 0;

  for (let i = 1; i <= horizonMonths; i++) {
    const month = window.moment(currentMonth).add(i, "months").format("YYYY-MM");

    // Add freed cash from liabilities that pay off this month
    const payoffsThisMonth = payoffEventsByMonth.get(month) ?? [];
    cumulativeFreedCash += payoffsThisMonth.reduce((s, e) => s + e.freedCash, 0);

    // Scenario deltas for this month
    const activeScenarios = scenarios.filter((s) => {
      if (s.startMonth > month) return false;
      if (s.endMonth && s.endMonth < month) return false;
      return true;
    });
    const scenarioDelta = activeScenarios.reduce((sum, s) => sum + s.monthlyDelta, 0);

    // Confidence band widens by 8% per month (compounding uncertainty)
    const uncertaintyFactor = 1 + (i - 1) * 0.08;
    const confidenceSpread = Math.sqrt(incomeSD ** 2 + expenseSD ** 2) * uncertaintyFactor;

    // Freed cash from payoffs increases projected net from that month forward
    const projectedNet = baselineNet + scenarioDelta + cumulativeFreedCash;
    const confidenceLow = projectedNet - confidenceSpread;
    const confidenceHigh = projectedNet + confidenceSpread;

    runningBalance += projectedNet;

    const belowReserveFloor = runningBalance < reserveFloor;
    const belowCommitmentFloor = projectedNet < commitmentFloor;

    projectedMonths.push({
      month,
      projectedNet,
      projectedBalance: runningBalance,
      confidenceLow,
      confidenceHigh,
      scenariosActive: activeScenarios.map((s) => s.id),
      belowReserveFloor,
      belowCommitmentFloor,
    });
  }

  // Runway to Commit — find earliest month where all 3 conditions hold simultaneously
  const runwayConditions: ProjectionResult["runwayConditions"] = [];
  if (scenarios.length > 0) {
    const scenarioMonthlyExpense = Math.abs(
      scenarios.reduce((s, sc) => s + Math.min(0, sc.monthlyDelta), 0)
    );
    const totalCommitments = fixedCommitments + scenarioMonthlyExpense;
    const c3 = avgIncome > 0 ? totalCommitments / avgIncome <= 0.40 : true;

    for (const pm of projectedMonths) {
      const c1 = pm.projectedBalance >= reserveFloor;
      const c2 = pm.projectedNet >= 0;
      if (c1 && c2 && c3 && runwayMonth === null) {
        runwayMonth = pm.month;
        // Capture conditions at the runway month — not at the last month (B4 fix)
        runwayConditions.push(
          { met: c1, label: "Reserve floor maintained (3 months)" },
          { met: c2, label: "Monthly OCF positive after commitment" },
          { met: c3, label: "Commitment ratio within 40% of income" },
        );
      }
    }

    // If no runway found, show conditions at first month to explain why
    if (!runwayMonth && projectedMonths.length > 0) {
      const first = projectedMonths[0];
      runwayConditions.push(
        { met: first.projectedBalance >= reserveFloor, label: "Reserve floor maintained (3 months)" },
        { met: first.projectedNet >= 0, label: "Monthly OCF positive after commitment" },
        { met: c3, label: "Commitment ratio within 40% of income" },
      );
    }
  }

  return {
    months: projectedMonths,
    commitmentFloor,
    reserveFloor,
    runwayMonth,
    runwayConditions,
    dataQuality,
    baselineMonthlyNet: baselineNet,
    avgMonthlyIncome: avgIncome,
    avgMonthlyExpenses: avgExpenses,
    payoffEvents: input.liabilityPayoffEvents ?? [],
  };
}
