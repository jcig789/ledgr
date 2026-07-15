import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import LedgrPlugin from "../main";
import { loadNetWorth, saveNetWorth, NetWorthData } from "../data/networth";
import { convertToBase } from "../data/reader";
import { Currency } from "../settings";
import { renderNavBar } from "./NavBar";
import { renderDonutChart, categoryColor } from "./charts";
import { loadGoals, saveGoals, GoalStore } from "../data/goals";
import { GoalModal } from "./GoalModal";
import { readMonthTransactions, summarize, convertToBase as cvt } from "../data/reader";

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
    this.data = await loadNetWorth(this.app, this.plugin.settings);
    this.goalsStore = await loadGoals(this.app, this.plugin.settings);
    void this.render();
  }

  toBase(amount: number, currency: string) {
    return convertToBase(amount, currency, this.viewCurrency, this.plugin.settings.exchangeRates);
  }

  fmt(n: number) {
    return `${this.viewCurrency} ${Math.round(n).toLocaleString()}`;
  }

  async render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ledgr-networth");

    // ── Nav bar (always first, same position as Dashboard) ──
    renderNavBar(contentEl, this.app, this.plugin, "networth");

    // ── Controls bar ──
    const header = contentEl.createDiv("ledgr-header");

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
      row.createEl("span", { text: a.name, cls: "ledgr-nw-bar-label" });
      const barWrap = row.createDiv("ledgr-nw-bar-track");
      const bar = barWrap.createDiv("ledgr-nw-bar-fill");
      bar.setCssStyles({ backgroundColor: color });
      bar.setCssStyles({ width: "0%" });
      window.requestAnimationFrame(() => { bar.setCssStyles({ width: `${Math.round(pct)}%` }); });
      row.createEl("span", { text: this.fmt(balance), cls: "ledgr-nw-bar-amt" });
    });
  }

  renderAccountGroup(parent: HTMLElement, title: string, country: "JP" | "PH") {
    const accounts = this.data.accounts.filter((a) => a.country === country && !a.isLiability);
    if (accounts.length === 0 && !this.editMode) return;

    const section = parent.createDiv("ledgr-section");
    section.createEl("h3", { text: title });

    if (accounts.length === 0) {
      section.createEl("p", { text: "No accounts. Click Edit to add.", cls: "ledgr-empty" });
      return;
    }

    const table = section.createEl("table", { cls: "ledgr-tx-table" });
    const thead = table.createEl("thead");
    const hrow = thead.createEl("tr");
    (this.editMode ? ["Account", "Type", "Currency", "Balance", ""] : ["Account", "Type", "Balance"])
      .forEach((h) => hrow.createEl("th", { text: h }));
    const tbody = table.createEl("tbody");

    accounts.forEach((acc) => {
      const tr = tbody.createEl("tr");
      if (this.editMode) {
        this.addEditCell(tr, acc.name, (v) => (acc.name = v));
        tr.createEl("td", { text: acc.type, cls: "ledgr-empty" });
        tr.createEl("td", { text: acc.currency, cls: "ledgr-empty" });
        this.addNumberCell(tr, acc.balance, (v) => (acc.balance = v));
        this.addRemoveBtn(tr, () => {
          this.data.accounts = this.data.accounts.filter((a) => a.id !== acc.id);
          void this.render();
        });
      } else {
        tr.createEl("td", { text: acc.name });
        tr.createEl("td", { text: acc.type, cls: "ledgr-empty" });
        tr.createEl("td", { text: this.fmt(this.toBase(acc.balance, acc.currency)), cls: "ledgr-text-right" });
      }
    });
  }

  renderBrokerages(parent: HTMLElement) {
    const section = parent.createDiv("ledgr-section");
    section.createEl("h3", { text: "Investment Accounts" });

    if (this.data.brokerages.length === 0 && !this.editMode) {
      section.createEl("p", { text: "No investment accounts. Click Edit to add.", cls: "ledgr-empty" });
      return;
    }

    const table = section.createEl("table", { cls: "ledgr-tx-table" });
    const thead = table.createEl("thead");
    const hrow = thead.createEl("tr");
    (this.editMode ? ["Investment Account", "Currency", "Total Value", ""] : ["Investment Account", "Total Value"])
      .forEach((h) => hrow.createEl("th", { text: h }));
    const tbody = table.createEl("tbody");

    this.data.brokerages.forEach((b) => {
      const tr = tbody.createEl("tr");
      if (this.editMode) {
        this.addEditCell(tr, b.name, (v) => (b.name = v));
        tr.createEl("td", { text: b.currency, cls: "ledgr-empty" });
        this.addNumberCell(tr, b.value, (v) => (b.value = v));
        this.addRemoveBtn(tr, () => {
          this.data.brokerages = this.data.brokerages.filter((bb) => bb !== b);
          void this.render();
        });
      } else {
        tr.createEl("td", { text: b.name });
        tr.createEl("td", { text: this.fmt(this.toBase(b.value, b.currency)), cls: "ledgr-text-right" });
      }
    });
  }

  renderLiabilities(parent: HTMLElement) {
    const liabilities = this.data.accounts.filter((a) => a.isLiability);
    if (liabilities.length === 0 && !this.editMode) return;

    const section = parent.createDiv("ledgr-section");
    section.createEl("h3", { text: "Liabilities" });

    if (liabilities.length === 0) {
      section.createEl("p", { text: "No liabilities. Click Edit to add.", cls: "ledgr-empty" });
      return;
    }

    const table = section.createEl("table", { cls: "ledgr-tx-table" });
    const thead = table.createEl("thead");
    const hrow = thead.createEl("tr");
    (this.editMode ? ["Name", "Type", "Currency", "Balance", ""] : ["Name", "Type", "Balance"])
      .forEach((h) => hrow.createEl("th", { text: h }));
    const tbody = table.createEl("tbody");

    liabilities.forEach((acc) => {
      const tr = tbody.createEl("tr");
      if (this.editMode) {
        this.addEditCell(tr, acc.name, (v) => (acc.name = v));
        tr.createEl("td", { text: acc.type, cls: "ledgr-empty" });
        tr.createEl("td", { text: acc.currency, cls: "ledgr-empty" });
        this.addNumberCell(tr, acc.balance, (v) => (acc.balance = v));
        this.addRemoveBtn(tr, () => {
          this.data.accounts = this.data.accounts.filter((a) => a.id !== acc.id);
          void this.render();
        });
      } else {
        tr.createEl("td", { text: acc.name });
        tr.createEl("td", { text: acc.type, cls: "ledgr-empty" });
        tr.createEl("td", { text: this.fmt(this.toBase(acc.balance, acc.currency)), cls: "ledgr-text-right" });
      }
    });
  }

  renderAddButtons(parent: HTMLElement) {
    const section = parent.createDiv("ledgr-section");
    section.createEl("h3", { text: "Add" });
    const btnRow = section.createDiv("ledgr-btn-row");

    const addAccBtn = (label: string, country: "JP" | "PH", currency: string) => {
      const btn = btnRow.createEl("button", { text: label, cls: "ledgr-budget-btn" });
      btn.onclick = () => {
        this.data.accounts.push({
          id: `acc_${Date.now()}`,
          name: "New Account",
          type: "bank",
          currency,
          balance: 0,
          country,
          isLiability: false,
        });
        void this.render();
      };
    };

    const base = this.plugin.settings.baseCurrency;
    const sec = this.plugin.settings.secondaryCurrencies[0] ?? base;

    addAccBtn(`+ Account (${base})`, "JP", base);
    addAccBtn(`+ Account (${sec})`, "PH", sec);

    const addBrokerageBtn = btnRow.createEl("button", { text: "+ Investment Account", cls: "ledgr-budget-btn" });
    addBrokerageBtn.onclick = () => {
      this.data.brokerages.push({ id: `brk_${Date.now()}`, name: "New Investment Account", currency: base, value: 0, country: "JP" });
      void this.render();
    };

    const addLiabilityBtn = btnRow.createEl("button", { text: "+ Liability", cls: "ledgr-budget-btn" });
    addLiabilityBtn.onclick = () => {
      this.data.accounts.push({
        id: `lia_${Date.now()}`,
        name: "New Liability",
        type: "loan",
        currency: sec,
        balance: 0,
        country: "PH",
        isLiability: true,
      });
      void this.render();
    };
  }

  addEditCell(tr: HTMLElement, value: string, onChange: (v: string) => void) {
    const td = tr.createEl("td");
    const input = td.createEl("input");
    input.type = "text";
    input.value = value;
    input.className = "ledgr-inline-input";
    input.oninput = (e) => { this.isDirty = true; onChange((e.target as HTMLInputElement).value); };
  }

  addNumberCell(tr: HTMLElement, value: number, onChange: (v: number) => void) {
    const td = tr.createEl("td");
    const input = td.createEl("input");
    input.type = "number";
    input.value = String(value);
    input.className = "ledgr-inline-input";
    input.oninput = (e) => { this.isDirty = true; onChange(parseFloat((e.target as HTMLInputElement).value) || 0); };
  }

  addRemoveBtn(tr: HTMLElement, onClick: () => void) {
    const td = tr.createEl("td");
    const btn = td.createEl("button", { text: "Remove", cls: "ledgr-remove-btn" });
    btn.onclick = onClick;
  }

  createCard(parent: HTMLElement, label: string, value: string, cls: string, subtitle?: string) {
    const card = parent.createDiv(`ledgr-card ${cls}`);
    card.createEl("div", { text: label, cls: "ledgr-card-label" });
    card.createEl("div", { text: value, cls: "ledgr-card-value" });
    if (subtitle) card.createEl("div", { text: subtitle, cls: "ledgr-card-subtitle" });
  }

  async renderGoals(parent: HTMLElement) {
    const section = parent.createDiv("ledgr-section");
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
      goalHdr.createEl("span", { text: goal.name, cls: "ledgr-goal-name" });
      const goalActions = goalHdr.createDiv("ledgr-goal-actions");
      const editBtn = goalActions.createEl("button", { text: "✎", cls: "ledgr-edit-btn" });
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
      const fmt = (n: number) => `${this.viewCurrency} ${Math.round(n).toLocaleString()}`;
      const progLabel = card.createDiv("ledgr-goal-progress-label");
      progLabel.createEl("span", { text: fmt(current) });
      progLabel.createEl("span", { text: ` / `, cls: "ledgr-goal-target" });
      progLabel.createEl("span", { text: `${goal.currency} ${goal.targetAmount.toLocaleString()}`, cls: "ledgr-goal-target" });

      // Progress bar
      const barRow = card.createDiv("ledgr-goal-bar-row");
      const barWrap = barRow.createDiv("ledgr-goal-bar-wrap");
      const bar = barWrap.createDiv(`ledgr-goal-bar${reached ? " ledgr-goal-complete" : ""}`);
      bar.setCssStyles({ width: "0%" });
      window.requestAnimationFrame(() => { bar.setCssStyles({ width: `${pct}%` }); });
      barRow.createEl("span", { text: `${pct}%`, cls: "ledgr-goal-pct" });

      // Meta row
      const meta = card.createDiv("ledgr-goal-meta");
      if (reached) {
        meta.createEl("span", { text: "Goal reached", cls: "ledgr-goal-status-good" });
      } else if (avgMonthlySavings > 0) {
        const monthsNeeded = Math.ceil(remaining / avgMonthlySavings);
        const projDate = window.moment().add(monthsNeeded, "months").format("MMM YYYY");
        meta.createEl("span", { text: `~${monthsNeeded} months`, cls: "ledgr-goal-status-good" });
        meta.createEl("span", { text: "·", cls: "ledgr-goal-meta-sep" });
        meta.createEl("span", { text: projDate, cls: "ledgr-goal-date" });

        if (goal.deadline && window.moment(goal.deadline, "YYYY-MM-DD", true).isValid()) {
          const deadlineMonths = window.moment(goal.deadline).diff(window.moment(), "months");
          if (deadlineMonths <= 0) {
            meta.createEl("span", { text: "·", cls: "ledgr-goal-meta-sep" });
            meta.createEl("span", { text: "Deadline passed", cls: "ledgr-goal-status-warn" });
          } else if (monthsNeeded > deadlineMonths) {
            const needed = Math.ceil(remaining / Math.max(deadlineMonths, 1));
            meta.createEl("span", { text: "·", cls: "ledgr-goal-meta-sep" });
            meta.createEl("span", { text: `needs ${fmt(needed)}/mo to hit deadline`, cls: "ledgr-goal-status-warn" });
          }
        }
      } else if (avgMonthlySavings <= 0) {
        meta.createEl("span", { text: "Increase savings to project", cls: "ledgr-goal-status-warn" });
      }
    }
  }

  async onClose() {
    if (this.isDirty && this.editMode) {
      this.data.updatedAt = new Date().toISOString();
      await saveNetWorth(this.app, this.plugin.settings, this.data);
      new Notice("Net worth auto-saved");
    }
    this.contentEl.empty();
  }
}
