// Application shell — LaczyPrime.
//
// Responsibilities:
//   • Renders the persistent brand header.
//   • Hash-based router: "#" / "#/" → module index; "#/1.1", "#/1.2" → submodule.
//   • Mounts / unmounts submodules via their { mount, unmount } API.
//   • Service-worker registration + update banner.
//
// The shell never imports submodule code statically — all submodules
// are code-split via dynamic import in module-registry.js, so adding
// new submodules doesn't bloat the initial bundle.

import { el, clear } from "./ui-helpers.js";
import { findModule, MODULE_REGISTRY } from "./module-registry.js";
import * as moduleIndex from "./module-index.js";
import { closeOpenPicker } from "./material-picker.js";

const root = document.getElementById("app");

// ── header (persistent) ─────────────────────────────────────────────

function renderShellHeader(activeModuleId) {
  const brand = el(
    "div",
    { className: "brand", "aria-label": "LaczyPrime" },
    [
      el("span", { className: "brandWord" }, "Laczy"),
      el("span", { className: "brandWordAccent" }, "Prime"),
      el("span", { className: "brandDot", "aria-hidden": "true" }, ""),
      el("span", { className: "brandTag" }, "Building physics · field manual"),
    ]
  );

  // Breadcrumb: "Module 1 · Thermal protection" → optional submodule
  const crumb = el("div", { className: "crumb" });
  if (activeModuleId == null) {
    crumb.appendChild(
      document.createTextNode("Module 1 · Thermal protection")
    );
  } else {
    const m = findModule(activeModuleId);
    crumb.appendChild(
      el(
        "a",
        {
          href: "#/",
          className: "crumbLink",
          onClick: (e) => {
            // hash change will fire route()
          },
        },
        "Module 1 · Thermal protection"
      )
    );
    if (m) {
      crumb.appendChild(document.createTextNode(" · "));
      crumb.appendChild(
        el("span", { className: "crumbCurrent" }, m.number + " · " + m.title.replace(/^U-value · /, ""))
      );
    }
  }

  // The main page title: brand on index, module title on submodule pages.
  // To keep the header compact and consistent, we always render the brand,
  // and let each submodule render its own h2 inside its mount area.
  return el("header", { className: "appHeader" }, [
    brand,
    el("div", { className: "headerBody" }, [
      el("div", { className: "headerText" }, [crumb]),
    ]),
  ]);
}

// ── routing ─────────────────────────────────────────────────────────

let currentRoute = null;        // "index" | "module"
let currentModuleId = null;     // null when at index
let currentMountedModule = null; // the { mount, unmount } object currently mounted
let currentMountNode = null;     // the inner div the module is mounted into

function parseHash() {
  const h = (window.location.hash || "").replace(/^#\/?/, "");
  if (!h) return { route: "index" };
  const m = h.match(/^([\d.]+)$/);
  if (m) {
    const id = m[1];
    if (findModule(id)) return { route: "module", moduleId: id };
  }
  // unknown hash → fall back to index
  return { route: "index" };
}

async function route() {
  const r = parseHash();
  // Close any picker that may be open from the previous module
  closeOpenPicker();
  // Unmount previous module if any
  if (currentMountedModule && typeof currentMountedModule.unmount === "function") {
    try {
      currentMountedModule.unmount();
    } catch {
      /* swallow */
    }
  }
  currentMountedModule = null;

  // Re-render the shell with the correct header context
  clear(root);
  root.appendChild(renderShellHeader(r.route === "module" ? r.moduleId : null));
  currentMountNode = el("div", { className: "moduleMount" });
  root.appendChild(currentMountNode);

  if (r.route === "index") {
    currentRoute = "index";
    currentModuleId = null;
    moduleIndex.mount(currentMountNode, {
      onSelect: (id) => {
        window.location.hash = `#/${id}`;
      },
    });
    currentMountedModule = moduleIndex;
    return;
  }

  // route === "module"
  currentRoute = "module";
  currentModuleId = r.moduleId;
  const def = findModule(r.moduleId);
  // Loading state
  currentMountNode.appendChild(
    el("p", { className: "loadingNote" }, "Loading…")
  );
  try {
    const mod = await def.loader();
    clear(currentMountNode);
    mod.mount(currentMountNode);
    currentMountedModule = mod;
  } catch (err) {
    clear(currentMountNode);
    currentMountNode.appendChild(
      el(
        "p",
        { className: "errorNote" },
        "Failed to load this submodule. Check your network and try again."
      )
    );
    console.error("[laczyprime] module load failed:", err);
  }
}

// React to hash changes
window.addEventListener("hashchange", () => {
  route();
});

// Boot
route();

// ── service worker registration + update banner ─────────────────────

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js", { scope: "./" })
      .then((reg) => {
        reg.update().catch(() => {});
        if (reg.waiting && navigator.serviceWorker.controller) {
          showUpdateBanner(reg.waiting);
        }
        reg.addEventListener("updatefound", () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (
              installing.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              showUpdateBanner(installing);
            }
          });
        });
      })
      .catch((err) => {
        console.warn("[laczyprime] service worker registration failed:", err);
      });

    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    });
  });
}

let _updateBannerShown = false;
function showUpdateBanner(waitingWorker) {
  if (_updateBannerShown) return;
  _updateBannerShown = true;
  const banner = el(
    "div",
    {
      className: "updateBanner",
      role: "status",
      "aria-live": "polite",
    },
    [
      el(
        "span",
        { className: "updateBannerText" },
        "A new version is available."
      ),
      el(
        "button",
        {
          type: "button",
          className: "updateBannerBtn",
          onClick: () => {
            if (waitingWorker) {
              waitingWorker.postMessage("SKIP_WAITING");
            } else {
              window.location.reload();
            }
          },
        },
        "Reload"
      ),
      el(
        "button",
        {
          type: "button",
          className: "updateBannerDismiss",
          "aria-label": "Dismiss",
          onClick: () => banner.remove(),
        },
        "×"
      ),
    ]
  );
  document.body.appendChild(banner);
}
