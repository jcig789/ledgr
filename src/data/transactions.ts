import { App, Notice, TFile, normalizePath } from "obsidian";
import { LedgrSettings } from "../settings";

export interface Transaction {
  date: string;
  type: "expense" | "income";
  amount: number;
  currency: string;
  category: string;
  subcategory: string;
  note: string;
}

export async function saveTransaction(app: App, settings: LedgrSettings, tx: Transaction) {
  const month = tx.date.slice(0, 7); // YYYY-MM
  const folder = normalizePath(`${settings.financeFolder}/transactions`);
  const filePath = normalizePath(`${folder}/${month}.md`);

  if (!app.vault.getAbstractFileByPath(folder)) {
    await app.vault.createFolder(folder);
  }

  // Table row (human-readable, used by Ledgr's own reader)
  const tableRow = `| ${tx.date} | ${tx.type} | ${tx.amount} | ${tx.currency} | ${tx.category} | ${tx.subcategory} | ${tx.note || "-"} |`;

  // Dataview inline fields — appended as a comment line so they don't disrupt table rendering
  // Users can query: TABLE amount, category FROM "Private/Finance/transactions"
  const dvLine = `%%[date:: ${tx.date}] [type:: ${tx.type}] [amount:: ${tx.amount}] [currency:: ${tx.currency}] [category:: ${tx.category}] [subcategory:: ${tx.subcategory}]${tx.note ? ` [note:: ${tx.note}]` : ""}%%`;

  const entry = tableRow + "\n" + dvLine;

  const file = app.vault.getAbstractFileByPath(filePath);

  if (file instanceof TFile) {
    const content = await app.vault.read(file);
    await app.vault.modify(file, content + "\n" + entry);
  } else {
    const header = [
      `# Transactions — ${month}`,
      "",
      `%% Dataview queries: TABLE amount, category FROM "${settings.financeFolder}/transactions" WHERE type = "expense" %%`,
      "",
      "| Date | Type | Amount | Currency | Category | Subcategory | Note |",
      "|------|------|--------|----------|----------|-------------|------|",
      entry,
    ].join("\n");
    await app.vault.create(filePath, header);
  }

  new Notice(`Saved: ${tx.currency} ${tx.amount} — ${tx.subcategory}`);
  app.workspace.trigger("ledgr:transaction-saved");
}
