import { App } from "obsidian";
import LedgrPlugin from "../main";
import { DASHBOARD_VIEW_TYPE } from "./DashboardView";
import { NETWORTH_VIEW_TYPE } from "./NetWorthView";
import { STATEMENTS_VIEW_TYPE } from "./StatementsView";
import { QuickCaptureModal } from "./QuickCaptureModal";

export type NavPage = "dashboard" | "networth" | "statements";


export function renderNavBar(
  parent: HTMLElement,
  app: App,
  plugin: LedgrPlugin,
  activePage: NavPage
) {
  const nav = parent.createDiv("ledgr-nav");

  const pages: { key: NavPage; label: string; viewType: string }[] = [
    { key: "dashboard", label: "Dashboard", viewType: DASHBOARD_VIEW_TYPE },
    { key: "networth", label: "Net Worth", viewType: NETWORTH_VIEW_TYPE },
    { key: "statements", label: "Statements", viewType: STATEMENTS_VIEW_TYPE },
  ];

  pages.forEach(({ key, label, viewType }) => {
    const btn = nav.createDiv(`ledgr-nav-btn ${activePage === key ? "active" : ""}`);
    btn.createSpan({ text: label, cls: "ledgr-nav-label" });
    if (activePage !== key) {
      btn.onclick = () => plugin.openView(viewType);
    }
  });

  // Log button — right-aligned
  const logBtn = nav.createDiv("ledgr-nav-btn ledgr-nav-log");
  logBtn.createSpan({ text: "+ Add", cls: "ledgr-nav-label" });
  logBtn.onclick = () => new QuickCaptureModal(app, plugin.settings).open();
}
