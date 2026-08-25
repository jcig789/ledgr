# Ledgr — Personal Finance for Obsidian

Multi-currency personal finance tracker that lives entirely inside your Obsidian vault. No accounts, no cloud, no subscriptions.

---

## Features

### Core
- **Quick transaction capture** — Expense/Income toggle at top; chip-based category selector; log expenses and income in seconds; Enter saves from the amount field on desktop
- **Dashboard** — Income | Expenses | Net Position cards; savings rate gauge ("of operating income"); Spending by Category with OCF-only toggle; Cash Flow Health panel (OCF/ICF/FCF); urgency banner for overdue payments
- **Scheduled This Month** — unified view of all bills and liability payments due this month with week grouping, urgency sorting, and a Scheduled · Paid · Remaining footer
- **Budgets** — per-category monthly limits with over-budget indicators and fixed/variable classification
- **Net worth tracker** — bank accounts, investment accounts, and liabilities across multiple currencies with allocation chart and history chart
- **Liability tracker** — track loans, mortgages, credit cards; log payments with live balance preview; closure prompt when paid off
- **Debt cost analysis** — enter APR to see monthly interest cost, months to payoff, total interest, extra payment what-if, avalanche vs snowball priority order
- **Property equity** — link a mortgage to a property asset to track equity %, LTV ratio, and principal paid
- **Financial statements** — CPA-style Income Statement (operating expenses only; non-operating income shown separately), three-section Cash Flow (Operating/Investing/Financing), Balance Sheet; K/M/B formatting; correct sign on negative Net Worth
- **Cash Flow Forecast** — 3/6/12M projection, what-if simulator (up to 4 scenarios), Runway to Commit timing
- **Savings goals** — set a target amount, deadline, and linked account; see projected completion date and progress bar
- **Daily countdown** — budget remaining and daily allowance for the rest of the month
- **Recurring templates** — save fixed monthly expenses and income; apply in one click at month start; idempotent (safe to apply twice)
- **Investing category** — worldwide subcategories for ETF/index funds, stocks, crypto, bonds, pension contributions (NISA/iDeCo, 401k, ISA, RRSP, Super, SSS), property, education, work tools — all classified as ICF
- **Transaction search** — live search by note, category, or subcategory on the dashboard

### Recurring Bills
- **Bills system** — track subscriptions, utilities, and any recurring payment that has no running balance (Netflix, electricity, mobile plan)
- **Monthly, annual, or one-time** — annual bills require a due month (Jan–Dec selector); one-time bills auto-hide after first payment
- **Nth-weekday support** — schedule bills on "2nd Wednesday" or any ordinal weekday
- **Calendar ○ markers** — bills show as ○ on the calendar; ★ for debt payments — visually distinct
- **Bill management** — add via Obligations button on Dashboard; edit amount, category, frequency, and due date inline
- **Urgency banner** — overdue and due-soon bills appear alongside liabilities at the top of the Dashboard

### Standing — The Bearing
- **Financial health index** — scored 0–100 from 6 behavioral pillars (Discipline, Ballast, Provision, Composure, Momentum, Reserve); Composure uses OCF expenses only so lump-sum investments don't distort the volatility score
- **Shareable card** — old money assay seal design, zero monetary amounts, exportable as PNG with assessment date
- **Forward projection** — "At current trajectory, Established in ~4 months" based on score history
- **Behavioral guidance** — weakest pillars surface with deep-links to the relevant section

### Reports
- **Monthly review** — generate a Markdown note summarizing any past month
- **Ledgr Wrapped** — annual year-in-review note

### Transfer Tracker (opt-in)
- Log international money transfers with fee, exchange rate, and received amount
- Dashboard widget with monthly and YTD totals, lifetime sent, history with period filter

### Calendar
- Monthly calendar grid — transaction amounts per day (red = spend, green = income)
- Bill due markers (○) and debt payment markers (★) — different symbols for different obligation types
- Click any day to see transactions, bills due (with Log button), and debt payments (with Pay button)
- "+ Add" in the sticky header and in the day detail panel — pre-fills the exact selected date
- Forward navigation up to 3 months for planning upcoming obligations
- Mobile: stacked layout with detail panel below the grid

### Settings — Features, Advanced & New Ledger
- **Calendar week start** — choose Monday (ISO) or Sunday under Settings → Features
- **Fix Legacy Transactions** — one-time migration tool to correct loan/mortgage payments that were mis-classified as Operating cash flow before v0.3.3
- **New Ledger** — wipe all financial data and start fresh; preserves settings (currency, folder, exchange rates); requires typing "NEW LEDGER" to confirm

### Navigation & UX
- Sticky top tab bar — Dashboard | Net Worth | Statements | Standing | Calendar
- Transaction table shows category + subcategory in a two-line cell
- Segmented selectors for all binary choices (Expense/Income, Bill/Liability, Date/Weekday)
- Old Money design system — charcoal, small caps, tabular numerals, no emojis
- Guidance deep-links scroll to the relevant section in the target tab

### Mobile
- Fully responsive throughout
- Category chip selector in Quick Capture — scrollable on mobile, wraps on desktop
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

**From the community store:** search "Ledgr" in Settings → Community plugins → Browse.

---

## How It Works

All data is stored as plain files in your vault under a configurable folder (default: `Private/Finance`).

- **Transactions** — monthly Markdown files (`transactions/YYYY-MM.md`) as human-readable tables with Dataview inline fields
- **Budgets** — `budgets.json`
- **Net worth** — `networth.json` (accounts, brokerages, liabilities)
- **Goals** — `goals.json`
- **Bills** — `ledgr-bills.json` (recurring subscriptions and utilities)
- **Transfers** — `remittances.json` (if transfer tracker is enabled)

No external services are contacted. No data ever leaves your device.

---

## Configuration

Open **Settings → Ledgr** (⚙ gear icon on the Dashboard) or tap the gear in the sticky header.

| Setting | Description |
|---|---|
| Finance folder | Vault path where all Ledgr data is saved |
| Base currency | Your primary currency (JPY, USD, EUR, PHP, etc.) |
| Secondary currencies | Additional currencies for display toggles |
| Exchange rates | Manual rates — update as needed; staleness indicator on dashboard |
| Enable transfer tracker | Opt-in module for international transfers |
| Append to daily note | Auto-append spending summary when a daily note is opened |

Exchange rates use the format `BASE_QUOTE` — e.g. `JPY_PHP` means 1 JPY = X PHP.

---

## Liability Tracker

Add liabilities (mortgage, car loan, credit card, personal loan, student loan, installment/BNPL) in the Net Worth tab. For each liability:

- Original amount, current balance
- Monthly payment amount and due day (supports Nth-weekday schedules like "2nd Wednesday")
- Reminder days ahead — shows the upcoming payments banner on the Dashboard

When a payment is due, the Urgency Banner on the Dashboard shows a **Pay** button. Tapping it opens a payment modal with a live preview (`Balance → Payment → Remaining`), logs the payment, and records it as an FCF-classified transaction.

---

## Recurring Bills

Open **Obligations** on the Dashboard to manage recurring bills. Use the bulk entry table to add multiple bills at once:

- Name, amount (or "Varies" for credit cards), due day or Nth-weekday
- Frequency: Monthly, Annual, or Once
- Category: Utilities, Subscriptions, Transport, Rent, Insurance, Mobile/Internet, Other

Bills appear in the Scheduled This Month section and Calendar. When a bill is due, tap **Log →** to record the payment — it marks the bill paid for the month and saves a transaction.

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

Fields per transaction: `date`, `type`, `amount`, `currency`, `category`, `subcategory`, `note`, `stream` (ocf/icf/fcf).

---

## File Structure

```
<financeFolder>/
  transactions/
    YYYY-MM.md           # One file per month — readable table + Dataview fields
  budgets.json           # Category limits
  networth.json          # Accounts, brokerages, liabilities, goals
  goals.json             # Savings goals
  remittances.json       # Transfer history (if enabled)
  ledgr-bills.json       # Recurring bills (subscriptions, utilities)
  ledgr-templates.json   # Recurring transaction templates
  ledgr-bearing.json     # Bearing score history (per-pillar, monthly)
  ledgr-nw-history.json  # Net worth snapshots (monthly totals)
  categories.json        # Custom categories (created when defaults are modified)
  reviews/
    YYYY-MM-review.md    # Generated monthly review notes
    YYYY-wrapped.md      # Generated annual wrapped notes
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
- Transaction search across multiple months
- Net worth trend decomposition (productive vs consumer leverage)
- Budget roll-over / carry-forward
- Historical exchange rate tracking
