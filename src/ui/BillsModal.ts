import { App, Modal, Notice } from "obsidian";
import LedgrPlugin from "../main";
import { loadBills, saveBills, RecurringBill, resolveBillDueDay } from "../data/bills";
import { loadNetWorth } from "../data/networth";
import { LIABILITY_TYPES } from "../data/liabilities";
import { formatCurrency } from "../constants/currencies";
import { BulkObligationsModal } from "./BulkObligationsModal";

export class BillsModal extends Modal {
  plugin: LedgrPlugin;
  private billStore: { bills: RecurringBill[] } = { bills: [] };

  constructor(app: App, plugin: LedgrPlugin) {
    super(app);
    this.plugin = plugin;
  }

  async onOpen() {
    this.billStore = await loadBills(this.app, this.plugin.settings);
    this.render();
  }

  async render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ledgr-config-modal");

    contentEl.createEl("h2", { text: "Monthly Obligations" });
    contentEl.createEl("p", {
      text: "Bills and recurring payments you track each month. Liabilities (loans, credit cards) are managed in Net Worth.",
      cls: "setting-item-description",
    });

    const currentMonth = window.moment().format("YYYY-MM");

    // ── Recurring Bills ──────────────────────────────────────────────────────
    const billHdr = contentEl.createDiv("ledgr-section-header");
    billHdr.createEl("h3", { text: "Recurring Bills" });

    const activeBills = this.billStore.bills.filter((b) => !b.closedAt);
    const archivedBills = this.billStore.bills.filter((b) => b.closedAt);

    if (activeBills.length === 0) {
      contentEl.createEl("p", {
        text: "No bills yet. Add subscriptions, utilities, and fixed monthly bills.",
        cls: "ledgr-empty-state",
      });
    } else {
      const table = contentEl.createEl("table", { cls: "ledgr-tx-table" });
      const hrow = table.createEl("thead").createEl("tr");
      ["Name", "Amount", "Due", ""].forEach((h) => hrow.createEl("th", { text: h }));
      const tbody = table.createEl("tbody");

      activeBills.forEach((bill) => {
        const tr = tbody.createEl("tr");
        const nameCell = tr.createEl("td");
        nameCell.createDiv({ text: bill.name });
        nameCell.createDiv({ text: `${bill.category} / ${bill.subcategory}`, cls: "ledgr-tx-subcat" });

        const amtText = bill.amountType === "variable"
          ? "Varies"
          : bill.amountMax
            ? `${formatCurrency(bill.amount, bill.currency)}–${formatCurrency(bill.amountMax, bill.currency)}`
            : formatCurrency(bill.amount, bill.currency);
        tr.createEl("td", { text: amtText, cls: "ledgr-text-right" });

        const dueDay = resolveBillDueDay(bill, currentMonth);
        const dueText = dueDay !== null
          ? window.moment(`${currentMonth}-${String(dueDay).padStart(2, "0")}`).format("MMM D")
          : "—";
        tr.createEl("td", { text: dueText, cls: "ledgr-liability-due" });

        const actionTd = tr.createEl("td", { cls: "ledgr-tx-actions" });

        // Edit button — opens inline edit row
        const editBtn = actionTd.createEl("button", { text: "Edit", cls: "ledgr-budget-btn" });
        editBtn.onclick = () => this.renderInlineEditRow(tr, bill);

        const archiveBtn = actionTd.createEl("button", { text: "Archive", cls: "ledgr-remove-btn" });
        archiveBtn.onclick = async () => {
          const fresh = await loadBills(this.app, this.plugin.settings);
          const b = fresh.bills.find((x) => x.id === bill.id);
          if (b) b.closedAt = window.moment().format("YYYY-MM-DD");
          await saveBills(this.app, this.plugin.settings, fresh);
          this.app.workspace.trigger("ledgr:networth-updated");
          this.billStore = fresh;
          void this.render();
          new Notice(`"${bill.name}" archived`);
        };
      });
    }

    // Add bill button
    const addBillBtn = contentEl.createEl("button", { text: "+ Add Bill", cls: "ledgr-log-btn mod-cta" });
    addBillBtn.setCssStyles({ marginTop: "var(--ledgr-spacing-md)" });
    addBillBtn.onclick = () => {
      this.close();
      new BulkObligationsModal(this.app, this.plugin, async () => {
        this.billStore = await loadBills(this.app, this.plugin.settings);
        this.open();
      }).open();
    };

    // Archived bills
    if (archivedBills.length > 0) {
      let showArchived = false;
      const toggleLink = contentEl.createEl("a", {
        text: `Show archived (${archivedBills.length})`,
        cls: "ledgr-bearing-guidance-link",
      });
      toggleLink.setCssStyles({ display: "block", marginTop: "var(--ledgr-spacing-sm)" });
      const archivedSection = contentEl.createDiv("ledgr-hidden");
      archivedBills.forEach((bill) => {
        const row = archivedSection.createDiv("ledgr-scheduled-row ledgr-scheduled-paid");
        row.createSpan({ text: bill.name, cls: "ledgr-scheduled-name ledgr-text-faint" });
        row.createSpan({ text: `Archived ${bill.closedAt ?? ""}`, cls: "ledgr-scheduled-due ledgr-text-faint" });
        const restoreBtn = row.createEl("button", { text: "Restore", cls: "ledgr-budget-btn" });
        restoreBtn.onclick = async () => {
          const fresh = await loadBills(this.app, this.plugin.settings);
          const b = fresh.bills.find((x) => x.id === bill.id);
          if (b) delete b.closedAt;
          await saveBills(this.app, this.plugin.settings, fresh);
          this.billStore = fresh;
          void this.render();
        };
      });
      toggleLink.onclick = () => {
        showArchived = !showArchived;
        archivedSection.toggleClass("ledgr-hidden", !showArchived);
        toggleLink.textContent = showArchived
          ? `Hide archived (${archivedBills.length})`
          : `Show archived (${archivedBills.length})`;
      };
    }

    // ── Liabilities summary (read-only, link to Net Worth) ───────────────────
    contentEl.createDiv("ledgr-bearing-rule-thin").setCssStyles({ margin: "var(--ledgr-spacing-md) 0" });

    const liabHdr = contentEl.createDiv("ledgr-section-header");
    liabHdr.createEl("h3", { text: "Liabilities" });

    try {
      const nwData = await loadNetWorth(this.app, this.plugin.settings);
      const activeLiabs = nwData.accounts.filter((a) => a.isLiability && !a.liabilityDetails?.closedAt);

      if (activeLiabs.length === 0) {
        contentEl.createEl("p", { text: "No liabilities tracked.", cls: "ledgr-empty-state" });
      } else {
        const tableWrap = contentEl.createDiv("ledgr-tx-table-wrap");
        const liabTable = tableWrap.createEl("table", { cls: "ledgr-tx-table" });
        const lhrow = liabTable.createEl("thead").createEl("tr");
        ["Name", "Type", "Balance", "Monthly"].forEach((h) => lhrow.createEl("th", { text: h }));
        const ltbody = liabTable.createEl("tbody");
        activeLiabs.forEach((acc) => {
          const tr = ltbody.createEl("tr");
          tr.createEl("td", { text: acc.name });
          const typeLabel = LIABILITY_TYPES.find((t) => t.key === acc.type)?.label ?? acc.type;
          tr.createEl("td", { text: typeLabel, cls: "ledgr-empty" });
          const balCell = tr.createEl("td", { cls: "ledgr-text-right" });
          if (acc.balance === 0) {
            balCell.createSpan({ text: "¥0", cls: "ledgr-text-secondary" });
            balCell.createEl("a", { text: " set →", cls: "ledgr-bearing-guidance-link" }).onclick = () => {
              this.close(); void this.plugin.openView("ledgr-networth");
            };
          } else {
            balCell.createSpan({ text: formatCurrency(acc.balance, acc.currency), cls: "ledgr-expense" });
          }
          const ld = acc.liabilityDetails;
          const monthlyText = ld?.amountType === "variable"
            ? "Varies"
            : ld?.monthlyPayment
              ? formatCurrency(ld.monthlyPayment, acc.currency) + " / mo"
              : "—";
          tr.createEl("td", { text: monthlyText, cls: "ledgr-liability-monthly" });
        });
      }
    } catch { /* no networth data */ }

    const nwLink = contentEl.createEl("a", {
      text: "Manage liabilities in Net Worth →",
      cls: "ledgr-bearing-guidance-link",
    });
    nwLink.setCssStyles({ display: "block", marginTop: "var(--ledgr-spacing-sm)" });
    nwLink.onclick = () => {
      this.close();
      void this.plugin.openView("ledgr-networth");
    };
  }

  renderInlineEditRow(originalRow: HTMLElement, bill: RecurringBill) {
    // Replace the table row with an inline edit form, restore on cancel
    const editRow = originalRow.createEl("tr", { cls: "ledgr-bill-edit-row" });
    originalRow.replaceWith(editRow);

    const cell = editRow.createEl("td", { attr: { colspan: "4" } });
    cell.setCssStyles({ padding: "var(--ledgr-spacing-sm)" });

    const form = cell.createDiv("ledgr-edit-card");
    form.setCssStyles({ margin: "0" });

    // Name
    const nameRow = form.createDiv("ledgr-edit-card-row");
    nameRow.createSpan({ text: "Name", cls: "ledgr-meta" });
    const nameInput = nameRow.createEl("input", { attr: { type: "text", class: "ledgr-inline-input" } }) as HTMLInputElement;
    nameInput.value = bill.name;

    // Amount
    const amtRow = form.createDiv("ledgr-edit-card-row");
    amtRow.createSpan({ text: "Amount", cls: "ledgr-meta" });
    const amtInput = amtRow.createEl("input", {
      attr: { type: "text", placeholder: "e.g. 700 or Varies", class: "ledgr-inline-input" },
    }) as HTMLInputElement;
    amtInput.value = bill.amountType === "variable" ? "Varies" : String(bill.amount);

    // Due day
    const dueRow = form.createDiv("ledgr-edit-card-row");
    dueRow.createSpan({ text: "Due day", cls: "ledgr-meta" });
    const dueInput = dueRow.createEl("input", {
      attr: { type: "text", placeholder: "e.g. 15 or 2nd Wed", class: "ledgr-inline-input" },
    }) as HTMLInputElement;
    dueInput.value = bill.dueDay ? String(bill.dueDay) : "";

    // Buttons
    const btnRow = form.createDiv("ledgr-btn-row");
    const saveBtn = btnRow.createEl("button", { text: "Save", cls: "ledgr-log-btn mod-cta" });
    const cancelBtn = btnRow.createEl("button", { text: "Cancel", cls: "ledgr-budget-btn" });

    saveBtn.onclick = async () => {
      const fresh = await loadBills(this.app, this.plugin.settings);
      const b = fresh.bills.find((x) => x.id === bill.id);
      if (!b) return;
      b.name = nameInput.value.trim() || b.name;
      const isVariables = amtInput.value.trim().toLowerCase() === "varies" || amtInput.value.trim() === "";
      if (isVariables) {
        b.amountType = "variable"; b.amount = 0;
      } else {
        b.amountType = "fixed"; b.amount = parseFloat(amtInput.value) || b.amount;
      }
      if (dueInput.value.trim()) {
        const n = parseInt(dueInput.value.trim());
        if (!isNaN(n) && n >= 1 && n <= 31) { b.dueDateType = "day_of_month"; b.dueDay = n; }
      }
      await saveBills(this.app, this.plugin.settings, fresh);
      this.app.workspace.trigger("ledgr:networth-updated");
      this.billStore = fresh;
      new Notice(`"${b.name}" updated`);
      void this.render();
    };

    cancelBtn.onclick = () => void this.render();
  }

  onClose() { this.contentEl.empty(); }
}
