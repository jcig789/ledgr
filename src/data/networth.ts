import { App, TFile, normalizePath } from "obsidian";
import { LedgrSettings } from "../settings";

export type AccountType = "bank" | "ewallet" | "cash" | "credit" | "investment" | "property" | "loan" | "other" | "mortgage" | "car_loan" | "credit_card" | "personal_loan" | "student_loan" | "installment";

export interface LiabilityPayment {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number;
  currency: string;
  note?: string;
  balanceAfter: number;
}

export interface LiabilityDetails {
  originalAmount: number;      // Total loan value at origination
  monthlyPayment: number;      // Fixed monthly payment
  paymentDueDay: number;       // Day of month 1-28
  reminderEnabled: boolean;    // Default true
  reminderDaysAhead: number;   // Default 3
  payments: LiabilityPayment[];
}

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  balance: number;
  country: "JP" | "PH" | "US" | "OTHER";
  isLiability: boolean;
  liabilityDetails?: LiabilityDetails;
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
    const data = JSON.parse(await app.vault.read(file)) as NetWorthData & { holdings?: unknown };
    // Migrate old holdings format
    if (!data.brokerages) data.brokerages = [];
    if (data.holdings) delete data.holdings;
    // Migrate old loan type to personal_loan
    for (const acc of data.accounts ?? []) {
      if ((acc.type as string) === "loan") acc.type = "personal_loan";
    }
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
