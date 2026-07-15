// Currency is now a plain string — supports any ISO 4217 code (JPY, PHP, USD, EUR, GBP, etc.)
export type Currency = string;

export interface ExchangeRates {
  // Key format: "BASE_QUOTE" e.g. "JPY_PHP", "EUR_USD"
  // All rates are relative to baseCurrency: 1 baseCurrency = X quote
  rates: Record<string, number>;
  updatedAt: string;
}

export interface LedgrSettings {
  baseCurrency: Currency;
  secondaryCurrencies: Currency[]; // shown in toggle, max 2
  exchangeRates: ExchangeRates;
  financeFolder: string;
  enableTransferTracker: boolean;
  lastUsedTransferService: string;
  transferServiceFees: Record<string, number>;
  firstRun: boolean;
  appendToDailyNote: boolean;
  dailyNotePath: string; // folder path for daily notes
}

export const DEFAULT_SETTINGS: LedgrSettings = {
  baseCurrency: "JPY",
  secondaryCurrencies: ["PHP", "USD"],
  exchangeRates: {
    rates: {
      JPY_PHP: 0.38,
      JPY_USD: 0.0065,
    },
    updatedAt: "",
  },
  financeFolder: "Private/Finance",
  enableTransferTracker: false, // opt-in, not default
  lastUsedTransferService: "Wise",
  transferServiceFees: {
    "Wise": 0,
    "Revolut": 0,
    "Bank Transfer": 0,
    "Other": 0,
  },
  firstRun: true,
  appendToDailyNote: false,
  dailyNotePath: "",
};
