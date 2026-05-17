// Shared UI helpers used by all modules.
// Pure DOM API; no innerHTML anywhere.

// ── DOM builders ────────────────────────────────────────────────────

/**
 * Element builder. attrs may include: className, id, type, value, name,
 * checked, selected, disabled, placeholder, min, max, step, aria-*,
 * data-*, and on<Event> handlers. Children may be strings, numbers,
 * nodes, fragments, arrays, null/undefined/false (skipped).
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "className") node.className = v;
    else if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (k === "checked" || k === "selected" || k === "disabled") {
      if (v) node.setAttribute(k, "");
    } else {
      node.setAttribute(k, String(v));
    }
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    node.appendChild(
      typeof c === "string" || typeof c === "number"
        ? document.createTextNode(String(c))
        : c
    );
  }
  return node;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * SVG element builder. Same calling convention as el(), with the SVG
 * namespace.
 */
export function svg(tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else {
      node.setAttribute(k, String(v));
    }
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    node.appendChild(
      typeof c === "string" || typeof c === "number"
        ? document.createTextNode(String(c))
        : c
    );
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/**
 * Render the `display` string from the notation pool (which may
 * contain `<sub>…</sub>`) into a DOM fragment, without innerHTML.
 */
export function renderDisplay(displayStr) {
  const frag = document.createDocumentFragment();
  const parts = String(displayStr).split(/(<sub>.*?<\/sub>)/g);
  for (const part of parts) {
    const m = part.match(/^<sub>(.*?)<\/sub>$/);
    if (m) {
      frag.appendChild(el("sub", {}, m[1]));
    } else if (part.length) {
      frag.appendChild(document.createTextNode(part));
    }
  }
  return frag;
}

// ── Number formatting ───────────────────────────────────────────────

export const fmt3 = (n) =>
  Number.isFinite(n)
    ? n.toLocaleString("en-GB", {
        maximumFractionDigits: 3,
        minimumFractionDigits: 3,
      })
    : "—";

export const fmt2 = (n) =>
  Number.isFinite(n)
    ? n.toLocaleString("en-GB", {
        maximumFractionDigits: 2,
        minimumFractionDigits: 2,
      })
    : "—";

export const fmt4 = (n) =>
  Number.isFinite(n)
    ? n.toLocaleString("en-GB", {
        maximumFractionDigits: 4,
        minimumFractionDigits: 4,
      })
    : "—";

/**
 * Adaptive precision for calculation-step lines:
 *   ≥100 → 1 dp · ≥10 → 2 dp · ≥1 → 3 dp · ≥0.1 → 2 dp
 *   ≥0.01 → 3 dp · else 4 dp
 */
export function fmtCalc(n) {
  if (!Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  let dp;
  if (a >= 100) dp = 1;
  else if (a >= 10) dp = 2;
  else if (a >= 1) dp = 3;
  else if (a >= 0.1) dp = 2;
  else if (a >= 0.01) dp = 3;
  else dp = 4;
  return n.toLocaleString("en-GB", {
    maximumFractionDigits: dp,
    minimumFractionDigits: dp,
  });
}

export const fmtTheta = (n) =>
  Number.isFinite(n)
    ? n.toLocaleString("en-GB", {
        maximumFractionDigits: 2,
        minimumFractionDigits: 2,
      })
    : "—";

export const fmtD = (n) =>
  Number.isFinite(n)
    ? n.toLocaleString("en-GB", {
        maximumFractionDigits: 3,
        minimumFractionDigits: 3,
      })
    : "—";

export const fmtU = (n) =>
  Number.isFinite(n)
    ? n.toLocaleString("en-GB", {
        maximumFractionDigits: 3,
        minimumFractionDigits: 3,
      })
    : "—";

/** Format a fraction in percent with 1 dp. */
export const fmtPct = (f) =>
  Number.isFinite(f)
    ? (f * 100).toLocaleString("en-GB", {
        maximumFractionDigits: 1,
        minimumFractionDigits: 1,
      })
    : "—";

/** Wrap a numeric string in parens if it represents a negative number. */
export function parenIfNeg(s) {
  return s != null && String(s).trim().startsWith("-") ? `(${s})` : s;
}

// ── Reusable row/line builders ──────────────────────────────────────

/**
 * A breakdown row: label on the left, value + unit on the right.
 * Returns a div.resRow.
 */
export function resRow(labelChildren, valueText, unitText, extraClass) {
  const cn = "resRow" + (extraClass ? ` ${extraClass}` : "");
  return el("div", { className: cn }, [
    el("span", { className: "resLabel" }, [].concat(labelChildren)),
    el("span", { className: "resValueGroup" }, [
      el("span", { className: "resValue" }, valueText),
      el("span", { className: "resUnit" }, unitText),
    ]),
  ]);
}

/**
 * A calculation-step formula line: `<sym> = <numeric> = <result> <unit>`.
 * Used in expanded calc blocks. numericText/resultText may be empty.
 */
export function formulaLine(
  symbolicNode,
  numericText,
  resultText,
  unitText,
  extraClass
) {
  const cn = "formulaLine" + (extraClass ? ` ${extraClass}` : "");
  const children = [
    el("span", { className: "flSym" }, [].concat(symbolicNode)),
  ];
  if (numericText != null && numericText !== "") {
    children.push(el("span", { className: "flEq" }, "="));
    children.push(el("span", { className: "flNum" }, numericText));
  }
  if (resultText != null && resultText !== "") {
    children.push(el("span", { className: "flEq" }, "="));
    children.push(el("span", { className: "flRes" }, resultText));
  }
  if (unitText != null && unitText !== "") {
    children.push(el("span", { className: "flUnit" }, unitText));
  }
  return el("div", { className: cn }, children);
}

/** A step heading inside the calculation-steps block. */
export function stepHeading(num, title) {
  return el("div", { className: "calcStepHead" }, [
    el("span", { className: "calcStepNum" }, num != null ? String(num) : ""),
    el("span", { className: "calcStepTitle" }, title),
  ]);
}
