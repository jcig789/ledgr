import { ItemView, WorkspaceLeaf, Notice, Events, setIcon } from "obsidian";
import LedgrPlugin from "../main";
import { loadNetWorth, saveNetWorth, NetWorthData, AccountType } from "../data/networth";
import { convertToBase } from "../data/reader";
import { Currency } from "../settings";
import { renderDonutChart, categoryColor, renderNwHistoryChart } from "./charts";
import { loadNwHistory } from "../data/nwHistory";
import { formatCurrency } from "../constants/currencies";
import { loadGoals, saveGoals, GoalStore } from "../data/goals";
import { GoalModal } from "./GoalModal";
import { readMonthTransactions, summarize, convertToBase as cvt } from "../data/reader";
import { LIABILITY_TYPES } from "../data/liabilities";
import { LiabilityPaymentModal } from "./LiabilityPaymentModal";
import { DebtCostModal } from "./DebtCostModal";
import { recordNwSnapshot } from "../data/nwHistory";

export const NETWORTH_VIEW_TYPE = "ledgr-networth";

export class NetWorthView extends ItemView {
  plugin: LedgrPlugin;
  data: NetWorthData = { accounts: [], brokerages: [], updatedAt: "" };
  goalsStore: GoalStore = { goals: [] };
  viewCurrency: Currency;
  editMode = false;
  isDirty = false;

  constructor(leaf: WorkspaceLeaf, plugin: LedgrPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.viewCurrency = plugin.settings.baseCurrency;
  }

  getViewType() { return NETWORTH_VIEW_TYPE; }
  getDisplayText() { return "Net Worth"; }
  getIcon() { return "trending-up"; }

  async onOpen() {
    this.containerEl.addClass("ledgr-view-active");
    this.data = await loadNetWorth(this.app, this.plugin.settings);
    this.goalsStore = await loadGoals(this.app, this.plugin.settings);
    // Auto-snapshot on open — records once per month passively so history builds
    // without requiring the user to click Save. Only writes if month not yet recorded.
    void this.autoSnapshot();
    void this.render();
    this.registerEvent(
      (this.app.workspace as Events).on("ledgr:settings-changed", () => {
        void this.render();
      })
    );
    this.registerEvent(
      (this.app.workspace as Events).on("ledgr:networth-updated", async () => {
        this.data = await loadNetWorth(this.app, this.plugin.settings);
        void this.render();
      })
    );
    this.registerEvent(
      (this.app.workspace as Events).on("ledgr:focus-section", (payload: { viewType: string; anchor: string }) => {
        if (payload.viewType !== NETWORTH_VIEW_TYPE) return;
        const el = this.contentEl.querySelector(`[data-anchor="${payload.anchor}"]`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "start" });
          el.addClass("ledgr-section-highlight");
          window.setTimeout(() => (el as HTMLElement).removeClass("ledgr-section-highlight"), 2000);
        }
      })
    );
  }

  async autoSnapshot() {
    try {
      const history = await loadNwHistory(this.app, this.plugin.settings);
      const currentMonth = window.moment().format("YYYY-MM");
      // Skip if already recorded this month
      if (history.snapshots[currentMonth] !== undefined) return;
      const base = this.plugin.settings.baseCurrency;
      const rates = this.plugin.settings.exchangeRates;
      const snapAssets = [
        ...this.data.accounts.filter((a) => !a.isLiability).map((a) => convertToBase(a.balance, a.currency, base, rates)),
        ...this.data.brokerages.map((b) => convertToBase(b.value, b.currency, base, rates)),
      ].reduce((s, v) => s + v, 0);
      const snapLiabilities = this.data.accounts
        .filter((a) => a.isLiability)
        .reduce((s, a) => s + convertToBase(a.balance, a.currency, base, rates), 0);
      await recordNwSnapshot(this.app, this.plugin.settings, snapAssets - snapLiabilities);
    } catch { /* silent — snapshot is best-effort */ }
  }

  toBase(amount: number, currency: string) {
    return convertToBase(amount, currency, this.viewCurrency, this.plugin.settings.exchangeRates);
  }

  // Helper: create input with type set at creation time (Obsidian checker compliance)
  mkInput(parent: HTMLElement, type: string, cls = "ledgr-inline-input"): HTMLInputElement {
    return parent.createEl("input", { attr: { type, class: cls } });
  }

  fmt(n: number) {
    return formatCurrency(n, this.viewCurrency);
  }

  async render() {
    // Validate viewCurrency against current settings — reset if no longer valid
    const validCurrencies = [this.plugin.settings.baseCurrency, ...this.plugin.settings.secondaryCurrencies];
    if (!validCurrencies.includes(this.viewCurrency)) {
      this.viewCurrency = this.plugin.settings.baseCurrency;
    }

    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ledgr-networth");

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
      const isActive = key === "networth";
      const btn = tabNav.createEl("button", {
        text: label,
        cls: `ledgr-top-tab${isActive ? " active" : ""}`,
      });
      if (!isActive) btn.onclick = () => void this.plugin.openView(viewType);
    });

    // ── Controls bar ──
    const header = stickyZone.createDiv("ledgr-header");

    // Single row: currencies left, actions right
    const controlRow = header.createDiv("ledgr-controls-row");

    const allCurrencies = [this.plugin.settings.baseCurrency, ...this.plugin.settings.secondaryCurrencies];
    const currencyRow = controlRow.createDiv("ledgr-currency-row");
    allCurrencies.forEach((c) => {
      const btn = currencyRow.createEl("button", {
        text: c,
        cls: `ledgr-currency-btn ${c === this.viewCurrency ? "active" : ""}`,
      });
      btn.setAttribute("aria-label", `View in ${c}`);
      btn.onclick = () => { this.viewCurrency = c; void this.render(); };
    });

    const btnRow = controlRow.createDiv("ledgr-btn-row");
    const editBtn = btnRow.createEl("button", {
      text: this.editMode ? "Save" : "Edit",
      cls: this.editMode ? "ledgr-log-btn mod-cta" : "ledgr-budget-btn",
    });
    editBtn.onclick = async () => {
      if (this.editMode) {
        this.data.updatedAt = new Date().toISOString();
        await saveNetWorth(this.app, this.plugin.settings, this.data);
        this.isDirty = false;
        new Notice("Net worth saved");
        // Snapshot net worth in BASE currency (not viewCurrency) for Momentum pillar accuracy
        const base = this.plugin.settings.baseCurrency;
        const rates = this.plugin.settings.exchangeRates;
        const snapAssets = [
          ...this.data.accounts.filter((a) => !a.isLiability).map((a) => convertToBase(a.balance, a.currency, base, rates)),
          ...this.data.brokerages.map((b) => convertToBase(b.value, b.currency, base, rates)),
        ].reduce((s, v) => s + v, 0);
        const snapLiabilities = this.data.accounts
          .filter((a) => a.isLiability)
          .reduce((s, a) => s + convertToBase(a.balance, a.currency, base, rates), 0);
        void recordNwSnapshot(this.app, this.plugin.settings, snapAssets - snapLiabilities);
      }
      this.editMode = !this.editMode;
      void this.render();
    };

    if (this.editMode) {
      const cancelBtn = btnRow.createEl("button", { text: "Cancel", cls: "ledgr-budget-btn" });
      cancelBtn.onclick = async () => {
        this.data = await loadNetWorth(this.app, this.plugin.settings);
        this.editMode = false;
        this.isDirty = false;
        void this.render();
      };
    }

    // Totals
    const bankAssets = this.data.accounts
      .filter((a) => !a.isLiability)
      .reduce((sum, a) => sum + this.toBase(a.balance, a.currency), 0);
    const investAssets = this.data.brokerages
      .reduce((sum, b) => sum + this.toBase(b.value, b.currency), 0);
    const liabilities = this.data.accounts
      .filter((a) => a.isLiability)
      .reduce((sum, a) => sum + this.toBase(a.balance, a.currency), 0);
    const totalAssets = bankAssets + investAssets;
    const netWorth = totalAssets - liabilities;

    // ── Net Worth History Chart ──
    if (!this.editMode) {
      const historyData = await loadNwHistory(this.app, this.plugin.settings);
      const snapshots = Object.entries(historyData.snapshots).map(([month, value]) => ({ month, value }));
      const currentMonth = window.moment().format("YYYY-MM");
      const chartWrap = contentEl.createDiv("ledgr-nw-history-wrap");
      renderNwHistoryChart(
        chartWrap,
        snapshots,
        netWorth,
        currentMonth,
        this.plugin.settings.baseCurrency,
        this.plugin.settings.nwChartRange,
        (r) => {
          this.plugin.settings.nwChartRange = r;
          void this.plugin.saveSettings().then(() => this.render());
        }
      );
    }

    const cards = contentEl.createDiv("ledgr-cards");
    this.createCard(cards, "Total Assets", this.fmt(totalAssets), "ledgr-income");
    this.createCard(cards, "Liabilities", this.fmt(liabilities), "ledgr-expense");
    this.createCard(cards, "Net Worth", this.fmt(netWorth), netWorth >= 0 ? "ledgr-positive" : "ledgr-negative");

    // Visuals — only when there's data
    if (totalAssets > 0 || liabilities > 0) {
      this.renderNetWorthVisuals(contentEl, bankAssets, investAssets, liabilities, totalAssets);
    }

    this.renderAccountGroup(contentEl, "Primary Accounts", "JP");
    this.renderAccountGroup(contentEl, "Secondary Accounts", "PH");
    this.renderBrokerages(contentEl);
    this.renderPropertyEquity(contentEl);
    this.renderLiabilities(contentEl);

    if (this.editMode) {
      this.renderAddButtons(contentEl);
    }

    // Goals section — always visible
    await this.renderGoals(contentEl);

    if (this.data.updatedAt) {
      contentEl.createEl("p", {
        text: `Last updated: ${new Date(this.data.updatedAt).toLocaleDateString()}`,
        cls: "ledgr-empty",
      });
    }
  }

  renderNetWorthVisuals(parent: HTMLElement, bankAssets: number, investAssets: number, liabilities: number, totalAssets: number) {
    const section = parent.createDiv("ledgr-nw-visuals");

    // ── Allocation donut ──────────────────────────────────────────────
    const donutWrap = section.createDiv("ledgr-nw-donut-wrap");

    const segments: import("./charts").ChartSegment[] = [];
    if (bankAssets > 0) segments.push({
      label: "Bank & Cash",
      value: bankAssets,
      color: "var(--ledgr-seg-bank, var(--ledgr-cat-3))",
      displayValue: this.fmt(bankAssets),
    });
    if (investAssets > 0) segments.push({
      label: "Investments",
      value: investAssets,
      color: "var(--ledgr-seg-invest, var(--ledgr-cat-9))",
      displayValue: this.fmt(investAssets),
    });
    if (liabilities > 0) segments.push({
      label: "Liabilities",
      value: liabilities,
      color: "var(--ledgr-red)",
      displayValue: this.fmt(liabilities),
    });

    if (segments.length > 0) {
      renderDonutChart(donutWrap, segments, "allocation", this.fmt(totalAssets));
    }

    // ── Account balance bars ─────────────────────────────────────────
    type BarEntry = { id: string; name: string; currency: string; balance: number; type: string; isBrokerage: boolean };
    const allAccounts: BarEntry[] = [
      ...this.data.accounts.filter((a) => !a.isLiability).map((a) => ({ ...a, isBrokerage: false })),
      ...this.data.brokerages.map((b) => ({
        id: b.id, name: b.name, currency: b.currency,
        balance: b.value, type: "investment", isBrokerage: true,
      })),
    ];

    if (allAccounts.length === 0) return;

    const barsWrap = section.createDiv("ledgr-nw-bars");
    const maxBalance = Math.max(...allAccounts.map((a) =>
      this.toBase(a.balance, a.currency)
    ));

    allAccounts.forEach((a, idx) => {
      const balance = this.toBase(a.balance, a.currency);
      const pct = maxBalance > 0 ? (balance / maxBalance) * 100 : 0;
      const color = categoryColor(a.type === "investment" || a.isBrokerage ? "Transport" : "Housing", idx);

      const row = barsWrap.createDiv("ledgr-nw-bar-row");
      row.createSpan({ text: a.name, cls: "ledgr-nw-bar-label" });
      const barWrap = row.createDiv("ledgr-nw-bar-track");
      const bar = barWrap.createDiv("ledgr-nw-bar-fill");
      bar.setCssStyles({ backgroundColor: color });
      bar.setCssStyles({ width: "0%" });
      window.requestAnimationFrame(() => { bar.setCssStyles({ width: `${Math.round(pct)}%` }); });
      row.createSpan({ text: this.fmt(balance), cls: "ledgr-nw-bar-amt" });
    });
  }

  renderAccountGroup(parent: HTMLElement, title: string, country: "JP" | "PH") {
    const accounts = this.data.accounts.filter((a) => a.country === country && !a.isLiability);
    if (accounts.length === 0 && !this.editMode) return;

    const section = parent.createDiv("ledgr-section");
    section.createEl("h3", { text: title });

    if (accounts.length === 0) {
      const emptyWrap = section.createDiv("ledgr-empty-cta-wrap");
      emptyWrap.createEl("p", { text: `No ${title.toLowerCase()} yet.`, cls: "ledgr-empty" });
      const addBtn = emptyWrap.createEl("button", { text: "+ Add account", cls: "ledgr-budget-btn" });
      addBtn.onclick = () => { this.editMode = true; void this.render(); };
      return;
    }

    if (this.editMode) {
      // Card layout in edit mode — works on all screen widths
      accounts.forEach((acc) => {
        const card = section.createDiv("ledgr-edit-card");
        const row1 = card.createDiv("ledgr-edit-card-row");
        const nameInput = this.mkInput(row1, "text", "ledgr-inline-input ledgr-edit-card-name");
        nameInput.value = acc.name;
        nameInput.placeholder = "Account name";
        nameInput.oninput = (e) => { this.isDirty = true; acc.name = (e.target as HTMLInputElement).value; };

        const row2 = card.createDiv("ledgr-edit-card-row");
        row2.createSpan({ text: `${acc.type} · ${acc.currency}`, cls: "ledgr-meta" });
        const balInput = this.mkInput(row2, "number", "ledgr-inline-input ledgr-edit-card-balance");
        balInput.value = String(acc.balance);
        balInput.placeholder = "Balance";
        balInput.oninput = (e) => { this.isDirty = true; acc.balance = parseFloat((e.target as HTMLInputElement).value) || 0; };

        const removeBtn = card.createEl("button", { text: "Remove", cls: "ledgr-remove-btn" });
        removeBtn.onclick = () => {
          // Clear any back-reference on linked liability before removing asset
          if (acc.linkedLiabilityId) {
            const linked = this.data.accounts.find((a) => a.id === acc.linkedLiabilityId);
            if (linked) linked.linkedAssetId = undefined;
          }
          this.data.accounts = this.data.accounts.filter((a) => a.id !== acc.id);
          void this.render();
        };
      });
    } else {
      const table = section.createEl("table", { cls: "ledgr-tx-table" });
      const thead = table.createEl("thead");
      const hrow = thead.createEl("tr");
      ["Account", "Type", "Balance"].forEach((h) => hrow.createEl("th", { text: h }));
      const tbody = table.createEl("tbody");
      accounts.forEach((acc) => {
        const tr = tbody.createEl("tr");
        tr.createEl("td", { text: acc.name });
        tr.createEl("td", { text: acc.type, cls: "ledgr-empty" });
        tr.createEl("td", { text: this.fmt(this.toBase(acc.balance, acc.currency)), cls: "ledgr-text-right" });
      });
    }
  }

  renderBrokerages(parent: HTMLElement) {
    const section = parent.createDiv("ledgr-section");
    section.createEl("h3", { text: "Investment Accounts" });

    if (this.data.brokerages.length === 0 && !this.editMode) {
      section.createEl("p", { text: "No investment accounts. Click Edit to add.", cls: "ledgr-empty" });
      return;
    }

    if (this.editMode) {
      this.data.brokerages.forEach((b) => {
        const card = section.createDiv("ledgr-edit-card");
        const row1 = card.createDiv("ledgr-edit-card-row");
        const nameInput = row1.createEl("input");
        nameInput.setAttribute("type", "text"); nameInput.value = b.name;
        nameInput.className = "ledgr-inline-input ledgr-edit-card-name";
        nameInput.placeholder = "Account name";
        nameInput.oninput = (e) => { this.isDirty = true; b.name = (e.target as HTMLInputElement).value; };

        const row2 = card.createDiv("ledgr-edit-card-row");
        row2.createSpan({ text: `investment · ${b.currency}`, cls: "ledgr-meta" });
        const valInput = row2.createEl("input");
        valInput.setAttribute("type", "number"); valInput.value = String(b.value);
        valInput.className = "ledgr-inline-input ledgr-edit-card-balance";
        valInput.placeholder = "Value";
        valInput.oninput = (e) => { this.isDirty = true; b.value = parseFloat((e.target as HTMLInputElement).value) || 0; };

        const removeBtn = card.createEl("button", { text: "Remove", cls: "ledgr-remove-btn" });
        removeBtn.onclick = () => {
          this.data.brokerages = this.data.brokerages.filter((bb) => bb !== b);
          void this.render();
        };
      });
    } else {
      const table = section.createEl("table", { cls: "ledgr-tx-table" });
      const thead = table.createEl("thead");
      const hrow = thead.createEl("tr");
      ["Investment Account", "Total Value"].forEach((h) => hrow.createEl("th", { text: h }));
      const tbody = table.createEl("tbody");
      this.data.brokerages.forEach((b) => {
        const tr = tbody.createEl("tr");
        tr.createEl("td", { text: b.name });
        tr.createEl("td", { text: this.fmt(this.toBase(b.value, b.currency)), cls: "ledgr-text-right" });
      });
    }
  }

  renderPropertyEquity(parent: HTMLElement) {
    // Find linked asset+liability pairs
    const pairs: { asset: import("../data/networth").Account; mortgage: import("../data/networth").Account }[] = [];
    this.data.accounts.forEach((acc) => {
      if (!acc.isLiability && acc.linkedLiabilityId) {
        const mortgage = this.data.accounts.find((a) => a.id === acc.linkedLiabilityId && a.isLiability);
        if (mortgage) pairs.push({ asset: acc, mortgage });
      }
    });
    if (pairs.length === 0) return;

    const section = parent.createDiv("ledgr-section");
    section.createDiv("ledgr-section-header").createEl("h3", { text: "Property" });

    pairs.forEach(({ asset, mortgage }) => {
      const propertyValue = this.toBase(asset.balance, asset.currency);
      const mortgageBalance = this.toBase(mortgage.balance, mortgage.currency);
      const equity = propertyValue - mortgageBalance;
      const equityPct = propertyValue > 0 ? (equity / propertyValue) * 100 : 0;
      const ltv = propertyValue > 0 ? (mortgageBalance / propertyValue) * 100 : 0;
      const originalAmount = mortgage.liabilityDetails?.originalAmount ?? 0;
      const principalPaid = originalAmount > 0 ? originalAmount - mortgageBalance : 0;

      const card = section.createDiv("ledgr-nw-property-card");
      card.createDiv({ text: asset.name, cls: "ledgr-nw-property-name" });
      card.createDiv("ledgr-bearing-rule-thin");

      const tbl = card.createEl("table", { cls: "ledgr-tx-table" });
      const tbody = tbl.createEl("tbody");
      const row = (label: string, value: string, cls = "") => {
        const tr = tbody.createEl("tr");
        tr.createEl("td", { text: label, cls: "ledgr-meta" });
        tr.createEl("td", { text: value, cls: `ledgr-text-right ${cls}` });
      };
      row("Property value", this.fmt(propertyValue));
      row("Mortgage balance", this.fmt(mortgageBalance), "ledgr-expense");
      card.createDiv("ledgr-bearing-rule-thin");
      row("Equity", `${this.fmt(equity)}  ${equityPct.toFixed(1)}%`, equity >= 0 ? "ledgr-positive" : "ledgr-negative");
      row("LTV ratio", `${ltv.toFixed(1)}%`);
      if (principalPaid > 0) row("Principal paid", `${this.fmt(principalPaid)}  ${originalAmount > 0 ? ((principalPaid / originalAmount) * 100).toFixed(1) : 0}% of loan`);
    });
  }

  renderLiabilities(parent: HTMLElement) {
    const allLiabilities = this.data.accounts.filter((a) => a.isLiability);

    const liabilities = allLiabilities.filter((a) => !a.liabilityDetails?.closedAt);
    const closedLiabilities = allLiabilities.filter((a) => a.liabilityDetails?.closedAt);

    if (allLiabilities.length === 0 && !this.editMode) return;

    const section = parent.createDiv("ledgr-section");
    section.setAttribute("data-anchor", "liabilities");
    const hdr = section.createDiv("ledgr-section-header");
    hdr.createEl("h3", { text: "Liabilities" });
    if (closedLiabilities.length > 0 && !this.editMode) {
      let showClosed = false;
      const toggleLink = hdr.createEl("a", {
        text: `Show closed (${closedLiabilities.length})`,
        cls: "ledgr-bearing-guidance-link",
      });
      toggleLink.onclick = () => {
        showClosed = !showClosed;
        closedSection.toggleClass("ledgr-hidden", !showClosed);
        toggleLink.textContent = showClosed
          ? `Hide closed (${closedLiabilities.length})`
          : `Show closed (${closedLiabilities.length})`;
      };
    }

    if (allLiabilities.length === 0) {
      const emptyWrap = section.createDiv("ledgr-empty-cta-wrap");
      emptyWrap.createEl("p", { text: "No liabilities tracked.", cls: "ledgr-empty" });
      emptyWrap.createEl("p", { text: "Accurate liability data is required for the Ballast pillar.", cls: "ledgr-empty" });
      const addBtn = emptyWrap.createEl("button", { text: "+ Add Liability", cls: "ledgr-budget-btn" });
      addBtn.onclick = () => { this.editMode = true; void this.render(); };
      return;
    }

    // Closed liabilities section (hidden by default)
    const closedSection = section.createDiv("ledgr-hidden");

    // Render closed liabilities inside the hidden section
    if (closedLiabilities.length > 0) {
      const closedTable = closedSection.createEl("table", { cls: "ledgr-tx-table" });
      const chrow = closedTable.createEl("thead").createEl("tr");
      ["Name", "Type", "Archived"].forEach((h) => chrow.createEl("th", { text: h }));
      const ctbody = closedTable.createEl("tbody");
      closedLiabilities.forEach((acc) => {
        const tr = ctbody.createEl("tr", { cls: "ledgr-liability-closed" });
        tr.createEl("td", { text: acc.name, cls: "ledgr-liability-closed-name" });
        tr.createEl("td", { text: acc.type, cls: "ledgr-empty" });
        tr.createEl("td", { text: acc.liabilityDetails?.closedAt ?? "—", cls: "ledgr-empty" });
      });
    }

    if (this.editMode) {
      allLiabilities.forEach((acc) => {
        const card = section.createDiv("ledgr-edit-card");
        const row1 = card.createDiv("ledgr-edit-card-row");
        const nameInput = row1.createEl("input");
        nameInput.setAttribute("type", "text"); nameInput.value = acc.name;
        nameInput.className = "ledgr-inline-input ledgr-edit-card-name";
        nameInput.placeholder = "Name";
        nameInput.oninput = (e) => { this.isDirty = true; acc.name = (e.target as HTMLInputElement).value; };

        const row2 = card.createDiv("ledgr-edit-card-row");
        row2.createSpan({ text: `${acc.type} · ${acc.currency}`, cls: "ledgr-meta" });
        const balInput = row2.createEl("input");
        balInput.setAttribute("type", "number"); balInput.value = String(acc.balance);
        balInput.className = "ledgr-inline-input ledgr-edit-card-balance";
        balInput.placeholder = "Balance";
        balInput.oninput = (e) => { this.isDirty = true; acc.balance = parseFloat((e.target as HTMLInputElement).value) || 0; };

        if (acc.liabilityDetails) {
          const ld = acc.liabilityDetails;

          const row3 = card.createDiv("ledgr-edit-card-row");
          row3.createSpan({ text: "Monthly", cls: "ledgr-meta" });
          const monthlyInput = row3.createEl("input");
          monthlyInput.setAttribute("type", "number"); monthlyInput.value = String(ld.monthlyPayment);
          monthlyInput.className = "ledgr-inline-input";
          monthlyInput.placeholder = "0";
          monthlyInput.oninput = (e) => { this.isDirty = true; ld.monthlyPayment = parseFloat((e.target as HTMLInputElement).value) || 0; };

          const row4 = card.createDiv("ledgr-edit-card-row");
          row4.createSpan({ text: "Due day", cls: "ledgr-meta" });
          const dueDayInput = row4.createEl("input");
          dueDayInput.setAttribute("type", "number"); dueDayInput.value = String(ld.paymentDueDay);
          dueDayInput.min = "1"; dueDayInput.max = "28";
          dueDayInput.className = "ledgr-inline-input";
          dueDayInput.oninput = (e) => { this.isDirty = true; ld.paymentDueDay = Math.min(28, Math.max(1, parseInt((e.target as HTMLInputElement).value) || 1)); };

          const row5 = card.createDiv("ledgr-edit-card-row");
          row5.createSpan({ text: "Reminder days", cls: "ledgr-meta" });
          const reminderInput = row5.createEl("input");
          reminderInput.setAttribute("type", "number"); reminderInput.value = String(ld.reminderDaysAhead);
          reminderInput.min = "0"; reminderInput.max = "14";
          reminderInput.className = "ledgr-inline-input";
          reminderInput.oninput = (e) => { this.isDirty = true; ld.reminderDaysAhead = Math.min(14, Math.max(0, parseInt((e.target as HTMLInputElement).value) || 3)); };

          const row6 = card.createDiv("ledgr-edit-card-row");
          row6.createSpan({ text: "Reminder", cls: "ledgr-meta" });
          const reminderCheck = row6.createEl("input", { attr: { type: "checkbox" } });
          reminderCheck.checked = ld.reminderEnabled;
          reminderCheck.onchange = () => { this.isDirty = true; ld.reminderEnabled = reminderCheck.checked; };

          const row7 = card.createDiv("ledgr-edit-card-row");
          row7.createSpan({ text: "APR (%)", cls: "ledgr-meta" });
          const aprInput = row7.createEl("input", { attr: { type: "number", placeholder: "e.g. 18.0", step: "0.1", min: "0" } });
          aprInput.className = "ledgr-inline-input";
          if (ld.apr !== undefined) aprInput.value = String(ld.apr);
          aprInput.oninput = () => { this.isDirty = true; ld.apr = parseFloat(aprInput.value) || undefined; };

          // Linked property dropdown (for mortgages)
          if (acc.type === "mortgage" || acc.type === "car_loan" || acc.type === "installment") {
            const propertyAccounts = this.data.accounts.filter((a) => !a.isLiability && a.type === "property");
            if (propertyAccounts.length > 0) {
              const row8 = card.createDiv("ledgr-edit-card-row");
              row8.createSpan({ text: "Linked property", cls: "ledgr-meta" });
              const select = row8.createEl("select", { cls: "ledgr-inline-input" });
              const noneOpt = select.createEl("option"); noneOpt.value = ""; noneOpt.textContent = "(none)";
              propertyAccounts.forEach((pa) => {
                const opt = select.createEl("option");
                opt.value = pa.id; opt.textContent = pa.name;
              });
              select.value = acc.linkedAssetId ?? "";
              select.onchange = () => {
                this.isDirty = true;
                const prev = acc.linkedAssetId;
                acc.linkedAssetId = select.value || undefined;
                // Update the linked asset's back-reference
                if (prev) {
                  const prevAsset = this.data.accounts.find((a) => a.id === prev);
                  if (prevAsset) prevAsset.linkedLiabilityId = undefined;
                }
                if (acc.linkedAssetId) {
                  const newAsset = this.data.accounts.find((a) => a.id === acc.linkedAssetId);
                  if (newAsset) newAsset.linkedLiabilityId = acc.id;
                }
              };
            }
          }
        }

        const removeBtn = card.createEl("button", { text: "Remove", cls: "ledgr-remove-btn" });
        removeBtn.onclick = () => {
          this.data.accounts = this.data.accounts.filter((a) => a.id !== acc.id);
          void this.render();
        };
        // Archive button for zero-balance liabilities
        if (acc.isLiability && acc.liabilityDetails && !acc.liabilityDetails.closedAt && Math.round(acc.balance * 100) === 0) {
          const archiveBtn = card.createEl("button", { text: "Archive", cls: "ledgr-budget-btn" });
          archiveBtn.onclick = () => {
            if (acc.liabilityDetails) {
              acc.liabilityDetails.closedAt = window.moment().format("YYYY-MM-DD");
              this.isDirty = true;
              void this.render();
            }
          };
        }
      });
    } else {
      const table = section.createEl("table", { cls: "ledgr-tx-table" });
      const hrow = table.createEl("thead").createEl("tr");
      ["Name", "Type", "Balance", "Schedule", ""].forEach((h) => hrow.createEl("th", { text: h }));
      const tbody = table.createEl("tbody");
      liabilities.forEach((acc) => {
        const tr = tbody.createEl("tr");
        tr.createEl("td", { text: acc.name });
        tr.createEl("td", { text: acc.type, cls: "ledgr-empty" });
        const balCell = tr.createEl("td", { cls: "ledgr-text-right" });
        balCell.createDiv({ text: this.fmt(this.toBase(acc.balance, acc.currency)) });
        const schedCell = tr.createEl("td", { cls: "ledgr-liability-schedule-col" });
        if (acc.liabilityDetails) {
          const ld = acc.liabilityDetails;
          const today = window.moment().format("YYYY-MM-DD");
          const m = window.moment(today);
          const dueDay = Math.min(ld.paymentDueDay, m.daysInMonth());
          const dueDate = m.clone().date(dueDay).format("MMM D");
          schedCell.createDiv({ text: `Due ${dueDate}`, cls: "ledgr-liability-due" });
          if (ld.monthlyPayment > 0) {
            schedCell.createDiv({
              text: formatCurrency(ld.monthlyPayment, acc.currency) + " / mo",
              cls: "ledgr-liability-monthly",
            });
          }
        }
        const actionTd = tr.createEl("td");
        if (acc.liabilityDetails && acc.balance > 0) {
          const payBtn = actionTd.createEl("button", { text: "Pay", cls: "ledgr-budget-btn" });
          payBtn.onclick = () => new LiabilityPaymentModal(
            this.app, this.plugin, acc, () => { void this.render(); }
          ).open();
        }
        if (acc.liabilityDetails) {
          const analyzeBtn = actionTd.createEl("button", { text: "Analyze", cls: "ledgr-budget-btn" });
          analyzeBtn.onclick = () => new DebtCostModal(this.app, this.plugin, acc).open();
        }
      });
    }
  }

  renderAddButtons(parent: HTMLElement) {
    const section = parent.createDiv("ledgr-section");
    section.createEl("h3", { text: "Add" });
    const btnRow = section.createDiv("ledgr-btn-row");
    const allCurrencies = [this.plugin.settings.baseCurrency, ...this.plugin.settings.secondaryCurrencies];

    // Single "+ Add Account" button — opens inline form with currency + type selector
    const addAccBtn = btnRow.createEl("button", { text: "+ Account", cls: "ledgr-budget-btn" });
    addAccBtn.onclick = () => this.showAddAccountForm(section, false);

    const addBrokerageBtn = btnRow.createEl("button", { text: "+ Investment", cls: "ledgr-budget-btn" });
    addBrokerageBtn.onclick = () => {
      this.data.brokerages.push({
        id: `brk_${Date.now()}`,
        name: "New Investment Account",
        currency: allCurrencies[0],
        value: 0,
        country: "JP",
      });
      void this.render();
    };

    const addLiabilityBtn = btnRow.createEl("button", { text: "+ Liability", cls: "ledgr-budget-btn" });
    addLiabilityBtn.onclick = () => this.showAddAccountForm(section, true);
  }

  showAddAccountForm(parent: HTMLElement, isLiability: boolean) {
    // Remove existing form if open
    parent.querySelector(".ledgr-add-account-form")?.remove();

    const allCurrencies = [this.plugin.settings.baseCurrency, ...this.plugin.settings.secondaryCurrencies];
    const form = parent.createDiv("ledgr-add-account-form ledgr-edit-card");

    form.createDiv({ text: isLiability ? "New Liability" : "New Account", cls: "ledgr-goal-name" });

    // Name
    const nameRow = form.createDiv("ledgr-edit-card-row");
    const nameInput = nameRow.createEl("input");
    nameInput.setAttribute("type", "text"); nameInput.placeholder = "Account name";
    nameInput.className = "ledgr-inline-input ledgr-edit-card-name";

    // Currency + Type row
    const row2 = form.createDiv("ledgr-edit-card-row");

    const currSelect = row2.createEl("select", { cls: "ledgr-inline-input" });
    allCurrencies.forEach((c) => {
      const opt = currSelect.createEl("option");
      opt.value = c; opt.textContent = c;
    });

    if (!isLiability) {
      const typeSelect = row2.createEl("select", { cls: "ledgr-inline-input" });
      ["bank", "ewallet", "cash", "credit"].forEach((t) => {
        const opt = typeSelect.createEl("option");
        opt.value = t; opt.textContent = t;
      });

      const addBtn = form.createEl("button", { text: "Add", cls: "ledgr-log-btn mod-cta" });
      addBtn.onclick = () => {
        this.data.accounts.push({
          id: `acc_${Date.now()}`,
          name: nameInput.value.trim() || "New Account",
          type: typeSelect.value as AccountType,
          currency: currSelect.value,
          balance: 0,
          country: "JP",
          isLiability: false,
        });
        this.isDirty = true;
        void this.render();
      };
    } else {
      // Liability type dropdown
      const liabTypeRow = form.createDiv("ledgr-edit-card-row");
      liabTypeRow.createSpan({ text: "Type", cls: "ledgr-meta" });
      const liabTypeSelect = liabTypeRow.createEl("select", { cls: "ledgr-inline-input" });
      LIABILITY_TYPES.forEach(({ key, label }) => {
        const opt = liabTypeSelect.createEl("option");
        opt.value = key; opt.textContent = label;
      });

      // Original amount
      const origRow = form.createDiv("ledgr-edit-card-row");
      origRow.createSpan({ text: "Original amount", cls: "ledgr-meta" });
      const origInput = origRow.createEl("input");
      origInput.setAttribute("type", "number"); origInput.placeholder = "0";
      origInput.className = "ledgr-inline-input";

      // Monthly payment
      const monthlyRow = form.createDiv("ledgr-edit-card-row");
      monthlyRow.createSpan({ text: "Monthly payment", cls: "ledgr-meta" });
      const monthlyInput = monthlyRow.createEl("input");
      monthlyInput.setAttribute("type", "number"); monthlyInput.placeholder = "0";
      monthlyInput.className = "ledgr-inline-input";

      // Due day
      const dueDayRow = form.createDiv("ledgr-edit-card-row");
      dueDayRow.createSpan({ text: "Due day (1–28)", cls: "ledgr-meta" });
      const dueDayInput = dueDayRow.createEl("input");
      dueDayInput.setAttribute("type", "number"); dueDayInput.placeholder = "1"; dueDayInput.min = "1"; dueDayInput.max = "28";
      dueDayInput.className = "ledgr-inline-input";

      // Reminder days ahead
      const reminderDaysRow = form.createDiv("ledgr-edit-card-row");
      reminderDaysRow.createSpan({ text: "Remind N days before", cls: "ledgr-meta" });
      const reminderDaysInput = reminderDaysRow.createEl("input");
      reminderDaysInput.setAttribute("type", "number"); reminderDaysInput.placeholder = "3"; reminderDaysInput.value = "3";
      reminderDaysInput.min = "0"; reminderDaysInput.max = "14";
      reminderDaysInput.className = "ledgr-inline-input";

      // Reminder toggle
      const reminderRow = form.createDiv("ledgr-edit-card-row");
      reminderRow.createSpan({ text: "Reminder", cls: "ledgr-meta" });
      const reminderCheck = reminderRow.createEl("input");
      reminderCheck.setAttribute("type", "checkbox"); (reminderCheck as HTMLInputElement).checked = true;

      const addBtn = form.createEl("button", { text: "Add", cls: "ledgr-log-btn mod-cta" });
      addBtn.onclick = () => {
        const originalAmount = parseFloat(origInput.value) || 0;
        this.data.accounts.push({
          id: `lia_${Date.now()}`,
          name: nameInput.value.trim() || "New Liability",
          type: liabTypeSelect.value as AccountType,
          currency: currSelect.value,
          balance: originalAmount,
          country: currSelect.value === "JPY" ? "JP" : currSelect.value === "PHP" ? "PH" : "JP",
          isLiability: true,
          liabilityDetails: {
            originalAmount,
            monthlyPayment: parseFloat(monthlyInput.value) || 0,
            paymentDueDay: Math.min(28, Math.max(1, parseInt(dueDayInput.value) || 1)),
            reminderEnabled: reminderCheck.checked,
            reminderDaysAhead: Math.min(14, Math.max(0, parseInt(reminderDaysInput.value) || 3)),
            payments: [],
          },
        });
        this.isDirty = true;
        void this.render();
      };
    }

    const cancelBtn = form.createEl("button", { text: "Cancel", cls: "ledgr-budget-btn" });
    cancelBtn.onclick = () => form.remove();

    nameInput.focus();
  }

  addEditCell(tr: HTMLElement, value: string, onChange: (v: string) => void) {
    const td = tr.createEl("td");
    const input = this.mkInput(td, "text");
    input.value = value;
    input.oninput = (e) => { this.isDirty = true; onChange((e.target as HTMLInputElement).value); };
  }

  addNumberCell(tr: HTMLElement, value: number, onChange: (v: number) => void) {
    const td = tr.createEl("td");
    const input = this.mkInput(td, "number");
    input.value = String(value);
    input.oninput = (e) => { this.isDirty = true; onChange(parseFloat((e.target as HTMLInputElement).value) || 0); };
  }

  addRemoveBtn(tr: HTMLElement, onClick: () => void) {
    const td = tr.createEl("td");
    const btn = td.createEl("button", { text: "Remove", cls: "ledgr-remove-btn" });
    btn.onclick = onClick;
  }

  createCard(parent: HTMLElement, label: string, value: string, cls: string, subtitle?: string) {
    const card = parent.createDiv(`ledgr-card ${cls}`);
    card.createDiv({ text: label, cls: "ledgr-card-label" });
    card.createDiv({ text: value, cls: "ledgr-card-value" });
    if (subtitle) card.createDiv({ text: subtitle, cls: "ledgr-card-subtitle" });
  }

  async renderGoals(parent: HTMLElement) {
    const section = parent.createDiv("ledgr-section");
    section.setAttribute("data-anchor", "goals");
    const hdr = section.createDiv("ledgr-section-header");
    hdr.createEl("h3", { text: "Savings Goals" });
    const addBtn = hdr.createEl("button", { text: "+ Add Goal", cls: "ledgr-budget-btn ledgr-goal-add-btn" });
    addBtn.onclick = () => new GoalModal(this.app, this.plugin, this.goalsStore, this.data, () => {
      void loadGoals(this.app, this.plugin.settings).then((gs) => { this.goalsStore = gs; void this.render(); });
    }).open();

    if (this.goalsStore.goals.length === 0) {
      section.createEl("p", { text: "No goals defined. Add a savings target.", cls: "ledgr-empty-state" });
      return;
    }

    // Get avg monthly savings from last 3 months
    let avgMonthlySavings = 0;
    try {
      const months3 = [0, 1, 2].map((i) => window.moment().subtract(i, "month").format("YYYY-MM"));
      // Parallel reads — one file per month, no loop
      const monthlyTxs = await Promise.all(
        months3.map((m) => readMonthTransactions(this.app, this.plugin.settings, m))
      );
      let totalNet = 0; let count = 0;
      for (const monthTxs of monthlyTxs) {
        if (monthTxs.length > 0) {
          const s = summarize(monthTxs, this.viewCurrency, this.plugin.settings.exchangeRates);
          totalNet += s.net; count++;
        }
      }
      if (count > 0) avgMonthlySavings = totalNet / count;
    } catch { /* no data */ }

    // Current total balance (bank + investments)
    const totalBalance = [
      ...this.data.accounts.filter((a) => !a.isLiability),
    ].reduce((s, a) => s + cvt(a.balance, a.currency, this.viewCurrency, this.plugin.settings.exchangeRates), 0)
      + this.data.brokerages.reduce((s, b) => s + cvt(b.value, b.currency, this.viewCurrency, this.plugin.settings.exchangeRates), 0);

    for (const goal of this.goalsStore.goals) {
      const targetInView = cvt(goal.targetAmount, goal.currency, this.viewCurrency, this.plugin.settings.exchangeRates);

      // Use linked account balance if specified, otherwise total net worth
      let current = totalBalance;
      if (goal.linkedAccountId) {
        const linked = this.data.accounts.find((a) => a.id === goal.linkedAccountId && !a.isLiability);
        if (linked) current = cvt(linked.balance, linked.currency, this.viewCurrency, this.plugin.settings.exchangeRates);
      }

      const pct = Math.min(100, Math.round((current / targetInView) * 100));
      const remaining = targetInView - current;
      const reached = current >= targetInView;

      const card = section.createDiv("ledgr-goal-card");

      // Header row
      const goalHdr = card.createDiv("ledgr-goal-header");
      goalHdr.createSpan({ text: goal.name, cls: "ledgr-goal-name" });
      const goalActions = goalHdr.createDiv("ledgr-goal-actions");
      const editBtn = goalActions.createEl("button", { cls: "ledgr-edit-btn" });
      setIcon(editBtn, "pencil");
      editBtn.onclick = () => new GoalModal(this.app, this.plugin, this.goalsStore, this.data, () => {
        void loadGoals(this.app, this.plugin.settings).then((gs) => { this.goalsStore = gs; void this.render(); });
      }, goal).open();
      const delBtn = goalActions.createEl("button", { text: "✕", cls: "ledgr-del-btn" });
      delBtn.onclick = async () => {
        this.goalsStore.goals = this.goalsStore.goals.filter((g) => g.id !== goal.id);
        await saveGoals(this.app, this.plugin.settings, this.goalsStore);
        void this.render();
      };

      // Progress label
      const fmt = (n: number) => formatCurrency(n, this.viewCurrency);
      const progLabel = card.createDiv("ledgr-goal-progress-label");
      progLabel.createSpan({ text: fmt(current) });
      progLabel.createSpan({ text: ` / `, cls: "ledgr-goal-target" });
      progLabel.createSpan({ text: `${goal.currency} ${goal.targetAmount.toLocaleString()}`, cls: "ledgr-goal-target" });

      // Progress bar
      const barRow = card.createDiv("ledgr-goal-bar-row");
      const barWrap = barRow.createDiv("ledgr-goal-bar-wrap");
      const bar = barWrap.createDiv(`ledgr-goal-bar${reached ? " ledgr-goal-complete" : ""}`);
      bar.setCssStyles({ width: "0%" });
      window.requestAnimationFrame(() => { bar.setCssStyles({ width: `${pct}%` }); });
      barRow.createSpan({ text: `${pct}%`, cls: "ledgr-goal-pct" });

      // Meta row
      const meta = card.createDiv("ledgr-goal-meta");
      if (reached) {
        meta.createSpan({ text: "Goal reached", cls: "ledgr-goal-status-good" });
      } else if (avgMonthlySavings > 0) {
        const monthsNeeded = Math.ceil(remaining / avgMonthlySavings);
        const projDate = window.moment().add(monthsNeeded, "months").format("MMM YYYY");
        meta.createSpan({ text: `~${monthsNeeded} months`, cls: "ledgr-goal-status-good" });
        meta.createSpan({ text: "·", cls: "ledgr-goal-meta-sep" });
        meta.createSpan({ text: projDate, cls: "ledgr-goal-date" });

        if (goal.deadline && window.moment(goal.deadline, "YYYY-MM-DD", true).isValid()) {
          const deadlineMonths = window.moment(goal.deadline).diff(window.moment(), "months");
          if (deadlineMonths <= 0) {
            meta.createSpan({ text: "·", cls: "ledgr-goal-meta-sep" });
            meta.createSpan({ text: "Deadline passed", cls: "ledgr-goal-status-warn" });
          } else if (monthsNeeded > deadlineMonths) {
            const needed = Math.ceil(remaining / Math.max(deadlineMonths, 1));
            meta.createSpan({ text: "·", cls: "ledgr-goal-meta-sep" });
            meta.createSpan({ text: `needs ${fmt(needed)}/mo to hit deadline`, cls: "ledgr-goal-status-warn" });
          }
        }
      } else if (avgMonthlySavings <= 0) {
        meta.createSpan({ text: "Increase savings to project", cls: "ledgr-goal-status-warn" });
      }
    }
  }

  async onClose() {
    if (this.isDirty && this.editMode) {
      this.data.updatedAt = new Date().toISOString();
      await saveNetWorth(this.app, this.plugin.settings, this.data);
      new Notice("Net worth auto-saved");
    }
    this.containerEl.removeClass("ledgr-view-active");
    this.contentEl.empty();
  }
}
