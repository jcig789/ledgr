import { App, Modal, Setting, Platform, Notice } from "obsidian";
import { LedgrSettings, Currency } from "../settings";
import { saveTransaction } from "../data/transactions";
import { CATEGORIES, INCOME_CATEGORIES } from "../constants/categories";
import { loadCategories, saveCategories, CategoryStore } from "../data/categoryStore";
import { createDateInput } from "./DatePicker";

type TransactionType = "expense" | "income";

export interface QuickCaptureInitialState {
  type?: TransactionType;
  amount?: number;
  currency?: string;
  category?: string;
  subcategory?: string;
  note?: string;
  date?: string;  // YYYY-MM-DD — overrides the contextMonth default when set
}

export class QuickCaptureModal extends Modal {
  settings: LedgrSettings;
  type: TransactionType = "expense";
  amount = "";
  currency: Currency = "";
  category = "Food & Drink";
  subcategory = "Groceries";
  note = "";
  date: string;
  catStore: CategoryStore = { expense: CATEGORIES, income: INCOME_CATEGORIES };
  private amtInput: HTMLInputElement | null = null;
  private saveBtn: HTMLButtonElement | null = null;

  constructor(app: App, settings: LedgrSettings, contextMonth?: string, initial?: QuickCaptureInitialState) {
    super(app);
    this.settings = settings;
    const today = window.moment().format("YYYY-MM");
    if (contextMonth && contextMonth < today) {
      this.date = window.moment(contextMonth).endOf("month").format("YYYY-MM-DD");
    } else {
      this.date = window.moment().format("YYYY-MM-DD");
    }
    if (initial) {
      if (initial.type) this.type = initial.type;
      if (initial.amount !== undefined) this.amount = String(initial.amount);
      if (initial.category) this.category = initial.category;
      if (initial.subcategory) this.subcategory = initial.subcategory;
      if (initial.note) this.note = initial.note;
      if (initial.date) this.date = initial.date;  // overrides contextMonth default
    }
  }

  async onOpen() {
    this.currency = this.settings.baseCurrency;
    this.catStore = await loadCategories(this.app, this.settings);
    const catMap = this.type === "income" ? this.catStore.income : this.catStore.expense;
    const firstCat = Object.keys(catMap)[0] ?? "Other";
    if (!catMap[this.category]) {
      this.category = firstCat;
      this.subcategory = catMap[firstCat]?.[0] ?? "Other";
    } else if (!catMap[this.category]?.includes(this.subcategory)) {
      this.subcategory = catMap[this.category]?.[0] ?? "Other";
    }
    void this.render();
    if (!Platform.isMobile) {
      this.contentEl.addEventListener("keydown", (e) => {
        const target = e.target as HTMLElement;
        const isAmountInput = target === this.amtInput;
        const isOtherTextInput = (target.tagName === "INPUT" || target.tagName === "TEXTAREA") && !isAmountInput;
        const hasValidAmount = parseFloat(this.amount) > 0 && !isNaN(parseFloat(this.amount));
        if (e.key === "Enter" && !e.shiftKey && !isOtherTextInput && hasValidAmount) {
          e.preventDefault();
          void this.save();
        }
      });
    }
    if (!Platform.isMobile) {
      window.setTimeout(() => this.amtInput?.focus(), 50);
    }
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ledgr-quick-capture");
    contentEl.createEl("h2", { text: "Log Transaction" });

    // Amount + currency — first and most prominent
    new Setting(contentEl)
      .setName("Amount")
      .addText((t) => {
        t.setPlaceholder("0").setValue(this.amount).onChange((v) => (this.amount = v));
        this.amtInput = t.inputEl;
        t.inputEl.setAttribute("inputmode", "decimal");
        t.inputEl.setAttribute("enterkeyhint", "done");
        if (Platform.isMobile) {
          t.inputEl.addEventListener("focus", () => {
            window.setTimeout(() => t.inputEl.scrollIntoView({ behavior: "smooth", block: "center" }), 300);
          });
        }
        return t;
      })
      .addDropdown((d): void => {
        const currencies = [this.settings.baseCurrency, ...this.settings.secondaryCurrencies];
        currencies.forEach((c): void => { d.addOption(c, c); });
        void d.setValue(this.currency).onChange((v) => (this.currency = v));
      });

    contentEl.createEl("p", { cls: "ledgr-error ledgr-error-amount ledgr-hidden", text: "" });

    // ── Chip-based category selector ──
    const catSelector = contentEl.createDiv("ledgr-cat-selector");

    const catChipWrap = catSelector.createDiv("ledgr-cat-chip-row-wrap");
    catChipWrap.createSpan({ text: "category", cls: "ledgr-chip-row-label" });
    const catChipRow = catChipWrap.createDiv("ledgr-cat-chip-row");

    const subChipWrap = catSelector.createDiv("ledgr-sub-chip-row-wrap");
    const subLabel = subChipWrap.createSpan({
      text: this.type === "income" ? "subcategory" : `in: ${this.category}`,
      cls: "ledgr-chip-row-label ledgr-chip-sub-label",
    });
    const subChipRow = subChipWrap.createDiv("ledgr-sub-chip-row");

    // Inline add-input overlay — floats above the chip rows, hidden by default.
    // Renders outside the scroll container to avoid layout shift on mobile.
    const addInputOverlay = catSelector.createDiv("ledgr-cat-add-overlay ledgr-hidden");
    let addInputMode: "category" | "subcategory" = "category";

    const showAddInput = (mode: "category" | "subcategory", placeholder: string, onCommit: (val: string) => void) => {
      addInputMode = mode;
      addInputOverlay.empty();
      addInputOverlay.removeClass("ledgr-hidden");

      const inp = addInputOverlay.createEl("input", {
        attr: {
          type: "text",
          placeholder,
          class: "ledgr-inline-input ledgr-cat-add-input",
          enterkeyhint: "done",
        },
      }) as HTMLInputElement;

      const commit = () => {
        const val = inp.value.trim();
        // Minimum 2 characters to prevent accidental single-character categories
        if (val && val.length >= 2) onCommit(val);
        else if (val && val.length < 2) return; // stay open, let user keep typing
        addInputOverlay.addClass("ledgr-hidden");
        addInputOverlay.empty();
      };

      inp.onkeydown = (e) => {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        if (e.key === "Escape") {
          addInputOverlay.addClass("ledgr-hidden");
          addInputOverlay.empty();
        }
      };
      inp.onblur = () => {
        // Small delay so a tap on another chip doesn't race with blur
        window.setTimeout(() => {
          if (addInputOverlay.contains(document.activeElement)) return;
          addInputOverlay.addClass("ledgr-hidden");
          addInputOverlay.empty();
        }, 150);
      };

      const doneBtn = addInputOverlay.createEl("button", { text: "Add", cls: "ledgr-budget-btn" });
      doneBtn.onmousedown = (e) => e.preventDefault(); // prevent blur before click
      doneBtn.onclick = commit;

      window.setTimeout(() => inp.focus(), 50);
    };

    const renderSubChips = (subs: string[]) => {
      subChipRow.empty();
      subs.forEach((sub) => {
        const btn = subChipRow.createEl("button", {
          text: sub,
          cls: `ledgr-sub-chip${this.subcategory === sub ? " active" : ""}`,
        });
        btn.onclick = () => {
          this.subcategory = sub;
          subChipRow.querySelectorAll(".ledgr-sub-chip").forEach((b) => b.removeClass("active"));
          btn.addClass("active");
        };
      });

      // + New sub chip — only for expense categories (income subs are fixed)
      if (this.type === "expense") {
        const newSubChip = subChipRow.createEl("button", { text: "+ New", cls: "ledgr-sub-chip ledgr-chip-new" });
        newSubChip.onclick = () => {
          const cat = this.category;
          showAddInput("subcategory", `New subcategory in ${cat}...`, (val) => { void (async () => {
            if (this.catStore.expense[cat] && !this.catStore.expense[cat].includes(val)) {
              // Optimistic: add to memory first so chip renders immediately
              this.catStore.expense[cat].push(val);
              this.subcategory = val;
              try {
                await saveCategories(this.app, this.settings, this.catStore);
                this.app.workspace.trigger("ledgr:categories-updated");
                const undoNotice = new Notice(`Subcategory "${val}" added.`, 4000);
                const noticeEl = (undoNotice as unknown as { noticeEl: HTMLElement }).noticeEl;
                const undoLink = noticeEl?.createEl("a", { text: " Undo", cls: "ledgr-rate-banner-link" });
                if (undoLink) {
                  undoLink.onclick = async () => {
                    this.catStore.expense[cat] = this.catStore.expense[cat].filter((s) => s !== val);
                    this.subcategory = this.catStore.expense[cat][0] ?? "Other";
                    await saveCategories(this.app, this.settings, this.catStore);
                    this.app.workspace.trigger("ledgr:categories-updated");
                    undoNotice.hide();
                    void this.render();
                  };
                }
                renderSubChips(this.catStore.expense[cat]);
                window.setTimeout(() => {
                  const chips = subChipRow.querySelectorAll(".ledgr-sub-chip");
                  const last = chips[chips.length - 2];
                  if (last) (last as HTMLElement).scrollIntoView({ behavior: "smooth", inline: "nearest" });
                }, 50);
              } catch {
                // Revert optimistic add — save failed
                this.catStore.expense[cat] = this.catStore.expense[cat].filter((s) => s !== val);
                this.subcategory = this.catStore.expense[cat][0] ?? "Other";
                new Notice("Failed to save subcategory. Check your vault settings.");
                renderSubChips(this.catStore.expense[cat]);
              }
            }
          })(); });
        };
      }
    };

    // Expense categories
    const expCats = Object.keys(this.catStore.expense);
    expCats.forEach((cat) => {
      const btn = catChipRow.createEl("button", {
        text: cat,
        cls: `ledgr-cat-chip${this.type === "expense" && this.category === cat ? " active" : ""}`,
      });
      btn.onclick = () => {
        this.type = "expense";
        this.category = cat;
        this.subcategory = this.catStore.expense[cat]?.[0] ?? "Other";
        catChipRow.querySelectorAll(".ledgr-cat-chip").forEach((b) => {
          b.removeClass("active");
          b.removeClass("ledgr-cat-chip--income");
        });
        btn.addClass("active");
        subLabel.textContent = `in: ${cat}`;
        renderSubChips(this.catStore.expense[cat] ?? ["Other"]);
      };
    });

    // + New category chip — before Income chip
    const newCatChip = catChipRow.createEl("button", { text: "+ New", cls: "ledgr-cat-chip ledgr-chip-new" });
    newCatChip.onclick = () => {
      showAddInput("category", "New category name...", (val) => { void (async () => {
        if (!this.catStore.expense[val]) {
          // Optimistic add
          this.catStore.expense[val] = ["Other"];
          this.type = "expense";
          this.category = val;
          this.subcategory = "Other";
          try {
            await saveCategories(this.app, this.settings, this.catStore);
            this.app.workspace.trigger("ledgr:categories-updated");
            const undoNotice = new Notice(`Category "${val}" added.`, 4000);
            const noticeEl = (undoNotice as unknown as { noticeEl: HTMLElement }).noticeEl;
            const undoLink = noticeEl?.createEl("a", { text: " Undo", cls: "ledgr-rate-banner-link" });
            if (undoLink) {
              undoLink.onclick = async () => {
                delete this.catStore.expense[val];
                this.category = Object.keys(this.catStore.expense)[0] ?? "Other";
                this.subcategory = this.catStore.expense[this.category]?.[0] ?? "Other";
                await saveCategories(this.app, this.settings, this.catStore);
                this.app.workspace.trigger("ledgr:categories-updated");
                undoNotice.hide();
                void this.render();
              };
            }
            void this.render();
          } catch {
            // Revert optimistic add — save failed
            delete this.catStore.expense[val];
            this.category = Object.keys(this.catStore.expense)[0] ?? "Other";
            this.subcategory = this.catStore.expense[this.category]?.[0] ?? "Other";
            new Notice("Failed to save category. Check your vault settings.");
          }
        } else {
          new Notice(`Category "${val}" already exists`);
        }
      })(); });
    };

    // Income chip — always at end
    const incomeChip = catChipRow.createEl("button", {
      text: "Income",
      cls: `ledgr-cat-chip ledgr-cat-chip--income${this.type === "income" ? " active" : ""}`,
    });
    incomeChip.onclick = () => {
      this.type = "income";
      const firstIncomeCat = Object.keys(this.catStore.income)[0] ?? "Income";
      this.category = firstIncomeCat;
      this.subcategory = this.catStore.income[firstIncomeCat]?.[0] ?? "Other income";
      catChipRow.querySelectorAll(".ledgr-cat-chip").forEach((b) => b.removeClass("active"));
      incomeChip.addClass("active");
      subLabel.textContent = "subcategory";
      renderSubChips(this.catStore.income[firstIncomeCat] ?? ["Other income"]);
    };

    // Render initial subcategory chips
    const currentSubs = this.type === "income"
      ? (this.catStore.income[this.category] ?? ["Other income"])
      : (this.catStore.expense[this.category] ?? ["Other"]);
    renderSubChips(currentSubs);

    // Note
    new Setting(contentEl)
      .setName("Note")
      .addText((t) =>
        t.setPlaceholder("Optional description").setValue(this.note).onChange((v) => (this.note = v))
      );

    // Date picker
    const dateSetting = new Setting(contentEl).setName("Date");
    createDateInput(dateSetting.controlEl, this.date, (v) => (this.date = v));

    contentEl.createEl("p", { cls: "ledgr-error ledgr-error-date ledgr-hidden", text: "" });

    const btnLabel = Platform.isMobile ? "Record" : "Record (Enter)";
    new Setting(contentEl).addButton((btn) => {
      btn.setButtonText(btnLabel).setCta().onClick(() => void this.save());
      this.saveBtn = btn.buttonEl;
    });
  }

  async save() {
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
      if (dateErr) { dateErr.textContent = "Date must be YYYY-MM-DD (e.g. 2026-08-18)."; dateErr.removeClass("ledgr-hidden"); }
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

    // Brief "Recorded" confirmation before closing
    if (this.saveBtn) {
      this.saveBtn.textContent = "Recorded";
      this.saveBtn.disabled = true;
      window.setTimeout(() => this.close(), 600);
    } else {
      this.close();
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
