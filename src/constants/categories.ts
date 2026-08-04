export const CATEGORIES: Record<string, string[]> = {
  "Food & Drink": ["Groceries", "Dining out", "Coffee", "Convenience store", "Alcohol"],
  "Transport": ["Train / IC card", "Taxi / Ride-share", "Shinkansen", "Flight", "Fuel / Parking"],
  "Housing": ["Rent", "Utilities", "Internet", "Mobile phone", "Condo fees"],
  "Health": ["Doctor", "Pharmacy", "Dental", "Gym"],
  "Personal Care": ["Haircut", "Clothing", "Cosmetics"],
  "Entertainment": ["Books / Manga", "Movies / Events", "Games", "Hobbies"],
  "Social": ["Gifts", "Dining with friends", "Charity"],
  "Travel": ["Flights", "Hotel", "Activities"],
  "Subscriptions": ["Streaming", "Software", "Other subscription"],
  "Family": ["Remittance", "International travel"],
  // Investing: capital deployed for future value (worldwide — not country-specific)
  // Pension contribution covers NISA/iDeCo (JP), 401k (US), ISA (UK), RRSP (CA), Super (AU), SSS (PH)
  "Investing": [
    "ETF / Index fund",
    "Stock purchase",
    "Crypto",
    "Bond / Fixed income",
    "Pension contribution",
    "Property purchase",
    "Education / Course",
    "Work tool",
    "Other investment",
  ],
  "Other": ["Other"],
};

export const INCOME_CATEGORIES: Record<string, string[]> = {
  "Income": ["Salary", "Dividends", "Rental income", "Freelance", "Other income"],
};

// Fixed = predictable, same amount every month (rent, subscriptions, train pass)
// Variable = discretionary, changes month to month (dining, shopping, travel)
// Classification at subcategory level for accuracy

export const FIXED_SUBCATEGORIES = new Set([
  // Housing — all fixed
  "Rent", "Utilities", "Internet", "Mobile phone", "Condo fees",
  // Transport — commuter pass is fixed, taxis are not
  "Train / IC card",
  // Health — gym membership is fixed
  "Gym",
  // Subscriptions — all fixed by definition
  "Streaming", "Software", "Other subscription",
  // Family — remittance is a recurring fixed obligation
  "Remittance",
]);

export function getCategoryType(category: string): "fixed" | "variable" {
  // Check if ALL subcategories of this category are fixed
  const subs = CATEGORIES[category] ?? [];
  if (subs.length > 0 && subs.every((s) => FIXED_SUBCATEGORIES.has(s))) return "fixed";
  // Mixed categories (e.g. Transport has fixed train + variable taxi) → variable at category level
  return "variable";
}

export function getSubcategoryType(subcategory: string): "fixed" | "variable" {
  return FIXED_SUBCATEGORIES.has(subcategory) ? "fixed" : "variable";
}

export const EXPENSE_CATEGORY_NAMES = Object.keys(CATEGORIES);
export const ALL_CATEGORY_NAMES = [...EXPENSE_CATEGORY_NAMES, ...Object.keys(INCOME_CATEGORIES)];

// ── Cash flow stream classification ──────────────────────────────────────────
// Maps subcategory → default stream. Used at transaction save time.
// OCF = Operating (daily life), ICF = Investing (future value), FCF = Financing (debt)
import type { CashFlowStream } from "../data/transactions";

export const CASHFLOW_TYPE_DEFAULTS: Record<string, CashFlowStream> = {
  // Income — all operational by default (dividends/rental override in QuickCapture)
  "Salary": "ocf", "Freelance": "ocf", "Other income": "ocf",
  "Dividends": "icf", "Rental income": "icf",

  // Food & Drink — operational
  "Groceries": "ocf", "Dining out": "ocf", "Coffee": "ocf",
  "Convenience store": "ocf", "Alcohol": "ocf",

  // Transport — operational
  "Train / IC card": "ocf", "Taxi / Ride-share": "ocf",
  "Shinkansen": "ocf", "Flight": "ocf", "Fuel / Parking": "ocf",

  // Housing — operational
  "Rent": "ocf", "Utilities": "ocf", "Internet": "ocf",
  "Mobile phone": "ocf", "Condo fees": "ocf",

  // Health — operational (gym = human capital maintenance)
  "Doctor": "ocf", "Pharmacy": "ocf", "Dental": "ocf", "Gym": "ocf",

  // Personal Care — operational
  "Haircut": "ocf", "Clothing": "ocf", "Cosmetics": "ocf",

  // Entertainment — operational
  "Books / Manga": "ocf", "Movies / Events": "ocf", "Games": "ocf", "Hobbies": "ocf",

  // Social — operational
  "Gifts": "ocf", "Dining with friends": "ocf", "Charity": "ocf",

  // Travel — operational (leisure travel = consumption, not investment)
  "Flights": "ocf", "Hotel": "ocf", "Activities": "ocf",

  // Subscriptions — operational
  "Streaming": "ocf", "Software": "ocf", "Other subscription": "ocf",

  // Family — operational
  "Remittance": "ocf", "International travel": "ocf",

  // Other
  "Other": "ocf",

  // Investing — ICF (worldwide subcategories, country-agnostic labels)
  "ETF / Index fund": "icf",
  "Stock purchase": "icf",
  "Crypto": "icf",
  "Bond / Fixed income": "icf",
  "Pension contribution": "icf",   // NISA/iDeCo/JP, 401k/US, ISA/UK, RRSP/CA, Super/AU, SSS/PH
  "Property purchase": "icf",
  "Education / Course": "icf",     // ambiguous — stream confirm fires at save
  "Work tool": "icf",              // ambiguous — stream confirm fires at save
  "Other investment": "icf",

  // Financing — auto-tagged by liability payment modal
  "Loan payment": "fcf", "Mortgage payment": "fcf",
};

// Subcategories where the user should be asked to confirm the stream
// (12+ month useful life and potentially income-enabling)
export const AMBIGUOUS_STREAM_SUBCATEGORIES = new Set([
  "Software",           // could be tool (ICF) or subscription (OCF)
  "Other",              // catch-all — ambiguous by definition
  "Hobbies",            // could be skill-building (ICF) or recreation (OCF)
  "Education / Course", // small course = OCF, university tuition = ICF
  "Work tool",          // cheap cable = OCF, professional camera = ICF
]);

export function getDefaultStream(subcategory: string): CashFlowStream {
  return CASHFLOW_TYPE_DEFAULTS[subcategory] ?? "ocf";
}
