import { App, TFile, normalizePath } from "obsidian";
import { LedgrSettings } from "../settings";
import { readMonthTransactions } from "./reader";
import { loadNetWorth } from "./networth";
import { loadBudgets } from "./budgets";
import { loadGoals } from "./goals";
import { convertToBase } from "./reader";

export interface PillarResult {
  name: string;
  score: number;       // 0 to pillar_max
  max: number;         // pillar_max (renormalized)
  label: string;       // Strong / Moderate / Developing / Insufficient
  hasData: boolean;
  note?: string;
}

export interface BearingResult {
  score: number;               // 0–100, rounded
  grade: string;               // I–VI
  tier: string;                // Distinguished / Established / etc.
  pillars: PillarResult[];
  hasEnoughData: boolean;
}

export interface BearingHistory {
  history: Record<string, number>;  // "YYYY-MM": score
  lastCalculated: string;
}

// ── Tier lookup ───────────────────────────────────────────────────────────────

export function getTier(score: number): { grade: string; tier: string } {
  if (score >= 85) return { grade: "I",   tier: "Distinguished" };
  if (score >= 70) return { grade: "II",  tier: "Established" };
  if (score >= 55) return { grade: "III", tier: "Considered" };
  if (score >= 40) return { grade: "IV",  tier: "Developing" };
  if (score >= 25) return { grade: "V",   tier: "Nascent" };
  return             { grade: "VI",  tier: "Unsettled" };
}

function pillarLabel(score: number, max: number): string {
  const pct = max > 0 ? score / max : 0;
  if (pct >= 0.80) return "Strong";
  if (pct >= 0.50) return "Moderate";
  return "Developing";
}

// ── Math helpers ──────────────────────────────────────────────────────────────

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function populationStdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((sum, v) => sum + (v - m) ** 2, 0) / arr.length);
}

function linearRegressionSlope(arr: number[]): number {
  const n = arr.length;
  if (n < 2) return 0;
  const xs = arr.map((_, i) => i);
  const mx = mean(xs);
  const my = mean(arr);
  const num = xs.reduce((s, x, i) => s + (x - mx) * (arr[i] - my), 0);
  const den = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  return den === 0 ? 0 : num / den;
}

// ── Pillar calculations ───────────────────────────────────────────────────────

function calcDiscipline(
  monthExpenses: Record<string, number>,
  budgetLimits: Record<string, number>,
  budgetCurrency: string,
  base: string,
  rates: LedgrSettings["exchangeRates"],
  pillarMax: number
): PillarResult {
  const name = "Discipline";
  const budgetedCats = Object.keys(budgetLimits);
  if (budgetedCats.length === 0) {
    return { name, score: 0, max: pillarMax, label: "Insufficient", hasData: false, note: "Set budgets to measure discipline." };
  }

  let totalBudgeted = 0;
  let totalOverspend = 0;
  for (const [cat, budgetRaw] of Object.entries(budgetLimits)) {
    const budget = convertToBase(budgetRaw, budgetCurrency, base, rates);
    const actual = monthExpenses[cat] ?? 0;
    totalBudgeted += budget;
    totalOverspend += Math.max(0, actual - budget);
  }

  if (totalBudgeted === 0) {
    return { name, score: 0, max: pillarMax, label: "Insufficient", hasData: false, note: "Set budgets to measure discipline." };
  }

  const ratio = totalOverspend / totalBudgeted;
  const score = pillarMax * Math.max(0, 1 - ratio);
  return { name, score, max: pillarMax, label: pillarLabel(score, pillarMax), hasData: true };
}

function calcBallast(
  liabilityTotal: number,
  assetTotal: number,
  pillarMax: number
): PillarResult {
  const name = "Ballast";
  const ratio = assetTotal > 0 ? liabilityTotal / assetTotal : (liabilityTotal > 0 ? 2.0 : 0);

  let score: number;
  if (ratio <= 0.40) score = pillarMax;
  else if (ratio >= 2.00) score = 0;
  else score = pillarMax * (1 - ((ratio - 0.40) / 1.60));

  score = clamp(score, 0, pillarMax);
  const note = assetTotal === 0 && liabilityTotal > 0
    ? "Add accounts to improve Ballast."
    : "Mortgage and all debt types are weighted equally.";

  return { name, score, max: pillarMax, label: pillarLabel(score, pillarMax), hasData: true, note };
}

function calcProvision(
  goals: { targetAmount: number; linkedAccountId?: string; deadline?: string }[],
  accountBalances: Record<string, number>,
  firstTxDate: string | null,
  today: string,
  pillarMax: number
): PillarResult {
  const name = "Provision";
  if (goals.length === 0) {
    return { name, score: 0, max: pillarMax, label: "Insufficient", hasData: false, note: "Add savings goals to measure Provision." };
  }

  const goalScores = goals.map((g) => {
    const balance = g.linkedAccountId ? (accountBalances[g.linkedAccountId] ?? 0) : 0;
    const rawProgress = g.targetAmount > 0 ? clamp(balance / g.targetAmount, 0, 1) : 0;

    let urgencyWeight = 1.0;
    if (g.deadline && firstTxDate) {
      const start = window.moment(firstTxDate);
      const end = window.moment(g.deadline);
      const now = window.moment(today);
      const total = end.diff(start, "days");
      const elapsed = now.diff(start, "days");
      const timeElapsed = total > 0 ? clamp(elapsed / total, 0, 1) : 1;
      urgencyWeight = 1 + (timeElapsed * 0.5);
    }

    return clamp(rawProgress * urgencyWeight, 0, 1);
  });

  const score = pillarMax * mean(goalScores);
  return { name, score: clamp(score, 0, pillarMax), max: pillarMax, label: pillarLabel(score, pillarMax), hasData: true };
}

function calcComposure(monthlyExpenses: number[], pillarMax: number): PillarResult {
  const name = "Composure";
  if (monthlyExpenses.length < 2) {
    return { name, score: 0, max: pillarMax, label: "Insufficient", hasData: false, note: "Building history — need at least 2 months." };
  }

  const m = mean(monthlyExpenses);
  const floor = Math.max(m, 1);
  const cv = populationStdDev(monthlyExpenses) / floor;

  let score: number;
  if (cv <= 0.12) score = pillarMax;
  else if (cv >= 0.60) score = 0;
  else score = pillarMax * (1 - ((cv - 0.12) / 0.48));

  score = clamp(score, 0, pillarMax);
  return { name, score, max: pillarMax, label: pillarLabel(score, pillarMax), hasData: true };
}

function calcMomentum(netWorthSeries: number[], pillarMax: number): PillarResult {
  const name = "Momentum";
  if (netWorthSeries.length < 2) {
    return { name, score: 0, max: pillarMax, label: "Insufficient", hasData: false, note: "Building history — need at least 2 months." };
  }

  const slope = linearRegressionSlope(netWorthSeries);
  const m = mean(netWorthSeries);
  const denom = Math.max(Math.abs(m), 1);
  const normalizedSlope = slope / denom;

  let score: number;
  if (normalizedSlope >= 0.03) score = pillarMax;
  else if (normalizedSlope <= -0.05) score = 0;
  else score = pillarMax * ((normalizedSlope + 0.05) / 0.08);

  score = clamp(score, 0, pillarMax);
  return { name, score, max: pillarMax, label: pillarLabel(score, pillarMax), hasData: true };
}

function calcReserve(
  liquidAssets: number,
  monthlyExpenses: number[],
  pillarMax: number
): PillarResult {
  const name = "Reserve";
  const recentMonths = monthlyExpenses.filter((e) => e > 0);
  if (recentMonths.length === 0) {
    return { name, score: 0, max: pillarMax, label: "Insufficient", hasData: false, note: "Add expense data to measure Reserve." };
  }

  const avgExpenses = mean(recentMonths.slice(-3));
  if (avgExpenses === 0) {
    return { name, score: 0, max: pillarMax, label: "Insufficient", hasData: false, note: "Add expense data to measure Reserve." };
  }

  const monthsCovered = liquidAssets / avgExpenses;
  const score = pillarMax * clamp(monthsCovered / 3, 0, 1);
  return { name, score, max: pillarMax, label: pillarLabel(score, pillarMax), hasData: true };
}

// ── Main calculator ───────────────────────────────────────────────────────────

export async function calculateBearing(
  app: App,
  settings: LedgrSettings
): Promise<BearingResult> {
  const today = window.moment().format("YYYY-MM-DD");
  const base = settings.baseCurrency;
  const rates = settings.exchangeRates;

  // Load data in parallel
  const [nwData, budgetConfig, goalsStore] = await Promise.all([
    loadNetWorth(app, settings),
    loadBudgets(app, settings),
    loadGoals(app, settings),
  ]);

  // Last 6 months
  const months: string[] = [];
  for (let i = 5; i >= 0; i--) {
    months.push(window.moment(today).subtract(i, "month").format("YYYY-MM"));
  }

  const allMonthTxs = await Promise.all(
    months.map((m) => readMonthTransactions(app, settings, m))
  );

  // Monthly expense totals (base currency)
  const monthlyExpenses = allMonthTxs.map((txs) =>
    txs.filter((t) => t.type === "expense")
       .reduce((s, t) => s + convertToBase(t.amount, t.currency, base, rates), 0)
  );

  // Current month expenses by category
  const currentMonthTxs = allMonthTxs[allMonthTxs.length - 1];
  const expenseByCategory: Record<string, number> = {};
  for (const tx of currentMonthTxs) {
    if (tx.type !== "expense") continue;
    const amt = convertToBase(tx.amount, tx.currency, base, rates);
    expenseByCategory[tx.category] = (expenseByCategory[tx.category] ?? 0) + amt;
  }

  // Net worth per month (approximated from current snapshot — no historical snapshots stored)
  const accounts = nwData.accounts ?? [];
  const brokerages = nwData.brokerages ?? [];
  const totalAssets = [
    ...accounts.filter((a) => !a.isLiability).map((a) => convertToBase(a.balance, a.currency, base, rates)),
    ...brokerages.map((b) => convertToBase(b.value, b.currency, base, rates)),
  ].reduce((s, v) => s + v, 0);
  const totalLiabilities = accounts
    .filter((a) => a.isLiability)
    .reduce((s, a) => s + convertToBase(a.balance, a.currency, base, rates), 0);

  // Liquid assets (bank, ewallet, cash only)
  const liquidTypes = new Set(["bank", "ewallet", "cash"]);
  const liquidAssets = accounts
    .filter((a) => !a.isLiability && liquidTypes.has(a.type))
    .reduce((s, a) => s + convertToBase(a.balance, a.currency, base, rates), 0);

  // Account balances map (for goal linking)
  const accountBalances: Record<string, number> = {};
  for (const acc of accounts) {
    accountBalances[acc.id] = convertToBase(acc.balance, acc.currency, base, rates);
  }

  // First transaction date (for goal urgency)
  const allTxs = allMonthTxs.flat().sort((a, b) => a.date.localeCompare(b.date));
  const firstTxDate = allTxs.length > 0 ? allTxs[0].date : null;

  // Net worth series (use monthly expense/income deltas to approximate trend)
  // We only have current snapshot, so use monthly net savings to build a series
  const nwNow = totalAssets - totalLiabilities;
  const monthlyNetSavings = allMonthTxs.map((txs) => {
    const inc = txs.filter((t) => t.type === "income").reduce((s, t) => s + convertToBase(t.amount, t.currency, base, rates), 0);
    const exp = txs.filter((t) => t.type === "expense").reduce((s, t) => s + convertToBase(t.amount, t.currency, base, rates), 0);
    return inc - exp;
  });
  // Build backwards from current: nw[5] = nwNow, nw[4] = nwNow - savings[5], etc.
  const nwSeries: number[] = [nwNow];
  for (let i = monthlyNetSavings.length - 1; i >= 0; i--) {
    nwSeries.unshift(nwSeries[0] - monthlyNetSavings[i]);
  }
  const nonZeroNwSeries = nwSeries.filter((_, i) => allMonthTxs[i]?.length > 0 || i === nwSeries.length - 1);

  // Calculate pillars (each gets equal share; excluded ones are renormalized)
  const PILLAR_BASE_MAX = 100 / 6;

  const rawPillars: PillarResult[] = [
    calcDiscipline(expenseByCategory, budgetConfig.limits, budgetConfig.currency, base, rates, PILLAR_BASE_MAX),
    calcBallast(totalLiabilities, totalAssets, PILLAR_BASE_MAX),
    calcProvision(goalsStore.goals, accountBalances, firstTxDate, today, PILLAR_BASE_MAX),
    calcComposure(monthlyExpenses.filter((e, i) => allMonthTxs[i].length > 0), PILLAR_BASE_MAX),
    calcMomentum(nonZeroNwSeries.length >= 2 ? nonZeroNwSeries : [], PILLAR_BASE_MAX),
    calcReserve(liquidAssets, monthlyExpenses, PILLAR_BASE_MAX),
  ];

  // Renormalize: only use pillars with data
  const activePillars = rawPillars.filter((p) => p.hasData);
  const hasEnoughData = activePillars.length >= 2;

  let finalScore = 0;
  let pillars = rawPillars;

  if (hasEnoughData) {
    const sumActive = activePillars.reduce((s, p) => s + p.max, 0);
    const factor = sumActive > 0 ? 100 / sumActive : 0;
    finalScore = Math.round(clamp(activePillars.reduce((s, p) => s + p.score, 0) * factor, 0, 100));

    // Rescale displayed maxes so they sum to 100
    pillars = rawPillars.map((p) => ({
      ...p,
      max: p.hasData ? p.max * factor : p.max,
      score: p.hasData ? p.score * factor : 0,
    }));
  }

  const { grade, tier } = getTier(finalScore);
  return { score: finalScore, grade, tier, pillars, hasEnoughData };
}

// ── History persistence ───────────────────────────────────────────────────────

export async function loadBearingHistory(app: App, settings: LedgrSettings): Promise<BearingHistory> {
  const filePath = normalizePath(`${settings.financeFolder}/ledgr-bearing.json`);
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) return { history: {}, lastCalculated: "" };
  try {
    return JSON.parse(await app.vault.read(file)) as BearingHistory;
  } catch {
    return { history: {}, lastCalculated: "" };
  }
}

export async function saveBearingHistory(app: App, settings: LedgrSettings, data: BearingHistory) {
  const filePath = normalizePath(`${settings.financeFolder}/ledgr-bearing.json`);
  const file = app.vault.getAbstractFileByPath(filePath);
  const content = JSON.stringify(data, null, 2);
  if (file instanceof TFile) {
    await app.vault.modify(file, content);
  } else {
    await app.vault.create(filePath, content);
  }
}
