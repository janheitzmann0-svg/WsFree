// Module index — landing page with one tile per submodule.

import { el, clear } from "./ui-helpers.js";
import { MODULE_REGISTRY } from "./module-registry.js";

let root = null;
let onSelect = null;

function render() {
  clear(root);
  root.appendChild(
    el("section", { className: "moduleHead" }, [
      el("div", { className: "moduleChapter", "aria-hidden": "true" }, "·"),
      el("div", { className: "moduleHeadText" }, [
        el("h2", { className: "moduleTitle" }, "Submodules"),
        el(
          "p",
          { className: "moduleSub" },
          "Choose a topic. Each submodule is a self-contained tool with its own inputs, calculations, and persistence."
        ),
      ]),
    ])
  );

  const grid = el("div", { className: "modGrid" });
  for (const m of MODULE_REGISTRY) {
    grid.appendChild(renderTile(m));
  }
  root.appendChild(grid);
}

function renderTile(m) {
  const isLive = m.status === "live";
  return el(
    "button",
    {
      type: "button",
      className: "modTile" + (isLive ? "" : " modTile--soon"),
      disabled: !isLive,
      "aria-label": `${m.title}${isLive ? "" : " (coming soon)"}`,
      onClick: isLive ? () => onSelect(m.id) : null,
    },
    [
      el("div", { className: "modTileNum" }, m.number),
      el("div", { className: "modTileTitle" }, m.title),
      el("div", { className: "modTileSub" }, m.subtitle),
      !isLive
        ? el("div", { className: "modTileBadge" }, "coming soon")
        : null,
    ]
  );
}

export function mount(rootEl, options) {
  root = rootEl;
  onSelect = (options && options.onSelect) || (() => {});
  render();
}

export function unmount() {
  if (root) clear(root);
  root = null;
  onSelect = null;
}
