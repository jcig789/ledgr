import { App, Modal, Setting, Notice } from "obsidian";
import LedgrPlugin from "../main";
import { loadCategories, saveCategories, CategoryStore } from "../data/categoryStore";

type Tab = "exchange" | "categories";

export class ConfigModal extends Modal {
  plugin: LedgrPlugin;
  activeTab: Tab = "exchange";
  categories: CategoryStore | null = null;
  // Track new category/subcategory input state
  newCatName = "";
  newSubInputs: Record<string, string> = {};

  constructor(app: App, plugin: LedgrPlugin) {
    super(app);
    this.plugin = plugin;
  }

  async onOpen() {
    this.categories = await loadCategories(this.app, this.plugin.settings);
    this.render();
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ledgr-config-modal");

    contentEl.createEl("h2", { text: "Ledgr Settings" });

    // Tabs
    const tabRow = contentEl.createDiv("ledgr-tab-row");
    const tabs: { key: Tab; label: string }[] = [
      { key: "exchange", label: "Exchange Rates" },
      { key: "categories", label: "Categories" },
    ];
    tabs.forEach(({ key, label }) => {
      const btn = tabRow.createEl("button", {
        text: label,
        cls: `ledgr-tab-btn ${this.activeTab === key ? "active" : ""}`,
      });
      btn.onclick = () => { this.activeTab = key; this.render(); };
    });

    const body = contentEl.createDiv("ledgr-config-body");

    if (this.activeTab === "exchange") {
      this.renderExchangeTab(body);
    } else {
      this.renderCategoriesTab(body);
    }
  }

  renderExchangeTab(parent: HTMLElement) {
    const settings = this.plugin.settings;
    const rates = settings.exchangeRates;
    const base = settings.baseCurrency;
    const secondary = settings.secondaryCurrencies;

    parent.createEl("p", {
      text: "Set rates manually. All views recalculate instantly when you save.",
      cls: "setting-item-description",
    });

    if (rates.updatedAt) {
      const days = window.moment().diff(window.moment(rates.updatedAt), "days");
      const msg = days === 0 ? "Updated today" : `Last updated ${days} day${days === 1 ? "" : "s"} ago`;
      parent.createEl("p", { text: msg, cls: days > 7 ? "ledgr-stale-warning" : "ledgr-stale-ok" });
    } else {
      parent.createEl("p", { text: "Not yet set.", cls: "ledgr-stale-warning" });
    }

    // Base currency selector
    new Setting(parent)
      .setName("Base currency")
      .setDesc("Your primary currency — all reports are denominated in this")
      .addText((t) =>
        t.setPlaceholder("JPY").setValue(base).onChange((v) => {
          this.plugin.settings.baseCurrency = v.toUpperCase().trim();
        })
      );

    // Secondary currencies
    new Setting(parent)
      .setName("Secondary currencies")
      .setDesc("Shown in currency toggle (comma-separated, e.g. PHP, USD)")
      .addText((t) =>
        t.setPlaceholder("PHP, USD").setValue(secondary.join(", ")).onChange((v) => {
          this.plugin.settings.secondaryCurrencies = v
            .split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);
        })
      );

    parent.createEl("h3", { text: "Exchange Rates" });
    parent.createEl("p", {
      text: `1 ${base} = how much of each secondary currency?`,
      cls: "setting-item-description",
    });

    // Render one field per secondary currency
    secondary.forEach((sec) => {
      const key = `${base}_${sec}`;
      const current = rates.rates[key] ?? 0;
      new Setting(parent)
        .setName(`${base} → ${sec}`)
        .addText((t) =>
          t
            .setPlaceholder("0")
            .setValue(current > 0 ? String(current) : "")
            .onChange((v) => {
              this.plugin.settings.exchangeRates.rates[key] = parseFloat(v) || 0;
            })
        );
    });

    new Setting(parent).addButton((btn) =>
      btn.setButtonText("Save").setCta().onClick(async () => {
        this.plugin.settings.exchangeRates.updatedAt = new Date().toISOString();
        await this.plugin.saveSettings();
        this.app.workspace.trigger("ledgr:transaction-saved" as any);
        new Notice("Settings saved");
        this.render();
      })
    );

    // Transfer tracker toggle
    parent.createEl("h3", { text: "Transfer Tracker" });
    new Setting(parent)
      .setName("Enable transfer tracker")
      .setDesc("Track international money transfers — fees, exchange rates, and amounts received")
      .addToggle((t) =>
        t.setValue(settings.enableTransferTracker).onChange(async (v) => {
          this.plugin.settings.enableTransferTracker = v;
          await this.plugin.saveSettings();
          this.app.workspace.trigger("ledgr:transaction-saved" as any);
        })
      );
  }

  renderCategoriesTab(parent: HTMLElement) {
    if (!this.categories) return;

    parent.createEl("p", {
      text: "Add, rename, or remove expense categories and subcategories.",
      cls: "setting-item-description",
    });

    // Expense categories
    parent.createEl("h3", { text: "Expense Categories" });
    this.renderCategoryGroup(parent, "expense");

    // Income categories
    parent.createEl("h3", { text: "Income Categories" });
    this.renderCategoryGroup(parent, "income");

    // Save button
    new Setting(parent).addButton((btn) =>
      btn
        .setButtonText("Save Categories")
        .setCta()
        .onClick(async () => {
          await saveCategories(this.app, this.plugin.settings, this.categories!);
          this.app.workspace.trigger("ledgr:categories-updated" as any);
          new Notice("Categories saved");
          this.close();
        })
    );
  }

  renderCategoryGroup(parent: HTMLElement, type: "expense" | "income") {
    const group = this.categories![type];

    Object.entries(group).forEach(([cat, subs]) => {
      const catBlock = parent.createDiv("ledgr-cat-block");

      // Category header row
      const catHeader = catBlock.createDiv("ledgr-cat-header");
      catHeader.createEl("strong", { text: cat });
      const delCatBtn = catHeader.createEl("button", { text: "Remove category", cls: "ledgr-remove-btn" });
      delCatBtn.onclick = () => {
        delete group[cat];
        this.render();
      };

      // Subcategories
      const subList = catBlock.createDiv("ledgr-sub-list");
      subs.forEach((sub, idx) => {
        const subRow = subList.createDiv("ledgr-sub-row");
        const input = subRow.createEl("input");
        input.type = "text";
        input.value = sub;
        input.className = "ledgr-inline-input";
        input.oninput = (e) => { group[cat][idx] = (e.target as HTMLInputElement).value; };

        const delSubBtn = subRow.createEl("button", { text: "✕", cls: "ledgr-del-btn" });
        delSubBtn.onclick = () => {
          group[cat].splice(idx, 1);
          this.render();
        };
      });

      // Add subcategory input
      const addSubRow = catBlock.createDiv("ledgr-sub-row");
      const subInput = addSubRow.createEl("input");
      subInput.type = "text";
      subInput.placeholder = "New subcategory...";
      subInput.className = "ledgr-inline-input";
      subInput.value = this.newSubInputs[cat] ?? "";
      subInput.oninput = (e) => { this.newSubInputs[cat] = (e.target as HTMLInputElement).value; };

      const addSubBtn = addSubRow.createEl("button", { text: "+ Add", cls: "ledgr-budget-btn" });
      addSubBtn.onclick = () => {
        const val = this.newSubInputs[cat]?.trim();
        if (val) {
          group[cat].push(val);
          delete this.newSubInputs[cat];
          this.render();
        }
      };
    });

    // Add new category
    if (type === "expense") {
      const addCatRow = parent.createDiv("ledgr-sub-row ledgr-row-spaced");
      const catInput = addCatRow.createEl("input");
      catInput.type = "text";
      catInput.placeholder = "New category name...";
      catInput.className = "ledgr-inline-input";
      catInput.value = this.newCatName;
      catInput.oninput = (e) => { this.newCatName = (e.target as HTMLInputElement).value; };

      const addCatBtn = addCatRow.createEl("button", { text: "+ Add Category", cls: "ledgr-log-btn mod-cta" });
      addCatBtn.onclick = () => {
        const val = this.newCatName.trim();
        if (val && !group[val]) {
          group[val] = ["Other"];
          this.newCatName = "";
          this.render();
        }
      };
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}
