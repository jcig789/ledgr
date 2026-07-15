import { App, Modal, Setting, Notice } from "obsidian";
import LedgrPlugin from "../main";

export class OnboardingModal extends Modal {
  plugin: LedgrPlugin;
  step = 1;

  constructor(app: App, plugin: LedgrPlugin) {
    super(app);
    this.plugin = plugin;
  }

  async onOpen() {
    // Mark as seen immediately — never show again regardless of how user dismisses
    if (this.plugin.settings.firstRun) {
      this.plugin.settings.firstRun = false;
      await this.plugin.saveSettings();
    }
    this.render();
  }

  render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ledgr-onboarding");

    // Progress indicator
    const progress = contentEl.createDiv("ledgr-onboarding-progress");
    for (let i = 1; i <= 3; i++) {
      progress.createEl("span", {
        cls: `ledgr-onboarding-dot ${i === this.step ? "active" : i < this.step ? "done" : ""}`,
      });
    }

    if (this.step === 1) this.renderStep1();
    else if (this.step === 2) this.renderStep2();
    else if (this.step === 3) this.renderStep3();
  }

  renderStep1() {
    const { contentEl } = this;

    contentEl.createEl("h2", { text: "Welcome to Ledgr" });
    contentEl.createEl("p", {
      text: "Your money, both sides of the ocean. Let's set up in 3 steps.",
      cls: "ledgr-onboarding-sub",
    });

    contentEl.createEl("h3", { text: "Step 1 — Where are you saving your notes?" });
    contentEl.createEl("p", {
      text: "Ledgr stores your financial data in your vault. Choose a folder:",
      cls: "setting-item-description",
    });

    new Setting(contentEl)
      .setName("Finance folder")
      .addText((t) =>
        t
          .setValue(this.plugin.settings.financeFolder)
          .onChange(async (v) => {
            this.plugin.settings.financeFolder = v;
            await this.plugin.saveSettings();
          })
      );

    contentEl.createEl("p", {
      text: "Your data stays on your device — no accounts, no cloud.",
      cls: "ledgr-onboarding-trust",
    });

    this.addNextBtn("Next →");
  }

  renderStep2() {
    const { contentEl } = this;
    const base = this.plugin.settings.baseCurrency;
    const secondaries = this.plugin.settings.secondaryCurrencies;

    contentEl.createEl("h2", { text: "Step 2 — Exchange rates" });
    contentEl.createEl("p", {
      text: "Set your exchange rates so Ledgr converts correctly.",
      cls: "ledgr-onboarding-sub",
    });

    contentEl.createEl("p", {
      text: `Base currency: ${base}. Enter how many units of each secondary currency equal 1 ${base}.`,
      cls: "setting-item-description",
    });

    secondaries.forEach((sec) => {
      const key = `${base}_${sec}`;
      const current = this.plugin.settings.exchangeRates.rates[key] ?? 0;
      new Setting(contentEl)
        .setName(`${base} → ${sec}`)
        .setDesc(`How many ${sec} per 1 ${base}?`)
        .addText((t) =>
          t
            .setPlaceholder("e.g. 0.0065")
            .setValue(current > 0 ? String(current) : "")
            .onChange(async (v) => {
              this.plugin.settings.exchangeRates.rates[key] = parseFloat(v) || 0;
              this.plugin.settings.exchangeRates.updatedAt = new Date().toISOString();
              await this.plugin.saveSettings();
            })
        );
    });

    contentEl.createEl("p", {
      text: "You can update rates anytime from the Settings button on the dashboard.",
      cls: "setting-item-description",
    });

    this.addBackBtn();
    this.addNextBtn("Next →");
  }

  renderStep3() {
    const { contentEl } = this;

    contentEl.createEl("h2", { text: "Step 3 — Log your first transaction" });
    contentEl.createEl("p", {
      text: "Write down something you spent today. Anything — a coffee, train fare, a grocery run.",
      cls: "ledgr-onboarding-sub",
    });

    const base = this.plugin.settings.baseCurrency;
    const examples = contentEl.createDiv("ledgr-onboarding-examples");
    [
      { label: "Convenience store", amount: `100 ${base}` },
      { label: "Transport", amount: `50 ${base}` },
      { label: "Lunch", amount: `200 ${base}` },
    ].forEach(({ label, amount }) => {
      const ex = examples.createDiv("ledgr-onboarding-example");
      ex.createEl("span", { text: label });
      ex.createEl("span", { text: amount, cls: "ledgr-onboarding-example-amt" });
    });

    this.addBackBtn();

    const doneBtn = contentEl.createEl("button", {
      text: "Start logging →",
      cls: "ledgr-log-btn mod-cta ledgr-onboarding-cta",
    });
    doneBtn.onclick = async () => {
      this.plugin.settings.firstRun = false;
      await this.plugin.saveSettings();
      this.close();
      // Open quick capture
      const { QuickCaptureModal } = await import("./QuickCaptureModal");
      new QuickCaptureModal(this.app, this.plugin.settings).open();
    };
  }

  addNextBtn(label: string) {
    const btn = this.contentEl.createEl("button", {
      text: label,
      cls: "ledgr-log-btn mod-cta ledgr-onboarding-cta",
    });
    btn.onclick = () => { this.step++; this.render(); };
  }

  addBackBtn() {
    const btn = this.contentEl.createEl("button", {
      text: "← Back",
      cls: "ledgr-budget-btn ledgr-onboarding-back",
    });
    btn.onclick = () => { this.step--; this.render(); };
  }

  onClose() {
    this.contentEl.empty();
  }
}
