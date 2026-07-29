import { App, Modal, Notice, Setting } from "obsidian";
import LedgrPlugin from "../main";
import { loadTemplates, saveTemplates, TransactionTemplate } from "../data/templates";
import { saveTransaction } from "../data/transactions";
import { FIXED_SUBCATEGORIES, getDefaultStream } from "../constants/categories";
import { readMonthTransactions } from "../data/reader";

export class TemplatesModal extends Modal {
  plugin: LedgrPlugin;
  private store: Awaited<ReturnType<typeof loadTemplates>> = { templates: [] };
  private selectedMonth: string;
  private checked: Set<string> = new Set();
  private tab: "apply" | "manage" = "apply";

  constructor(app: App, plugin: LedgrPlugin) {
    super(app);
    this.plugin = plugin;
    this.selectedMonth = window.moment().format("YYYY-MM");
  }

  private seededThisSession = false;
  private seedCount = 0;

  async onOpen() {
    this.store = await loadTemplates(this.app, this.plugin.settings);
    if (this.store.templates.length === 0) {
      // Don't auto-save yet — show suggestions with disclosure first
      await this.seedSuggestions(false);
      this.seededThisSession = this.store.templates.length > 0;
      this.seedCount = this.store.templates.length;
    }
    this.render();
  }

  async seedSuggestions(save = true) {
    const prevMonth = window.moment().subtract(1, "month").format("YYYY-MM");
    const txs = await readMonthTransactions(this.app, this.plugin.settings, prevMonth);
    const fixedTxs = txs.filter((t) => FIXED_SUBCATEGORIES.has(t.subcategory) && t.type === "expense");
    // Deduplicate by subcategory — take last occurrence
    const seen = new Map<string, typeof fixedTxs[0]>();
    fixedTxs.forEach((t) => seen.set(t.subcategory, t));
    seen.forEach((t) => {
      this.store.templates.push({
        id: `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        name: t.subcategory,
        type: t.type,
        amount: t.amount,
        currency: t.currency,
        category: t.category,
        subcategory: t.subcategory,
        stream: t.stream ?? getDefaultStream(t.subcategory),
        note: t.note,
      });
    });
    if (save && this.store.templates.length > 0) {
      await saveTemplates(this.app, this.plugin.settings, this.store);
    }
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Transaction Templates" });

    // Tab toggle
    const tabRow = contentEl.createDiv("ledgr-opex-tabs");
    [{ key: "apply", label: "Apply" }, { key: "manage", label: "Manage" }].forEach(({ key, label }) => {
      const btn = tabRow.createEl("button", { text: label, cls: `ledgr-opex-tab${this.tab === key ? " active" : ""}` });
      btn.onclick = () => { this.tab = key as "apply" | "manage"; this.render(); };
    });

    if (this.tab === "apply") this.renderApply(contentEl);
    else this.renderManage(contentEl);
  }

  renderApply(parent: HTMLElement) {
    if (this.store.templates.length === 0) {
      parent.createEl("p", { text: "No templates yet. Switch to Manage to create one.", cls: "ledgr-empty" });
      return;
    }

    // Disclosure banner when seeded this session (W2 fix)
    if (this.seededThisSession) {
      const banner = parent.createDiv("ledgr-rate-banner");
      banner.createSpan({ text: `${this.seedCount} template${this.seedCount > 1 ? "s" : ""} suggested from your fixed expenses last month. Review and uncheck any you don't want before applying.` });
    }

    // Month picker
    const monthRow = parent.createDiv("ledgr-month-row ledgr-row-spaced");
    monthRow.createSpan({ text: "Apply to:", cls: "ledgr-meta" });
    new Setting(monthRow).addText((t): void => {
      t.inputEl.type = "month";
      t.inputEl.value = this.selectedMonth;
      t.inputEl.addClass("ledgr-inline-input");
      t.onChange((v) => { this.selectedMonth = v; });
    });

    parent.createEl("p", { text: "Select templates to log as transactions:", cls: "ledgr-meta" });

    const list = parent.createDiv("ledgr-template-list");
    this.store.templates.forEach((tpl) => {
      const row = list.createDiv("ledgr-template-row");
      const cb = row.createEl("input", { attr: { type: "checkbox" } }) as HTMLInputElement;
      cb.checked = this.checked.has(tpl.id);
      cb.onchange = () => { cb.checked ? this.checked.add(tpl.id) : this.checked.delete(tpl.id); };
      row.createSpan({ text: tpl.name, cls: "ledgr-template-name" });
      row.createSpan({ text: `${tpl.currency} ${tpl.amount.toLocaleString()}`, cls: "ledgr-template-amount" });
      row.createSpan({ text: tpl.type, cls: `ledgr-badge ledgr-badge-${tpl.type}` });
      row.createSpan({ text: tpl.stream.toUpperCase(), cls: `ledgr-template-stream ledgr-template-stream-${tpl.stream}` });
    });

    const selectAll = parent.createEl("a", { text: "Select all", cls: "ledgr-rate-banner-link" });
    selectAll.onclick = () => {
      this.store.templates.forEach((t) => this.checked.add(t.id));
      this.render();
    };

    new Setting(parent).addButton((btn) =>
      btn.setButtonText("Apply Selected").setCta().onClick(async () => {
        await this.applyTemplates();
      })
    );
  }

  async applyTemplates() {
    const toApply = this.store.templates.filter((t) => this.checked.has(t.id));
    if (toApply.length === 0) { new Notice("No templates selected."); return; }

    const date = `${this.selectedMonth}-01`;
    for (const tpl of toApply) {
      await saveTransaction(this.app, this.plugin.settings, {
        date,
        type: tpl.type,
        amount: tpl.amount,
        currency: tpl.currency,
        category: tpl.category,
        subcategory: tpl.subcategory,
        note: tpl.note || `Template: ${tpl.name}`,
        stream: tpl.stream,
      });
    }
    // Persist seeded templates to disk on first apply confirmation
    if (this.seededThisSession) {
      await saveTemplates(this.app, this.plugin.settings, this.store);
      this.seededThisSession = false;
    }
    new Notice(`${toApply.length} template${toApply.length > 1 ? "s" : ""} applied to ${this.selectedMonth}.`);
    this.checked.clear();
    this.close();
  }

  renderManage(parent: HTMLElement) {
    if (this.store.templates.length === 0) {
      parent.createEl("p", { text: "No templates yet.", cls: "ledgr-empty" });
    } else {
      this.store.templates.forEach((tpl) => {
        const row = parent.createDiv("ledgr-template-row ledgr-template-manage-row");
        row.createSpan({ text: tpl.name, cls: "ledgr-template-name" });
        row.createSpan({ text: `${tpl.currency} ${tpl.amount.toLocaleString()}`, cls: "ledgr-template-amount" });
        const removeBtn = row.createEl("button", { text: "Remove", cls: "ledgr-remove-btn" });
        removeBtn.onclick = async () => {
          this.store.templates = this.store.templates.filter((t) => t.id !== tpl.id);
          await saveTemplates(this.app, this.plugin.settings, this.store);
          this.render();
        };
      });
    }

    // Add new template form
    parent.createEl("h3", { text: "Add Template" });
    const form = parent.createDiv("ledgr-edit-card");

    // Type toggle: Expense / Income
    let newType: "expense" | "income" = "expense";
    const typeRow = form.createDiv("ledgr-edit-card-row");
    typeRow.createSpan({ text: "Type", cls: "ledgr-meta" });
    const typeToggleRow = typeRow.createDiv("ledgr-btn-row");
    const expenseBtn = typeToggleRow.createEl("button", { text: "Expense", cls: "ledgr-budget-btn active" });
    const incomeBtn = typeToggleRow.createEl("button", { text: "Income", cls: "ledgr-budget-btn" });
    const incomeNote = form.createEl("p", { text: "Income templates do not affect the Forecast projection until real transactions are recorded.", cls: "ledgr-empty ledgr-hidden" });
    expenseBtn.onclick = () => { newType = "expense"; expenseBtn.addClass("active"); incomeBtn.removeClass("active"); incomeNote.addClass("ledgr-hidden"); };
    incomeBtn.onclick = () => { newType = "income"; incomeBtn.addClass("active"); expenseBtn.removeClass("active"); incomeNote.removeClass("ledgr-hidden"); };

    const nameInput = form.createEl("input", { attr: { type: "text", placeholder: "Name (e.g. Rent or Salary)" } }) as HTMLInputElement;
    nameInput.className = "ledgr-inline-input";
    const amtInput = form.createEl("input", { attr: { type: "number", placeholder: "Amount" } }) as HTMLInputElement;
    amtInput.className = "ledgr-inline-input";
    const catInput = form.createEl("input", { attr: { type: "text", placeholder: "Category" } }) as HTMLInputElement;
    catInput.className = "ledgr-inline-input";
    const subInput = form.createEl("input", { attr: { type: "text", placeholder: "Subcategory" } }) as HTMLInputElement;
    subInput.className = "ledgr-inline-input";

    const addBtn = form.createEl("button", { text: "Add", cls: "ledgr-log-btn mod-cta" });
    addBtn.onclick = async () => {
      const sub = subInput.value.trim() || "Other";
      this.store.templates.push({
        id: `tpl_${Date.now()}`,
        name: nameInput.value.trim() || sub,
        type: newType,
        amount: parseFloat(amtInput.value) || 0,
        currency: this.plugin.settings.baseCurrency,
        category: catInput.value.trim() || (newType === "income" ? "Income" : "Other"),
        subcategory: sub,
        stream: getDefaultStream(sub),
        note: "",
      });
      await saveTemplates(this.app, this.plugin.settings, this.store);
      this.render();
    };
  }

  onClose() { this.contentEl.empty(); }
}
