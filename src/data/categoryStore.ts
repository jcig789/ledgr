import { App, TFile, normalizePath } from "obsidian";
import { LedgrSettings } from "../settings";
import { CATEGORIES, INCOME_CATEGORIES } from "../constants/categories";

export interface CategoryStore {
  expense: Record<string, string[]>;
  income: Record<string, string[]>;
}

const DEFAULTS: CategoryStore = {
  expense: CATEGORIES,
  income: INCOME_CATEGORIES,
};

export async function loadCategories(app: App, settings: LedgrSettings): Promise<CategoryStore> {
  const filePath = normalizePath(`${settings.financeFolder}/categories.json`);
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) return structuredClone(DEFAULTS);
  try {
    const data = JSON.parse(await app.vault.read(file));
    // Ensure both keys exist
    if (!data.expense) data.expense = structuredClone(DEFAULTS.expense);
    if (!data.income) data.income = structuredClone(DEFAULTS.income);
    return data;
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export async function saveCategories(app: App, settings: LedgrSettings, store: CategoryStore) {
  const filePath = normalizePath(`${settings.financeFolder}/categories.json`);
  const file = app.vault.getAbstractFileByPath(filePath);
  const content = JSON.stringify(store, null, 2);
  if (file instanceof TFile) {
    await app.vault.modify(file, content);
  } else {
    await app.vault.create(filePath, content);
  }
}
