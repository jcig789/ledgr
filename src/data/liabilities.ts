import { Account } from "./networth";
import { resolveNthWeekday } from "./bills";

export const LIABILITY_TYPES = [
  { key: "mortgage",      label: "Mortgage" },
  { key: "car_loan",      label: "Car Loan" },
  { key: "credit_card",   label: "Credit Card" },
  { key: "personal_loan", label: "Personal Loan" },
  { key: "student_loan",  label: "Student Loan" },
  { key: "installment",   label: "Installment / BNPL" },
  { key: "other",         label: "Other" },
];

// Resolve the actual calendar day a liability payment is due for a given month.
export function resolveLiabilityDueDay(account: Account, month: string): number | null {
  const ld = account.liabilityDetails;
  if (!ld) return null;
  const daysInMonth = window.moment(month).daysInMonth();

  if (!ld.dueDateType || ld.dueDateType === "day_of_month") {
    if (!ld.paymentDueDay) return null;
    return Math.min(ld.paymentDueDay, daysInMonth);
  }
  if (ld.dueDateType === "nth_weekday") {
    if (ld.dueWeekOrdinal === undefined || ld.dueWeekday === undefined) return null;
    return resolveNthWeekday(month, ld.dueWeekOrdinal, ld.dueWeekday);
  }
  return null;
}

export function getDueThisMonth(account: Account, today: string): boolean {
  if (!account.isLiability || !account.liabilityDetails) return false;
  const d = account.liabilityDetails;
  if (!d.reminderEnabled) return false;
  // Skip zero-balance open accounts (not archived) — prevents stale reminders
  if (account.balance <= 0 && !d.closedAt) return false;
  const month = window.moment(today).format("YYYY-MM");
  const dueDay = resolveLiabilityDueDay(account, month);
  if (dueDay === null) return false;
  const m = window.moment(today);
  const dueDate = m.clone().date(dueDay);
  const daysUntilDue = dueDate.diff(m, "days");
  return daysUntilDue <= d.reminderDaysAhead;
}

export function isPaymentAlreadyLogged(account: Account, month: string): boolean {
  const payments = account.liabilityDetails?.payments ?? [];
  return payments.some((p) => p.date.startsWith(month));
}

export function getUpcomingPayments(accounts: Account[], today: string, month: string): Account[] {
  return accounts.filter(
    (a) => a.isLiability
      && !a.liabilityDetails?.closedAt
      && getDueThisMonth(a, today)
      && !isPaymentAlreadyLogged(a, month)
  );
}

export function getDaysUntilDue(account: Account, today: string): number {
  const month = window.moment(today).format("YYYY-MM");
  const dueDay = resolveLiabilityDueDay(account, month);
  if (dueDay === null) return 999;
  const m = window.moment(today);
  const dueDate = m.clone().date(dueDay);
  return dueDate.diff(m, "days");
}

// Human-readable label for a due date spec
export function formatDueLabel(account: Account, month: string): string {
  const ld = account.liabilityDetails;
  if (!ld) return "—";
  if (ld.dueDateType === "nth_weekday" && ld.dueWeekOrdinal !== undefined && ld.dueWeekday !== undefined) {
    const ordinalLabels: Record<number, string> = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th", [-1]: "Last" };
    const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return `${ordinalLabels[ld.dueWeekOrdinal] ?? ""} ${weekdayLabels[ld.dueWeekday] ?? ""}`;
  }
  const dueDay = resolveLiabilityDueDay(account, month);
  if (dueDay === null) return "—";
  return window.moment(month + "-" + String(dueDay).padStart(2, "0")).format("MMM D");
}
