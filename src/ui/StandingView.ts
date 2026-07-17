import { ItemView, WorkspaceLeaf, Events, Notice } from "obsidian";
import LedgrPlugin from "../main";
import { calculateBearing, loadBearingHistory, saveBearingHistory, BearingResult, PillarResult } from "../data/bearing";
import { renderAssaySeal } from "./charts";

export const STANDING_VIEW_TYPE = "ledgr-standing";

export class StandingView extends ItemView {
  plugin: LedgrPlugin;
  private result: BearingResult | null = null;
  private isRendering = false;

  constructor(leaf: WorkspaceLeaf, plugin: LedgrPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() { return STANDING_VIEW_TYPE; }
  getDisplayText() { return "Standing"; }
  getIcon() { return "shield"; }

  async onOpen() {
    this.containerEl.addClass("ledgr-view-active");
    await this.render();
    this.registerEvent(
      (this.app.workspace as Events).on("ledgr:transaction-saved", async () => { await this.render(); })
    );
    this.registerEvent(
      (this.app.workspace as Events).on("ledgr:networth-updated", async () => { await this.render(); })
    );
  }

  async render() {
    if (this.isRendering) return;
    this.isRendering = true;
    try {
      const { contentEl } = this;
      contentEl.empty();
      contentEl.addClass("ledgr-standing");

      // ── Sticky top zone ──
      const stickyZone = contentEl.createDiv("ledgr-sticky-zone");
      const tabNav = stickyZone.createDiv("ledgr-top-tabs");
      [
        { key: "dashboard",  label: "Dashboard",  viewType: "ledgr-dashboard" },
        { key: "networth",   label: "Net Worth",   viewType: "ledgr-networth" },
        { key: "statements", label: "Statements",  viewType: "ledgr-statements" },
        { key: "standing",   label: "Standing",    viewType: STANDING_VIEW_TYPE },
      ].forEach(({ key, label, viewType }) => {
        const isActive = key === "standing";
        const btn = tabNav.createEl("button", {
          text: label,
          cls: `ledgr-top-tab${isActive ? " active" : ""}`,
        });
        if (!isActive) btn.onclick = () => void this.plugin.openView(viewType);
      });
      // Empty header row keeps sticky zone height consistent with other tabs
      stickyZone.createDiv("ledgr-header");

      // ── Calculate ──
      this.result = await calculateBearing(this.app, this.plugin.settings);

      // Save to history
      const month = window.moment().format("YYYY-MM");
      const history = await loadBearingHistory(this.app, this.plugin.settings);
      if (this.result.hasEnoughData) {
        history.history[month] = this.result.score;
        history.lastCalculated = window.moment().format("YYYY-MM-DD");
        await saveBearingHistory(this.app, this.plugin.settings, history);
      }

      // ── Explainer (T1-1) ──
      this.renderExplainer(contentEl);

      // ── Card section ──
      const cardSection = contentEl.createDiv("ledgr-section");

      if (!this.result.hasEnoughData) {
        this.renderEmptyState(cardSection);
      } else {
        const cardHeader = cardSection.createDiv("ledgr-section-header");
        cardHeader.createEl("h3", { text: "The Bearing" });
        const copyBtn = cardHeader.createEl("button", { text: "Copy Card", cls: "ledgr-budget-btn" });
        copyBtn.onclick = () => void this.copyCardToClipboard();

        this.renderCard(cardSection, this.result);

        // T2-1: Active pillar count + T2-3: Last assessed
        const activePillars = this.result.pillars.filter((p) => p.hasData).length;
        const metaRow = cardSection.createDiv("ledgr-bearing-card-meta");
        metaRow.createSpan({ text: `Scored from ${activePillars} of 6 pillars`, cls: "ledgr-bearing-card-meta-item" });
        if (history.lastCalculated) {
          metaRow.createSpan({ text: "·", cls: "ledgr-bearing-card-meta-sep" });
          metaRow.createSpan({
            text: `Last assessed ${window.moment(history.lastCalculated).format("D MMM YYYY")}`,
            cls: "ledgr-bearing-card-meta-item",
          });
        }
      }

      if (this.result.hasEnoughData) {
        this.renderPillars(contentEl, this.result.pillars);
        this.renderTrend(contentEl, history.history);
        this.renderGuidance(contentEl, this.result.pillars);
      }
    } finally {
      this.isRendering = false;
    }
  }

  // ── Explainer (T1-1) ─────────────────────────────────────────────────────

  renderExplainer(parent: HTMLElement) {
    const collapsed = this.plugin.settings.bearingExplainerCollapsed;
    const wrap = parent.createDiv("ledgr-bearing-explainer");

    const toggle = wrap.createDiv("ledgr-bearing-explainer-toggle");
    const arrow = toggle.createSpan({ text: collapsed ? "▸" : "▾", cls: "ledgr-bearing-explainer-arrow" });
    toggle.createSpan({ text: "About The Bearing", cls: "ledgr-bearing-explainer-title" });

    const body = wrap.createDiv("ledgr-bearing-explainer-body");
    if (collapsed) body.addClass("ledgr-hidden");

    body.createEl("p", {
      text: "The Bearing is a composite financial health index scored from 0 to 100. It reflects your behavior across six pillars — budget discipline, debt posture, savings progress, spending consistency, net worth direction, and liquid reserves. A higher score indicates stronger overall financial footing.",
      cls: "ledgr-bearing-explainer-text",
    });
    body.createEl("p", {
      text: "Pillars without sufficient data are excluded from the calculation; the remaining pillars are renormalized to maintain a 0–100 scale.",
      cls: "ledgr-bearing-explainer-text ledgr-bearing-explainer-note",
    });

    toggle.onclick = async () => {
      this.plugin.settings.bearingExplainerCollapsed = !this.plugin.settings.bearingExplainerCollapsed;
      await this.plugin.saveSettings();
      body.toggleClass("ledgr-hidden", this.plugin.settings.bearingExplainerCollapsed);
      arrow.textContent = this.plugin.settings.bearingExplainerCollapsed ? "▸" : "▾";
    };
  }

  // ── Card ──────────────────────────────────────────────────────────────────

  renderCard(parent: HTMLElement, result: BearingResult) {
    const card = parent.createDiv("ledgr-bearing-card");

    // Corner marks
    card.createDiv("ledgr-bearing-corner ledgr-bearing-corner-tl");
    card.createDiv("ledgr-bearing-corner ledgr-bearing-corner-tr");
    card.createDiv("ledgr-bearing-corner ledgr-bearing-corner-bl");
    card.createDiv("ledgr-bearing-corner ledgr-bearing-corner-br");

    // Top rule
    card.createDiv("ledgr-bearing-rule-double");

    // Header
    card.createDiv("ledgr-bearing-card-hdr").createSpan({ text: "L E D G R", cls: "ledgr-bearing-wordmark" });

    // Thin rule
    card.createDiv("ledgr-bearing-rule-thin");

    // T2-4: Subtitle — shared vocabulary
    card.createDiv("ledgr-bearing-subtitle").createSpan({ text: "Financial Health Index", cls: "ledgr-bearing-subtitle-text" });

    // Metric name
    card.createDiv("ledgr-bearing-metric-name").createSpan({ text: "T H E  B E A R I N G" });

    // Seal
    const sealWrap = card.createDiv("ledgr-bearing-seal-wrap");
    renderAssaySeal(sealWrap, 72);

    // Thin rule
    card.createDiv("ledgr-bearing-rule-thin");

    // Tier (T1-4: CLASS IV removed)
    card.createDiv("ledgr-bearing-tier").createSpan({
      text: result.tier.toUpperCase().split("").join(" "),
      cls: "ledgr-bearing-tier-label",
    });

    // Index
    const indexRow = card.createDiv("ledgr-bearing-index-row");
    indexRow.createSpan({ text: "Index", cls: "ledgr-bearing-index-label" });
    indexRow.createSpan({ text: " · ", cls: "ledgr-bearing-index-sep" });
    indexRow.createSpan({ text: String(result.score), cls: "ledgr-bearing-index-value" });

    // Bottom rule
    card.createDiv("ledgr-bearing-rule-double");
  }

  renderEmptyState(parent: HTMLElement) {
    const empty = parent.createDiv("ledgr-bearing-empty");
    empty.createDiv("ledgr-bearing-rule-double");
    const msg = empty.createDiv("ledgr-bearing-empty-msg");
    msg.createEl("p", { text: "The Bearing is not yet established." });
    msg.createEl("p", {
      text: "Continue recording transactions to receive your first assessment.",
      cls: "ledgr-empty",
    });
    empty.createDiv("ledgr-bearing-rule-double");

    // Show pillar stubs with setup notes
    const pillarsEl = parent.createDiv("ledgr-section");
    pillarsEl.createDiv("ledgr-section-header").createEl("h3", { text: "Pillars" });
    const stubNotes: Record<string, string> = {
      Discipline: "Set budgets to measure discipline.",
      Ballast:    "Add accounts and liabilities to measure leverage.",
      Provision:  "Add savings goals to measure provision.",
      Composure:  "Building history — need at least 2 months.",
      Momentum:   "Building history — need at least 2 months.",
      Reserve:    "Add expense data to measure reserve.",
    };
    Object.entries(stubNotes).forEach(([name, note]) => {
      const row = pillarsEl.createDiv("ledgr-bearing-pillar-row ledgr-bearing-pillar-row-inactive");
      row.createSpan({ text: name, cls: "ledgr-bearing-pillar-name" });
      row.createDiv("ledgr-bearing-pillar-bar-wrap").createDiv("ledgr-bearing-pillar-bar-empty");
      const ctaWrap = row.createDiv("ledgr-bearing-pillar-cta");
      ctaWrap.createSpan({ text: note, cls: "ledgr-bearing-pillar-cta-text" });
    });
  }

  // ── Pillars ───────────────────────────────────────────────────────────────

  renderPillars(parent: HTMLElement, pillars: PillarResult[]) {
    const section = parent.createDiv("ledgr-section");
    section.createDiv("ledgr-section-header").createEl("h3", { text: "Pillars" });

    pillars.forEach((p) => {
      const row = section.createDiv(`ledgr-bearing-pillar-row${p.hasData ? "" : " ledgr-bearing-pillar-row-inactive"}`);
      row.createSpan({ text: p.name, cls: "ledgr-bearing-pillar-name" });

      const barWrap = row.createDiv("ledgr-bearing-pillar-bar-wrap");
      if (p.hasData) {
        const pct = p.max > 0 ? Math.round((p.score / p.max) * 100) : 0;
        const bar = barWrap.createDiv("ledgr-bearing-pillar-bar");
        bar.setCssStyles({ width: "0%" });
        window.requestAnimationFrame(() => { bar.setCssStyles({ width: `${pct}%` }); });
      } else {
        barWrap.createDiv("ledgr-bearing-pillar-bar-empty");
      }

      if (p.hasData) {
        const statusCls = p.label === "Strong" ? "ledgr-bearing-strong"
          : p.label === "Moderate" ? "ledgr-bearing-moderate"
          : "ledgr-bearing-developing";
        row.createSpan({ text: p.label, cls: `ledgr-bearing-pillar-status ${statusCls}` });
      } else {
        // T1-3: CTA on insufficient data rows
        const ctaWrap = row.createDiv("ledgr-bearing-pillar-cta");
        if (p.note) {
          ctaWrap.createSpan({ text: p.note, cls: "ledgr-bearing-pillar-cta-text" });
        } else {
          ctaWrap.createSpan({ text: "Insufficient data", cls: "ledgr-empty" });
        }
      }
    });
  }

  // ── Trend ─────────────────────────────────────────────────────────────────

  renderTrend(parent: HTMLElement, history: Record<string, number>) {
    const entries = Object.entries(history).sort((a, b) => a[0].localeCompare(b[0])).slice(-6);
    if (entries.length < 2) return;

    const section = parent.createDiv("ledgr-section");
    section.createDiv("ledgr-section-header").createEl("h3", { text: "Trend" });

    const labels = entries.map(([m]) => window.moment(m).format("MMM"));
    const values = entries.map(([, v]) => v);

    // Simple dot chart using SVG
    const svgH = 60;
    const svgW = 280;
    const padL = 24, padR = 8, padT = 8, padB = 16;
    const chartW = svgW - padL - padR;
    const chartH = svgH - padT - padB;

    const svg = section.createSvg("svg", {
      attr: { viewBox: `0 0 ${svgW} ${svgH}`, class: "ledgr-bearing-trend-svg" },
    });

    // Y axis labels (0, 50, 100)
    [0, 50, 100].forEach((v) => {
      const y = padT + chartH - (v / 100) * chartH;
      svg.createSvg("text", {
        attr: { x: String(padL - 4), y: String(y + 3), "text-anchor": "end", class: "ledgr-bearing-trend-axis" },
      }).textContent = String(v);
      svg.createSvg("line", {
        attr: { x1: String(padL), y1: String(y), x2: String(padL + chartW), y2: String(y), stroke: "currentColor", "stroke-width": "0.3", opacity: "0.2" },
      });
    });

    // X labels
    entries.forEach(([, ], i) => {
      const x = padL + (i / (entries.length - 1)) * chartW;
      svg.createSvg("text", {
        attr: { x: String(x), y: String(svgH - 2), "text-anchor": "middle", class: "ledgr-bearing-trend-axis" },
      }).textContent = labels[i];
    });

    // Connect dots with lines
    for (let i = 1; i < entries.length; i++) {
      const x1 = padL + ((i - 1) / (entries.length - 1)) * chartW;
      const y1 = padT + chartH - (values[i - 1] / 100) * chartH;
      const x2 = padL + (i / (entries.length - 1)) * chartW;
      const y2 = padT + chartH - (values[i] / 100) * chartH;
      svg.createSvg("line", {
        attr: { x1: String(x1), y1: String(y1), x2: String(x2), y2: String(y2), stroke: "currentColor", "stroke-width": "0.8", opacity: "0.4" },
      });
    }

    // Dots
    entries.forEach(([, v], i) => {
      const x = padL + (i / (entries.length - 1)) * chartW;
      const y = padT + chartH - (v / 100) * chartH;
      svg.createSvg("circle", {
        attr: { cx: String(x), cy: String(y), r: "3", fill: "currentColor", class: "ledgr-bearing-trend-dot" },
      });
    });
  }

  // ── Guidance ──────────────────────────────────────────────────────────────

  renderGuidance(parent: HTMLElement, pillars: PillarResult[]) {
    const withData = pillars.filter((p) => p.hasData).sort((a, b) => (a.score / a.max) - (b.score / b.max));
    const missing = pillars.filter((p) => !p.hasData && p.note);
    const weak = withData.slice(0, 2);

    if (weak.length === 0 && missing.length === 0) return;

    const section = parent.createDiv("ledgr-section");
    section.createDiv("ledgr-section-header").createEl("h3", { text: "Guidance" });

    const guidanceMap: Record<string, { text: string; tab: string; tabLabel: string }> = {
      Discipline: { text: "Your spending has exceeded budget in some categories. Review your category limits to bring Discipline into alignment.", tab: "ledgr-dashboard", tabLabel: "Dashboard" },
      Ballast:    { text: "Your liabilities are elevated relative to your assets. Reducing outstanding balances will improve your Ballast over time.", tab: "ledgr-networth", tabLabel: "Net Worth" },
      Provision:  { text: "Your savings goals have room for progress. Link accounts to goals and review deadlines to sharpen your Provision score.", tab: "ledgr-networth", tabLabel: "Net Worth" },
      Composure:  { text: "Your spending shows notable variation month to month. Smoothing discretionary expenses will strengthen Composure.", tab: "ledgr-dashboard", tabLabel: "Dashboard" },
      Momentum:   { text: "Your net worth trend has been flat or declining. Consistent saving and liability reduction will improve Momentum.", tab: "ledgr-networth", tabLabel: "Net Worth" },
      Reserve:    { text: "Your liquid reserves cover less than three months of expenses. Building this buffer is a foundational step.", tab: "ledgr-networth", tabLabel: "Net Worth" },
    };

    // T2-2: Weak active pillars with gap numbers
    weak.forEach((p) => {
      const g = guidanceMap[p.name];
      if (!g) return;
      const item = section.createDiv("ledgr-bearing-guidance-item");
      item.createSpan({ text: p.name, cls: "ledgr-bearing-guidance-pillar" });
      // Gap as % of pillar ceiling — raw points are uninterpretable after renormalization
      const pctOfCeiling = p.max > 0 ? Math.round((p.score / p.max) * 100) : 0;
      const gapPct = 100 - pctOfCeiling;
      if (gapPct > 0) {
        item.createEl("p", {
          text: `${p.name} is at ${pctOfCeiling}% of its ceiling — ${gapPct}% of potential remaining.`,
          cls: "ledgr-bearing-guidance-gap",
        });
      }
      item.createEl("p", { text: g.text, cls: "ledgr-bearing-guidance-text" });
      const link = item.createEl("a", { text: `Review in ${g.tabLabel} →`, cls: "ledgr-bearing-guidance-link" });
      link.onclick = (e) => { e.preventDefault(); void this.plugin.openView(g.tab); };
    });

    // T1-3: Setup items for pillars with no data
    if (missing.length > 0) {
      const setupWrap = section.createDiv("ledgr-bearing-setup-section");
      setupWrap.createDiv("ledgr-bearing-setup-label").createSpan({ text: "To activate more pillars:" });
      missing.forEach((p) => {
        const item = setupWrap.createDiv("ledgr-bearing-setup-item");
        item.createSpan({ text: p.name, cls: "ledgr-bearing-guidance-pillar" });
        item.createEl("p", { text: p.note ?? "", cls: "ledgr-bearing-guidance-text" });
      });
    }

    // Notes (e.g. "Mortgage and all debt types are weighted equally")
    const notes = pillars.filter((p) => p.hasData && p.note);
    if (notes.length > 0) {
      const noteWrap = section.createDiv("ledgr-bearing-notes");
      notes.forEach((p) => {
        noteWrap.createEl("p", { text: `${p.name}: ${p.note}`, cls: "ledgr-bearing-note" });
      });
    }
  }

  // ── Copy card to clipboard ────────────────────────────────────────────────

  async copyCardToClipboard() {
    if (!this.result?.hasEnoughData) return;
    const result = this.result;

    // Render card to canvas
    const canvas = document.createElement("canvas");
    const W = 400, H = 500;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const isDark = document.body.hasClass("theme-dark");
    const bg = isDark ? "#2C2C2C" : "#F0E8D8";
    const fg = isDark ? "#C8BFA8" : "#2C2C2C";
    const fgFaint = isDark ? "rgba(200,191,168,0.45)" : "rgba(44,44,44,0.45)";

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Corner marks (L-shaped)
    ctx.strokeStyle = fg;
    ctx.lineWidth = 1;
    const cm = 12, cl = 18;
    [[cm, cm], [W - cm, cm], [cm, H - cm], [W - cm, H - cm]].forEach(([x, y], i) => {
      ctx.beginPath();
      const dx = i % 2 === 0 ? 1 : -1;
      const dy = i < 2 ? 1 : -1;
      ctx.moveTo(x + dx * cl, y); ctx.lineTo(x, y); ctx.lineTo(x, y + dy * cl);
      ctx.stroke();
    });

    // Double rules
    const drawDoubleRule = (y: number) => {
      ctx.strokeStyle = fg;
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(30, y); ctx.lineTo(W - 30, y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(30, y + 3); ctx.lineTo(W - 30, y + 3); ctx.stroke();
    };
    drawDoubleRule(40);
    drawDoubleRule(H - 44);

    // Thin rules
    const drawThinRule = (y: number) => {
      ctx.strokeStyle = fgFaint;
      ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(40, y); ctx.lineTo(W - 40, y); ctx.stroke();
    };

    // LEDGR wordmark
    ctx.fillStyle = fg;
    ctx.font = "600 13px 'Georgia', serif";
    ctx.letterSpacing = "6px";
    ctx.textAlign = "center";
    ctx.fillText("L E D G R", W / 2, 68);

    drawThinRule(82);

    // T2-4: Financial Health Index subtitle
    ctx.font = "300 9px 'Georgia', serif";
    ctx.letterSpacing = "3px";
    ctx.fillStyle = fgFaint;
    ctx.fillText("Financial Health Index", W / 2, 100);

    // THE BEARING
    ctx.font = "400 10px 'Georgia', serif";
    ctx.letterSpacing = "5px";
    ctx.fillStyle = fgFaint;
    ctx.fillText("T H E  B E A R I N G", W / 2, 118);

    // Draw assay seal (canvas version)
    this.drawSealOnCanvas(ctx, W / 2, 215, 80, fg, fgFaint);

    drawThinRule(282);

    // Tier (T1-4: CLASS IV removed)
    ctx.font = "700 20px 'Georgia', serif";
    ctx.letterSpacing = "5px";
    ctx.fillStyle = fg;
    const tierSpaced = result.tier.toUpperCase().split("").join(" ");
    ctx.fillText(tierSpaced, W / 2, 318);

    // Index
    ctx.font = "300 13px 'Georgia', serif";
    ctx.letterSpacing = "2px";
    ctx.fillStyle = fg;
    ctx.fillText(`Index  ·  ${result.score}`, W / 2, 350);

    try {
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        new Notice("Bearing card copied to clipboard.");
      });
    } catch {
      new Notice("Could not copy to clipboard — try a different browser.");
    }
  }

  drawSealOnCanvas(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, fg: string, faint: string) {
    const s = size / 80;
    ctx.strokeStyle = fg;
    ctx.fillStyle = fg;

    // Outer ring
    ctx.lineWidth = 0.75 * s;
    ctx.beginPath(); ctx.arc(cx, cy, 38 * s, 0, Math.PI * 2); ctx.stroke();

    // Inner ring
    ctx.beginPath(); ctx.arc(cx, cy, 32 * s, 0, Math.PI * 2); ctx.stroke();

    // Octagon
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI / 4) * i + (Math.PI / 8);
      const x = cx + 28 * s * Math.cos(angle);
      const y = cy + 28 * s * Math.sin(angle);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.stroke();

    // Cross + diagonal lines
    ctx.lineWidth = 0.5 * s;
    ctx.strokeStyle = faint;
    const lineR = 28 * s;
    [[cx - lineR, cy, cx + lineR, cy], [cx, cy - lineR, cx, cy + lineR]].forEach(([x1, y1, x2, y2]) => {
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    });
    const diagR = lineR * Math.cos(Math.PI / 4);
    [[cx - diagR, cy - diagR, cx + diagR, cy + diagR], [cx + diagR, cy - diagR, cx - diagR, cy + diagR]].forEach(([x1, y1, x2, y2]) => {
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    });

    // Center dot
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.arc(cx, cy, 1.5 * s, 0, Math.PI * 2); ctx.fill();

    // Cardinal diamonds
    const dR = 17 * s;
    const dH = 2.2 * s;
    [[cx + dR, cy], [cx - dR, cy], [cx, cy + dR], [cx, cy - dR]].forEach(([dx, dy]) => {
      ctx.beginPath();
      ctx.moveTo(dx, dy - dH); ctx.lineTo(dx + dH, dy);
      ctx.lineTo(dx, dy + dH); ctx.lineTo(dx - dH, dy);
      ctx.closePath(); ctx.fill();
    });

    // Inner hexagon
    ctx.strokeStyle = faint;
    ctx.lineWidth = 0.5 * s;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i;
      const x = cx + 8 * s * Math.cos(angle);
      const y = cy + 8 * s * Math.sin(angle);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.stroke();
  }

  async onClose() {
    this.containerEl.removeClass("ledgr-view-active");
    this.contentEl.empty();
  }
}
