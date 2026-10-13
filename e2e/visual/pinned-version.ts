// The app version the visual build displays, pinned like the commit and build time in
// vite.config.mjs: the version stamp at the foot of the sidebar is still rendered (its layout
// and wrapping stay covered), but a release no longer changes every baseline. The visual
// build swaps web/src/changelog/version.ts for this module, so the stamp AND the changelog's
// "seen" check read this value; fixtures.ts marks it as seen, so no what's-new dot appears.
export const APP_VERSION = '0.0.0';
