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

// ─── SVG namespace helper ─────────────────────────────────────────────────────

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return window.document.createElementNS(SVG_NS, tag);
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
  const svg = window.document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("ledgr-donut-svg");

  // Track ring (background circle)
  const track = svgEl("circle");
  track.setAttribute("cx", "50");
  track.setAttribute("cy", "50");
  track.setAttribute("r", String(R));
  track.classList.add("ledgr-donut-track");
  svg.appendChild(track);

  // Segments — rendered as stroke-dasharray arcs
  // Each arc: dasharray = [arcLength, circumference - arcLength]
  // dashoffset = -sumOfPreviousArcs (to position correctly around the circle)
  let offset = 0;

  nonZero.forEach((seg, i) => {
    const arcLen = (seg.value / total) * C;
    const color = seg.color ?? categoryColor(seg.label, i);

    const circle = svgEl("circle");
    circle.setAttribute("cx", "50");
    circle.setAttribute("cy", "50");
    circle.setAttribute("r", String(R));
    circle.classList.add("ledgr-donut-arc");
    circle.setAttribute("stroke", color);
    circle.setAttribute("stroke-dasharray", `${arcLen} ${C - arcLen}`);
    // stroke-dashoffset shifts the starting point. We subtract from C because
    // the SVG is rotated -90deg (via CSS class), so we run clockwise from top.
    circle.setAttribute("stroke-dashoffset", String(-offset));

    // Tooltip via title element
    const titleEl = svgEl("title");
    const pct = Math.round((seg.value / total) * 100);
    titleEl.textContent = `${seg.label}: ${seg.displayValue ?? seg.value.toLocaleString()} (${pct}%)`;
    circle.appendChild(titleEl);

    svg.appendChild(circle);
    offset += arcLen;
  });

  frame.appendChild(svg);

  // ── Center label overlay ──
  const center = frame.createDiv("ledgr-donut-center");
  const displayCenter = centerValue ?? formatCenterValue(total, nonZero, segments);
  center.createEl("span", { text: displayCenter, cls: "ledgr-donut-center-value" });
  if (centerLabel) {
    center.createEl("span", { text: centerLabel, cls: "ledgr-donut-center-label" });
  }

  // ── Legend ──
  const legend = row.createDiv("ledgr-donut-legend");
  nonZero.forEach((seg, i) => {
    const color = seg.color ?? categoryColor(seg.label, i);
    const pct = Math.round((seg.value / total) * 100);
    const item = legend.createDiv("ledgr-legend-item");

    const swatch = item.createEl("span", { cls: "ledgr-legend-swatch" });
    swatch.style.backgroundColor = color; // dynamic value — cannot use static CSS class

    item.createEl("span", { text: seg.label, cls: "ledgr-legend-label" });
    item.createEl("span", {
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

    const swatch = item.createEl("span", { cls: "ledgr-comp-legend-swatch" });
    swatch.style.backgroundColor = color; // dynamic value — cannot use static CSS class

    item.createEl("span", { text: seg.label, cls: "ledgr-comp-legend-label" });
    if (seg.displayValue) {
      item.createEl("span", { text: seg.displayValue, cls: "ledgr-comp-legend-amt" });
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

  const svg = window.document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("preserveAspectRatio", "none");

  const path = window.document.createElementNS(SVG_NS, "polyline");
  path.setAttribute("points", pts.join(" "));
  path.classList.add("ledgr-sparkline-path");
  if (trendClass) path.classList.add(trendClass);

  svg.appendChild(path);
  wrapper.appendChild(svg);
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

  const svg = window.document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 80 80");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("ledgr-gauge-svg");

  // Track ring
  const track = svgEl("circle");
  track.setAttribute("cx", "40"); track.setAttribute("cy", "40"); track.setAttribute("r", String(R));
  track.classList.add("ledgr-gauge-track");
  svg.appendChild(track);

  // Fill ring — stroke-dasharray controls how much is filled
  // rotate -90 so fill starts at the top
  if (clamped > 0) {
    const fill = svgEl("circle");
    fill.setAttribute("cx", "40"); fill.setAttribute("cy", "40"); fill.setAttribute("r", String(R));
    fill.classList.add("ledgr-gauge-fill");
    fill.setAttribute("stroke", color);
    fill.setAttribute("stroke-dasharray", `${arcLen} ${C - arcLen}`);
    fill.setAttribute("transform", "rotate(-90 40 40)");
    svg.appendChild(fill);
  }

  wrap.appendChild(svg);

  const center = wrap.createDiv("ledgr-gauge-center");
  center.createEl("span", { text: `${Math.round(clamped)}%`, cls: "ledgr-gauge-value" });
  if (label) center.createEl("span", { text: label, cls: "ledgr-gauge-label" });
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
  const svg = window.document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("ledgr-trend-svg");

  // Grid lines
  for (let i = 0; i <= 2; i++) {
    const y = PAD.top + (i / 2) * chartH;
    const line = svgEl("line");
    line.setAttribute("x1", String(PAD.left)); line.setAttribute("y1", String(y));
    line.setAttribute("x2", String(PAD.left + chartW)); line.setAttribute("y2", String(y));
    line.classList.add("ledgr-trend-grid");
    svg.appendChild(line);

    const val = maxV - (i / 2) * (maxV - minV);
    const text = svgEl("text");
    text.setAttribute("x", String(PAD.left - 4));
    text.setAttribute("y", String(y + 4));
    text.setAttribute("text-anchor", "end");
    text.classList.add("ledgr-trend-axis-label");
    text.textContent = val >= 1000 ? `${Math.round(val / 1000)}k` : String(Math.round(val));
    svg.appendChild(text);
  }

  // Series
  series.forEach((s, si) => {
    if (!s.values.length) return;
    const color = s.color ?? defaultColors[si % defaultColors.length];
    const pts = s.values.map((v, i) => `${xScale(i).toFixed(1)},${yScale(v).toFixed(1)}`).join(" ");

    const polyline = window.document.createElementNS(SVG_NS, "polyline");
    polyline.setAttribute("points", pts);
    polyline.classList.add("ledgr-trend-line");
    polyline.setAttribute("stroke", color);
    if (s.dashed) polyline.setAttribute("stroke-dasharray", "4 3");
    svg.appendChild(polyline);

    const dot = window.document.createElementNS(SVG_NS, "circle");
    dot.setAttribute("cx", String(xScale(s.values.length - 1)));
    dot.setAttribute("cy", String(yScale(s.values[s.values.length - 1])));
    dot.setAttribute("r", "2");
    dot.setAttribute("fill", color);
    dot.setAttribute("stroke", "none");
    dot.setAttribute("opacity", "0.85");
    svg.appendChild(dot);
  });

  if (labels) {
    labels.forEach((lbl, i) => {
      const text = svgEl("text");
      text.setAttribute("x", String(xScale(i)));
      text.setAttribute("y", String(H - 4));
      text.setAttribute("text-anchor", "middle");
      text.classList.add("ledgr-trend-axis-label");
      text.textContent = lbl;
      svg.appendChild(text);
    });
  }

  wrap.appendChild(svg);

  if (series.length > 1) {
    const legend = wrap.createDiv("ledgr-trend-legend");
    series.forEach((s, si) => {
      const color = s.color ?? defaultColors[si % defaultColors.length];
      const item = legend.createDiv("ledgr-trend-legend-item");
      const swatch = item.createEl("span", { cls: "ledgr-trend-legend-swatch" });
      swatch.style.backgroundColor = color; // dynamic value — cannot use static CSS class
      if (s.dashed) swatch.addClass("ledgr-trend-legend-swatch-dashed");
      item.createEl("span", { text: s.label, cls: "ledgr-trend-legend-label" });
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
  if (label) wrap.createEl("div", { text: label, cls: "ledgr-scale-label" });

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
  zoneRow.createEl("span", { text: zones.left, cls: "ledgr-scale-zone-label" });
  zoneRow.createEl("span", { text: zones.center, cls: "ledgr-scale-zone-label" });
  zoneRow.createEl("span", { text: zones.right, cls: "ledgr-scale-zone-label" });
}
