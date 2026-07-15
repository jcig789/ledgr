import { App, TFile, normalizePath } from "obsidian";
import { LedgrSettings } from "../settings";

export type AccountType = "bank" | "ewallet" | "cash" | "credit" | "investment" | "property" | "loan" | "other";

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  balance: number;
  country: "JP" | "PH" | "US" | "OTHER";
  isLiability: boolean;
}

export interface Brokerage {
  id: string;
  name: string;
  currency: string;
  value: number;
  country: "JP" | "PH" | "US" | "OTHER";
}

export interface NetWorthData {
  accounts: Account[];
  brokerages: Brokerage[];
  updatedAt: string;
}

const EMPTY: NetWorthData = { accounts: [], brokerages: [], updatedAt: "" };

export async function loadNetWorth(app: App, settings: LedgrSettings): Promise<NetWorthData> {
  const filePath = normalizePath(`${settings.financeFolder}/networth.json`);
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) return EMPTY;
  try {
    const data = JSON.parse(await app.vault.read(file));
    // Migrate old holdings format
    if (!data.brokerages) data.brokerages = [];
    if (data.holdings) delete data.holdings;
    return data;
  } catch {
    return EMPTY;
  }
}

export async function saveNetWorth(app: App, settings: LedgrSettings, data: NetWorthData) {
  const filePath = normalizePath(`${settings.financeFolder}/networth.json`);
  const file = app.vault.getAbstractFileByPath(filePath);
  const content = JSON.stringify(data, null, 2);
  if (file instanceof TFile) {
    await app.vault.modify(file, content);
  } else {
    await app.vault.create(filePath, content);
  }
}
