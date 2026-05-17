// Searchable material picker — reusable popover.
//
// One popover open at a time across the whole app. The caller passes
// onPick(materialId | null) to receive the user's choice; "__custom__"
// is normalised to null so callers always receive { materialId|null }.
//
// The caller is responsible for re-rendering its UI after the callback
// fires. The picker manages its own lifecycle (open / close / outside-
// click / Escape).

import { el, clear, fmt3 } from "./ui-helpers.js";
import {
  MATERIALS,
  MATERIAL_BY_ID,
  CATEGORIES,
} from "./reference-data.js";

let _openPicker = null;

function _outsideClickHandler(e) {
  if (_openPicker && !_openPicker.contains(e.target)) closeOpenPicker();
}
function _escKeyHandler(e) {
  if (e.key === "Escape") closeOpenPicker();
}

export function closeOpenPicker() {
  if (_openPicker) {
    _openPicker.remove();
    _openPicker = null;
    document.removeEventListener("click", _outsideClickHandler, true);
    document.removeEventListener("keydown", _escKeyHandler, true);
  }
}

/**
 * Render a trigger button that opens the popover when clicked.
 *
 * @param {object} opts
 *   opts.currentMaterialId — currently selected material id, or null
 *   opts.currentCustomName — used for the trigger label when materialId is null
 *   opts.ariaLabel         — accessibility label for the trigger button
 *   opts.popoverKey        — unique key (e.g. "layer-2-region-a") for toggle behaviour
 *   opts.onPick            — function({ materialId: string|null, material: object|null }) => void
 */
export function renderMaterialPicker(opts) {
  const {
    currentMaterialId,
    currentCustomName,
    ariaLabel,
    popoverKey,
    onPick,
  } = opts;

  const triggerLabel =
    currentMaterialId && MATERIAL_BY_ID[currentMaterialId]
      ? MATERIAL_BY_ID[currentMaterialId].name
      : currentCustomName
      ? `${currentCustomName} (custom)`
      : "Choose material…";

  const triggerIsCustom = currentMaterialId == null && !currentCustomName;

  const trigger = el(
    "button",
    {
      type: "button",
      className:
        "matTrigger" + (triggerIsCustom ? " is-placeholder" : ""),
      "aria-haspopup": "listbox",
      "aria-label": ariaLabel,
      onClick: (e) => {
        e.stopPropagation();
        const wasOpen =
          _openPicker && _openPicker.dataset.popoverKey === popoverKey;
        closeOpenPicker();
        if (!wasOpen) _openPopover(trigger, popoverKey, currentMaterialId, onPick);
      },
    },
    [
      el("span", { className: "matTriggerLabel" }, triggerLabel),
      el("span", { className: "matTriggerChevron", "aria-hidden": "true" }, "▾"),
    ]
  );
  return trigger;
}

function _openPopover(anchorEl, popoverKey, currentMaterialId, onPick) {
  const popover = el("div", {
    className: "matPopover",
    "data-popover-key": popoverKey,
    role: "dialog",
    "aria-label": "Choose material",
  });

  const rect = anchorEl.getBoundingClientRect();
  popover.style.position = "absolute";
  popover.style.left = `${window.scrollX + rect.left}px`;
  popover.style.top = `${window.scrollY + rect.bottom + 4}px`;
  popover.style.minWidth = `${Math.max(rect.width, 360)}px`;

  const searchInput = el("input", {
    type: "search",
    className: "matSearch",
    placeholder: "Search materials… (or leave blank to browse)",
    "aria-label": "Search materials",
    autocomplete: "off",
    spellcheck: "false",
  });
  popover.appendChild(searchInput);

  const listBox = el("div", { className: "matList", role: "listbox" });
  popover.appendChild(listBox);

  function pick(materialId) {
    closeOpenPicker();
    if (materialId === "__custom__") {
      onPick({ materialId: null, material: null });
    } else {
      onPick({
        materialId,
        material: MATERIAL_BY_ID[materialId] || null,
      });
    }
  }

  function renderList(query) {
    clear(listBox);
    const q = (query || "").trim().toLowerCase();

    listBox.appendChild(
      el(
        "button",
        {
          type: "button",
          className: "matItem matItem--custom",
          onClick: () => pick("__custom__"),
        },
        [
          el("span", { className: "matItemName" }, "— Custom material —"),
          el("span", { className: "matItemMeta" }, "manual λ, manual name"),
        ]
      )
    );

    let total = 0;
    for (const cat of CATEGORIES) {
      const matches = MATERIALS.filter(
        (m) =>
          m.category === cat &&
          (q === "" ||
            m.name.toLowerCase().includes(q) ||
            (m.subgroup && m.subgroup.toLowerCase().includes(q)) ||
            cat.toLowerCase().includes(q))
      );
      if (matches.length === 0) continue;

      listBox.appendChild(el("div", { className: "matCatHead" }, cat));

      let lastSub = null;
      for (const m of matches) {
        if (m.subgroup && m.subgroup !== lastSub) {
          listBox.appendChild(
            el("div", { className: "matSubHead" }, m.subgroup)
          );
          lastSub = m.subgroup;
        }
        const isSelected = currentMaterialId === m.id;
        listBox.appendChild(
          el(
            "button",
            {
              type: "button",
              className: "matItem" + (isSelected ? " is-selected" : ""),
              onClick: () => pick(m.id),
            },
            [
              el("span", { className: "matItemName" }, m.name),
              el(
                "span",
                { className: "matItemMeta" },
                `λ ${fmt3(m.lambda)}` +
                  (m.density != null ? ` · ρ ${m.density}` : "")
              ),
            ]
          )
        );
        total++;
      }
    }
    if (total === 0 && q !== "") {
      listBox.appendChild(
        el("div", { className: "matEmpty" }, "No matching materials.")
      );
    }
  }

  searchInput.addEventListener("input", (e) => renderList(e.target.value));
  renderList("");

  document.body.appendChild(popover);
  _openPicker = popover;
  setTimeout(() => {
    document.addEventListener("click", _outsideClickHandler, true);
    document.addEventListener("keydown", _escKeyHandler, true);
  }, 0);
  searchInput.focus();
}
