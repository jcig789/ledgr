import { App, TFile, normalizePath } from "obsidian";
import { LedgrSettings } from "../settings";

export const REMITTANCE_SERVICES = ["Wise", "Revolut", "Bank Transfer", "Other"];

/**
 * Represents a single international transfer record.
 *
 * Field naming note: `amountJPY` and `amountPHP` are legacy field names from
 * the original JPY→PHP use case. They map conceptually to `amountFrom` (sent)
 * and `amountTo` (received). Field names are kept as-is to preserve
 * compatibility with existing saved data.
 */
export interface Remittance {
  id: string;
  date: string;
  /** Amount sent in the source currency (amountFrom). */
  amountJPY: number;
  service: string;
  /** Transfer fee in the source currency. */
  feeJPY: number;
  /** Exchange rate at time of transfer (1 source unit = X destination units). */
  rateAtSend: number;
  /** Amount received in the destination currency (amountTo). */
  amountPHP: number;
  note: string;
}

export interface RemittanceStore {
  remittances: Remittance[];
}

const EMPTY: RemittanceStore = { remittances: [] };

export async function loadRemittances(app: App, settings: LedgrSettings): Promise<RemittanceStore> {
  const filePath = normalizePath(`${settings.financeFolder}/remittances.json`);
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) return EMPTY;
  try {
    const data = JSON.parse(await app.vault.read(file)) as RemittanceStore;
    return data;
  } catch {
    return EMPTY;
  }
}

export async function saveRemittances(app: App, settings: LedgrSettings, store: RemittanceStore) {
  const filePath = normalizePath(`${settings.financeFolder}/remittances.json`);
  const file = app.vault.getAbstractFileByPath(filePath);
  const content = JSON.stringify(store, null, 2);
  if (file instanceof TFile) {
    await app.vault.modify(file, content);
  } else {
    await app.vault.create(filePath, content);
  }
}

export function getRemittanceSummary(store: RemittanceStore, month?: string) {
  const all = store.remittances;
  const thisMonth = month
    ? all.filter((r) => r.date.startsWith(month))
    : all;

  const currentYear = new Date().getFullYear().toString();
  const thisYear = all.filter((r) => r.date.startsWith(currentYear));

  return {
    monthTotal: thisMonth.reduce((s, r) => s + r.amountJPY, 0),
    monthPHP: thisMonth.reduce((s, r) => s + r.amountPHP, 0),
    monthFees: thisMonth.reduce((s, r) => s + r.feeJPY, 0),
    yearTotal: thisYear.reduce((s, r) => s + r.amountJPY, 0),
    yearPHP: thisYear.reduce((s, r) => s + r.amountPHP, 0),
    yearFees: thisYear.reduce((s, r) => s + r.feeJPY, 0),
    lifetimePHP: all.reduce((s, r) => s + r.amountPHP, 0),
    lifetimeJPY: all.reduce((s, r) => s + r.amountJPY, 0),
    count: all.length,
    avgRate: all.length > 0
      ? all.reduce((s, r) => s + r.rateAtSend, 0) / all.length
      : 0,
  };
}
