/**
 * Ledgr Chart System — Old Money Edition
 *
 * Pure SVG + DOM. No external libraries. No Canvas. No D3.
 * All colours reference the CSS custom properties defined in styles.css.
 *
 * Exports:
 *   renderDonutChart(parent, segments, centerLabel)
 *   renderCompositionBar(parent, segments)
 *   renderSparkline(parent, values)
 *   CATEGORY_COLORS  — ordered palette token names for 11 categories
 */


// ─── Category color palette ───────────────────────────────────────────────────
// Maps category names (as used in CATEGORIES constant) to their CSS token.
// Falls back to cycling through tokens for unknown categories.

export const CATEGORY_COLORS: Record<string, string> = {
  "Food & Drink":  "var(--ledgr-cat-1)",
  "Transport":     "var(--ledgr-cat-2)",
  "Housing":       "var(--ledgr-cat-3)",
  "Health":        "var(--ledgr-cat-4)",
  "Personal Care": "var(--ledgr-cat-5)",
  "Entertainment": "var(--ledgr-cat-6)",
  "Social":        "var(--ledgr-cat-7)",
  "Travel":        "var(--ledgr-cat-8)",
  "Subscriptions": "var(--ledgr-cat-9)",
  "Family":        "var(--ledgr-cat-10)",
  "Other":         "var(--ledgr-accent-muted)",
};

// Ordered fallback pool for unknown categories
const CAT_TOKEN_POOL = [
  "var(--ledgr-cat-1)",
  "var(--ledgr-cat-2)",
  "var(--ledgr-cat-3)",
  "var(--ledgr-cat-4)",
  "var(--ledgr-cat-5)",
  "var(--ledgr-cat-6)",
  "var(--ledgr-cat-7)",
  "var(--ledgr-cat-8)",
  "var(--ledgr-cat-9)",
  "var(--ledgr-cat-10)",
];

export function categoryColor(name: string, index = 0): string {
  return CATEGORY_COLORS[name] ?? CAT_TOKEN_POOL[index % CAT_TOKEN_POOL.length];
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChartSegment {
  label: string;
  value: number;
  /** CSS color string: hex, rgba, or var(--token). Optional — auto-assigned if absent. */
  color?: string;
  /** Optional pre-formatted display string for the legend (e.g. "¥12,000") */
  displayValue?: string;
}

// ─── renderDonutChart ─────────────────────────────────────────────────────────
/**
 * Renders a donut/ring chart into `parent`.
 *
 * Layout:
 *   .ledgr-ring-row
 *     .ledgr-donut-frame  (SVG ring with center label)
 *     .ledgr-donut-legend (swatch + label + amount per segment)
 *
 * @param parent      Container element. Will be emptied then filled.
 * @param segments    Data array. Values are raw numbers; percentages are computed internally.
 * @param centerLabel Short string shown below the center value (e.g. "savings rate" or "total").
 *                    Pass an empty string to suppress it.
 * @param centerValue Override the center's main value line. Defaults to the sum of all segments
 *                    formatted as a percentage when all values sum to ≤100 (savings-rate mode),
 *                    or as a formatted integer otherwise. Pass an explicit string to override.
 */
export function renderDonutChart(
  parent: HTMLElement,
  segments: ChartSegment[],
  centerLabel: string,
  centerValue?: string,
): void {
  parent.empty();

  // Filter zero-value segments — they produce invisible arcs and confuse stroke-dasharray math
  const nonZero = segments.filter((s) => s.value > 0);
  if (nonZero.length === 0) {
    parent.createEl("p", { text: "No data", cls: "ledgr-empty" });
    return;
  }

  const total = nonZero.reduce((sum, s) => sum + s.value, 0);

  // ── Geometry ──
  // viewBox is 100×100. Center at (50,50). We draw on a circle of radius R.
  // circumference = 2πR. stroke-width 18 on R=36 leaves a visible inner hole.
  const R = 36;
  const C = 2 * Math.PI * R; // circumference ≈ 226.2

  // ── Outer wrapper row ──
  const row = parent.createDiv("ledgr-ring-row");

  // ── Donut frame ──
  const frame = row.createDiv("ledgr-donut-frame");

  // SVG element
  const svg = frame.createSvg("svg", {
    attr: { viewBox: "0 0 100 100", "aria-hidden": "true" },
    cls: "ledgr-donut-svg",
  });

  // Track ring (background circle)
  svg.createSvg("circle", {
    attr: { cx: "50", cy: "50", r: String(R) },
    cls: "ledgr-donut-track",
  });

  // Segments — rendered as stroke-dasharray arcs
  // Each arc: dasharray = [arcLength, circumference - arcLength]
  // dashoffset = -sumOfPreviousArcs (to position correctly around the circle)
  let offset = 0;

  nonZero.forEach((seg, i) => {
    const arcLen = (seg.value / total) * C;
    const color = seg.color ?? categoryColor(seg.label, i);

    const circle = svg.createSvg("circle", {
      attr: {
        cx: "50",
        cy: "50",
        r: String(R),
        stroke: color,
        "stroke-dasharray": `${arcLen} ${C - arcLen}`,
        // stroke-dashoffset shifts the starting point. We subtract from C because
        // the SVG is rotated -90deg (via CSS class), so we run clockwise from top.
        "stroke-dashoffset": String(-offset),
      },
      cls: "ledgr-donut-arc",
    });

    // Tooltip via title element
    const pct = Math.round((seg.value / total) * 100);
    const titleEl = circle.createSvg("title");
    titleEl.textContent = `${seg.label}: ${seg.displayValue ?? seg.value.toLocaleString()} (${pct}%)`;

    offset += arcLen;
  });

  // ── Center label overlay ──
  const center = frame.createDiv("ledgr-donut-center");
  const displayCenter = centerValue ?? formatCenterValue(total, nonZero, segments);
  center.createSpan({ text: displayCenter, cls: "ledgr-donut-center-value" });
  if (centerLabel) {
    center.createSpan({ text: centerLabel, cls: "ledgr-donut-center-label" });
  }

  // ── Legend ──
  const legend = row.createDiv("ledgr-donut-legend");
  nonZero.forEach((seg, i) => {
    const color = seg.color ?? categoryColor(seg.label, i);
    const pct = Math.round((seg.value / total) * 100);
    const item = legend.createDiv("ledgr-legend-item");

    const swatch = item.createSpan({ cls: "ledgr-legend-swatch" });
    swatch.style.backgroundColor = color; // dynamic value — cannot use static CSS class

    item.createSpan({ text: seg.label, cls: "ledgr-legend-label" });
    item.createSpan({
      text: seg.displayValue ?? `${pct}%`,
      cls: "ledgr-legend-amt",
    });
  });
}

/**
 * Determine what to show in the center of the donut.
 *
 * - If there's exactly one segment that looks like a savings-rate value (0–100),
 *   show it as a percentage.
 * - Otherwise show the total formatted with commas.
 */
function formatCenterValue(
  total: number,
  nonZero: ChartSegment[],
  _original: ChartSegment[],
): string {
  // Savings-rate mode: single value 0–100 with displayValue already set
  if (nonZero.length === 1 && nonZero[0].displayValue) {
    return nonZero[0].displayValue;
  }
  // Default: total with thousands separator
  return Math.round(total).toLocaleString();
}

// ─── renderCompositionBar ─────────────────────────────────────────────────────
/**
 * Renders a horizontal segmented composition bar into `parent`.
 *
 * Intended for net worth breakdown: bank / investments / liabilities.
 * Segments are sized proportional to their value relative to the total.
 *
 * Layout:
 *   .ledgr-comp-bar-wrap
 *     .ledgr-comp-bar   (the visual bar)
 *     .ledgr-comp-bar-legend  (inline swatches)
 *
 * @param parent    Container element. Will be emptied.
 * @param segments  Data array. Negative values are treated as absolute (liabilities).
 */
export function renderCompositionBar(
  parent: HTMLElement,
  segments: ChartSegment[],
): void {
  parent.empty();

  const nonZero = segments.filter((s) => s.value !== 0);
  if (nonZero.length === 0) {
    parent.createEl("p", { text: "No data", cls: "ledgr-empty" });
    return;
  }

  const total = nonZero.reduce((sum, s) => sum + Math.abs(s.value), 0);
  if (total === 0) {
    parent.createEl("p", { text: "No data", cls: "ledgr-empty" });
    return;
  }

  const wrap = parent.createDiv("ledgr-comp-bar-wrap");
  const bar = wrap.createDiv("ledgr-comp-bar");

  nonZero.forEach((seg, i) => {
    const pct = (Math.abs(seg.value) / total) * 100;
    const color = seg.color ?? categoryColor(seg.label, i);
    const segEl = bar.createDiv("ledgr-comp-seg");
    segEl.style.flexBasis = `${pct}%`; // dynamic value — cannot use static CSS class
    segEl.style.backgroundColor = color; // dynamic value — cannot use static CSS class

    // Tooltip
    segEl.setAttribute("title",
      `${seg.label}: ${seg.displayValue ?? Math.round(Math.abs(seg.value)).toLocaleString()}`
    );
    segEl.setAttribute("aria-label",
      `${seg.label}: ${seg.displayValue ?? Math.round(Math.abs(seg.value)).toLocaleString()}`
    );
  });

  // Legend row beneath bar
  const legendRow = wrap.createDiv("ledgr-comp-bar-legend");
  nonZero.forEach((seg, i) => {
    const color = seg.color ?? categoryColor(seg.label, i);
    const item = legendRow.createDiv("ledgr-comp-legend-item");

    const swatch = item.createSpan({ cls: "ledgr-comp-legend-swatch" });
    swatch.style.backgroundColor = color; // dynamic value — cannot use static CSS class

    item.createSpan({ text: seg.label, cls: "ledgr-comp-legend-label" });
    if (seg.displayValue) {
      item.createSpan({ text: seg.displayValue, cls: "ledgr-comp-legend-amt" });
    }
  });
}

// ─── renderSparkline ──────────────────────────────────────────────────────────
/**
 * Renders a 40×20px SVG sparkline into `parent`.
 *
 * A single polyline path, no axes, no labels. Stroke color reflects trend:
 *   - Rising end vs start  → green
 *   - Falling end vs start → red
 *   - Flat                 → accent-muted
 *
 * @param parent  Container element. A div with class `ledgr-sparkline` is created inside.
 * @param values  Array of numbers (e.g. last 6 months of expenses). Min 2 values required.
 *                Empty or single-value arrays render nothing.
 */
export function renderSparkline(parent: HTMLElement, values: number[]): void {
  parent.empty();

  if (values.length < 2) return;

  const W = 40;
  const H = 20;
  const PAD = 2; // inset so the stroke doesn't clip at the edge

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1; // guard divide-by-zero on flat lines

  // Map each value to (x, y) within [PAD, W-PAD] × [PAD, H-PAD]
  const pts = values.map((v, i) => {
    const x = PAD + ((i / (values.length - 1)) * (W - PAD * 2));
    // Invert Y: SVG y=0 is top, so high values → small y
    const y = PAD + ((1 - (v - min) / range) * (H - PAD * 2));
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  const trend = values[values.length - 1] - values[0];
  const trendClass = trend > 0
    ? "ledgr-spark-up"
    : trend < 0
    ? "ledgr-spark-down"
    : "";

  const wrapper = parent.createDiv("ledgr-sparkline");

  const svg = wrapper.createSvg("svg", {
    attr: { viewBox: `0 0 ${W} ${H}`, "aria-hidden": "true", preserveAspectRatio: "none" },
  });

  svg.createSvg("polyline", {
    attr: { points: pts.join(" ") },
    cls: `ledgr-sparkline-path${trendClass ? ` ${trendClass}` : ""}`,
  });
}

// ─── Convenience: net worth composition segments ──────────────────────────────
/**
 * Build the three standard net worth segments from raw totals.
 * Colors reference the CSS segment tokens defined in styles.css.
 *
 * Returns an array ready for `renderCompositionBar`.
 */
export function buildNetWorthSegments(
  bankAssets: number,
  investAssets: number,
  liabilities: number,
  fmt: (n: number) => string,
): ChartSegment[] {
  const segs: ChartSegment[] = [];

  if (bankAssets > 0) {
    segs.push({
      label: "Bank",
      value: bankAssets,
      color: "var(--ledgr-seg-bank)",
      displayValue: fmt(bankAssets),
    });
  }
  if (investAssets > 0) {
    segs.push({
      label: "Investments",
      value: investAssets,
      color: "var(--ledgr-seg-invest)",
      displayValue: fmt(investAssets),
    });
  }
  if (liabilities > 0) {
    segs.push({
      label: "Liabilities",
      value: liabilities,
      color: "var(--ledgr-seg-liab)",
      displayValue: fmt(liabilities),
    });
  }

  return segs;
}

// ─── Convenience: spending donut segments from byCategory summary ─────────────
/**
 * Build donut segments from the `byCategory` record returned by `summarize()`.
 * Assigns colours in category-name order. Caps at `maxSegments` to avoid clutter —
 * remaining categories are collapsed into an "Other" catch-all.
 *
 * @param byCategory   Record<categoryName, totalAmount>
 * @param fmt          Formatter function (e.g. `(n) => `¥${n.toLocaleString()}`)
 * @param maxSegments  Maximum distinct arcs to show (default 8). Min 3.
 */
export function buildSpendingSegments(
  byCategory: Record<string, number>,
  fmt: (n: number) => string,
  maxSegments = 8,
): ChartSegment[] {
  const cap = Math.max(3, maxSegments);
  const sorted = Object.entries(byCategory)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);

  if (sorted.length === 0) return [];

  const top = sorted.slice(0, cap);
  const rest = sorted.slice(cap);

  const segs: ChartSegment[] = top.map(([label, value], i) => ({
    label,
    value,
    color: categoryColor(label, i),
    displayValue: fmt(value),
  }));

  if (rest.length > 0) {
    const otherTotal = rest.reduce((sum, [, v]) => sum + v, 0);
    segs.push({
      label: "Other",
      value: otherTotal,
      color: "var(--ledgr-accent-muted)",
      displayValue: fmt(otherTotal),
    });
  }

  return segs;
}

// ─── renderGauge ──────────────────────────────────────────────────────────────
/**
 * Circular progress ring for savings rate.
 * Uses stroke-dasharray (same reliable technique as the spending donut).
 */
export function renderGauge(
  parent: HTMLElement,
  value: number,
  label: string,
  opts?: { good?: number; warn?: number },
): void {
  parent.empty();

  const clamped = Math.max(0, Math.min(100, value));
  const good = opts?.good ?? 20;
  const warn = opts?.warn ?? 10;

  const color = clamped >= good
    ? "var(--ledgr-green)"
    : clamped >= warn
    ? "var(--ledgr-cat-8)"
    : "var(--ledgr-red)";

  const R = 30;
  const C = 2 * Math.PI * R;
  const arcLen = (clamped / 100) * C;

  const wrap = parent.createDiv("ledgr-gauge-wrap");

  const svg = wrap.createSvg("svg", {
    attr: { viewBox: "0 0 80 80", "aria-hidden": "true" },
    cls: "ledgr-gauge-svg",
  });

  // Track ring
  svg.createSvg("circle", {
    attr: { cx: "40", cy: "40", r: String(R) },
    cls: "ledgr-gauge-track",
  });

  // Fill ring — stroke-dasharray controls how much is filled
  // rotate -90 so fill starts at the top
  if (clamped > 0) {
    svg.createSvg("circle", {
      attr: {
        cx: "40",
        cy: "40",
        r: String(R),
        stroke: color,
        "stroke-dasharray": `${arcLen} ${C - arcLen}`,
        transform: "rotate(-90 40 40)",
      },
      cls: "ledgr-gauge-fill",
    });
  }

  const center = wrap.createDiv("ledgr-gauge-center");
  center.createSpan({ text: `${Math.round(clamped)}%`, cls: "ledgr-gauge-value" });
  if (label) center.createSpan({ text: label, cls: "ledgr-gauge-label" });
}

// ─── renderTrendLine ─────────────────────────────────────────────────────────
/**
 * Multi-series line chart — monthly trends, minimal axes.
 */
export interface TrendSeries {
  label: string;
  values: number[];
  color?: string;
  dashed?: boolean;
}

export function renderTrendLine(
  parent: HTMLElement,
  series: TrendSeries[],
  labels?: string[],
): void {
  parent.empty();

  if (!series.length || !series[0].values.length) {
    parent.createEl("p", { text: "No data", cls: "ledgr-empty" });
    return;
  }

  const W = 300; const H = 120;
  const PAD = { top: 10, right: 10, bottom: labels ? 20 : 8, left: 36 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const allValues: number[] = series.reduce<number[]>((acc, s) => acc.concat(s.values), []).filter((v) => isFinite(v));
  const minV = Math.min(0, ...allValues);
  const maxV = Math.max(...allValues) || 1;
  const numPoints = Math.max(...series.map((s) => s.values.length));

  const xScale = (i: number) => PAD.left + (i / Math.max(numPoints - 1, 1)) * chartW;
  const yScale = (v: number) => PAD.top + chartH - ((v - minV) / (maxV - minV)) * chartH;

  const defaultColors = [
    "var(--ledgr-accent)",
    "var(--ledgr-cat-3)",
    "var(--ledgr-cat-1)",
    "var(--ledgr-cat-8)",
  ];

  const wrap = parent.createDiv("ledgr-trend-wrap");
  const svg = wrap.createSvg("svg", {
    attr: { viewBox: `0 0 ${W} ${H}`, "aria-hidden": "true" },
    cls: "ledgr-trend-svg",
  });

  // Grid lines
  for (let i = 0; i <= 2; i++) {
    const y = PAD.top + (i / 2) * chartH;
    svg.createSvg("line", {
      attr: {
        x1: String(PAD.left), y1: String(y),
        x2: String(PAD.left + chartW), y2: String(y),
      },
      cls: "ledgr-trend-grid",
    });

    const val = maxV - (i / 2) * (maxV - minV);
    const text = svg.createSvg("text", {
      attr: { x: String(PAD.left - 4), y: String(y + 4), "text-anchor": "end" },
      cls: "ledgr-trend-axis-label",
    });
    text.textContent = val >= 1000 ? `${Math.round(val / 1000)}k` : String(Math.round(val));
  }

  // Series — smooth bezier curves instead of angular polylines
  series.forEach((s, si) => {
    if (!s.values.length) return;
    const color = s.color ?? defaultColors[si % defaultColors.length];

    // Build SVG cubic bezier path for smooth curves
    const points = s.values.map((v, i) => ({ x: xScale(i), y: yScale(v) }));
    let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const dx = (curr.x - prev.x) / 3;
      // Control points offset horizontally for natural flow
      const cp1x = (prev.x + dx).toFixed(1);
      const cp1y = prev.y.toFixed(1);
      const cp2x = (curr.x - dx).toFixed(1);
      const cp2y = curr.y.toFixed(1);
      d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`;
    }

    const pathAttrs: Record<string, string> = { d, stroke: color };
    if (s.dashed) pathAttrs["stroke-dasharray"] = "4 3";
    svg.createSvg("path", { attr: pathAttrs, cls: "ledgr-trend-line" });

    svg.createSvg("circle", {
      attr: {
        cx: String(xScale(s.values.length - 1)),
        cy: String(yScale(s.values[s.values.length - 1])),
        r: "2",
        fill: color,
        stroke: "none",
        opacity: "0.85",
      },
    });
  });

  if (labels) {
    labels.forEach((lbl, i) => {
      const text = svg.createSvg("text", {
        attr: { x: String(xScale(i)), y: String(H - 4), "text-anchor": "middle" },
        cls: "ledgr-trend-axis-label",
      });
      text.textContent = lbl;
    });
  }

  if (series.length > 1) {
    const legend = wrap.createDiv("ledgr-trend-legend");
    series.forEach((s, si) => {
      const color = s.color ?? defaultColors[si % defaultColors.length];
      const item = legend.createDiv("ledgr-trend-legend-item");
      const swatch = item.createSpan({ cls: "ledgr-trend-legend-swatch" });
      swatch.style.backgroundColor = color; // dynamic value — cannot use static CSS class
      if (s.dashed) swatch.addClass("ledgr-trend-legend-swatch-dashed");
      item.createSpan({ text: s.label, cls: "ledgr-trend-legend-label" });
    });
  }
}

// ─── renderBudgetScale ────────────────────────────────────────────────────────
/**
 * Horizontal spectrum scale — where a value falls on a gradient spectrum.
 * Like the 1-8 risk bar in investment apps.
 */
export function renderBudgetScale(
  parent: HTMLElement,
  value: number,
  zones: { left: string; center: string; right: string },
  label?: string,
): void {
  parent.empty();
  const clamped = Math.max(0, Math.min(100, value));
  const wrap = parent.createDiv("ledgr-scale-wrap");
  if (label) wrap.createDiv({ text: label, cls: "ledgr-scale-label" });

  const track = wrap.createDiv("ledgr-scale-track");
  const colors = ["var(--ledgr-green)", "var(--ledgr-cat-9)", "var(--ledgr-cat-8)", "var(--ledgr-red)"];
  colors.forEach((c, i) => {
    const seg = track.createDiv("ledgr-scale-seg");
    seg.setCssStyles({ backgroundColor: c });
    if (i === 0) seg.setCssStyles({ borderRadius: "2px 0 0 2px" });
    if (i === colors.length - 1) seg.setCssStyles({ borderRadius: "0 2px 2px 0" });
  });

  const indicator = wrap.createDiv("ledgr-scale-indicator");
  indicator.style.left = `${clamped}%`; // dynamic value — cannot use static CSS class
  indicator.createDiv("ledgr-scale-arrow");

  const zoneRow = wrap.createDiv("ledgr-scale-zones");
  zoneRow.createSpan({ text: zones.left, cls: "ledgr-scale-zone-label" });
  zoneRow.createSpan({ text: zones.center, cls: "ledgr-scale-zone-label" });
  zoneRow.createSpan({ text: zones.right, cls: "ledgr-scale-zone-label" });
}

// ─── renderNwHistoryChart ─────────────────────────────────────────────────────
/**
 * Net worth history line chart for the Net Worth tab.
 * Uses real monthly snapshots from ledgr-nw-history.json.
 */

export interface NwSnapshot { month: string; value: number; }

function fmtNwAxis(n: number, currency: string): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  const sym = currency === "JPY" ? "¥" : currency === "PHP" ? "₱" : currency === "USD" ? "$" : currency === "EUR" ? "€" : currency + " ";
  if (abs >= 1_000_000_000) return `${sign}${sym}${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000)     return `${sign}${sym}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)         return `${sign}${sym}${Math.round(abs / 1_000)}K`;
  return `${sign}${sym}${Math.round(abs).toLocaleString()}`;
}

function cleanTickInterval(range: number): number {
  const targets = [500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000, 2500000, 5000000];
  const ideal = range / 3;
  return targets.reduce((prev, curr) => Math.abs(curr - ideal) < Math.abs(prev - ideal) ? curr : prev);
}

export function renderNwHistoryChart(
  parent: HTMLElement,
  snapshots: NwSnapshot[],
  currentNw: number,
  currentMonth: string,
  currency: string,
  range: "6M" | "1Y" | "ALL",
  onRangeChange: (r: "6M" | "1Y" | "ALL") => void
): void {
  parent.empty();
  const section = parent.createDiv("ledgr-nw-history-section");

  // ── Header row ──
  const headerRow = section.createDiv("ledgr-nw-history-header");
  headerRow.createSpan({ text: "Net Worth History", cls: "ledgr-nw-history-label" });

  const rangeSelector = headerRow.createDiv("ledgr-nw-history-range-selector");
  const ranges: Array<"6M" | "1Y" | "ALL"> = ["6M", "1Y", "ALL"];
  ranges.forEach((r) => {
    const btn = rangeSelector.createEl("button", { text: r, cls: "ledgr-nw-history-range-btn" });
    if (r === range) btn.addClass("active");
    const hasEnough = r === "ALL" || (r === "6M" && snapshots.length >= 2) || (r === "1Y" && snapshots.length >= 2);
    if (!hasEnough) btn.addClass("disabled");
    btn.onclick = () => { if (hasEnough) onRangeChange(r); };
  });

  // ── Filter snapshots by range ──
  const sorted = [...snapshots].sort((a, b) => a.month.localeCompare(b.month));
  // Ensure current month is included as latest point
  const lastSnap = sorted[sorted.length - 1];
  if (!lastSnap || lastSnap.month !== currentMonth) {
    sorted.push({ month: currentMonth, value: Math.round(currentNw) });
  } else {
    sorted[sorted.length - 1] = { ...lastSnap, value: Math.round(currentNw) };
  }

  const cutoff = range === "6M" ? window.moment(currentMonth).subtract(5, "months").format("YYYY-MM")
    : range === "1Y" ? window.moment(currentMonth).subtract(11, "months").format("YYYY-MM")
    : "0000-00";
  const visible = sorted.filter((s) => s.month >= cutoff);

  // ── Delta row ──
  const deltaRow = section.createDiv("ledgr-nw-history-deltas");
  if (visible.length >= 2) {
    const first = visible[0];
    const prev = visible[visible.length - 2];
    const curr = visible[visible.length - 1];

    const periodDelta = curr.value - first.value;
    const monthDelta = curr.value - prev.value;
    const periodPct = first.value !== 0 ? ((periodDelta / Math.abs(first.value)) * 100).toFixed(1) : "—";
    const monthPct = prev.value !== 0 ? ((monthDelta / Math.abs(prev.value)) * 100).toFixed(1) : "—";
    const firstLabel = window.moment(first.month).format("MMM YYYY");

    const mkDelta = (wrap: HTMLElement, delta: number, pct: string, label: string, primary: boolean) => {
      const cls = delta >= 0 ? "ledgr-nw-history-delta--positive" : "ledgr-nw-history-delta--negative";
      const sign = delta >= 0 ? "+" : "";
      const amtEl = wrap.createSpan({ cls: `ledgr-nw-history-delta-amount ${cls}` });
      amtEl.textContent = `${sign}${fmtNwAxis(delta, currency)}`;
      wrap.createSpan({ cls: "ledgr-nw-history-delta-pct", text: ` (${sign}${pct}%)` });
      wrap.createSpan({ cls: "ledgr-nw-history-delta-label", text: `  ${label}` });
    };

    const primary = deltaRow.createDiv("ledgr-nw-history-delta-primary");
    mkDelta(primary, periodDelta, String(periodPct), `since ${firstLabel}`, true);
    const secondary = deltaRow.createDiv("ledgr-nw-history-delta-secondary");
    mkDelta(secondary, monthDelta, String(monthPct), "vs last month", false);
  } else if (visible.length === 1) {
    const noData = deltaRow.createDiv("ledgr-nw-history-delta-secondary");
    noData.createSpan({ text: "—  Not enough history to compare", cls: "ledgr-nw-history-delta-label" });
  }

  // ── Chart ──
  const chartWrap = section.createDiv("ledgr-nw-history-chart-wrap");

  if (visible.length === 0) {
    chartWrap.createEl("p", { text: "Save your net worth to begin tracking history.", cls: "ledgr-nw-history-empty-msg" });
    return;
  }

  // SVG dimensions — internal coordinate system
  const SVG_W = 600, SVG_H = 160;
  const PAD_L = 54, PAD_R = 12, PAD_T = 12, PAD_B = 28;
  const chartW = SVG_W - PAD_L - PAD_R;
  const chartH = SVG_H - PAD_T - PAD_B;

  const values = visible.map((s) => s.value);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const vRange = maxV - minV || Math.abs(minV) * 0.1 || 1000;
  const yMin = minV - vRange * 0.08;
  const yMax = maxV + vRange * 0.08;

  const xScale = (i: number) => visible.length === 1
    ? PAD_L + chartW / 2
    : PAD_L + (i / (visible.length - 1)) * chartW;
  const yScale = (v: number) => PAD_T + chartH - ((v - yMin) / (yMax - yMin)) * chartH;
  const zeroY = yScale(0);

  // Line color based on net direction
  const isPositive = visible[visible.length - 1].value >= visible[0].value;
  const lineColor = isPositive ? "var(--ledgr-green)" : "var(--ledgr-red)";

  const svg = chartWrap.createSvg("svg", {
    attr: { viewBox: `0 0 ${SVG_W} ${SVG_H}`, class: "ledgr-nw-history-svg" },
  });

  // Y-axis ticks + gridlines
  const tickInterval = cleanTickInterval(yMax - yMin);
  const firstTick = Math.ceil(yMin / tickInterval) * tickInterval;
  for (let t = firstTick; t <= yMax; t += tickInterval) {
    const ty = yScale(t);
    svg.createSvg("line", { attr: { x1: String(PAD_L), y1: String(ty), x2: String(PAD_L + chartW), y2: String(ty), stroke: "currentColor", "stroke-width": "0.5", opacity: "0.15" } });
    svg.createSvg("text", { attr: { x: String(PAD_L - 4), y: String(ty + 3.5), "text-anchor": "end", class: "ledgr-nw-history-axis-label" } }).textContent = fmtNwAxis(t, currency);
  }

  // Zero line if visible range spans zero
  if (yMin < 0 && yMax > 0) {
    svg.createSvg("line", { attr: { x1: String(PAD_L), y1: String(zeroY), x2: String(PAD_L + chartW), y2: String(zeroY), stroke: "currentColor", "stroke-width": "0.8", opacity: "0.3" } });
  }

  if (visible.length === 1) {
    // Single snapshot: horizontal dashed reference line + dot at center
    const dotY = yScale(visible[0].value);
    svg.createSvg("line", {
      attr: {
        x1: String(PAD_L), y1: String(dotY),
        x2: String(PAD_L + chartW), y2: String(dotY),
        stroke: lineColor, "stroke-width": "1", "stroke-dasharray": "4 4", opacity: "0.5",
      },
    });
    svg.createSvg("circle", { attr: { cx: String(PAD_L + chartW / 2), cy: String(dotY), r: "4", fill: lineColor, stroke: "none" } });
  } else {
    // Area fill
    const baseline = Math.max(Math.min(zeroY, PAD_T + chartH), PAD_T);
    const lastX = xScale(visible.length - 1);
    const firstX = xScale(0);
    svg.createSvg("path", { attr: { d: `M ${visible.map((s, i) => `${xScale(i)},${yScale(s.value)}`).join(" L ")} L ${lastX},${baseline} L ${firstX},${baseline} Z`, fill: lineColor, opacity: "0.08", stroke: "none" } });

    // Line
    const linePath = visible.map((s, i) => `${i === 0 ? "M" : "L"} ${xScale(i)},${yScale(s.value)}`).join(" ");
    svg.createSvg("path", { attr: { d: linePath, stroke: lineColor, "stroke-width": "1.5", fill: "none" } });

    // Historical dots (open circles)
    visible.slice(0, -1).forEach((s, i) => {
      svg.createSvg("circle", { attr: { cx: String(xScale(i)), cy: String(yScale(s.value)), r: "3", fill: "none", stroke: lineColor, "stroke-width": "1.5" } });
    });

    // Current dot (filled)
    const lastIdx = visible.length - 1;
    svg.createSvg("circle", { attr: { cx: String(xScale(lastIdx)), cy: String(yScale(visible[lastIdx].value)), r: "4", fill: lineColor, stroke: "none" } });
  }

  // X-axis labels
  const labelStep = visible.length <= 6 ? 1 : visible.length <= 12 ? 2 : 3;
  let prevYear = "";
  visible.forEach((s, i) => {
    if (i % labelStep !== 0 && i !== visible.length - 1) return;
    const x = xScale(i);
    const mon = window.moment(s.month).format("MMM").toUpperCase();
    const yr = window.moment(s.month).format("YYYY");
    svg.createSvg("text", { attr: { x: String(x), y: String(SVG_H - 14), "text-anchor": "middle", class: "ledgr-nw-history-axis-label" } }).textContent = mon;
    if (yr !== prevYear && (i === 0 || yr !== window.moment(visible[0].month).format("YYYY"))) {
      svg.createSvg("text", { attr: { x: String(x), y: String(SVG_H - 4), "text-anchor": "middle", class: "ledgr-nw-history-axis-year" } }).textContent = yr;
      prevYear = yr;
    }
  });
}

// ─── renderAssaySeal ──────────────────────────────────────────────────────────
/**
 * The Bearing's assay mark — a geometric certification seal inspired by
 * hallmarking tradition. Built entirely from SVG paths, monochrome.
 */
export function renderAssaySeal(parent: HTMLElement, size = 80): SVGElement {
  const cx = size / 2;
  const cy = size / 2;
  const scale = size / 80;

  const svg = parent.createSvg("svg", {
    attr: {
      viewBox: `0 0 ${size} ${size}`,
      width: String(size),
      height: String(size),
      "aria-hidden": "true",
      class: "ledgr-assay-seal",
    },
  });

  const s = (v: number) => v * scale;
  const sw = (v: number) => String(v * scale);

  // Outer ring
  svg.createSvg("circle", { attr: { cx: String(cx), cy: String(cy), r: sw(38), "stroke-width": sw(0.75), fill: "none", stroke: "currentColor" } });

  // Inner ring
  svg.createSvg("circle", { attr: { cx: String(cx), cy: String(cy), r: sw(32), "stroke-width": sw(0.75), fill: "none", stroke: "currentColor" } });

  // Octagon (regular 8-gon, rotated 22.5°, r=28)
  const octR = s(28);
  const octPts = Array.from({ length: 8 }, (_, i) => {
    const angle = (Math.PI / 4) * i + (Math.PI / 8);
    return `${cx + octR * Math.cos(angle)},${cy + octR * Math.sin(angle)}`;
  }).join(" ");
  svg.createSvg("polygon", { attr: { points: octPts, "stroke-width": sw(0.75), fill: "none", stroke: "currentColor" } });

  // Cross lines (horizontal + vertical, stopping at octagon boundary r=28)
  const lineR = s(28);
  svg.createSvg("line", { attr: { x1: String(cx - lineR), y1: String(cy), x2: String(cx + lineR), y2: String(cy), "stroke-width": sw(0.5), stroke: "currentColor" } });
  svg.createSvg("line", { attr: { x1: String(cx), y1: String(cy - lineR), x2: String(cx), y2: String(cy + lineR), "stroke-width": sw(0.5), stroke: "currentColor" } });

  // Diagonal lines (45°/135°)
  const diagR = s(28) * Math.cos(Math.PI / 4);
  svg.createSvg("line", { attr: { x1: String(cx - diagR), y1: String(cy - diagR), x2: String(cx + diagR), y2: String(cy + diagR), "stroke-width": sw(0.5), stroke: "currentColor" } });
  svg.createSvg("line", { attr: { x1: String(cx + diagR), y1: String(cy - diagR), x2: String(cx - diagR), y2: String(cy + diagR), "stroke-width": sw(0.5), stroke: "currentColor" } });

  // Center pinpoint
  svg.createSvg("circle", { attr: { cx: String(cx), cy: String(cy), r: sw(1.5), fill: "currentColor" } });

  // Cardinal diamonds (rotated squares at cardinal midpoints)
  const dR = s(17);
  const dHalf = s(2.2);
  [[cx + dR, cy], [cx - dR, cy], [cx, cy + dR], [cx, cy - dR]].forEach(([dx, dy]) => {
    const pts = [
      `${dx},${dy - dHalf}`,
      `${dx + dHalf},${dy}`,
      `${dx},${dy + dHalf}`,
      `${dx - dHalf},${dy}`,
    ].join(" ");
    svg.createSvg("polygon", { attr: { points: pts, fill: "currentColor" } });
  });

  // Inner hexagon (focal anchor)
  const hexR = s(8);
  const hexPts = Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 3) * i;
    return `${cx + hexR * Math.cos(angle)},${cy + hexR * Math.sin(angle)}`;
  }).join(" ");
  svg.createSvg("polygon", { attr: { points: hexPts, "stroke-width": sw(0.5), fill: "none", stroke: "currentColor" } });

  return svg;
}
