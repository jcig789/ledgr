import { App, TFile, normalizePath } from "obsidian";
import { LedgrSettings } from "../settings";

export type AmountType = "fixed" | "variable" | "estimated";

export type DueDateType = "day_of_month" | "nth_weekday";

export type BillFrequency = "monthly" | "annual" | "once";

export interface BillPayment {
  id: string;
  date: string;       // YYYY-MM-DD
  amount: number;
  currency: string;
  note?: string;
}

export interface RecurringBill {
  id: string;
  name: string;
  amount: number;           // 0 when variable
  amountType: AmountType;   // "fixed" | "variable" | "estimated"
  amountMax?: number;       // for estimated range display (e.g. 2600–3000)
  currency: string;
  category: string;
  subcategory: string;
  frequency?: BillFrequency; // "monthly" (default) | "annual" | "once"
  dueDateType: DueDateType;
  dueDay?: number;          // 1–31, used when dueDateType === "day_of_month"
  dueMonth?: number;        // 1–12, used for annual bills (month of year)
  dueWeekOrdinal?: number;  // 1=first, 2=second, 3=third, 4=fourth, -1=last
  dueWeekday?: number;      // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  reminderEnabled: boolean;
  reminderDaysAhead: number;
  payments: BillPayment[];
  closedAt?: string;        // YYYY-MM-DD if archived
}

export interface BillStore {
  bills: RecurringBill[];
}

const EMPTY: BillStore = { bills: [] };

export async function loadBills(app: App, settings: LedgrSettings): Promise<BillStore> {
  const filePath = normalizePath(`${settings.financeFolder}/ledgr-bills.json`);
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) return EMPTY;
  try {
    const data = JSON.parse(await app.vault.read(file)) as BillStore;
    if (!data.bills) data.bills = [];
    // Migrate: ensure all bills have payments array
    for (const bill of data.bills) {
      if (!bill.payments) bill.payments = [];
      if (!bill.dueDateType) bill.dueDateType = "day_of_month";
      if (!bill.amountType) bill.amountType = bill.amount > 0 ? "fixed" : "variable";
    }
    return data;
  } catch {
    return EMPTY;
  }
}

export async function saveBills(app: App, settings: LedgrSettings, data: BillStore): Promise<void> {
  const filePath = normalizePath(`${settings.financeFolder}/ledgr-bills.json`);
  const file = app.vault.getAbstractFileByPath(filePath);
  const content = JSON.stringify(data, null, 2);
  if (file instanceof TFile) {
    await app.vault.modify(file, content);
  } else {
    await app.vault.create(filePath, content);
  }
}

// Resolve the actual calendar day a bill is due for a given month.
// Returns null if the bill has no due date configured.
export function resolveBillDueDay(bill: RecurringBill | { dueDateType: DueDateType; dueDay?: number; dueWeekOrdinal?: number; dueWeekday?: number }, month: string): number | null {
  if (bill.dueDateType === "day_of_month") {
    if (!bill.dueDay) return null;
    const daysInMonth = window.moment(month).daysInMonth();
    return Math.min(bill.dueDay, daysInMonth);
  }
  if (bill.dueDateType === "nth_weekday") {
    if (bill.dueWeekOrdinal === undefined || bill.dueWeekday === undefined) return null;
    return resolveNthWeekday(month, bill.dueWeekOrdinal, bill.dueWeekday);
  }
  return null;
}

// Returns the calendar day of the Nth weekday in a given month.
// ordinal: 1=first, 2=second, 3=third, 4=fourth, -1=last
// weekday: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
export function resolveNthWeekday(month: string, ordinal: number, weekday: number): number | null {
  const m = window.moment(month + "-01");
  const daysInMonth = m.daysInMonth();

  if (ordinal === -1) {
    // Last occurrence — search backwards from end of month
    for (let d = daysInMonth; d >= 1; d--) {
      if (window.moment(month + "-" + String(d).padStart(2, "0")).day() === weekday) {
        return d;
      }
    }
    return null;
  }

  let count = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    if (window.moment(month + "-" + String(d).padStart(2, "0")).day() === weekday) {
      count++;
      if (count === ordinal) return d;
    }
  }
  return null;
}

export function isBillPaymentLogged(bill: RecurringBill, month: string): boolean {
  return bill.payments.some((p) => p.date.startsWith(month));
}

// Returns true if a bill is active in the given month based on frequency
export function isBillActiveThisMonth(bill: RecurringBill, month: string): boolean {
  const freq = bill.frequency ?? "monthly";
  if (freq === "monthly") return true;
  if (freq === "once") {
    // One-time: active only in the month matching the first payment or due month
    if (bill.payments.length > 0) {
      const firstPayment = bill.payments[0].date.slice(0, 7);
      return firstPayment === month;
    }
    return true; // unpaid once-bill is always surfaced
  }
  if (freq === "annual") {
    const dueMonth = bill.dueMonth ?? 1;
    const viewMonth = parseInt(month.split("-")[1]);
    return viewMonth === dueMonth;
  }
  return true;
}

export function getBillsDueThisMonth(bills: RecurringBill[], today: string, month: string): RecurringBill[] {
  return bills.filter((bill) => {
    if (bill.closedAt) return false;
    if (!bill.reminderEnabled) return false;
    if (!isBillActiveThisMonth(bill, month)) return false;
    const dueDay = resolveBillDueDay(bill, month);
    if (dueDay === null) return false;
    const m = window.moment(today);
    const dueDate = window.moment(month + "-" + String(dueDay).padStart(2, "0"));
    const daysUntilDue = dueDate.diff(m, "days");
    return daysUntilDue <= bill.reminderDaysAhead;
  });
}

export function getDaysUntilBillDue(bill: RecurringBill, today: string, month: string): number {
  const dueDay = resolveBillDueDay(bill, month);
  if (dueDay === null) return 999;
  const m = window.moment(today);
  const dueDate = window.moment(month + "-" + String(dueDay).padStart(2, "0"));
  return dueDate.diff(m, "days");
}
