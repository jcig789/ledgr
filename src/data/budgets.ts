import { App, TFile, normalizePath } from "obsidian";
import { LedgrSettings } from "../settings";

// Budget amounts are always stored in the base currency at time of save
export interface BudgetConfig {
  currency: string;
  limits: Record<string, number>;
}

const EMPTY: BudgetConfig = { currency: "", limits: {} };

export async function loadBudgets(app: App, settings: LedgrSettings): Promise<BudgetConfig> {
  const filePath = normalizePath(`${settings.financeFolder}/budgets.json`);
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) return { ...EMPTY, currency: settings.baseCurrency };
  try {
    const data = JSON.parse(await app.vault.read(file)) as BudgetConfig;
    // Migrate old flat format: { "Food & Drink": 30000 } → new format
    if (!data.limits) {
      return { currency: settings.baseCurrency, limits: data as unknown as Record<string, number> };
    }
    return data;
  } catch {
    return { ...EMPTY, currency: settings.baseCurrency };
  }
}

export async function saveBudgets(app: App, settings: LedgrSettings, budgets: BudgetConfig) {
  const filePath = normalizePath(`${settings.financeFolder}/budgets.json`);
  const file = app.vault.getAbstractFileByPath(filePath);
  const content = JSON.stringify(budgets, null, 2);
  if (file instanceof TFile) {
    await app.vault.modify(file, content);
  } else {
    await app.vault.create(filePath, content);
  }
}
