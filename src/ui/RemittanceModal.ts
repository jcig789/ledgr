import { App, Modal, Setting, Notice } from "obsidian";
import LedgrPlugin from "../main";
import { Remittance, loadRemittances, saveRemittances } from "../data/remittances";
import { saveTransaction } from "../data/transactions";

const DEFAULT_SERVICES = ["Wise", "Revolut", "Bank Transfer", "Other"];

export class RemittanceModal extends Modal {
  plugin: LedgrPlugin;
  amountFrom = "";
  service: string;
  fee: number;
  fxRate: number;
  amountTo = "";
  note = "";
  date: string;
  base: string;
  sec: string;
  private amtInput: HTMLInputElement | null = null;

  constructor(app: App, plugin: LedgrPlugin) {
    super(app);
    this.plugin = plugin;
    this.base = plugin.settings.baseCurrency;
    this.sec = plugin.settings.secondaryCurrencies[0] ?? "USD";
    this.service = plugin.settings.lastUsedTransferService || "Wise";
    this.fee = plugin.settings.transferServiceFees[this.service] ?? 0;
    this.fxRate = plugin.settings.exchangeRates.rates[`${this.base}_${this.sec}`] ?? 0;
    this.date = window.moment().format("YYYY-MM-DD");
  }

  onOpen() {
    void this.render().catch(console.error);
    this.contentEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void this.save(); }
    });
    window.setTimeout(() => this.amtInput?.focus(), 50);
  }

  recalcTo() {
    const amt = parseFloat(this.amountFrom) || 0;
    const net = Math.max(0, amt - this.fee);
    this.amountTo = (net * this.fxRate).toFixed(0);
  }

  async render() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Log Transfer" });
    contentEl.createEl("p", {
      text: this.fxRate > 0
        ? `Rate: 1 ${this.base} = ${this.fxRate.toFixed(4)} ${this.sec}`
        : `Set exchange rates in Settings to see conversion`,
      cls: "ledgr-remit-rate",
    });

    // Amount in base currency
    new Setting(contentEl)
      .setName(`Amount (${this.base})`)
      .addText((t) => {
        t.setPlaceholder("0").setValue(this.amountFrom).onChange((v): void => {
          this.amountFrom = v;
          this.recalcTo();
          this.updateToDisplay();
        });
        this.amtInput = t.inputEl;
        return t;
      });

    // Service
    const services = Object.keys(this.plugin.settings.transferServiceFees).length > 0
      ? Object.keys(this.plugin.settings.transferServiceFees)
      : DEFAULT_SERVICES;

    new Setting(contentEl)
      .setName("Service")
      .addDropdown((d): void => {
        services.forEach((s) => d.addOption(s, s));
        void d.setValue(this.service).onChange((v): void => {
          this.service = v;
          this.fee = this.plugin.settings.transferServiceFees[v] ?? 0;
          this.recalcTo();
          void this.render().catch(console.error);
        });
      });

    // Fee
    new Setting(contentEl)
      .setName(`Fee (${this.base})`)
      .setDesc("Transfer fee — pre-filled from last use")
      .addText((t) =>
        t.setValue(String(this.fee)).onChange((v): void => {
          this.fee = parseFloat(v) || 0;
          this.recalcTo();
          this.updateToDisplay();
        })
      );

    // Exchange rate
    new Setting(contentEl)
      .setName(`Rate (${this.base} → ${this.sec})`)
      .setDesc("Rate at time of transfer")
      .addText((t) =>
        t.setValue(String(this.fxRate)).onChange((v): void => {
          this.fxRate = parseFloat(v) || 0;
          this.recalcTo();
          this.updateToDisplay();
        })
      );

    // Amount received in secondary currency
    this.recalcTo();
    new Setting(contentEl)
      .setName(`${this.sec} Received`)
      .setDesc("Auto-calculated — tap to override")
      .addText((t) => {
        t.inputEl.classList.add("ledgr-to-received");
        t.setValue(this.amountTo).onChange((v) => (this.amountTo = v));
        return t;
      });

    // Note
    new Setting(contentEl)
      .setName("Note")
      .addText((t) =>
        t.setPlaceholder("e.g. monthly support").setValue(this.note).onChange((v) => (this.note = v))
      );

    // Date picker
    const dateSetting = new Setting(contentEl).setName("Date");
    (await import("./DatePicker")).createDateInput(dateSetting.controlEl, this.date, (v) => (this.date = v));

    contentEl.createEl("p", { cls: "ledgr-error ledgr-error-remit ledgr-hidden", text: "" });

    new Setting(contentEl).addButton((btn) =>
      btn.setButtonText("Save (Enter)").setCta().onClick(() => void this.save())
    );
  }

  updateToDisplay() {
    const input = this.contentEl.querySelector<HTMLInputElement>(".ledgr-to-received");
    if (input) input.value = this.amountTo;
  }

  async save() {
    const errEl = this.contentEl.querySelector<HTMLElement>(".ledgr-error-remit");
    if (errEl) { errEl.addClass("ledgr-hidden"); errEl.textContent = ""; }

    const amt = parseFloat(this.amountFrom);
    if (!amt || isNaN(amt) || amt <= 0) {
      if (errEl) { errEl.textContent = "Please enter a valid amount."; errEl.removeClass("ledgr-hidden"); }
      this.amtInput?.focus();
      return;
    }

    if (!window.moment(this.date, "YYYY-MM-DD", true).isValid()) {
      if (errEl) { errEl.textContent = "Date must be YYYY-MM-DD."; errEl.removeClass("ledgr-hidden"); }
      return;
    }

    const remittance: Remittance = {
      id: `transfer_${Date.now()}`,
      date: this.date,
      amountJPY: amt,        // amountFrom (base currency)
      service: this.service,
      feeJPY: this.fee,
      rateAtSend: this.fxRate,
      amountPHP: parseFloat(this.amountTo) || 0,  // amountTo (secondary currency)
      note: this.note,
    };

    const store = await loadRemittances(this.app, this.plugin.settings);
    store.remittances.push(remittance);
    await saveRemittances(this.app, this.plugin.settings, store);

    // Log as transaction for budget tracking
    await saveTransaction(this.app, this.plugin.settings, {
      date: this.date,
      type: "expense",
      amount: amt,
      currency: this.base,
      category: "Family",
      subcategory: "Remittance",
      note: this.note || `${this.service} · ${this.sec} ${this.amountTo}`,
    });

    this.plugin.settings.lastUsedTransferService = this.service;
    this.plugin.settings.transferServiceFees[this.service] = this.fee;
    await this.plugin.saveSettings();

    new Notice(`Transfer logged: ${this.base} ${amt.toLocaleString()} → ${this.sec} ${parseFloat(this.amountTo).toLocaleString()}`);
    this.close();
  }

  onClose() {
    this.contentEl.empty();
  }
}
