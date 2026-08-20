import { ItemView, WorkspaceLeaf, TFile, normalizePath, Notice, Events, setIcon, Platform } from "obsidian";
import LedgrPlugin from "../main";
import { readMonthTransactions, summarize } from "../data/reader";
import { Currency } from "../settings";
import { QuickCaptureModal } from "./QuickCaptureModal";
import { BudgetModal } from "./BudgetModal";
import { ConfigModal } from "./ConfigModal";
import { RemittanceModal } from "./RemittanceModal";
import { loadBudgets } from "../data/budgets";
import { convertToBase } from "../data/reader";
import { loadRemittances, getRemittanceSummary, RemittanceStore, Remittance } from "../data/remittances";
import { BudgetConfig } from "../data/budgets";
import { getCategoryType } from "../constants/categories";
import { formatCurrency } from "../constants/currencies";
import { renderDonutChart, buildSpendingSegments, renderGauge, renderTrendLine, categoryColor } from "./charts";
import { EditTransactionModal } from "./EditTransactionModal";
import { loadNetWorth } from "../data/networth";
import { getUpcomingPayments, getDaysUntilDue } from "../data/liabilities";
import { LiabilityPaymentModal } from "./LiabilityPaymentModal";
import { TemplatesModal } from "./TemplatesModal";
import { BillsModal } from "./BillsModal";
import { loadBills, RecurringBill, resolveBillDueDay, isBillPaymentLogged, getDaysUntilBillDue, isBillActiveThisMonth } from "../data/bills";
import { resolveLiabilityDueDay, formatDueLabel } from "../data/liabilities";
import { BillPaymentModal } from "./BillPaymentModal";

export const DASHBOARD_VIEW_TYPE = "ledgr-dashboard";

export class DashboardView extends ItemView {
  plugin: LedgrPlugin;
  currentMonth: string;
  viewCurrency: Currency;
  private pendingDelete: { month: string; lineIndex: number; timer: number } | null = null;
  private isLiveMonth = true;
  private isRendering = false;
  private showAllTransactions = false;

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
    this.containerEl.addClass("ledgr-view-active");
    await this.render();
    this.registerEvent(
      (this.app.workspace as Events).on("ledgr:transaction-saved", async () => {
        await this.render();
      })
    );
    this.registerEvent(
      (this.app.workspace as Events).on("ledgr:settings-changed", async () => {
        await this.render();
      })
    );
    this.registerEvent(
      (this.app.workspace as Events).on("ledgr:categories-updated", async () => {
        await this.render();
      })
    );
    this.registerEvent(
      (this.app.workspace as Events).on("ledgr:networth-updated", async () => {
        await this.render();
      })
    );
  }

  async render() {
    if (this.isRendering) return;
    this.isRendering = true;
    try {
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

    const fmt = (n: number) => formatCurrency(n, this.viewCurrency);
    const isCurrentMonth = this.currentMonth >= window.moment().format("YYYY-MM");

    // ── Sticky top zone: tabs + controls ──
    const stickyZone = contentEl.createDiv("ledgr-sticky-zone");

    // Tab navigation
    const tabNav = stickyZone.createDiv("ledgr-top-tabs");
    const tabPages = [
      { key: "dashboard",  label: "Dashboard",  viewType: "ledgr-dashboard" },
      { key: "networth",   label: "Net Worth",   viewType: "ledgr-networth" },
      { key: "statements", label: "Statements",  viewType: "ledgr-statements" },
      { key: "standing",   label: "Standing",    viewType: "ledgr-standing" },
      { key: "calendar",   label: "Calendar",    viewType: "ledgr-calendar" },
    ];
    tabPages.forEach(({ key, label, viewType }) => {
      const isActive = key === "dashboard";
      const btn = tabNav.createEl("button", {
        text: label,
        cls: `ledgr-top-tab${isActive ? " active" : ""}`,
      });
      if (isActive) {
          window.setTimeout(() => btn.scrollIntoView({ behavior: "instant", block: "nearest", inline: "nearest" }), 150);
        } else {
          btn.onclick = () => void this.plugin.openView(viewType);
        }
    });

    // ── Controls bar: currency left, actions right ──
    const header = stickyZone.createDiv("ledgr-header");

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
    const logBtn = btnRow.createEl("button", { text: "+ Add", cls: "ledgr-log-btn mod-cta" });
    logBtn.onclick = () => new QuickCaptureModal(this.app, this.plugin.settings, this.currentMonth).open();
    if (this.plugin.settings.enableTransferTracker) {
      const remitBtn = btnRow.createEl("button", { text: "Transfer", cls: "ledgr-budget-btn" });
      remitBtn.onclick = () => new RemittanceModal(this.app, this.plugin).open();
    }
    const budgetBtn = btnRow.createEl("button", { text: "Budgets", cls: "ledgr-budget-btn" });
    budgetBtn.onclick = () => new BudgetModal(this.app, this.plugin).open();
    const billsBtn = btnRow.createEl("button", { text: "Obligations", cls: "ledgr-budget-btn" });
    billsBtn.onclick = () => new BillsModal(this.app, this.plugin).open();
    const templatesBtn = btnRow.createEl("button", { text: "Templates", cls: "ledgr-budget-btn" });
    templatesBtn.onclick = () => new TemplatesModal(this.app, this.plugin).open();
    // Settings — icon only to save space (Option A)
    const configBtn = btnRow.createEl("button", { cls: "ledgr-budget-btn ledgr-icon-btn" });
    configBtn.setAttribute("aria-label", "Settings");
    configBtn.title = "Settings";
    setIcon(configBtn, "settings");
    configBtn.onclick = () => new ConfigModal(this.app, this.plugin).open();

    // Month navigation — OUTSIDE sticky zone, renders in normal content flow
    const monthRow = contentEl.createDiv("ledgr-month-row");
    const prevBtn = monthRow.createEl("button", { text: "←" });
    prevBtn.setAttribute("aria-label", "Previous month");
    prevBtn.onclick = async () => {
      this.isLiveMonth = false;
      this.showAllTransactions = false;
      this.currentMonth = window.moment(this.currentMonth).subtract(1, "month").format("YYYY-MM");
      await this.render();
    };
    monthRow.createSpan({
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
        this.showAllTransactions = false;
        await this.render();
      };
    }

    // Exchange rate staleness banner (conditional)
    const rates = this.plugin.settings.exchangeRates;
    if (!rates.updatedAt || window.moment().diff(window.moment(rates.updatedAt), "days") > 7) {
      const banner = header.createDiv("ledgr-rate-banner");
      const msg = !rates.updatedAt
        ? "Exchange rates not set — PHP totals may be inaccurate."
        : `Exchange rates updated ${window.moment().diff(window.moment(rates.updatedAt), "days")} days ago.`;
      banner.createSpan({ text: msg });
      const updateLink = banner.createEl("a", { text: " Update now →", cls: "ledgr-rate-banner-link" });
      updateLink.onclick = () => new ConfigModal(this.app, this.plugin).open();
    }

    // First-run / empty state — also remove rate banner if no data yet
    if (transactions.length === 0 && prevTransactions.length === 0 && remittanceStore.remittances.length === 0) {
      contentEl.querySelector(".ledgr-rate-banner")?.remove();

      // Check if user has bills/liabilities set up (obligations-first onboarding path)
      // If so, show a contextual welcome instead of the generic first-run state
      try {
        const billStore = await loadBills(this.app, this.plugin.settings).catch(() => ({ bills: [] }));
        const nwData = await loadNetWorth(this.app, this.plugin.settings).catch(() => ({ accounts: [] as import("../data/networth").Account[], brokerages: [], updatedAt: "" }));
        const hasObligations = billStore.bills.filter((b) => !b.closedAt).length > 0
          || nwData.accounts.some((a) => a.isLiability && !a.liabilityDetails?.closedAt);
        if (hasObligations) {
          this.renderObligationsFirstRun(contentEl);
          return;
        }
      } catch { /* fall through to default first run */ }

      this.renderFirstRun(contentEl);
      return;
    }

    // Summary row: cards + gauge side by side
    const hasRemittances = summary.totalRemittances > 0 && this.plugin.settings.enableTransferTracker;
    const summaryRow = contentEl.createDiv("ledgr-summary-row");

    const cards = summaryRow.createDiv(`ledgr-cards${hasRemittances ? " ledgr-cards-4" : ""}`);

    // Card order: Income → Expenses → Net Cash Flow (natural accounting read order)
    this.createCard(cards, "Income", fmt(summary.totalIncome), "ledgr-income",
      prevSummary.totalIncome > 0 ? this.trend(summary.totalIncome, prevSummary.totalIncome) : null);
    this.createCard(cards, "Expenses", fmt(summary.totalExpenses), "ledgr-expense",
      prevSummary.totalExpenses > 0 ? this.trend(summary.totalExpenses, prevSummary.totalExpenses, true) : null,
      hasRemittances ? `incl. ${fmt(summary.totalRemittances)} transferred` : undefined);

    // Net Cash Flow — neutral colour when income not yet logged (incomplete data, not overspend)
    const netCls = summary.totalIncome === 0 && summary.totalExpenses > 0
      ? "ledgr-card-hero"  // neutral — income not logged yet
      : summary.net >= 0
        ? "ledgr-positive ledgr-card-hero"
        : "ledgr-negative ledgr-card-hero";
    const netSubtitle = summary.totalIncome === 0 && summary.totalExpenses > 0
      ? "Income not yet logged"
      : "Income minus all outflows";
    this.createCard(cards, "Net Position", fmt(summary.net), netCls,
      prevSummary.net !== 0 ? this.trend(summary.net, prevSummary.net) : null,
      netSubtitle);

    // Gauge: only when both income AND expenses are present (prevents false 100% on salary day)
    if (summary.totalIncome > 0 && summary.totalExpenses > 0) {
      const gaugeWrap = summaryRow.createDiv("ledgr-gauge-aside");
      renderGauge(gaugeWrap, summary.savingsRate, "savings rate", { good: 20, warn: 10, subtitle: "OCF basis" });
    } else if (summary.totalIncome === 0 && summary.totalExpenses > 0) {
      // Subtle nudge to log income
      const gaugeWrap = summaryRow.createDiv("ledgr-gauge-aside");
      const nudge = gaugeWrap.createEl("a", { text: "Log income →", cls: "ledgr-bearing-guidance-link ledgr-income-nudge" });
      nudge.onclick = () => new QuickCaptureModal(this.app, this.plugin.settings, this.currentMonth,
        { type: "income" }).open();
    }

    // Payments Due card — remaining obligations this month (total minus already-paid)
    try {
      const nwData = await loadNetWorth(this.app, this.plugin.settings);
      const liabilities = nwData.accounts.filter((a) => a.isLiability && a.liabilityDetails && !a.liabilityDetails.closedAt);
      const billStore = await loadBills(this.app, this.plugin.settings).catch(() => ({ bills: [] }));
      const activeBills = billStore.bills.filter((b) => !b.closedAt);
      const month = this.currentMonth;

      // Count variable obligations not yet paid this month
      let variableCount = liabilities.filter((a) => {
        const ld = a.liabilityDetails!;
        return ld.amountType === "variable" && !ld.payments?.some((p) => p.date.startsWith(month));
      }).length;
      variableCount += activeBills.filter((b) => b.amountType === "variable" && !b.payments.some((p) => p.date.startsWith(month))).length;

      // Sum remaining fixed obligations — deduct partial payments made this month
      const liabilityTotal = liabilities.reduce((sum, a) => {
        const ld = a.liabilityDetails!;
        if (ld.amountType === "variable") return sum;
        const paidThisMonth = (ld.payments ?? [])
          .filter((p) => p.date.startsWith(month))
          .reduce((s, p) => s + p.amount, 0);
        const remaining = Math.max(0, ld.monthlyPayment - paidThisMonth);
        if (remaining === 0) return sum;
        return sum + convertToBase(remaining, a.currency, this.viewCurrency, this.plugin.settings.exchangeRates);
      }, 0);
      const billTotal = activeBills.reduce((sum, b) => {
        if (b.amountType === "variable") return sum;
        const paidThisMonth = b.payments
          .filter((p) => p.date.startsWith(month))
          .reduce((s, p) => s + p.amount, 0);
        const remaining = Math.max(0, b.amount - paidThisMonth);
        if (remaining === 0) return sum;
        return sum + convertToBase(remaining, b.currency, this.viewCurrency, this.plugin.settings.exchangeRates);
      }, 0);
      const totalMonthly = liabilityTotal + billTotal;

      if (totalMonthly > 0 || variableCount > 0) {
        const cardLabel = variableCount > 0
          ? `Due This Month +${variableCount} variable`
          : "Due This Month";
        this.createCard(cards, cardLabel, fmt(totalMonthly), "ledgr-expense",
          null, "Remaining unpaid obligations");
      }
    } catch { /* no networth data */ }

    // Urgency banner — overdue/due-soon alert (before transactions so it's always visible)
    if (this.isLiveMonth) {
      await this.renderUpcomingPaymentsBanner(contentEl);
    }

    // ── Recent Transactions — immediately after cards and urgency alert ──
    this.renderTransactionSection(contentEl, transactions);

    // Post-first-transaction nudge — show once after first transaction logged
    if (transactions.length === 1 && prevTransactions.length === 0
        && Object.keys(budgetConfig.limits).length === 0) {
      const nudgeBanner = contentEl.createDiv("ledgr-rate-banner ledgr-nudge-banner");
      nudgeBanner.createSpan({ text: "Next: set monthly budgets for daily spending signals." });
      const nudgeLink = nudgeBanner.createEl("a", { text: " Set budgets →", cls: "ledgr-rate-banner-link" });
      nudgeLink.onclick = () => new BudgetModal(this.app, this.plugin).open();
    }

    // Scheduled This Month — full month planning view (current month only)
    if (this.isLiveMonth) {
      await this.renderScheduledThisMonth(contentEl);
    }

    // Daily countdown banner
    this.renderCountdownBanner(contentEl, budgetConfig, summary);

    // Cash Flow Health panel — shown for all months with data
    this.renderCashFlowHealth(contentEl, summary);

    // Opex / Capex breakdown
    this.renderOpexCapex(contentEl, summary, budgetConfig);

    // Monthly trend — last 6 months
    await this.renderTrendSection(contentEl);

    // Transfer widget — at bottom
    if (this.plugin.settings.enableTransferTracker && remittanceStore.remittances.length > 0) {
      this.renderRemittanceWidget(contentEl, remitSummary, remittanceStore);
    }
    } finally {
      this.isRendering = false;
    }
  }

  renderTransactionSection(parent: HTMLElement, transactions: import("../data/transactions").Transaction[]) {
    const txSection = parent.createDiv("ledgr-section");
    const txHeader = txSection.createDiv("ledgr-section-header");
    txHeader.createEl("h3", { text: "Recent Transactions" });

    // Search/filter — only shown when there are enough transactions to warrant it
    let filterText = "";
    if (transactions.length <= 10) {
      // Skip search row for small months — table is scannable without it
    } else {
    const searchRow = txSection.createDiv("ledgr-tx-search-row");
    const searchInput = searchRow.createEl("input", {
      attr: { type: "text", placeholder: "Search note, category, subcategory…", class: "ledgr-inline-input ledgr-tx-search" },
    }) as HTMLInputElement;
    const clearBtn = searchRow.createEl("button", { text: "✕", cls: "ledgr-del-btn ledgr-tx-search-clear ledgr-hidden" });

    const applyFilter = () => {
      const q = filterText.toLowerCase().trim();
      txSection.querySelectorAll<HTMLElement>(".ledgr-tx-filterable").forEach((row) => {
        const match = !q || (row.dataset.search ?? "").includes(q);
        row.toggleClass("ledgr-hidden", !match);
      });
      clearBtn.toggleClass("ledgr-hidden", !q);
    };

    searchInput.oninput = () => { filterText = searchInput.value; applyFilter(); };
    clearBtn.onclick = () => { filterText = ""; searchInput.value = ""; applyFilter(); };
    } // end search row block

    if (transactions.length > 10) {
      const viewAllLink = txHeader.createEl("a", {
        text: this.showAllTransactions ? "Show recent only ←" : `View all (${transactions.length}) →`,
        cls: "ledgr-bearing-guidance-link",
      });
      viewAllLink.onclick = () => {
        this.showAllTransactions = !this.showAllTransactions;
        viewAllLink.textContent = this.showAllTransactions
          ? "Show recent only ←"
          : `View all (${transactions.length}) →`;
        // Toggle rows in place — no full re-render, no scroll reset
        txSection.querySelectorAll(".ledgr-tx-row-hidden").forEach((r) => {
          r.toggleClass("ledgr-hidden", !this.showAllTransactions);
          r.removeClass("ledgr-tx-row-hidden");
          if (this.showAllTransactions) r.addClass("ledgr-tx-row-extra");
        });
        txSection.querySelectorAll(".ledgr-tx-row-extra").forEach((r) => {
          if (!this.showAllTransactions) {
            r.addClass("ledgr-hidden");
            r.removeClass("ledgr-tx-row-extra");
            r.addClass("ledgr-tx-row-hidden");
          }
        });
      };
    }

    const displayTxs = [...transactions].reverse();
    if (displayTxs.length === 0) {
      const emptyWrap = txSection.createDiv("ledgr-empty-cta-wrap");
      emptyWrap.createEl("p", { text: "No transactions this month.", cls: "ledgr-empty" });
      const addBtn = emptyWrap.createEl("button", { text: "+ Add transaction", cls: "ledgr-budget-btn" });
      addBtn.onclick = () => new QuickCaptureModal(this.app, this.plugin.settings, this.currentMonth).open();
      return;
    }

    const tableWrap = txSection.createDiv("ledgr-tx-table-wrap");
    const table = tableWrap.createEl("table", { cls: "ledgr-tx-table" });
    const thead = table.createEl("thead");
    const hrow = thead.createEl("tr");
    // Category/Subcategory merged into one column. Type removed (redundant with amount colour).
    ["Date", "Category", "Note", "Amount", ""].forEach((h) =>
      hrow.createEl("th", { text: h, cls: h === "" ? "ledgr-th-actions" : "" })
    );
    const tbody = table.createEl("tbody");

    displayTxs.forEach((tx, idx) => {
      const actualIndex = transactions.length - 1 - idx;
      const isExtra = idx >= 10;
      const searchKey = [tx.category, tx.subcategory, tx.note].join(" ").toLowerCase();
      const tr = tbody.createEl("tr", {
        cls: `ledgr-tx-filterable${isExtra ? (this.showAllTransactions ? " ledgr-tx-row-extra" : " ledgr-tx-row-hidden ledgr-hidden") : ""}`,
      });
      tr.dataset.search = searchKey;

      // Date: compact on mobile (MMM D), full ISO on desktop
      const dateCell = tr.createEl("td", { cls: "ledgr-tx-date-cell" });
      dateCell.createSpan({ text: window.moment(tx.date).format("MMM D"), cls: "ledgr-tx-date-short" });
      dateCell.createSpan({ text: tx.date, cls: "ledgr-tx-date-full" });

      // Category / Subcategory — two-line cell
      const catCell = tr.createEl("td", { cls: "ledgr-tx-cat-cell" });
      catCell.createDiv({ text: tx.category, cls: "ledgr-tx-cat" });
      if (tx.subcategory && tx.subcategory !== tx.category) {
        catCell.createDiv({ text: tx.subcategory, cls: "ledgr-tx-subcat" });
      }

      tr.createEl("td", { text: tx.note || "—", cls: "ledgr-note-col" });

      const amtCell = tr.createEl("td", {
        text: formatCurrency(tx.amount, tx.currency),
        cls: tx.type === "income" ? "ledgr-income ledgr-text-right" : "ledgr-expense ledgr-text-right",
      });

      const actionTd = tr.createEl("td", { cls: "ledgr-tx-actions" });
      const editBtn = actionTd.createEl("button", { cls: "ledgr-edit-btn" });
      setIcon(editBtn, "pencil");
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

  renderRemittanceWidget(parent: HTMLElement, remitSummary: ReturnType<typeof getRemittanceSummary>, store: RemittanceStore) {
    const base = this.plugin.settings.baseCurrency;
    const sec = this.plugin.settings.secondaryCurrencies[0] ?? "";
    const widget = parent.createDiv("ledgr-remit-widget");
    const header = widget.createDiv("ledgr-remit-widget-header");
    header.createSpan({ text: "Transfers", cls: "ledgr-remit-widget-title" });
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
        dateTd.createDiv({ text: r.date });
        dateTd.createDiv({ text: `@ ${r.rateAtSend.toFixed(4)}`, cls: "ledgr-remit-row-rate" });
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
      const sentSpan = footer.createSpan();
      sentSpan.appendText(`${filtered.length} transfers · `);
      sentSpan.createSpan({ text: `${base} ${totalSent.toLocaleString()}`, cls: "ledgr-remit-history-footer-val" });
      sentSpan.appendText(" sent");
      if (totalReceived > 0 && sec) {
        const recvSpan = footer.createSpan();
        recvSpan.createSpan({ text: `${totalReceived.toLocaleString()} ${sec}`, cls: "ledgr-remit-history-footer-val" });
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

  async renderUpcomingPaymentsBanner(parent: HTMLElement) {
    if (!this.isLiveMonth) return;
    const today = window.moment().format("YYYY-MM-DD");
    const month = window.moment().format("YYYY-MM");

    // Collect urgent liabilities
    let urgentLiabilities: import("../data/networth").Account[] = [];
    try {
      const nwData = await loadNetWorth(this.app, this.plugin.settings);
      urgentLiabilities = getUpcomingPayments(nwData.accounts, today, month);
    } catch { /* no networth data */ }

    // Collect urgent bills (due within reminderDaysAhead, not yet paid)
    let urgentBills: RecurringBill[] = [];
    try {
      const billStore = await loadBills(this.app, this.plugin.settings);
      const activeBills = billStore.bills.filter((b) => !b.closedAt && b.reminderEnabled);
      urgentBills = activeBills.filter((bill) => {
        const daysLeft = getDaysUntilBillDue(bill, today, month);
        const paid = isBillPaymentLogged(bill, month);
        return daysLeft <= bill.reminderDaysAhead && !paid;
      });
    } catch { /* no bills data */ }

    if (urgentLiabilities.length === 0 && urgentBills.length === 0) return;

    const banner = parent.createDiv("ledgr-upcoming-payments");
    banner.createDiv({ text: "Upcoming Payments", cls: "ledgr-upcoming-payments-title" });

    urgentLiabilities.forEach((acc) => {
      const ld = acc.liabilityDetails!;
      const daysLeft = getDaysUntilDue(acc, today);
      const isOverdue = daysLeft < 0;
      const isDueToday = daysLeft === 0;
      const row = banner.createDiv(`ledgr-payment-due-row${isDueToday || isOverdue ? " ledgr-payment-due-urgent" : ""}`);
      row.createSpan({ text: acc.name, cls: "ledgr-payment-due-name" });
      const meta = row.createDiv("ledgr-payment-due-meta");
      const dueLabel = isOverdue ? `${Math.abs(daysLeft)}d overdue` : isDueToday ? "Due today" : `Due in ${daysLeft}d`;
      meta.createSpan({ text: dueLabel, cls: isOverdue || isDueToday ? "ledgr-text-red" : "" });
      const isVariable = ld.amountType === "variable";
      row.createSpan({
        text: isVariable ? "Varies" : formatCurrency(ld.monthlyPayment, acc.currency),
        cls: "ledgr-payment-due-amount" + (isVariable ? " ledgr-meta" : ""),
      });
      const payBtn = row.createEl("button", { text: isVariable ? "Log" : "Pay", cls: "ledgr-budget-btn" });
      payBtn.onclick = () => new LiabilityPaymentModal(
        this.app, this.plugin, acc, () => { void this.render(); }
      ).open();
    });

    urgentBills.forEach((bill) => {
      const daysLeft = getDaysUntilBillDue(bill, today, month);
      const isOverdue = daysLeft < 0;
      const isDueToday = daysLeft === 0;
      const row = banner.createDiv(`ledgr-payment-due-row${isDueToday || isOverdue ? " ledgr-payment-due-urgent" : ""}`);
      row.createSpan({ text: bill.name, cls: "ledgr-payment-due-name" });
      const meta = row.createDiv("ledgr-payment-due-meta");
      const dueLabel = isOverdue ? `${Math.abs(daysLeft)}d overdue` : isDueToday ? "Due today" : `Due in ${daysLeft}d`;
      meta.createSpan({ text: dueLabel, cls: isOverdue || isDueToday ? "ledgr-text-red" : "" });
      const isVariable = bill.amountType === "variable";
      row.createSpan({
        text: isVariable ? "Varies" : (bill.amount > 0 ? formatCurrency(bill.amount, bill.currency) : "—"),
        cls: "ledgr-payment-due-amount" + (isVariable ? " ledgr-meta" : ""),
      });
      const logBtn = row.createEl("button", { text: "Log", cls: "ledgr-budget-btn" });
      logBtn.onclick = () => new BillPaymentModal(
        this.app, this.plugin, bill, () => { void this.render(); }
      ).open();
    });
  }

  async renderScheduledThisMonth(parent: HTMLElement) {
    const today = window.moment().format("YYYY-MM-DD");
    const month = window.moment().format("YYYY-MM");

    let liabilities: import("../data/networth").Account[] = [];
    let bills: RecurringBill[] = [];

    try {
      const nwData = await loadNetWorth(this.app, this.plugin.settings);
      liabilities = nwData.accounts.filter((a) => a.isLiability && a.liabilityDetails && !a.liabilityDetails.closedAt);
    } catch { /* no networth */ }

    try {
      const billStore = await loadBills(this.app, this.plugin.settings);
      bills = billStore.bills.filter((b) => !b.closedAt && isBillActiveThisMonth(b, month));
    } catch { /* no bills */ }

    if (liabilities.length === 0 && bills.length === 0) return;

    type ScheduledItem = {
      id: string;
      name: string;
      amount: number;
      amountType: "fixed" | "variable" | "estimated";
      amountMax?: number;
      currency: string;
      dueDay: number;
      daysUntilDue: number;
      isPaid: boolean;
      paidAmount: number;   // actual logged payment this month (0 if not paid)
      isLiability: boolean;
      liabilityAccount?: import("../data/networth").Account;
      bill?: RecurringBill;
    };

    const items: ScheduledItem[] = [];

    for (const acc of liabilities) {
      const ld = acc.liabilityDetails!;
      const dueDay = resolveLiabilityDueDay(acc, month);
      if (dueDay === null) continue;
      const dueDate = window.moment(month + "-" + String(dueDay).padStart(2, "0"));
      const daysUntilDue = dueDate.diff(window.moment(today), "days");
      const monthPayments = ld.payments?.filter((p) => p.date.startsWith(month)) ?? [];
      const isPaid = monthPayments.length > 0;
      const paidAmount = monthPayments.reduce((s, p) => s + p.amount, 0);
      items.push({
        id: acc.id,
        name: acc.name,
        amount: ld.monthlyPayment,
        amountType: ld.amountType ?? "fixed",
        amountMax: ld.amountMax,
        currency: acc.currency,
        dueDay,
        daysUntilDue,
        isPaid,
        paidAmount,
        isLiability: true,
        liabilityAccount: acc,
      });
    }

    for (const bill of bills) {
      const dueDay = resolveBillDueDay(bill, month);
      if (dueDay === null) continue;
      const daysUntilDue = getDaysUntilBillDue(bill, today, month);
      const monthPayments = bill.payments.filter((p) => p.date.startsWith(month));
      const isPaid = monthPayments.length > 0;
      const paidAmount = monthPayments.reduce((s, p) => s + p.amount, 0);
      items.push({
        id: bill.id,
        name: bill.name,
        amount: bill.amount,
        amountType: bill.amountType,
        amountMax: bill.amountMax,
        currency: bill.currency,
        dueDay,
        daysUntilDue,
        isPaid,
        paidAmount,
        isLiability: false,
        bill,
      });
    }

    if (items.length === 0) return;

    // Sort: overdue first → due within 3 days → unpaid by date → paid last
    items.sort((a, b) => {
      if (a.isPaid !== b.isPaid) return a.isPaid ? 1 : -1;
      if (!a.isPaid && !b.isPaid) return a.daysUntilDue - b.daysUntilDue;
      return a.dueDay - b.dueDay;
    });

    // Totals footer — use actual paidAmount (from payments[]) not the stored amount field
    // so variable items contribute real paid values, not 0
    const scheduledTotal = items.reduce((s, i) => {
      const base = i.amountType !== "variable"
        ? convertToBase(i.amount, i.currency, this.viewCurrency, this.plugin.settings.exchangeRates)
        : convertToBase(i.paidAmount, i.currency, this.viewCurrency, this.plugin.settings.exchangeRates);
      return s + base;
    }, 0);
    const paidTotal = items.filter((i) => i.isPaid).reduce((s, i) =>
      s + convertToBase(i.paidAmount, i.currency, this.viewCurrency, this.plugin.settings.exchangeRates), 0);
    const remainingTotal = Math.max(0, scheduledTotal - paidTotal);

    const section = parent.createDiv("ledgr-section ledgr-scheduled-section");
    const hdr = section.createDiv("ledgr-section-header");
    hdr.createEl("h3", { text: "Scheduled This Month" });

    // Collapsed by default on mobile, expanded on desktop
    let expanded = !Platform.isMobile;
    const unpaidCount = items.filter((i) => !i.isPaid).length;
    const toggleBtn = hdr.createEl("a", {
      text: expanded ? `${items.length} items` : `${unpaidCount} unpaid ↓`,
      cls: "ledgr-bearing-guidance-link ledgr-scheduled-toggle",
    });
    const listEl = section.createDiv(`ledgr-scheduled-list${expanded ? "" : " ledgr-hidden"}`);

    toggleBtn.onclick = () => {
      expanded = !expanded;
      listEl.toggleClass("ledgr-hidden", !expanded);
      toggleBtn.textContent = expanded ? `${items.length} items` : `${unpaidCount} unpaid ↓`;
    };

    // Separate unpaid (week-grouped) from paid (flat block at bottom)
    const unpaidItems = items.filter((i) => !i.isPaid);
    const paidItems = items.filter((i) => i.isPaid).sort((a, b) => a.dueDay - b.dueDay);

    // Week grouping for unpaid items only
    const weekBoundaries = [
      { label: "WEEK 1", days: [1, 7] },
      { label: "WEEK 2", days: [8, 14] },
      { label: "WEEK 3", days: [15, 21] },
      { label: "WEEK 4", days: [22, 28] },
      { label: "WEEK 5", days: [29, 31] },
    ];

    let lastWeek = -1;

    const renderRow = (item: typeof items[0]) => {
      const row = listEl.createDiv(`ledgr-scheduled-row${item.isPaid ? " ledgr-scheduled-paid" : ""}`);
      const marker = row.createSpan({ text: item.isLiability ? "★" : "○", cls: "ledgr-scheduled-marker" });
      if (!item.isLiability) marker.addClass("ledgr-scheduled-marker--bill");

      const nameEl = row.createSpan({ text: item.name, cls: "ledgr-scheduled-name" });
      if (item.isPaid) nameEl.addClass("ledgr-text-faint");

      // Due date label
      const dueLabel = item.isPaid
        ? "PAID"
        : item.daysUntilDue < 0
          ? `${Math.abs(item.daysUntilDue)}d overdue`
          : item.daysUntilDue === 0
            ? "Due today"
            : item.daysUntilDue <= 3
              ? `Due in ${item.daysUntilDue}d`
              : `${window.moment(month + "-" + String(item.dueDay).padStart(2, "0")).format("MMM D")}`;

      const dueCls = item.isPaid
        ? "ledgr-scheduled-due ledgr-text-faint"
        : item.daysUntilDue < 0 || item.daysUntilDue === 0
          ? "ledgr-scheduled-due ledgr-text-red"
          : item.daysUntilDue <= 3
            ? "ledgr-scheduled-due ledgr-scheduled-soon"
            : "ledgr-scheduled-due";

      row.createSpan({ text: dueLabel, cls: dueCls });

      // Amount
      if (!item.isPaid) {
        let amtText = "—";
        if (item.amountType === "fixed" && item.amount > 0) {
          amtText = formatCurrency(item.amount, item.currency);
        } else if (item.amountType === "estimated" && item.amount > 0) {
          amtText = item.amountMax
            ? `${formatCurrency(item.amount, item.currency)}–${formatCurrency(item.amountMax, item.currency)}`
            : `~${formatCurrency(item.amount, item.currency)}`;
        }
        row.createSpan({ text: amtText, cls: "ledgr-scheduled-amount" });
      }

      // CTA
      if (!item.isPaid) {
        if (item.isLiability && item.liabilityAccount) {
          const payBtn = row.createEl("button", {
            text: item.amountType === "variable" ? "Log →" : "Pay →",
            cls: "ledgr-budget-btn ledgr-scheduled-cta",
          });
          payBtn.onclick = () => new LiabilityPaymentModal(
            this.app, this.plugin, item.liabilityAccount!, () => { void this.render(); }
          ).open();
        } else if (item.bill) {
          const logBtn = row.createEl("button", { text: "Log →", cls: "ledgr-budget-btn ledgr-scheduled-cta" });
          logBtn.onclick = () => new BillPaymentModal(
            this.app, this.plugin, item.bill!, () => { void this.render(); }
          ).open();
        }
      }
    };

    // Render unpaid items with week grouping
    for (const item of unpaidItems) {
      const weekIdx = weekBoundaries.findIndex((w) => item.dueDay >= w.days[0] && item.dueDay <= w.days[1]);
      if (weekIdx !== lastWeek && weekIdx >= 0) {
        lastWeek = weekIdx;
        listEl.createDiv({ text: weekBoundaries[weekIdx].label, cls: "ledgr-scheduled-week-label" });
      }
      renderRow(item);
    }

    // Render paid items as a flat block at the bottom — no week labels
    if (paidItems.length > 0) {
      listEl.createDiv({ text: "PAID THIS MONTH", cls: "ledgr-scheduled-week-label ledgr-text-faint" });
      for (const item of paidItems) renderRow(item);
    }

    // Inactive bills note — annual/once bills not due this month
    try {
      const allBillStore = await loadBills(this.app, this.plugin.settings);
      const inactiveCount = allBillStore.bills.filter((b) => !b.closedAt && !isBillActiveThisMonth(b, month)).length;
      if (inactiveCount > 0) {
        const noteEl = section.createEl("p", { cls: "ledgr-meta" });
        noteEl.createSpan({ text: `${inactiveCount} bill${inactiveCount !== 1 ? "s" : ""} not due this month (annual or one-time). ` });
        const manageNote = noteEl.createEl("a", { text: "View all →", cls: "ledgr-bearing-guidance-link" });
        manageNote.onclick = () => new BillsModal(this.app, this.plugin).open();
      }
    } catch { /* no bills */ }

    // Footer totals + Manage link
    const footer = section.createDiv("ledgr-scheduled-footer");
    const fmt = (n: number) => formatCurrency(n, this.viewCurrency);
    footer.createSpan({ text: `Scheduled ${fmt(scheduledTotal)}`, cls: "ledgr-scheduled-footer-item" });
    footer.createSpan({ text: "·", cls: "ledgr-countdown-sep" });
    footer.createSpan({ text: `Paid ${fmt(paidTotal)}`, cls: "ledgr-scheduled-footer-item ledgr-text-faint" });
    footer.createSpan({ text: "·", cls: "ledgr-countdown-sep" });
    footer.createSpan({
      text: `Remaining ${fmt(remainingTotal)}`,
      cls: `ledgr-scheduled-footer-item${remainingTotal > 0 ? " ledgr-expense" : " ledgr-positive"}`,
    });
    footer.createSpan({ text: "·", cls: "ledgr-countdown-sep" });
    const manageLink = footer.createEl("a", { text: "Manage →", cls: "ledgr-bearing-guidance-link ledgr-scheduled-footer-item" });
    manageLink.onclick = () => new BillsModal(this.app, this.plugin).open();
  }

  renderCashFlowHealth(parent: HTMLElement, summary: ReturnType<typeof summarize>) {
    if (summary.totalIncome === 0 && summary.totalExpenses === 0) return;

    const fmt = (n: number) => formatCurrency(Math.abs(n), this.viewCurrency);
    const month = this.currentMonth;
    // OCF commitment line only meaningful for the current month
    const commitment = this.isLiveMonth ? this.plugin.settings.ocfCommitments[month] : undefined;

    const section = parent.createDiv("ledgr-section ledgr-cf-health-section");
    const hdr = section.createDiv("ledgr-section-header");
    hdr.createEl("h3", { text: "Cash Flow Health" });

    // OCF Commitment Line — set target
    const commitRow = section.createDiv("ledgr-cf-commitment-row");
    if (commitment) {
      const progress = summary.netOCF;
      const pct = commitment > 0 ? Math.min(100, Math.round((progress / commitment) * 100)) : 0;
      const commitMeta = commitRow.createDiv("ledgr-cf-commitment-meta");
      commitMeta.createSpan({ text: "OCF Target", cls: "ledgr-cf-stream-label" });
      commitMeta.createSpan({ text: fmt(commitment), cls: "ledgr-meta" });
      const commitBar = commitRow.createDiv("ledgr-cf-commitment-bar-wrap");
      const bar = commitBar.createDiv("ledgr-cf-commitment-bar");
      bar.setCssStyles({ width: "0%" });
      window.requestAnimationFrame(() => bar.setCssStyles({ width: `${pct}%` }));
      commitRow.createSpan({ text: `${pct}%`, cls: `ledgr-cf-commitment-pct ${pct >= 100 ? "ledgr-bearing-strong" : pct >= 60 ? "ledgr-bearing-moderate" : "ledgr-bearing-developing"}` });
    } else {
      // Inline input — no window.prompt() (breaks mobile, wrong aesthetic)
      const setBtn = commitRow.createEl("a", { text: "Set OCF target →", cls: "ledgr-bearing-guidance-link" });
      setBtn.onclick = () => {
        commitRow.empty();
        const input = commitRow.createEl("input", { attr: { type: "number", placeholder: `Target (${this.viewCurrency})`, class: "ledgr-inline-input ledgr-cf-commitment-input" } }) as HTMLInputElement;
        input.setCssStyles({ width: "140px" });
        const saveBtn = commitRow.createEl("button", { text: "Set", cls: "ledgr-budget-btn" });
        const cancel = commitRow.createEl("button", { text: "Cancel", cls: "ledgr-budget-btn" });

        const save = async () => {
          const val = parseFloat(input.value);
          if (!isNaN(val) && val > 0) {
            this.plugin.settings.ocfCommitments[month] = val;
            await this.plugin.saveSettings();
            void this.render();
          }
        };
        saveBtn.onclick = () => void save();
        input.onkeydown = (e) => { if (e.key === "Enter") void save(); };
        cancel.onclick = () => void this.render();
        window.setTimeout(() => input.focus(), 30);
      };
    }

    // Four stream numbers
    const streams = section.createDiv("ledgr-cf-streams");

    const addStream = (label: string, value: number, cls: string, note?: string) => {
      const row = streams.createDiv("ledgr-cf-stream-row");
      row.createSpan({ text: label, cls: "ledgr-cf-stream-label" });
      const right = row.createDiv("ledgr-cf-stream-right");
      const sign = value >= 0 ? "+" : "";
      right.createSpan({ text: `${sign}${fmt(value)}`, cls: `ledgr-cf-stream-value ${cls}` });
      if (note) right.createSpan({ text: note, cls: "ledgr-meta" });
    };

    addStream("Operating", summary.netOCF, summary.netOCF >= 0 ? "ledgr-positive" : "ledgr-negative");
    addStream("Investing", summary.netICF, "ledgr-text-secondary", "capital deployed");
    addStream("Financing", summary.netFinancingCF, "ledgr-text-secondary", "debt service");

    const divider = streams.createDiv("ledgr-cf-stream-divider");
    addStream("Net Cash Flow (Period)", summary.freeCashFlow, summary.freeCashFlow >= 0 ? "ledgr-positive" : "ledgr-negative");
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
    const fmt = (n: number) => formatCurrency(Math.abs(n), this.viewCurrency);

    const banner = parent.createDiv("ledgr-countdown");

    const daysClass = pctLeft < 0.1 || remaining < 0 ? "ledgr-countdown-over"
      : pctLeft < 0.3 ? "ledgr-countdown-warn" : "";

    banner.createSpan({
      text: daysLeft === 1 ? "Last day" : String(daysLeft),
      cls: `ledgr-countdown-days ${daysClass}`,
    });
    banner.createSpan({
      text: daysLeft === 1 ? " of the month" : " days left in " + window.moment(this.currentMonth).format("MMMM"),
      cls: "ledgr-countdown-label",
    });
    banner.createSpan({ text: "·", cls: "ledgr-countdown-sep" });

    if (remaining < 0) {
      banner.createSpan({ text: `${fmt(remaining)} over budget`, cls: "ledgr-countdown-budget ledgr-countdown-over" });
    } else {
      banner.createSpan({ text: fmt(remaining), cls: "ledgr-countdown-budget" });
      banner.createSpan({ text: " remaining", cls: "ledgr-countdown-suffix" });
      if (daysLeft > 1) {
        banner.createSpan({ text: "·", cls: "ledgr-countdown-sep" });
        banner.createSpan({ text: `${fmt(dailyAllowance)} / day`, cls: "ledgr-countdown-budget" });
      }
    }
  }

  createRemitStat(parent: HTMLElement, label: string, jpy: string, php: string, highlight = false) {
    const stat = parent.createDiv(`ledgr-remit-stat${highlight ? " ledgr-remit-lifetime" : ""}`);
    stat.createDiv({ text: label, cls: "ledgr-remit-stat-label" });
    if (jpy) stat.createDiv({ text: jpy, cls: "ledgr-remit-stat-jpy" });
    if (php) stat.createDiv({ text: php, cls: "ledgr-remit-stat-php" });
  }

  renderOpexCapex(parent: HTMLElement, summary: ReturnType<typeof summarize>, budgetConfig: BudgetConfig) {
    const section = parent.createDiv("ledgr-section");
    const spendHdr = section.createDiv("ledgr-section-header");
    spendHdr.createEl("h3", { text: "Spending by Category" });
    spendHdr.createSpan({ text: "all outflows incl. debt service", cls: "ledgr-meta" });

    const sorted = Object.entries(summary.byCategory).sort((a, b) => b[1] - a[1]);
    const fmt = (n: number) => formatCurrency(n, this.viewCurrency);

    if (sorted.length === 0) {
      section.createEl("p", { text: "No expenses this month.", cls: "ledgr-empty-state" });
      return;
    }

    // Donut chart
    const chartWrap = section.createDiv("ledgr-chart-wrap");
    const segments = buildSpendingSegments(summary.byCategory, fmt);
    renderDonutChart(chartWrap, segments, "expenses", fmt(summary.totalExpenses));

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
      const dot = nameWrap.createSpan({ cls: "ledgr-cat-dot" });
      dot.setCssStyles({ backgroundColor: catColor }); // dynamic color — setCssStyles required
      nameWrap.createSpan({ text: cat, cls: "ledgr-cat-name" });
      if (catType === "fixed") {
        nameWrap.createSpan({ text: "fixed", cls: "ledgr-cat-type-tag ledgr-cat-type-fixed" });
      } else if (catType === "variable") {
        nameWrap.createSpan({ text: "variable", cls: "ledgr-cat-type-tag ledgr-cat-type-variable" });
      }
      const barWrap = row.createDiv("ledgr-bar-wrap");
      const bar = barWrap.createDiv(`ledgr-bar${overBudget ? " ledgr-bar-over" : ""}`);
      if (!overBudget) bar.setCssStyles({ backgroundColor: catColor });
      bar.setCssStyles({ width: "0%" });
      window.requestAnimationFrame(() => { bar.setCssStyles({ width: `${Math.round(pct)}%` }); });
      const amtText = budget ? `${fmt(amt)} / ${fmt(budget)}` : fmt(amt);
      row.createSpan({ text: amtText, cls: `ledgr-cat-amt${overBudget ? " ledgr-negative" : ""}` });
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

  renderObligationsFirstRun(parent: HTMLElement) {
    const state = parent.createDiv("ledgr-first-run");
    state.createDiv({ cls: "ledgr-first-run-rule" });
    state.createEl("h3", { text: "Obligations set up" });
    state.createEl("p", { text: "Your bills and liabilities are ready. Log your first payment when one comes due." });

    const steps = state.createDiv("ledgr-first-run-steps");
    [
      { n: "1", label: "See obligations in Scheduled This Month below" },
      { n: "2", label: "Tap Pay → or Log → when a bill is due" },
      { n: "3", label: "Log your income to track savings rate" },
    ].forEach(({ n, label }) => {
      const step = steps.createDiv("ledgr-first-run-step");
      step.createSpan({ text: n, cls: "ledgr-step-num" });
      step.createSpan({ text: label });
    });

    const addBtn = state.createEl("button", {
      text: "+ Log a transaction",
      cls: "ledgr-log-btn mod-cta ledgr-first-run-cta",
    });
    addBtn.onclick = () => new QuickCaptureModal(this.app, this.plugin.settings, this.currentMonth).open();

    // Render Scheduled section even with no transactions
    void this.renderScheduledThisMonth(parent);
  }

  renderFirstRun(parent: HTMLElement) {
    const state = parent.createDiv("ledgr-first-run");
    state.createDiv({ cls: "ledgr-first-run-rule" });
    state.createEl("h3", { text: "Welcome to Ledgr" });
    state.createEl("p", { text: "Your money, both sides of the ocean." });

    const steps = state.createDiv("ledgr-first-run-steps");
    [
      { n: "1", label: "Log a transaction" },
      { n: "2", label: "Set monthly budgets" },
      { n: "3", label: "See your full picture" },
    ].forEach(({ n, label }) => {
      const step = steps.createDiv("ledgr-first-run-step");
      step.createSpan({ text: n, cls: "ledgr-step-num" });
      step.createSpan({ text: label });
    });

    const cta = state.createEl("button", { text: "+ Add your first transaction", cls: "ledgr-log-btn mod-cta ledgr-first-run-cta" });
    cta.onclick = () => new QuickCaptureModal(this.app, this.plugin.settings, this.currentMonth).open();

    if (this.plugin.settings.enableTransferTracker) {
      const remitCta = state.createEl("button", { text: "Log a transfer", cls: "ledgr-budget-btn ledgr-first-run-remit" });
      remitCta.onclick = () => new RemittanceModal(this.app, this.plugin).open();
    } else {
      const nwCta = state.createEl("button", { text: "Set up Net Worth", cls: "ledgr-budget-btn ledgr-first-run-remit" });
      nwCta.onclick = () => void this.plugin.openView("ledgr-networth");
    }

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
    trendData?: { pct: number; good: boolean } | null,
    subtitle?: string) {
    const card = parent.createDiv(`ledgr-card ${cls}`);
    card.createDiv({ text: label, cls: "ledgr-card-label" });
    card.createDiv({ text: value, cls: "ledgr-card-value" });
    if (trendData) {
      const { pct, good } = trendData;
      const arrow = pct > 0 ? "↑" : "↓";
      card.createDiv({
        text: `${arrow} ${Math.abs(pct)}% vs last month`,
        cls: `ledgr-card-trend ${good ? "ledgr-trend-good" : "ledgr-trend-bad"}`,
      });
    }
    if (subtitle) {
      card.createDiv({ text: subtitle, cls: "ledgr-card-subtitle" });
    }
  }

  async onClose() {
    if (this.pendingDelete) window.clearTimeout(this.pendingDelete.timer);
    this.containerEl.removeClass("ledgr-view-active");
    this.contentEl.empty();
  }
}
