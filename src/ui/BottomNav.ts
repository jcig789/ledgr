import { setIcon } from "obsidian";
import LedgrPlugin from "../main";
import { DASHBOARD_VIEW_TYPE } from "./DashboardView";
import { NETWORTH_VIEW_TYPE } from "./NetWorthView";
import { STATEMENTS_VIEW_TYPE } from "./StatementsView";
import { QuickCaptureModal } from "./QuickCaptureModal";

export type NavPage = "dashboard" | "networth" | "statements";

const BOTTOM_NAV_ID = "ledgr-bottom-nav";

export function renderBottomNav(
  containerEl: HTMLElement,
  plugin: LedgrPlugin,
  activePage: NavPage
): void {
  containerEl.querySelector(`#${BOTTOM_NAV_ID}`)?.remove();

  const nav = containerEl.createDiv({ attr: { id: BOTTOM_NAV_ID } });
  nav.addClass("ledgr-bottom-nav");

  // Inner wrapper — max-width centered on desktop
  const inner = nav.createDiv("ledgr-bottom-inner");

  const pages: { key: NavPage; label: string; icon: string; viewType: string }[] = [
    { key: "dashboard",  label: "Dashboard",  icon: "layout-dashboard", viewType: DASHBOARD_VIEW_TYPE },
    { key: "networth",   label: "Net Worth",  icon: "trending-up",      viewType: NETWORTH_VIEW_TYPE },
    { key: "statements", label: "Statements", icon: "book-open",         viewType: STATEMENTS_VIEW_TYPE },
  ];

  pages.forEach(({ key, label, icon, viewType }) => {
    const isActive = activePage === key;
    const btn = inner.createDiv(`ledgr-bottom-btn${isActive ? " active" : ""}`);
    btn.setAttribute("aria-label", label);
    btn.setAttribute("role", "button");
    const iconEl = btn.createDiv("ledgr-bottom-icon");
    setIcon(iconEl, icon);
    btn.createSpan({ text: label, cls: "ledgr-bottom-label" });
    if (!isActive) {
      btn.onclick = () => void plugin.openView(viewType);
    }
  });

  // + Add — bordered square, categorically different from nav tabs
  const addBtn = inner.createDiv("ledgr-bottom-add-wrap");
  const addInner = addBtn.createDiv("ledgr-bottom-add-btn");
  addInner.setAttribute("aria-label", "Add transaction");
  addInner.setAttribute("role", "button");
  setIcon(addInner, "plus");
  addBtn.onclick = () => new QuickCaptureModal(plugin.app, plugin.settings).open();
}
