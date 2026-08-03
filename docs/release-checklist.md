# Ledgr Release Checklist

Run before every release. All items must be checked.

---

## 1. Pre-Push Script

```bash
bash scripts/pre-push-check.sh
```

Must report zero errors. Warnings should be reviewed.

---

## 2. Obsidian API Compliance

- [ ] No `document.createElement` — use `el.createEl()`
- [ ] No `createEl("div")` / `createEl("span")` — use `createDiv()` / `createSpan()`
- [ ] No `el.type = "x"` after creation — use `createEl("input", { attr: { type: "x" } })`
- [ ] No `el.style.x = value` — use `el.setCssStyles({ x: value })`
- [ ] No `window.prompt()` — use inline input or Modal
- [ ] No `eslint-disable` comments
- [ ] No `!important` in CSS — use higher specificity selectors
- [ ] `addDropdown` callbacks have `: void` return type with `void` on last chained call
- [ ] `addButton onClick` callbacks use `() => { void asyncFn(); }` not `async () => { await asyncFn(); }`
- [ ] No hardcoded hex colors in TypeScript — use CSS variables

---

## 3. Design System

- [ ] All section headers use `ledgr-section-header` wrapper with `createEl("h3")`
- [ ] Positive/income amounts use `ledgr-positive` or `ledgr-income` class
- [ ] Negative/expense amounts use `ledgr-negative` or `ledgr-expense` class
- [ ] No hardcoded hex colors in TypeScript (check `StandingView.ts` canvas render)
- [ ] All five views have the same 5-tab nav: Dashboard | Net Worth | Statements | Standing | Calendar
- [ ] Month navigation follows the same `ledgr-month-row` pattern across all views
- [ ] Empty states have a CTA button, not just text

---

## 4. Data Integrity

- [ ] `convertToBase()` fallback behavior is acceptable for missing rates (silent return, rate banner covers it)
- [ ] `parseFloat()` results are guarded with `|| 0` or `isNaN` checks
- [ ] New `LiabilityDetails` fields have null guards on legacy records (use `?.` or `?? []`)
- [ ] `BearingHistory` handles both legacy `number` and new `BearingMonthRecord` format
- [ ] Net worth snapshot uses `baseCurrency` not `viewCurrency`

---

## 5. Settings Integrity

- [ ] Every new `LedgrSettings` field has a default in `DEFAULT_SETTINGS`
- [ ] Settings mutations call `await plugin.saveSettings()` (not just mutate in memory)
- [ ] New fields that change scoring/calculation behavior have a migration note in journal

---

## 6. Event Consistency

- [ ] Every `workspace.trigger("ledgr:X")` has at least one `workspace.on("ledgr:X")` listener
- [ ] Current event map:
  - `ledgr:transaction-saved` → Dashboard, StandingView, CalendarView, main.ts
  - `ledgr:networth-updated` → Dashboard, NetWorthView, StandingView, CalendarView, main.ts
  - `ledgr:settings-changed` → Dashboard, NetWorthView, StatementsView
  - `ledgr:focus-section` → NetWorthView
  - `ledgr:categories-updated` → **⚠ fired but no listener** (Dashboard/Calendar/Statements don't refresh)

---

## 7. Known Deferred Issues (do not fix without planning)

These are documented bugs that are deferred — do not accidentally close them without a spec:

| Issue | Risk | Deferred until |
|---|---|---|
| `ledgr:categories-updated` has no listener | Dashboard/Calendar don't refresh after category edit | v0.3.2 |
| Goal delete in NetWorthView has no confirmation | Permanent immediate delete | v0.3.2 |
| Remove account/brokerage has no confirmation | Deferred until Save, but UX inconsistent | v0.3.2 |
| `forecastHorizon` UI selection not persisted to settings | Resets on view close | v0.3.2 |
| Wrapped/MonthlyReview goal progress ignores `linkedAccountId` | Shows wrong % in generated reports | v0.3.2 |
| `liabilityDetails.payments.push()` crashes on pre-payments legacy records | TypeError on upgrade | v0.3.2 patch |
| `configModal` currency mutations can be carried by unrelated save | Silent cross-contamination | v0.3.2 |

---

## 8. Mobile

- [ ] Test Quick Capture modal on mobile — amount field shows numeric keyboard
- [ ] Test paying a liability on mobile — Save button visible with keyboard open
- [ ] Test calendar tap on mobile — detail panel slides up correctly

---

## 9. Release Steps

1. `bash scripts/pre-push-check.sh` — must pass
2. Bump `manifest.json` version
3. Add version to `versions.json`
4. `node esbuild.config.mjs production`
5. `git add -A && git commit -m "chore: bump to vX.Y.Z"`
6. `git tag X.Y.Z`
7. Push main + tag
8. Create GitHub release via curl (see journal for token process)
9. Update `sanvault/Public/Projects/ledgr.md` and `sanvault/Private/Finance/journal.md`
