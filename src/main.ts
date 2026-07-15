import { Plugin, Platform } from "obsidian";
import { LedgrSettings, DEFAULT_SETTINGS } from "./settings";
import { LedgrSettingTab } from "./ui/SettingTab";
import { QuickCaptureModal } from "./ui/QuickCaptureModal";
import { DashboardView, DASHBOARD_VIEW_TYPE } from "./ui/DashboardView";
import { NetWorthView, NETWORTH_VIEW_TYPE } from "./ui/NetWorthView";
import { ConfigModal } from "./ui/ConfigModal";
import { RemittanceModal } from "./ui/RemittanceModal";
import { OnboardingModal } from "./ui/OnboardingModal";
import { StatementsView, STATEMENTS_VIEW_TYPE } from "./ui/StatementsView";
import { MonthlyReviewModal } from "./ui/MonthlyReviewModal";
import { WrappedModal } from "./ui/WrappedModal";

export default class LedgrPlugin extends Plugin {
  settings: LedgrSettings;

  async onload() {
    await this.loadSettings();

    this.registerView(DASHBOARD_VIEW_TYPE, (leaf) => new DashboardView(leaf, this));
    this.registerView(NETWORTH_VIEW_TYPE, (leaf) => new NetWorthView(leaf, this));
    this.registerView(STATEMENTS_VIEW_TYPE, (leaf) => new StatementsView(leaf, this));

    this.addRibbonIcon("wallet", "Ledgr — Open dashboard", () => {
      void this.openDashboard();
    });

    // Show onboarding on first run
    if (this.settings.firstRun) {
      window.setTimeout(() => new OnboardingModal(this.app, this).open(), 500);
    }

    // Auto-append to daily note when enabled
    this.registerEvent(
      this.app.workspace.on("ledgr:transaction-saved" as any, async () => {
        if (this.settings.appendToDailyNote) {
          await this.appendToDailyNote();
        }
      })
    );

    this.addSettingTab(new LedgrSettingTab(this.app, this));

    this.addCommand({
      id: "log-transaction",
      name: "Log transaction",
      callback: () => {
        new QuickCaptureModal(this.app, this.settings).open();
      },
    });

    this.addCommand({
      id: "open-dashboard",
      name: "Open dashboard",
      callback: () => { void this.openDashboard(); },
    });

    this.addCommand({
      id: "open-networth",
      name: "Open net worth",
      callback: () => { void this.openView(NETWORTH_VIEW_TYPE); },
    });

    this.addCommand({
      id: "open-config",
      name: "Settings (exchange rates & categories)",
      callback: () => { new ConfigModal(this.app, this).open(); },
    });

    this.addCommand({
      id: "log-transfer",
      name: "Log transfer",
      callback: () => { new RemittanceModal(this.app, this).open(); },
    });

    this.addCommand({
      id: "append-daily-note",
      name: "Append today's spending to daily note",
      callback: () => { void this.appendToDailyNote(); },
    });

    this.addCommand({
      id: "open-statements",
      name: "Open financial statements",
      callback: () => { void this.openView(STATEMENTS_VIEW_TYPE); },
    });

    this.addCommand({
      id: "monthly-review",
      name: "Generate monthly review note",
      callback: () => { new MonthlyReviewModal(this.app, this).open(); },
    });

    this.addCommand({
      id: "wrapped",
      name: "Generate year-end summary (Wrapped)",
      callback: () => { new WrappedModal(this.app, this).open(); },
    });

    console.log("Ledgr loaded");
  }

  async appendToDailyNote() {
    try {
    const today = window.moment().format("YYYY-MM-DD");
    const month = window.moment().format("YYYY-MM");

    // Find daily note — try Obsidian's built-in daily notes config first
    const dailyNotesPlugin = (this.app as any).internalPlugins?.getPluginById("daily-notes");
    const folder = this.settings.dailyNotePath ||
      dailyNotesPlugin?.instance?.options?.folder || "";
    const format = dailyNotesPlugin?.instance?.options?.format || "YYYY-MM-DD";
    const fileName = window.moment().format(format) + ".md";
    const filePath = folder ? `${folder}/${fileName}` : fileName;

    const { readMonthTransactions, summarize } = await import("./data/reader");
    const transactions = await readMonthTransactions(this.app, this.settings, month);
    const todayTxs = transactions.filter((t) => t.date === today);
    const summary = summarize(transactions, this.settings.baseCurrency, this.settings.exchangeRates);

    const base = this.settings.baseCurrency;
    const fmt = (n: number) => `${base} ${Math.round(n).toLocaleString()}`;

    const lines = [
      "",
      "## Ledgr — Today's Spending",
      "",
    ];

    if (todayTxs.length === 0) {
      lines.push("No transactions logged today.");
    } else {
      todayTxs.forEach((tx) => {
        const prefix = tx.type === "income" ? "+" : "-";
        lines.push(`- ${prefix}${tx.currency} ${tx.amount.toLocaleString()} — ${tx.subcategory}${tx.note ? ` (${tx.note})` : ""}`);
      });
    }

    lines.push("");
    lines.push(`**Month to date:** Income ${fmt(summary.totalIncome)} · Expenses ${fmt(summary.totalExpenses)} · Saved ${fmt(summary.net)}`);
    if (summary.savingsRate !== undefined && summary.totalIncome > 0) {
      lines.push(`**Savings rate:** ${summary.savingsRate}%`);
    }
    lines.push("");

    const section = lines.join("\n");

    const { TFile, normalizePath } = await import("obsidian");
    const file = this.app.vault.getAbstractFileByPath(normalizePath(filePath));

    if (file instanceof TFile) {
      const content = await this.app.vault.read(file);
      await this.app.vault.modify(file, content + section);
      const { Notice } = await import("obsidian");
      new Notice(`Ledgr summary appended to ${fileName}`);
    } else {
      const { Notice } = await import("obsidian");
      new Notice(`Daily note not found: ${filePath}. Set the path in Ledgr Settings.`);
    }
    } catch (e) {
      console.error("Ledgr: Failed to append to daily note", e);
    }
  }

  async openDashboard() {
    await this.openView(DASHBOARD_VIEW_TYPE);
  }

  async openView(viewType: string) {
    const existing = this.app.workspace.getLeavesOfType(viewType);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    // On mobile, use the active leaf instead of opening a new tab
    const leaf = Platform.isMobile
      ? this.app.workspace.getLeaf(false)
      : this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: viewType, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  onunload() {
    console.log("Ledgr unloaded");
  }

  async loadSettings() {
    const saved = await this.loadData() ?? {};

    // Migrate old exchangeRates format: { JPY_PHP, JPY_USD } → { rates: {...} }
    if (saved.exchangeRates && !saved.exchangeRates.rates) {
      saved.exchangeRates = {
        rates: {
          JPY_PHP: saved.exchangeRates.JPY_PHP ?? 0.38,
          JPY_USD: saved.exchangeRates.JPY_USD ?? 0.0065,
        },
        updatedAt: saved.exchangeRates.updatedAt ?? "",
      };
    }

    // Migrate old field names
    if (saved.lastUsedRemittanceService && !saved.lastUsedTransferService) {
      saved.lastUsedTransferService = saved.lastUsedRemittanceService;
    }
    if (saved.remittanceServiceFees && !saved.transferServiceFees) {
      saved.transferServiceFees = saved.remittanceServiceFees;
    }

    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
