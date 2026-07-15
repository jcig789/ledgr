import { App, TFile, normalizePath } from "obsidian";
import { LedgrSettings } from "../settings";

export interface Goal {
  id: string;
  name: string;
  targetAmount: number;
  currency: string;
  deadline?: string; // YYYY-MM-DD, optional
  linkedAccountId?: string; // optional — pin to a specific account balance
}

export interface GoalStore {
  goals: Goal[];
}

const EMPTY: GoalStore = { goals: [] };

export async function loadGoals(app: App, settings: LedgrSettings): Promise<GoalStore> {
  const filePath = normalizePath(`${settings.financeFolder}/goals.json`);
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) return EMPTY;
  try {
    const data = JSON.parse(await app.vault.read(file));
    if (!data.goals) data.goals = [];
    return data;
  } catch {
    return EMPTY;
  }
}

export async function saveGoals(app: App, settings: LedgrSettings, store: GoalStore) {
  const filePath = normalizePath(`${settings.financeFolder}/goals.json`);
  const file = app.vault.getAbstractFileByPath(filePath);
  const content = JSON.stringify(store, null, 2);
  if (file instanceof TFile) {
    await app.vault.modify(file, content);
  } else {
    await app.vault.create(filePath, content);
  }
}
