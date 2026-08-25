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

export type LiabilityAmountType = "fixed" | "variable" | "estimated";
export type LiabilityDueDateType = "day_of_month" | "nth_weekday";

export interface LiabilityDetails {
  originalAmount: number;              // Total loan value at origination
  monthlyPayment: number;              // Fixed monthly payment (0 when variable)
  amountType?: LiabilityAmountType;    // "fixed" (default) | "variable" | "estimated"
  amountMax?: number;                  // Upper bound for estimated range display
  paymentDueDay: number;               // Day of month 1–31
  dueDateType?: LiabilityDueDateType;  // "day_of_month" (default) | "nth_weekday"
  dueWeekOrdinal?: number;             // 1–4 or -1 (last), used when nth_weekday
  dueWeekday?: number;                 // 0=Sun … 6=Sat, used when nth_weekday
  reminderEnabled: boolean;            // Default true
  reminderDaysAhead: number;           // Default 3
  payments: LiabilityPayment[];
  apr?: number;                        // Annual percentage rate e.g. 15.9 for 15.9%
  closedAt?: string;                   // YYYY-MM-DD — set when balance reaches 0 and archived
}

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  balance: number;
  country: string;  // ISO 3166-1 alpha-2 or "OTHER" — widened from union to support all currencies
  isLiability: boolean;
  liabilityDetails?: LiabilityDetails;
  linkedAssetId?: string;      // liability → points to property asset account id
  linkedLiabilityId?: string;  // asset → points to mortgage/loan account id
}

export interface Brokerage {
  id: string;
  name: string;
  currency: string;
  value: number;
  country: string;  // ISO 3166-1 alpha-2 or "OTHER"
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
      // Migrate legacy records missing the payments array — prevents TypeError on push()
      if (acc.liabilityDetails && !acc.liabilityDetails.payments) {
        acc.liabilityDetails.payments = [];
      }
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
