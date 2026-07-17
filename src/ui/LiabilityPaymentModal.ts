import { App, Modal, Setting, Notice } from "obsidian";
import LedgrPlugin from "../main";
import { Account, saveNetWorth, loadNetWorth } from "../data/networth";
import { saveTransaction } from "../data/transactions";
import { formatCurrency } from "../constants/currencies";

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
    this.amount = account.liabilityDetails?.monthlyPayment ?? 0;
    this.onPaid = onPaid;
  }

  onOpen() { this.render(); }

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

    new Setting(contentEl).setName("Amount").addText((t) =>
      t.setValue(String(this.amount)).onChange((v) => {
        this.amount = parseFloat(v) || 0;
        updatePreview();
      })
    );

    new Setting(contentEl).setName("Date").addText((t) =>
      t.setValue(this.date).onChange((v) => (this.date = v))
    );

    new Setting(contentEl).setName("Note").addText((t) =>
      t.setPlaceholder("Optional").setValue(this.note).onChange((v) => (this.note = v))
    );

    contentEl.createEl("p", { cls: "ledgr-error ledgr-error-lpay ledgr-hidden", text: "" });

    new Setting(contentEl).addButton((btn) =>
      btn.setButtonText("Confirm Payment").setCta().onClick(async () => {
        await this.confirm();
      })
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

    const newBalance = Math.max(0, acc.balance - this.amount);
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

    // Map liability type to expense category
    const catMap: Record<string, { cat: string; sub: string }> = {
      mortgage: { cat: "Housing", sub: "Rent" },
      car_loan: { cat: "Transport", sub: "Other" },
      credit_card: { cat: "Other", sub: "Other" },
      personal_loan: { cat: "Family", sub: "Remittance" },
      student_loan: { cat: "Other", sub: "Other" },
      installment: { cat: "Other", sub: "Other" },
      other: { cat: "Other", sub: "Other" },
    };
    const { cat, sub } = catMap[acc.type] ?? { cat: "Other", sub: "Other" };

    await saveTransaction(this.app, this.plugin.settings, {
      date: this.date,
      type: "expense",
      amount: this.amount,
      currency: acc.currency,
      category: cat,
      subcategory: sub,
      note: this.note || `Loan payment — ${acc.name}`,
    });

    new Notice(`Payment logged: ${formatCurrency(this.amount, acc.currency)} — ${acc.name}`);
    this.app.workspace.trigger("ledgr:transaction-saved");
    this.app.workspace.trigger("ledgr:networth-updated");
    this.onPaid();
    this.close();
  }

  onClose() { this.contentEl.empty(); }
}
