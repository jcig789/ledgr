import { ItemView, WorkspaceLeaf, Notice, Events } from "obsidian";
import LedgrPlugin from "../main";
import { loadNetWorth, saveNetWorth, NetWorthData, AccountType } from "../data/networth";
import { convertToBase } from "../data/reader";
import { Currency } from "../settings";
import { renderDonutChart, categoryColor } from "./charts";
import { formatCurrency } from "../constants/currencies";
import { renderBottomNav } from "./BottomNav";
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
    this.containerEl.addClass("ledgr-view-active");
    this.data = await loadNetWorth(this.app, this.plugin.settings);
    this.goalsStore = await loadGoals(this.app, this.plugin.settings);
    void this.render();
    this.registerEvent(
      (this.app.workspace as Events).on("ledgr:settings-changed", () => {
        void this.render();
      })
    );
  }

  toBase(amount: number, currency: string) {
    return convertToBase(amount, currency, this.viewCurrency, this.plugin.settings.exchangeRates);
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

    // ── Bottom nav — rendered into containerEl (outside scroll area) ──
    renderBottomNav(this.containerEl, this.plugin, "networth");

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

    if (this.editMode) {
      // Card layout in edit mode — works on all screen widths
      accounts.forEach((acc) => {
        const card = section.createDiv("ledgr-edit-card");
        const row1 = card.createDiv("ledgr-edit-card-row");
        const nameInput = row1.createEl("input");
        nameInput.type = "text";
        nameInput.value = acc.name;
        nameInput.className = "ledgr-inline-input ledgr-edit-card-name";
        nameInput.placeholder = "Account name";
        nameInput.oninput = (e) => { this.isDirty = true; acc.name = (e.target as HTMLInputElement).value; };

        const row2 = card.createDiv("ledgr-edit-card-row");
        row2.createEl("span", { text: `${acc.type} · ${acc.currency}`, cls: "ledgr-meta" });
        const balInput = row2.createEl("input");
        balInput.type = "number";
        balInput.value = String(acc.balance);
        balInput.className = "ledgr-inline-input ledgr-edit-card-balance";
        balInput.placeholder = "Balance";
        balInput.oninput = (e) => { this.isDirty = true; acc.balance = parseFloat((e.target as HTMLInputElement).value) || 0; };

        const removeBtn = card.createEl("button", { text: "Remove", cls: "ledgr-remove-btn" });
        removeBtn.onclick = () => {
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
        nameInput.type = "text"; nameInput.value = b.name;
        nameInput.className = "ledgr-inline-input ledgr-edit-card-name";
        nameInput.placeholder = "Account name";
        nameInput.oninput = (e) => { this.isDirty = true; b.name = (e.target as HTMLInputElement).value; };

        const row2 = card.createDiv("ledgr-edit-card-row");
        row2.createEl("span", { text: `investment · ${b.currency}`, cls: "ledgr-meta" });
        const valInput = row2.createEl("input");
        valInput.type = "number"; valInput.value = String(b.value);
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

  renderLiabilities(parent: HTMLElement) {
    const liabilities = this.data.accounts.filter((a) => a.isLiability);
    if (liabilities.length === 0 && !this.editMode) return;

    const section = parent.createDiv("ledgr-section");
    section.createEl("h3", { text: "Liabilities" });

    if (liabilities.length === 0) {
      section.createEl("p", { text: "No liabilities. Click Edit to add.", cls: "ledgr-empty" });
      return;
    }

    if (this.editMode) {
      liabilities.forEach((acc) => {
        const card = section.createDiv("ledgr-edit-card");
        const row1 = card.createDiv("ledgr-edit-card-row");
        const nameInput = row1.createEl("input");
        nameInput.type = "text"; nameInput.value = acc.name;
        nameInput.className = "ledgr-inline-input ledgr-edit-card-name";
        nameInput.placeholder = "Name";
        nameInput.oninput = (e) => { this.isDirty = true; acc.name = (e.target as HTMLInputElement).value; };

        const row2 = card.createDiv("ledgr-edit-card-row");
        row2.createEl("span", { text: `${acc.type} · ${acc.currency}`, cls: "ledgr-meta" });
        const balInput = row2.createEl("input");
        balInput.type = "number"; balInput.value = String(acc.balance);
        balInput.className = "ledgr-inline-input ledgr-edit-card-balance";
        balInput.placeholder = "Balance";
        balInput.oninput = (e) => { this.isDirty = true; acc.balance = parseFloat((e.target as HTMLInputElement).value) || 0; };

        const removeBtn = card.createEl("button", { text: "Remove", cls: "ledgr-remove-btn" });
        removeBtn.onclick = () => {
          this.data.accounts = this.data.accounts.filter((a) => a.id !== acc.id);
          void this.render();
        };
      });
    } else {
      const table = section.createEl("table", { cls: "ledgr-tx-table" });
      const hrow = table.createEl("thead").createEl("tr");
      ["Name", "Type", "Balance"].forEach((h) => hrow.createEl("th", { text: h }));
      const tbody = table.createEl("tbody");
      liabilities.forEach((acc) => {
        const tr = tbody.createEl("tr");
        tr.createEl("td", { text: acc.name });
        tr.createEl("td", { text: acc.type, cls: "ledgr-empty" });
        tr.createEl("td", { text: this.fmt(this.toBase(acc.balance, acc.currency)), cls: "ledgr-text-right" });
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

    form.createEl("div", { text: isLiability ? "New Liability" : "New Account", cls: "ledgr-goal-name" });

    // Name
    const nameRow = form.createDiv("ledgr-edit-card-row");
    const nameInput = nameRow.createEl("input");
    nameInput.type = "text"; nameInput.placeholder = "Account name";
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
      const addBtn = form.createEl("button", { text: "Add", cls: "ledgr-log-btn mod-cta" });
      addBtn.onclick = () => {
        this.data.accounts.push({
          id: `lia_${Date.now()}`,
          name: nameInput.value.trim() || "New Liability",
          type: "loan",
          currency: currSelect.value,
          balance: 0,
          country: "PH",
          isLiability: true,
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
      const fmt = (n: number) => formatCurrency(n, this.viewCurrency);
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
    this.containerEl.removeClass("ledgr-view-active");
    this.contentEl.empty();
  }
}
