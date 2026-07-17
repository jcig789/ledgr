# Ledgr — Personal Finance for Obsidian

Multi-currency personal finance tracker that lives entirely inside your Obsidian vault. No accounts, no cloud, no subscriptions.

---

## Features

### Core
- **Quick transaction capture** — log expenses and income in seconds via modal or command palette; Enter to save on desktop
- **Dashboard** — monthly cash flow summary: income, expenses, savings, savings rate gauge, category donut chart, 6-month trend, per-category budget bars
- **Budgets** — set per-category monthly limits with over-budget indicators and fixed/variable classification
- **Net worth tracker** — bank accounts, investment accounts, and liabilities across multiple currencies with allocation chart
- **Liability tracker** — track loans, mortgages, credit cards, and installment plans; log payments with live balance preview; due-date reminders on the dashboard
- **Financial statements** — CPA-style Income Statement (with budget vs. actual variance), Cash Flow, and Balance Sheet; K/M/B formatting for large amounts
- **Savings goals** — set a target amount, deadline, and linked account; see projected completion date and progress bar
- **Daily countdown** — budget remaining and daily allowance for the rest of the month

### Reports
- **Monthly review** — generate a Markdown note summarizing any past month: income, expenses, category breakdown, notable transactions, vs. last month
- **Ledgr Wrapped** — generate an annual year-in-review note with best/worst months, top spending categories, and transfers summary

### Transfer Tracker (opt-in)
- Log international money transfers with fee, exchange rate, and received amount
- Dashboard widget with monthly and YTD totals, lifetime sent, history with period filter

### Navigation & UX
- Sticky top tab bar — Dashboard | Net Worth | Statements — works on mobile and desktop
- Transaction edit and delete (2-step confirm on delete)
- Currency toggle — switch between base and secondary currencies instantly
- Old Money design system — charcoal, small caps, tabular numerals

### Mobile
- Fully responsive throughout
- Safe-area-inset support for iPhone notch and home indicator
- Compact controls in sticky zone on small screens

---

## Quick Start

**Manual installation:**

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](../../releases/latest).
2. In your vault, create the folder `.obsidian/plugins/ledgr/`.
3. Copy the three files into that folder.
4. Open Obsidian → **Settings → Community plugins** → enable **Ledgr**.
5. The onboarding wizard runs on first launch.

**From the community store** (pending review): search "Ledgr" in Settings → Community plugins → Browse.

---

## How It Works

All data is stored as plain files in your vault under a configurable folder (default: `Private/Finance`).

- **Transactions** — monthly Markdown files (`transactions/YYYY-MM.md`) as human-readable tables with Dataview inline fields
- **Budgets** — `budgets.json`
- **Net worth** — `networth.json` (accounts, brokerages, liabilities)
- **Goals** — `goals.json`
- **Transfers** — `remittances.json` (if transfer tracker is enabled)

No external services are contacted. No data ever leaves your device.

---

## Configuration

Open **Settings → Ledgr** or tap the gear icon on the dashboard.

| Setting | Description |
|---|---|
| Finance folder | Vault path where all Ledgr data is saved |
| Base currency | Your primary currency (JPY, USD, EUR, PHP, etc.) |
| Secondary currencies | Up to two additional currencies for display toggles |
| Exchange rates | Manual rates — update as needed; staleness indicator on dashboard |
| Enable transfer tracker | Opt-in module for international transfers |
| Append to daily note | Auto-append spending summary when opening a daily note |

Exchange rates use the format `BASE_QUOTE` — e.g. `JPY_PHP` means 1 JPY = X PHP.

---

## Liability Tracker

Add liabilities (mortgage, car loan, credit card, personal loan, student loan, installment/BNPL) in the Net Worth tab. For each liability set:

- Original amount and current balance
- Monthly payment amount and due day
- Reminder days ahead (shows upcoming payment banner on the dashboard)

When a payment is due, a banner appears on the dashboard with a **Pay** button. Tapping it opens a payment modal showing a live preview (`Balance → Payment → Remaining`), logs the payment against the account balance, and records it as a transaction in the correct expense category.

---

## Transfer Tracker

Enable in settings. Log any international transfer with:

- Amount sent and received
- Service (Wise, Revolut, Bank Transfer, or custom)
- Fee and exchange rate at time of transfer

Dashboard shows monthly/YTD totals alongside regular spending. Full history with month/year/all-time filter.

---

## Dataview Compatibility

Transactions are written with Dataview inline fields so they can be queried directly.

```dataview
TABLE amount, currency, category, subcategory
FROM "Private/Finance/transactions"
WHERE type = "expense"
SORT date DESC
```

```dataview
TABLE sum(amount) as Total
FROM "Private/Finance/transactions"
WHERE category = "Food & Drink"
GROUP BY date
```

Fields per transaction: `date`, `type`, `amount`, `currency`, `category`, `subcategory`, `note`.

---

## File Structure

```
<financeFolder>/
  transactions/
    YYYY-MM.md         # One file per month — readable table + Dataview fields
  budgets.json         # Category limits
  networth.json        # Accounts, brokerages, liabilities
  goals.json           # Savings goals
  remittances.json     # Transfer history (if enabled)
  reviews/
    YYYY-MM-review.md  # Generated monthly review notes
    YYYY-wrapped.md    # Generated annual wrapped notes
```

---

## Development

Requirements: Node.js 18+, npm.

```bash
npm install

# Dev build with watch + auto-copy to vault
VAULT_PATH=/path/to/your/vault npm run dev

# Production build
VAULT_PATH=/path/to/your/vault npm run build
```

Create a `.env` file in the repo root with `VAULT_PATH=/path/to/vault` to avoid setting it every time.

---

## Roadmap

- CSV import / export
- Recurring transaction templates
- Historical exchange rate tracking
- Net worth snapshots over time
- OFW pack — recipient tracking, rate alerts, dual-household view
