import { App, TFile, normalizePath } from "obsidian";
import { LedgrSettings } from "../settings";
import { Transaction } from "./transactions";
import { FIXED_SUBCATEGORIES } from "../constants/categories";

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
    return {
      date: cols[0],
      type: cols[1] as Transaction["type"],
      amount: parseFloat(cols[2]),
      currency: cols[3],
      category: cols[4],
      subcategory: cols[5],
      note: cols[6] === "-" ? "" : cols[6],
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
  return results.flat().sort((a, b) => a.date.localeCompare(b.date));
}

export function convertToBase(
  amount: number,
  fromCurrency: string,
  baseCurrency: string,
  rates: LedgrSettings["exchangeRates"]
): number {
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

  return amount; // fallback: no conversion
}

export interface MonthlySummary {
  month: string;
  totalIncome: number;
  totalExpenses: number;
  totalOpex: number;
  totalCapex: number;
  totalRemittances: number;
  savingsRate: number;
  net: number;
  byCategory: Record<string, number>;
  byCategoryType: { opex: Record<string, number>; capex: Record<string, number> };
  transactions: Transaction[];
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
  const byCategory: Record<string, number> = {};
  const opexByCategory: Record<string, number> = {};
  const capexByCategory: Record<string, number> = {};

  for (const tx of transactions) {
    const amt = convertToBase(tx.amount, tx.currency, baseCurrency, rates);
    if (tx.type === "income") {
      totalIncome += amt;
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
    }
  }

  const savingsRate = totalIncome > 0
    ? Math.round(((totalIncome - totalExpenses) / totalIncome) * 100)
    : 0;

  return {
    totalIncome,
    totalExpenses,
    totalOpex,
    totalCapex,
    totalRemittances,
    savingsRate,
    net: totalIncome - totalExpenses,
    byCategory,
    byCategoryType: { opex: opexByCategory, capex: capexByCategory },
    transactions,
  };
}
