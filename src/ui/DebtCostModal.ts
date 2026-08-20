import { App, Modal, Setting, Notice, Platform } from "obsidian";
import LedgrPlugin from "../main";
import { Account, saveNetWorth, loadNetWorth } from "../data/networth";
import { calcAmortization, calcExtraPayment, rankDebts } from "../data/debtCost";
import { formatCurrency } from "../constants/currencies";
import { convertToBase } from "../data/reader";

export class DebtCostModal extends Modal {
  plugin: LedgrPlugin;
  account: Account;
  private extraPayment = 0;
  private aprChanged = false;

  constructor(app: App, plugin: LedgrPlugin, account: Account) {
    super(app);
    this.plugin = plugin;
    this.account = account;
  }

  onOpen() { void this.render(); }

  async render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ledgr-config-modal");
    const ld = this.account.liabilityDetails;
    if (!ld) return;

    const fmt = (n: number) => formatCurrency(n, this.account.currency);
    const fromMonth = window.moment().format("YYYY-MM");

    contentEl.createEl("h2", { text: "Debt Cost Analysis" });
    contentEl.createEl("p", { text: this.account.name, cls: "ledgr-meta" });
    contentEl.createDiv("ledgr-bearing-rule-thin");

    // APR input — always show, auto-focus if not set
    const aprRow = contentEl.createDiv("ledgr-edit-card-row");
    aprRow.createSpan({ text: "APR (%)", cls: "ledgr-meta" });
    const aprInput = aprRow.createEl("input", {
      attr: { type: "number", placeholder: "e.g. 18.0", step: "0.1", min: "0", class: "ledgr-inline-input" },
    });
    if (ld.apr !== undefined) aprInput.value = String(ld.apr);
    const saveAprBtn = aprRow.createEl("button", { text: "Save", cls: "ledgr-budget-btn" });
    saveAprBtn.onclick = async () => {
      const val = parseFloat(aprInput.value);
      if (!isNaN(val) && val >= 0) {
        ld.apr = val;
        this.aprChanged = true;
        const data = await loadNetWorth(this.app, this.plugin.settings);
        const acc = data.accounts.find((a) => a.id === this.account.id);
        if (acc?.liabilityDetails) acc.liabilityDetails.apr = val;
        await saveNetWorth(this.app, this.plugin.settings, data);
        new Notice("APR saved.");
        void this.render();
      }
    };

    if (ld.apr === undefined) {
      contentEl.createEl("p", { text: "Enter APR to calculate interest cost and payoff schedule.", cls: "ledgr-empty" });
      if (!Platform.isMobile) window.setTimeout(() => aprInput.focus(), 50);
      return;
    }

    // Guard: credit card without fixed term
    if (this.account.type === "credit_card") {
      const summary = calcAmortization(this.account.balance, ld.apr, ld.monthlyPayment, fromMonth);
      if (!summary.canAmortize) {
        contentEl.createEl("p", { text: `Monthly payment (${fmt(ld.monthlyPayment)}) does not exceed monthly interest (${fmt(summary.monthlyInterest)}). Increase your payment to reduce balance.`, cls: "ledgr-text-red" });
        return;
      }
    }

    const summary = calcAmortization(this.account.balance, ld.apr, ld.monthlyPayment, fromMonth);

    if (!summary.canAmortize) {
      contentEl.createEl("p", { text: `Payment does not cover interest. Minimum payment to reduce balance: ${fmt(this.account.balance * ld.apr / 100 / 12 + 1)}`, cls: "ledgr-text-red" });
      return;
    }

    // Cost breakdown table
    contentEl.createDiv("ledgr-bearing-rule-thin");
    const breakdown = contentEl.createEl("table", { cls: "ledgr-tx-table" });
    const tbody = breakdown.createEl("tbody");
    const row = (label: string, value: string, cls = "") => {
      const tr = tbody.createEl("tr");
      tr.createEl("td", { text: label, cls: "ledgr-meta" });
      tr.createEl("td", { text: value, cls: `ledgr-text-right ${cls}` });
    };
    row("Current balance", fmt(this.account.balance));
    row("Monthly payment", fmt(ld.monthlyPayment));
    row("Monthly interest", fmt(summary.monthlyInterest), "ledgr-negative");
    row("Principal this month", fmt(summary.principalThisMonth), "ledgr-positive");
    contentEl.createDiv("ledgr-bearing-rule-thin");
    row("Months to payoff", String(summary.monthsToPayoff));
    row("Payoff date", window.moment(summary.payoffDate).format("MMM YYYY"));
    row("Total interest", fmt(summary.totalInterest), "ledgr-text-secondary");
    row("Total cost", fmt(summary.totalCost));

    // Extra payment what-if
    contentEl.createDiv("ledgr-bearing-rule-thin");
    contentEl.createEl("p", { text: "Extra Payment Scenario", cls: "ledgr-bearing-section-label" });
    const extraRow = contentEl.createDiv("ledgr-edit-card-row");
    extraRow.createSpan({ text: "Extra / month", cls: "ledgr-meta" });
    const extraInput = extraRow.createEl("input", {
      attr: { type: "number", placeholder: "0", min: "0", class: "ledgr-inline-input" },
    });
    if (this.extraPayment > 0) extraInput.value = String(this.extraPayment);
    extraInput.oninput = () => {
      this.extraPayment = parseFloat(extraInput.value) || 0;
      void this.renderExtraScenario(contentEl, summary, fromMonth, fmt);
    };

    const extraResultDiv = contentEl.createDiv("ledgr-debt-extra-result");
    if (this.extraPayment > 0) {
      void this.renderExtraScenario(contentEl, summary, fromMonth, fmt);
    }

    // Priority order
    contentEl.createDiv("ledgr-bearing-rule-thin");
    contentEl.createEl("p", { text: "Priority Order", cls: "ledgr-bearing-section-label" });

    try {
      const nwData = await loadNetWorth(this.app, this.plugin.settings);
      const aprDebts = nwData.accounts
        .filter((a) => a.isLiability && a.liabilityDetails?.apr !== undefined && !a.liabilityDetails.closedAt)
        .map((a) => ({
          id: a.id,
          name: a.name,
          balance: convertToBase(a.balance, a.currency, this.plugin.settings.baseCurrency, this.plugin.settings.exchangeRates),
          apr: a.liabilityDetails!.apr!,
        }));

      if (aprDebts.length > 1) {
        const ranked = rankDebts(aprDebts);
        const priorityTable = contentEl.createEl("table", { cls: "ledgr-tx-table" });
        const phrow = priorityTable.createEl("thead").createEl("tr");
        ["#", "Name", "APR", "Strategy"].forEach((h) => phrow.createEl("th", { text: h }));
        const ptbody = priorityTable.createEl("tbody");
        ranked.sort((a, b) => a.avalancheRank - b.avalancheRank).forEach((d) => {
          const isCurrent = d.accountId === this.account.id;
          const tr = ptbody.createEl("tr");
          tr.createEl("td", { text: String(d.avalancheRank) });
          tr.createEl("td", { text: d.name, cls: isCurrent ? "ledgr-bearing-strong" : "" });
          tr.createEl("td", { text: `${d.apr}%` });
          if (d.avalancheRank !== d.snowballRank) {
            tr.createEl("td", { text: `Snowball: #${d.snowballRank}`, cls: "ledgr-empty" });
          } else {
            tr.createEl("td");
          }
        });
        contentEl.createEl("p", { text: "Lowest total cost: pay highest APR first (Avalanche). Fastest first win: pay smallest balance first (Snowball).", cls: "ledgr-empty" });
        contentEl.createEl("p", { text: "Note: compare interest savings to expected investment return before accelerating payoff.", cls: "ledgr-bearing-note" });
      }
    } catch { /* no networth data */ }

    contentEl.createDiv("ledgr-bearing-rule-thin");
    new Setting(contentEl).addButton((btn) =>
      btn.setButtonText("Close").onClick(() => this.close())
    );
  }

  renderExtraScenario(parent: HTMLElement, baseSummary: ReturnType<typeof calcAmortization>, fromMonth: string, fmt: (n: number) => string) {
    const existing = parent.querySelector(".ledgr-debt-extra-result");
    if (existing) existing.remove();
    if (this.extraPayment <= 0) return;

    const ld = this.account.liabilityDetails;
    if (!ld || ld.apr === undefined) return;

    const scenario = calcExtraPayment(this.account.balance, ld.apr, ld.monthlyPayment, this.extraPayment, fromMonth);
    const resultDiv = parent.createDiv("ledgr-debt-extra-result");
    const table = resultDiv.createEl("table", { cls: "ledgr-tx-table" });
    const tbody = table.createEl("tbody");
    const row = (label: string, value: string, cls = "") => {
      const tr = tbody.createEl("tr");
      tr.createEl("td", { text: label, cls: "ledgr-meta" });
      tr.createEl("td", { text: value, cls: `ledgr-text-right ${cls}` });
    };
    row("Months to payoff", `${scenario.monthsToPayoff} (−${scenario.monthsSaved} months)`, "ledgr-positive");
    row("Payoff date", window.moment(scenario.payoffDate).format("MMM YYYY"));
    row("Total interest", fmt(scenario.totalInterest));
    row("Interest saved", fmt(scenario.interestSaved), "ledgr-positive");
  }

  onClose() {
    this.contentEl.empty();
    if (this.aprChanged) {
      this.app.workspace.trigger("ledgr:networth-updated");
    }
  }
}
