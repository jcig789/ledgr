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
