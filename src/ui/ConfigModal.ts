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

  // Snapshot of category names before editing — taken once when the tab first loads, not on re-render
  private originalCategoryNames: { expense: string[]; income: string[] } = { expense: [], income: [] };
  private _categorySnapshotTaken = false;

  renderCategoriesTab(parent: HTMLElement) {
    if (!this.categories) return;

    // Take snapshot only once — re-renders (e.g. from adding a subcategory) must not reset the baseline
    if (!this._categorySnapshotTaken) {
      this.originalCategoryNames = {
        expense: Object.keys(this.categories.expense),
        income: Object.keys(this.categories.income),
      };
      this._categorySnapshotTaken = true;
    }

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
            // Migrate renamed categories in transaction files
            await this.migrateRenamedCategories();
            new Notice("Categories saved");
            this.close();
          })();
        })
    );
  }

  async migrateRenamedCategories() {
    if (!this.categories) return;
    const newExpense = Object.keys(this.categories.expense);
    const oldNames = this.originalCategoryNames.expense;

    // Detect renames by set diff: names removed from old set paired with names added to new set.
    // Only proceed when counts are equal (no additions or deletions) — position-based pairing is
    // unreliable when the list length changed, and would silently corrupt historical data.
    const removed = oldNames.filter((n) => !newExpense.includes(n));
    const added = newExpense.filter((n) => !oldNames.includes(n));

    if (removed.length === 0 || added.length === 0) return; // no renames detected
    if (removed.length !== added.length) {
      // Mixed add/rename session — skip migration to avoid incorrect pairing
      new Notice(
        `Categories saved. Rename migration skipped — please rename categories one at a time to update historical transactions.`,
        6000
      );
      return;
    }

    // Build rename pairs: removed[i] → added[i] (order-stable within each diff)
    const renames: { old: string; new: string }[] = removed.map((o, i) => ({ old: o, new: added[i] }));

    // Show confirmation modal before touching any transaction files
    const summary = renames.map((r) => `"${r.old}" → "${r.new}"`).join(", ");
    const confirmed = await new Promise<boolean>((resolve) => {
      const modal = new ConfirmRenameModal(this.app, summary, resolve);
      modal.open();
    });
    if (!confirmed) {
      new Notice("Rename migration cancelled — categories saved, transactions unchanged.");
      return;
    }

    const folder = normalizePath(`${this.plugin.settings.financeFolder}/transactions`);
    const txFiles = this.app.vault.getFiles().filter((f) => f.path.startsWith(folder) && f.extension === "md");

    new Notice(`Updating ${txFiles.length} transaction file${txFiles.length !== 1 ? "s" : ""}…`);
    let count = 0;
    for (const file of txFiles) {
      let content = await this.app.vault.read(file);
      let changed = false;
      for (const { old: oldCat, new: newCat } of renames) {
        const escaped = oldCat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        // Replace in pipe-delimited rows (category is col 5)
        const rowRegex = new RegExp(`(\\| [^|]+ \\| [^|]+ \\| [^|]+ \\| [^|]+ \\| )${escaped}( \\|)`, "g");
        const dvRegex = new RegExp(`\\[category:: ${escaped}\\]`, "g");
        const newContent = content.replace(rowRegex, `$1${newCat}$2`).replace(dvRegex, `[category:: ${newCat}]`);
        if (newContent !== content) { content = newContent; changed = true; count++; }
      }
      if (changed) await this.app.vault.modify(file, content);
    }
    if (count > 0) new Notice(`Renamed category in ${count} transaction${count !== 1 ? "s" : ""}.`);
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
    // Calendar week start
    new Setting(parent)
      .setName("Calendar week start")
      .setDesc("Choose whether your calendar week begins on Monday (ISO) or Sunday.")
      .addDropdown((d) => {
        d.addOption("monday", "Monday");
        d.addOption("sunday", "Sunday");
        d.setValue(this.plugin.settings.calendarWeekStart ?? "monday");
        d.onChange(async (v) => {
          this.plugin.settings.calendarWeekStart = v as "monday" | "sunday";
          await this.plugin.saveSettings();
          this.app.workspace.trigger("ledgr:settings-changed");
        });
      });

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
      text: "Start completely fresh. All financial data below will be permanently deleted. Your settings — currency, folder, exchange rates — are preserved.",
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
      text: "Categories you created are preserved. Monthly OCF targets are cleared.",
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

    // Permanently delete data files (vault.delete is compatible with all minAppVersion targets)
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
    this.plugin.settings.templatesAppliedMonths = [];
    await this.plugin.saveSettings();

    new Notice("All Ledgr data deleted. Starting your new ledger.");
    this.close();

    // Open onboarding via dynamic import (avoids circular dependency and require())
    window.setTimeout(() => {
      void import("./OnboardingModal")
        .then(({ OnboardingModal }) => {
          new OnboardingModal(this.app, this.plugin).open();
        })
        .catch(() => {
          new Notice("Setup wizard failed to open. Click the wallet icon or restart Obsidian to begin.");
        });
    }, 500); // 500ms matches plugin startup delay — ensures ConfigModal fully closes first
  }

  onClose() {
    this.contentEl.empty();
  }
}

class ConfirmRenameModal extends Modal {
  private summary: string;
  private resolve: (confirmed: boolean) => void;

  constructor(app: App, summary: string, resolve: (confirmed: boolean) => void) {
    super(app);
    this.summary = summary;
    this.resolve = resolve;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h2", { text: "Update historical transactions?" });
    contentEl.createEl("p", {
      text: "The following category renames will be applied to all your transaction files:",
      cls: "setting-item-description",
    });
    contentEl.createEl("p", { text: this.summary, cls: "ledgr-meta" });
    contentEl.createEl("p", {
      text: "This rewrites your transaction markdown files. It cannot be undone from within Ledgr (use git or your vault backup to revert).",
      cls: "setting-item-description",
    });

    const btnRow = contentEl.createDiv("ledgr-btn-row");
    const applyBtn = btnRow.createEl("button", { text: "Apply rename", cls: "ledgr-log-btn mod-cta" });
    const cancelBtn = btnRow.createEl("button", { text: "Skip", cls: "ledgr-log-btn" });

    applyBtn.onclick = () => { this.resolve(true); this.close(); };
    cancelBtn.onclick = () => { this.resolve(false); this.close(); };
  }

  onClose() {
    this.contentEl.empty();
  }
}
