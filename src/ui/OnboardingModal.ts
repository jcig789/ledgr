import { App, Modal, Setting } from "obsidian";
import LedgrPlugin from "../main";

type OnboardingPath = "spending" | "obligations";

export class OnboardingModal extends Modal {
  plugin: LedgrPlugin;
  step = 1;
  path: OnboardingPath = "spending";

  constructor(app: App, plugin: LedgrPlugin) {
    super(app);
    this.plugin = plugin;
  }

  async onOpen() {
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

    const totalSteps = 3;
    const progress = contentEl.createDiv("ledgr-onboarding-progress");
    for (let i = 1; i <= totalSteps; i++) {
      progress.createSpan({
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
      text: "Track your money, your way. Let's get set up.",
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

    contentEl.createEl("h2", { text: "Step 2 — Exchange rates" });
    contentEl.createEl("p", {
      text: "Set your exchange rates so Ledgr converts correctly.",
      cls: "ledgr-onboarding-sub",
    });

    const base = this.plugin.settings.baseCurrency;
    const secondaries = this.plugin.settings.secondaryCurrencies;

    if (secondaries.length > 0) {
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
    } else {
      contentEl.createEl("p", {
        text: `Using ${base} only. You can add secondary currencies in Settings later.`,
        cls: "setting-item-description",
      });
    }

    contentEl.createEl("p", {
      text: "You can update rates anytime from the Settings button on the dashboard.",
      cls: "setting-item-description",
    });

    this.addBackBtn();
    this.addNextBtn("Next →");
  }

  renderStep3() {
    const { contentEl } = this;

    contentEl.createEl("h2", { text: "Step 3 — What do you want to do first?" });
    contentEl.createEl("p", {
      text: "Choose the path that fits your situation right now.",
      cls: "ledgr-onboarding-sub",
    });

    // Path selector cards
    const pathRow = contentEl.createDiv("ledgr-onboarding-path-row");

    const makePathCard = (pathKey: OnboardingPath, title: string, desc: string) => {
      const card = pathRow.createDiv(`ledgr-onboarding-path-card${this.path === pathKey ? " active" : ""}`);
      card.setAttribute("role", "radio");
      card.setAttribute("tabindex", "0");
      card.setAttribute("aria-checked", String(this.path === pathKey));
      card.setAttribute("aria-label", title);
      card.createDiv({ text: title, cls: "ledgr-onboarding-path-title" });
      card.createDiv({ text: desc, cls: "ledgr-onboarding-path-desc" });
      const select = () => { this.path = pathKey; this.render(); };
      card.onclick = select;
      card.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(); } };
      return card;
    };

    makePathCard("spending", "Track my spending", "Log daily expenses and income, set budgets, watch your savings rate.");
    makePathCard("obligations", "Manage monthly obligations", "Enter your bills, loans, and recurring payments. See what's due each week.");

    this.addBackBtn();

    if (this.path === "spending") {
      const doneBtn = contentEl.createEl("button", {
        text: "Start logging →",
        cls: "ledgr-log-btn mod-cta ledgr-onboarding-cta",
      });
      doneBtn.onclick = async () => {
        this.close();
        const { QuickCaptureModal } = await import("./QuickCaptureModal");
        new QuickCaptureModal(this.app, this.plugin.settings).open();
      };
    } else {
      const doneBtn = contentEl.createEl("button", {
        text: "Set up my obligations →",
        cls: "ledgr-log-btn mod-cta ledgr-onboarding-cta",
      });
      doneBtn.onclick = async () => {
        this.close();
        // Open bulk obligations entry, then land on Calendar
        const { BulkObligationsModal } = await import("./BulkObligationsModal");
        new BulkObligationsModal(this.app, this.plugin, async () => {
          await this.plugin.openView("ledgr-dashboard");
        }).open();
      };
    }
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
