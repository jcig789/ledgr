import { ItemView, WorkspaceLeaf, TFile, normalizePath, Notice, Events } from "obsidian";
import LedgrPlugin from "../main";
import { readMonthTransactions, summarize } from "../data/reader";
import { Currency } from "../settings";
import { QuickCaptureModal } from "./QuickCaptureModal";
import { BudgetModal } from "./BudgetModal";
import { ConfigModal } from "./ConfigModal";
import { RemittanceModal } from "./RemittanceModal";
import { renderNavBar } from "./NavBar";
import { loadBudgets } from "../data/budgets";
import { convertToBase } from "../data/reader";
import { loadRemittances, getRemittanceSummary, RemittanceStore, Remittance } from "../data/remittances";
import { BudgetConfig } from "../data/budgets";
import { getCategoryType } from "../constants/categories";
import { renderDonutChart, buildSpendingSegments, renderGauge, renderTrendLine, categoryColor } from "./charts";
import { EditTransactionModal } from "./EditTransactionModal";

export const DASHBOARD_VIEW_TYPE = "ledgr-dashboard";

export class DashboardView extends ItemView {
  plugin: LedgrPlugin;
  currentMonth: string;
  viewCurrency: Currency;
  private pendingDelete: { month: string; lineIndex: number; timer: number } | null = null;
  private isLiveMonth = true;

  constructor(leaf: WorkspaceLeaf, plugin: LedgrPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.currentMonth = window.moment().format("YYYY-MM");
    this.viewCurrency = plugin.settings.baseCurrency;
  }

  getViewType() { return DASHBOARD_VIEW_TYPE; }
  getDisplayText() { return "Ledgr"; }
  getIcon() { return "wallet"; }

  async onOpen() {
    await this.render();
    this.registerEvent(
      (this.app.workspace as Events).on("ledgr:transaction-saved", async () => {
        await this.render();
      })
    );
  }

  async render() {
    if (this.isLiveMonth) {
      this.currentMonth = window.moment().format("YYYY-MM");
    }

    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ledgr-dashboard");

    const transactions = await readMonthTransactions(this.app, this.plugin.settings, this.currentMonth);
    const prevMonth = window.moment(this.currentMonth).subtract(1, "month").format("YYYY-MM");
    const prevTransactions = await readMonthTransactions(this.app, this.plugin.settings, prevMonth);
    const summary = summarize(transactions, this.viewCurrency, this.plugin.settings.exchangeRates);
    const prevSummary = summarize(prevTransactions, this.viewCurrency, this.plugin.settings.exchangeRates);
    const budgetConfig = await loadBudgets(this.app, this.plugin.settings);
    const remittanceStore = await loadRemittances(this.app, this.plugin.settings);
    const remitSummary = getRemittanceSummary(remittanceStore, this.currentMonth);

    const fmt = (n: number) => `${this.viewCurrency} ${Math.round(n).toLocaleString()}`;
    const isCurrentMonth = this.currentMonth >= window.moment().format("YYYY-MM");

    // ── Nav bar (always first, same position across all views) ──
    renderNavBar(contentEl, this.app, this.plugin, "dashboard");

    // ── Controls bar: Row 1 — currency left, actions right ──
    const header = contentEl.createDiv("ledgr-header");

    const row1 = header.createDiv("ledgr-controls-row");
    const allCurrencies = [this.plugin.settings.baseCurrency, ...this.plugin.settings.secondaryCurrencies];
    const currencyRow = row1.createDiv("ledgr-currency-row");
    allCurrencies.forEach((c) => {
      const btn = currencyRow.createEl("button", {
        text: c,
        cls: `ledgr-currency-btn ${c === this.viewCurrency ? "active" : ""}`,
      });
      btn.setAttribute("aria-label", `View in ${c}`);
      btn.onclick = async () => { this.viewCurrency = c; await this.render(); };
    });

    // Action buttons — right side
    const btnRow = row1.createDiv("ledgr-btn-row");
    const logBtn = btnRow.createEl("button", { text: "+ Log", cls: "ledgr-log-btn mod-cta" });
    logBtn.onclick = () => new QuickCaptureModal(this.app, this.plugin.settings).open();
    if (this.plugin.settings.enableTransferTracker) {
      const remitBtn = btnRow.createEl("button", { text: "Log Transfer", cls: "ledgr-budget-btn" });
      remitBtn.onclick = () => new RemittanceModal(this.app, this.plugin).open();
    }
    const budgetBtn = btnRow.createEl("button", { text: "Budgets", cls: "ledgr-budget-btn" });
    budgetBtn.onclick = () => new BudgetModal(this.app, this.plugin).open();
    const configBtn = btnRow.createEl("button", { text: "Settings", cls: "ledgr-budget-btn ledgr-config-btn" });
    configBtn.setAttribute("aria-label", "Settings");
    configBtn.onclick = () => new ConfigModal(this.app, this.plugin).open();

    // Row 2: month navigation (full width, centered)
    const monthRow = header.createDiv("ledgr-month-row");
    const prevBtn = monthRow.createEl("button", { text: "←" });
    prevBtn.setAttribute("aria-label", "Previous month");
    prevBtn.onclick = async () => {
      this.isLiveMonth = false;
      this.currentMonth = window.moment(this.currentMonth).subtract(1, "month").format("YYYY-MM");
      await this.render();
    };
    monthRow.createEl("span", {
      text: window.moment(this.currentMonth).format("MMMM YYYY"),
      cls: "ledgr-month-label",
    });
    const nextBtn = monthRow.createEl("button", { text: "→" });
    nextBtn.setAttribute("aria-label", "Next month");
    if (isCurrentMonth) {
      nextBtn.setAttribute("disabled", "true");
      nextBtn.addClass("ledgr-btn-disabled");
    } else {
      nextBtn.onclick = async () => {
        const next = window.moment(this.currentMonth).add(1, "month").format("YYYY-MM");
        this.currentMonth = next;
        this.isLiveMonth = next >= window.moment().format("YYYY-MM");
        await this.render();
      };
    }

    // Row 4: exchange rate staleness banner (conditional)
    const rates = this.plugin.settings.exchangeRates;
    if (!rates.updatedAt || window.moment().diff(window.moment(rates.updatedAt), "days") > 7) {
      const banner = header.createDiv("ledgr-rate-banner");
      const msg = !rates.updatedAt
        ? "Exchange rates not set — PHP totals may be inaccurate."
        : `Exchange rates updated ${window.moment().diff(window.moment(rates.updatedAt), "days")} days ago.`;
      banner.createEl("span", { text: msg });
      const updateLink = banner.createEl("a", { text: " Update now →", cls: "ledgr-rate-banner-link" });
      updateLink.onclick = () => new ConfigModal(this.app, this.plugin).open();
    }

    // First-run / empty state
    if (transactions.length === 0 && prevTransactions.length === 0 && remittanceStore.remittances.length === 0) {
      this.renderFirstRun(contentEl);
      return;
    }

    // Summary row: cards + gauge side by side
    const hasRemittances = summary.totalRemittances > 0;
    const summaryRow = contentEl.createDiv("ledgr-summary-row");

    const cards = summaryRow.createDiv(`ledgr-cards${hasRemittances ? " ledgr-cards-4" : ""}`);
    this.createCard(cards, "Income", fmt(summary.totalIncome), "ledgr-income",
      prevSummary.totalIncome > 0 ? this.trend(summary.totalIncome, prevSummary.totalIncome) : null);
    this.createCard(cards, "Expenses", fmt(summary.totalExpenses), "ledgr-expense",
      prevSummary.totalExpenses > 0 ? this.trend(summary.totalExpenses, prevSummary.totalExpenses, true) : null);
    if (hasRemittances) {
      this.createCard(cards, "Transferred", fmt(summary.totalRemittances), "ledgr-sent");
    }
    this.createCard(cards, "Saved", fmt(summary.net), summary.net >= 0 ? "ledgr-positive" : "ledgr-negative",
      prevSummary.net !== 0 ? this.trend(summary.net, prevSummary.net) : null);

    // Gauge sits to the right of cards when income exists
    if (summary.totalIncome > 0) {
      const gaugeWrap = summaryRow.createDiv("ledgr-gauge-aside");
      renderGauge(gaugeWrap, summary.savingsRate, "savings rate", { good: 20, warn: 10 });
    }

    // Daily countdown banner
    this.renderCountdownBanner(contentEl, budgetConfig, summary);

    // Opex / Capex breakdown
    this.renderOpexCapex(contentEl, summary, budgetConfig);

    // Monthly trend — last 6 months
    await this.renderTrendSection(contentEl);

    // Recent transactions
    const txSection = contentEl.createDiv("ledgr-section");
    txSection.createDiv("ledgr-section-header").createEl("h3", { text: "Recent Transactions" });

    const recent = [...transactions].reverse().slice(0, 10);
    if (recent.length === 0) {
      txSection.createEl("p", { text: "No transactions this month.", cls: "ledgr-empty-state" });
    } else {
      const tableWrap = txSection.createDiv("ledgr-tx-table-wrap");
      const table = tableWrap.createEl("table", { cls: "ledgr-tx-table" });
      const thead = table.createEl("thead");
      const hrow = thead.createEl("tr");
      ["Date", "Type", "Category", "Note", "Amount", ""].forEach((h) => hrow.createEl("th", { text: h, cls: h === "" ? "ledgr-th-actions" : "" }));
      const tbody = table.createEl("tbody");

      recent.forEach((tx, idx) => {
        const actualIndex = transactions.length - 1 - idx;
        const tr = tbody.createEl("tr");
        tr.createEl("td", { text: tx.date });
        const typeTd = tr.createEl("td");
        typeTd.createEl("span", { text: tx.type, cls: `ledgr-badge ledgr-badge-${tx.type}` });
        tr.createEl("td", { text: tx.category });
        tr.createEl("td", { text: tx.note || "-", cls: "ledgr-note-col" });
        const amtCell = tr.createEl("td", {
          text: `${tx.currency} ${tx.amount.toLocaleString()}`,
          cls: tx.type === "income" ? "ledgr-income" : "ledgr-expense",
        });
        amtCell.addClass("ledgr-text-right");
        const actionTd = tr.createEl("td", { cls: "ledgr-tx-actions" });
        const editBtn = actionTd.createEl("button", { text: "✎", cls: "ledgr-edit-btn" });
        editBtn.title = "Edit transaction";
        editBtn.onclick = () => new EditTransactionModal(
          this.app, this.plugin, tx, this.currentMonth, actualIndex,
          () => { void this.render(); }
        ).open();
        const delBtn = actionTd.createEl("button", { text: "✕", cls: "ledgr-del-btn" });
        delBtn.title = "Delete transaction";
        delBtn.onclick = () => this.handleDelete(delBtn, tr, this.currentMonth, actualIndex);
      });
    }

    // Transfer widget — below transactions
    if (this.plugin.settings.enableTransferTracker && remittanceStore.remittances.length > 0) {
      this.renderRemittanceWidget(contentEl, remitSummary, remittanceStore);
    }
  }

  renderRemittanceWidget(parent: HTMLElement, remitSummary: ReturnType<typeof getRemittanceSummary>, store: RemittanceStore) {
    const base = this.plugin.settings.baseCurrency;
    const sec = this.plugin.settings.secondaryCurrencies[0] ?? "";
    const widget = parent.createDiv("ledgr-remit-widget");
    const header = widget.createDiv("ledgr-remit-widget-header");
    header.createEl("span", { text: "Transfers", cls: "ledgr-remit-widget-title" });
    const rightGroup = header.createDiv("ledgr-remit-widget-actions");
    const addBtn = rightGroup.createEl("button", { text: "+ Log Transfer", cls: "ledgr-budget-btn ledgr-remit-add" });
    addBtn.onclick = () => new RemittanceModal(this.app, this.plugin).open();

    const stats = widget.createDiv("ledgr-remit-stats");
    this.createRemitStat(stats, "This month", `${base} ${remitSummary.monthTotal.toLocaleString()}`, sec ? `${remitSummary.monthPHP.toLocaleString()} ${sec}` : "");
    this.createRemitStat(stats, "Fees this month", `${base} ${remitSummary.monthFees.toLocaleString()}`, "");
    this.createRemitStat(stats, "This year", `${base} ${remitSummary.yearTotal.toLocaleString()}`, sec ? `${remitSummary.yearPHP.toLocaleString()} ${sec}` : "");
    this.createRemitStat(stats, "Total ever sent", "", sec ? `${remitSummary.lifetimePHP.toLocaleString()} ${sec}` : `${base} ${remitSummary.lifetimeJPY.toLocaleString()}`, true);

    // History toggle
    const historyWrap = widget.createDiv("ledgr-remit-history-wrap");
    let historyOpen = false;
    const toggleLink = historyWrap.createEl("a", {
      text: `Show history (${store.remittances.length})`,
      cls: "ledgr-remit-history-toggle",
    });
    const historyContent = historyWrap.createDiv("ledgr-remit-history-content");
    historyContent.addClass("ledgr-hidden");

    toggleLink.onclick = () => {
      historyOpen = !historyOpen;
      historyContent.toggleClass("ledgr-hidden", !historyOpen);
      toggleLink.textContent = historyOpen
        ? "Hide history"
        : `Show history (${store.remittances.length})`;
      if (historyOpen) this.renderTransferHistory(historyContent, store.remittances);
    };
  }

  renderTransferHistory(parent: HTMLElement, remittances: Remittance[]) {
    parent.empty();
    const base = this.plugin.settings.baseCurrency;
    const sec = this.plugin.settings.secondaryCurrencies[0] ?? "";

    // Period filter tabs
    const tabRow = parent.createDiv("ledgr-opex-tabs");
    let period: "month" | "year" | "all" = "all";
    const currentMonth = window.moment().format("YYYY-MM");
    const currentYear = window.moment().format("YYYY");

    const filterRemittances = () => {
      if (period === "month") return remittances.filter((r) => r.date.startsWith(currentMonth));
      if (period === "year") return remittances.filter((r) => r.date.startsWith(currentYear));
      return remittances;
    };

    const renderTable = () => {
      const existing = parent.querySelector(".ledgr-remit-history-table-wrap");
      if (existing) existing.remove();

      const filtered = filterRemittances().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 50);
      const wrap = parent.createDiv("ledgr-remit-history-table-wrap");

      if (filtered.length === 0) {
        wrap.createEl("p", { text: "No transfers for this period.", cls: "ledgr-empty-state" });
        return;
      }

      const table = wrap.createEl("table", { cls: "ledgr-tx-table ledgr-remit-history-table" });
      const thead = table.createEl("thead");
      const hrow = thead.createEl("tr");
      ["Date", "Service", `Sent (${base})`, sec ? `Received (${sec})` : "Received", "Fee", "Note"].forEach((h) =>
        hrow.createEl("th", { text: h })
      );
      const tbody = table.createEl("tbody");

      filtered.forEach((r) => {
        const tr = tbody.createEl("tr");
        const dateTd = tr.createEl("td");
        dateTd.createEl("div", { text: r.date });
        dateTd.createEl("div", { text: `@ ${r.rateAtSend.toFixed(4)}`, cls: "ledgr-remit-row-rate" });
        tr.createEl("td", { text: r.service });
        tr.createEl("td", { text: r.amountJPY.toLocaleString(), cls: "ledgr-stmt-amt" });
        tr.createEl("td", { text: r.amountPHP > 0 ? r.amountPHP.toLocaleString() : "—", cls: "ledgr-remit-received" });
        tr.createEl("td", { text: r.feeJPY > 0 ? r.feeJPY.toLocaleString() : "—", cls: "ledgr-stmt-amt ledgr-text-faint" });
        tr.createEl("td", { text: r.note || "—", cls: "ledgr-note-col" });
      });

      // Footer
      const footer = wrap.createDiv("ledgr-remit-history-footer");
      const totalSent = filtered.reduce((s, r) => s + r.amountJPY, 0);
      const totalReceived = filtered.reduce((s, r) => s + r.amountPHP, 0);
      const sentSpan = footer.createEl("span");
      sentSpan.appendText(`${filtered.length} transfers · `);
      sentSpan.createEl("span", { text: `${base} ${totalSent.toLocaleString()}`, cls: "ledgr-remit-history-footer-val" });
      sentSpan.appendText(" sent");
      if (totalReceived > 0 && sec) {
        const recvSpan = footer.createEl("span");
        recvSpan.createEl("span", { text: `${totalReceived.toLocaleString()} ${sec}`, cls: "ledgr-remit-history-footer-val" });
        recvSpan.appendText(" received");
      }

      if (remittances.length > 50) {
        wrap.createEl("p", { text: `Showing 50 of ${remittances.length} transfers`, cls: "ledgr-empty-state" });
      }
    };

    [{ key: "month", label: "This Month" }, { key: "year", label: "This Year" }, { key: "all", label: "All Time" }].forEach(({ key, label }) => {
      const btn = tabRow.createEl("button", {
        text: label,
        cls: `ledgr-opex-tab ${period === key ? "active" : ""}`,
      });
      btn.onclick = () => {
        period = key as "month" | "year" | "all";
        tabRow.querySelectorAll(".ledgr-opex-tab").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        renderTable();
      };
    });

    renderTable();
  }

  renderCountdownBanner(parent: HTMLElement, budgetConfig: BudgetConfig, summary: ReturnType<typeof summarize>) {
    if (!this.isLiveMonth) return;
    if (Object.keys(budgetConfig.limits).length === 0) return;

    const totalBudget = Object.entries(budgetConfig.limits).reduce((sum, [, val]) => {
      return sum + convertToBase(val, budgetConfig.currency, this.viewCurrency, this.plugin.settings.exchangeRates);
    }, 0);
    if (totalBudget === 0) return;

    const remaining = totalBudget - summary.totalExpenses;
    const daysLeft = Math.max(0, window.moment().endOf("month").diff(window.moment(), "days") + 1);
    const dailyAllowance = daysLeft > 0 ? remaining / daysLeft : 0;
    const pctLeft = remaining / totalBudget;
    const fmt = (n: number) => `${this.viewCurrency} ${Math.round(Math.abs(n)).toLocaleString()}`;

    const banner = parent.createDiv("ledgr-countdown");

    const daysClass = pctLeft < 0.1 || remaining < 0 ? "ledgr-countdown-over"
      : pctLeft < 0.3 ? "ledgr-countdown-warn" : "";

    banner.createEl("span", {
      text: daysLeft === 1 ? "Last day" : String(daysLeft),
      cls: `ledgr-countdown-days ${daysClass}`,
    });
    banner.createEl("span", {
      text: daysLeft === 1 ? " of the month" : " days left in " + window.moment(this.currentMonth).format("MMMM"),
      cls: "ledgr-countdown-label",
    });
    banner.createEl("span", { text: "·", cls: "ledgr-countdown-sep" });

    if (remaining < 0) {
      banner.createEl("span", { text: `${fmt(remaining)} over budget`, cls: "ledgr-countdown-budget ledgr-countdown-over" });
    } else {
      banner.createEl("span", { text: fmt(remaining), cls: "ledgr-countdown-budget" });
      banner.createEl("span", { text: " remaining", cls: "ledgr-countdown-suffix" });
      if (daysLeft > 1) {
        banner.createEl("span", { text: "·", cls: "ledgr-countdown-sep" });
        banner.createEl("span", { text: `${fmt(dailyAllowance)} / day`, cls: "ledgr-countdown-budget" });
      }
    }
  }

  createRemitStat(parent: HTMLElement, label: string, jpy: string, php: string, highlight = false) {
    const stat = parent.createDiv(`ledgr-remit-stat${highlight ? " ledgr-remit-lifetime" : ""}`);
    stat.createEl("div", { text: label, cls: "ledgr-remit-stat-label" });
    if (jpy) stat.createEl("div", { text: jpy, cls: "ledgr-remit-stat-jpy" });
    if (php) stat.createEl("div", { text: php, cls: "ledgr-remit-stat-php" });
  }

  renderOpexCapex(parent: HTMLElement, summary: ReturnType<typeof summarize>, budgetConfig: BudgetConfig) {
    const section = parent.createDiv("ledgr-section");
    section.createDiv("ledgr-section-header").createEl("h3", { text: "Spending by Category" });

    const sorted = Object.entries(summary.byCategory).sort((a, b) => b[1] - a[1]);
    const fmt = (n: number) => `${this.viewCurrency} ${Math.round(n).toLocaleString()}`;

    if (sorted.length === 0) {
      section.createEl("p", { text: "No expenses this month.", cls: "ledgr-empty-state" });
      return;
    }

    // Donut chart
    const chartWrap = section.createDiv("ledgr-chart-wrap");
    const segments = buildSpendingSegments(summary.byCategory, fmt);
    renderDonutChart(chartWrap, segments, "expenses");

    const breakdown = section.createDiv("ledgr-breakdown");
    sorted.forEach(([cat, amt], idx) => {
      const rawBudget = budgetConfig.limits[cat];
      const budget = rawBudget
        ? convertToBase(rawBudget, budgetConfig.currency, this.viewCurrency, this.plugin.settings.exchangeRates)
        : undefined;
      const overBudget = budget !== undefined && amt > budget;
      const pct = budget ? Math.min((amt / budget) * 100, 100) : (amt / (sorted[0][1] || 1)) * 100;
      const catType = getCategoryType(cat);
      const catColor = categoryColor(cat, idx);

      const row = breakdown.createDiv("ledgr-breakdown-row");
      const nameWrap = row.createDiv("ledgr-cat-name-wrap");
      // Color dot matching donut
      const dot = nameWrap.createEl("span", { cls: "ledgr-cat-dot" });
      dot.style.backgroundColor = catColor; // dynamic value — cannot use static CSS class
      nameWrap.createEl("span", { text: cat, cls: "ledgr-cat-name" });
      if (catType === "fixed") {
        nameWrap.createEl("span", { text: "fixed", cls: "ledgr-cat-type-tag ledgr-cat-type-fixed" });
      } else if (catType === "variable") {
        nameWrap.createEl("span", { text: "variable", cls: "ledgr-cat-type-tag ledgr-cat-type-variable" });
      }
      const barWrap = row.createDiv("ledgr-bar-wrap");
      const bar = barWrap.createDiv(`ledgr-bar${overBudget ? " ledgr-bar-over" : ""}`);
      if (!overBudget) bar.setCssStyles({ backgroundColor: catColor });
      bar.setCssStyles({ width: "0%" });
      window.requestAnimationFrame(() => { bar.setCssStyles({ width: `${Math.round(pct)}%` }); });
      const amtText = budget ? `${fmt(amt)} / ${fmt(budget)}` : fmt(amt);
      row.createEl("span", { text: amtText, cls: `ledgr-cat-amt${overBudget ? " ledgr-negative" : ""}` });
    });
  }

  async renderTrendSection(parent: HTMLElement) {
    // Build last 6 months of expense + income data
    const months: string[] = [];
    const labels: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const m = window.moment(this.currentMonth).subtract(i, "month");
      months.push(m.format("YYYY-MM"));
      labels.push(m.format("MMM"));
    }

    // Parallel reads — all 6 months at once
    const allTxs = await Promise.all(
      months.map((m) => readMonthTransactions(this.app, this.plugin.settings, m))
    );
    const summaries = allTxs.map((txs) => summarize(txs, this.viewCurrency, this.plugin.settings.exchangeRates));

    const expenseValues = summaries.map((s) => Math.round(s.totalExpenses));
    const incomeValues = summaries.map((s) => Math.round(s.totalIncome));
    const hasData = summaries.some((s) => s.totalExpenses > 0 || s.totalIncome > 0);

    if (!hasData) return;

    const section = parent.createDiv("ledgr-section");
    section.createDiv("ledgr-section-header").createEl("h3", { text: "6-Month Trend" });

    const trendWrap = section.createDiv();
    renderTrendLine(trendWrap, [
      { label: "Expenses", values: expenseValues, color: "var(--ledgr-red)" },
      { label: "Income", values: incomeValues, color: "var(--ledgr-green)", dashed: true },
    ], labels);
  }

  handleDelete(btn: HTMLButtonElement, row: HTMLElement, month: string, lineIndex: number) {
    if (this.pendingDelete) {
      window.clearTimeout(this.pendingDelete.timer);
      this.pendingDelete = null;
      this.contentEl.querySelectorAll(".ledgr-tx-table tr.pending-delete").forEach((r) => {
        r.classList.remove("pending-delete");
        const b = r.querySelector<HTMLButtonElement>(".ledgr-del-btn");
        if (b) { b.textContent = "✕"; b.classList.remove("ledgr-del-confirm"); }
      });
    }

    row.classList.add("pending-delete");
    btn.textContent = "Delete?";
    btn.classList.add("ledgr-del-confirm");

    const timer = window.setTimeout(() => {
      row.classList.remove("pending-delete");
      btn.textContent = "✕";
      btn.classList.remove("ledgr-del-confirm");
      this.pendingDelete = null;
    }, 3000);

    this.pendingDelete = { month, lineIndex, timer };

    btn.onclick = () => {
      if (this.pendingDelete) { window.clearTimeout(this.pendingDelete.timer); this.pendingDelete = null; }
      void this.deleteTransaction(month, lineIndex);
    };
  }

  async deleteTransaction(month: string, lineIndex: number) {
    const filePath = normalizePath(`${this.plugin.settings.financeFolder}/transactions/${month}.md`);
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) return;

    const content = await this.app.vault.read(file);
    const lines = content.split("\n");
    const dataLineIndices: number[] = [];
    lines.forEach((l, i) => { if (l.startsWith("| 20")) dataLineIndices.push(i); });
    const targetIdx = dataLineIndices[lineIndex];
    if (targetIdx === undefined) return;

    // Remove the table row and its following Dataview %% line if present
    const deleteCount = lines[targetIdx + 1]?.startsWith("%%") ? 2 : 1;
    lines.splice(targetIdx, deleteCount);
    await this.app.vault.modify(file, lines.join("\n"));
    new Notice("Transaction deleted");
    this.app.workspace.trigger("ledgr:transaction-saved");
  }

  renderFirstRun(parent: HTMLElement) {
    const state = parent.createDiv("ledgr-first-run");
    state.createEl("div", { cls: "ledgr-first-run-rule" });
    state.createEl("h3", { text: "Welcome to Ledgr" });
    state.createEl("p", { text: "Your money, both sides of the ocean." });

    const steps = state.createDiv("ledgr-first-run-steps");
    [
      { n: "1", label: "Log a transaction" },
      { n: "2", label: "Set monthly budgets" },
      { n: "3", label: "See your full picture" },
    ].forEach(({ n, label }) => {
      const step = steps.createDiv("ledgr-first-run-step");
      step.createEl("span", { text: n, cls: "ledgr-step-num" });
      step.createEl("span", { text: label });
    });

    const cta = state.createEl("button", { text: "+ Log your first transaction", cls: "ledgr-log-btn mod-cta ledgr-first-run-cta" });
    cta.onclick = () => new QuickCaptureModal(this.app, this.plugin.settings).open();

    const remitCta = state.createEl("button", { text: "Log a transfer", cls: "ledgr-budget-btn ledgr-first-run-remit" });
    remitCta.onclick = () => new RemittanceModal(this.app, this.plugin).open();

    if (!this.plugin.settings.exchangeRates.updatedAt) {
      const hint = state.createEl("p", { cls: "ledgr-first-run-hint" });
      hint.createEl("a", { text: "Set up exchange rates →" }).onclick = () =>
        new ConfigModal(this.app, this.plugin).open();
    }
  }

  trend(current: number, prev: number, invertGood = false): { pct: number; good: boolean } | null {
    if (prev === 0) return null;
    const pct = Math.round(((current - prev) / Math.abs(prev)) * 100);
    const up = pct > 0;
    const good = invertGood ? !up : up;
    return { pct, good };
  }

  createCard(parent: HTMLElement, label: string, value: string, cls: string,
    trendData?: { pct: number; good: boolean } | null) {
    const card = parent.createDiv(`ledgr-card ${cls}`);
    card.createEl("div", { text: label, cls: "ledgr-card-label" });
    card.createEl("div", { text: value, cls: "ledgr-card-value" });
    if (trendData) {
      const { pct, good } = trendData;
      const arrow = pct > 0 ? "↑" : "↓";
      card.createEl("div", {
        text: `${arrow} ${Math.abs(pct)}% vs last month`,
        cls: `ledgr-card-trend ${good ? "ledgr-trend-good" : "ledgr-trend-bad"}`,
      });
    }
  }

  async onClose() {
    if (this.pendingDelete) window.clearTimeout(this.pendingDelete.timer);
    this.contentEl.empty();
  }
}
