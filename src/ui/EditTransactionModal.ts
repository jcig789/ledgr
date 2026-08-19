import { App, Modal, Setting, Notice, TFile, normalizePath } from "obsidian";
import LedgrPlugin from "../main";
import { Transaction, CashFlowStream } from "../data/transactions";
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
  type: "expense" | "income";
  amount: string;
  currency: string;
  category: string;
  subcategory: string;
  note: string;
  date: string;
  stream: CashFlowStream;

  constructor(app: App, plugin: LedgrPlugin, tx: Transaction, month: string, lineIndex: number, onSaved: () => void) {
    super(app);
    this.plugin = plugin;
    this.tx = tx;
    this.month = month;
    this.lineIndex = lineIndex;
    this.onSaved = onSaved;
    this.type = tx.type;
    this.amount = String(tx.amount);
    this.currency = tx.currency;
    this.category = tx.category;
    this.subcategory = tx.subcategory;
    this.note = tx.note;
    this.date = tx.date;
    // Preserve stream — never drop it on edit
    this.stream = tx.stream ?? "ocf";
  }

  async onOpen() {
    this.catStore = await loadCategories(this.app, this.plugin.settings);
    void this.render().catch(console.error);
    this.contentEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        // Guard: don't save when focus is in a text/textarea field other than the amount
        const target = e.target as HTMLElement;
        const isTextInput = (target.tagName === "INPUT" && (target as HTMLInputElement).type === "text")
          || target.tagName === "TEXTAREA";
        if (isTextInput) return; // let Enter behave normally in text fields
        e.preventDefault();
        void this.save();
      }
    });
  }

  async render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Edit Transaction" });

    // Type toggle (Expense | Income) — allows fixing miscategorised type
    const typeRow = contentEl.createDiv("ledgr-edit-type-row");
    typeRow.createSpan({ text: "Type", cls: "ledgr-meta" });
    const typeToggle = typeRow.createDiv("ledgr-btn-row ledgr-toggle-group");
    const expBtn = typeToggle.createEl("button", { text: "Expense", cls: `ledgr-budget-btn ledgr-toggle-btn${this.type === "expense" ? " active" : ""}` });
    const incBtn = typeToggle.createEl("button", { text: "Income",  cls: `ledgr-budget-btn ledgr-toggle-btn${this.type === "income"  ? " active" : ""}` });
    expBtn.onclick = () => {
      this.type = "expense";
      const firstCat = Object.keys(this.catStore.expense)[0] ?? "Other";
      this.category = firstCat;
      this.subcategory = this.catStore.expense[firstCat]?.[0] ?? "Other";
      void this.render().catch(console.error);
    };
    incBtn.onclick = () => {
      this.type = "income";
      const firstCat = Object.keys(this.catStore.income)[0] ?? "Income";
      this.category = firstCat;
      this.subcategory = this.catStore.income[firstCat]?.[0] ?? "Other income";
      void this.render().catch(console.error);
    };

    const catMap = this.type === "income" ? this.catStore.income : this.catStore.expense;

    new Setting(contentEl)
      .setName("Amount")
      .addText((t) =>
        t.setValue(this.amount).onChange((v) => (this.amount = v))
      )
      .addDropdown((d): void => {
        const currencies = [this.plugin.settings.baseCurrency, ...this.plugin.settings.secondaryCurrencies];
        currencies.forEach((c): void => { d.addOption(c, c); });
        void d.setValue(this.currency).onChange((v) => (this.currency = v));
      });

    new Setting(contentEl)
      .setName("Category")
      .addDropdown((d): void => {
        Object.keys(catMap).forEach((c): void => { d.addOption(c, c); });
        void d.setValue(this.category).onChange((v): void => {
          this.category = v;
          this.subcategory = catMap[v]?.[0] ?? "Other";
          void this.render().catch(console.error);
        });
      });

    const subs = catMap[this.category] ?? ["Other"];
    new Setting(contentEl)
      .setName("Subcategory")
      .addDropdown((d): void => {
        subs.forEach((s): void => { d.addOption(s, s); });
        void d.setValue(this.subcategory).onChange((v) => (this.subcategory = v));
      });

    new Setting(contentEl)
      .setName("Note")
      .addText((t) =>
        t.setValue(this.note).onChange((v) => (this.note = v))
      );

    const dateSetting = new Setting(contentEl).setName("Date");
    (await import("./DatePicker")).createDateInput(dateSetting.controlEl, this.date, (v) => (this.date = v));

    // Stream selector — lets users correct misclassified cash flow streams
    const streamRow = contentEl.createDiv("ledgr-edit-stream-row");
    streamRow.createSpan({ text: "Cash flow", cls: "ledgr-meta" });
    const streamToggle = streamRow.createDiv("ledgr-btn-row ledgr-toggle-group");
    (["ocf", "icf", "fcf"] as CashFlowStream[]).forEach((s) => {
      const labels: Record<CashFlowStream, string> = { ocf: "Operating", icf: "Investing", fcf: "Financing" };
      const btn = streamToggle.createEl("button", {
        text: labels[s],
        cls: `ledgr-budget-btn ledgr-toggle-btn ledgr-stream-btn${this.stream === s ? " active" : ""}`,
      });
      btn.onclick = () => { this.stream = s; void this.render().catch(console.error); };
    });

    contentEl.createEl("p", { cls: "ledgr-error ledgr-error-edit ledgr-hidden", text: "" });

    new Setting(contentEl).addButton((btn) =>
      btn.setButtonText("Record (Enter)").setCta().onClick(() => void this.save())
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

    const dataLineIndices: number[] = [];
    lines.forEach((l, i) => { if (l.startsWith("| 20")) dataLineIndices.push(i); });
    const targetIdx = dataLineIndices[this.lineIndex];
    if (targetIdx === undefined) return;

    // Preserve stream in both table row and DV line
    const stream = this.stream;
    const newRow = `| ${this.date} | ${this.type} | ${amt} | ${this.currency} | ${this.category} | ${this.subcategory} | ${this.note || "-"} | ${stream} |`;
    const dvLine = `%%[date:: ${this.date}] [type:: ${this.type}] [amount:: ${amt}] [currency:: ${this.currency}] [category:: ${this.category}] [subcategory:: ${this.subcategory}]${this.note ? ` [note:: ${this.note}]` : ""} [stream:: ${stream}]%%`;

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
