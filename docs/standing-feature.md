# The Bearing — Standing Tab Feature Spec
**Version:** 1.0  
**Status:** Approved — PDM + UX + CFP reviewed

---

## Overview

A new fourth tab "Standing" showing "The Bearing" — Ledgr's proprietary financial health index. Displays a score from 0–100 composed of 6 pillars, presented on a shareable old-money styled card with zero monetary amounts visible.

Tab bar: `Dashboard | Net Worth | Statements | Standing`

---

## The Metric: The Bearing (0–100)

Six pillars, equal weight (100/6 ≈ 16.67 pts each). When a pillar has insufficient data it is excluded and remaining pillars renormalize to 100.

---

### Pillar 1 — Discipline (Budget Adherence)

Measures magnitude of overspend relative to total budget, not just count of violated categories.

```
total_budgeted = sum of all category budgets
total_overspend = sum of max(0, actual - budget) for each category
overspend_ratio = total_overspend / total_budgeted
score = pillar_max * max(0, 1 - overspend_ratio)
```

- Uses most recent closed month (or current month if in progress)
- Edge: no budgets set → pillar excluded, prompt shown
- Edge: no spending → full score (in-budget)

---

### Pillar 2 — Ballast (Liability-to-Asset Ratio)

```
L = sum of all liability balances (converted to base currency)
A = sum of all bank + investment balances (converted to base currency)
ratio = A > 0 ? L / A : 2.0

if ratio <= 0.40: score = pillar_max
if ratio >= 2.00: score = 0
else: score = pillar_max * (1 - ((ratio - 0.40) / 1.60))
```

- Clean threshold: 0.40 (CFP-calibrated — 0.10 was too strict, penalized all homeowners)
- Overleveraged threshold: 2.00
- Edge: zero assets → ratio = 2.0 → score = 0, note shown
- Edge: no liabilities → ratio = 0 → score = pillar_max (debt-free = full score)
- UI note: "Mortgage and all debt types are weighted equally. This pillar reflects total leverage, not debt quality."

---

### Pillar 3 — Provision (Savings Goal Progress, Time-Adjusted)

```
for each active goal g:
  raw_progress = clamp(linked_account_balance / g.targetAmount, 0, 1)
    // if no linked account: use 0 as progress (unknown)
  if g.deadline exists:
    time_elapsed = clamp((today - first_tx_date) / (deadline - first_tx_date), 0, 1)
    urgency_weight = 1 + (time_elapsed * 0.5)
  else:
    urgency_weight = 1.0
  goal_score = clamp(raw_progress * urgency_weight, 0, 1)  // clamp BEFORE averaging

pillar_score = pillar_max * mean(goal_score for all active goals)
```

- Each goal_score is clamped to [0, 1] before averaging (CFP fix)
- Edge: no goals → pillar excluded, not penalized
- Edge: goal past deadline → urgency_weight capped at 1.5, raw_progress still counts
- Edge: no linked account → raw_progress = 0 (conservative)

---

### Pillar 4 — Composure (Spending Volatility)

```
monthly_totals = [total expenses per month, last 6 months]
// Only include months with data; minimum 2 months required
mean_spend = mean(monthly_totals)
mean_floor = max(mean_spend, 1)  // prevent CV explosion near zero
stddev = population_stddev(monthly_totals)
cv = stddev / mean_floor

if cv <= 0.12: score = pillar_max        // raised from 0.05 (CFP fix)
if cv >= 0.60: score = 0
else: score = pillar_max * (1 - ((cv - 0.12) / 0.48))
```

- Edge: fewer than 2 months → pillar excluded
- Note: large planned purchases temporarily lower this score — expected behavior

---

### Pillar 5 — Momentum (Net Worth Trend)

```
// Net worth per month = sum(bank balances) + sum(brokerage values) - sum(liability balances)
// Calculated from current data snapshot — Ledgr does not store historical snapshots
// Approximated from transaction history: net worth this month vs derived from 6 months ago

nw_now = current net worth
nw_series = [nw derived at each of last 3-6 months using transaction deltas]

slope = linear_regression_slope(nw_series)
mean_nw = mean(nw_series)
denom = max(abs(mean_nw), 1)  // guard against zero and negative mean (CFP fix)
normalized_slope = slope / denom

if normalized_slope >= +0.03: score = pillar_max
if normalized_slope <= -0.05: score = 0
else: score = pillar_max * ((normalized_slope + 0.05) / 0.08)
```

- Edge: fewer than 2 months → pillar excluded
- Edge: negative mean net worth → denom = abs(mean_nw) → sign preserved correctly

---

### Pillar 6 — Reserve (Emergency Fund Coverage)

```
liquid_assets = sum of bank + ewallet + cash account balances (not investments, not liabilities)
avg_monthly_expenses = mean(total expenses last 3 months, or last available)
months_covered = avg_monthly_expenses > 0 ? liquid_assets / avg_monthly_expenses : 0

// Target: 3 months coverage = full score
score = pillar_max * clamp(months_covered / 3, 0, 1)
```

- Edge: no expense data → pillar excluded
- Edge: zero avg expenses → pillar excluded
- This is the CFP-recommended addition — most universally understood signal

---

## Score Tiers

| Score | Grade | Label |
|---|---|---|
| 85–100 | I | Distinguished |
| 70–84 | II | Established |
| 55–69 | III | Considered |
| 40–54 | IV | Developing |
| 25–39 | V | Nascent |
| 0–24 | VI | Unsettled |

---

## Renormalization (excluded pillars)

When pillar(s) are excluded due to missing data:
```
active_pillars = pillars with sufficient data
pillar_max_each = 100 / active_pillars.length
final_score = sum(pillar_raw_scores) * (100 / sum(pillar_maxes))
```

New user with no data: all pillars excluded → score shown as "—", empty state shown.

---

## Data Storage

Monthly Bearing scores stored in `ledgr-bearing.json`:
```json
{
  "history": { "2026-07": 74, "2026-06": 68 },
  "lastCalculated": "2026-07-17"
}
```
No monetary amounts stored. Score recalculated on tab open, cached per session.

---

## The Shareable Card

### Visual composition

- **Background:** ivory `#C8BFA8` (light) / charcoal `#2C2C2C` (dark)
- **Text:** charcoal (light) / ivory (dark)
- **No monetary amounts anywhere**
- **No display name**
- **No date**

### SVG Seal — The Assay Mark

Centered on the card. viewBox="0 0 80 80", all strokes use currentColor:

- Outer ring: circle r=38, stroke-width=0.75
- Inner ring: circle r=32, stroke-width=0.75
- Octagon: regular 8-gon r=28, rotated 22.5°, stroke-width=0.75
- Cross lines: horizontal + vertical, length=56, stroke-width=0.5
- Diagonal lines: 45°/135°, same length + weight
- Center dot: filled circle r=1.5
- Cardinal diamonds: 4× rotated squares (3×3) at (40±17, 40) and (40, 40±17), filled

### Card layout

```
┌─────────────────────────────────────┐
│  corner                      corner  │
│  ══════════════════════════════════  │
│           L E D G R                  │
│  ────────────────────────────────    │
│                                      │
│         T H E  B E A R I N G        │
│                                      │
│            [ASSAY SEAL]              │
│                                      │
│  ────────────────────────────────    │
│          E S T A B L I S H E D      │
│             C L A S S  I I          │
│                                      │
│           Index  ·  74               │
│                                      │
│  ══════════════════════════════════  │
│  corner                      corner  │
└─────────────────────────────────────┘
```

### Copy Card button

Renders card to offscreen canvas via Canvas API, writes PNG to clipboard. No server call.

---

## Full Tab Page

1. **Card preview** — live, full-width centered
2. **[ Copy Card ]** button — top right
3. **Pillars section** — 6 bars, pillar name, fill bar, tier label (Strong / Moderate / Developing / Insufficient data)
4. **Trend sparkline** — Bearing score over last 6 months, 0–100 axis only
5. **Guidance section** — plain prose for bottom 2 pillars, behavioral not numerical, links to relevant tab

---

## Empty / Insufficient Data State

- Card preview replaced with: "The Bearing is not yet established. Continue recording transactions to receive your first assessment."
- Pillar bars show dashes with "Insufficient data" label
- No score, no grade shown

---

## Files to Create/Modify

| File | Action |
|---|---|
| `src/data/bearing.ts` | New — calculation engine + save/load history |
| `src/ui/StandingView.ts` | New — full tab view |
| `src/ui/charts.ts` | Add renderAssaySeal() SVG function |
| `src/main.ts` | Register StandingView, add command |
| `src/ui/DashboardView.ts` | Add Standing to tab nav |
| `src/ui/NetWorthView.ts` | Add Standing to tab nav |
| `src/ui/StatementsView.ts` | Add Standing to tab nav |
| `styles.css` | Add .ledgr-standing-*, .ledgr-bearing-card-* classes |
