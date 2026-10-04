import { loadLanguage } from "../i18n";

// Side-effect import for the few test files that switch the UI to Polish: the app loads non-EN
// bundles lazily (v4.15.1), and `test/setup.ts` deliberately does NOT preload them, so a code path
// that forgets to load a language before using it fails in the suite instead of passing by accident.
await loadLanguage("pl");
