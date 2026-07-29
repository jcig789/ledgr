# v0.3.0 — Continuity + Debt
**Status:** Approved — PDM + UX + CFP reviewed
**Build order:** 5 (closure) → 4 (debt cost) → 6 (property) → 1 (income templates) → Standing fixes → UX debt → 2 (projection)

---

## Data Model Changes (all additive, backward compatible)

### `LiabilityDetails` (`src/data/networth.ts`)
```typescript
apr?: number;       // Annual percentage rate e.g. 15.9 for 15.9%
closedAt?: string;  // YYYY-MM-DD — set when balance reaches 0 and user confirms
```

### `Account` (`src/data/networth.ts`)
```typescript
linkedAssetId?: string;      // liability → points to property asset account
linkedLiabilityId?: string;  // asset → points to mortgage liability account
```

### `LedgrSettings` (`src/settings.ts`)
```typescript
composureExcludedCategories: string[];  // defaults to []
```

### `BearingHistory` (`src/data/bearing.ts`) — CFP blocker for projection
```typescript
// Extend from: Record<string, number>
// To:
interface BearingMonthRecord {
  score: number;
  pillars: Record<string, number>;  // pillar name → score
  activePillars: string[];          // which pillars were hasData:true
}
history: Record<string, BearingMonthRecord>;
```
Migration: existing `Record<string, number>` entries read as `{ score: n, pillars: {}, activePillars: [] }`.

### New files
- `src/data/debtCost.ts` — pure amortization functions
- `src/ui/DebtCostModal.ts` — debt analysis modal

---

## Feature 5 — Liability Closure

### Data change
`closedAt?: string` on `LiabilityDetails`.

### Closure trigger
In `LiabilityPaymentModal`, after saving a payment where `acc.balance <= 0` (using `Math.round(acc.balance * 100) === 0` for float safety):
- Do NOT call `this.close()` yet
- Render inline prompt: "Balance is now zero. Archive this liability?"
- Two buttons: "Archive" → sets `acc.liabilityDetails.closedAt = today`, saves, fires `ledgr:networth-updated`, closes
- "Keep Open" → closes without setting `closedAt`

Manual archive: in `renderLiabilities()` edit mode, each liability card gets "Archive" button (visible when `balance === 0`).

### Display
- Active liabilities: render as today
- Closed: strikethrough name, "paid off" badge, hidden by default
- Section header: "Show closed (N) →" toggle link — does NOT re-render full view, just toggles hidden class
- Closed excluded from: Ballast calculation, Payments Due card, upcoming payments banner

### Bearing Ballast fix
```typescript
// In calculateBearing(), both lines:
.filter((a) => a.isLiability && !a.liabilityDetails?.closedAt)
```

### Files
- `src/data/networth.ts` — add `closedAt?`
- `src/data/liabilities.ts` — filter `closedAt` in `getUpcomingPayments()`
- `src/data/bearing.ts` — filter closed liabilities in `totalLiabilities`
- `src/ui/LiabilityPaymentModal.ts` — post-save closure prompt
- `src/ui/NetWorthView.ts` — archive button in edit mode, closed section in read mode
- `src/ui/DashboardView.ts` — filter closed liabilities in Payments Due and banner

---

## Feature 4 — Debt Cost Analysis

### Data change
`apr?: number` on `LiabilityDetails`. Entered in edit mode liability card and in `DebtCostModal`.

### APR in edit mode
After existing reminder rows, add:
- Row: "APR %" + `createEl("input", { attr: { type: "number", placeholder: "e.g. 18" } })`
  - Value stored as decimal: `acc.liabilityDetails.apr = parseFloat(val) / 100`

### Amortization (pure functions in `src/data/debtCost.ts`)
```typescript
monthlyRate = apr / 12
monthlyInterest = balance * monthlyRate
principalThisMonth = monthlyPayment - monthlyInterest
// payoff: ln(payment / (payment - balance * rate)) / ln(1 + rate)
// totalInterest = monthlyPayment * monthsToPayoff - balance
```

**Guards:**
- `account.type === "credit_card"` with no fixed term → skip amortization, show interest-only cost
- `monthlyPayment <= monthlyInterest` → show error: "Payment does not cover interest"

### DebtCostModal
Triggered by "Analyze" button on each liability row (alongside Pay button).
Shows:
- Current balance, monthly payment, APR input (if not set: auto-focus)
- Monthly interest cost, principal this month
- Months to payoff, payoff date, total interest (muted), total cost
- Extra payment what-if (ephemeral): enter extra/month → updated payoff + interest savings
- Priority order: all APR-bearing liabilities sorted descending (Avalanche = "Lowest total cost") and ascending by balance (Snowball = "Fastest first win")
- CFP note: interest savings footnote + "compare to expected investment return before accelerating payoff"

### Files
- `src/data/networth.ts` — add `apr?`
- `src/data/debtCost.ts` — new pure functions
- `src/ui/DebtCostModal.ts` — new modal
- `src/ui/NetWorthView.ts` — APR input in edit mode, Analyze button in read mode

---

## Feature 6 — Property Equity Tracking

### Data change
`linkedAssetId?: string` on liability Account, `linkedLiabilityId?: string` on asset Account.

### CFP rules
- Pre-handover installments: ICF stream (not FCF)
- Under-construction: show paid-in equity only, label "Under construction — contracted ¥X, paid ¥Y"
- Manual valuation: user sets balance = market value, datestamped; warn if > 12 months old

### Equity widget (new `renderPropertyEquity()` in `NetWorthView`)
Shown before Liabilities when at least one linked pair exists.
```
Property value      ¥ 32,000,000
Mortgage balance    ¥ 24,800,000
──────────────────────────────────
Equity              ¥  7,200,000    22.5%
LTV ratio               77.5%
Principal paid      ¥  3,200,000    11.4% of loan
```
No bar charts. No color coding. Numbers only.

### Linking in edit mode
Mortgage card gets "Linked property" dropdown: `new Setting(row).addDropdown((d): void => { ... })` listing all `type === "property"` accounts plus "(none)".

Property account balance label shows "Market Value" (not "Balance") in read mode.

### Files
- `src/data/networth.ts` — add `linkedAssetId?`, `linkedLiabilityId?`
- `src/ui/NetWorthView.ts` — `renderPropertyEquity()`, link dropdown in edit mode, label override

---

## Feature 1 — Income Templates

### Change
`TemplatesModal.renderManage()`: add type toggle (Expense / Income) before the amount field. Reads `let newType: "expense" | "income" = "expense"`.

`renderApply()`: income template rows get `ledgr-badge-income` badge and green amount text.

`seedSuggestions()`: stays expense-only — recurring income is often irregular, not safe to auto-seed.

**Important:** document in UI that income templates do not affect the Forecast projection baseline until real transactions post.

### Files
- `src/ui/TemplatesModal.ts`

---

## Standing Tab Fixes

### Provision false ceiling
In `calcProvision()`, replace:
```typescript
// Before:
return { name, score: 0, max: pillarMax, label: "Insufficient", hasData: false, note: "Add savings goals..." };
// After:
return { name, score: 0, max: pillarMax, label: "Developing", hasData: true, note: "Add savings goals to improve Provision." };
```
Effect: Provision is included in renormalization at 0 score. Users without goals are penalized, not rewarded.

### Business owner Composure exclusion
New setting `composureExcludedCategories: string[]` in `LedgrSettings`.
In `calculateBearing()`, filter before computing monthly expenses:
```typescript
const excluded = new Set(settings.composureExcludedCategories ?? []);
monthlyExpenses = txs.filter(t => t.type === "expense" && !excluded.has(t.category))
```
Checklist in ConfigModal (or SettingTab) Features group.
`PillarResult.note` appended: "N categories excluded (business mode)."

### Confidence bands on Forecast table
Add Low/High columns to the forecast table in `StatementsView.renderForecast()`.
Footnote: "Low / High band widens by 8% per month from historical variance."

### Files
- `src/data/bearing.ts` — Provision fix, Composure exclusion
- `src/settings.ts` — add `composureExcludedCategories`
- `src/ui/StatementsView.ts` — confidence band columns
- `src/ui/ConfigModal.ts` — exclusion checklist in Features group

---

## Feature 2 — Bearing Forward Projection (last — requires BearingHistory migration)

### CFP blocker resolution
Extend `BearingHistory` to store per-pillar scores. Migration: old `number` entries → `{ score: n, pillars: {}, activePillars: [] }`.
Gate projection on: ≥3 months of history WHERE the same active-pillar set is consistent. If pillar set changed mid-window, use the shorter stable segment.

### Calculation (new export `projectTierAttainment()` in `src/data/bearing.ts`)
- Linear regression slope on composite scores over the stable window
- If `|slope| < 0.3`: direction = "stable", no estimate
- If slope > 0: months to next tier = `(nextThreshold - currentScore) / slope`, capped at 24
- If slope < 0: months to tier drop
- Ceiling correction: if score > 75, apply sqrt compression to slope (scores slow near ceilings)

### Placement (in `StandingView`, between card meta row and Pillars section)
```
At current trajectory, Established in ~4 months.
◦ ─── ◦ ─── ◦ ─── ◦ ─── ◦           [55 → 70]
```
SVG dashed projection line (`stroke-dasharray="2 3"`, `opacity="0.4"`) extending the trend chart. Target month has open circle endpoint.

**Mandatory disclosures (shown as footnote):**
1. "Based on linear trend. Structural changes are not modeled."
2. "Adding new pillars will reset this estimate."

Declining state: "The Bearing has not improved over the past 3 months. Review the weakest pillars below."

### In `copyCardToClipboard()` canvas render
Add projection text below Index line in `fgFaint` color.

### Files
- `src/data/bearing.ts` — `BearingHistory` migration, `projectTierAttainment()` export, schema update
- `src/ui/StandingView.ts` — projection strip, canvas render update

---

## UX Debt

### UX-1: Contextual empty states
Replace all passive "no data" `<p>` elements:

| Location | Current | Replacement |
|---|---|---|
| Dashboard first-run | 3 steps + primary CTA | Elevate "Set Up Net Worth" to equal CTA; add description to each step |
| Net Worth empty accounts | "No accounts. Click Edit." | Message + "Add account" button → sets editMode = true |
| Net Worth empty brokerages | Same pattern | "Add investment" button |
| Net Worth empty liabilities | Same pattern | "Add liability" button + "Accurate liability data required for Ballast pillar" |
| Net Worth goals | "No goals defined" | "Add Goal" button inline below message |
| Dashboard no transactions | "No transactions this month." | Message + Quick Capture CTA button |
| Standing insufficient data | Stub pillar list | Actionable pillar stubs: Discipline→budget modal, Ballast→edit NW, Provision→goal modal |

### UX-2: Full transaction ledger
"View all (N) →" link in Recent Transactions section header.
Inline expansion (not modal). Full list = all transactions for current month reversed.
When expanded: search input (filter rows by note text) + year-to-date toggle.
"Show recent only ←" collapses back to 10 rows.

### UX-3: Guidance deep-links
New event `ledgr:focus-section` with payload `{ section: string }`.
`StandingView.renderGuidance()` calls `openView(tab)` then fires event.
Target views (NetWorthView) register listener, scroll to `data-anchor` section, add brief `ledgr-section-highlight` class for 2 seconds.

Section anchor map:
```
Discipline  → ledgr-dashboard  → "spending-by-category"
Ballast     → ledgr-networth   → "liabilities"
Provision   → ledgr-networth   → "goals"
Composure   → ledgr-dashboard  → "spending-by-category"
Momentum    → ledgr-networth   → "nw-history"
Reserve     → ledgr-networth   → "primary-accounts"
```

CSS: `.ledgr-section-highlight { border: 1px solid var(--ledgr-ivory); transition: border 0.3s; }`

### UX-4: Settings reorganization
`SettingTab.ts` — 4 groups using `setHeading()`:
- **General**: base currency, secondary currencies, finance folder, daily note toggle/path
- **Exchange Rates**: last updated status + "Update →" button opening ConfigModal
- **Transfer Tracker**: enable toggle, service list
- **Features**: Composure exclusions checklist, forecast horizon dropdown

---

## Obsidian Checker Constraints (must not violate)

- `createDiv()` / `createSpan()` — never `createEl("div/span")`
- `createEl("input", { attr: { type: "..." } })` — never `.type = x` post-creation
- `setCssStyles()` — never `.style.x = y`
- No `window.prompt()` — inline inputs or modals only
- No `eslint-disable` comments
- All `addDropdown` callbacks: `(d): void =>` with `void d.setValue().onChange()`
- All `forEach` with `addOption`: `(x): void => { d.addOption(x, x); }`
- No `document.createElement` — use `createEl()` for canvas too
- No `async` arrow functions where `void` return expected — use `.then()` chains
