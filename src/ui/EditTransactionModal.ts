import { App, Modal, Setting, Notice, TFile, normalizePath } from "obsidian";
import LedgrPlugin from "../main";
import { Transaction } from "../data/transactions";
import { CATEGORIES, INCOME_CATEGORIES } from "../constants/categories";
import { loadCategories, CategoryStore } from "../data/categoryStore";

export class EditTransactionModal extends Modal {
  plugin: LedgrPlugin;
  tx: Transaction;
  month: string;
  lineIndex: number;
  catStore: CategoryStore = { expense: CATEGORIES, income: INCOME_CATEGORIES };
  onSaved: () => void;

  // Editable state
  amount: string;
  currency: string;
  category: string;
  subcategory: string;
  note: string;
  date: string;

  constructor(app: App, plugin: LedgrPlugin, tx: Transaction, month: string, lineIndex: number, onSaved: () => void) {
    super(app);
    this.plugin = plugin;
    this.tx = tx;
    this.month = month;
    this.lineIndex = lineIndex;
    this.onSaved = onSaved;
    // Copy fields to editable state
    this.amount = String(tx.amount);
    this.currency = tx.currency;
    this.category = tx.category;
    this.subcategory = tx.subcategory;
    this.note = tx.note;
    this.date = tx.date;
  }

  async onOpen() {
    this.catStore = await loadCategories(this.app, this.plugin.settings);
    void this.render().catch(console.error);
    this.contentEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void this.save(); }
    });
  }

  async render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Edit Transaction" });

    const catMap = this.tx.type === "income" ? this.catStore.income : this.catStore.expense;

    new Setting(contentEl)
      .setName("Amount")
      .addText((t) =>
        t.setValue(this.amount).onChange((v) => (this.amount = v))
      )
      .addDropdown((d) => {
        const currencies = [this.plugin.settings.baseCurrency, ...this.plugin.settings.secondaryCurrencies];
        currencies.forEach((c) => d.addOption(c, c));
        d.setValue(this.currency).onChange((v) => (this.currency = v));

      });

    new Setting(contentEl)
      .setName("Category")
      .addDropdown((d) => {
        Object.keys(catMap).forEach((c) => d.addOption(c, c));
        d.setValue(this.category).onChange((v): void => {
          this.category = v;
          this.subcategory = catMap[v]?.[0] ?? "Other";
          void this.render().catch(console.error);
        });

      });

    const subs = catMap[this.category] ?? ["Other"];
    new Setting(contentEl)
      .setName("Subcategory")
      .addDropdown((d) => {
        subs.forEach((s) => d.addOption(s, s));
        d.setValue(this.subcategory).onChange((v) => (this.subcategory = v));

      });

    new Setting(contentEl)
      .setName("Note")
      .addText((t) =>
        t.setValue(this.note).onChange((v) => (this.note = v))
      );

    const dateSetting = new Setting(contentEl).setName("Date");
    (await import("./DatePicker")).createDateInput(dateSetting.controlEl, this.date, (v) => (this.date = v));

    contentEl.createEl("p", { cls: "ledgr-error ledgr-error-edit ledgr-hidden", text: "" });

    new Setting(contentEl).addButton((btn) =>
      btn.setButtonText("Save (Enter)").setCta().onClick(() => void this.save())
    );
  }

  async save() {
    const errEl = this.contentEl.querySelector<HTMLElement>(".ledgr-error-edit");
    if (errEl) { errEl.addClass("ledgr-hidden"); errEl.textContent = ""; }

    const amt = parseFloat(this.amount);
    if (!amt || isNaN(amt) || amt <= 0) {
      if (errEl) { errEl.textContent = "Please enter a valid amount."; errEl.removeClass("ledgr-hidden"); }
      return;
    }
    if (!window.moment(this.date, "YYYY-MM-DD", true).isValid()) {
      if (errEl) { errEl.textContent = "Date must be YYYY-MM-DD."; errEl.removeClass("ledgr-hidden"); }
      return;
    }

    const filePath = normalizePath(`${this.plugin.settings.financeFolder}/transactions/${this.month}.md`);
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) return;

    const content = await this.app.vault.read(file);
    const lines = content.split("\n");

    // Find the data line by index
    const dataLineIndices: number[] = [];
    lines.forEach((l, i) => { if (l.startsWith("| 20")) dataLineIndices.push(i); });
    const targetIdx = dataLineIndices[this.lineIndex];
    if (targetIdx === undefined) return;

    // Replace the table row
    const newRow = `| ${this.date} | ${this.tx.type} | ${amt} | ${this.currency} | ${this.category} | ${this.subcategory} | ${this.note || "-"} |`;
    const dvLine = `%%[date:: ${this.date}] [type:: ${this.tx.type}] [amount:: ${amt}] [currency:: ${this.currency}] [category:: ${this.category}] [subcategory:: ${this.subcategory}]${this.note ? ` [note:: ${this.note}]` : ""}%%`;

    // Replace both the table row and the following DV line if present
    lines[targetIdx] = newRow;
    if (lines[targetIdx + 1]?.startsWith("%%")) {
      lines[targetIdx + 1] = dvLine;
    }

    await this.app.vault.modify(file, lines.join("\n"));
    new Notice("Transaction updated");
    this.app.workspace.trigger("ledgr:transaction-saved");
    this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}
