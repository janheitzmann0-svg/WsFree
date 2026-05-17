// Submodule 1.2 — U-value, inhomogeneous component.
//
// UI controller. Calculation logic lives in ./uvalue-inhomogeneous.js
// (engine) and ./temperature-profile.js (simplified profile via
// equivalent-homogeneous reduction).
//
// Method: Willems Lehrbuch der Bauphysik, 9. Aufl. 2022, §2.3.4.2,
//         pp. 36–38. DIN EN ISO 6946.
//
//   R_T  = (R_T' + R_T'') / 2
//   U    = 1 / R_T

import {
  computeUValueInhomogeneous,
  reduceToEquivalentHomogeneous,
  surfaceResistancesFor,
} from "./uvalue-inhomogeneous.js";
import { computeTemperatureProfile } from "./temperature-profile.js";
import {
  MATERIAL_BY_ID,
  SURFACE_RESISTANCES,
  DATA_SOURCE_NOTE,
} from "./reference-data.js";
import { SHARED_POOL } from "./notation.js";
import {
  loadQuickCalcInhomog,
  saveQuickCalcInhomog,
} from "./persistence.js";
import {
  el,
  svg,
  clear,
  renderDisplay,
  fmt2,
  fmt3,
  fmt4,
  fmtCalc,
  fmtTheta,
  fmtD,
  fmtU,
  fmtPct,
  parenIfNeg,
  resRow,
  formulaLine,
  stepHeading,
} from "./ui-helpers.js";
import {
  renderMaterialPicker,
  closeOpenPicker,
} from "./material-picker.js";

// ── module-private state ────────────────────────────────────────────

let root = null;
let state = null;

function defaultState() {
  return {
    componentName: "",
    heatFlowDirection: "horizontal",
    layers: [],
    theta_i_C: 20,
    theta_e_C: -10,
  };
}

function persist() {
  saveQuickCalcInhomog(state);
}

function freshHomogeneousLayer() {
  return {
    type: "homogeneous",
    materialId: null,
    customName: "",
    lambda_W_mK: null,
    thickness_m: null,
  };
}

function freshInhomogeneousLayer() {
  return {
    type: "inhomogeneous",
    thickness_m: null,
    regions: [
      freshRegion(0.5),
      freshRegion(0.5),
    ],
  };
}

function freshRegion(fraction) {
  return {
    materialId: null,
    customName: "",
    lambda_W_mK: null,
    fraction,
  };
}

// ── derived helpers ─────────────────────────────────────────────────

function effectiveRegionName(region) {
  if (region.materialId && MATERIAL_BY_ID[region.materialId]) {
    return MATERIAL_BY_ID[region.materialId].name;
  }
  return region.customName || "(custom)";
}

function effectiveLayerName(layer, indexFromZero) {
  if (layer.type === "homogeneous") {
    if (layer.materialId && MATERIAL_BY_ID[layer.materialId]) {
      return MATERIAL_BY_ID[layer.materialId].name;
    }
    return layer.customName || `Layer ${indexFromZero + 1}`;
  }
  // inhomogeneous: name as "a/b" combination
  const names = layer.regions.map(effectiveRegionName);
  return names.join(" / ");
}

function layerIsComplete(layer) {
  if (!Number.isFinite(layer.thickness_m) || layer.thickness_m <= 0) {
    return false;
  }
  if (layer.type === "homogeneous") {
    return (
      Number.isFinite(layer.lambda_W_mK) && layer.lambda_W_mK > 0
    );
  }
  if (!Array.isArray(layer.regions) || layer.regions.length < 2) return false;
  for (const r of layer.regions) {
    if (!Number.isFinite(r.lambda_W_mK) || r.lambda_W_mK <= 0) return false;
    if (!Number.isFinite(r.fraction) || r.fraction < 0) return false;
  }
  const sum = layer.regions.reduce((a, r) => a + r.fraction, 0);
  return Math.abs(sum - 1) < 1e-6;
}

function regionFractionSum(layer) {
  return layer.regions.reduce(
    (a, r) => a + (Number.isFinite(r.fraction) ? r.fraction : 0),
    0
  );
}

function toEngineLayers(layers) {
  return layers
    .filter(layerIsComplete)
    .map((l) => {
      if (l.type === "homogeneous") {
        return {
          type: "homogeneous",
          d_m: l.thickness_m,
          lambda_W_mK: l.lambda_W_mK,
        };
      }
      return {
        type: "inhomogeneous",
        d_m: l.thickness_m,
        regions: l.regions.map((r) => ({
          lambda_W_mK: r.lambda_W_mK,
          fraction: r.fraction,
        })),
      };
    });
}

// ── results ─────────────────────────────────────────────────────────

function results() {
  const engineLayers = toEngineLayers(state.layers);
  const { R_si, R_se } = surfaceResistancesFor(state.heatFlowDirection);

  if (engineLayers.length === 0) {
    return {
      incomplete: true,
      R_si,
      R_se,
      R_T_upper: null,
      R_T_lower: null,
      R_T: null,
      U: null,
      upper: null,
      lower: null,
      profile: null,
    };
  }

  let r;
  try {
    r = computeUValueInhomogeneous({
      layers: engineLayers,
      heatFlowDirection: state.heatFlowDirection,
    });
  } catch {
    return {
      incomplete: true,
      R_si,
      R_se,
      R_T_upper: null,
      R_T_lower: null,
      R_T: null,
      U: null,
      upper: null,
      lower: null,
      profile: null,
    };
  }

  // Simplified temperature profile via equivalent-homogeneous reduction
  let profile = null;
  if (Number.isFinite(state.theta_i_C) && Number.isFinite(state.theta_e_C)) {
    try {
      const eqLayers = reduceToEquivalentHomogeneous(engineLayers);
      profile = computeTemperatureProfile({
        layers: eqLayers,
        heatFlowDirection: state.heatFlowDirection,
        theta_i_C: state.theta_i_C,
        theta_e_C: state.theta_e_C,
      });
    } catch {
      profile = null;
    }
  }

  // Layer-name array for valid layers (for diagram labels)
  const validIdx = state.layers
    .map((l, i) => (layerIsComplete(l) ? i : -1))
    .filter((i) => i >= 0);
  const layerNames = validIdx.map((i) =>
    effectiveLayerName(state.layers[i], i)
  );
  // Per-layer type flags for the diagram so it can hatch inhom bands
  const layerTypes = validIdx.map((i) => state.layers[i].type);

  return {
    incomplete: false,
    R_si: r.R_si,
    R_se: r.R_se,
    R_T_upper: r.upper.R_T_upper,
    R_T_lower: r.lower.R_T_lower,
    R_T: r.R_T,
    U: r.U,
    upper: r.upper,
    lower: r.lower,
    engineLayers,
    profile,
    layerNames,
    layerTypes,
  };
}

// ── render top-level ────────────────────────────────────────────────

function render() {
  clear(root);
  root.appendChild(renderModuleHeader());
  root.appendChild(renderComponentName());
  root.appendChild(renderHeatFlow());
  root.appendChild(renderLayers());
  root.appendChild(renderResults());
  root.appendChild(renderFooter());
}

function renderModuleHeader() {
  return el("section", { className: "moduleHead" }, [
    el("div", { className: "moduleChapter", "aria-hidden": "true" }, "1.2"),
    el("div", { className: "moduleHeadText" }, [
      el("h2", { className: "moduleTitle" }, [
        "U-value ",
        el("em", {}, "— inhomogeneous component"),
      ]),
      el(
        "p",
        { className: "moduleSub" },
        "Steady-state, one-dimensional heat flow through a build-up with mixed layers. " +
          "Bound method per DIN EN ISO 6946 / Willems §2.3.4.2 — R\u2009T is the mean of an upper and a lower bound."
      ),
    ]),
  ]);
}

function renderComponentName() {
  const input = el("input", {
    type: "text",
    id: "componentNameInhom",
    className: "nameInput",
    placeholder: "e.g. timber wall — Sparren / Gefach",
    value: state.componentName,
    onInput: (e) => {
      state.componentName = e.target.value;
      persist();
    },
  });
  return el("section", { className: "block" }, [
    el(
      "label",
      { for: "componentNameInhom", className: "label" },
      "Component name"
    ),
    input,
  ]);
}

function renderHeatFlow() {
  const wrap = el("section", { className: "block" }, [
    el("div", { className: "label" }, "Heat flow direction"),
  ]);
  const group = el("div", { className: "radioGroup", role: "radiogroup" });

  for (const dir of Object.keys(SURFACE_RESISTANCES)) {
    const sr = SURFACE_RESISTANCES[dir];
    const id = `flow_inhom_${dir}`;
    const radio = el("input", {
      type: "radio",
      name: "heatFlowInhom",
      id,
      value: dir,
      checked: state.heatFlowDirection === dir,
      onChange: () => {
        state.heatFlowDirection = dir;
        persist();
        render();
      },
    });
    const labelChildren = [sr.label, " "];
    const meta = el("span", { className: "meta" });
    meta.appendChild(
      renderDisplay(SHARED_POOL.surface_resistance_internal.display)
    );
    meta.appendChild(document.createTextNode(` = ${fmt2(sr.R_si)}, `));
    meta.appendChild(
      renderDisplay(SHARED_POOL.surface_resistance_external.display)
    );
    meta.appendChild(
      document.createTextNode(` = ${fmt2(sr.R_se)} (m²·K)/W`)
    );
    labelChildren.push(meta);
    const label = el(
      "label",
      { for: id, className: "radioLabel" },
      labelChildren
    );
    group.appendChild(el("div", { className: "radioRow" }, [radio, label]));
  }
  wrap.appendChild(group);
  return wrap;
}

// ── layers section — cards ──────────────────────────────────────────

function renderLayers() {
  const section = el("section", { className: "block" }, [
    el("div", { className: "label" }, "Layers (interior → exterior)"),
  ]);

  const list = el("div", { className: "layerCards" });
  state.layers.forEach((layer, index) => {
    list.appendChild(renderLayerCard(layer, index));
  });
  section.appendChild(list);

  if (state.layers.length === 0) {
    section.appendChild(
      el(
        "p",
        { className: "hint" },
        "Add layers to start. Every build-up needs at least one inhomogeneous layer for this submodule to be useful — otherwise use Submodule 1.1."
      )
    );
  }

  const btnRow = el("div", { className: "addBtnRow" }, [
    el(
      "button",
      {
        type: "button",
        className: "addBtn",
        onClick: () => {
          state.layers.push(freshHomogeneousLayer());
          persist();
          render();
        },
      },
      "+ Homogeneous layer"
    ),
    el(
      "button",
      {
        type: "button",
        className: "addBtn addBtnInhom",
        onClick: () => {
          state.layers.push(freshInhomogeneousLayer());
          persist();
          render();
        },
      },
      "+ Inhomogeneous layer"
    ),
  ]);
  section.appendChild(btnRow);

  return section;
}

function renderLayerCard(layer, index) {
  const isInhom = layer.type === "inhomogeneous";
  const card = el("div", {
    className: "layerCard" + (isInhom ? " layerCard--inhom" : ""),
  });

  // ── header ────────────────────────────────────────────────────────
  card.appendChild(
    el("div", { className: "layerCardHead" }, [
      el("span", { className: "layerCardNum" }, String(index + 1)),
      el(
        "span",
        { className: "layerCardType" },
        isInhom ? "Inhomogeneous layer" : "Homogeneous layer"
      ),
      el(
        "button",
        {
          type: "button",
          className: "rmBtn",
          "aria-label": `Remove layer ${index + 1}`,
          onClick: () => {
            state.layers.splice(index, 1);
            persist();
            render();
          },
        },
        "×"
      ),
    ])
  );

  // ── body ──────────────────────────────────────────────────────────
  const body = el("div", { className: "layerCardBody" });

  // shared thickness field
  const thkField = el("div", { className: "fieldGroup" }, [
    el("label", { className: "fieldLabel" }, [
      renderDisplay(SHARED_POOL.layer_thickness.display),
      " ",
      el("span", { className: "fieldUnit" }, "mm"),
    ]),
    el("input", {
      type: "number",
      className: "num",
      step: "1",
      min: "0",
      inputmode: "decimal",
      value:
        layer.thickness_m != null
          ? String(Math.round(layer.thickness_m * 1000 * 1000) / 1000)
          : "",
      "aria-label": `Layer ${index + 1} thickness in mm`,
      onInput: (e) => {
        const mm = parseFloat(e.target.value);
        layer.thickness_m =
          Number.isFinite(mm) && mm >= 0 ? mm / 1000 : null;
        persist();
        updateResults();
      },
    }),
  ]);
  body.appendChild(thkField);

  if (!isInhom) {
    // homogeneous: material picker + λ
    const matField = el("div", { className: "fieldGroup fieldGroupMat" }, [
      el("label", { className: "fieldLabel" }, "Material"),
      renderMaterialPicker({
        currentMaterialId: layer.materialId,
        currentCustomName: layer.customName,
        ariaLabel: `Layer ${index + 1} material`,
        popoverKey: `m1.2-layer-${index}`,
        onPick: ({ materialId, material }) => {
          layer.materialId = materialId;
          if (material && Number.isFinite(material.lambda)) {
            layer.lambda_W_mK = material.lambda;
          }
          persist();
          render();
        },
      }),
      ...(layer.materialId == null
        ? [
            el("input", {
              type: "text",
              className: "customNameInput",
              placeholder: "Custom name (optional)",
              value: layer.customName || "",
              onInput: (e) => {
                layer.customName = e.target.value;
                persist();
              },
            }),
          ]
        : []),
    ]);
    body.appendChild(matField);

    const lamField = el("div", { className: "fieldGroup" }, [
      el("label", { className: "fieldLabel" }, [
        renderDisplay(SHARED_POOL.lambda_thermal_conductivity.display),
        " ",
        el("span", { className: "fieldUnit" }, "W/(m·K)"),
      ]),
      el("input", {
        type: "number",
        className: "num",
        step: "0.001",
        min: "0",
        inputmode: "decimal",
        value: layer.lambda_W_mK != null ? String(layer.lambda_W_mK) : "",
        onInput: (e) => {
          const v = parseFloat(e.target.value);
          layer.lambda_W_mK =
            Number.isFinite(v) && v > 0 ? v : null;
          persist();
          updateResults();
        },
      }),
    ]);
    body.appendChild(lamField);
  } else {
    // inhomogeneous: regions sub-table
    body.appendChild(renderRegions(layer, index));
  }

  card.appendChild(body);
  return card;
}

function renderRegions(layer, layerIndex) {
  const wrap = el("div", { className: "regions" });
  wrap.appendChild(
    el("div", { className: "regionsHead" }, [
      el(
        "div",
        { className: "regionsTitle" },
        "Areas (in heat flow direction)"
      ),
      el(
        "div",
        { className: "regionsSub" },
        "Each area runs through the full thickness of this layer; the area fractions f must sum to 1."
      ),
    ])
  );

  layer.regions.forEach((region, regionIndex) => {
    wrap.appendChild(renderRegionRow(layer, layerIndex, region, regionIndex));
  });

  // fraction sum check + add/auto-balance
  const sum = regionFractionSum(layer);
  const sumOk = Math.abs(sum - 1) < 1e-6;
  wrap.appendChild(
    el("div", { className: "regionsFooter" }, [
      el(
        "div",
        {
          className: "fractionSum" + (sumOk ? " is-ok" : " is-warn"),
        },
        [
          el("span", { className: "fractionSumLabel" }, "Σ f = "),
          el("span", { className: "fractionSumValue" }, fmtPct(sum) + " %"),
          !sumOk
            ? el(
                "span",
                { className: "fractionSumHint" },
                " (must be 100.0 %)"
              )
            : null,
        ]
      ),
      el("div", { className: "regionsBtns" }, [
        layer.regions.length === 2
          ? null
          : el(
              "button",
              {
                type: "button",
                className: "miniBtn",
                onClick: () => {
                  // Distribute equally across all regions
                  const n = layer.regions.length;
                  for (const r of layer.regions) r.fraction = 1 / n;
                  persist();
                  render();
                },
              },
              "Equalise"
            ),
        el(
          "button",
          {
            type: "button",
            className: "miniBtn",
            onClick: () => {
              layer.regions.push(freshRegion(0));
              persist();
              render();
            },
          },
          "+ Area"
        ),
      ]),
    ])
  );

  return wrap;
}

function renderRegionRow(layer, layerIndex, region, regionIndex) {
  const letter = String.fromCharCode(97 + regionIndex); // a, b, c …

  const row = el("div", { className: "regionRow" });

  row.appendChild(
    el("div", { className: "regionLetter" }, letter)
  );

  // Material picker
  const matCol = el("div", { className: "regionMat" }, [
    renderMaterialPicker({
      currentMaterialId: region.materialId,
      currentCustomName: region.customName,
      ariaLabel: `Layer ${layerIndex + 1} area ${letter} material`,
      popoverKey: `m1.2-l${layerIndex}-r${regionIndex}`,
      onPick: ({ materialId, material }) => {
        region.materialId = materialId;
        if (material && Number.isFinite(material.lambda)) {
          region.lambda_W_mK = material.lambda;
        }
        persist();
        render();
      },
    }),
    region.materialId == null
      ? el("input", {
          type: "text",
          className: "customNameInput",
          placeholder: "Custom name",
          value: region.customName || "",
          onInput: (e) => {
            region.customName = e.target.value;
            persist();
          },
        })
      : null,
  ]);
  row.appendChild(matCol);

  // λ
  row.appendChild(
    el("div", { className: "regionLam" }, [
      el("input", {
        type: "number",
        className: "num",
        step: "0.001",
        min: "0",
        inputmode: "decimal",
        "aria-label": `Layer ${layerIndex + 1} area ${letter} lambda`,
        value: region.lambda_W_mK != null ? String(region.lambda_W_mK) : "",
        onInput: (e) => {
          const v = parseFloat(e.target.value);
          region.lambda_W_mK =
            Number.isFinite(v) && v > 0 ? v : null;
          persist();
          updateResults();
        },
      }),
      el("span", { className: "regionUnit" }, "W/(m·K)"),
    ])
  );

  // f (as percent)
  row.appendChild(
    el("div", { className: "regionFrac" }, [
      el("input", {
        type: "number",
        className: "num",
        step: "0.1",
        min: "0",
        max: "100",
        inputmode: "decimal",
        "aria-label": `Layer ${layerIndex + 1} area ${letter} fraction in percent`,
        value:
          Number.isFinite(region.fraction)
            ? (region.fraction * 100)
                .toLocaleString("en-GB", {
                  maximumFractionDigits: 2,
                  useGrouping: false,
                })
            : "",
        onInput: (e) => {
          const pct = parseFloat(e.target.value);
          if (!Number.isFinite(pct) || pct < 0) {
            region.fraction = null;
          } else {
            region.fraction = pct / 100;
          }
          // 2-region auto-complement
          if (layer.regions.length === 2 && Number.isFinite(region.fraction)) {
            const otherIdx = regionIndex === 0 ? 1 : 0;
            layer.regions[otherIdx].fraction = 1 - region.fraction;
          }
          persist();
          // Re-render the regions sub-block so the partner field and Σf update.
          render();
        },
      }),
      el("span", { className: "regionUnit" }, "%"),
    ])
  );

  // Remove area (only if more than 2)
  row.appendChild(
    el("div", { className: "regionAct" }, [
      layer.regions.length > 2
        ? el(
            "button",
            {
              type: "button",
              className: "rmBtnSmall",
              "aria-label": `Remove area ${letter}`,
              onClick: () => {
                layer.regions.splice(regionIndex, 1);
                persist();
                render();
              },
            },
            "×"
          )
        : null,
    ])
  );

  return row;
}

// ── results section ─────────────────────────────────────────────────

function renderResults() {
  const section = el("section", {
    className: "block results",
    id: "resultsSectionInhom",
  });
  buildResultsContent(section);
  return section;
}

function buildResultsContent(section) {
  clear(section);
  const r = results();

  // Hero
  section.appendChild(
    el("div", { className: "hero" }, [
      el("div", { className: "heroLabel" }, "U-value"),
      el("div", { className: "heroLine" }, [
        el("span", { className: "heroValue" }, r.U != null ? fmt3(r.U) : "—"),
        el("span", { className: "heroUnit" }, "W/(m²·K)"),
      ]),
    ])
  );

  // Breakdown
  const breakdown = el("div", { className: "breakdown" });
  breakdown.appendChild(
    resRow(
      [renderDisplay(SHARED_POOL.thermal_resistance_total_upper.display),
       el("span", { className: "rowSub" }, "upper bound")],
      r.R_T_upper != null ? fmt3(r.R_T_upper) : "—",
      "(m²·K)/W"
    )
  );
  breakdown.appendChild(
    resRow(
      [renderDisplay(SHARED_POOL.thermal_resistance_total_lower.display),
       el("span", { className: "rowSub" }, "lower bound")],
      r.R_T_lower != null ? fmt3(r.R_T_lower) : "—",
      "(m²·K)/W"
    )
  );
  breakdown.appendChild(
    resRow(
      [renderDisplay(SHARED_POOL.thermal_resistance_total.display),
       el("span", { className: "rowSub" }, "mean")],
      r.R_T != null ? fmt3(r.R_T) : "—",
      "(m²·K)/W",
      "rTotalLine"
    )
  );
  section.appendChild(breakdown);

  if (r.incomplete) {
    section.appendChild(
      el(
        "p",
        { className: "hint" },
        "Complete every layer (thickness, λ, and — for inhomogeneous layers — fractions summing to 100 %) to obtain a U-value."
      )
    );
    return;
  }

  // Calculation steps (collapsible, default open)
  section.appendChild(buildCalculationSteps(r));

  // Temperature profile sub-section (simplified)
  if (r.profile) {
    section.appendChild(buildTemperatureProfileBlock(r));
  }
}

function updateResults() {
  const section = document.getElementById("resultsSectionInhom");
  if (section) buildResultsContent(section);
}

// ── calculation-steps block (the meat of 1.2) ──────────────────────

function buildCalculationSteps(r) {
  const wrap = el("details", { className: "calcSteps", open: "" }, [
    el("summary", { className: "calcStepsHead" }, "Calculation steps"),
  ]);

  // Intro paragraph
  wrap.appendChild(
    el("p", { className: "calcIntro" }, [
      "Two bounds are computed and averaged. The upper bound treats the build-up as a set of parallel cross-sections through the component; the lower bound averages resistances within each layer.",
    ])
  );

  // ── STEP 1: cross-sections for the upper bound ──────────────────
  wrap.appendChild(stepHeading("1", "Cross-sections (upper bound)"));

  const sections = r.upper.sections;
  wrap.appendChild(
    el("p", { className: "calcText" }, [
      "Each cross-section ",
      el("span", { className: "math" }, "j"),
      " runs in heat-flow direction and is treated as a homogeneous build-up with its own area fraction ",
      el("span", { className: "math" }, "f"),
      el("sub", {}, "j"),
      ". For two regions this is a single split (Σ f = 1); more inhomogeneous layers form the Cartesian product of region choices.",
    ])
  );

  for (const s of sections) {
    const sectionLetter = String.fromCharCode(96 + s.index); // a, b, c…
    const sectionHead = el("div", { className: "sectionHead" }, [
      el("span", { className: "sectionLetter" }, sectionLetter),
      el("span", { className: "sectionFrac" }, [
        " f = ",
        fmtCalc(s.fraction),
        " (= ",
        fmtPct(s.fraction),
        " %)",
      ]),
    ]);
    wrap.appendChild(sectionHead);

    // R_T,j = R_si + Σ R_i + R_se   — with numeric d/λ for each layer
    const layerTerms = s.perLayer
      .map((pl) => `${fmtCalc(pl.d_m)} / ${fmtCalc(pl.lambda)}`)
      .join(" + ");
    const layerVals = s.perLayer.map((pl) => fmtCalc(pl.R)).join(" + ");

    wrap.appendChild(
      formulaLine(
        el("span", {}, [
          renderDisplay(SHARED_POOL.thermal_resistance_total.display),
          el("sub", {}, sectionLetter),
        ]),
        `${fmtCalc(r.R_si)} + ${layerTerms} + ${fmtCalc(r.R_se)}`,
        null,
        null
      )
    );
    wrap.appendChild(
      formulaLine(
        el("span", {}, [
          renderDisplay(SHARED_POOL.thermal_resistance_total.display),
          el("sub", {}, sectionLetter),
        ]),
        `${fmtCalc(r.R_si)} + ${layerVals} + ${fmtCalc(r.R_se)}`,
        fmtCalc(s.R_Tj),
        "(m²·K)/W"
      )
    );
  }

  // 1/R_T' = Σ f_j / R_T,j
  wrap.appendChild(stepHeading("2", "Upper bound of total resistance"));

  const upperInvTerms = sections
    .map((s) => {
      const letter = String.fromCharCode(96 + s.index);
      return `${fmtCalc(s.fraction)} / ${fmtCalc(s.R_Tj)}`;
    })
    .join(" + ");
  const invUpper = 1 / r.R_T_upper;
  wrap.appendChild(
    formulaLine(
      el("span", {}, [
        "1 / ",
        renderDisplay(SHARED_POOL.thermal_resistance_total_upper.display),
      ]),
      upperInvTerms,
      fmtCalc(invUpper),
      "W/(m²·K)"
    )
  );
  wrap.appendChild(
    formulaLine(
      el("span", {}, [
        renderDisplay(SHARED_POOL.thermal_resistance_total_upper.display),
      ]),
      `1 / ${fmtCalc(invUpper)}`,
      fmtCalc(r.R_T_upper),
      "(m²·K)/W"
    )
  );

  // ── STEP 3: lower bound ─────────────────────────────────────────
  wrap.appendChild(stepHeading("3", "Lower bound — layer-wise area-weighted resistance"));
  wrap.appendChild(
    el("p", { className: "calcText" }, [
      "For each layer i, an effective resistance is obtained: homogeneous layers contribute d/λ, inhomogeneous layers contribute the area-weighted harmonic mean of their region resistances.",
    ])
  );

  const lowerPerLayer = r.lower.perLayer;
  for (let i = 0; i < lowerPerLayer.length; i++) {
    const pl = lowerPerLayer[i];
    const layerHead = el("div", { className: "sectionHead" }, [
      el("span", { className: "sectionLetter" }, `Layer ${i + 1}`),
      el(
        "span",
        { className: "sectionFrac" },
        ` (${pl.type === "homogeneous" ? "homogeneous" : "inhomogeneous"})`
      ),
    ]);
    wrap.appendChild(layerHead);

    if (pl.type === "homogeneous") {
      wrap.appendChild(
        formulaLine(
          el("span", {}, [
            renderDisplay(SHARED_POOL.thermal_resistance_layer.display),
            el("sub", {}, String(i + 1)),
          ]),
          `${fmtCalc(pl.d_m)} / ${fmtCalc(pl.lambda_eff)}`,
          fmtCalc(pl.R),
          "(m²·K)/W"
        )
      );
    } else {
      // inhomogeneous: 1/R_i = Σ f_k · λ_k / d
      const terms = pl.regions
        .map((reg) => {
          return `${fmtCalc(reg.fraction)} · ${fmtCalc(
            reg.lambda_W_mK
          )} / ${fmtCalc(pl.d_m)}`;
        })
        .join(" + ");
      const invR = 1 / pl.R;
      wrap.appendChild(
        formulaLine(
          el("span", {}, [
            "1 / ",
            renderDisplay(SHARED_POOL.thermal_resistance_layer.display),
            el("sub", {}, String(i + 1)),
          ]),
          terms,
          fmtCalc(invR),
          "W/(m²·K)"
        )
      );
      wrap.appendChild(
        formulaLine(
          el("span", {}, [
            renderDisplay(SHARED_POOL.thermal_resistance_layer.display),
            el("sub", {}, String(i + 1)),
          ]),
          `1 / ${fmtCalc(invR)}`,
          fmtCalc(pl.R),
          "(m²·K)/W"
        )
      );
      // Show λ_eff hint, used by the simplified profile
      wrap.appendChild(
        el("div", { className: "calcAside" }, [
          "equivalent ",
          renderDisplay(SHARED_POOL.lambda_effective.display),
          ` = ${fmtCalc(pl.lambda_eff)} W/(m·K) — used by the simplified temperature profile below.`,
        ])
      );
    }
  }

  // R_T'' = R_si + Σ R_i + R_se
  wrap.appendChild(stepHeading("4", "Lower bound of total resistance"));
  const lowerLayerSum = lowerPerLayer
    .map((pl) => fmtCalc(pl.R))
    .join(" + ");
  wrap.appendChild(
    formulaLine(
      el("span", {}, [
        renderDisplay(SHARED_POOL.thermal_resistance_total_lower.display),
      ]),
      `${fmtCalc(r.R_si)} + ${lowerLayerSum} + ${fmtCalc(r.R_se)}`,
      fmtCalc(r.R_T_lower),
      "(m²·K)/W"
    )
  );

  // ── STEP 5: mean ────────────────────────────────────────────────
  wrap.appendChild(stepHeading("5", "Total thermal resistance (mean)"));
  wrap.appendChild(
    formulaLine(
      el("span", {}, [
        renderDisplay(SHARED_POOL.thermal_resistance_total.display),
      ]),
      `(${fmtCalc(r.R_T_upper)} + ${fmtCalc(r.R_T_lower)}) / 2`,
      fmtCalc(r.R_T),
      "(m²·K)/W"
    )
  );

  // ── STEP 6: U = 1 / R_T ─────────────────────────────────────────
  wrap.appendChild(stepHeading("6", "Thermal transmittance"));
  wrap.appendChild(
    formulaLine(
      el("span", {}, [
        renderDisplay(SHARED_POOL.thermal_transmittance.display),
      ]),
      `1 / ${fmtCalc(r.R_T)}`,
      fmtU(r.U),
      "W/(m²·K)"
    )
  );

  return wrap;
}

// ── temperature profile (simplified) ────────────────────────────────

function buildTemperatureProfileBlock(r) {
  const p = r.profile;
  const block = el("div", { className: "profileBlock" });

  block.appendChild(
    el("div", { className: "profileHead" }, [
      el("div", { className: "profileTitle" }, "Temperature profile"),
      el(
        "div",
        { className: "profileSub" },
        "Simplified 1-D model · inhomogeneous layers replaced by λ\u2009eff = Σ\u202ff\u202ck · λ\u202ck"
      ),
    ])
  );

  block.appendChild(
    el("p", { className: "profileWarn" }, [
      "The real temperature field in an inhomogeneous build-up is two-dimensional. " +
        "This profile uses the area-weighted effective λ per inhomogeneous layer — useful for orientation, not for condensation analysis at thermal bridges.",
    ])
  );

  // Boundary inputs
  const boundaryRow = el("div", { className: "boundaryRow" });
  const mkBoundaryInput = (id, labelSpec, value, onChange) => {
    const input = el("input", {
      type: "number",
      id,
      className: "num numCompact",
      step: "0.1",
      inputmode: "decimal",
      value: String(value),
      "aria-label": labelSpec.name,
      onInput: (e) => onChange(parseFloat(e.target.value)),
    });
    const labelEl = el("label", { for: id, className: "boundaryLabel" });
    labelEl.appendChild(renderDisplay(labelSpec.display));
    return el("div", { className: "boundaryField" }, [
      labelEl,
      input,
      el("span", { className: "boundaryUnit" }, "°C"),
    ]);
  };
  boundaryRow.appendChild(
    mkBoundaryInput(
      "thetaI_inhom",
      SHARED_POOL.theta_indoor_air,
      state.theta_i_C,
      (v) => {
        state.theta_i_C = Number.isFinite(v) ? v : state.theta_i_C;
        persist();
        updateResults();
      }
    )
  );
  boundaryRow.appendChild(
    mkBoundaryInput(
      "thetaE_inhom",
      SHARED_POOL.theta_outdoor_air,
      state.theta_e_C,
      (v) => {
        state.theta_e_C = Number.isFinite(v) ? v : state.theta_e_C;
        persist();
        updateResults();
      }
    )
  );
  block.appendChild(boundaryRow);

  // q hero — NB: the simplified profile uses R_T_lower internally because
  // the lower-bound = equivalent-homogeneous R_T. We surface the q value
  // it actually computed with (so it stays self-consistent with the diagram).
  const qHero = el("div", { className: "qLine" }, [
    el("span", { className: "qLabel" }, [
      renderDisplay(SHARED_POOL.heat_flux_density.display),
      el("span", { className: "qSub" }, "via equivalent λeff stack"),
    ]),
    el("span", { className: "qValueGroup" }, [
      el("span", { className: "qValue" }, fmt2(p.q)),
      el("span", { className: "qUnit" }, "W/m²"),
    ]),
  ]);
  block.appendChild(qHero);

  block.appendChild(buildThetaTable(p));
  block.appendChild(buildTemperatureDiagram(p, r.layerNames, r.layerTypes));

  return block;
}

function buildThetaTable(p) {
  const table = el("table", { className: "thetaTable" });
  table.appendChild(
    el("thead", {}, [
      el("tr", {}, [
        el("th", {}, "Point"),
        el("th", {}, [
          el("span", {}, "x"),
          el("span", { className: "tUnit" }, "m"),
        ]),
        el("th", {}, [
          el("span", {}, "θ"),
          el("span", { className: "tUnit" }, "°C"),
        ]),
      ]),
    ])
  );
  const tbody = el("tbody");
  for (const node of p.nodes) {
    tbody.appendChild(
      el("tr", {}, [
        el("td", {}, formatThetaLabel(node.label)),
        el("td", { className: "tNum" }, fmtD(node.x)),
        el("td", { className: "tNum" }, fmtTheta(node.theta)),
      ])
    );
  }
  table.appendChild(tbody);
  return table;
}

function formatThetaLabel(raw) {
  const m = String(raw).match(/^θ_?(.+)$/);
  if (!m) return raw;
  return el("span", {}, ["θ", el("sub", {}, m[1])]);
}

// SVG diagram — same shape as 1.1 but with diagonal hatch on
// inhomogeneous bands so the simplification is visually obvious.
function buildTemperatureDiagram(profile, layerNames, layerTypes) {
  const VB_W = 700, VB_H = 400;
  const M = { top: 20, right: 30, bottom: 60, left: 50 };
  const innerW = VB_W - M.left - M.right;
  const innerH = VB_H - M.top - M.bottom;

  const totalD = profile.layers.reduce((a, l) => a + l.d_m, 0);
  if (totalD <= 0) return el("div");

  const thetaMin = Math.min(
    profile.theta_e_C,
    ...profile.nodes.map((n) => n.theta)
  );
  const thetaMax = Math.max(
    profile.theta_i_C,
    ...profile.nodes.map((n) => n.theta)
  );
  const thetaSpan = Math.max(thetaMax - thetaMin, 1);
  const thetaPad = thetaSpan * 0.1;
  const yMin = thetaMin - thetaPad;
  const yMax = thetaMax + thetaPad;
  const yScale = (theta) =>
    M.top + innerH * (1 - (theta - yMin) / (yMax - yMin));
  const xScale = (x) => M.left + innerW * (x / totalD);

  const root_svg = svg(
    "svg",
    {
      viewBox: `0 0 ${VB_W} ${VB_H}`,
      class: "tempDiagram",
      role: "img",
      "aria-label": "Simplified temperature profile diagram",
    },
    []
  );

  // Hatch pattern definition (used for inhom bands)
  const defs = svg("defs", {});
  const pattern = svg(
    "pattern",
    {
      id: "inhomHatch",
      width: "6",
      height: "6",
      patternUnits: "userSpaceOnUse",
      patternTransform: "rotate(45)",
    },
    [
      svg("line", {
        x1: 0,
        y1: 0,
        x2: 0,
        y2: 6,
        class: "inhomHatchLine",
      }),
    ]
  );
  defs.appendChild(pattern);
  root_svg.appendChild(defs);

  let xCursor = 0;
  for (let i = 0; i < profile.layers.length; i++) {
    const d = profile.layers[i].d_m;
    const x1 = xScale(xCursor);
    const x2 = xScale(xCursor + d);
    const cls =
      (i % 2 === 0 ? "layerBandA" : "layerBandB") +
      (layerTypes && layerTypes[i] === "inhomogeneous"
        ? " layerBandInhom"
        : "");
    root_svg.appendChild(
      svg("rect", {
        x: x1,
        y: M.top,
        width: x2 - x1,
        height: innerH,
        class: cls,
      })
    );
    if (layerTypes && layerTypes[i] === "inhomogeneous") {
      // overlay hatch
      root_svg.appendChild(
        svg("rect", {
          x: x1,
          y: M.top,
          width: x2 - x1,
          height: innerH,
          fill: "url(#inhomHatch)",
        })
      );
    }
    if (i > 0) {
      root_svg.appendChild(
        svg("line", {
          x1,
          y1: M.top,
          x2: x1,
          y2: M.top + innerH,
          class: "interfaceLine",
        })
      );
    }
    const bandW = x2 - x1;
    const labelText =
      bandW < 60
        ? String(i + 1)
        : (layerNames && layerNames[i]) || `Layer ${i + 1}`;
    root_svg.appendChild(
      svg(
        "text",
        {
          x: (x1 + x2) / 2,
          y: M.top + innerH + 20,
          "text-anchor": "middle",
          class: "layerLabel",
        },
        labelText
      )
    );
    xCursor += d;
  }

  // Surface lines
  root_svg.appendChild(
    svg("line", {
      x1: M.left,
      y1: M.top,
      x2: M.left,
      y2: M.top + innerH,
      class: "surfaceLine",
    })
  );
  root_svg.appendChild(
    svg("line", {
      x1: M.left + innerW,
      y1: M.top,
      x2: M.left + innerW,
      y2: M.top + innerH,
      class: "surfaceLine",
    })
  );

  // Polyline through θ nodes (excluding θ_i and θ_e which sit in the air)
  const polyNodes = profile.nodes.filter(
    (n) => n.label !== "θ_i" && n.label !== "θ_e"
  );
  const polyPts = polyNodes
    .map((n) => `${xScale(n.x)},${yScale(n.theta)}`)
    .join(" ");
  root_svg.appendChild(
    svg("polyline", { points: polyPts, class: "thetaCurve" })
  );

  for (const n of polyNodes) {
    root_svg.appendChild(
      svg("circle", {
        cx: xScale(n.x),
        cy: yScale(n.theta),
        r: 3.5,
        class: "thetaDot",
      })
    );
  }

  // Labels with two-pass collision avoidance
  const placed = [];
  const MIN_GAP = 32;
  for (let i = 0; i < polyNodes.length; i++) {
    const n = polyNodes[i];
    const cx = xScale(n.x);
    const cy = yScale(n.theta);
    const above = i % 2 === 0;
    const ly = above ? cy - 10 : cy + 16;
    if (
      placed.some(
        (q) => Math.abs(q.cx - cx) < MIN_GAP && Math.abs(q.ly - ly) < 14
      )
    )
      continue;
    placed.push({ cx, ly });
    root_svg.appendChild(
      svg(
        "text",
        {
          x: cx,
          y: ly,
          "text-anchor": "middle",
          class: above ? "thetaLabelAbove" : "thetaLabelBelow",
        },
        fmtTheta(n.theta) + "°C"
      )
    );
  }

  return el("div", { className: "tempDiagramWrap" }, root_svg);
}

// ── footer ──────────────────────────────────────────────────────────

function renderFooter() {
  return el("footer", { className: "appFooter" }, [
    el(
      "button",
      {
        type: "button",
        className: "resetBtn",
        onClick: () => {
          if (!window.confirm("Reset this calculation? Cannot be undone."))
            return;
          state = defaultState();
          persist();
          render();
        },
      },
      "Reset"
    ),
    el("p", { className: "src" }, [
      "Method: DIN EN ISO 6946 — Willems Lehrbuch der Bauphysik, 9. Aufl. 2022, §2.3.4.2, pp. 36–38. ",
      DATA_SOURCE_NOTE,
    ]),
  ]);
}

// ── module API ──────────────────────────────────────────────────────

export function mount(rootEl) {
  root = rootEl;
  state = loadQuickCalcInhomog() || defaultState();
  if (!Number.isFinite(state.theta_i_C)) state.theta_i_C = 20;
  if (!Number.isFinite(state.theta_e_C)) state.theta_e_C = -10;
  render();
}

export function unmount() {
  closeOpenPicker();
  if (root) clear(root);
  root = null;
}
