import { App, Modal, Setting, Notice, TFile, normalizePath } from "obsidian";
import LedgrPlugin from "../main";
import { readMonthTransactions, summarize, convertToBase } from "../data/reader";
import { loadBudgets } from "../data/budgets";
import { loadRemittances } from "../data/remittances";
import { loadGoals } from "../data/goals";
import { loadNetWorth } from "../data/networth";

export class MonthlyReviewModal extends Modal {
  plugin: LedgrPlugin;
  selectedMonth: string;
  outputFolder: string;
  overwriteWarning = false;

  constructor(app: App, plugin: LedgrPlugin) {
    super(app);
    this.plugin = plugin;
    this.selectedMonth = window.moment().subtract(1, "month").format("YYYY-MM");
    this.outputFolder = `${plugin.settings.financeFolder}/reviews`;
  }

  onOpen() { this.render(); }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Generate Monthly Review" });

    // Month selector
    const monthRow = contentEl.createDiv("ledgr-month-row ledgr-row-spaced");
    const prevBtn = monthRow.createEl("button", { text: "←" });
    prevBtn.onclick = () => {
      this.selectedMonth = window.moment(this.selectedMonth).subtract(1, "month").format("YYYY-MM");
      this.overwriteWarning = false;
      this.render();
    };
    monthRow.createEl("span", {
      text: window.moment(this.selectedMonth).format("MMMM YYYY"),
      cls: "ledgr-month-label",
    });
    const nextBtn = monthRow.createEl("button", { text: "→" });
    nextBtn.onclick = () => {
      this.selectedMonth = window.moment(this.selectedMonth).add(1, "month").format("YYYY-MM");
      this.overwriteWarning = false;
      this.render();
    };

    new Setting(contentEl)
      .setName("Output folder")
      .addText((t) => t.setValue(this.outputFolder).onChange((v) => (this.outputFolder = v)));

    if (this.overwriteWarning) {
      const warn = contentEl.createDiv("ledgr-rate-banner");
      warn.createEl("span", { text: `${this.selectedMonth}-review.md already exists. ` });
      const overwriteBtn = warn.createEl("a", { text: "Overwrite →" });
      overwriteBtn.onclick = async () => { await this.generate(true); };
    }

    contentEl.createEl("p", { cls: "ledgr-error ledgr-error-review ledgr-hidden", text: "" });

    new Setting(contentEl).addButton((btn) =>
      btn.setButtonText("Generate").setCta().onClick(() => this.generate(false))
    );
  }

  async generate(force: boolean) {
    const base = this.plugin.settings.baseCurrency;
    const rates = this.plugin.settings.exchangeRates;
    const fmt = (n: number) => `${base} ${Math.round(n).toLocaleString()}`;
    const fmtParens = (n: number) => n < 0 ? `(${base} ${Math.round(Math.abs(n)).toLocaleString()})` : fmt(n);

    const filePath = normalizePath(`${this.outputFolder}/${this.selectedMonth}-review.md`);

    // Check overwrite
    if (!force && this.app.vault.getAbstractFileByPath(filePath)) {
      this.overwriteWarning = true;
      this.render();
      return;
    }

    // Ensure folder
    if (!this.app.vault.getAbstractFileByPath(normalizePath(this.outputFolder))) {
      await this.app.vault.createFolder(normalizePath(this.outputFolder));
    }

    const prevMonth = window.moment(this.selectedMonth).subtract(1, "month").format("YYYY-MM");
    const [transactions, prevTxs, budgets, remitStore, goalsStore, netWorth] = await Promise.all([
      readMonthTransactions(this.app, this.plugin.settings, this.selectedMonth),
      readMonthTransactions(this.app, this.plugin.settings, prevMonth),
      loadBudgets(this.app, this.plugin.settings),
      loadRemittances(this.app, this.plugin.settings),
      loadGoals(this.app, this.plugin.settings),
      loadNetWorth(this.app, this.plugin.settings),
    ]);
    const summary = summarize(transactions, base, rates);
    const prevSummary = summarize(prevTxs, base, rates);
    const monthLabel = window.moment(this.selectedMonth).format("MMMM YYYY");
    const today = window.moment().format("YYYY-MM-DD");

    const lines: string[] = [
      `---`,
      `month: ${this.selectedMonth}`,
      `generated: ${today}`,
      `tags: [finance, review, monthly]`,
      `---`,
      ``,
      `# ${monthLabel} — Monthly Review`,
      ``,
      `> A private record.`,
      ``,
      `---`,
      ``,
      `## Overview`,
      ``,
      `| | Amount |`,
      `|---|---:|`,
      `| **Income** | ${fmt(summary.totalIncome)} |`,
      `| **Expenses** | ${fmtParens(-summary.totalExpenses)} |`,
      `| **Net Savings** | **${fmt(summary.net)}** |`,
      `| Savings Rate | **${summary.savingsRate}%** |`,
      ``,
      `---`,
      ``,
      `## Spending by Category`,
      ``,
    ];

    if (Object.keys(summary.byCategory).length === 0) {
      lines.push(`> [!note] No expense transactions were logged for this month.`);
    } else {
      lines.push(`| Category | Spent | Budget | Status |`);
      lines.push(`|---|---:|---:|---|`);
      Object.entries(summary.byCategory).sort((a, b) => b[1] - a[1]).forEach(([cat, amt]) => {
        const budget = budgets.limits[cat]
          ? convertToBase(budgets.limits[cat], budgets.currency, base, rates)
          : null;
        const status = budget ? (amt > budget ? "**over**" : "on track") : "—";
        lines.push(`| ${cat} | ${fmt(amt)} | ${budget ? fmt(budget) : "—"} | ${status} |`);
      });
    }

    lines.push(``, `---`, ``);

    // Transfers
    const monthTransfers = remitStore.remittances.filter((r) => r.date.startsWith(this.selectedMonth));
    if (monthTransfers.length > 0) {
      lines.push(`## Transfers`, ``, `| Date | Service | Sent | Received | Rate |`, `|---|---|---:|---:|---|`);
      monthTransfers.forEach((r) => {
        lines.push(`| ${r.date} | ${r.service} | ${base} ${r.amountJPY.toLocaleString()} | ${r.amountPHP.toLocaleString()} | ${r.rateAtSend} |`);
      });
      const totalSent = monthTransfers.reduce((s, r) => s + r.amountJPY, 0);
      const totalFees = monthTransfers.reduce((s, r) => s + r.feeJPY, 0);
      lines.push(``, `**Total sent:** ${base} ${totalSent.toLocaleString()} · **Fees:** ${base} ${totalFees.toLocaleString()}`);
      lines.push(``, `---`, ``);
    }

    // Notable transactions (top 5)
    const notable = [...transactions].filter((t) => t.type === "expense")
      .sort((a, b) => b.amount - a.amount).slice(0, 5);
    lines.push(`## Notable Transactions`, ``);
    if (notable.length === 0) {
      lines.push(`*No expense transactions logged.*`);
    } else {
      notable.forEach((t) => {
        lines.push(`- ${t.date} · ${t.category} · ${t.subcategory} — ${t.currency} ${t.amount.toLocaleString()}${t.note ? ` *(${t.note})*` : ""}`);
      });
    }
    lines.push(``, `---`, ``);

    // Observations (blank for user)
    lines.push(`## Notes`, ``, `- `, ``, `---`, ``);

    // Goals
    if (goalsStore.goals.length > 0) {
      lines.push(`## Goals Progress`, ``, `| Goal | Target | % |`, `|---|---:|---|`);
      const bankTotal = (netWorth.accounts ?? []).filter((a: any) => !a.isLiability)
        .reduce((s: number, a: any) => s + convertToBase(a.balance, a.currency, base, rates), 0);
      goalsStore.goals.forEach((g) => {
        const current = bankTotal;
        const pct = Math.min(100, Math.round((current / g.targetAmount) * 100));
        lines.push(`| ${g.name} | ${g.currency} ${g.targetAmount.toLocaleString()} | ${pct}% |`);
      });
      lines.push(``, `---`, ``);
    }

    // vs last month
    if (prevTxs.length > 0) {
      const incChange = prevSummary.totalIncome > 0 ? Math.round(((summary.totalIncome - prevSummary.totalIncome) / prevSummary.totalIncome) * 100) : null;
      const expChange = prevSummary.totalExpenses > 0 ? Math.round(((summary.totalExpenses - prevSummary.totalExpenses) / prevSummary.totalExpenses) * 100) : null;
      lines.push(`## vs. Last Month`, ``);
      if (incChange !== null) lines.push(`- Income: ${incChange >= 0 ? "+" : ""}${incChange}% vs ${window.moment(prevMonth).format("MMMM YYYY")}`);
      if (expChange !== null) lines.push(`- Expenses: ${expChange >= 0 ? "+" : ""}${expChange}% vs ${window.moment(prevMonth).format("MMMM YYYY")}`);
      lines.push(`- Savings Rate: ${summary.savingsRate}% vs ${prevSummary.savingsRate}% last month`);
      lines.push(``, `---`, ``);
    }

    lines.push(`*Generated by Ledgr · ${today}*`);

    const content = lines.join("\n");
    const existing = this.app.vault.getAbstractFileByPath(filePath);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, content);
    } else {
      await this.app.vault.create(filePath, content);
    }

    new Notice(`Monthly review generated: ${this.selectedMonth}-review.md`);
    this.close();
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (file) void this.app.workspace.openLinkText(filePath, "", false);
  }

  onClose() { this.contentEl.empty(); }
}
