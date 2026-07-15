import { App, Modal, Setting, Notice } from "obsidian";
import LedgrPlugin from "../main";
import { loadBudgets, saveBudgets, BudgetConfig } from "../data/budgets";
import { loadCategories } from "../data/categoryStore";

export class BudgetModal extends Modal {
  plugin: LedgrPlugin;
  budgets: BudgetConfig = { currency: "", limits: {} };
  expenseCategories: string[] = [];

  constructor(app: App, plugin: LedgrPlugin) {
    super(app);
    this.plugin = plugin;
  }

  async onOpen() {
    const [budgets, catStore] = await Promise.all([
      loadBudgets(this.app, this.plugin.settings),
      loadCategories(this.app, this.plugin.settings),
    ]);
    this.budgets = budgets;
    this.budgets.currency = this.plugin.settings.baseCurrency;
    this.expenseCategories = Object.keys(catStore.expense);
    this.render();
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Monthly Budgets" });
    contentEl.createEl("p", {
      text: `Amounts in ${this.plugin.settings.baseCurrency}. Leave blank for no limit.`,
      cls: "setting-item-description",
    });

    this.expenseCategories.forEach((cat) => {
      new Setting(contentEl)
        .setName(cat)
        .addText((t) =>
          t
            .setPlaceholder("No limit")
            .setValue(this.budgets.limits[cat] ? String(this.budgets.limits[cat]) : "")
            .onChange((v) => {
              const n = parseFloat(v);
              if (n > 0) this.budgets.limits[cat] = n;
              else delete this.budgets.limits[cat];
            })
        );
    });

    new Setting(contentEl).addButton((btn) =>
      btn
        .setButtonText("Save Budgets")
        .setCta()
        .onClick(async () => {
          await saveBudgets(this.app, this.plugin.settings, this.budgets);
          this.app.workspace.trigger("ledgr:transaction-saved" as any);
          new Notice("Budgets saved");
          this.close();
        })
    );
  }

  onClose() {
    this.contentEl.empty();
  }
}
