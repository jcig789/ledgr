import { ItemView, WorkspaceLeaf } from "obsidian";
import LedgrPlugin from "../main";
import { readMonthTransactions, summarize, convertToBase } from "../data/reader";
import { loadNetWorth, NetWorthData, Account, Brokerage } from "../data/networth";
import { loadBudgets, BudgetConfig } from "../data/budgets";
import { Transaction } from "../data/transactions";
import { renderNavBar } from "./NavBar";
import { renderCompositionBar, buildNetWorthSegments } from "./charts";

export const STATEMENTS_VIEW_TYPE = "ledgr-statements";

type StmtTab = "pl" | "cashflow" | "balance";

export class StatementsView extends ItemView {
  plugin: LedgrPlugin;
  activeTab: StmtTab = "pl";
  selectedYear: string;
  viewCurrency: string;

  constructor(leaf: WorkspaceLeaf, plugin: LedgrPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.selectedYear = window.moment().format("YYYY");
    this.viewCurrency = plugin.settings.baseCurrency;
  }

  getViewType() { return STATEMENTS_VIEW_TYPE; }
  getDisplayText() { return "Statements"; }
  getIcon() { return "book-open"; }

  async onOpen() { await this.render(); }

  async render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ledgr-statements");

    renderNavBar(contentEl, this.app, this.plugin, "statements");

    // Header
    const header = contentEl.createDiv("ledgr-header");

    // Currency toggle
    const currencyRow = header.createDiv("ledgr-currency-row");
    [this.plugin.settings.baseCurrency, ...this.plugin.settings.secondaryCurrencies].forEach((c) => {
      const btn = currencyRow.createEl("button", {
        text: c,
        cls: `ledgr-currency-btn ${c === this.viewCurrency ? "active" : ""}`,
      });
      btn.onclick = async () => { this.viewCurrency = c; await this.render(); };
    });

    // Year navigation
    const yearRow = header.createDiv("ledgr-month-row");
    const prevBtn = yearRow.createEl("button", { text: "←" });
    prevBtn.onclick = async () => {
      this.selectedYear = String(parseInt(this.selectedYear) - 1);
      await this.render();
    };
    yearRow.createEl("span", { text: this.selectedYear, cls: "ledgr-month-label" });
    const nextBtn = yearRow.createEl("button", { text: "→" });
    if (this.selectedYear >= window.moment().format("YYYY")) {
      nextBtn.setAttribute("disabled", "true");
      nextBtn.addClass("ledgr-btn-disabled");
    } else {
      nextBtn.onclick = async () => {
        this.selectedYear = String(parseInt(this.selectedYear) + 1);
        await this.render();
      };
    }

    // Refresh button
    const refreshBtn = yearRow.createEl("button", { text: "↻", cls: "ledgr-stmt-refresh-btn" });
    refreshBtn.title = "Refresh data";
    refreshBtn.setAttribute("aria-label", "Refresh statements");
    refreshBtn.onclick = async () => {
      refreshBtn.addClass("ledgr-btn-disabled");
      await this.render();
    };

    // Statement type tabs
    const tabRow = contentEl.createDiv("ledgr-stmt-tabs");
    const tabs: { key: StmtTab; label: string }[] = [
      { key: "pl", label: "Income Statement" },
      { key: "cashflow", label: "Cash Flow" },
      { key: "balance", label: "Balance Sheet" },
    ];
    tabs.forEach(({ key, label }) => {
      const btn = tabRow.createEl("button", {
        text: label,
        cls: `ledgr-stmt-tab ${this.activeTab === key ? "active" : ""}`,
      });
      btn.onclick = async () => { this.activeTab = key; await this.render(); };
    });

    const budgetConfig = await loadBudgets(this.app, this.plugin.settings);
    const netWorthData = await loadNetWorth(this.app, this.plugin.settings);
    const fmt = (n: number) => `${this.viewCurrency} ${Math.round(Math.abs(n)).toLocaleString()}`;
    const fmtSigned = (n: number) => n < 0
      ? `(${this.viewCurrency} ${Math.round(Math.abs(n)).toLocaleString()})`
      : `${this.viewCurrency} ${Math.round(n).toLocaleString()}`;

    const stmtWrap = contentEl.createDiv("ledgr-stmt");

    if (this.activeTab === "pl") {
      // Parallel reads — all 12 months at once
      const months = Array.from({ length: 12 }, (_, i) =>
        window.moment(`${this.selectedYear}-01`).add(i, "month").format("YYYY-MM")
      );
      const monthlyTxs = await Promise.all(
        months.map((m) => readMonthTransactions(this.app, this.plugin.settings, m))
      );
      const allTxs = monthlyTxs.flat();
      await this.renderPL(stmtWrap, allTxs, budgetConfig, fmt, fmtSigned);
    } else if (this.activeTab === "cashflow") {
      await this.renderCashFlow(stmtWrap, fmt, fmtSigned);
    } else {
      this.renderBalanceSheet(stmtWrap, netWorthData, fmt, fmtSigned);
    }
  }

  async renderPL(parent: HTMLElement, transactions: Transaction[], budgetConfig: BudgetConfig, fmt: (n: number) => string, fmtSigned: (n: number) => string) {
    const summary = summarize(transactions, this.viewCurrency, this.plugin.settings.exchangeRates);

    this.stmtDocHeader(parent, "Income Statement", this.selectedYear);

    if (transactions.length === 0) {
      parent.createEl("p", { text: `No transactions found for ${this.selectedYear}.`, cls: "ledgr-empty-state" });
      return;
    }

    // REVENUE section
    const incSection = parent.createDiv("ledgr-stmt-section");
    this.stmtSectionLabel(incSection, "Revenue");
    const incomeBySubcat: Record<string, number> = {};
    transactions.filter((t) => t.type === "income").forEach((t) => {
      const amt = convertToBase(t.amount, t.currency, this.viewCurrency, this.plugin.settings.exchangeRates);
      incomeBySubcat[t.subcategory] = (incomeBySubcat[t.subcategory] ?? 0) + amt;
    });
    if (Object.keys(incomeBySubcat).length === 0) {
      this.stmtLine(incSection, "No income recorded", "—");
    } else {
      Object.entries(incomeBySubcat).sort((a, b) => b[1] - a[1]).forEach(([label, amt]) => {
        this.stmtLine(incSection, label, fmt(amt));
      });
    }
    this.stmtSubtotal(incSection, "Total Revenue", fmt(summary.totalIncome));

    parent.createEl("div", { cls: "ledgr-stmt-spacer" });

    // EXPENSES section — CPA style: each line shows actual, budget column, variance column
    const expSection = parent.createDiv("ledgr-stmt-section");
    this.stmtSectionLabel(expSection, "Expenses");
    const hasBudgets = Object.keys(budgetConfig.limits).length > 0;

    if (hasBudgets) {
      // Use a single CSS grid table so header + rows share the same column widths
      const grid = expSection.createDiv("ledgr-stmt-budget-grid");

      // Header row
      grid.createEl("span", { text: "", cls: "ledgr-stmt-budget-cell" });
      grid.createEl("span", { text: "Actual", cls: "ledgr-stmt-budget-cell ledgr-stmt-col-hdr" });
      grid.createEl("span", { text: "Budget", cls: "ledgr-stmt-budget-cell ledgr-stmt-col-hdr" });
      grid.createEl("span", { text: "Variance", cls: "ledgr-stmt-budget-cell ledgr-stmt-col-hdr" });

      Object.entries(summary.byCategory).sort((a, b) => b[1] - a[1]).forEach(([cat, amt]) => {
        const budgetRaw = budgetConfig.limits[cat];
        const budget = budgetRaw
          ? convertToBase(budgetRaw, budgetConfig.currency, this.viewCurrency, this.plugin.settings.exchangeRates)
          : undefined;
        const actual = amt;

        grid.createEl("span", { text: cat, cls: "ledgr-stmt-budget-cell ledgr-stmt-budget-name" });
        grid.createEl("span", { text: fmt(actual), cls: "ledgr-stmt-budget-cell ledgr-stmt-amt" });

        if (budget !== undefined) {
          const variance = budget - actual;
          grid.createEl("span", { text: fmt(budget), cls: "ledgr-stmt-budget-cell ledgr-stmt-amt ledgr-text-faint" });
          grid.createEl("span", {
            text: variance >= 0 ? `+${fmt(variance)}` : `(${fmt(Math.abs(variance))})`,
            cls: `ledgr-stmt-budget-cell ledgr-stmt-amt ${variance >= 0 ? "ledgr-positive" : "ledgr-negative"}`,
          });
        } else {
          grid.createEl("span", { text: "—", cls: "ledgr-stmt-budget-cell ledgr-stmt-amt ledgr-text-faint" });
          grid.createEl("span", { text: "—", cls: "ledgr-stmt-budget-cell ledgr-stmt-amt ledgr-text-faint" });
        }
      });

      // Total row inside the same grid
      grid.createEl("span", { text: "Total Expenses", cls: "ledgr-stmt-budget-cell ledgr-stmt-budget-total" });
      grid.createEl("span", { text: fmt(summary.totalExpenses), cls: "ledgr-stmt-budget-cell ledgr-stmt-amt ledgr-stmt-budget-total" });
      grid.createEl("span", { cls: "ledgr-stmt-budget-cell" });
      grid.createEl("span", { cls: "ledgr-stmt-budget-cell" });
    } else {
      Object.entries(summary.byCategory).sort((a, b) => b[1] - a[1]).forEach(([cat, amt]) => {
        this.stmtLine(expSection, cat, fmt(amt));
      });
    }


    // Bottom totals
    const totalEl = parent.createDiv("ledgr-stmt-total");
    totalEl.createEl("span", { text: "Net Savings" });
    totalEl.createEl("span", {
      text: fmt(summary.net),
      cls: `ledgr-stmt-amt ${summary.net >= 0 ? "ledgr-positive" : "ledgr-negative"}`,
    });

    const rateEl = parent.createDiv("ledgr-stmt-rate-row");
    rateEl.createEl("span", { text: "Savings Rate", cls: "ledgr-stmt-rate-label" });
    rateEl.createEl("span", {
      text: `${summary.savingsRate}%`,
      cls: `ledgr-stmt-amt ${summary.savingsRate >= 20 ? "ledgr-positive" : "ledgr-neutral"}`,
    });

    // Notes
    parent.createEl("p", {
      text: `Cash basis. Fiscal year ${this.selectedYear}. All amounts in ${this.viewCurrency}.`,
      cls: "ledgr-stmt-footnote",
    });
  }

  async renderCashFlow(parent: HTMLElement, fmt: (n: number) => string, fmtSigned: (n: number) => string) {
    this.stmtDocHeader(parent, "Statement of Cash Flows", this.selectedYear);

    const table = parent.createEl("table", { cls: "ledgr-stmt-cf-table" });
    const thead = table.createEl("thead");
    const hrow = thead.createEl("tr");
    ["Month", "Inflows", "Outflows", "Net Cash"].forEach((h) => {
      const th = hrow.createEl("th", { text: h });
      if (h !== "Month") th.addClass("ledgr-text-right");
    });

    const tbody = table.createEl("tbody");
    let totalIn = 0, totalOut = 0;
    let hasData = false;

    const months = Array.from({ length: 12 }, (_, i) =>
      window.moment(`${this.selectedYear}-01`).add(i, "month").format("YYYY-MM")
    );

    // Parallel reads — all 12 months at once
    const allTxs = await Promise.all(
      months.map((m) => readMonthTransactions(this.app, this.plugin.settings, m))
    );
    const summaries = allTxs.map((txs) => summarize(txs, this.viewCurrency, this.plugin.settings.exchangeRates));

    for (let idx = 0; idx < months.length; idx++) {
      const month = months[idx];
      const s = summaries[idx];
      if (s.totalIncome > 0 || s.totalExpenses > 0) hasData = true;
      totalIn += s.totalIncome;
      totalOut += s.totalExpenses;

      const isCurrentOrFuture = month > window.moment().format("YYYY-MM");
      const tr = tbody.createEl("tr", { cls: isCurrentOrFuture ? "ledgr-stmt-cf-future" : "" });
      tr.createEl("td", { text: window.moment(month).format("MMMM") });

      const inTd = tr.createEl("td");
      inTd.addClass("ledgr-text-right");
      inTd.textContent = s.totalIncome > 0 ? fmt(s.totalIncome) : "—";

      const outTd = tr.createEl("td");
      outTd.addClass("ledgr-text-right");
      outTd.textContent = s.totalExpenses > 0 ? fmtSigned(-s.totalExpenses) : "—";

      const netTd = tr.createEl("td");
      netTd.addClass("ledgr-text-right");
      if (s.totalIncome > 0 || s.totalExpenses > 0) {
        netTd.textContent = fmtSigned(s.net);
        netTd.addClass(s.net >= 0 ? "ledgr-positive" : "ledgr-negative");
      } else {
        netTd.textContent = "—";
      }
    }

    if (!hasData) {
      tbody.empty();
      const tr = tbody.createEl("tr");
      const td = tr.createEl("td", { text: `No transactions for ${this.selectedYear}`, cls: "ledgr-empty-state" });
      td.setAttribute("colspan", "4");
      return;
    }

    // Year total
    const tfoot = table.createEl("tfoot");
    const footRow = tfoot.createEl("tr", { cls: "ledgr-stmt-cf-total" });
    footRow.createEl("td", { text: "Year Total" });
    footRow.createEl("td", { text: fmt(totalIn), cls: "ledgr-positive ledgr-text-right" });
    footRow.createEl("td", { text: fmtSigned(-totalOut), cls: "ledgr-text-right" });
    const net = totalIn - totalOut;
    footRow.createEl("td", { text: fmtSigned(net), cls: `ledgr-text-right ${net >= 0 ? "ledgr-positive" : "ledgr-negative"}` });

    parent.createEl("p", {
      text: `Cash basis. All amounts in ${this.viewCurrency}. Future months shown for reference.`,
      cls: "ledgr-stmt-footnote",
    });
  }

  renderBalanceSheet(parent: HTMLElement, netWorthData: NetWorthData, fmt: (n: number) => string, fmtSigned: (n: number) => string) {
    const asOf = netWorthData.updatedAt
      ? `As of ${new Date(netWorthData.updatedAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`
      : "As of today";

    this.stmtDocHeader(parent, "Balance Sheet", asOf);

    const toBase = (amount: number, currency: string) =>
      convertToBase(amount, currency, this.viewCurrency, this.plugin.settings.exchangeRates);

    // ASSETS
    const assetsSection = parent.createDiv("ledgr-stmt-section");
    this.stmtSectionLabel(assetsSection, "Assets");

    let bankTotal = 0;
    const bankAccounts = netWorthData.accounts?.filter((a: Account) => !a.isLiability) ?? [];
    if (bankAccounts.length > 0) {
      assetsSection.createEl("div", { text: "Bank & Cash Accounts", cls: "ledgr-stmt-group-label" });
      bankAccounts.forEach((a: Account) => {
        const amt = toBase(a.balance, a.currency);
        bankTotal += amt;
        this.stmtLine(assetsSection, a.name, fmt(amt), true);
      });
      this.stmtSubtotal(assetsSection, "Total Bank & Cash", fmt(bankTotal));
    }

    let investTotal = 0;
    if (netWorthData.brokerages?.length > 0) {
      assetsSection.createEl("div", { text: "Investment Accounts", cls: "ledgr-stmt-group-label" });
      netWorthData.brokerages.forEach((b: Brokerage) => {
        const amt = toBase(b.value, b.currency);
        investTotal += amt;
        this.stmtLine(assetsSection, b.name, fmt(amt), true);
      });
      this.stmtSubtotal(assetsSection, "Total Investments", fmt(investTotal));
    }

    const totalAssets = bankTotal + investTotal;
    this.stmtGrandTotal(assetsSection, "Total Assets", fmt(totalAssets));

    parent.createEl("div", { cls: "ledgr-stmt-spacer" });

    // LIABILITIES
    const liabSection = parent.createDiv("ledgr-stmt-section");
    this.stmtSectionLabel(liabSection, "Liabilities");

    let totalLiab = 0;
    const liabilities = netWorthData.accounts?.filter((a: Account) => a.isLiability) ?? [];
    if (liabilities.length > 0) {
      liabilities.forEach((a: Account) => {
        const amt = toBase(a.balance, a.currency);
        totalLiab += amt;
        this.stmtLine(liabSection, a.name, fmtSigned(-amt), true);
      });
    } else {
      liabSection.createEl("p", { text: "No liabilities recorded.", cls: "ledgr-empty-state" });
    }
    this.stmtGrandTotal(liabSection, "Total Liabilities", totalLiab === 0 ? fmt(0) : fmt(totalLiab));

    parent.createEl("div", { cls: "ledgr-stmt-spacer" });

    // NET WORTH — double-underline bottom total
    const netWorth = totalAssets - totalLiab;
    const totalEl = parent.createDiv("ledgr-stmt-total");
    totalEl.createEl("span", { text: "Net Worth" });
    totalEl.createEl("span", {
      text: fmt(netWorth),
      cls: `ledgr-stmt-amt ${netWorth >= 0 ? "ledgr-positive" : "ledgr-negative"}`,
    });

    // Composition bar
    if (totalAssets > 0 || totalLiab > 0) {
      const barWrap = parent.createDiv("ledgr-stmt-comp-bar");
      const segs = buildNetWorthSegments(bankTotal, investTotal, totalLiab, fmt);
      renderCompositionBar(barWrap, segs);
    }

    // Accounting equation note
    parent.createEl("p", {
      text: `Assets ${fmt(totalAssets)} = Liabilities ${totalLiab === 0 ? fmt(0) : fmt(totalLiab)} + Net Worth ${fmt(netWorth)}`,
      cls: "ledgr-stmt-footnote",
    });

    if (netWorthData.updatedAt) {
      parent.createEl("p", { text: "Update balances in the Net Worth tab.", cls: "ledgr-stmt-footnote" });
    }
  }

  // ── Shared helpers ──────────────────────────────────────────────────

  stmtDocHeader(parent: HTMLElement, title: string, period: string) {
    const hdr = parent.createDiv("ledgr-stmt-doc-header");
    hdr.createEl("div", { text: title, cls: "ledgr-stmt-doc-title" });
    hdr.createEl("div", { text: period, cls: "ledgr-stmt-doc-period" });
    parent.createEl("div", { cls: "ledgr-stmt-doc-rule" });
  }

  stmtSectionLabel(parent: HTMLElement, label: string) {
    parent.createEl("div", { text: label, cls: "ledgr-stmt-section-label" });
  }

  stmtLine(parent: HTMLElement, label: string, amount: string, indent = false): HTMLElement {
    const row = parent.createDiv(`ledgr-stmt-line${indent ? " ledgr-stmt-line-indent" : ""}`);
    row.createEl("span", { text: label });
    row.createEl("span", { text: amount, cls: "ledgr-stmt-amt" });
    return row;
  }

  stmtSubtotal(parent: HTMLElement, label: string, amount: string) {
    const row = parent.createDiv("ledgr-stmt-line ledgr-stmt-subtotal");
    row.createEl("span", { text: label });
    row.createEl("span", { text: amount, cls: "ledgr-stmt-amt" });
  }

  stmtGrandTotal(parent: HTMLElement, label: string, amount: string) {
    const row = parent.createDiv("ledgr-stmt-line ledgr-stmt-grand-total");
    row.createEl("span", { text: label });
    row.createEl("span", { text: amount, cls: "ledgr-stmt-amt" });
  }

  async onClose() { this.contentEl.empty(); }
}
