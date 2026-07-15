import { App, Modal, Setting, Notice, TFile, normalizePath } from "obsidian";
import LedgrPlugin from "../main";
import { readAllTransactions, summarize, convertToBase } from "../data/reader";
import { loadRemittances } from "../data/remittances";
import { loadNetWorth, Account } from "../data/networth";
import { loadGoals } from "../data/goals";

export class WrappedModal extends Modal {
  plugin: LedgrPlugin;
  selectedYear: string;
  overwriteWarning = false;

  constructor(app: App, plugin: LedgrPlugin) {
    super(app);
    this.plugin = plugin;
    const currentMonth = parseInt(window.moment().format("MM"));
    this.selectedYear = currentMonth === 1
      ? String(parseInt(window.moment().format("YYYY")) - 1)
      : window.moment().format("YYYY");
  }

  onOpen() { this.render(); }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Ledgr Wrapped" });
    contentEl.createEl("p", { text: "Generate your year-end summary.", cls: "ledgr-onboarding-sub" });

    const yearRow = contentEl.createDiv("ledgr-month-row ledgr-row-spaced");
    yearRow.createEl("button", { text: "←" }).onclick = () => {
      this.selectedYear = String(parseInt(this.selectedYear) - 1);
      this.overwriteWarning = false;
      this.render();
    };
    yearRow.createEl("span", { text: this.selectedYear, cls: "ledgr-month-label" });
    yearRow.createEl("button", { text: "→" }).onclick = () => {
      this.selectedYear = String(parseInt(this.selectedYear) + 1);
      this.overwriteWarning = false;
      this.render();
    };

    if (this.overwriteWarning) {
      const warn = contentEl.createDiv("ledgr-rate-banner");
      warn.createEl("span", { text: `${this.selectedYear}-wrapped.md already exists. ` });
      warn.createEl("a", { text: "Overwrite →" }).onclick = async () => { await this.generate(true); };
    }

    contentEl.createEl("p", { cls: "ledgr-error ledgr-error-wrapped ledgr-hidden", text: "" });

    new Setting(contentEl).addButton((btn) =>
      btn.setButtonText("Generate Wrapped").setCta().onClick(() => this.generate(false))
    );
  }

  async generate(force: boolean) {
    const base = this.plugin.settings.baseCurrency;
    const rates = this.plugin.settings.exchangeRates;
    const fmt = (n: number) => `${base} ${Math.round(n).toLocaleString()}`;
    const today = window.moment().format("YYYY-MM-DD");
    const outputFolder = `${this.plugin.settings.financeFolder}/reviews`;
    const filePath = normalizePath(`${outputFolder}/${this.selectedYear}-wrapped.md`);

    if (!force && this.app.vault.getAbstractFileByPath(filePath)) {
      this.overwriteWarning = true; this.render(); return;
    }
    if (!this.app.vault.getAbstractFileByPath(normalizePath(outputFolder))) {
      await this.app.vault.adapter.mkdir(normalizePath(outputFolder));
    }

    const allTxs = await readAllTransactions(this.app, this.plugin.settings, this.selectedYear);
    if (allTxs.length === 0) {
      const errEl = this.contentEl.querySelector<HTMLElement>(".ledgr-error-wrapped");
      if (errEl) { errEl.textContent = `No transactions found for ${this.selectedYear}. Cannot generate.`; errEl.removeClass("ledgr-hidden"); }
      return;
    }

    // Group by month
    const byMonth: Record<string, typeof allTxs> = {};
    allTxs.forEach((t) => {
      const m = t.date.substring(0, 7);
      if (!byMonth[m]) byMonth[m] = [];
      byMonth[m].push(t);
    });

    const monthlySummaries = Object.entries(byMonth).map(([month, txs]) => ({
      month,
      ...summarize(txs, base, rates),
    }));

    const yearSummary = summarize(allTxs, base, rates);
    const remitStore = await loadRemittances(this.app, this.plugin.settings);
    const yearTransfers = remitStore.remittances.filter((r) => r.date.startsWith(this.selectedYear));
    const netWorthData = await loadNetWorth(this.app, this.plugin.settings);
    const goalsStore = await loadGoals(this.app, this.plugin.settings);

    // Best/worst months
    const withIncome = monthlySummaries.filter((m) => m.totalIncome > 0);
    const bestMonth = withIncome.reduce((best, m) => m.savingsRate > best.savingsRate ? m : best, withIncome[0]);
    const worstMonth = withIncome.reduce((worst, m) => m.savingsRate < worst.savingsRate ? m : worst, withIncome[0]);

    // Most improved
    let mostImproved: { month: string; delta: number } | null = null;
    for (let i = 1; i < monthlySummaries.length; i++) {
      const delta = monthlySummaries[i].savingsRate - monthlySummaries[i - 1].savingsRate;
      if (!mostImproved || delta > mostImproved.delta) {
        mostImproved = { month: monthlySummaries[i].month, delta };
      }
    }


    const isPartial = parseInt(this.selectedYear) >= parseInt(window.moment().format("YYYY"));

    const lines: string[] = [
      `---`,
      `year: ${this.selectedYear}`,
      `generated: ${today}`,
      `tags: [finance, wrapped, annual]`,
      `---`,
      ``,
      `# ${this.selectedYear}${isPartial ? " — Year in Progress" : " in Review"}`,
      ``,
    ];

    if (isPartial) {
      const lastMonth = Object.keys(byMonth).sort().pop();
      lines.push(`> [!note] Partial year — data through ${window.moment(lastMonth).format("MMMM YYYY")}.`, ``);
    }

    lines.push(`---`, ``, `## The Year at a Glance`, ``, `| | ${this.selectedYear} |`, `|---|---:|`);
    lines.push(`| Total Income | ${fmt(yearSummary.totalIncome)} |`);
    lines.push(`| Total Expenses | ${fmt(yearSummary.totalExpenses)} |`);
    lines.push(`| **Net Savings** | **${fmt(yearSummary.net)}** |`);
    lines.push(`| Avg Savings Rate | **${yearSummary.savingsRate}%** |`);
    if (yearTransfers.length > 0) {
      lines.push(`| Transfers Sent | ${fmt(yearTransfers.reduce((s, r) => s + r.amountJPY, 0))} |`);
    }
    lines.push(``, `---`, ``);

    // Top categories
    const topCats = Object.entries(yearSummary.byCategory).sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (topCats.length > 0) {
      lines.push(`## Where Your Money Went`, ``, `| Category | Total | % of Spending |`, `|---|---:|---:|`);
      topCats.forEach(([cat, amt]) => {
        const pct = Math.round((amt / yearSummary.totalExpenses) * 100);
        lines.push(`| ${cat} | ${fmt(amt)} | ${pct}% |`);
      });
      if (topCats.length >= 2) {
        const top2pct = Math.round(((topCats[0][1] + topCats[1][1]) / yearSummary.totalExpenses) * 100);
        lines.push(``, `> **${topCats[0][0]} and ${topCats[1][0]}** made up ${top2pct}% of all spending.`);
      }
      lines.push(``, `---`, ``);
    }

    // Highlights
    if (bestMonth) {
      lines.push(`## Your Best Month`, ``, `> **${window.moment(bestMonth.month).format("MMMM YYYY")}** — ${fmt(bestMonth.net)} saved · ${bestMonth.savingsRate}% savings rate`, ``);
      lines.push(`Your best savings month of the year.`);
      lines.push(``, `---`, ``);
    }

    if (worstMonth && worstMonth.month !== bestMonth?.month) {
      lines.push(`## Your Hardest Month`, ``, `> **${window.moment(worstMonth.month).format("MMMM YYYY")}** — ${worstMonth.net >= 0 ? fmt(worstMonth.net) + " saved" : fmt(Math.abs(worstMonth.net)) + " deficit"}`, ``);
      lines.push(`Savings rate: ${worstMonth.savingsRate}%.`);
      lines.push(``, `---`, ``);
    }

    if (mostImproved) {
      lines.push(`## Most Improved`, ``, `> **${window.moment(mostImproved.month).format("MMMM YYYY")}** — savings rate jumped +${mostImproved.delta} pts`, ``, `---`, ``);
    }

    // Monthly table
    lines.push(`## Month by Month`, ``, `| Month | Income | Expenses | Saved | Rate |`, `|---|---:|---:|---:|---|`);
    monthlySummaries.forEach((m) => {
      lines.push(`| ${window.moment(m.month).format("MMM")} | ${fmt(m.totalIncome)} | ${fmt(m.totalExpenses)} | ${fmt(m.net)} | ${m.savingsRate}% |`);
    });
    lines.push(``, `---`, ``);

    // Transfers
    if (yearTransfers.length > 0) {
      const totalSent = yearTransfers.reduce((s, r) => s + r.amountJPY, 0);
      const totalFees = yearTransfers.reduce((s, r) => s + r.feeJPY, 0);
      const avgRate = yearTransfers.reduce((s, r) => s + r.rateAtSend, 0) / yearTransfers.length;
      lines.push(`## Transfers`, ``, `| | Amount |`, `|---|---:|`);
      lines.push(`| Total sent | ${fmt(totalSent)} |`);
      lines.push(`| Avg rate | ${avgRate.toFixed(4)} |`);
      lines.push(`| Total fees paid | ${fmt(totalFees)} |`);
      lines.push(`| Number of transfers | ${yearTransfers.length} |`);
      lines.push(``, `> You sent **${fmt(totalSent)}** across ${yearTransfers.length} transfers this year.`);
      lines.push(``, `---`, ``);
    }

    // Goals
    if (goalsStore.goals.length > 0) {
      lines.push(`## Savings Goals`, ``, `| Goal | Target | % |`, `|---|---:|---|`);
      const bankTotal = (netWorthData.accounts ?? []).filter((a: Account) => !a.isLiability)
        .reduce((s: number, a: Account) => s + convertToBase(a.balance, a.currency, base, rates), 0);
      goalsStore.goals.forEach((g) => {
        const pct = Math.min(100, Math.round((bankTotal / g.targetAmount) * 100));
        lines.push(`| ${g.name} | ${g.currency} ${g.targetAmount.toLocaleString()} | ${pct}% |`);
      });
      lines.push(``, `---`, ``);
    }

    // One number
    lines.push(`## One Number`, ``);
    lines.push(`> **${fmt(yearSummary.net)}**`);
    lines.push(`>`);
    lines.push(`> That is what you kept of everything you earned this year.`);
    lines.push(``, `---`, ``);
    lines.push(`*Ledgr Wrapped · ${this.selectedYear}*`);

    const content = lines.join("\n");
    const existing = this.app.vault.getAbstractFileByPath(filePath);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, content);
    } else {
      await this.app.vault.create(filePath, content);
    }

    new Notice(`Wrapped generated: ${this.selectedYear}-wrapped.md`);
    this.close();
    void this.app.workspace.openLinkText(filePath, "", false);
  }

  onClose() { this.contentEl.empty(); }
}
