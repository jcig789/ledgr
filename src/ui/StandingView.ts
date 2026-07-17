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

      // ── Card section ──
      const cardSection = contentEl.createDiv("ledgr-bearing-card-section");

      if (!this.result.hasEnoughData) {
        this.renderEmptyState(cardSection);
      } else {
        // Copy card button
        const cardHeader = cardSection.createDiv("ledgr-bearing-card-header");
        cardHeader.createDiv("ledgr-section-header").createEl("h3", { text: "The Bearing" });
        const copyBtn = cardHeader.createEl("button", { text: "Copy Card", cls: "ledgr-budget-btn" });
        copyBtn.onclick = () => void this.copyCardToClipboard();

        this.renderCard(cardSection, this.result);
      }

      if (this.result.hasEnoughData) {
        // ── Pillars ──
        this.renderPillars(contentEl, this.result.pillars);

        // ── Trend ──
        this.renderTrend(contentEl, history.history);

        // ── Guidance ──
        this.renderGuidance(contentEl, this.result.pillars);
      }
    } finally {
      this.isRendering = false;
    }
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
    const hdr = card.createDiv("ledgr-bearing-card-hdr");
    hdr.createSpan({ text: "L E D G R", cls: "ledgr-bearing-wordmark" });

    // Thin rule
    card.createDiv("ledgr-bearing-rule-thin");

    // Metric name
    card.createDiv("ledgr-bearing-metric-name").createSpan({ text: "T H E  B E A R I N G" });

    // Seal
    const sealWrap = card.createDiv("ledgr-bearing-seal-wrap");
    renderAssaySeal(sealWrap, 72);

    // Thin rule
    card.createDiv("ledgr-bearing-rule-thin");

    // Tier
    card.createDiv("ledgr-bearing-tier").createSpan({
      text: result.tier.toUpperCase().split("").join(" "),
      cls: "ledgr-bearing-tier-label",
    });

    // Grade
    card.createDiv("ledgr-bearing-grade").createSpan({
      text: `C L A S S   ${result.grade}`,
      cls: "ledgr-bearing-grade-label",
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

    // Show pillar stubs
    const pillarsEl = parent.createDiv("ledgr-bearing-section");
    pillarsEl.createDiv("ledgr-bearing-section-label").createSpan({ text: "P I L L A R S" });
    ["Discipline", "Ballast", "Provision", "Composure", "Momentum", "Reserve"].forEach((name) => {
      const row = pillarsEl.createDiv("ledgr-bearing-pillar-row");
      row.createSpan({ text: name, cls: "ledgr-bearing-pillar-name" });
      row.createDiv("ledgr-bearing-pillar-bar-wrap").createDiv("ledgr-bearing-pillar-bar-empty");
      row.createSpan({ text: "Insufficient data", cls: "ledgr-bearing-pillar-status ledgr-empty" });
    });
  }

  // ── Pillars ───────────────────────────────────────────────────────────────

  renderPillars(parent: HTMLElement, pillars: PillarResult[]) {
    const section = parent.createDiv("ledgr-bearing-section");
    section.createDiv("ledgr-bearing-section-label").createSpan({ text: "P I L L A R S" });

    pillars.forEach((p) => {
      const row = section.createDiv("ledgr-bearing-pillar-row");
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

      const statusCls = !p.hasData ? "ledgr-empty"
        : p.label === "Strong" ? "ledgr-bearing-strong"
        : p.label === "Moderate" ? "ledgr-bearing-moderate"
        : "ledgr-bearing-developing";
      row.createSpan({ text: p.hasData ? p.label : "Insufficient data", cls: `ledgr-bearing-pillar-status ${statusCls}` });
    });
  }

  // ── Trend ─────────────────────────────────────────────────────────────────

  renderTrend(parent: HTMLElement, history: Record<string, number>) {
    const entries = Object.entries(history).sort((a, b) => a[0].localeCompare(b[0])).slice(-6);
    if (entries.length < 2) return;

    const section = parent.createDiv("ledgr-bearing-section");
    section.createDiv("ledgr-bearing-section-label").createSpan({ text: "T R E N D" });

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
    const weak = withData.slice(0, 2);
    if (weak.length === 0) return;

    const section = parent.createDiv("ledgr-bearing-section");
    section.createDiv("ledgr-bearing-section-label").createSpan({ text: "G U I D A N C E" });

    const guidanceMap: Record<string, { text: string; tab?: string }> = {
      Discipline: { text: "Your spending has exceeded budget in some categories. Review your category limits to bring Discipline into alignment.", tab: "ledgr-dashboard" },
      Ballast:    { text: "Your liabilities are elevated relative to your assets. Reducing outstanding balances will improve your Ballast over time.", tab: "ledgr-networth" },
      Provision:  { text: "Your savings goals have room for progress. Link accounts to goals and review deadlines to sharpen your Provision score.", tab: "ledgr-networth" },
      Composure:  { text: "Your spending shows notable variation month to month. Smoothing discretionary expenses will strengthen Composure.", tab: "ledgr-dashboard" },
      Momentum:   { text: "Your net worth trend has been flat or declining. Consistent saving and liability reduction will improve Momentum.", tab: "ledgr-networth" },
      Reserve:    { text: "Your liquid reserves cover less than three months of expenses. Building this buffer is a foundational step.", tab: "ledgr-networth" },
    };

    weak.forEach((p) => {
      const g = guidanceMap[p.name];
      if (!g) return;
      const item = section.createDiv("ledgr-bearing-guidance-item");
      item.createSpan({ text: p.name, cls: "ledgr-bearing-guidance-pillar" });
      item.createEl("p", { text: g.text, cls: "ledgr-bearing-guidance-text" });
      if (g.tab) {
        const link = item.createEl("a", { text: `Review in ${p.name === "Discipline" ? "Dashboard" : "Net Worth"} →`, cls: "ledgr-bearing-guidance-link" });
        link.onclick = (e) => { e.preventDefault(); void this.plugin.openView(g.tab!); };
      }
    });

    // Also show notes from pillars (e.g. "Mortgage and all debt types are weighted equally")
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
    const W = 400, H = 520;
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const isDark = document.body.hasClass("theme-dark");
    const bg = isDark ? "#2C2C2C" : "#C8BFA8";
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
    ctx.fillText("L E D G R", W / 2, 70);

    drawThinRule(85);

    // THE BEARING
    ctx.font = "400 11px 'Georgia', serif";
    ctx.letterSpacing = "5px";
    ctx.fillStyle = fgFaint;
    ctx.fillText("T H E  B E A R I N G", W / 2, 110);

    // Draw assay seal (canvas version)
    this.drawSealOnCanvas(ctx, W / 2, 220, 80, fg, fgFaint);

    drawThinRule(295);

    // Tier
    ctx.font = "700 20px 'Georgia', serif";
    ctx.letterSpacing = "5px";
    ctx.fillStyle = fg;
    const tierSpaced = result.tier.toUpperCase().split("").join(" ");
    ctx.fillText(tierSpaced, W / 2, 330);

    // Grade
    ctx.font = "400 11px 'Georgia', serif";
    ctx.letterSpacing = "4px";
    ctx.fillStyle = fgFaint;
    ctx.fillText(`C L A S S   ${result.grade}`, W / 2, 355);

    // Index
    ctx.font = "300 13px 'Georgia', serif";
    ctx.letterSpacing = "2px";
    ctx.fillStyle = fg;
    ctx.fillText(`Index  ·  ${result.score}`, W / 2, 395);

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
