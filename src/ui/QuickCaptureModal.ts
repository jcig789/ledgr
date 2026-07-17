import { App, Modal, Setting, Platform } from "obsidian";
import { LedgrSettings, Currency } from "../settings";
import { saveTransaction } from "../data/transactions";
import { CATEGORIES, INCOME_CATEGORIES } from "../constants/categories";
import { loadCategories, CategoryStore } from "../data/categoryStore";
import { createDateInput } from "./DatePicker";

type TransactionType = "expense" | "income";

export class QuickCaptureModal extends Modal {
  settings: LedgrSettings;
  type: TransactionType = "expense";
  amount = "";
  currency: Currency;
  category = "Food & Drink";
  subcategory = "Groceries";
  note = "";
  date: string;
  catStore: CategoryStore = { expense: CATEGORIES, income: INCOME_CATEGORIES };
  private amtInput: HTMLInputElement | null = null;

  constructor(app: App, settings: LedgrSettings, contextMonth?: string) {
    super(app);
    this.settings = settings;
    this.currency = settings.baseCurrency;
    // If viewing a historical month, default date to last day of that month
    // If viewing current or future month, default to today
    const today = window.moment().format("YYYY-MM");
    if (contextMonth && contextMonth < today) {
      this.date = window.moment(contextMonth).endOf("month").format("YYYY-MM-DD");
    } else {
      this.date = window.moment().format("YYYY-MM-DD");
    }
  }

  async onOpen() {
    this.catStore = await loadCategories(this.app, this.settings);
    const firstCat = Object.keys(this.catStore.expense)[0] ?? "Other";
    if (!this.catStore.expense[this.category]) {
      this.category = firstCat;
      this.subcategory = this.catStore.expense[firstCat]?.[0] ?? "Other";
    }
    void this.render();
    // Enter-to-save: desktop only, and only when not inside a text input
    // On mobile: iOS keyboard Enter key should not auto-save (user needs to tap Save)
    if (!Platform.isMobile) {
      this.contentEl.addEventListener("keydown", (e) => {
        const target = e.target as HTMLElement;
        const isTextInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA";
        // Only save on Enter if focus is NOT in a text field (e.g. on the modal itself)
        if (e.key === "Enter" && !e.shiftKey && !isTextInput) {
          e.preventDefault();
          void this.save();
        }
      });
    }
    // Auto-focus amount field
    window.setTimeout(() => this.amtInput?.focus(), 50);
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ledgr-quick-capture");
    contentEl.createEl("h2", { text: "Log Transaction" });

    // Type — update only category/sub state, no full re-render
    new Setting(contentEl)
      .setName("Type")
      .addDropdown((d) =>
        d
          .addOption("expense", "Expense")
          .addOption("income", "Income")
          .setValue(this.type)
          .onChange((v): void => {
            this.type = v as TransactionType;
            const map = v === "income" ? this.catStore.income : this.catStore.expense;
            this.category = Object.keys(map)[0] ?? "Other";
            this.subcategory = map[this.category]?.[0] ?? "Other";
            // Only update category/subcategory dropdowns, not full re-render
            this.updateCategoryDropdowns();
          })
      );

    // Amount + currency
    new Setting(contentEl)
      .setName("Amount")
      .addText((t) => {
        t.setPlaceholder("0").setValue(this.amount).onChange((v) => (this.amount = v));
        this.amtInput = t.inputEl;
        return t;
      })
      .addDropdown((d): void => {
        const currencies = [this.settings.baseCurrency, ...this.settings.secondaryCurrencies];
        currencies.forEach((c) => d.addOption(c, c));
        d.setValue(this.currency).onChange((v) => (this.currency = v));
      });

    // Amount error placeholder
    contentEl.createEl("p", { cls: "ledgr-error ledgr-error-amount ledgr-hidden", text: "" });

    // Category
    const catMap = this.type === "income" ? this.catStore.income : this.catStore.expense;
    const catNames = Object.keys(catMap);

    new Setting(contentEl)
      .setName("Category")
      .addDropdown((d): void => {
        catNames.forEach((c) => d.addOption(c, c));
        d.setValue(this.category).onChange((v): void => {
          this.category = v;
          this.subcategory = catMap[v][0];
          // Update only subcategory dropdown
          const subDrop = contentEl.querySelector<HTMLSelectElement>(".ledgr-sub-dropdown");
          if (subDrop) {
            while (subDrop.firstChild) subDrop.removeChild(subDrop.firstChild);
            (catMap[v] ?? ["Other"]).forEach((s) => {
              const opt = subDrop.createEl("option");
              opt.value = s; opt.textContent = s;
            });
            subDrop.value = this.subcategory;
          }
        });
      });

    // Subcategory
    const subs = catMap[this.category] ?? ["Other"];
    new Setting(contentEl)
      .setName("Subcategory")
      .addDropdown((d): void => {
        subs.forEach((s) => d.addOption(s, s));
        d.setValue(this.subcategory).onChange((v) => (this.subcategory = v));
        d.selectEl.addClass("ledgr-sub-dropdown");
      });

    // Note
    new Setting(contentEl)
      .setName("Note")
      .addText((t) =>
        t.setPlaceholder("Optional description").setValue(this.note).onChange((v) => (this.note = v))
      );

    // Date picker
    const dateSetting = new Setting(contentEl).setName("Date");
    createDateInput(dateSetting.controlEl, this.date, (v) => (this.date = v));

    // Date error placeholder
    contentEl.createEl("p", { cls: "ledgr-error ledgr-error-date ledgr-hidden", text: "" });

    new Setting(contentEl).addButton((btn) =>
      btn.setButtonText(Platform.isMobile ? "Save" : "Save (Enter)").setCta().onClick(() => void this.save())
    );
  }

  // Targeted update: only swap category dropdown options
  updateCategoryDropdowns() {
    // Re-render just category + subcategory by full render (focus is not in these fields)
    void this.render();
    window.setTimeout(() => this.amtInput?.focus(), 50);
  }

  async save() {
    // Clear previous errors
    const amtErr = this.contentEl.querySelector<HTMLElement>(".ledgr-error-amount");
    const dateErr = this.contentEl.querySelector<HTMLElement>(".ledgr-error-date");
    if (amtErr) { amtErr.addClass("ledgr-hidden"); amtErr.textContent = ""; }
    if (dateErr) { dateErr.addClass("ledgr-hidden"); dateErr.textContent = ""; }

    let hasError = false;
    const amt = parseFloat(this.amount);
    if (!amt || isNaN(amt) || amt <= 0) {
      if (amtErr) { amtErr.textContent = "Please enter a valid positive amount."; amtErr.removeClass("ledgr-hidden"); }
      this.amtInput?.focus();
      hasError = true;
    }

    if (!window.moment(this.date, "YYYY-MM-DD", true).isValid()) {
      if (dateErr) { dateErr.textContent = "Date must be YYYY-MM-DD (e.g. 2026-07-14)."; dateErr.removeClass("ledgr-hidden"); }
      hasError = true;
    }

    if (hasError) return;

    await saveTransaction(this.app, this.settings, {
      date: this.date,
      type: this.type,
      amount: amt,
      currency: this.currency,
      category: this.category,
      subcategory: this.subcategory,
      note: this.note,
    });

    this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}
