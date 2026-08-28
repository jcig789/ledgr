import { ItemView, WorkspaceLeaf, Events, setIcon, Platform } from "obsidian";
import LedgrPlugin from "../main";
import { readMonthTransactions } from "../data/reader";
import { loadNetWorth } from "../data/networth";
import { resolveLiabilityDueDay } from "../data/liabilities";
import { convertToBase, toBaseOrZero } from "../data/reader";
import { formatCurrency } from "../constants/currencies";
import { EditTransactionModal } from "./EditTransactionModal";
import { LiabilityPaymentModal } from "./LiabilityPaymentModal";
import { QuickCaptureModal } from "./QuickCaptureModal";
import { Transaction } from "../data/transactions";
import { Account } from "../data/networth";
import { loadBills, RecurringBill, resolveBillDueDay, isBillPaymentLogged } from "../data/bills";
import { BillPaymentModal } from "./BillPaymentModal";

export const CALENDAR_VIEW_TYPE = "ledgr-calendar";

export class CalendarView extends ItemView {
  plugin: LedgrPlugin;
  currentMonth: string;
  private isRendering = false;
  private selectedDay: number | null = null;
  // Cached data — not re-read on day click
  private calendarTxs: Transaction[] = [];
  private liabilityAccounts: Account[] = [];
  private recurringBills: RecurringBill[] = [];

  constructor(leaf: WorkspaceLeaf, plugin: LedgrPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.currentMonth = window.moment().format("YYYY-MM");
  }

  getViewType() { return CALENDAR_VIEW_TYPE; }
  getDisplayText() { return "Calendar"; }
  getIcon() { return "calendar"; }

  async onOpen() {
    this.containerEl.addClass("ledgr-view-active");
    await this.render();
    this.registerEvent(
      (this.app.workspace as Events).on("ledgr:transaction-saved", async () => { await this.render(); })
    );
    this.registerEvent(
      (this.app.workspace as Events).on("ledgr:categories-updated", async () => { await this.render(); })
    );
    this.registerEvent(
      (this.app.workspace as Events).on("ledgr:networth-updated", async () => { await this.render(); })
    );
    this.registerEvent(
      (this.app.workspace as Events).on("ledgr:settings-changed", async () => { await this.render(); })
    );
  }

  async render() {
    if (this.isRendering) return;
    this.isRendering = true;
    try {
      const { contentEl } = this;
      contentEl.empty();
      contentEl.addClass("ledgr-calendar");

      // ── Sticky top zone ──
      const stickyZone = contentEl.createDiv("ledgr-sticky-zone");
      const tabNav = stickyZone.createDiv("ledgr-top-tabs");
      [
        { key: "dashboard",  label: "Dashboard",  viewType: "ledgr-dashboard" },
        { key: "networth",   label: "Net Worth",   viewType: "ledgr-networth" },
        { key: "statements", label: "Statements",  viewType: "ledgr-statements" },
        { key: "standing",   label: "Standing",    viewType: "ledgr-standing" },
        { key: "calendar",   label: "Calendar",    viewType: CALENDAR_VIEW_TYPE },
      ].forEach(({ key, label, viewType }) => {
        const isActive = key === "calendar";
        const btn = tabNav.createEl("button", {
          text: label,
          cls: `ledgr-top-tab${isActive ? " active" : ""}`,
        });
        if (isActive) {
          // Scroll active tab into view on mobile where 5 tabs may overflow
          window.setTimeout(() => btn.scrollIntoView({ behavior: "instant", block: "nearest", inline: "nearest" }), 150);
        } else {
          btn.onclick = () => void this.plugin.openView(viewType);
        }
      });
      const calHeader = stickyZone.createDiv("ledgr-header");
      const calControls = calHeader.createDiv("ledgr-controls-row");
      calControls.createDiv("ledgr-currency-row"); // placeholder to keep layout balanced
      const calBtnRow = calControls.createDiv("ledgr-btn-row");
      const addBtn = calBtnRow.createEl("button", { text: "+ Add", cls: "ledgr-log-btn mod-cta" });
      addBtn.onclick = () => new QuickCaptureModal(this.app, this.plugin.settings, this.currentMonth).open();

      // ── Month navigation ──
      const monthRow = contentEl.createDiv("ledgr-month-row");
      const prevBtn = monthRow.createEl("button", { text: "←" });
      prevBtn.setAttribute("aria-label", "Previous month");
      prevBtn.onclick = async () => {
        this.currentMonth = window.moment(this.currentMonth).subtract(1, "month").format("YYYY-MM");
        this.selectedDay = null;
        await this.render();
      };
      monthRow.createSpan({ text: window.moment(this.currentMonth).format("MMMM YYYY"), cls: "ledgr-month-label" });
      const nextBtn = monthRow.createEl("button", { text: "→" });
      nextBtn.setAttribute("aria-label", "Next month");
      // Allow up to 3 months forward — liabilities and bills are future-oriented
      const maxForwardMonth = window.moment().add(3, "months").format("YYYY-MM");
      const atForwardLimit = this.currentMonth >= maxForwardMonth;
      if (atForwardLimit) {
        nextBtn.setAttribute("disabled", "true");
        nextBtn.addClass("ledgr-btn-disabled");
      } else {
        nextBtn.onclick = async () => {
          this.currentMonth = window.moment(this.currentMonth).add(1, "month").format("YYYY-MM");
          this.selectedDay = null;
          await this.render();
        };
      }

      // ── Load data ──
      this.calendarTxs = await readMonthTransactions(this.app, this.plugin.settings, this.currentMonth);
      try {
        const nwData = await loadNetWorth(this.app, this.plugin.settings);
        this.liabilityAccounts = nwData.accounts.filter((a) => a.isLiability && a.liabilityDetails && !a.liabilityDetails.closedAt);
      } catch { this.liabilityAccounts = []; }
      try {
        const billStore = await loadBills(this.app, this.plugin.settings);
        this.recurringBills = billStore.bills.filter((b) => !b.closedAt);
      } catch { this.recurringBills = []; }

      // ── Build day map ──
      const dayMap = this.buildDayMap();
      const { liabilityDays, billDays } = this.buildBillDays();

      // ── Calendar layout ──
      const layout = contentEl.createDiv("ledgr-cal-layout");
      const gridWrap = layout.createDiv("ledgr-cal-grid-wrap");
      const detailPanel = layout.createDiv("ledgr-cal-detail");
      const detailInner = detailPanel.createDiv("ledgr-cal-detail-inner");

      this.renderGrid(gridWrap, dayMap, liabilityDays, billDays, detailInner);
      this.renderDetailDefault(detailInner, dayMap);
    } finally {
      this.isRendering = false;
    }
  }

  // ── Day aggregation ──────────────────────────────────────────────────────────

  buildDayMap(): Map<number, { spend: number; income: number; txs: Transaction[] }> {
    const map = new Map<number, { spend: number; income: number; txs: Transaction[] }>();
    const base = this.plugin.settings.baseCurrency;
    const rates = this.plugin.settings.exchangeRates;

    this.calendarTxs.forEach((tx) => {
      const day = parseInt(tx.date.slice(8, 10));
      if (!map.has(day)) map.set(day, { spend: 0, income: 0, txs: [] });
      const entry = map.get(day)!;
      const amt = convertToBase(tx.amount, tx.currency, base, rates) ?? 0;
      if (tx.type === "expense") entry.spend += amt;
      else entry.income += amt;
      entry.txs.push(tx);
    });
    return map;
  }

  buildBillDays(): { liabilityDays: Set<number>; billDays: Set<number> } {
    const liabilityDays = new Set<number>();
    const billDays = new Set<number>();

    this.liabilityAccounts.forEach((acc) => {
      if (!acc.liabilityDetails) return;
      const dueDay = resolveLiabilityDueDay(acc, this.currentMonth);
      if (dueDay !== null) liabilityDays.add(dueDay);
    });

    this.recurringBills.forEach((bill) => {
      const dueDay = resolveBillDueDay(bill, this.currentMonth);
      if (dueDay !== null) billDays.add(dueDay);
    });

    return { liabilityDays, billDays };
  }

  // ── Grid rendering ───────────────────────────────────────────────────────────

  renderGrid(
    parent: HTMLElement,
    dayMap: Map<number, { spend: number; income: number; txs: Transaction[] }>,
    liabilityDays: Set<number>,
    billDays: Set<number>,
    detailEl: HTMLElement
  ) {
    const fmt = (n: number) => formatCurrency(n, this.plugin.settings.baseCurrency);
    const weekStart = this.plugin.settings.calendarWeekStart ?? "monday";
    const dayNames = weekStart === "monday"
      ? ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]
      : ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

    // Weekday header
    const weekdayRow = parent.createDiv("ledgr-cal-weekdays");
    dayNames.forEach((d) => weekdayRow.createSpan({ text: d, cls: "ledgr-cal-weekday" }));

    // Grid
    const grid = parent.createDiv("ledgr-cal-grid");

    const firstOfMonth = window.moment(`${this.currentMonth}-01`);
    const daysInMonth = firstOfMonth.daysInMonth();
    const today = window.moment();
    const todayDay = today.format("YYYY-MM") === this.currentMonth ? today.date() : -1;

    // Offset: how many blank cells before day 1
    const isoWeekday = firstOfMonth.isoWeekday(); // 1=Mon, 7=Sun
    const offset = weekStart === "monday"
      ? (isoWeekday - 1 + 7) % 7
      : firstOfMonth.day(); // 0=Sun

    // Blank leading cells
    for (let i = 0; i < offset; i++) {
      grid.createDiv("ledgr-cal-cell ledgr-cal-cell--other-month");
    }

    // Day cells
    for (let d = 1; d <= daysInMonth; d++) {
      const entry = dayMap.get(d);
      const isLiability = liabilityDays.has(d);
      const isBill = billDays.has(d);
      const isToday = d === todayDay;
      const isSelected = d === this.selectedDay;
      const isFuture = d > todayDay && todayDay !== -1;

      let cls = "ledgr-cal-cell";
      if (isToday) cls += " ledgr-cal-cell--today";
      if (isSelected) cls += " ledgr-cal-cell--selected";
      if (isLiability || isBill) cls += " ledgr-cal-cell--bill";
      if (isFuture) cls += " ledgr-cal-cell--future";

      const cell = grid.createDiv(cls);
      cell.createSpan({ text: String(d), cls: "ledgr-cal-day-num" });

      if (entry) {
        if (entry.spend > 0) {
          cell.createDiv({ text: fmt(entry.spend), cls: "ledgr-cal-cell-spend" });
        }
        if (entry.income > 0) {
          cell.createDiv({ text: `+${fmt(entry.income)}`, cls: "ledgr-cal-cell-income" });
        }
      }
      // ★ for formal debt payments, ○ for recurring bills
      if (isLiability) cell.createSpan({ text: "★", cls: "ledgr-cal-bill-marker" });
      if (isBill) cell.createSpan({ text: "○", cls: "ledgr-cal-bill-marker ledgr-cal-bill-marker--recurring" });

      cell.onclick = () => {
        parent.querySelectorAll(".ledgr-cal-cell--selected").forEach((el) => el.removeClass("ledgr-cal-cell--selected"));
        cell.addClass("ledgr-cal-cell--selected");
        this.selectedDay = d;
        this.renderDetailDay(detailEl, d, entry ?? null);
        // Scroll detail panel into view on mobile only — on desktop it's already visible alongside the grid
        if (Platform.isMobile) {
          window.setTimeout(() => {
            detailEl.closest(".ledgr-cal-detail")?.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 50);
        }
      };
    }

    // Legend
    const legend = parent.createDiv("ledgr-cal-legend");
    if (this.liabilityAccounts.length > 0) legend.createSpan({ text: "★ debt payment", cls: "ledgr-cal-legend-item" });
    if (this.recurringBills.length > 0) legend.createSpan({ text: "○ recurring bill", cls: "ledgr-cal-legend-item" });
  }

  // ── Detail panel — no selection ──────────────────────────────────────────────

  renderDetailDefault(detailEl: HTMLElement, dayMap: Map<number, { spend: number; income: number; txs: Transaction[] }>) {
    detailEl.empty();
    const fmt = (n: number) => formatCurrency(n, this.plugin.settings.baseCurrency);

    detailEl.createDiv({ text: window.moment(this.currentMonth).format("MMMM YYYY").toUpperCase(), cls: "ledgr-cal-detail-month" });
    detailEl.createDiv("ledgr-bearing-rule-thin");

    // Month summary
    let totalSpend = 0, totalIncome = 0;
    dayMap.forEach((v) => { totalSpend += v.spend; totalIncome += v.income; });
    const summary = detailEl.createDiv("ledgr-cal-detail-summary");

    const addSummaryRow = (label: string, value: string, cls = "") => {
      const row = summary.createDiv("ledgr-cal-detail-summary-row");
      row.createSpan({ text: label, cls: "ledgr-meta" });
      row.createSpan({ text: value, cls: `ledgr-cal-detail-summary-val ${cls}` });
    };
    if (totalIncome > 0) addSummaryRow("Income", `+${fmt(totalIncome)}`, "ledgr-positive");
    if (totalSpend > 0) addSummaryRow("Spend", fmt(totalSpend), "ledgr-expense");
    const totalDue = this.liabilityAccounts.length + this.recurringBills.length;
    if (totalDue > 0) addSummaryRow("Bills due", String(totalDue));

    detailEl.createDiv("ledgr-bearing-rule-thin");
    detailEl.createEl("p", { text: "Select a day to see transactions.", cls: "ledgr-cal-detail-empty" });
  }

  // ── Detail panel — day selected ──────────────────────────────────────────────

  renderDetailDay(detailEl: HTMLElement, day: number, entry: { spend: number; income: number; txs: Transaction[] } | null) {
    detailEl.empty();
    const fmt = (n: number, cur: string) => formatCurrency(n, cur);
    const isoDate = `${this.currentMonth}-${String(day).padStart(2, "0")}`;
    const dateStr = window.moment(isoDate).format("dddd, D MMMM").toUpperCase();

    // Date heading + Add button on same row
    const dateRow = detailEl.createDiv("ledgr-cal-detail-date-row");
    dateRow.createDiv({ text: dateStr, cls: "ledgr-cal-detail-date" });
    const addDayBtn = dateRow.createEl("button", { text: "+ Add", cls: "ledgr-budget-btn ledgr-cal-add-btn" });
    addDayBtn.onclick = () => new QuickCaptureModal(
      this.app, this.plugin.settings, this.currentMonth, { date: isoDate }
    ).open();

    detailEl.createDiv("ledgr-bearing-rule-thin");

    // Debt payments due on this day (★)
    const liabilitiesOnDay = this.liabilityAccounts.filter((acc) => {
      if (!acc.liabilityDetails) return false;
      return resolveLiabilityDueDay(acc, this.currentMonth) === day;
    });

    if (liabilitiesOnDay.length > 0) {
      detailEl.createDiv({ text: "DEBT PAYMENTS", cls: "ledgr-cal-detail-bills-header" });
      liabilitiesOnDay.forEach((acc) => {
        const row = detailEl.createDiv("ledgr-cal-detail-bill-row");
        row.createSpan({ text: acc.name, cls: "ledgr-cal-detail-bill-name" });
        const ld = acc.liabilityDetails!;
        const isVariable = ld.amountType === "variable";
        if (!isVariable && ld.monthlyPayment > 0) {
          row.createSpan({
            text: formatCurrency(ld.monthlyPayment, acc.currency),
            cls: "ledgr-cal-detail-bill-amount",
          });
        } else if (isVariable) {
          row.createSpan({ text: "Varies", cls: "ledgr-cal-detail-bill-amount ledgr-meta" });
        }
        const payBtn = row.createEl("button", { text: isVariable ? "Log →" : "Pay", cls: "ledgr-cal-pay-btn ledgr-budget-btn" });
        payBtn.onclick = () => new LiabilityPaymentModal(
          this.app, this.plugin, acc, () => { void this.render(); }
        ).open();
      });
    }

    // Recurring bills due on this day (○)
    const recurringOnDay = this.recurringBills.filter((bill) => {
      return resolveBillDueDay(bill, this.currentMonth) === day;
    });

    if (recurringOnDay.length > 0) {
      if (liabilitiesOnDay.length > 0) detailEl.createDiv("ledgr-bearing-rule-thin");
      detailEl.createDiv({ text: "BILLS DUE", cls: "ledgr-cal-detail-bills-header" });
      const month = window.moment(this.currentMonth).format("YYYY-MM");
      recurringOnDay.forEach((bill) => {
        const row = detailEl.createDiv("ledgr-cal-detail-bill-row");
        row.createSpan({ text: bill.name, cls: "ledgr-cal-detail-bill-name" });
        const isPaid = isBillPaymentLogged(bill, month);
        if (isPaid) {
          if (bill.amount > 0) {
            const amtText = bill.amountMax ? `${formatCurrency(bill.amount, bill.currency)}–${formatCurrency(bill.amountMax, bill.currency)}` : formatCurrency(bill.amount, bill.currency);
            row.createSpan({ text: amtText, cls: "ledgr-cal-detail-bill-amount ledgr-meta" });
          }
          row.createSpan({ text: "PAID", cls: "ledgr-cal-detail-bill-amount ledgr-meta" });
        } else if (bill.amountType === "variable") {
          row.createSpan({ text: "Varies", cls: "ledgr-cal-detail-bill-amount ledgr-meta" });
          const logBtn = row.createEl("button", { text: "Log →", cls: "ledgr-cal-pay-btn ledgr-budget-btn" });
          logBtn.onclick = () => new BillPaymentModal(
            this.app, this.plugin, bill, () => { void this.render(); }
          ).open();
        } else {
          if (bill.amount > 0) {
            const amtText = bill.amountMax ? `${formatCurrency(bill.amount, bill.currency)}–${formatCurrency(bill.amountMax, bill.currency)}` : formatCurrency(bill.amount, bill.currency);
            row.createSpan({ text: amtText, cls: "ledgr-cal-detail-bill-amount" });
          }
          const logBtn = row.createEl("button", { text: "Log →", cls: "ledgr-cal-pay-btn ledgr-budget-btn" });
          logBtn.onclick = () => new BillPaymentModal(
            this.app, this.plugin, bill, () => { void this.render(); }
          ).open();
        }
      });
    }

    if (liabilitiesOnDay.length > 0 || recurringOnDay.length > 0) {
      detailEl.createDiv("ledgr-bearing-rule-thin");
    }

    // Transactions
    if (!entry || entry.txs.length === 0) {
      detailEl.createEl("p", { text: "No transactions this day.", cls: "ledgr-cal-detail-no-tx" });
      return;
    }

    const expenses = entry.txs.filter((t) => t.type === "expense");
    const income = entry.txs.filter((t) => t.type === "income");

    const renderTxGroup = (txs: Transaction[], label: string) => {
      if (txs.length === 0) return;
      const section = detailEl.createDiv("ledgr-cal-detail-tx-section");
      // Group by category
      const byCategory: Record<string, Transaction[]> = {};
      txs.forEach((tx) => {
        if (!byCategory[tx.category]) byCategory[tx.category] = [];
        byCategory[tx.category].push(tx);
      });
      Object.entries(byCategory).forEach(([cat, catTxs]) => {
        section.createDiv({ text: cat, cls: "ledgr-cal-detail-tx-cat" });
        catTxs.forEach((tx, idx) => {
          const row = section.createDiv("ledgr-cal-detail-tx-row");
          row.createSpan({ text: tx.note || tx.subcategory, cls: "ledgr-cal-detail-tx-note" });
          row.createSpan({
            text: formatCurrency(tx.amount, tx.currency),
            cls: `ledgr-cal-detail-tx-amount ${tx.type === "income" ? "ledgr-income" : "ledgr-expense"}`,
          });
          // Edit button — use setIcon (Obsidian API, no raw unicode)
          const editBtn = row.createEl("button", { cls: "ledgr-edit-btn" });
          setIcon(editBtn, "pencil");
          editBtn.setAttribute("aria-label", "Edit");
          editBtn.onclick = () => {
            const allTxs = [...expenses, ...income];
            const globalIdx = this.calendarTxs.findIndex((t) =>
              t.date === tx.date && t.amount === tx.amount && t.category === tx.category && t.note === tx.note
            );
            if (globalIdx >= 0) {
              new EditTransactionModal(
                this.app, this.plugin, tx, this.currentMonth, globalIdx, () => { void this.render(); }
              ).open();
            }
          };
        });
      });
    };

    renderTxGroup(expenses, "Expenses");
    if (income.length > 0 && expenses.length > 0) detailEl.createDiv("ledgr-bearing-rule-thin");
    renderTxGroup(income, "Income");

    // Day total — only render when there are expense transactions to sum
    if (entry.spend > 0) {
      detailEl.createDiv("ledgr-bearing-rule-thin");
      const totalRow = detailEl.createDiv("ledgr-cal-detail-total");
      totalRow.createSpan({ text: "Total spend", cls: "ledgr-meta" });
      totalRow.createSpan({
        text: formatCurrency(entry.spend, this.plugin.settings.baseCurrency),
        cls: "ledgr-cal-detail-total-amount ledgr-expense",
      });
    }
  }

  async onClose() {
    this.containerEl.removeClass("ledgr-view-active");
    this.contentEl.empty();
  }
}
