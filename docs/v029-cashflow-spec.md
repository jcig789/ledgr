# v0.2.9 — Cash Flow Intelligence
**Status:** Approved — PDM + UX + CFA reviewed
**Theme:** Personal Cash Flow Management (OCF / ICF / FCF)

---

## Vision

Treat personal finances like running a business. Every person is the CFO of their own household. Cash flow — not profit — is the king.

Three streams:
- **Operating Cash Flow (OCF)** — daily income and routine expenses. The oxygen of personal finance.
- **Investing Cash Flow (ICF)** — cash deployed toward future value. Investments, education, tools.
- **Financing Cash Flow (FCF)** — debt and capital structure. Loan repayments, new borrowing.

---

## Feature 1 — `stream` Field on Transaction

### Data model change

Add one optional field to `Transaction` in `src/data/transactions.ts`:

```typescript
stream?: "ocf" | "icf" | "fcf"
```

- Existing transactions without `stream` default to `"ocf"` (correct for ~90% of historical data)
- No migration required — backward compatible
- Written to both the markdown table row and Dataview inline field

### Markdown row format (updated)

```
| Date | Type | Amount | Currency | Category | Subcategory | Note | Stream |
```

`readMonthTransactions()` in `reader.ts`: if `cols[7]` is missing or not a valid stream, fall back to auto-classification.

### Auto-classification lookup

Add `CASHFLOW_TYPE_DEFAULTS: Record<string, "ocf" | "icf" | "fcf">` to `src/constants/categories.ts`:

```typescript
// OCF — operational, recurring, life maintenance
"Salary": "ocf", "Freelance": "ocf", "Groceries": "ocf", "Rent": "ocf",
"Utilities": "ocf", "Transport": "ocf", "Subscriptions": "ocf",
"Healthcare": "ocf", "Gym": "ocf", "Dining": "ocf", "Entertainment": "ocf"

// ICF — future value: 12+ month useful life AND income-enabling
"ETF purchase": "icf", "Dividends": "icf", "Education / tuition": "icf",
"Work tools": "icf", "Property down payment": "icf"

// FCF — debt and capital (handled by LiabilityPaymentModal at write time)
// Auto-tagged when written from liability payment flow
```

### Manual override in QuickCaptureModal

Show a stream selector only for categories flagged as "ambiguous" (laptop, home improvement, etc.) — a set defined in `src/constants/categories.ts`. Defaults to the auto-classified value. 90% of users never see it.

### CFA Classification Rules

| Item | Stream | Rationale |
|---|---|---|
| Salary / wages | OCF | Core operational revenue |
| Freelance income | OCF | Labor income |
| Dividends | ICF | Return on capital |
| Rental income | ICF | Investment asset income |
| Groceries, rent, utilities | OCF | Non-negotiable operating costs |
| Gym membership | OCF | Human capital maintenance |
| Education / course | ICF | Increases earning capacity, 12+ month benefit |
| Personal laptop | OCF | Consumer good, depreciates |
| Work laptop (primary tool) | ICF | Enables income generation |
| Stock / fund purchase | ICF | Capital deployment |
| Property down payment | ICF | Acquiring long-lived asset |
| Mortgage interest | OCF | Cost of carrying debt |
| Mortgage principal | FCF | Liability reduction |
| Loan repayment (principal) | FCF | Debt reduction |
| Credit card payment | FCF | Liability reduction (if expenses already logged at spend time) |

**Rule for ambiguous items:** ICF if (a) useful life > 12 months AND (b) directly enables or grows income. Otherwise OCF.

---

## Feature 2 — Rebuilt Cash Flow Statement

Replace the flat 12-month grid in `StatementsView.renderCashFlow()` with a proper three-section statement.

### New statement structure

```
OPERATING ACTIVITIES
  Salary                          + 4,200
  Freelance income                +   850
  Groceries                       −   412
  Utilities                       −   198
  [... all OCF transactions]
  ────────────────────────────────────────
  NET OPERATING CASH FLOW         + 3,756

INVESTING ACTIVITIES
  ETF purchase                    − 1,500
  AWS course                      −   299
  ────────────────────────────────────────
  NET INVESTING CASH FLOW         − 1,799

FINANCING ACTIVITIES
  Mortgage principal              −   780
  Student loan                    −   220
  ────────────────────────────────────────
  NET FINANCING CASH FLOW         − 1,000

══════════════════════════════════════════
NET CHANGE IN CASH POSITION       +   957
Opening balance                   + 8,412
CLOSING BALANCE                   + 9,369
══════════════════════════════════════════

Prior month: + 612  ·  3-month avg: + 489
```

### Secondary view tabs within Cash Flow

Add a sub-tab toggle:

```
[ Summary ]  [ Waterfall ]  [ Grid ]
```

- **Summary** — three-section statement (above) — new default
- **Waterfall** — SVG bridge chart (see below)
- **Grid** — existing 12-month grid, preserved unmodified

### Key metric added

**Free Cash Flow Margin** at bottom: `FCF / Total Income` — what percentage of income survives all obligations. Target >20%.

### Waterfall chart (old money rendering)

Three bars: OCF → subtract ICF → subtract FCF → Net. SVG `<rect>` elements with hatching patterns, no solid fills:
- OCF: diagonal hatch (45°)
- ICF: crosshatch
- FCF: dot pattern
- Net: horizontal rules

Connected by 1px vertical rule (not arrow). Color only on numeric labels.

---

## Feature 3 — Cash Flow Health Panel on Dashboard

Add a collapsible "Cash Flow Health" panel between the countdown banner and the Spending by Category section.

Four numbers, monthly:

```
CASH FLOW HEALTH — JULY 2026

Operating     + ¥22,099    ↑ healthy
Investing     −  ¥5,000    capital deployed
Financing     − ¥150,000   debt service
──────────────────────────────────────────
Free Cash     − ¥132,901
```

- OCF: green if positive, red if negative
- ICF: neutral color (intentional deployment)
- FCF: neutral — paying down debt is healthy
- Free Cash Flow: green/red based on sign

This does NOT replace the existing cards. It sits between countdown and spending breakdown.

---

## Feature 4 — Recurring Transaction Templates

### New file: `src/data/templates.ts`

```typescript
interface TransactionTemplate {
  id: string;
  name: string;
  type: "expense" | "income";
  amount: number;
  currency: string;
  category: string;
  subcategory: string;
  stream: "ocf" | "icf" | "fcf";
  note: string;
}

interface TemplateStore {
  templates: TransactionTemplate[];
}
```

Storage: `ledgr-templates.json` in the finance folder.

### Apply Templates modal

Triggered by "Templates" button in Dashboard header (next to Budgets).

- Lists all templates with their amounts and checkboxes
- User selects which to apply, picks the month
- One click: writes each checked template as a transaction via `saveTransaction()`
- Pre-populate on first open by scanning prior month's fixed-category transactions as suggested templates

### Smart suggestion

On first open with no templates, scan previous month's transactions where subcategory is in `FIXED_SUBCATEGORIES` and offer them as one-click template candidates.

---

## Feature 5 — OCF Commitment Line

A single number the user commits to at the start of each month:

> "I will generate at least ¥180,000 in net operating cash this month."

### Storage

Add to monthly state (or a simple `ledgr-commitments.json`):
```typescript
{ "2026-07": 180000, "2026-08": 185000 }
```

### Dashboard display

Shown in the Cash Flow Health panel as a reference line:

```
CASH FLOW HEALTH — JULY 2026
OCF Target (committed)    ¥180,000
Current OCF               ¥ 22,099   (12 days in)
Projected OCF (run rate)  ¥ 55,000   ▲ tracking
```

Three lines. No chart. No gauges. A ledger entry compared to a commitment.

### Connection to Forecast

The Commitment Line value flows into the Forecast engine as the fixed commitment floor — the minimum OCF the user expects to generate. Any projected month below this line is flagged.

---

## Feature 6 — Cash Flow Projection + What-If Simulator

### Placement

`Statements → Cash Flow → [ Summary | Waterfall | Grid | Projection ]`

Fourth sub-view within Cash Flow. Not a modal. Scrollable document.

### Projection Engine (`src/data/projection.ts`)

**Core interface:**

```typescript
export interface ProjectionInput {
  monthlyOcfHistory: { month: string; income: number; expenses: number }[];
  fixedCommitments: number;         // recurring templates + liability payments
  currentLiquidBalance: number;
  scenarios: ScenarioItem[];
}

export interface ScenarioItem {
  label: string;
  monthlyDelta: number;             // positive = income, negative = expense
  startMonth: string;               // "YYYY-MM"
  endMonth?: string;                // optional — undefined = ongoing
}

export interface ProjectedMonth {
  month: string;
  projectedNet: number;
  projectedBalance: number;
  confidenceLow: number;
  confidenceHigh: number;
  scenariosActive: string[];
  belowReserveFloor: boolean;
  belowCommitmentFloor: boolean;
}

export interface ProjectionResult {
  months: ProjectedMonth[];
  commitmentFloor: number;
  reserveFloor: number;
  runwayMonth: string | null;       // earliest month all 3 conditions met
  runwayConditions: string[];
  liabilityPayoffEvents: { month: string; label: string; freedCash: number }[];
  dataQuality: "thin" | "building" | "full";
}

export function buildProjection(
  input: ProjectionInput,
  horizonMonths: 3 | 6 | 12
): ProjectionResult
```

### Methodology (CFA-approved)

**Layer 1 — Structural baseline (deterministic):**
- Recurring templates: exact amounts, exact months
- Liability payments: amortized (not flat) — balance decreases each month
- If liability extinguishes before horizon end → FCF released from that month forward

**Layer 2 — Behavioral overlay (statistical):**
- Variable expenses: trailing 3-month trimmed mean (drop highest outlier)
- Income: trailing 3-month average per income stream
- ICF: zero by default — user declares planned investment events only

**Confidence bands:**
- Low: trailing 3-month minimum per category
- High: trailing 3-month maximum per category
- Band widens by ~10% per month projected (compounding uncertainty)

**Data quality thresholds:**
- 0-1 months: empty state, no projection
- 2 months: thin — wide bands, Runway disabled
- 3-5 months: building — projection runs, Runway enabled
- 6+ months: full fidelity

### What-If Simulator (inline form, no modal)

```
HYPOTHETICAL
─────────────

Description   [ new venture                ]
Type          [ Expense ▾ ]
Amount        [ ¥30,000 / month            ]
Starts        [ October 2026 ▾ ]
Duration      [ Ongoing ▾ ]

                        [ Cancel ]  [ Apply ]
```

- Up to 4 scenarios stacked
- Scenarios are ephemeral — never persisted
- Combined scenarios → single long-dash line on chart (not separate lines)
- Removing a scenario is instant re-render

### The "Runway to Commit" (best timing)

Three conditions for a month to qualify as a safe start:
1. Projected liquid balance stays above **3-month reserve floor**
2. Projected monthly OCF remains **positive** after new commitment
3. Total fixed obligations remain **below 40% of average monthly income**

Visual: named vertical rule on timeline (`opaque 0.8` vs Today rule `opacity 0.3`):

```
Jul  Aug  Sep  ║  Nov  Dec
               ║
           Earliest
           viable start
```

Plain prose footnote: *"October 2026 is the earliest month at which this scenario can begin without reducing reserves below 3 months of coverage."*

No badges, no traffic lights.

### Liability-Free Date (most actionable timing signal)

For each liability paid off within the projection window:

```
Auto loan pays off in March 2027 — releases ¥18,000/month.
Starting your new commitment in April 2027 would be
fully covered by freed cash flow.
```

This answers the timing question without the user doing any math.

### The three most decision-useful outputs (CFA)

1. **Projected Monthly FCF at 3/6/12 months** — is the engine generating or consuming?
2. **Capacity Delta** — "Adding ¥30K/month reduces 12M projected FCF from +¥45K to +¥15K/month"
3. **Liability-Free Date + FCF release** — when debt extinguishes and how much cash it frees

### The moment of insight

When a scenario is applied, the position table updates:

```
POSITION AT END OF PERIOD

Current liquid reserves          ¥384,200
Projected net inflow (3M)        ¥ 87,000
─────────────────────────────────────────
Baseline projection (Sep)        ¥471,200

With scenarios applied           ¥355,700
                                (¥115,500)
```

`(¥115,500)` in accounting parentheses — red only when below reserve floor, neutral otherwise.

### Chart rendering (`renderProjectionChart` in `charts.ts`)

- Historical: solid bezier, filled circles, opacity 1.0
- Projected baseline: `stroke-dasharray: 4 3`, open circles, opacity 0.7
- Projected with scenario: `stroke-dasharray: 8 3`, open diamonds, `--ledgr-accent-muted`, opacity 0.9
- No area fill under projected sections
- Today rule: `stroke-width 0.8, opacity 0.3`
- Runway rule: `stroke-width 0.8, opacity 0.8` with label

### What NOT to project (CFA hard rules)

- Investment returns on ICF outflows
- Variable freelance income under 6 months of history
- Net worth at 12M including investment accounts
- Multi-scenario stacking beyond 4 simultaneous

---

## Files to Create / Modify

| File | Action |
|---|---|
| `src/data/transactions.ts` | Add `stream?: "ocf" | "icf" | "fcf"` to Transaction |
| `src/data/reader.ts` | Update `summarize()` to output `totalOCF`, `totalICF`, `totalFCF` |
| `src/constants/categories.ts` | Add `CASHFLOW_TYPE_DEFAULTS` map + `AMBIGUOUS_CATEGORIES` set |
| `src/data/templates.ts` | New — TemplateStore, load/save, apply |
| `src/data/projection.ts` | New — projection engine, pure functions |
| `src/ui/QuickCaptureModal.ts` | Add stream override for ambiguous categories |
| `src/ui/DashboardView.ts` | Add Cash Flow Health panel, OCF Commitment Line, Templates button |
| `src/ui/StatementsView.ts` | Rebuild renderCashFlow() + add Summary/Waterfall/Grid/Projection sub-views |
| `src/ui/TemplatesModal.ts` | New — apply templates modal |
| `src/ui/charts.ts` | Add renderProjectionChart(), renderCashFlowWaterfall() |
| `src/settings.ts` | Add forecastDefaultHorizon, nwOcfCommitments |
| `styles.css` | Add .ledgr-cf-*, .ledgr-proj-*, .ledgr-template-* classes |

---

## Financial Literacy Delivery

The UI teaches by convention, not instruction:
- The vocabulary (Operating, Investing, Financing) is applied precisely and consistently
- First ICF classification: one-line inline note appears once per stream type, never again
- OCF health signal in the statement: "Covers investing + financing by 1.57×"
- Forecast tab subheader: "Forward visibility for strategic decisions"
- The Runway to Commit footnote uses plain financial planning prose

No tooltips, no explainer modals, no "did you know?" banners. Over six months of use, a Ledgr user will understand a corporate cash flow statement without being explicitly taught one.

---

## Deferred to v0.3.0

- Cash flow forecasting with trend extrapolation
- Budget roll-over
- Income stream classification (salary vs dividends) — all income = OCF in v0.2.9
- Saving/naming scenarios
- Export of projection
- Multiple simultaneous what-if comparisons
