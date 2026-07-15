# Ledgr — Personal Finance for Obsidian

Multi-currency personal finance tracker that lives entirely inside your Obsidian vault. No accounts, no cloud, no subscriptions.

## Features

- **Quick transaction capture** — log expenses and income via a modal or command palette
- **Dashboard** — monthly cash flow summary with income, expenses, savings rate, and category breakdown
- **Budgets** — set category-level spending limits with visual progress indicators
- **Net worth tracker** — track bank accounts, investment accounts, and liabilities across multiple currencies
- **Multi-currency support** — set a base currency and up to two secondary currencies; all values convert at your configured rates
- **Transfer tracker** — optional module for logging international money transfers with fee and exchange rate tracking
- **Daily note integration** — append a spending summary to your daily note automatically
- **Dataview compatibility** — all transactions are written with inline fields so you can query them with the Dataview plugin
- **Offline-first** — all data is stored as plain files in your vault

## Quick Start

**Manual installation (no community plugin store required):**

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release.
2. In your vault, create the folder `.obsidian/plugins/ledgr/`.
3. Copy the three files into that folder.
4. Open Obsidian, go to **Settings → Community plugins**, and enable **Ledgr**.
5. The onboarding wizard will run on first launch.

## How It Works

Ledgr stores all data as plain files inside your vault under a configurable folder (default: `Private/Finance`).

- **Transactions** are appended to monthly Markdown files (`transactions/YYYY-MM.md`) as table rows with Dataview inline fields.
- **Budgets** are stored in `budgets.json`.
- **Net worth** is stored in `networth.json`.
- **Transfers** are stored in `remittances.json` (if the transfer tracker is enabled).

No external services are contacted. No data leaves your device.

## Configuration

Open **Settings → Ledgr** or use the command `Ledgr: Settings (exchange rates & categories)`.

| Setting | Description |
|---|---|
| Finance folder | Vault path where all Ledgr data files are saved |
| Base currency | Your primary currency (e.g. JPY, USD, EUR) |
| Secondary currencies | Up to two additional currencies for display toggles |
| Exchange rates | Manual rates used to convert amounts — update as needed |
| Enable transfer tracker | Opt-in module for logging international transfers |
| Append to daily note | Automatically append a spending summary when you open a daily note |

Exchange rates use the format `BASE_QUOTE` (e.g. `JPY_PHP` means 1 JPY = X PHP). Update them from the settings panel or the gear icon on the dashboard.

## Transfer Tracker

Enable the transfer tracker in settings to log international money transfers. Each transfer record stores:

- Date and amount sent
- Transfer service used (Wise, Revolut, Bank Transfer, or Other)
- Fee paid
- Exchange rate at time of transfer
- Amount received

This module is designed for anyone sending money internationally on a regular basis. The dashboard shows monthly and year-to-date totals alongside your regular spending.

To log a transfer: use the command palette and run `Ledgr: Log transfer`.

## Dataview Compatibility

Transactions are written with Dataview inline fields embedded in comment blocks, so they do not affect the visual table but remain queryable.

Example queries:

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

The fields available on each transaction are: `date`, `type`, `amount`, `currency`, `category`, `subcategory`, `note`.

## File Structure

```
<financeFolder>/
  transactions/
    YYYY-MM.md       # One file per month — human-readable table + Dataview fields
  budgets.json       # Category budget limits
  networth.json      # Account and brokerage balances
  remittances.json   # Transfer history (if transfer tracker is enabled)
```

## Development

Requirements: Node.js 18+, npm.

```bash
# Install dependencies
npm install

# Start development build with watch mode (auto-copies to vault)
VAULT_PATH=/path/to/your/vault npm run dev

# Production build
VAULT_PATH=/path/to/your/vault npm run build
```

Set `VAULT_PATH` to your Obsidian vault root. The build will copy `main.js`, `manifest.json`, and `styles.css` into `.obsidian/plugins/ledgr/` automatically. Without `VAULT_PATH`, the build still succeeds but does not copy files.

## Roadmap

- Recurring transaction templates
- CSV import for bulk transaction entry
- Historical exchange rate tracking
- Category-level trend charts across multiple months
- Mobile-optimized quick capture
