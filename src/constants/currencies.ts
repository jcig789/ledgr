/**
 * Currency symbol map.
 * Symbol goes BEFORE the number for prefix currencies, AFTER for suffix.
 * Format: { code: { symbol, prefix } }
 * prefix: true  → "$1,000"
 * prefix: false → "1,000 kr"
 */
export const CURRENCY_SYMBOLS: Record<string, { symbol: string; prefix: boolean }> = {
  // Major
  USD: { symbol: "$",   prefix: true  },
  EUR: { symbol: "€",   prefix: true  },
  GBP: { symbol: "£",   prefix: true  },
  JPY: { symbol: "¥",   prefix: true  },
  CNY: { symbol: "¥",   prefix: true  },
  AUD: { symbol: "A$",  prefix: true  },
  CAD: { symbol: "C$",  prefix: true  },
  CHF: { symbol: "Fr",  prefix: true  },
  HKD: { symbol: "HK$", prefix: true  },
  SGD: { symbol: "S$",  prefix: true  },
  NZD: { symbol: "NZ$", prefix: true  },
  // Asia
  PHP: { symbol: "₱",   prefix: true  },
  KRW: { symbol: "₩",   prefix: true  },
  INR: { symbol: "₹",   prefix: true  },
  THB: { symbol: "฿",   prefix: true  },
  MYR: { symbol: "RM",  prefix: true  },
  IDR: { symbol: "Rp",  prefix: true  },
  VND: { symbol: "₫",   prefix: false },
  TWD: { symbol: "NT$", prefix: true  },
  BDT: { symbol: "৳",   prefix: true  },
  PKR: { symbol: "₨",   prefix: true  },
  LKR: { symbol: "₨",   prefix: true  },
  // Europe
  SEK: { symbol: "kr",  prefix: false },
  NOK: { symbol: "kr",  prefix: false },
  DKK: { symbol: "kr",  prefix: false },
  PLN: { symbol: "zł",  prefix: false },
  CZK: { symbol: "Kč",  prefix: false },
  HUF: { symbol: "Ft",  prefix: false },
  RON: { symbol: "lei", prefix: false },
  TRY: { symbol: "₺",   prefix: true  },
  // Americas
  BRL: { symbol: "R$",  prefix: true  },
  MXN: { symbol: "MX$", prefix: true  },
  ARS: { symbol: "AR$", prefix: true  },
  CLP: { symbol: "CL$", prefix: true  },
  COP: { symbol: "CO$", prefix: true  },
  PEN: { symbol: "S/",  prefix: true  },
  // Middle East / Africa
  AED: { symbol: "د.إ", prefix: false },
  SAR: { symbol: "﷼",   prefix: false },
  ILS: { symbol: "₪",   prefix: true  },
  ZAR: { symbol: "R",   prefix: true  },
  NGN: { symbol: "₦",   prefix: true  },
  EGP: { symbol: "£",   prefix: true  },
  KWD: { symbol: "KD",  prefix: false },
  // Crypto (common)
  BTC: { symbol: "₿",   prefix: true  },
  ETH: { symbol: "Ξ",   prefix: true  },
};

/**
 * Format an amount with its currency symbol.
 * Falls back to "CODE amount" if no symbol is defined.
 */
export function formatCurrency(amount: number, currencyCode: string): string {
  const entry = CURRENCY_SYMBOLS[currencyCode.toUpperCase()];
  const rounded = Math.round(amount).toLocaleString();
  if (!entry) return `${currencyCode} ${rounded}`;
  return entry.prefix ? `${entry.symbol}${rounded}` : `${rounded} ${entry.symbol}`;
}
