import { App, Modal, Setting, Notice, TFile, normalizePath } from "obsidian";
import LedgrPlugin from "../main";
import { loadCategories, saveCategories, CategoryStore } from "../data/categoryStore";
import { MigrationModal } from "./MigrationModal";

type Tab = "exchange" | "categories" | "features" | "advanced" | "danger";

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
    const tabs: { key: Tab; label: string; danger?: boolean }[] = [
      { key: "exchange", label: "Exchange Rates" },
      { key: "categories", label: "Categories" },
      { key: "features", label: "Features" },
      { key: "advanced", label: "Advanced" },
      { key: "danger", label: "New Ledger", danger: true },
    ];
    tabs.forEach(({ key, label, danger }) => {
      const btn = tabRow.createEl("button", {
        text: label,
        cls: `ledgr-tab-btn ${this.activeTab === key ? "active" : ""}${danger ? " ledgr-tab-btn--danger" : ""}`,
      });
      btn.onclick = () => { this.activeTab = key; this.render(); };
    });

    const body = contentEl.createDiv("ledgr-config-body");

    if (this.activeTab === "exchange") {
      this.renderExchangeTab(body);
    } else if (this.activeTab === "categories") {
      this.renderCategoriesTab(body);
    } else if (this.activeTab === "features") {
      this.renderFeaturesTab(body);
    } else if (this.activeTab === "advanced") {
      this.renderAdvancedTab(body);
    } else {
      this.renderDangerTab(body);
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
      btn.setButtonText("Save").setCta().onClick(() => {
        void (async () => {
          this.plugin.settings.exchangeRates.updatedAt = new Date().toISOString();
          await this.plugin.saveSettings();
          this.app.workspace.trigger("ledgr:transaction-saved"); this.app.workspace.trigger("ledgr:settings-changed");
          new Notice("Settings saved");
          this.render();
        })();
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
          this.app.workspace.trigger("ledgr:transaction-saved"); this.app.workspace.trigger("ledgr:settings-changed");
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
        .onClick(() => {
          void (async () => {
            await saveCategories(this.app, this.plugin.settings, this.categories!);
            this.app.workspace.trigger("ledgr:categories-updated");
            new Notice("Categories saved");
            this.close();
          })();
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
        const input = subRow.createEl("input", { attr: { type: "text", value: sub, class: "ledgr-inline-input" } });
        input.oninput = (e) => { group[cat][idx] = (e.target as HTMLInputElement).value; };

        const delSubBtn = subRow.createEl("button", { text: "✕", cls: "ledgr-del-btn" });
        delSubBtn.onclick = () => {
          group[cat].splice(idx, 1);
          this.render();
        };
      });

      // Add subcategory input
      const addSubRow = catBlock.createDiv("ledgr-sub-row");
      const subInput = addSubRow.createEl("input", { attr: { type: "text", placeholder: "New subcategory...", class: "ledgr-inline-input" } });
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
      const catInput = addCatRow.createEl("input", { attr: { type: "text", placeholder: "New category name...", class: "ledgr-inline-input" } });
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

  renderFeaturesTab(parent: HTMLElement) {
    // Composure exclusions
    const excluded = new Set(this.plugin.settings.composureExcludedCategories ?? []);
    const allCats = this.categories ? Object.keys(this.categories.expense) : [];

    new Setting(parent)
      .setName("Exclude from Composure")
      .setDesc("Categories excluded from spending volatility (Composure pillar). Use for business expenses that are irregular by nature.");

    if (allCats.length === 0) {
      parent.createEl("p", { text: "Load categories first.", cls: "ledgr-empty" });
    } else {
      const listWrap = parent.createDiv("ledgr-composure-exclusion-list");
      allCats.forEach((cat) => {
        const row = listWrap.createDiv("ledgr-composure-exclusion-row");
        const cb = row.createEl("input", { attr: { type: "checkbox" } });
        cb.checked = excluded.has(cat);
        cb.onchange = async () => {
          if (cb.checked) excluded.add(cat);
          else excluded.delete(cat);
          this.plugin.settings.composureExcludedCategories = Array.from(excluded);
          await this.plugin.saveSettings();
        };
        row.createEl("label", { text: cat, cls: "ledgr-meta" });
      });
    }
  }

  renderAdvancedTab(parent: HTMLElement) {
    parent.createEl("h3", { text: "Fix Legacy Transactions" });
    parent.createEl("p", {
      text: "Before v0.3.3, loan and mortgage payments were classified as Operating cash flow instead of Financing. Run this scan to correct the history.",
      cls: "setting-item-description",
    });
    const migrateBtn = parent.createEl("button", { text: "Scan & Fix loan history", cls: "ledgr-log-btn mod-cta" });
    migrateBtn.onclick = () => new MigrationModal(this.app, this.plugin).open();

    parent.createEl("p", {
      text: "This is safe to run multiple times. It only rewrites rows that are still incorrect.",
      cls: "ledgr-meta",
    });
  }

  renderDangerTab(parent: HTMLElement) {
    // ── New Ledger ───────────────────────────────────────────────────────────
    parent.createEl("h3", { text: "New Ledger" });
    parent.createEl("p", {
      text: "Start completely fresh. All financial data is deleted. Your settings (currency, folder, exchange rates) are preserved.",
      cls: "setting-item-description",
    });

    // File list preview
    const folder = this.plugin.settings.financeFolder;
    const files = [
      `${folder}/transactions/  (all monthly files)`,
      `${folder}/networth.json`,
      `${folder}/goals.json`,
      `${folder}/budgets.json`,
      `${folder}/ledgr-bills.json`,
      `${folder}/ledgr-bearing.json`,
      `${folder}/ledgr-templates.json`,
      `${folder}/ledgr-nw-history.json`,
      `${folder}/remittances.json`,
    ];

    const fileList = parent.createEl("ul", { cls: "ledgr-danger-file-list" });
    files.forEach((f) => fileList.createEl("li", { text: f, cls: "ledgr-empty" }));

    parent.createEl("p", {
      text: "Categories you created are preserved.",
      cls: "ledgr-meta",
    });

    parent.createDiv("ledgr-bearing-rule-thin");

    // Confirmation — case-insensitive, mobile-safe
    parent.createEl("p", { text: 'Type "NEW LEDGER" to confirm:', cls: "ledgr-meta" });
    const confirmInput = parent.createEl("input", {
      attr: {
        type: "text",
        placeholder: "NEW LEDGER",
        class: "ledgr-inline-input",
        autocapitalize: "characters",
        autocorrect: "off",
        spellcheck: "false",
      },
    }) as HTMLInputElement;
    confirmInput.setCssStyles({ width: "140px", marginBottom: "var(--ledgr-spacing-sm)" });

    const resetBtn = parent.createEl("button", {
      text: "Begin New Ledger",
      cls: "ledgr-log-btn mod-cta ledgr-danger-btn",
    });
    resetBtn.setAttribute("disabled", "true");

    confirmInput.oninput = () => {
      // Case-insensitive comparison — defensive against iOS auto-capitalise
      if (confirmInput.value.trim().toUpperCase() === "NEW LEDGER") {
        resetBtn.removeAttribute("disabled");
      } else {
        resetBtn.setAttribute("disabled", "true");
      }
    };

    resetBtn.onclick = () => { void this.executeReset(); };
  }

  async executeReset() {
    const folder = this.plugin.settings.financeFolder;

    // Files to delete
    const filePaths = [
      `${folder}/networth.json`,
      `${folder}/goals.json`,
      `${folder}/budgets.json`,
      `${folder}/ledgr-bills.json`,
      `${folder}/ledgr-bearing.json`,
      `${folder}/ledgr-templates.json`,
      `${folder}/ledgr-nw-history.json`,
      `${folder}/remittances.json`,
    ];

    // Delete individual data files
    for (const path of filePaths) {
      try {
        const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
        if (file instanceof TFile) await this.app.vault.delete(file);
      } catch { /* file may not exist — continue */ }
    }

    // Delete all transaction files in the transactions folder
    try {
      const txFolder = normalizePath(`${folder}/transactions`);
      const txFiles = this.app.vault.getFiles().filter((f) => f.path.startsWith(txFolder) && f.extension === "md");
      for (const file of txFiles) {
        try { await this.app.vault.delete(file); } catch { /* continue */ }
      }
    } catch { /* folder may not exist */ }

    // Reset firstRun to trigger onboarding
    this.plugin.settings.firstRun = true;
    // Clear session-specific settings that don't belong to the new ledger
    this.plugin.settings.ocfCommitments = {};
    await this.plugin.saveSettings();

    new Notice("All Ledgr data deleted. Starting your new ledger.");
    this.close();

    // Open onboarding
    window.setTimeout(() => {
      const { OnboardingModal } = require("./OnboardingModal") as { OnboardingModal: new (app: App, plugin: LedgrPlugin) => Modal };
      new OnboardingModal(this.app, this.plugin).open();
    }, 300);
  }

  onClose() {
    this.contentEl.empty();
  }
}
