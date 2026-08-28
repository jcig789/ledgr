import { App, TFile, normalizePath } from "obsidian";
import { LedgrSettings } from "../settings";
import { Transaction, CashFlowStream } from "./transactions";
import { FIXED_SUBCATEGORIES, getDefaultStream } from "../constants/categories";

export async function readMonthTransactions(
  app: App,
  settings: LedgrSettings,
  month: string
): Promise<Transaction[]> {
  const filePath = normalizePath(`${settings.financeFolder}/transactions/${month}.md`);
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) return [];

  const content = await app.vault.read(file);
  const lines = content.split("\n").filter((l) => l.startsWith("| 20"));

  return lines.map((line) => {
    const cols = line.split("|").map((c) => c.trim()).filter(Boolean);
    const subcategory = cols[5];
    const rawStream = cols[7] as string | undefined;
    const stream: CashFlowStream = (rawStream === "ocf" || rawStream === "icf" || rawStream === "fcf")
      ? rawStream
      : getDefaultStream(subcategory);
    return {
      date: cols[0] ?? "",
      type: cols[1] === "income" ? "income" : "expense",
      amount: parseFloat(cols[2]) || 0,  // guard NaN — malformed rows default to 0
      currency: cols[3] ?? "USD",
      category: cols[4] ?? "Other",
      subcategory,
      note: cols[6] === "-" ? "" : (cols[6] ?? ""),
      stream,
    };
  });
}

export async function readAllTransactions(
  app: App,
  settings: LedgrSettings,
  year?: string
): Promise<Transaction[]> {
  const folder = normalizePath(`${settings.financeFolder}/transactions`);
  const folderObj = app.vault.getAbstractFileByPath(folder);
  if (!folderObj) return [];

  const files = app.vault.getFiles().filter((f) =>
    f.path.startsWith(folder) &&
    f.extension === "md" &&
    (!year || f.name.startsWith(year))
  );

  const results: Transaction[][] = await Promise.all(
    files.map((file) => readMonthTransactions(app, settings, file.name.replace(".md", "")))
  );
  const flat: Transaction[] = ([] as Transaction[]).concat(...results);
  return flat.sort((a, b) => a.date.localeCompare(b.date));
}

export function convertToBase(
  amount: number,
  fromCurrency: string,
  baseCurrency: string,
  rates: LedgrSettings["exchangeRates"]
): number | null {
  if (fromCurrency === baseCurrency) return amount;

  // Try direct rate: base_from
  const directKey = `${baseCurrency}_${fromCurrency}`;
  const directRate = rates.rates[directKey];
  if (directRate && directRate > 0) return amount / directRate;

  // Try inverse: from_base
  const inverseKey = `${fromCurrency}_${baseCurrency}`;
  const inverseRate = rates.rates[inverseKey];
  if (inverseRate && inverseRate > 0) return amount * inverseRate;

  // Try via JPY as bridge (legacy support)
  const fromToJPY = rates.rates[`JPY_${fromCurrency}`];
  const jpyToBase = rates.rates[`JPY_${baseCurrency}`];
  if (fromToJPY && jpyToBase && fromToJPY > 0) {
    const inJPY = amount / fromToJPY;
    return inJPY * jpyToBase;
  }

  // If base is JPY
  if (baseCurrency === "JPY") {
    const key = `JPY_${fromCurrency}`;
    const r = rates.rates[key];
    if (r && r > 0) return amount / r;
  }
  if (fromCurrency === "JPY") {
    const key = `JPY_${baseCurrency}`;
    const r = rates.rates[key];
    if (r && r > 0) return amount * r;
  }

  return null; // no conversion path found — callers must handle null explicitly
}

// Convenience wrapper — returns 0 for unknown currencies (display/scoring use)
// Use convertToBase() directly when null needs to propagate (e.g. summarize, history writes)
export function toBaseOrZero(
  amount: number,
  fromCurrency: string,
  baseCurrency: string,
  rates: LedgrSettings["exchangeRates"]
): number {
  const v = convertToBase(amount, fromCurrency, baseCurrency, rates);
  return v ?? 0;
}

export interface MonthlySummary {
  month: string;
  totalIncome: number;
  totalExpenses: number;
  totalOpex: number;
  totalCapex: number;
  totalRemittances: number;
  savingsRate: number;
  savingsRateBasis: "ocf" | "total" | "na";
  savingsRateIsOCFBasis: boolean;   // derived: savingsRateBasis === "ocf"
  savingsRateIsDeficit: boolean;    // true when expenses exceed income (rate clamped to 0)
  net: number;
  byCategory: Record<string, number>;
  ocfByCategory: Record<string, number>;  // OCF expenses only — excludes debt service (FCF) and investments (ICF)
  byCategoryType: { opex: Record<string, number>; capex: Record<string, number> };
  transactions: Transaction[];
  // Cash flow stream totals
  ocfIncome: number;
  ocfExpenses: number;
  netOCF: number;
  netICF: number;
  netFinancingCF: number;  // Net Financing Cash Flow (renamed from netFinancingCF to avoid FCF ambiguity)
  freeCashFlow: number;    // = netOCF + netICF + netFinancingCF = Net Change in Cash
  missingCurrencies: string[];  // currencies with no exchange rate — transactions excluded from totals
}

export function summarize(
  transactions: Transaction[],
  baseCurrency: string,
  rates: LedgrSettings["exchangeRates"]
): Omit<MonthlySummary, "month"> {
  let totalIncome = 0;
  let totalExpenses = 0;
  let totalOpex = 0;
  let totalCapex = 0;
  let totalRemittances = 0;
  let ocfIncome = 0;
  let ocfExpenses = 0;
  let netICF = 0;
  let netFinancingCF = 0;
  const byCategory: Record<string, number> = {};
  const ocfByCategory: Record<string, number> = {};
  const opexByCategory: Record<string, number> = {};
  const capexByCategory: Record<string, number> = {};
  const missingCurrencySet = new Set<string>();

  for (const tx of transactions) {
    const amt = convertToBase(tx.amount, tx.currency, baseCurrency, rates);
    if (amt === null) {
      // No conversion path — exclude from all aggregates rather than silently distort totals
      missingCurrencySet.add(tx.currency);
      continue;
    }
    const stream = tx.stream ?? getDefaultStream(tx.subcategory);

    if (tx.type === "income") {
      totalIncome += amt;
      if (stream === "ocf") ocfIncome += amt;
      else if (stream === "icf") netICF += amt;       // e.g. dividends, asset sale proceeds
      else if (stream === "fcf") netFinancingCF += amt; // e.g. loan disbursements
    } else if (tx.type === "expense") {
      totalExpenses += amt;
      byCategory[tx.category] = (byCategory[tx.category] ?? 0) + amt;

      const isFixed = FIXED_SUBCATEGORIES.has(tx.subcategory);
      if (isFixed) {
        totalOpex += amt;
        opexByCategory[tx.category] = (opexByCategory[tx.category] ?? 0) + amt;
      } else {
        totalCapex += amt;
        capexByCategory[tx.category] = (capexByCategory[tx.category] ?? 0) + amt;
      }

      if (tx.category === "Family" && tx.subcategory === "Remittance") {
        totalRemittances += amt;
      }

      // Stream totals
      if (stream === "ocf") {
        ocfExpenses += amt;
        ocfByCategory[tx.category] = (ocfByCategory[tx.category] ?? 0) + amt;
      } else if (stream === "icf") {
        netICF -= amt;
      } else if (stream === "fcf") {
        netFinancingCF -= amt;
      }
    }
  }

  // Three-state savings rate basis:
  // "ocf"   — OCF income present: (ocfIncome - ocfExpenses) / ocfIncome
  // "total" — Only ICF income (dividends, passive): (totalIncome - totalExpenses) / totalIncome
  // "na"    — Only FCF income (loan disbursement) or no income: do not show a %
  const hasFCFIncome = netFinancingCF > 0; // netFinancingCF is positive when FCF income > FCF expense
  const savingsRateBasis: "ocf" | "total" | "na" =
    ocfIncome > 0 ? "ocf"
    : hasFCFIncome ? "na"          // loan proceeds — not earned income, never use as denominator
    : totalIncome > 0 ? "total"    // passive/dividend income — defensible fallback
    : "na";                        // no income at all

  const savingsRateIsOCFBasis = savingsRateBasis === "ocf"; // backward-compat
  let savingsRate = 0;
  let savingsRateIsDeficit = false; // true when raw rate is negative (clamped to 0 for display)
  if (savingsRateBasis === "ocf") {
    const raw = Math.round(((ocfIncome - ocfExpenses) / ocfIncome) * 100);
    savingsRateIsDeficit = raw < 0;
    savingsRate = Math.max(0, raw);
  } else if (savingsRateBasis === "total" && totalIncome > 0) {
    const raw = Math.round(((totalIncome - totalExpenses) / totalIncome) * 100);
    savingsRateIsDeficit = raw < 0;
    savingsRate = Math.max(0, raw);
  }

  const netOCF = ocfIncome - ocfExpenses;
  const freeCashFlow = netOCF + netICF + netFinancingCF;

  return {
    totalIncome,
    totalExpenses,
    totalOpex,
    totalCapex,
    totalRemittances,
    savingsRate,
    savingsRateBasis,
    savingsRateIsOCFBasis,
    savingsRateIsDeficit,
    net: totalIncome - totalExpenses,
    byCategory,
    ocfByCategory,
    missingCurrencies: Array.from(missingCurrencySet),
    byCategoryType: { opex: opexByCategory, capex: capexByCategory },
    transactions,
    ocfIncome,
    ocfExpenses,
    netOCF,
    netICF,
    netFinancingCF,
    freeCashFlow,
  };
}
