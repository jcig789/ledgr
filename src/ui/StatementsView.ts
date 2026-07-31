import { ItemView, WorkspaceLeaf, Events } from "obsidian";
import LedgrPlugin from "../main";
import { readMonthTransactions, summarize, convertToBase } from "../data/reader";
import { loadNetWorth, NetWorthData, Account, Brokerage } from "../data/networth";
import { loadBudgets, BudgetConfig } from "../data/budgets";
import { Transaction } from "../data/transactions";
import { renderCompositionBar, buildNetWorthSegments } from "./charts";
import { formatCurrency } from "../constants/currencies";
import { buildProjection, ScenarioItem } from "../data/projection";

export const STATEMENTS_VIEW_TYPE = "ledgr-statements";

type StmtTab = "pl" | "cashflow" | "balance";
type CfView = "summary" | "grid" | "forecast";

export class StatementsView extends ItemView {
  plugin: LedgrPlugin;
  activeTab: StmtTab = "pl";
  cfView: CfView = "summary";
  selectedYear: string;
  viewCurrency: string;
  // Forecast state — ephemeral
  private forecastHorizon: 3 | 6 | 12;
  private forecastScenarios: ScenarioItem[] = [];
  private showScenarioForm = false;

  constructor(leaf: WorkspaceLeaf, plugin: LedgrPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.selectedYear = window.moment().format("YYYY");
    this.viewCurrency = plugin.settings.baseCurrency;
    this.forecastHorizon = plugin.settings.forecastDefaultHorizon ?? 6;
  }

  getViewType() { return STATEMENTS_VIEW_TYPE; }
  getDisplayText() { return "Statements"; }
  getIcon() { return "book-open"; }

  async onOpen() {
    this.containerEl.addClass("ledgr-view-active");
    await this.render();
    this.registerEvent(
      (this.app.workspace as Events).on("ledgr:settings-changed", async () => {
        await this.render();
      })
    );
  }

  async render() {
    // Validate viewCurrency against current settings — reset if no longer valid
    const validCurrencies = [this.plugin.settings.baseCurrency, ...this.plugin.settings.secondaryCurrencies];
    if (!validCurrencies.includes(this.viewCurrency)) {
      this.viewCurrency = this.plugin.settings.baseCurrency;
    }

    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ledgr-statements");

    // ── Sticky top zone: tabs + controls ──
    const stickyZone = contentEl.createDiv("ledgr-sticky-zone");

    const tabNav = stickyZone.createDiv("ledgr-top-tabs");
    [
      { key: "dashboard",  label: "Dashboard",  viewType: "ledgr-dashboard" },
      { key: "networth",   label: "Net Worth",   viewType: "ledgr-networth" },
      { key: "statements", label: "Statements",  viewType: "ledgr-statements" },
      { key: "standing",   label: "Standing",    viewType: "ledgr-standing" },
      { key: "calendar",   label: "Calendar",    viewType: "ledgr-calendar" },
    ].forEach(({ key, label, viewType }) => {
      const isActive = key === "statements";
      const btn = tabNav.createEl("button", {
        text: label,
        cls: `ledgr-top-tab${isActive ? " active" : ""}`,
      });
      if (!isActive) btn.onclick = () => void this.plugin.openView(viewType);
    });

    // Header
    const header = stickyZone.createDiv("ledgr-header");

    // Currency toggle
    const currencyRow = header.createDiv("ledgr-currency-row");
    [this.plugin.settings.baseCurrency, ...this.plugin.settings.secondaryCurrencies].forEach((c) => {
      const btn = currencyRow.createEl("button", {
        text: c,
        cls: `ledgr-currency-btn ${c === this.viewCurrency ? "active" : ""}`,
      });
      btn.onclick = async () => { this.viewCurrency = c; await this.render(); };
    });

    // Statement type tabs — inside sticky zone (must stay visible while scrolling)
    const tabRow = stickyZone.createDiv("ledgr-stmt-tabs");
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

    // Cash flow sub-tabs — rendered inside sticky zone so they stay visible while scrolling
    if (this.activeTab === "cashflow") {
      const cfTabRow = stickyZone.createDiv("ledgr-cf-subtabs");
      ([
        { key: "summary",  label: "Summary" },
        { key: "grid",     label: "Grid" },
        { key: "forecast", label: "Forecast" },
      ] as { key: CfView; label: string }[]).forEach(({ key, label }) => {
        const btn = cfTabRow.createEl("button", {
          text: label,
          cls: `ledgr-opex-tab${this.cfView === key ? " active" : ""}`,
        });
        btn.onclick = async () => { this.cfView = key; await this.render(); };
      });
    }

    const budgetConfig = await loadBudgets(this.app, this.plugin.settings);
    const netWorthData = await loadNetWorth(this.app, this.plugin.settings);
    // Financial statement formatter — abbreviates to K/M/B like professional reports
    // Zero-decimal currencies (no cents) never show decimal places
    const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "IDR", "CLP", "HUF", "ISK", "PYG", "TWD"]);
    const fmtStmt = (n: number): string => {
      const abs = Math.abs(n);
      const code = this.viewCurrency.toUpperCase();
      const isZeroDecimal = ZERO_DECIMAL.has(code);
      const { symbol, prefix } = (() => {
        const map: Record<string, { symbol: string; prefix: boolean }> = {
          USD: { symbol: "$", prefix: true }, JPY: { symbol: "¥", prefix: true },
          EUR: { symbol: "€", prefix: true }, GBP: { symbol: "£", prefix: true },
          PHP: { symbol: "₱", prefix: true }, CAD: { symbol: "C$", prefix: true },
          KRW: { symbol: "₩", prefix: true }, AUD: { symbol: "A$", prefix: true },
          SGD: { symbol: "S$", prefix: true },
        };
        return map[code] ?? { symbol: code + " ", prefix: true };
      })();
      const abbr = (val: number, divisor: number, suffix: string): string => {
        const divided = val / divisor;
        if (isZeroDecimal) return `${Math.round(divided)}${suffix}`;
        const fixed = divided.toFixed(1);
        // Strip trailing .0 for clean display: 1.0M → 1M
        return `${fixed.endsWith(".0") ? fixed.slice(0, -2) : fixed}${suffix}`;
      };
      let num: string;
      if (abs >= 1_000_000_000) num = abbr(abs, 1_000_000_000, "B");
      else if (abs >= 1_000_000) num = abbr(abs, 1_000_000, "M");
      else if (abs >= 10_000) num = abbr(abs, 1_000, "K");
      else num = Math.round(abs).toLocaleString();
      return prefix ? `${symbol}${num}` : `${num} ${symbol}`;
    };
    const fmt = (n: number) => fmtStmt(Math.abs(n));
    const fmtSigned = (n: number) => n < 0 ? `(${fmtStmt(Math.abs(n))})` : fmtStmt(n);

    // Year navigation — outside sticky zone, scrolls with content
    const yearRow = contentEl.createDiv("ledgr-month-row ledgr-stmt-year-row");
    const prevBtn = yearRow.createEl("button", { text: "←" });
    prevBtn.onclick = async () => {
      this.selectedYear = String(parseInt(this.selectedYear) - 1);
      await this.render();
    };
    yearRow.createSpan({ text: this.selectedYear, cls: "ledgr-month-label" });
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
    const refreshBtn = yearRow.createEl("button", { text: "↻", cls: "ledgr-stmt-refresh-btn" });
    refreshBtn.title = "Refresh data";
    refreshBtn.setAttribute("aria-label", "Refresh statements");
    refreshBtn.onclick = async () => {
      refreshBtn.addClass("ledgr-btn-disabled");
      await this.render();
    };

    const stmtWrap = contentEl.createDiv("ledgr-stmt");

    if (this.activeTab === "pl") {
      const months = Array.from({ length: 12 }, (_, i) =>
        window.moment(`${this.selectedYear}-01`).add(i, "month").format("YYYY-MM")
      );
      const monthlyTxs: Transaction[][] = await Promise.all(
        months.map((m) => readMonthTransactions(this.app, this.plugin.settings, m))
      );
      const allTxs: Transaction[] = ([] as Transaction[]).concat(...monthlyTxs);
      await this.renderPL(stmtWrap, allTxs, budgetConfig, fmt, fmtSigned);
    } else if (this.activeTab === "cashflow") {
      if (this.cfView === "summary") {
        await this.renderCashFlowSummary(stmtWrap, fmt, fmtSigned);
      } else if (this.cfView === "grid") {
        await this.renderCashFlow(stmtWrap, fmt, fmtSigned);
      } else {
        await this.renderForecast(stmtWrap, fmt);
      }
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

    parent.createDiv({ cls: "ledgr-stmt-spacer" });

    // EXPENSES section — CPA style: each line shows actual, budget column, variance column
    const expSection = parent.createDiv("ledgr-stmt-section");
    this.stmtSectionLabel(expSection, "Expenses");
    const hasBudgets = Object.keys(budgetConfig.limits).length > 0;

    if (hasBudgets) {
      // Use a single CSS grid table so header + rows share the same column widths
      const grid = expSection.createDiv("ledgr-stmt-budget-grid");

      // Header row
      grid.createSpan({ text: "", cls: "ledgr-stmt-budget-cell" });
      grid.createSpan({ text: "Actual", cls: "ledgr-stmt-budget-cell ledgr-stmt-col-hdr" });
      grid.createSpan({ text: "Budget (Annual)", cls: "ledgr-stmt-budget-cell ledgr-stmt-col-hdr" });
      grid.createSpan({ text: "Variance", cls: "ledgr-stmt-budget-cell ledgr-stmt-col-hdr" });

      Object.entries(summary.byCategory).sort((a, b) => b[1] - a[1]).forEach(([cat, amt]) => {
        const budgetRaw = budgetConfig.limits[cat];
        // Annualize: monthly budget × months in selected year
        // For current year (partial), count months with data; for past years, use 12
        const monthsInYear = parseInt(this.selectedYear) < parseInt(window.moment().format("YYYY")) ? 12
          : window.moment().month() + 1; // months elapsed in current year
        const budget = budgetRaw
          ? convertToBase(budgetRaw, budgetConfig.currency, this.viewCurrency, this.plugin.settings.exchangeRates) * monthsInYear
          : undefined;
        const actual = amt;

        grid.createSpan({ text: cat, cls: "ledgr-stmt-budget-cell ledgr-stmt-budget-name" });
        grid.createSpan({ text: fmt(actual), cls: "ledgr-stmt-budget-cell ledgr-stmt-amt" });

        if (budget !== undefined) {
          const variance = budget - actual;
          grid.createSpan({ text: fmt(budget), cls: "ledgr-stmt-budget-cell ledgr-stmt-amt ledgr-text-faint" });
          grid.createSpan({
            text: variance >= 0 ? `+${fmt(variance)}` : `(${fmt(Math.abs(variance))})`,
            cls: `ledgr-stmt-budget-cell ledgr-stmt-amt ${variance >= 0 ? "ledgr-positive" : "ledgr-negative"}`,
          });
        } else {
          grid.createSpan({ text: "—", cls: "ledgr-stmt-budget-cell ledgr-stmt-amt ledgr-text-faint" });
          grid.createSpan({ text: "—", cls: "ledgr-stmt-budget-cell ledgr-stmt-amt ledgr-text-faint" });
        }
      });

      // Total row inside the same grid
      grid.createSpan({ text: "Total Expenses", cls: "ledgr-stmt-budget-cell ledgr-stmt-budget-total" });
      grid.createSpan({ text: fmt(summary.totalExpenses), cls: "ledgr-stmt-budget-cell ledgr-stmt-amt ledgr-stmt-budget-total" });
      grid.createSpan({ cls: "ledgr-stmt-budget-cell" });
      grid.createSpan({ cls: "ledgr-stmt-budget-cell" });
    } else {
      Object.entries(summary.byCategory).sort((a, b) => b[1] - a[1]).forEach(([cat, amt]) => {
        this.stmtLine(expSection, cat, fmt(amt));
      });
    }


    // Bottom totals
    const totalEl = parent.createDiv("ledgr-stmt-total");
    totalEl.createSpan({ text: "Net Savings" });
    totalEl.createSpan({
      text: fmt(summary.net),
      cls: `ledgr-stmt-amt ${summary.net >= 0 ? "ledgr-positive" : "ledgr-negative"}`,
    });

    const rateEl = parent.createDiv("ledgr-stmt-rate-row");
    rateEl.createSpan({ text: "Savings Rate", cls: "ledgr-stmt-rate-label" });
    rateEl.createSpan({
      text: `${summary.savingsRate}%`,
      cls: `ledgr-stmt-amt ${summary.savingsRate >= 20 ? "ledgr-positive" : "ledgr-neutral"}`,
    });

    // Notes
    parent.createEl("p", {
      text: `Cash basis. Fiscal year ${this.selectedYear}. All amounts in ${this.viewCurrency}.`,
      cls: "ledgr-stmt-footnote",
    });
  }

  // ── Cash Flow Summary — three-section OCF/ICF/FCF statement ─────────────────

  async renderCashFlowSummary(parent: HTMLElement, fmt: (n: number) => string, fmtSigned: (n: number) => string) {
    const months = Array.from({ length: 12 }, (_, i) =>
      window.moment(`${this.selectedYear}-01`).add(i, "month").format("YYYY-MM")
    );
    const currentMonth = window.moment().format("YYYY-MM");
    const allTxs = await Promise.all(months.map((m) => readMonthTransactions(this.app, this.plugin.settings, m)));
    const yearTxs = ([] as Transaction[]).concat(...allTxs);
    const s = summarize(yearTxs, this.viewCurrency, this.plugin.settings.exchangeRates);

    this.stmtDocHeader(parent, "Statement of Cash Flows", this.selectedYear);

    // Consistent sign convention: parenthetical for negative, plain for positive (CPA standard)
    const fmtFlow = (v: number) => v >= 0 ? fmt(v) : fmtSigned(v);

    const addSection = (label: string, items: { label: string; value: number }[], net: number, netLabel: string) => {
      // W3: skip section entirely when net is zero and no non-zero line items
      const nonZero = items.filter((i) => i.value !== 0);
      if (net === 0 && nonZero.length === 0) return null;

      const sec = parent.createDiv("ledgr-stmt-section");
      this.stmtSectionLabel(sec, label);
      nonZero.forEach(({ label: l, value: v }) => {
        const row = this.stmtLine(sec, l, fmtFlow(v), true);
        if (v >= 0) row.querySelector<HTMLElement>(".ledgr-stmt-amt")?.addClass("ledgr-positive");
        else row.querySelector<HTMLElement>(".ledgr-stmt-amt")?.addClass("ledgr-negative");
      });
      this.stmtSubtotal(sec, netLabel, fmtFlow(net));
      const netEl = sec.querySelector<HTMLElement>(".ledgr-stmt-subtotal .ledgr-stmt-amt");
      if (netEl) netEl.addClass(net >= 0 ? "ledgr-positive" : "ledgr-negative");
      parent.createDiv({ cls: "ledgr-stmt-spacer" });
      return sec;
    };

    // Collect OCF line items from transaction categories
    const ocfInItems = s.transactions.filter((t) => t.type === "income" && (t.stream ?? "ocf") === "ocf");
    const ocfOutItems = s.transactions.filter((t) => t.type === "expense" && (t.stream ?? "ocf") === "ocf");
    const ocfInBySource = ocfInItems.reduce((acc, t) => { acc[t.subcategory] = (acc[t.subcategory] ?? 0) + t.amount; return acc; }, {} as Record<string, number>);
    const ocfOutByCategory = ocfOutItems.reduce((acc, t) => { acc[t.category] = (acc[t.category] ?? 0) + t.amount; return acc; }, {} as Record<string, number>);

    const ocfLines = [
      ...Object.entries(ocfInBySource).map(([l, v]) => ({ label: l, value: v })),
      ...Object.entries(ocfOutByCategory).map(([l, v]) => ({ label: l, value: -v })),
    ];
    addSection("Operating Activities", ocfLines, s.netOCF, "Net Operating Cash Flow");

    // ICF
    const icfTxs = s.transactions.filter((t) => (t.stream ?? "ocf") === "icf");
    const icfLines = icfTxs.reduce((acc, t) => {
      const key = t.subcategory;
      acc[key] = (acc[key] ?? 0) + (t.type === "income" ? t.amount : -t.amount);
      return acc;
    }, {} as Record<string, number>);
    addSection("Investing Activities", Object.entries(icfLines).map(([l, v]) => ({ label: l, value: v })), s.netICF, "Net Investing Cash Flow");

    // FCF
    const fcfTxs = s.transactions.filter((t) => (t.stream ?? "ocf") === "fcf");
    const fcfLines = fcfTxs.reduce((acc, t) => {
      const key = t.subcategory;
      acc[key] = (acc[key] ?? 0) + (t.type === "income" ? t.amount : -t.amount);
      return acc;
    }, {} as Record<string, number>);
    addSection("Financing Activities", Object.entries(fcfLines).map(([l, v]) => ({ label: l, value: v })), s.netFinancingCF, "Net Financing Cash Flow");

    // Net Change in Cash (= OCF + ICF + Financing) — renamed from "Free Cash Flow" per CFA review
    const totalEl = parent.createDiv("ledgr-stmt-total");
    totalEl.createSpan({ text: "Net Change in Cash" });
    totalEl.createSpan({
      text: fmtFlow(s.freeCashFlow),
      cls: `ledgr-stmt-amt ${s.freeCashFlow >= 0 ? "ledgr-positive" : "ledgr-negative"}`,
    });

    // Cash flow margin (net change / total income)
    if (s.totalIncome > 0) {
      const margin = Math.round((s.freeCashFlow / s.totalIncome) * 100);
      const rateEl = parent.createDiv("ledgr-stmt-rate-row");
      rateEl.createSpan({ text: "Cash Flow Margin", cls: "ledgr-stmt-rate-label" });
      rateEl.createSpan({ text: `${margin}%`, cls: `ledgr-stmt-amt ${margin >= 20 ? "ledgr-positive" : "ledgr-neutral"}` });
    }

    parent.createEl("p", {
      text: `Cash basis. Fiscal year ${this.selectedYear}. All amounts in ${this.viewCurrency}.`,
      cls: "ledgr-stmt-footnote",
    });
  }

  // ── Cash Flow Forecast — projection + what-if simulator ──────────────────────

  async renderForecast(parent: HTMLElement, fmt: (n: number) => string) {
    parent.createDiv("ledgr-stmt-doc-rule");
    const hdr = parent.createDiv("ledgr-stmt-doc-header");
    hdr.createDiv({ text: "Cash Flow Forecast", cls: "ledgr-stmt-doc-title" });
    hdr.createDiv({ text: "Forward visibility for strategic decisions", cls: "ledgr-stmt-doc-period" });
    parent.createDiv({ cls: "ledgr-stmt-doc-rule" });

    // Horizon toggle
    const horizonRow = parent.createDiv("ledgr-proj-horizon-row");
    horizonRow.createSpan({ text: "Horizon", cls: "ledgr-meta" });
    const horizonToggle = horizonRow.createDiv("ledgr-nw-history-range-selector");
    ([3, 6, 12] as const).forEach((h) => {
      const btn = horizonToggle.createEl("button", {
        text: h === 3 ? "3M" : h === 6 ? "6M" : "12M",
        cls: `ledgr-nw-history-range-btn${this.forecastHorizon === h ? " active" : ""}`,
      });
      btn.onclick = async () => { this.forecastHorizon = h; await this.render(); };
    });

    // Build projection input from history
    const today = window.moment().format("YYYY-MM");
    const historyMonths: string[] = [];
    for (let i = 5; i >= 0; i--) historyMonths.push(window.moment(today).subtract(i, "month").format("YYYY-MM"));
    const historyTxs = await Promise.all(historyMonths.map((m) => readMonthTransactions(this.app, this.plugin.settings, m)));
    const ocfHistory = historyTxs.map((txs, i) => {
      const s = summarize(txs, this.viewCurrency, this.plugin.settings.exchangeRates);
      return { month: historyMonths[i], income: s.ocfIncome, expenses: s.ocfExpenses };
    }).filter((h) => h.income > 0 || h.expenses > 0);

    // Fixed commitments and liquid balance from net worth
    let fixedCommitments = 0;
    let currentLiquidBalance = 0;
    try {
      const nwData = await loadNetWorth(this.app, this.plugin.settings);
      fixedCommitments = nwData.accounts
        .filter((a) => a.isLiability && a.liabilityDetails)
        .reduce((s, a) => s + convertToBase(a.liabilityDetails!.monthlyPayment, a.currency, this.viewCurrency, this.plugin.settings.exchangeRates), 0);
      // Liquid assets: bank, ewallet, cash accounts only
      const liquidTypes = new Set(["bank", "ewallet", "cash"]);
      currentLiquidBalance = nwData.accounts
        .filter((a) => !a.isLiability && liquidTypes.has(a.type))
        .reduce((s, a) => s + convertToBase(a.balance, a.currency, this.viewCurrency, this.plugin.settings.exchangeRates), 0);
    } catch { /* no networth */ }

    const result = buildProjection({
      monthlyOcfHistory: ocfHistory,
      fixedCommitments,
      currentLiquidBalance,
      reserveFloorMonths: 3,
      ocfCommitment: this.plugin.settings.ocfCommitments[today],
      scenarios: this.forecastScenarios,
    }, this.forecastHorizon);

    if (result.dataQuality === "insufficient") {
      parent.createEl("p", { text: "Record at least 2 months of transactions to generate a projection.", cls: "ledgr-nw-history-empty-msg" });
      return;
    }

    // Data quality notice
    if (result.dataQuality === "thin" || result.dataQuality === "building") {
      parent.createEl("p", {
        text: result.dataQuality === "thin"
          ? "Projection based on 2 months of data — high uncertainty. Continue logging for better accuracy."
          : "Projection based on 3–5 months. Accuracy improves with more history.",
        cls: "ledgr-bearing-explainer-note",
      });
    }

    // Summary cards
    const cards = parent.createDiv("ledgr-proj-cards");
    const lastMonth = result.months[result.months.length - 1];
    if (lastMonth) {
      const horizonLabel = this.forecastHorizon === 3 ? "3 months" : this.forecastHorizon === 6 ? "6 months" : "12 months";
      this.projCard(cards, `Projected OCF / mo`, fmt(result.baselineMonthlyNet), result.baselineMonthlyNet >= 0);
      this.projCard(cards, `Balance in ${horizonLabel}`, fmt(lastMonth.projectedBalance), lastMonth.projectedBalance >= 0);
      if (this.forecastScenarios.length > 0) {
        const baseResult = buildProjection({ monthlyOcfHistory: ocfHistory, fixedCommitments, currentLiquidBalance: 0, reserveFloorMonths: 3, scenarios: [] }, this.forecastHorizon);
        const baseLast = baseResult.months[baseResult.months.length - 1];
        if (baseLast) {
          const delta = lastMonth.projectedBalance - baseLast.projectedBalance;
          this.projCard(cards, "Scenario delta", `(${fmt(Math.abs(delta))})`, delta >= 0);
        }
      }
    }

    // Projection table
    const table = parent.createEl("table", { cls: "ledgr-stmt-cf-table" });
    const thead = table.createEl("thead").createEl("tr");
    ["Month", "Proj. OCF", "Balance", "Low", "High", ""].forEach((h) => {
      const th = thead.createEl("th");
      th.textContent = h;
      if (h !== "Month" && h !== "") th.addClass("ledgr-text-right");
    });
    const tbody = table.createEl("tbody");
    result.months.forEach((m) => {
      const tr = tbody.createEl("tr");
      tr.createEl("td", { text: window.moment(m.month).format("MMM YYYY") });
      const netTd = tr.createEl("td", { cls: "ledgr-text-right" });
      netTd.textContent = (m.projectedNet >= 0 ? "+" : "") + fmt(m.projectedNet);
      netTd.addClass(m.projectedNet >= 0 ? "ledgr-positive" : "ledgr-negative");
      tr.createEl("td", { text: fmt(m.projectedBalance), cls: "ledgr-text-right" });
      tr.createEl("td", { text: fmt(m.confidenceLow), cls: "ledgr-text-right ledgr-text-faint" });
      tr.createEl("td", { text: fmt(m.confidenceHigh), cls: "ledgr-text-right ledgr-text-faint" });
      const flagTd = tr.createEl("td");
      if (m.belowReserveFloor) flagTd.createSpan({ text: "▼ reserve", cls: "ledgr-text-red ledgr-meta" });
    });

    // Runway to commit
    if (result.runwayMonth && this.forecastScenarios.length > 0) {
      const runwayEl = parent.createDiv("ledgr-proj-runway");
      runwayEl.createSpan({ text: "Runway to Commit", cls: "ledgr-bearing-guidance-pillar" });
      runwayEl.createEl("p", {
        text: `Earliest viable start: ${window.moment(result.runwayMonth).format("MMMM YYYY")}`,
        cls: "ledgr-bearing-guidance-text",
      });
      result.runwayConditions.forEach((c) => {
        const row = runwayEl.createDiv("ledgr-bearing-pillar-row");
        row.createSpan({ text: c.met ? "✓" : "—", cls: c.met ? "ledgr-positive" : "ledgr-text-red" });
        row.createSpan({ text: c.label, cls: "ledgr-meta" });
      });
    } else if (this.forecastScenarios.length > 0 && !result.runwayMonth) {
      parent.createEl("p", {
        text: "This commitment is not supported within the projection horizon at current income and expense levels.",
        cls: "ledgr-bearing-guidance-text",
      });
    }

    // What-if form
    this.renderScenarioSection(parent, fmt);
  }

  renderScenarioSection(parent: HTMLElement, fmt: (n: number) => string) {
    const sec = parent.createDiv("ledgr-proj-scenario-section");
    sec.createDiv("ledgr-bearing-section-label").createSpan({ text: "Hypothetical" });

    // Active scenarios list
    if (this.forecastScenarios.length > 0) {
      this.forecastScenarios.forEach((s) => {
        const row = sec.createDiv("ledgr-proj-scenario-row");
        row.createSpan({ text: s.label, cls: "ledgr-bearing-guidance-pillar" });
        row.createSpan({ text: `${fmt(Math.abs(s.monthlyDelta))}/mo · ${window.moment(s.startMonth).format("MMM YYYY")} →`, cls: "ledgr-meta" });
        const removeBtn = row.createEl("button", { text: "×", cls: "ledgr-del-btn" });
        removeBtn.onclick = async () => {
          this.forecastScenarios = this.forecastScenarios.filter((sc) => sc.id !== s.id);
          await this.render();
        };
      });
    }

    if (this.forecastScenarios.length < 4) {
      if (!this.showScenarioForm) {
        const addBtn = sec.createEl("a", { text: `+ Add scenario${this.forecastScenarios.length > 0 ? ` (${this.forecastScenarios.length} of 4)` : ""}`, cls: "ledgr-bearing-guidance-link" });
        addBtn.onclick = async () => { this.showScenarioForm = true; await this.render(); };
      } else {
        // Inline form
        const form = sec.createDiv("ledgr-proj-scenario-form");
        const labelInput = form.createEl("input"); labelInput.type = "text"; labelInput.placeholder = "Description (e.g. new venture)"; labelInput.className = "ledgr-inline-input";
        const amtInput = form.createEl("input"); amtInput.type = "number"; amtInput.placeholder = "Monthly amount"; amtInput.className = "ledgr-inline-input";
        const typeSelect = form.createEl("select", { cls: "ledgr-inline-input" });
        ["Expense", "Income"].forEach((t) => typeSelect.createEl("option", { text: t, value: t.toLowerCase() }));
        const startInput = form.createEl("input"); startInput.type = "month"; startInput.value = window.moment().add(1, "month").format("YYYY-MM"); startInput.className = "ledgr-inline-input";

        const btnRow = form.createDiv("ledgr-btn-row");
        const applyBtn = btnRow.createEl("button", { text: "Apply", cls: "ledgr-log-btn mod-cta" });
        applyBtn.onclick = async () => {
          const amt = parseFloat(amtInput.value) || 0;
          if (!amt) return;
          const delta = typeSelect.value === "expense" ? -amt : amt;
          this.forecastScenarios.push({
            id: `sc_${Date.now()}`,
            label: labelInput.value.trim() || "Scenario",
            monthlyDelta: delta,
            startMonth: startInput.value,
          });
          this.showScenarioForm = false;
          await this.render();
        };
        const cancelBtn = btnRow.createEl("button", { text: "Cancel", cls: "ledgr-budget-btn" });
        cancelBtn.onclick = async () => { this.showScenarioForm = false; await this.render(); };
      }
    }

    parent.createEl("p", {
      text: "Projection uses trailing 3-month average. Low / High band widens by 8% per month from historical variance. 3M: high confidence · 6M: medium · 12M: directional.",
      cls: "ledgr-stmt-footnote",
    });
  }

  projCard(parent: HTMLElement, label: string, value: string, positive: boolean) {
    const card = parent.createDiv("ledgr-proj-card");
    card.createDiv({ text: label, cls: "ledgr-card-label" });
    card.createDiv({ text: value, cls: `ledgr-card-value ${positive ? "ledgr-positive" : "ledgr-negative"}` });
  }

  async renderCashFlow(parent: HTMLElement, fmt: (n: number) => string, fmtSigned: (n: number) => string) {
    this.stmtDocHeader(parent, "Statement of Cash Flows", this.selectedYear);

    const table = parent.createEl("table", { cls: "ledgr-stmt-cf-table" });
    const thead = table.createEl("thead");
    const hrow = thead.createEl("tr");
    [
      { full: "Month",    short: "Month" },
      { full: "Inflows",  short: "In" },
      { full: "Outflows", short: "Out" },
      { full: "Net Cash", short: "Net" },
    ].forEach(({ full, short }) => {
      const th = hrow.createEl("th");
      th.createSpan({ text: full, cls: "ledgr-cf-hdr-full" });
      th.createSpan({ text: short, cls: "ledgr-cf-hdr-short" });
      if (full !== "Month") th.addClass("ledgr-text-right");
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
      assetsSection.createDiv({ text: "Bank & Cash Accounts", cls: "ledgr-stmt-group-label" });
      bankAccounts.forEach((a: Account) => {
        const amt = toBase(a.balance, a.currency);
        bankTotal += amt;
        this.stmtLine(assetsSection, a.name, fmt(amt), true);
      });
      this.stmtSubtotal(assetsSection, "Total Bank & Cash", fmt(bankTotal));
    }

    let investTotal = 0;
    if (netWorthData.brokerages?.length > 0) {
      assetsSection.createDiv({ text: "Investment Accounts", cls: "ledgr-stmt-group-label" });
      netWorthData.brokerages.forEach((b: Brokerage) => {
        const amt = toBase(b.value, b.currency);
        investTotal += amt;
        this.stmtLine(assetsSection, b.name, fmt(amt), true);
      });
      this.stmtSubtotal(assetsSection, "Total Investments", fmt(investTotal));
    }

    const totalAssets = bankTotal + investTotal;
    this.stmtGrandTotal(assetsSection, "Total Assets", fmt(totalAssets));

    parent.createDiv({ cls: "ledgr-stmt-spacer" });

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

    parent.createDiv({ cls: "ledgr-stmt-spacer" });

    // NET WORTH — double-underline bottom total
    const netWorth = totalAssets - totalLiab;
    const totalEl = parent.createDiv("ledgr-stmt-total");
    totalEl.createSpan({ text: "Net Worth" });
    totalEl.createSpan({
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
    hdr.createDiv({ text: title, cls: "ledgr-stmt-doc-title" });
    hdr.createDiv({ text: period, cls: "ledgr-stmt-doc-period" });
    parent.createDiv({ cls: "ledgr-stmt-doc-rule" });
  }

  stmtSectionLabel(parent: HTMLElement, label: string) {
    parent.createDiv({ text: label, cls: "ledgr-stmt-section-label" });
  }

  stmtLine(parent: HTMLElement, label: string, amount: string, indent = false): HTMLElement {
    const row = parent.createDiv(`ledgr-stmt-line${indent ? " ledgr-stmt-line-indent" : ""}`);
    row.createSpan({ text: label });
    row.createSpan({ text: amount, cls: "ledgr-stmt-amt" });
    return row;
  }

  stmtSubtotal(parent: HTMLElement, label: string, amount: string) {
    const row = parent.createDiv("ledgr-stmt-line ledgr-stmt-subtotal");
    row.createSpan({ text: label });
    row.createSpan({ text: amount, cls: "ledgr-stmt-amt" });
  }

  stmtGrandTotal(parent: HTMLElement, label: string, amount: string) {
    const row = parent.createDiv("ledgr-stmt-line ledgr-stmt-grand-total");
    row.createSpan({ text: label });
    row.createSpan({ text: amount, cls: "ledgr-stmt-amt" });
  }

  async onClose() { this.containerEl.removeClass("ledgr-view-active"); this.contentEl.empty(); }
}
