import { Account } from "./networth";

export const LIABILITY_TYPES = [
  { key: "mortgage",      label: "Mortgage" },
  { key: "car_loan",      label: "Car Loan" },
  { key: "credit_card",   label: "Credit Card" },
  { key: "personal_loan", label: "Personal Loan" },
  { key: "student_loan",  label: "Student Loan" },
  { key: "installment",   label: "Installment / BNPL" },
  { key: "other",         label: "Other" },
];

export function getDueThisMonth(account: Account, today: string): boolean {
  if (!account.isLiability || !account.liabilityDetails) return false;
  const d = account.liabilityDetails;
  if (!d.reminderEnabled || d.monthlyPayment <= 0) return false;
  const m = window.moment(today);
  const dueDay = Math.min(d.paymentDueDay, m.daysInMonth());
  const dueDate = m.clone().date(dueDay);
  const daysUntilDue = dueDate.diff(m, "days");
  // Include past-due (negative) through upcoming (within reminderDaysAhead)
  return daysUntilDue <= d.reminderDaysAhead;
}

export function isPaymentAlreadyLogged(account: Account, month: string): boolean {
  const payments = account.liabilityDetails?.payments ?? [];
  return payments.some((p) => p.date.startsWith(month));
}

export function getUpcomingPayments(accounts: Account[], today: string, month: string): Account[] {
  return accounts.filter(
    (a) => a.isLiability && getDueThisMonth(a, today) && !isPaymentAlreadyLogged(a, month)
  );
}

export function getDaysUntilDue(account: Account, today: string): number {
  if (!account.liabilityDetails) return 999;
  const m = window.moment(today);
  const dueDay = Math.min(account.liabilityDetails.paymentDueDay, m.daysInMonth());
  return m.clone().date(dueDay).diff(m, "days");
}
