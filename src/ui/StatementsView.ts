import { ItemView, WorkspaceLeaf } from "obsidian";
import LedgrPlugin from "../main";
import { readMonthTransactions, summarize, convertToBase } from "../data/reader";
import { loadNetWorth } from "../data/networth";
import { loadBudgets } from "../data/budgets";
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
      nextBtn.style.opacity = "0.3";
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
      refreshBtn.style.opacity = "0.4";
      refreshBtn.style.transform = "rotate(360deg)";
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

  async renderPL(parent: HTMLElement, transactions: any[], budgetConfig: any, fmt: Function, fmtSigned: Function) {
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
        this.stmtLine(incSection, label, fmt(amt as number));
      });
    }
    this.stmtSubtotal(incSection, "Total Revenue", fmt(summary.totalIncome));

    parent.createEl("div", { cls: "ledgr-stmt-spacer" });

    // EXPENSES section — CPA style: each line shows actual, budget column, variance column
    const expSection = parent.createDiv("ledgr-stmt-section");
    this.stmtSectionLabel(expSection, "Expenses");
    const hasBudgets = Object.keys(budgetConfig.limits).length > 0;

    if (hasBudgets) {
      const colHeader = expSection.createDiv("ledgr-stmt-col-header");
      colHeader.createEl("span", { text: "" });
      colHeader.createEl("span", { text: "Actual", cls: "ledgr-stmt-col-hdr" });
      colHeader.createEl("span", { text: "Budget", cls: "ledgr-stmt-col-hdr" });
      colHeader.createEl("span", { text: "Variance", cls: "ledgr-stmt-col-hdr" });
    }

    Object.entries(summary.byCategory).sort((a, b) => b[1] - a[1]).forEach(([cat, amt]) => {
      const budgetRaw = budgetConfig.limits[cat];
      const budget = budgetRaw
        ? convertToBase(budgetRaw, budgetConfig.currency, this.viewCurrency, this.plugin.settings.exchangeRates)
        : undefined;

      if (hasBudgets && budget !== undefined) {
        // CPA convention: expenses shown as positive numbers; variance = budget - actual
        // Positive variance = under budget (favorable); negative = over budget (unfavorable)
        const actual = amt as number;
        const variance = budget - actual;
        const row = expSection.createDiv("ledgr-stmt-line ledgr-stmt-line-4col");
        row.createEl("span", { text: cat });
        row.createEl("span", { text: fmt(actual) as string, cls: "ledgr-stmt-amt" });
        row.createEl("span", { text: fmt(budget) as string, cls: "ledgr-stmt-amt ledgr-text-faint" });
        // Variance: positive = under budget (good), negative = over budget (bad)
        // Show as +X or (X) with color only — no F/U suffixes
        row.createEl("span", {
          text: variance >= 0 ? `+${fmt(variance)}` : `(${fmt(Math.abs(variance))})`,
          cls: `ledgr-stmt-amt ${variance >= 0 ? "ledgr-positive" : "ledgr-negative"}`,
        });
      } else {
        this.stmtLine(expSection, cat, fmt(amt as number) as string);
      }
    });
    // Total Expenses — spans full width in both layouts
    if (hasBudgets) {
      const totalRow = expSection.createDiv("ledgr-stmt-line ledgr-stmt-line-4col ledgr-stmt-subtotal-4col");
      totalRow.createEl("span", { text: "Total Expenses" });
      totalRow.createEl("span", { text: fmt(summary.totalExpenses) as string, cls: "ledgr-stmt-amt" });
      totalRow.createEl("span", { cls: "ledgr-stmt-amt" });
      totalRow.createEl("span", { cls: "ledgr-stmt-amt" });
    } else {
      this.stmtSubtotal(expSection, "Total Expenses", fmt(summary.totalExpenses) as string);
    }

    // Bottom totals
    const totalEl = parent.createDiv("ledgr-stmt-total");
    totalEl.createEl("span", { text: "Net Savings" });
    totalEl.createEl("span", {
      text: fmt(summary.net) as string,
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

  async renderCashFlow(parent: HTMLElement, fmt: Function, fmtSigned: Function) {
    this.stmtDocHeader(parent, "Statement of Cash Flows", this.selectedYear);

    const table = parent.createEl("table", { cls: "ledgr-stmt-cf-table" });
    const thead = table.createEl("thead");
    const hrow = thead.createEl("tr");
    ["Month", "Inflows", "Outflows", "Net Cash"].forEach((h) => {
      const th = hrow.createEl("th", { text: h });
      if (h !== "Month") th.style.textAlign = "right";
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
      inTd.style.textAlign = "right";
      inTd.textContent = s.totalIncome > 0 ? fmt(s.totalIncome) as string : "—";

      const outTd = tr.createEl("td");
      outTd.style.textAlign = "right";
      outTd.textContent = s.totalExpenses > 0 ? fmtSigned(-s.totalExpenses) as string : "—";

      const netTd = tr.createEl("td");
      netTd.style.textAlign = "right";
      if (s.totalIncome > 0 || s.totalExpenses > 0) {
        netTd.textContent = fmtSigned(s.net) as string;
        netTd.className = s.net >= 0 ? "ledgr-positive" : "ledgr-negative";
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
    const ftIn = footRow.createEl("td", { text: fmt(totalIn) as string, cls: "ledgr-positive" });
    ftIn.style.textAlign = "right";
    const ftOut = footRow.createEl("td", { text: fmtSigned(-totalOut) as string });
    ftOut.style.textAlign = "right";
    const net = totalIn - totalOut;
    const ftNet = footRow.createEl("td", { text: fmtSigned(net) as string, cls: net >= 0 ? "ledgr-positive" : "ledgr-negative" });
    ftNet.style.textAlign = "right";

    parent.createEl("p", {
      text: `Cash basis. All amounts in ${this.viewCurrency}. Future months shown for reference.`,
      cls: "ledgr-stmt-footnote",
    });
  }

  renderBalanceSheet(parent: HTMLElement, netWorthData: any, fmt: Function, fmtSigned: Function) {
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
    const bankAccounts = netWorthData.accounts?.filter((a: any) => !a.isLiability) ?? [];
    if (bankAccounts.length > 0) {
      assetsSection.createEl("div", { text: "Bank & Cash Accounts", cls: "ledgr-stmt-group-label" });
      bankAccounts.forEach((a: any) => {
        const amt = toBase(a.balance, a.currency);
        bankTotal += amt;
        this.stmtLine(assetsSection, a.name, fmt(amt) as string, true);
      });
      this.stmtSubtotal(assetsSection, "Total Bank & Cash", fmt(bankTotal) as string);
    }

    let investTotal = 0;
    if (netWorthData.brokerages?.length > 0) {
      assetsSection.createEl("div", { text: "Investment Accounts", cls: "ledgr-stmt-group-label" });
      netWorthData.brokerages.forEach((b: any) => {
        const amt = toBase(b.value, b.currency);
        investTotal += amt;
        this.stmtLine(assetsSection, b.name, fmt(amt) as string, true);
      });
      this.stmtSubtotal(assetsSection, "Total Investments", fmt(investTotal) as string);
    }

    const totalAssets = bankTotal + investTotal;
    this.stmtGrandTotal(assetsSection, "Total Assets", fmt(totalAssets) as string);

    parent.createEl("div", { cls: "ledgr-stmt-spacer" });

    // LIABILITIES
    const liabSection = parent.createDiv("ledgr-stmt-section");
    this.stmtSectionLabel(liabSection, "Liabilities");

    let totalLiab = 0;
    const liabilities = netWorthData.accounts?.filter((a: any) => a.isLiability) ?? [];
    if (liabilities.length > 0) {
      liabilities.forEach((a: any) => {
        const amt = toBase(a.balance, a.currency);
        totalLiab += amt;
        this.stmtLine(liabSection, a.name, fmtSigned(-amt) as string, true);
      });
    } else {
      liabSection.createEl("p", { text: "No liabilities recorded.", cls: "ledgr-empty-state" });
    }
    this.stmtGrandTotal(liabSection, "Total Liabilities", totalLiab === 0 ? fmt(0) as string : fmt(totalLiab) as string);

    parent.createEl("div", { cls: "ledgr-stmt-spacer" });

    // NET WORTH — double-underline bottom total
    const netWorth = totalAssets - totalLiab;
    const totalEl = parent.createDiv("ledgr-stmt-total");
    totalEl.createEl("span", { text: "Net Worth" });
    totalEl.createEl("span", {
      text: fmt(netWorth) as string,
      cls: `ledgr-stmt-amt ${netWorth >= 0 ? "ledgr-positive" : "ledgr-negative"}`,
    });

    // Composition bar
    if (totalAssets > 0 || totalLiab > 0) {
      const barWrap = parent.createDiv("ledgr-stmt-comp-bar");
      const segs = buildNetWorthSegments(bankTotal, investTotal, totalLiab, fmt as any);
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
