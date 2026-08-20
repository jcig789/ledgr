import { App, Modal, Notice, TFile, normalizePath } from "obsidian";
import LedgrPlugin from "../main";

const CURRENT_DATA_VERSION = 2;

// Subcategories that should have FCF stream — if stored as OCF, they need migration
const FCF_SUBCATEGORIES = new Set(["Loan payment", "Mortgage payment"]);

interface AffectedRow {
  filePath: string;
  month: string;
  lineIndex: number;
  preview: string;
}

export class MigrationModal extends Modal {
  plugin: LedgrPlugin;
  private affected: AffectedRow[] = [];
  private scanned = false;
  private fixedCount = -1;  // -1 = not yet fixed

  constructor(app: App, plugin: LedgrPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() { void this.render(); }

  async render() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ledgr-config-modal");

    contentEl.createEl("h2", { text: "Fix Legacy Loan Transactions" });
    contentEl.createEl("p", {
      text: "Before v0.3.3, loan and mortgage payments were saved with the wrong cash flow stream (Operating instead of Financing). This tool finds and fixes those transactions so Cash Flow Health is accurate.",
      cls: "setting-item-description",
    });

    if (!this.scanned) {
      const scanBtn = contentEl.createEl("button", { text: "Scan transactions", cls: "ledgr-log-btn mod-cta" });
      scanBtn.onclick = async () => { await this.scan(); void this.render(); };
      return;
    }

    if (this.fixedCount >= 0) {
      // Post-fix success state
      contentEl.createEl("p", {
        text: this.fixedCount === 0
          ? "No transactions needed fixing. Your data is already correct."
          : `Fixed ${this.fixedCount} transaction${this.fixedCount !== 1 ? "s" : ""}. Cash Flow Health now reflects the correct Financing classification for all loan and mortgage payments.`,
        cls: "ledgr-empty-state",
      });
      const closeBtn = contentEl.createEl("button", { text: "Done", cls: "ledgr-log-btn mod-cta" });
      closeBtn.onclick = () => this.close();
      return;
    }

    if (this.affected.length === 0 && this.scanned) {
      contentEl.createEl("p", { text: "No legacy transactions found. Your data is already up to date.", cls: "ledgr-empty-state" });
      const closeBtn = contentEl.createEl("button", { text: "Close", cls: "ledgr-budget-btn" });
      closeBtn.onclick = () => this.close();
      return;
    }

    contentEl.createEl("p", {
      text: `Found ${this.affected.length} transaction${this.affected.length !== 1 ? "s" : ""} in ${new Set(this.affected.map((r) => r.month)).size} month${new Set(this.affected.map((r) => r.month)).size !== 1 ? "s" : ""} that need fixing:`,
      cls: "ledgr-meta",
    });

    // Preview list (max 10)
    const list = contentEl.createEl("ul", { cls: "ledgr-danger-file-list" });
    this.affected.slice(0, 10).forEach((row) => {
      list.createEl("li", { text: `${row.month}: ${row.preview}` });
    });
    if (this.affected.length > 10) {
      list.createEl("li", { text: `…and ${this.affected.length - 10} more`, cls: "ledgr-meta" });
    }

    contentEl.createDiv("ledgr-bearing-rule-thin");

    const fixBtn = contentEl.createEl("button", { text: `Fix ${this.affected.length} transaction${this.affected.length !== 1 ? "s" : ""}`, cls: "ledgr-log-btn mod-cta" });
    fixBtn.onclick = async () => {
      await this.applyFix();
      void this.render();
    };

    const cancelBtn = contentEl.createEl("button", { text: "Cancel", cls: "ledgr-budget-btn" });
    cancelBtn.onclick = () => this.close();
  }

  async scan() {
    this.affected = [];
    const folder = normalizePath(`${this.plugin.settings.financeFolder}/transactions`);
    const files = this.app.vault.getFiles().filter((f) => f.path.startsWith(folder) && f.extension === "md");

    for (const file of files) {
      const content = await this.app.vault.read(file);
      const lines = content.split("\n");
      const month = file.name.replace(".md", "");

      lines.forEach((line, idx) => {
        if (!line.startsWith("| 20")) return;
        const cols = line.split("|").map((c) => c.trim()).filter(Boolean);
        const subcategory = cols[5];
        const stream = cols[7];
        if (FCF_SUBCATEGORIES.has(subcategory) && stream === "ocf") {
          this.affected.push({
            filePath: file.path,
            month,
            lineIndex: idx,
            preview: `${cols[0]} — ${subcategory} ${cols[2]} ${cols[3]}`,
          });
        }
      });
    }

    this.scanned = true;
  }

  async applyFix() {
    const byFile = new Map<string, number[]>();
    this.affected.forEach((row) => {
      if (!byFile.has(row.filePath)) byFile.set(row.filePath, []);
      byFile.get(row.filePath)!.push(row.lineIndex);
    });

    let fixed = 0;
    for (const [filePath, lineIndices] of byFile) {
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (!(file instanceof TFile)) continue;
      const content = await this.app.vault.read(file);
      const lines = content.split("\n");

      for (const idx of lineIndices) {
        // Fix table row: replace last pipe-delimited field (stream) from ocf to fcf
        lines[idx] = lines[idx].replace(/\|\s*ocf\s*\|?\s*$/, "| fcf |");
        // Fix Dataview line if present
        if (lines[idx + 1]?.startsWith("%%") && lines[idx + 1].includes("[stream:: ocf]")) {
          lines[idx + 1] = lines[idx + 1].replace("[stream:: ocf]", "[stream:: fcf]");
        }
        fixed++;
      }

      await this.app.vault.modify(file, lines.join("\n"));
    }

    // Mark migration complete
    this.plugin.settings.dataVersion = CURRENT_DATA_VERSION;
    await this.plugin.saveSettings();
    this.app.workspace.trigger("ledgr:transaction-saved");

    this.fixedCount = fixed;
    new Notice(`Fixed ${fixed} transaction${fixed !== 1 ? "s" : ""}. Cash Flow History is now accurate.`);
    this.affected = [];
    this.scanned = true;
  }

  onClose() { this.contentEl.empty(); }
}

// Call on plugin load if migration is needed
export function runMigrationIfNeeded(plugin: LedgrPlugin) {
  if ((plugin.settings.dataVersion ?? 0) < CURRENT_DATA_VERSION) {
    // Don't auto-migrate — surface the modal so user is aware
    window.setTimeout(() => {
      new Notice("Ledgr: loan payment history may need a one-time fix. Open ⚙ Settings → Exchange Rates to learn more.", 8000);
    }, 2000);
  }
}
