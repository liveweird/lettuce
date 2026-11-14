// Stamps the colour scheme on <html> before the app bundle loads, so the first paint already
// uses the right canvas (index.css) — an external same-origin file because the server's CSP
// forbids inline scripts. Mirrors Mantine's localStorage manager key; "auto" or no stored value
// follows the OS preference. MantineProvider takes over on mount.
//
// It also keeps the browser UI colour (<meta name="theme-color">, v4.21.0) truthful. index.html
// ships one meta per OS scheme (media="(prefers-color-scheme: light|dark)"), which is right while
// the scheme follows the OS ("auto"). When the user has CHOSEN a scheme in the app, the OS media
// queries lie, so both metas are pointed at the chosen scheme's canvas colour — at load, and
// again whenever Mantine re-stamps the attribute (the in-app toggle, another tab's change). The
// two hexes duplicate LIGHT_TOKENS.canvas / DARK_TOKENS.canvas (src/themeVariables.ts); src/browserChrome.test.ts
// pins them equal (theme.test.ts does the same for index.css).
(function () {
  var STORAGE_KEY = "mantine-color-scheme-value";
  var CANVAS_LIGHT = "#f8f9fb";
  var CANVAS_DARK = "#1f1f1f";

  function storedScheme() {
    try {
      var stored = window.localStorage.getItem(STORAGE_KEY);
      return stored === "light" || stored === "dark" ? stored : null;
    } catch (e) {
      return null;
    }
  }

  function syncThemeColor() {
    var chosen = storedScheme();
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) {
      var media = metas[i].getAttribute("media") || "";
      var own = media.indexOf("dark") !== -1 ? CANVAS_DARK : CANVAS_LIGHT;
      var color = chosen === "dark" ? CANVAS_DARK : chosen === "light" ? CANVAS_LIGHT : own;
      if (metas[i].getAttribute("content") !== color) metas[i].setAttribute("content", color);
    }
  }

  try {
    var scheme =
      storedScheme() || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.setAttribute("data-mantine-color-scheme", scheme);
  } catch (e) {
    /* storage or matchMedia unavailable — Mantine resolves the scheme on mount */
  }

  try {
    syncThemeColor();
    if (typeof MutationObserver !== "undefined") {
      new MutationObserver(syncThemeColor).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-mantine-color-scheme"],
      });
    }
  } catch (e) {
    /* the metas keep their media-query defaults */
  }
})();
