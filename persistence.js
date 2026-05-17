// LocalStorage persistence — one slot per submodule.
//
// Storage key:    "bauphysik.v1"
// On-disk shape:  {
//   schemaVersion: 1,
//   uvalueQuickCalc:           { … }   // Submodule 1.1 state
//   uvalueQuickCalcInhomog:    { … }   // Submodule 1.2 state
//   // future slots get their own keys
// }
//
// Backward compatibility:
//   The old shape (before multi-module persistence) had `uvalueQuickCalc`
//   already in place under the same top-level key, with `theta_i_C` /
//   `theta_e_C` either present or missing. Both cases load cleanly here.

const KEY = "bauphysik.v1";

function readRaw() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeRaw(obj) {
  try {
    localStorage.setItem(KEY, JSON.stringify(obj));
  } catch {
    /* quota / disabled storage — silently swallow */
  }
}

function ensureRoot() {
  const r = readRaw() || {};
  if (r.schemaVersion !== 1) r.schemaVersion = 1;
  return r;
}

// ── Submodule 1.1 — homogeneous quick calc ──────────────────────────

export function loadQuickCalc() {
  const r = readRaw();
  if (!r || !r.uvalueQuickCalc) return null;
  return r.uvalueQuickCalc;
}

export function saveQuickCalc(state) {
  const r = ensureRoot();
  r.uvalueQuickCalc = state;
  writeRaw(r);
}

// ── Submodule 1.2 — inhomogeneous quick calc ────────────────────────

export function loadQuickCalcInhomog() {
  const r = readRaw();
  if (!r || !r.uvalueQuickCalcInhomog) return null;
  return r.uvalueQuickCalcInhomog;
}

export function saveQuickCalcInhomog(state) {
  const r = ensureRoot();
  r.uvalueQuickCalcInhomog = state;
  writeRaw(r);
}

// ── Reset ───────────────────────────────────────────────────────────

/**
 * Clear *all* module state from disk. Use sparingly — Reset buttons
 * in individual modules clear only their own slot via the per-slot
 * save() with a fresh-default state.
 */
export function resetAll() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
