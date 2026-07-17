import { App, TFile, normalizePath } from "obsidian";
import { LedgrSettings } from "../settings";

export interface NwHistory {
  // Key: "YYYY-MM", value: net worth in base currency at time of snapshot
  snapshots: Record<string, number>;
}

const EMPTY: NwHistory = { snapshots: {} };

export async function loadNwHistory(app: App, settings: LedgrSettings): Promise<NwHistory> {
  const filePath = normalizePath(`${settings.financeFolder}/ledgr-nw-history.json`);
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile)) return { ...EMPTY };
  try {
    const data = JSON.parse(await app.vault.read(file)) as NwHistory;
    if (!data.snapshots) data.snapshots = {};
    return data;
  } catch {
    return { ...EMPTY };
  }
}

export async function saveNwHistory(app: App, settings: LedgrSettings, data: NwHistory): Promise<void> {
  const filePath = normalizePath(`${settings.financeFolder}/ledgr-nw-history.json`);
  const file = app.vault.getAbstractFileByPath(filePath);
  const content = JSON.stringify(data, null, 2);
  if (file instanceof TFile) {
    await app.vault.modify(file, content);
  } else {
    await app.vault.create(filePath, content);
  }
}

export async function recordNwSnapshot(
  app: App,
  settings: LedgrSettings,
  netWorthInBase: number
): Promise<void> {
  const month = window.moment().format("YYYY-MM");
  const history = await loadNwHistory(app, settings);
  history.snapshots[month] = Math.round(netWorthInBase);
  await saveNwHistory(app, settings, history);
}
