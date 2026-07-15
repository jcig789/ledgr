import { App, Modal, Setting, Notice } from "obsidian";
import LedgrPlugin from "../main";
import { Goal, GoalStore, saveGoals } from "../data/goals";
import { NetWorthData } from "../data/networth";

export class GoalModal extends Modal {
  plugin: LedgrPlugin;
  store: GoalStore;
  netWorth: NetWorthData;
  editGoal: Goal | null;
  onSaved: () => void;

  name = "";
  targetAmount = "";
  currency: string;
  deadline = "";
  linkedAccountId = "";

  constructor(app: App, plugin: LedgrPlugin, store: GoalStore, netWorth: NetWorthData, onSaved: () => void, editGoal?: Goal) {
    super(app);
    this.plugin = plugin;
    this.store = store;
    this.netWorth = netWorth;
    this.onSaved = onSaved;
    this.editGoal = editGoal ?? null;
    this.currency = plugin.settings.baseCurrency;

    if (editGoal) {
      this.name = editGoal.name;
      this.targetAmount = String(editGoal.targetAmount);
      this.currency = editGoal.currency;
      this.deadline = editGoal.deadline ?? "";
      this.linkedAccountId = editGoal.linkedAccountId ?? "";
    }
  }

  onOpen() { this.render().catch(console.error); }

  async render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: this.editGoal ? "Edit Goal" : "New Savings Goal" });

    new Setting(contentEl)
      .setName("Goal name")
      .addText((t) => t.setPlaceholder("e.g. Emergency Fund").setValue(this.name).onChange((v) => (this.name = v)));

    new Setting(contentEl)
      .setName("Target amount")
      .addText((t) => t.setPlaceholder("0").setValue(this.targetAmount).onChange((v) => (this.targetAmount = v)))
      .addDropdown((d) => {
        [this.plugin.settings.baseCurrency, ...this.plugin.settings.secondaryCurrencies]
          .forEach((c) => d.addOption(c, c));
        d.setValue(this.currency).onChange((v) => (this.currency = v));
        return d;
      });

    const deadlineSetting = new Setting(contentEl)
      .setName("Deadline")
      .setDesc("Optional target date");
    (await import("./DatePicker")).createDateInput(deadlineSetting.controlEl, this.deadline, (v) => (this.deadline = v));

    // Account link
    const accounts = this.netWorth.accounts.filter((a) => !a.isLiability);
    if (accounts.length > 0) {
      new Setting(contentEl)
        .setName("Link to account")
        .setDesc("Optional — track goal from a specific account balance")
        .addDropdown((d) => {
          d.addOption("", "None");
          accounts.forEach((a) => d.addOption(a.id, `${a.name} (${a.currency})`));
          d.setValue(this.linkedAccountId).onChange((v) => (this.linkedAccountId = v));
          return d;
        });
    }

    contentEl.createEl("p", { cls: "ledgr-error ledgr-error-goal ledgr-hidden", text: "" });

    new Setting(contentEl).addButton((btn) =>
      btn.setButtonText(this.editGoal ? "Save Changes" : "Add Goal").setCta().onClick(() => this.save())
    );
  }

  async save() {
    const errEl = this.contentEl.querySelector<HTMLElement>(".ledgr-error-goal");
    if (errEl) { errEl.addClass("ledgr-hidden"); errEl.textContent = ""; }

    if (!this.name.trim()) {
      if (errEl) { errEl.textContent = "Please enter a goal name."; errEl.removeClass("ledgr-hidden"); }
      return;
    }
    const amt = parseFloat(this.targetAmount);
    if (!amt || isNaN(amt) || amt <= 0) {
      if (errEl) { errEl.textContent = "Please enter a valid target amount."; errEl.removeClass("ledgr-hidden"); }
      return;
    }

    const goal: Goal = {
      id: this.editGoal?.id ?? `goal_${Date.now()}`,
      name: this.name.trim(),
      targetAmount: amt,
      currency: this.currency,
      deadline: this.deadline || undefined,
      linkedAccountId: this.linkedAccountId || undefined,
    };

    if (this.editGoal) {
      const idx = this.store.goals.findIndex((g) => g.id === goal.id);
      if (idx >= 0) this.store.goals[idx] = goal;
    } else {
      this.store.goals.push(goal);
    }

    await saveGoals(this.app, this.plugin.settings, this.store);
    new Notice(`Goal "${goal.name}" saved`);
    this.onSaved();
    this.close();
  }

  onClose() { this.contentEl.empty(); }
}
