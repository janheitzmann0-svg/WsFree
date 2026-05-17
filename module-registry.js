// Module registry — single source of truth for all submodules.
//
// Each entry:
//   id        — kebab-case, used in URL hash and stable across releases
//   number    — chapter mark ("1.1", "1.2", …) for visual hierarchy
//   title     — short name shown in the index and the header
//   subtitle  — one-line description
//   status    — "live" | "soon" — "soon" tiles render disabled
//   loader    — async () => import(...) for code-splitting the module
//
// Adding a new submodule means appending one entry here. No other file
// needs editing.

export const MODULE_REGISTRY = [
  {
    id: "1.1",
    number: "1.1",
    title: "U-value · homogeneous",
    subtitle:
      "Steady-state, 1-D heat flow through a homogeneous build-up. R-table, U, temperature profile.",
    status: "live",
    loader: () => import("./module-uvalue-homogeneous.js"),
  },
  {
    id: "1.2",
    number: "1.2",
    title: "U-value · inhomogeneous",
    subtitle:
      "Build-ups with mixed layers (Sparren/Gefach, framing). Upper/lower bound mean per DIN EN ISO 6946.",
    status: "live",
    loader: () => import("./module-uvalue-inhomogeneous.js"),
  },
];

export function findModule(id) {
  return MODULE_REGISTRY.find((m) => m.id === id) || null;
}
