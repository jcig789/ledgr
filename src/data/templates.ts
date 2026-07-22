import { App, TFile, normalizePath } from "obsidian";
import { LedgrSettings } from "../settings";
import { CashFlowStream } from "./transactions";

export interface TransactionTemplate {
  id: string;
  name: string;
  type: "expense" | "income";
  amount: number;
  currency: string;
  category: string;
  subcategory: string;
  stream: CashFlowStream;
  note: string;
}

export interface TemplateStore {
  templates: TransactionTemplate[];
}

const EMPTY: TemplateStore = { templates: [] };

export async function loadTemplates(app: App, settings: LedgrSettings): Promise<TemplateStore> {
  const filePath = normalizePath(`${settings.financeFolder}/ledgr-templates.json`);
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) return { ...EMPTY };
  try {
    const data = JSON.parse(await app.vault.read(file)) as TemplateStore;
    if (!data.templates) data.templates = [];
    return data;
  } catch {
    return { ...EMPTY };
  }
}

export async function saveTemplates(app: App, settings: LedgrSettings, store: TemplateStore): Promise<void> {
  const filePath = normalizePath(`${settings.financeFolder}/ledgr-templates.json`);
  const file = app.vault.getAbstractFileByPath(filePath);
  const content = JSON.stringify(store, null, 2);
  if (file instanceof TFile) {
    await app.vault.modify(file, content);
  } else {
    await app.vault.create(filePath, content);
  }
}
