import { App, Modal, Setting, Notice, Platform } from "obsidian";
import LedgrPlugin from "../main";
import { RecurringBill, loadBills, saveBills } from "../data/bills";
import { saveTransaction } from "../data/transactions";
import { formatCurrency } from "../constants/currencies";
import { createDateInput } from "./DatePicker";
import { getDefaultStream } from "../constants/categories";

export class BillPaymentModal extends Modal {
  plugin: LedgrPlugin;
  bill: RecurringBill;
  date: string;
  amount: number;
  note = "";
  onPaid: () => void;
  private _confirmedDuplicateKey = "";

  constructor(app: App, plugin: LedgrPlugin, bill: RecurringBill, onPaid: () => void) {
    super(app);
    this.plugin = plugin;
    this.bill = bill;
    this.date = window.moment().format("YYYY-MM-DD");
    // Pre-fill fixed/estimated amounts; leave 0 for variable so user enters actual
    this.amount = (bill.amountType === "variable") ? 0 : bill.amount;
    this.onPaid = onPaid;
  }

  onOpen() { this.render(); }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ledgr-quick-capture");
    contentEl.createEl("h2", { text: `Log Payment — ${this.bill.name}` });

    if (this.bill.amountType !== "variable" && this.bill.amount > 0) {
      const hint = contentEl.createEl("p", { cls: "ledgr-meta" });
      hint.textContent = `Usual amount: ${formatCurrency(this.bill.amount, this.bill.currency)}`;
    }

    new Setting(contentEl).setName("Amount").addText((t) => {
      t.setValue(this.amount > 0 ? String(this.amount) : "")
       .setPlaceholder("Enter amount")
       .onChange((v) => { this.amount = parseFloat(v) || 0; });
      t.inputEl.setAttribute("inputmode", "decimal");
      t.inputEl.setAttribute("enterkeyhint", "done");
      if (Platform.isMobile) {
        t.inputEl.addEventListener("focus", () => {
          window.setTimeout(() => t.inputEl.scrollIntoView({ behavior: "smooth", block: "center" }), 300);
        });
      }
    });

    const dateSetting = new Setting(contentEl).setName("Date");
    createDateInput(dateSetting.controlEl, this.date, (v) => { this.date = v; this._confirmedDuplicateKey = ""; });

    new Setting(contentEl).setName("Note").addText((t) =>
      t.setPlaceholder("Optional").setValue(this.note).onChange((v) => (this.note = v))
    );

    contentEl.createEl("p", { cls: "ledgr-error ledgr-error-billpay ledgr-hidden", text: "" });

    new Setting(contentEl).addButton((btn) =>
      btn.setButtonText("Record").setCta().onClick(() => { void this.confirm(); })
    );
  }

  async confirm() {
    const errEl = this.contentEl.querySelector<HTMLElement>(".ledgr-error-billpay");
    if (!this.amount || this.amount <= 0) {
      if (errEl) { errEl.textContent = "Enter a valid amount."; errEl.removeClass("ledgr-hidden"); }
      return;
    }

    const store = await loadBills(this.app, this.plugin.settings);
    const bill = store.bills.find((b) => b.id === this.bill.id);
    if (!bill) return;

    // Dedup guard — warn if a payment was already logged this month for this bill
    const month = this.date.slice(0, 7);
    const dupeKey = `${this.bill.id}:${month}`;
    const existingPayment = bill.payments.filter((p) => p.date.startsWith(month));
    if (existingPayment.length > 0) {
      if (this._confirmedDuplicateKey !== dupeKey) {
        // First tap — show warning, require a second tap to confirm
        this._confirmedDuplicateKey = dupeKey;
        const paidAmt = existingPayment.reduce((s, p) => s + p.amount, 0);
        if (errEl) {
          errEl.textContent = `${formatCurrency(paidAmt, bill.currency)} already logged for ${window.moment(month).format("MMMM YYYY")}. Tap Record again to add a second payment.`;
          errEl.removeClass("ledgr-hidden");
        }
        return;
      }
      // Second tap — proceed; clear error before saving
      this._confirmedDuplicateKey = "";
      if (errEl) errEl.addClass("ledgr-hidden");
    }

    bill.payments.push({
      id: `bpay_${Date.now()}`,
      date: this.date,
      amount: this.amount,
      currency: bill.currency,
      note: this.note || undefined,
    });

    await saveBills(this.app, this.plugin.settings, store);

    // Also log as a transaction so it appears in the ledger and affects cash flow
    await saveTransaction(this.app, this.plugin.settings, {
      date: this.date,
      type: "expense",
      amount: this.amount,
      currency: bill.currency,
      category: bill.category,
      subcategory: bill.subcategory,
      note: this.note || bill.name,
      stream: getDefaultStream(bill.subcategory),  // e.g. "Other subscription" → "ocf"
    });

    new Notice(`Payment recorded: ${formatCurrency(this.amount, bill.currency)} — ${bill.name}`);
    this.app.workspace.trigger("ledgr:transaction-saved");
    this.close();
    this.onPaid();
  }

  onClose() { this.contentEl.empty(); }
}
