// Submodule 1.1 — U-value, homogeneous component.
//
// UI controller; calculation logic lives in ./uvalue.js and
// ./temperature-profile.js. Pure DOM API; no innerHTML.

import { computeUValue, surfaceResistancesFor } from "./uvalue.js";
import { computeTemperatureProfile } from "./temperature-profile.js";
import {
  MATERIAL_BY_ID,
  SURFACE_RESISTANCES,
  DATA_SOURCE_NOTE,
} from "./reference-data.js";
import { SHARED_POOL } from "./notation.js";
import { loadQuickCalc, saveQuickCalc } from "./persistence.js";
import {
  el,
  svg,
  clear,
  renderDisplay,
  fmt2,
  fmt3,
  fmtCalc,
  fmtTheta,
  fmtD,
  fmtU,
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
  saveQuickCalc(state);
}

function freshLayer() {
  return {
    materialId: null,
    customName: "",
    lambda_W_mK: null,
    thickness_m: null,
  };
}

// ── derived per-layer ───────────────────────────────────────────────

function layerResistanceOrNull(layer) {
  if (
    !Number.isFinite(layer.lambda_W_mK) ||
    layer.lambda_W_mK <= 0 ||
    !Number.isFinite(layer.thickness_m) ||
    layer.thickness_m < 0
  ) {
    return null;
  }
  return layer.thickness_m / layer.lambda_W_mK;
}

function effectiveLayerName(layer) {
  if (layer.materialId && MATERIAL_BY_ID[layer.materialId]) {
    return MATERIAL_BY_ID[layer.materialId].name;
  }
  return layer.customName || "(custom layer)";
}

// ── results ─────────────────────────────────────────────────────────

function results() {
  const validLayers = state.layers
    .filter(
      (l) =>
        Number.isFinite(l.lambda_W_mK) &&
        l.lambda_W_mK > 0 &&
        Number.isFinite(l.thickness_m) &&
        l.thickness_m > 0
    )
    .map((l) => ({ d_m: l.thickness_m, lambda_W_mK: l.lambda_W_mK }));

  const { R_si, R_se } = surfaceResistancesFor(state.heatFlowDirection);

  if (validLayers.length === 0) {
    return {
      incomplete: true,
      R_si,
      R_se,
      R_layers: 0,
      R_T: null,
      U: null,
      profile: null,
    };
  }
  const r = computeUValue({
    layers: validLayers,
    heatFlowDirection: state.heatFlowDirection,
  });

  let profile = null;
  if (Number.isFinite(state.theta_i_C) && Number.isFinite(state.theta_e_C)) {
    try {
      profile = computeTemperatureProfile({
        layers: validLayers,
        heatFlowDirection: state.heatFlowDirection,
        theta_i_C: state.theta_i_C,
        theta_e_C: state.theta_e_C,
      });
    } catch {
      profile = null;
    }
  }

  const validLayerNames = state.layers
    .filter(
      (l) =>
        Number.isFinite(l.lambda_W_mK) &&
        l.lambda_W_mK > 0 &&
        Number.isFinite(l.thickness_m) &&
        l.thickness_m > 0
    )
    .map((l) => effectiveLayerName(l));

  return { incomplete: false, ...r, profile, layerNames: validLayerNames };
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
    el("div", { className: "moduleChapter", "aria-hidden": "true" }, "1.1"),
    el("div", { className: "moduleHeadText" }, [
      el("h2", { className: "moduleTitle" }, [
        "U-value ",
        el("em", {}, "— homogeneous component"),
      ]),
      el(
        "p",
        { className: "moduleSub" },
        "Steady-state, one-dimensional heat flow through a homogeneous build-up. " +
          "Layers ordered from interior to exterior."
      ),
    ]),
  ]);
}

function renderComponentName() {
  const input = el("input", {
    type: "text",
    id: "componentName",
    className: "nameInput",
    placeholder: "e.g. exterior wall — typical",
    value: state.componentName,
    onInput: (e) => {
      state.componentName = e.target.value;
      persist();
    },
  });
  return el("section", { className: "block" }, [
    el("label", { for: "componentName", className: "label" }, "Component name"),
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
    const id = `flow_${dir}`;
    const radio = el("input", {
      type: "radio",
      name: "heatFlow",
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
    meta.appendChild(renderDisplay(SHARED_POOL.surface_resistance_internal.display));
    meta.appendChild(document.createTextNode(` = ${fmt2(sr.R_si)}, `));
    meta.appendChild(renderDisplay(SHARED_POOL.surface_resistance_external.display));
    meta.appendChild(document.createTextNode(` = ${fmt2(sr.R_se)} (m²·K)/W`));
    labelChildren.push(meta);

    const label = el("label", { for: id, className: "radioLabel" }, labelChildren);
    group.appendChild(el("div", { className: "radioRow" }, [radio, label]));
  }
  wrap.appendChild(group);
  return wrap;
}

function renderLayers() {
  const section = el("section", { className: "block" }, [
    el("div", { className: "label" }, "Layers (interior → exterior)"),
  ]);
  const table = el("table", { className: "layers" });

  const thead = el("thead", {}, [
    el("tr", {}, [
      el("th", { className: "colNum" }, "#"),
      el("th", { className: "colMat" }, "Material"),
      el("th", { className: "colLam" }, [
        renderDisplay(SHARED_POOL.lambda_thermal_conductivity.display),
        el("span", { className: "unit" }, " W/(m·K)"),
      ]),
      el("th", { className: "colThk" }, [
        renderDisplay(SHARED_POOL.layer_thickness.display),
        el("span", { className: "unit" }, " mm"),
      ]),
      el("th", { className: "colR" }, [
        renderDisplay(SHARED_POOL.thermal_resistance_layer.display),
        el("span", { className: "unit" }, " (m²·K)/W"),
      ]),
      el("th", { className: "colAct" }, ""),
    ]),
  ]);
  table.appendChild(thead);

  const tbody = el("tbody");
  state.layers.forEach((layer, index) => {
    tbody.appendChild(renderLayerRow(layer, index));
  });
  table.appendChild(tbody);
  section.appendChild(table);

  section.appendChild(
    el(
      "button",
      {
        type: "button",
        className: "addBtn",
        onClick: () => {
          state.layers.push(freshLayer());
          persist();
          render();
        },
      },
      "+ Add layer"
    )
  );

  return section;
}

function renderLayerRow(layer, index) {
  const row = el("tr", {});

  row.appendChild(el("td", { className: "colNum" }, String(index + 1)));

  const matCell = el("td", { className: "colMat" });
  matCell.appendChild(
    renderMaterialPicker({
      currentMaterialId: layer.materialId,
      currentCustomName: layer.customName,
      ariaLabel: `Layer ${index + 1} material`,
      popoverKey: `m1.1-layer-${index}`,
      onPick: ({ materialId, material }) => {
        layer.materialId = materialId;
        if (material && Number.isFinite(material.lambda)) {
          layer.lambda_W_mK = material.lambda;
        }
        persist();
        render();
      },
    })
  );

  if (layer.materialId == null) {
    matCell.appendChild(
      el("input", {
        type: "text",
        className: "customNameInput",
        placeholder: "Custom name (optional)",
        value: layer.customName || "",
        "aria-label": `Layer ${index + 1} custom name`,
        onInput: (e) => {
          layer.customName = e.target.value;
          persist();
        },
      })
    );
  }
  row.appendChild(matCell);

  const lambdaInput = el("input", {
    type: "number",
    className: "num",
    step: "0.001",
    min: "0",
    inputmode: "decimal",
    value: layer.lambda_W_mK != null ? String(layer.lambda_W_mK) : "",
    "aria-label": `Layer ${index + 1} lambda`,
    onInput: (e) => {
      const v = parseFloat(e.target.value);
      layer.lambda_W_mK = Number.isFinite(v) && v > 0 ? v : null;
      persist();
      updateRowDerived(row, layer);
      updateResults();
    },
  });
  row.appendChild(el("td", { className: "colLam" }, lambdaInput));

  const thkInput = el("input", {
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
      updateRowDerived(row, layer);
      updateResults();
    },
  });
  row.appendChild(el("td", { className: "colThk" }, thkInput));

  const r = layerResistanceOrNull(layer);
  row.appendChild(
    el(
      "td",
      { className: "colR derived", "data-role": "rCell" },
      r != null ? fmt3(r) : "—"
    )
  );

  row.appendChild(
    el("td", { className: "colAct" }, [
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

  return row;
}

function updateRowDerived(row, layer) {
  const rCell = row.querySelector('[data-role="rCell"]');
  if (!rCell) return;
  clear(rCell);
  const r = layerResistanceOrNull(layer);
  rCell.appendChild(document.createTextNode(r != null ? fmt3(r) : "—"));
}

// ── results section ─────────────────────────────────────────────────

function renderResults() {
  const section = el("section", {
    className: "block results",
    id: "resultsSection",
  });
  buildResultsContent(section);
  return section;
}

function buildResultsContent(section) {
  clear(section);
  const r = results();

  const heroValueText = r.U != null ? fmt3(r.U) : "—";
  const hero = el("div", { className: "hero" }, [
    el("div", { className: "heroLabel" }, "U-value"),
    el("div", { className: "heroLine" }, [
      el("span", { className: "heroValue" }, heroValueText),
      el("span", { className: "heroUnit" }, "W/(m²·K)"),
    ]),
  ]);
  section.appendChild(hero);

  const breakdown = el("div", { className: "breakdown" });
  breakdown.appendChild(
    resRow(
      [
        renderDisplay(SHARED_POOL.thermal_resistance_layer.display),
        el("span", { className: "rowSub" }, "Σ layers"),
      ],
      r.R_layers != null ? fmt3(r.R_layers) : "—",
      "(m²·K)/W"
    )
  );
  breakdown.appendChild(
    resRow(
      [renderDisplay(SHARED_POOL.surface_resistance_internal.display)],
      fmt2(r.R_si),
      "(m²·K)/W"
    )
  );
  breakdown.appendChild(
    resRow(
      [renderDisplay(SHARED_POOL.surface_resistance_external.display)],
      fmt2(r.R_se),
      "(m²·K)/W"
    )
  );
  breakdown.appendChild(
    resRow(
      [renderDisplay(SHARED_POOL.thermal_resistance_total.display)],
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
        "Add at least one layer with thickness and λ to obtain a U-value."
      )
    );
  }

  if (!r.incomplete && r.profile) {
    section.appendChild(buildTemperatureProfileBlock(r));
  }
}

function updateResults() {
  const section = document.getElementById("resultsSection");
  if (section) buildResultsContent(section);
}

// ── Temperature profile block ───────────────────────────────────────

function buildTemperatureProfileBlock(r) {
  const p = r.profile;
  const block = el("div", { className: "profileBlock" });

  block.appendChild(
    el("div", { className: "profileHead" }, [
      el("div", { className: "profileTitle" }, "Temperature profile"),
      el("div", { className: "profileSub" }, "Steady-state, 1-D · Willems §2.4"),
    ])
  );

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
    mkBoundaryInput("thetaI", SHARED_POOL.theta_indoor_air, state.theta_i_C, (v) => {
      state.theta_i_C = Number.isFinite(v) ? v : state.theta_i_C;
      persist();
      updateResults();
    })
  );
  boundaryRow.appendChild(
    mkBoundaryInput("thetaE", SHARED_POOL.theta_outdoor_air, state.theta_e_C, (v) => {
      state.theta_e_C = Number.isFinite(v) ? v : state.theta_e_C;
      persist();
      updateResults();
    })
  );
  block.appendChild(boundaryRow);

  const qHero = el("div", { className: "qLine" }, [
    el("span", { className: "qLabel" }, [
      renderDisplay(SHARED_POOL.heat_flux_density.display),
      el("span", { className: "qSub" }, "heat flux density"),
    ]),
    el("span", { className: "qValueGroup" }, [
      el("span", { className: "qValue" }, fmt2(p.q)),
      el("span", { className: "qUnit" }, "W/m²"),
    ]),
  ]);
  block.appendChild(qHero);

  block.appendChild(buildThetaTable(p));
  block.appendChild(buildCalculationSteps(p));
  block.appendChild(buildTemperatureDiagram(p, r.layerNames));

  return block;
}

// θ-table builder
function buildThetaTable(p) {
  const table = el("table", { className: "thetaTable" });
  const thead = el("thead", {}, [
    el("tr", {}, [
      el("th", {}, "Point"),
      el("th", {}, [el("span", {}, "x"), el("span", { className: "tUnit" }, "m")]),
      el("th", {}, [
        el("span", {}, "θ"),
        el("span", { className: "tUnit" }, "°C"),
      ]),
    ]),
  ]);
  table.appendChild(thead);

  const tbody = el("tbody");
  for (const node of p.nodes) {
    const row = el("tr", {}, [
      el("td", {}, formatThetaLabel(node.label)),
      el("td", { className: "tNum" }, fmtD(node.x)),
      el("td", { className: "tNum" }, fmtTheta(node.theta)),
    ]);
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
  return table;
}

function formatThetaLabel(raw) {
  // raw can be "θ_si", "θ_se", "θ_1/2", "θ_i", "θ_e", etc.
  const m = String(raw).match(/^θ_?(.+)$/);
  if (!m) return raw;
  return el("span", {}, [
    "θ",
    el("sub", {}, m[1]),
  ]);
}

// Calculation steps
function buildCalculationSteps(p) {
  const wrap = el("details", { className: "calcSteps", open: "" }, [
    el("summary", { className: "calcStepsHead" }, "Calculation steps"),
  ]);

  // Step 1 — R_T = R_si + Σ R_i + R_se
  wrap.appendChild(stepHeading("1", "Total thermal resistance"));
  const rt_sym = el("span", {}, [
    renderDisplay(SHARED_POOL.thermal_resistance_total.display),
  ]);
  const rt_num = `${fmtCalc(p.R_si)} + ${p.R_layers
    .map(fmtCalc)
    .join(" + ")} + ${fmtCalc(p.R_se)}`;
  wrap.appendChild(
    formulaLine(rt_sym, rt_num, fmtCalc(p.R_T), "(m²·K)/W")
  );

  // Step 2 — U = 1 / R_T
  wrap.appendChild(stepHeading("2", "Thermal transmittance"));
  wrap.appendChild(
    formulaLine(
      el("span", {}, [renderDisplay(SHARED_POOL.thermal_transmittance.display)]),
      `1 / ${fmtCalc(p.R_T)}`,
      fmtU(p.U),
      "W/(m²·K)"
    )
  );

  // Step 3 — q = U · (θ_i − θ_e)
  wrap.appendChild(stepHeading("3", "Heat flux density"));
  wrap.appendChild(
    formulaLine(
      el("span", {}, [renderDisplay(SHARED_POOL.heat_flux_density.display)]),
      `${fmtCalc(p.U)} · (${fmtCalc(p.theta_i_C)} − ${parenIfNeg(
        fmtCalc(p.theta_e_C)
      )})`,
      fmtCalc(p.q),
      "W/m²"
    )
  );

  // Step 4 — surface and interface cascade
  wrap.appendChild(stepHeading("4", "Surface and interface temperatures"));
  const cascade = el("div", { className: "cascadeList" });

  cascade.appendChild(
    formulaLine(
      el("span", {}, [
        renderDisplay(SHARED_POOL.theta_surface_internal.display),
      ]),
      `${fmtCalc(p.theta_i_C)} − ${fmtCalc(p.q)} · ${fmtCalc(p.R_si)}`,
      fmtTheta(p.theta_si_C),
      "°C"
    )
  );

  let theta_prev = p.theta_si_C;
  for (let i = 0; i < p.R_layers.length; i++) {
    const theta_next = theta_prev - p.q * p.R_layers[i];
    const labelText = i === p.R_layers.length - 1 ? "θ_se_via" : `θ_${i + 1}/${i + 2}`;
    const isLast = i === p.R_layers.length - 1;
    const symNode = el("span", {}, [
      isLast
        ? renderDisplay(SHARED_POOL.theta_surface_external.display)
        : el("span", {}, ["θ", el("sub", {}, `${i + 1}/${i + 2}`)]),
    ]);
    cascade.appendChild(
      formulaLine(
        symNode,
        `${fmtCalc(theta_prev)} − ${fmtCalc(p.q)} · ${fmtCalc(p.R_layers[i])}`,
        fmtTheta(theta_next),
        "°C"
      )
    );
    theta_prev = theta_next;
  }

  // Closure check: θ_e via cascade − R_se must match θ_e input
  const theta_e_calc = theta_prev - p.q * p.R_se;
  cascade.appendChild(
    formulaLine(
      el("span", {}, [renderDisplay(SHARED_POOL.theta_outdoor_air.display)]),
      `${fmtCalc(theta_prev)} − ${fmtCalc(p.q)} · ${fmtCalc(p.R_se)}`,
      fmtTheta(theta_e_calc),
      "°C",
      "cascadeClose"
    )
  );

  wrap.appendChild(cascade);
  return wrap;
}

// SVG diagram
function buildTemperatureDiagram(p, layerNames) {
  // Geometry: 700×400 viewBox with margins.
  const VB_W = 700, VB_H = 400;
  const M = { top: 20, right: 30, bottom: 60, left: 50 };
  const innerW = VB_W - M.left - M.right;
  const innerH = VB_H - M.top - M.bottom;

  const totalD = p.layers.reduce((a, l) => a + l.d_m, 0);
  if (totalD <= 0) return el("div");

  const thetaMin = Math.min(p.theta_e_C, ...p.nodes.map((n) => n.theta));
  const thetaMax = Math.max(p.theta_i_C, ...p.nodes.map((n) => n.theta));
  const thetaSpan = Math.max(thetaMax - thetaMin, 1);
  const thetaPad = thetaSpan * 0.1;
  const yMin = thetaMin - thetaPad;
  const yMax = thetaMax + thetaPad;
  const yScale = (theta) => M.top + innerH * (1 - (theta - yMin) / (yMax - yMin));
  const xScale = (x) => M.left + innerW * (x / totalD);

  const root_svg = svg(
    "svg",
    {
      viewBox: `0 0 ${VB_W} ${VB_H}`,
      class: "tempDiagram",
      role: "img",
      "aria-label": "Temperature profile diagram",
    },
    []
  );

  // Layer bands
  let xCursor = 0;
  for (let i = 0; i < p.layers.length; i++) {
    const d = p.layers[i].d_m;
    const x1 = xScale(xCursor);
    const x2 = xScale(xCursor + d);
    root_svg.appendChild(
      svg("rect", {
        x: x1,
        y: M.top,
        width: x2 - x1,
        height: innerH,
        class: i % 2 === 0 ? "layerBandA" : "layerBandB",
      })
    );

    // Interface dashed line (start of band, except for the very first edge,
    // which is the interior surface line drawn below)
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

    // Layer name (truncated to index "1","2"… when band too narrow)
    const bandW = x2 - x1;
    const labelText =
      bandW < 60 ? String(i + 1) : (layerNames && layerNames[i]) || `Layer ${i + 1}`;
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

  // Interior and exterior surface lines (full bracket)
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

  // Polyline through θ-values (interior surface → interfaces → exterior surface)
  const polyNodes = p.nodes.filter(
    (n) => n.label !== "θ_i" && n.label !== "θ_e"
  );
  const polyPts = polyNodes
    .map((n) => `${xScale(n.x)},${yScale(n.theta)}`)
    .join(" ");
  root_svg.appendChild(
    svg("polyline", { points: polyPts, class: "thetaCurve" })
  );

  // Dots
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

  // Two-pass label placement: alternate above/below; suppress on crowd
  const placed = [];
  const MIN_GAP = 32;
  for (let i = 0; i < polyNodes.length; i++) {
    const n = polyNodes[i];
    const cx = xScale(n.x);
    const cy = yScale(n.theta);
    const above = i % 2 === 0;
    const ly = above ? cy - 10 : cy + 16;
    const tooClose = placed.some(
      (q) => Math.abs(q.cx - cx) < MIN_GAP && Math.abs(q.ly - ly) < 14
    );
    if (tooClose) continue;
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

// Footer
function renderFooter() {
  return el("footer", { className: "appFooter" }, [
    el(
      "button",
      {
        type: "button",
        className: "resetBtn",
        onClick: () => {
          if (
            !window.confirm("Reset this calculation? Cannot be undone.")
          )
            return;
          state = defaultState();
          persist();
          render();
        },
      },
      "Reset"
    ),
    el("p", { className: "src" }, DATA_SOURCE_NOTE),
  ]);
}

// ── module API ──────────────────────────────────────────────────────

export function mount(rootEl) {
  root = rootEl;
  state = loadQuickCalc() || defaultState();
  if (!Number.isFinite(state.theta_i_C)) state.theta_i_C = 20;
  if (!Number.isFinite(state.theta_e_C)) state.theta_e_C = -10;
  render();
}

export function unmount() {
  closeOpenPicker();
  if (root) clear(root);
  root = null;
}
