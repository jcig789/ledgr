import { App, Modal, Notice } from "obsidian";
import LedgrPlugin from "../main";
import { loadNetWorth, saveNetWorth, AccountType } from "../data/networth";
import { loadBills, saveBills, RecurringBill, AmountType } from "../data/bills";
import { LIABILITY_TYPES } from "../data/liabilities";

type ObligationType = "bill" | "liability";

// Quick-select categories covering common real-world bills
const BILL_CATEGORIES: { label: string; category: string; subcategory: string }[] = [
  { label: "Rent",           category: "Housing",       subcategory: "Rent" },
  { label: "Utilities",      category: "Housing",       subcategory: "Utilities" },
  { label: "Mobile / Internet", category: "Housing",    subcategory: "Internet" },
  { label: "Subscriptions",  category: "Subscriptions", subcategory: "Other subscription" },
  { label: "Transport",      category: "Transport",     subcategory: "Other" },
  { label: "Insurance",      category: "Health",        subcategory: "Other" },
  { label: "Other",          category: "Other",         subcategory: "Other" },
];

interface ObligationRow {
  name: string;
  amount: string;       // string so "Varies" is valid
  dueDay: string;       // string so "2nd Wednesday" is valid raw input
  type: ObligationType;
  liabType: string;     // key from LIABILITY_TYPES, used when type === "liability"
  categoryIdx: number;  // index into BILL_CATEGORIES
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ORDINAL_LABELS: Record<string, number> = {
  "1st": 1, "2nd": 2, "3rd": 3, "4th": 4, "last": -1,
  "first": 1, "second": 2, "third": 3, "fourth": 4,
};

// Parse "2nd Wednesday" → { nth: 2, weekday: 3 } or number → day of month
function parseDueDay(raw: string): { type: "day_of_month"; day: number } | { type: "nth_weekday"; nth: number; weekday: number } | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;

  // Nth weekday: "2nd wednesday", "3rd wed", "last friday"
  for (const [ord, nth] of Object.entries(ORDINAL_LABELS)) {
    for (let wd = 0; wd < 7; wd++) {
      const wdName = WEEKDAY_NAMES[wd].toLowerCase();
      const wdShort = wdName.slice(0, 3);
      if (s.includes(ord) && (s.includes(wdName) || s.includes(wdShort))) {
        return { type: "nth_weekday", nth, weekday: wd };
      }
    }
  }

  // Plain day number
  const n = parseInt(s);
  if (!isNaN(n) && n >= 1 && n <= 31) {
    return { type: "day_of_month", day: n };
  }

  return null;
}

export class BulkObligationsModal extends Modal {
  plugin: LedgrPlugin;
  rows: ObligationRow[] = [];
  onComplete: () => void;

  constructor(app: App, plugin: LedgrPlugin, onComplete: () => void) {
    super(app);
    this.plugin = plugin;
    this.onComplete = onComplete;
    // Start with 1 blank row — user adds more via Tab or + Add row
    this.rows = [this.blankRow()];
  }

  blankRow(): ObligationRow {
    return { name: "", amount: "", dueDay: "", type: "bill", liabType: "personal_loan", categoryIdx: 0 };
  }

  onOpen() { this.render(); }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ledgr-bulk-obligations");

    contentEl.createEl("h2", { text: "Set Up Monthly Obligations" });
    contentEl.createEl("p", {
      text: "Enter your bills, loans, and recurring payments. Use \"Varies\" for credit cards. For weekday schedules, type e.g. \"2nd Wednesday\".",
      cls: "ledgr-onboarding-sub",
    });

    // Column headers
    const headerRow = contentEl.createDiv("ledgr-bulk-header-row");
    // Column 4: "Category" for bills, liability sub-type for liabilities — label covers both
    ["Name", "Amount", "Due", "Category / Sub-type", "Type", ""].forEach((h) => {
      headerRow.createSpan({ text: h, cls: "ledgr-bulk-col-header" });
    });

    // Entry rows
    const rowsContainer = contentEl.createDiv("ledgr-bulk-rows");
    this.rows.forEach((row, idx) => this.renderRow(rowsContainer, row, idx));

    // Add row button
    const addRowBtn = contentEl.createEl("button", { text: "+ Add row", cls: "ledgr-budget-btn ledgr-bulk-add-row" });
    addRowBtn.onclick = () => {
      this.rows.push(this.blankRow());
      this.render();
    };

    // Help text
    const helpEl = contentEl.createEl("p", { cls: "ledgr-bulk-help" });
    helpEl.createSpan({ text: "Bill = subscription or utility (no running balance). " });
    helpEl.createSpan({ text: "Liability = loan or credit card (has a balance to pay down)." });

    // Split installment note
    contentEl.createEl("p", {
      text: "For payments split across multiple dates in the same month (e.g. paid twice), add a separate row for each date.",
      cls: "ledgr-bulk-help",
    });

    contentEl.createDiv("ledgr-bearing-rule-thin");

    // Add All button
    const addAllBtn = contentEl.createEl("button", {
      text: `Add All (${this.rows.filter((r) => r.name.trim()).length})`,
      cls: "ledgr-log-btn mod-cta",
    });
    addAllBtn.onclick = () => { void this.saveAll(); };

    const cancelBtn = contentEl.createEl("button", { text: "Cancel", cls: "ledgr-budget-btn" });
    cancelBtn.onclick = () => this.close();
  }

  renderRow(parent: HTMLElement, row: ObligationRow, idx: number) {
    const rowEl = parent.createDiv("ledgr-bulk-row");

    // Name
    const nameInput = rowEl.createEl("input", {
      attr: { type: "text", placeholder: "e.g. Netflix", class: "ledgr-inline-input ledgr-bulk-name" },
    }) as HTMLInputElement;
    nameInput.value = row.name;
    nameInput.oninput = () => { row.name = nameInput.value; this.updateAddAllCount(); };
    nameInput.onkeydown = (e) => { if (e.key === "Tab" && idx === this.rows.length - 1) { e.preventDefault(); this.rows.push(this.blankRow()); this.render(); } };

    // Amount
    const amtInput = rowEl.createEl("input", {
      attr: { type: "text", placeholder: "e.g. 700 or Varies", class: "ledgr-inline-input ledgr-bulk-amount" },
    }) as HTMLInputElement;
    amtInput.value = row.amount;
    amtInput.oninput = () => { row.amount = amtInput.value; };

    // Due day
    const dueInput = rowEl.createEl("input", {
      attr: { type: "text", placeholder: "e.g. 15 or 2nd Wed", class: "ledgr-inline-input ledgr-bulk-due" },
    }) as HTMLInputElement;
    dueInput.value = row.dueDay;
    dueInput.oninput = () => { row.dueDay = dueInput.value; };

    // Category (only shown for bills)
    const catSelect = rowEl.createEl("select", { cls: "ledgr-inline-input ledgr-bulk-cat" });
    BILL_CATEGORIES.forEach((c, i) => {
      const opt = catSelect.createEl("option");
      opt.value = String(i); opt.textContent = c.label;
      if (i === row.categoryIdx) opt.selected = true;
    });
    catSelect.onchange = () => { row.categoryIdx = parseInt(catSelect.value); };
    // Hide category select for liability rows — column 4 slot stays in layout
    if (row.type === "liability") catSelect.setCssStyles({ display: "none" });

    // Liability sub-type select inserted here (col 4, DOM position 4) BEFORE the type toggle
    // so CSS grid auto-placement puts it in col 4, toggle in col 5, remove in col 6 — no implicit row
    if (row.type === "liability") {
      const liabTypeSelect = rowEl.createEl("select", { cls: "ledgr-inline-input ledgr-bulk-liab-type" });
      LIABILITY_TYPES.forEach(({ key, label }) => {
        const opt = liabTypeSelect.createEl("option");
        opt.value = key; opt.textContent = label;
        if (key === row.liabType) opt.selected = true;
      });
      liabTypeSelect.onchange = () => { row.liabType = liabTypeSelect.value; };
    }

    // Type toggle: Bill | Liability — segmented selector (col 5)
    const typeToggle = rowEl.createDiv("ledgr-bulk-type-toggle ledgr-toggle-group ledgr-toggle-group--compact");
    const billBtn = typeToggle.createEl("button", {
      text: "Bill",
      cls: `ledgr-budget-btn ledgr-toggle-btn${row.type === "bill" ? " active" : ""}`,
    });
    const liabBtn = typeToggle.createEl("button", {
      text: "Liability",
      cls: `ledgr-budget-btn ledgr-toggle-btn${row.type === "liability" ? " active" : ""}`,
    });
    billBtn.onclick = () => { row.type = "bill"; this.render(); };
    liabBtn.onclick = () => { row.type = "liability"; this.render(); };

    // Remove row (col 6 — auto)
    const removeBtn = rowEl.createEl("button", { text: "✕", cls: "ledgr-del-btn ledgr-bulk-remove" });
    removeBtn.onclick = () => { this.rows.splice(idx, 1); this.render(); };
  }

  updateAddAllCount() {
    const btn = this.contentEl.querySelector<HTMLButtonElement>(".ledgr-log-btn.mod-cta");
    if (btn) btn.textContent = `Add All (${this.rows.filter((r) => r.name.trim()).length})`;
  }

  async saveAll() {
    const validRows = this.rows.filter((r) => r.name.trim());
    if (validRows.length === 0) {
      new Notice("No items to add — enter at least one name.");
      return;
    }

    const nwData = await loadNetWorth(this.app, this.plugin.settings);
    const billStore = await loadBills(this.app, this.plugin.settings);
    const currency = this.plugin.settings.baseCurrency;
    let added = 0;

    for (const row of validRows) {
      const isVariableRaw = row.amount.trim().toLowerCase() === "varies" || row.amount.trim() === "";
      const amountNum = isVariableRaw ? 0 : (parseFloat(row.amount) || 0);
      const amountType: AmountType = isVariableRaw ? "variable" : "fixed";
      const dueParsed = parseDueDay(row.dueDay);

      if (row.type === "bill") {
        const cat = BILL_CATEGORIES[row.categoryIdx] ?? BILL_CATEGORIES[BILL_CATEGORIES.length - 1];
        const bill: RecurringBill = {
          id: `bill_${Date.now()}_${added}`,
          name: row.name.trim(),
          amount: amountNum,
          amountType,
          currency,
          category: cat.category,
          subcategory: cat.subcategory,
          dueDateType: dueParsed?.type ?? "day_of_month",
          dueDay: dueParsed?.type === "day_of_month" ? dueParsed.day : undefined,
          dueWeekOrdinal: dueParsed?.type === "nth_weekday" ? dueParsed.nth : undefined,
          dueWeekday: dueParsed?.type === "nth_weekday" ? dueParsed.weekday : undefined,
          reminderEnabled: true,
          reminderDaysAhead: 3,
          payments: [],
        };
        billStore.bills.push(bill);
      } else {
        // Liability
        nwData.accounts.push({
          id: `lia_${Date.now()}_${added}`,
          name: row.name.trim(),
          type: (row.liabType as AccountType) ?? "personal_loan",
          currency,
          balance: 0,
          country: "JP",
          isLiability: true,
          liabilityDetails: {
            originalAmount: 0,
            monthlyPayment: amountNum,
            amountType,
            paymentDueDay: dueParsed?.type === "day_of_month" ? dueParsed.day : 1,
            dueDateType: dueParsed?.type ?? "day_of_month",
            dueWeekOrdinal: dueParsed?.type === "nth_weekday" ? dueParsed.nth : undefined,
            dueWeekday: dueParsed?.type === "nth_weekday" ? dueParsed.weekday : undefined,
            reminderEnabled: true,
            reminderDaysAhead: 3,
            payments: [],
          },
        });
      }
      added++;
    }

    await saveBills(this.app, this.plugin.settings, billStore);
    await saveNetWorth(this.app, this.plugin.settings, nwData);

    this.app.workspace.trigger("ledgr:networth-updated");

    // Warn if any bill has a due date that already passed this month
    const today = window.moment();
    const currentMonth = today.format("YYYY-MM");
    const overdueNames = validRows
      .filter((r) => r.type === "bill")
      .filter((r) => {
        const parsed = parseDueDay(r.dueDay);
        if (!parsed || parsed.type !== "day_of_month") return false;
        const dueDate = window.moment(`${currentMonth}-${String(parsed.day).padStart(2, "0")}`);
        return dueDate.isValid() && dueDate.isBefore(today, "day");
      })
      .map((r) => r.name.trim());
    if (overdueNames.length > 0) {
      new Notice(`Note: ${overdueNames.join(", ")} due date has already passed this month and will show as overdue.`);
    }

    const liabilityCount = validRows.filter((r) => r.type === "liability").length;
    const billCount = validRows.filter((r) => r.type === "bill").length;
    const parts = [];
    if (liabilityCount > 0) parts.push(`${liabilityCount} liabilit${liabilityCount !== 1 ? "ies" : "y"}`);
    if (billCount > 0) parts.push(`${billCount} bill${billCount !== 1 ? "s" : ""}`);
    new Notice(`Added ${parts.join(" and ")}. ${liabilityCount > 0 ? "Go to Net Worth to set balances for your liabilities." : ""}`);
    this.close();
    this.onComplete();
  }

  onClose() { this.contentEl.empty(); }
}
