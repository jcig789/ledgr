import { App, Modal, Setting, Notice, Platform } from "obsidian";
import LedgrPlugin from "../main";
import { Account, saveNetWorth, loadNetWorth } from "../data/networth";
import { saveTransaction } from "../data/transactions";
import { formatCurrency } from "../constants/currencies";
import { createDateInput } from "./DatePicker";
import { getDefaultStream } from "../constants/categories";

export class LiabilityPaymentModal extends Modal {
  plugin: LedgrPlugin;
  account: Account;
  date: string;
  amount: number;
  note = "";
  onPaid: () => void;

  constructor(app: App, plugin: LedgrPlugin, account: Account, onPaid: () => void) {
    super(app);
    this.plugin = plugin;
    this.account = account;
    this.date = window.moment().format("YYYY-MM-DD");
    const ld = account.liabilityDetails;
    // For variable-amount liabilities, don't pre-fill — user enters actual amount
    this.amount = (ld?.amountType === "variable") ? 0 : (ld?.monthlyPayment ?? 0);
    this.onPaid = onPaid;
  }

  onOpen() {
    this.render();
    // Enter-to-confirm when amount field has a valid value
    this.contentEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && this.amount > 0) {
        e.preventDefault();
        void this.confirm();
      }
    });
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    const fmt = (n: number) => formatCurrency(n, this.account.currency);
    contentEl.createEl("h2", { text: `Payment — ${this.account.name}` });

    // Balance preview row
    const previewEl = contentEl.createDiv("ledgr-lpay-preview");
    const updatePreview = () => {
      previewEl.empty();
      const remaining = Math.max(0, this.account.balance - this.amount);
      previewEl.createSpan({ text: fmt(this.account.balance), cls: "ledgr-lpay-balance" });
      previewEl.createSpan({ text: " → ", cls: "ledgr-lpay-arrow" });
      previewEl.createSpan({ text: fmt(this.amount || 0), cls: "ledgr-lpay-payment" });
      previewEl.createSpan({ text: " → ", cls: "ledgr-lpay-arrow" });
      previewEl.createSpan({ text: fmt(remaining), cls: "ledgr-lpay-remaining" });
    };
    updatePreview();

    new Setting(contentEl).setName("Amount").addText((t) => {
      t.setValue(String(this.amount)).onChange((v) => {
        this.amount = parseFloat(v) || 0;
        updatePreview();
      });
      t.inputEl.setAttribute("inputmode", "decimal");
      t.inputEl.setAttribute("enterkeyhint", "done");
      if (Platform.isMobile) {
        t.inputEl.addEventListener("focus", () => {
          window.setTimeout(() => t.inputEl.scrollIntoView({ behavior: "smooth", block: "center" }), 300);
        });
      }
    });

    const dateSetting = new Setting(contentEl).setName("Date");
    createDateInput(dateSetting.controlEl, this.date, (v) => (this.date = v));

    new Setting(contentEl).setName("Note").addText((t) =>
      t.setPlaceholder("Optional").setValue(this.note).onChange((v) => (this.note = v))
    );

    contentEl.createEl("p", { cls: "ledgr-error ledgr-error-lpay ledgr-hidden", text: "" });

    new Setting(contentEl).addButton((btn) =>
      btn.setButtonText("Confirm Payment").setCta().onClick(() => { void this.confirm(); })
    );
  }

  async confirm() {
    const errEl = this.contentEl.querySelector<HTMLElement>(".ledgr-error-lpay");
    if (!this.amount || this.amount <= 0) {
      if (errEl) { errEl.textContent = "Enter a valid amount."; errEl.removeClass("ledgr-hidden"); }
      return;
    }

    const data = await loadNetWorth(this.app, this.plugin.settings);
    const acc = data.accounts.find((a) => a.id === this.account.id);
    if (!acc || !acc.liabilityDetails) return;

    // Clamp payment to actual balance — prevents phantom expense when user over-enters
    const actualPayment = Math.min(this.amount, acc.balance > 0 ? acc.balance : this.amount);
    const newBalance = Math.max(0, acc.balance - actualPayment);
    acc.balance = newBalance;
    acc.liabilityDetails.payments.push({
      id: `lpay_${Date.now()}`,
      date: this.date,
      amount: this.amount,
      currency: acc.currency,
      note: this.note || undefined,
      balanceAfter: newBalance,
    });

    await saveNetWorth(this.app, this.plugin.settings, data);

    // Map liability type to expense category.
    // All debt repayments → Other/Loan payment (FCF stream) except mortgage which
    // has its own dedicated subcategory.
    const catMap: Record<string, { cat: string; sub: string }> = {
      mortgage:      { cat: "Housing",  sub: "Mortgage payment" },
      car_loan:      { cat: "Other",    sub: "Loan payment" },
      credit_card:   { cat: "Other",    sub: "Loan payment" },
      personal_loan: { cat: "Other",    sub: "Loan payment" },
      student_loan:  { cat: "Other",    sub: "Loan payment" },
      installment:   { cat: "Other",    sub: "Loan payment" },
      other:         { cat: "Other",    sub: "Loan payment" },
    };
    const { cat, sub } = catMap[acc.type] ?? { cat: "Other", sub: "Other" };

    await saveTransaction(this.app, this.plugin.settings, {
      date: this.date,
      type: "expense",
      amount: actualPayment,
      currency: acc.currency,
      category: cat,
      subcategory: sub,
      note: this.note || `Loan payment — ${acc.name}`,
      stream: getDefaultStream(sub),  // "Loan payment" → "fcf", "Mortgage payment" → "fcf"
    });

    new Notice(`Payment logged: ${formatCurrency(this.amount, acc.currency)} — ${acc.name}`);
    this.app.workspace.trigger("ledgr:transaction-saved");
    this.app.workspace.trigger("ledgr:networth-updated");
    this.onPaid();

    // Closure prompt when balance reaches zero (float-safe check)
    if (Math.round(newBalance * 100) === 0) {
      this.renderClosurePrompt(acc, data);
    } else {
      this.close();
    }
  }

  renderClosurePrompt(acc: Account, data: import("../data/networth").NetWorthData) {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: `${acc.name} — Paid Off` });
    contentEl.createEl("p", { text: "Balance is now zero. Archive this liability?", cls: "ledgr-meta" });
    contentEl.createEl("p", { text: "Archived liabilities are hidden from your active view and Payments Due card.", cls: "ledgr-empty" });

    const btnRow = contentEl.createDiv("ledgr-btn-row");
    const archiveBtn = btnRow.createEl("button", { text: "Archive", cls: "ledgr-log-btn mod-cta" });
    archiveBtn.onclick = async () => {
      if (!acc.liabilityDetails) return;
      acc.liabilityDetails.closedAt = window.moment().format("YYYY-MM-DD");
      await saveNetWorth(this.app, this.plugin.settings, data);
      this.app.workspace.trigger("ledgr:networth-updated");
      this.close();
    };
    const keepBtn = btnRow.createEl("button", { text: "Dismiss", cls: "ledgr-budget-btn" });
    keepBtn.onclick = () => this.close();
  }

  onClose() { this.contentEl.empty(); }
}
