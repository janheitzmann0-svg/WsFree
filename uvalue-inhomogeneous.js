// U-value engine for inhomogeneous (1-D, steady-state) building components.
//
// Submodule 1.2.
//
// Method: DIN EN ISO 6946 / Willems Lehrbuch der Bauphysik, 9. Aufl. 2022,
//         §2.3.4.2 "U-Wert-Berechnung von Bauteilen mit inhomogenen
//         Schichten", pp. 36–38 (worked example, Holzkonstruktion).
//
//   R_T  = (R_T' + R_T'') / 2     ... arithmetic mean of the two bounds
//   U    = 1 / R_T
//
// Upper bound R_T' (parallel sections):
//   For each cross-section j (= a, b, …, q) running through the component
//   in heat-flow direction, treat the build-up as if it were homogeneous
//   along that section and compute
//     R_T,j  =  R_si + Σ_i R_i,j + R_se        (eq. 2.59–2.61)
//   Then area-fraction-weighted harmonic mean (eq. 2.62):
//     1 / R_T'  =  Σ_j  f_j / R_T,j     with Σ_j f_j = 1
//
// Lower bound R_T'' (layer-wise area-weighted resistance):
//   For each layer i:
//     - homogeneous   :  R_i = d_i / λ_i
//     - inhomogeneous :  1/R_i = Σ_k f_k / R_k,i = Σ_k f_k · λ_k,i / d_i
//                        (eq. 2.64; assumes a single d per layer)
//   Then (eq. 2.63):
//     R_T''  =  R_si + Σ_i R_i + R_se
//
// All inputs and outputs use SI base units (m, W/(m·K), (m²·K)/W,
// W/(m²·K)).  Functions are pure and DOM-free.
//
// Layer input shape:
//   { type: "homogeneous",   d_m, lambda_W_mK }
//   { type: "inhomogeneous", d_m, regions: [{ lambda_W_mK, fraction }, ...] }
//     - fractions are dimensionless area shares, non-negative, summing to 1
//     - all regions in one layer share the same thickness d_m
//
// The cross-sections in the upper-bound computation are the Cartesian
// product of all inhomogeneous-layer region lists. For the common case
// of exactly one inhomogeneous layer (Sparren/Gefach) the product
// collapses to that one layer's regions.

import { SURFACE_RESISTANCES } from "./reference-data.js";

const FRACTION_SUM_TOL = 1e-6;

function assertPositiveFinite(v, name) {
  if (!Number.isFinite(v) || v <= 0) {
    throw new Error(`${name} must be a positive finite number (got ${v}).`);
  }
}
function assertNonNegativeFinite(v, name) {
  if (!Number.isFinite(v) || v < 0) {
    throw new Error(`${name} must be a non-negative finite number (got ${v}).`);
  }
}
function fractionsSumOk(regions) {
  const s = regions.reduce((a, r) => a + r.fraction, 0);
  return Math.abs(s - 1) <= FRACTION_SUM_TOL;
}

/**
 * Surface resistances for a given heat-flow direction (Willems Tab. 2.4).
 */
export function surfaceResistancesFor(direction) {
  const v = SURFACE_RESISTANCES[direction];
  if (!v) throw new Error(`Unknown heat flow direction: ${direction}`);
  return { R_si: v.R_si, R_se: v.R_se };
}

/**
 * Enumerate all cross-sections (Cartesian product of inhomogeneous-layer
 * regions). Returns an array of objects describing each section:
 *   { index, fraction, pick:[{layerIndex,regionIndex}], lambdas:[…] }
 *
 * For a build-up with no inhomogeneous layers, returns a single section
 * with fraction 1 and lambdas straight from the homogeneous layers.
 */
export function enumerateCrossSections(layers) {
  const inhomIdx = [];
  for (let i = 0; i < layers.length; i++) {
    if (layers[i].type === "inhomogeneous") inhomIdx.push(i);
  }
  const baseLam = layers.map((l) =>
    l.type === "homogeneous" ? l.lambda_W_mK : null
  );
  if (inhomIdx.length === 0) {
    return [{ index: 1, fraction: 1, pick: [], lambdas: baseLam.slice() }];
  }
  const out = [];
  const rec = (depth, picks, fracAcc, lamArr) => {
    if (depth === inhomIdx.length) {
      out.push({
        index: out.length + 1,
        fraction: fracAcc,
        pick: picks.slice(),
        lambdas: lamArr.slice(),
      });
      return;
    }
    const li = inhomIdx[depth];
    const regs = layers[li].regions;
    for (let r = 0; r < regs.length; r++) {
      lamArr[li] = regs[r].lambda_W_mK;
      picks.push({ layerIndex: li, regionIndex: r });
      rec(depth + 1, picks, fracAcc * regs[r].fraction, lamArr);
      picks.pop();
    }
  };
  rec(0, [], 1, baseLam.slice());
  return out;
}

/**
 * Upper bound R_T' via parallel cross-sections.
 * Returns { R_T_upper, sections } — each section also carries its
 * per-layer R contributions and its total R_T,j for the UI.
 */
export function upperBoundResistance(layers, R_si, R_se) {
  const sections = enumerateCrossSections(layers);
  let invSum = 0;
  for (const s of sections) {
    let R_layers = 0;
    const perLayer = [];
    for (let i = 0; i < layers.length; i++) {
      const R = layers[i].d_m / s.lambdas[i];
      perLayer.push({ R, lambda: s.lambdas[i], d_m: layers[i].d_m });
      R_layers += R;
    }
    const R_Tj = R_si + R_layers + R_se;
    s.R_layers = R_layers;
    s.perLayer = perLayer;
    s.R_Tj = R_Tj;
    invSum += s.fraction / R_Tj;
  }
  const R_T_upper = 1 / invSum;
  return { R_T_upper, sections };
}

/**
 * Lower bound R_T'' via layer-wise area-weighted resistance.
 * For an inhomogeneous layer this is the harmonic mean of region
 * resistances (book eq. 2.64), which — at constant d per layer —
 * is equivalent to using an effective λ_eff = Σ f_k · λ_k,i.
 */
export function lowerBoundResistance(layers, R_si, R_se) {
  const perLayer = [];
  let R_layers = 0;
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    if (layer.type === "homogeneous") {
      const R = layer.d_m / layer.lambda_W_mK;
      perLayer.push({
        type: "homogeneous",
        d_m: layer.d_m,
        lambda_eff: layer.lambda_W_mK,
        R,
      });
      R_layers += R;
      continue;
    }
    let invR = 0;
    let lamEff = 0;
    const regions = layer.regions.map((r) => {
      const R_k = layer.d_m / r.lambda_W_mK;
      invR += r.fraction / R_k;
      lamEff += r.fraction * r.lambda_W_mK;
      return { lambda_W_mK: r.lambda_W_mK, fraction: r.fraction, R: R_k };
    });
    const R = 1 / invR;
    perLayer.push({
      type: "inhomogeneous",
      d_m: layer.d_m,
      lambda_eff: lamEff,
      R,
      regions,
    });
    R_layers += R;
  }
  const R_T_lower = R_si + R_layers + R_se;
  return { R_T_lower, perLayer };
}

/**
 * Full inhomogeneous U-value calculation.
 *
 * Throws on invalid input. Returns:
 *   {
 *     R_si, R_se,
 *     upper: { R_T_upper, sections: [{ index, fraction, R_layers,
 *                                      perLayer, R_Tj, pick, lambdas }] },
 *     lower: { R_T_lower, perLayer },
 *     R_T,
 *     U
 *   }
 */
export function computeUValueInhomogeneous(input) {
  const { layers, heatFlowDirection } = input;
  if (!Array.isArray(layers) || layers.length === 0) {
    throw new Error("At least one layer is required.");
  }
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i];
    assertPositiveFinite(l.d_m, `Layer ${i + 1} thickness`);
    if (l.type === "homogeneous") {
      assertPositiveFinite(l.lambda_W_mK, `Layer ${i + 1} λ`);
    } else if (l.type === "inhomogeneous") {
      if (!Array.isArray(l.regions) || l.regions.length < 2) {
        throw new Error(`Inhomogeneous layer ${i + 1} needs ≥ 2 regions.`);
      }
      for (let k = 0; k < l.regions.length; k++) {
        assertPositiveFinite(
          l.regions[k].lambda_W_mK,
          `Layer ${i + 1} region ${k + 1} λ`
        );
        assertNonNegativeFinite(
          l.regions[k].fraction,
          `Layer ${i + 1} region ${k + 1} fraction`
        );
      }
      if (!fractionsSumOk(l.regions)) {
        throw new Error(`Layer ${i + 1} region fractions do not sum to 1.`);
      }
    } else {
      throw new Error(`Layer ${i + 1} has unknown type "${l.type}".`);
    }
  }
  const { R_si, R_se } = surfaceResistancesFor(heatFlowDirection);
  const upper = upperBoundResistance(layers, R_si, R_se);
  const lower = lowerBoundResistance(layers, R_si, R_se);
  const R_T = (upper.R_T_upper + lower.R_T_lower) / 2;
  const U = 1 / R_T;
  return { R_si, R_se, upper, lower, R_T, U };
}

/**
 * Reduce an inhomogeneous layer stack to an equivalent homogeneous one,
 * replacing each inhomogeneous layer by its effective λ_eff (= Σ f_k · λ_k).
 *
 * Used for the *simplified* temperature profile in Submodule 1.2 — the
 * real field is 2-D, but for a 1-D walk-through this captures the
 * lower-bound assumption and matches the book's level of detail.
 */
export function reduceToEquivalentHomogeneous(layers) {
  return layers.map((l) => {
    if (l.type === "homogeneous") {
      return { d_m: l.d_m, lambda_W_mK: l.lambda_W_mK };
    }
    const lamEff = l.regions.reduce(
      (a, r) => a + r.fraction * r.lambda_W_mK,
      0
    );
    return { d_m: l.d_m, lambda_W_mK: lamEff };
  });
}
