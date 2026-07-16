import { App, PluginSettingTab, Setting, SettingDefinitionItem } from "obsidian";
import LedgrPlugin from "../main";

export class LedgrSettingTab extends PluginSettingTab {
  plugin: LedgrPlugin;

  constructor(app: App, plugin: LedgrPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [];
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("Your money, both sides of the ocean.").setHeading();

    // Base currency
    new Setting(containerEl)
      .setName("Base currency")
      .setDesc("All reports are denominated in this currency (e.g. JPY, EUR, USD)")
      .addText((t) =>
        t
          .setPlaceholder("JPY")
          .setValue(this.plugin.settings.baseCurrency)
          .onChange(async (v) => {
            this.plugin.settings.baseCurrency = v.toUpperCase().trim();
            await this.plugin.saveSettings();
            this.plugin.app.workspace.trigger("ledgr:settings-changed");
          })
      );

    // Secondary currencies
    new Setting(containerEl)
      .setName("Secondary currencies")
      .setDesc("Shown in the currency toggle, comma-separated (e.g. PHP, USD)")
      .addText((t) =>
        t
          .setPlaceholder("PHP, USD")
          .setValue(this.plugin.settings.secondaryCurrencies.join(", "))
          .onChange(async (v) => {
            this.plugin.settings.secondaryCurrencies = v
              .split(",").map((c) => c.trim().toUpperCase()).filter(Boolean);
            await this.plugin.saveSettings();
            this.plugin.app.workspace.trigger("ledgr:settings-changed");
          })
      );

    new Setting(containerEl).setName("Vault").setHeading();

    new Setting(containerEl)
      .setName("Finance folder")
      .setDesc("Where Ledgr stores your financial data")
      .addText((t) =>
        t
          .setPlaceholder("Private/Finance")
          .setValue(this.plugin.settings.financeFolder)
          .onChange(async (v) => {
            this.plugin.settings.financeFolder = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setName("Daily Notes").setHeading();

    new Setting(containerEl)
      .setName("Append to daily note")
      .setDesc("Automatically append today's spending summary when you log a transaction")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.appendToDailyNote).onChange(async (v) => {
          this.plugin.settings.appendToDailyNote = v;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Daily notes folder")
      .setDesc("Leave blank to use Obsidian's default daily notes folder")
      .addText((t) =>
        t
          .setPlaceholder("Daily Notes")
          .setValue(this.plugin.settings.dailyNotePath)
          .onChange(async (v) => {
            this.plugin.settings.dailyNotePath = v;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl).setName("Transfer Tracker").setHeading();

    new Setting(containerEl)
      .setName("Enable transfer tracker")
      .setDesc("Track international money transfers with fees and exchange rates")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.enableTransferTracker).onChange(async (v) => {
          this.plugin.settings.enableTransferTracker = v;
          await this.plugin.saveSettings();
        })
      );
  }
}
