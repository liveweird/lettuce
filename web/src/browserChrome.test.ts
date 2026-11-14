import { afterEach, beforeEach, describe, expect, it } from "vitest";
import indexHtml from "../index.html?raw";
import colorSchemeScript from "../public/color-scheme.js?raw";
import { DARK_TOKENS, LIGHT_TOKENS } from "./themeVariables";

// The browser-drawn surfaces (v4.21.0): the theme-color metas and the color-scheme property. Like
// the first-paint canvas in index.css, the hexes exist literally in index.html and
// public/color-scheme.js (neither can read the bundle's CSS variables) — pinned to the canvas
// tokens here.

describe("theme-color metas (index.html)", () => {
  const metas = [...indexHtml.matchAll(/<meta\s+name="theme-color"[^>]*>/g)].map((m) => m[0]);

  it("declares one per OS scheme, in the canvas token colours", () => {
    expect(metas).toHaveLength(2);
    const light = metas.find((m) => m.includes("(prefers-color-scheme: light)"));
    const dark = metas.find((m) => m.includes("(prefers-color-scheme: dark)"));
    expect(light, "light meta").toBeDefined();
    expect(dark, "dark meta").toBeDefined();
    expect(/content="(#[0-9a-f]{6})"/i.exec(light!)![1]).toBe(LIGHT_TOKENS.canvas);
    expect(/content="(#[0-9a-f]{6})"/i.exec(dark!)![1]).toBe(DARK_TOKENS.canvas);
  });

  it("is loaded before the scheme script, which rewrites it", () => {
    expect(indexHtml.indexOf('name="theme-color"')).toBeLessThan(indexHtml.indexOf('<script src="/color-scheme.js"'));
  });

  it("color-scheme.js repeats the same two hexes", () => {
    expect(/CANVAS_LIGHT = "(#[0-9a-f]{6})"/i.exec(colorSchemeScript)![1]).toBe(LIGHT_TOKENS.canvas);
    expect(/CANVAS_DARK = "(#[0-9a-f]{6})"/i.exec(colorSchemeScript)![1]).toBe(DARK_TOKENS.canvas);
  });
});

describe("public/color-scheme.js", () => {
  const KEY = "mantine-color-scheme-value";

  function meta(media: string, content: string): HTMLMetaElement {
    const el = document.createElement("meta");
    el.name = "theme-color";
    el.setAttribute("media", media);
    el.content = content;
    document.head.append(el);
    return el;
  }
  // eslint-disable-next-line sonarjs/code-eval -- executes the repo's own static script (public/color-scheme.js), the thing under test
  const run = () => new Function(colorSchemeScript)();
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  let light: HTMLMetaElement;
  let dark: HTMLMetaElement;
  // Every observer the script installs, so a test never leaves one reacting to the next test's
  // attribute writes.
  const observers: MutationObserver[] = [];
  const RealMutationObserver = globalThis.MutationObserver;

  beforeEach(() => {
    globalThis.MutationObserver = class extends RealMutationObserver {
      constructor(callback: MutationCallback) {
        super(callback);
        observers.push(this);
      }
    };
    light = meta("(prefers-color-scheme: light)", "#aaaaaa");
    dark = meta("(prefers-color-scheme: dark)", "#bbbbbb");
  });
  afterEach(() => {
    for (const observer of observers.splice(0)) observer.disconnect();
    globalThis.MutationObserver = RealMutationObserver;
    light.remove();
    dark.remove();
    window.localStorage.removeItem(KEY);
    document.documentElement.removeAttribute("data-mantine-color-scheme");
  });

  it("follows the OS (each meta keeps its own scheme's canvas) while the scheme is auto", () => {
    window.localStorage.setItem(KEY, "auto");
    run();
    expect(light.content).toBe(LIGHT_TOKENS.canvas);
    expect(dark.content).toBe(DARK_TOKENS.canvas);
  });

  it("points BOTH metas at the chosen scheme when the user overrides it", () => {
    window.localStorage.setItem(KEY, "dark");
    run();
    expect(document.documentElement.getAttribute("data-mantine-color-scheme")).toBe("dark");
    expect(light.content).toBe(DARK_TOKENS.canvas);
    expect(dark.content).toBe(DARK_TOKENS.canvas);
  });

  it("keeps them in sync when the in-app toggle re-stamps the scheme", async () => {
    window.localStorage.setItem(KEY, "dark");
    run();
    // What Mantine's setColorScheme does: persist the choice, then stamp the attribute.
    window.localStorage.setItem(KEY, "light");
    document.documentElement.setAttribute("data-mantine-color-scheme", "light");
    await flush();
    expect(light.content).toBe(LIGHT_TOKENS.canvas);
    expect(dark.content).toBe(LIGHT_TOKENS.canvas);

    window.localStorage.setItem(KEY, "auto");
    document.documentElement.setAttribute("data-mantine-color-scheme", "dark");
    await flush();
    expect(light.content).toBe(LIGHT_TOKENS.canvas);
    expect(dark.content).toBe(DARK_TOKENS.canvas);
  });
});
