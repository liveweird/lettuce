import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

// Per-namespace resource files (one folder per language). Each area file is merged into a single
// `translation` namespace keyed by area, so keys read as e.g. `common.cancel`, `feedback.editTitle`.
// Only EN is imported statically: the typed `en` tree below is the canonical key set
// (src/i18next.d.ts) AND the runtime fallback bundle; every other language is auto-discovered
// from its `locales/<lang>/` folder by the glob further down.
import enCommon from "./locales/en/common.json";
import enAppShell from "./locales/en/appShell.json";
import enAuth from "./locales/en/auth.json";
import enDashboard from "./locales/en/dashboard.json";
import enFeedback from "./locales/en/feedback.json";
import enKudos from "./locales/en/kudos.json";
import enCareer from "./locales/en/career.json";
import enOneOnOne from "./locales/en/oneOnOne.json";
import enGoals from "./locales/en/goals.json";
import enImpactLog from "./locales/en/impactLog.json";
import enIntegration from "./locales/en/integration.json";
import enSuccession from "./locales/en/succession.json";
import enSharing from "./locales/en/sharing.json";
import enActivity from "./locales/en/activity.json";
import enTeamKpis from "./locales/en/teamKpis.json";
import enPerformanceReviews from "./locales/en/performanceReviews.json";
import enDaysOff from "./locales/en/daysOff.json";
import enPulse from "./locales/en/pulse.json";
import enUsers from "./locales/en/users.json";
import enTeams from "./locales/en/teams.json";
import enTemplates from "./locales/en/templates.json";
import enDictionaries from "./locales/en/dictionaries.json";
import enNotifications from "./locales/en/notifications.json";
import enNotificationPreferences from "./locales/en/notificationPreferences.json";
import enAlerts from "./locales/en/alerts.json";
import enChangelog from "./locales/en/changelog.json";
import enTour from "./locales/en/tour.json";
import enTutorials from "./locales/en/tutorials.json";
import enOrg from "./locales/en/org.json";


/**
 * The build-time supported-language set — mirrored by the server's `SUPPORTED_LANGUAGES`
 * in `dictionaries/Languages.kt` (they must agree). Adding a language: a complete
 * `locales/<lang>/` folder (parity-gated), one code here, one NATIVE_LANGUAGE_NAMES line,
 * `common.languageName.<lang>` in every language file, one EMOJI_I18N line (EmojiPicker),
 * the server constant, and a parameter on the server's LocalizedText (email texts). English is THE default and the display fallback everywhere.
 */
export const SUPPORTED_LANGUAGES = ["en", "pl"] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

/**
 * Each language names itself — deliberate constants, not translations (a switcher entry must
 * be readable BEFORE switching) and not Intl.DisplayNames (which yields lowercase "polski"
 * and varies across engines). The Record enforces one line per supported language.
 */
export const NATIVE_LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  en: "English",
  pl: "Polski",
};

/** Narrow an arbitrary language tag to a supported one, defaulting to English. */
export function asSupportedLanguage(lang: string | undefined): SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(lang ?? "")
    ? (lang as SupportedLanguage)
    : "en";
}

const LANGUAGE_STORAGE_KEY = "lettuce.lang";

/**
 * Exported for the i18next type augmentation (src/i18next.d.ts): the EN tree is the
 * canonical key set every t() call is checked against. Knip cannot trace the d.ts
 * consumer, hence the public tag.
 * @public
 */
export const en = {
  common: enCommon,
  appShell: enAppShell,
  auth: enAuth,
  dashboard: enDashboard,
  feedback: enFeedback,
  kudos: enKudos,
  career: enCareer,
  oneOnOne: enOneOnOne,
  goal: enGoals,
  impactLog: enImpactLog,
  integration: enIntegration,
  succession: enSuccession,
  sharing: enSharing,
  activity: enActivity,
  teamKpi: enTeamKpis,
  // Mounted as the singular area `performanceReview` (the teamKpis.json -> teamKpi precedent).
  performanceReview: enPerformanceReviews,
  daysOff: enDaysOff,
  pulse: enPulse,
  users: enUsers,
  teams: enTeams,
  templates: enTemplates,
  // Mounted as the singular area `dictionary` (the goals.json -> goal filename precedent).
  dictionary: enDictionaries,
  notifications: enNotifications,
  notificationPreferences: enNotificationPreferences,
  alerts: enAlerts,
  changelog: enChangelog,
  tour: enTour,
  tutorials: enTutorials,
  org: enOrg,
};


// Every non-EN bundle is assembled from its locales/<lang>/ folder — adding a language never
// adds imports here. LAZY since v4.15.1: the PL JSON alone is ~170 KiB minified, so only EN rides
// the entry graph and a non-EN bundle (plus its calendar locale) loads on demand through
// `loadLanguage`. `main.tsx` waits for the detected language before the first paint (no English
// flash) and every language change goes through `switchLanguage`.
const NON_EN_MODULES = import.meta.glob<Record<string, unknown>>(
  ["./locales/*/*.json", "!./locales/en/**"],
  { import: "default" },
);

// The dayjs calendar locale of each shipped non-EN language, loaded together with its bundle (the
// Record forces one line per language). `AppDatesProvider` only passes the language code to Mantine.
const DAYJS_LOCALES: Record<Exclude<SupportedLanguage, "en">, () => Promise<unknown>> = {
  pl: () => import("dayjs/locale/pl"),
};

// Area files whose mount key differs from the filename (the EN tree above is the reference).
const AREA_MOUNT: Record<string, string> = {
  goals: "goal",
  teamKpis: "teamKpi",
  performanceReviews: "performanceReview",
  dictionaries: "dictionary",
};

async function bundleFor(lang: SupportedLanguage): Promise<Record<string, unknown>> {
  const bundle: Record<string, unknown> = {};
  const loads: Promise<void>[] = [];
  for (const [path, load] of Object.entries(NON_EN_MODULES)) {
    const match = /\/([^/]+)\/([^/]+)\.json$/.exec(path);
    if (!match || match[1] !== lang) continue;
    loads.push(
      load().then((module) => {
        bundle[AREA_MOUNT[match[2]] ?? match[2]] = module;
      }),
    );
  }
  await Promise.all(loads);
  return bundle;
}

const loading = new Map<SupportedLanguage, Promise<void>>();

/**
 * Registers a language's translation bundle and calendar locale. EN (the static bundle) and an
 * already registered language resolve at once; concurrent callers share one load. It does NOT
 * change the active language — use `switchLanguage`.
 */
export function loadLanguage(lang: SupportedLanguage): Promise<void> {
  if (lang === "en" || i18n.hasResourceBundle(lang, "translation")) return Promise.resolve();
  let pending = loading.get(lang);
  if (!pending) {
    pending = Promise.all([bundleFor(lang), DAYJS_LOCALES[lang]()]).then(([bundle]) => {
      i18n.addResourceBundle(lang, "translation", bundle, true, true);
    });
    // A failed load (offline, dead chunk) must stay retryable, so it is not cached.
    pending.catch(() => loading.delete(lang));
    loading.set(lang, pending);
  }
  return pending;
}

/**
 * `loadLanguage` bounded by `ms`: resolves when the bundle is registered, when the load FAILED
 * (the caller then renders the English fallback), or when the cap elapses — whichever is first.
 * Used before first paint and before a session starts, where a slow network must not hold the UI.
 */
export function loadLanguageWithin(lang: SupportedLanguage, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  const load = loadLanguage(lang).catch(() => undefined);
  return Promise.race([load, cap]).finally(() => clearTimeout(timer));
}

// Latest-call-wins state of `switchLanguage`: every call takes a token, and only the call that still
// holds the newest token may apply its language once its bundle has loaded.
let switchToken = 0;
let pendingLanguage: SupportedLanguage | null = null;

/** The language the UI is on, or is about to switch to (a `switchLanguage` whose bundle is still loading). */
export function targetLanguage(): SupportedLanguage {
  return pendingLanguage ?? asSupportedLanguage(i18n.resolvedLanguage);
}

/**
 * THE way to change the UI language: records the preference at once (the detector cache,
 * `lettuce.lang`), loads the bundle, then switches — a bare `i18n.changeLanguage("pl")` would render
 * English fallbacks until the bundle arrives. Latest call wins: a switch whose load resolves after a
 * newer call (e.g. PL requested, then EN before the PL chunk arrived — or another account signing
 * in) is dropped and never applies. A superseded call resolves quietly; the newest one rejects when
 * its bundle cannot be loaded (the UI then stays on the previous language).
 */
export async function switchLanguage(lang: SupportedLanguage): Promise<void> {
  const token = ++switchToken;
  pendingLanguage = lang;
  i18n.services.languageDetector?.cacheUserLanguage?.(lang);
  try {
    await loadLanguage(lang);
    if (token !== switchToken) return;
    await i18n.changeLanguage(lang);
  } catch (error) {
    if (token === switchToken) throw error;
  } finally {
    if (token === switchToken) pendingLanguage = null;
  }
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    // Only EN is bundled; the other languages are registered by `loadLanguage` (above).
    resources: { en: { translation: en } },
    partialBundledLanguages: true,
    fallbackLng: "en",
    supportedLngs: SUPPORTED_LANGUAGES,
    // Map e.g. pl-PL -> pl.
    nonExplicitSupportedLngs: true,
    interpolation: {
      // React already escapes interpolated values.
      escapeValue: false,
    },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
    },
  });

// Keep the document language in sync so assistive tech and the browser pick the right locale.
function syncDocumentLang(lng: string) {
  if (typeof document !== "undefined") {
    document.documentElement.lang = lng;
  }
}
syncDocumentLang(i18n.resolvedLanguage ?? "en");
i18n.on("languageChanged", syncDocumentLang);

export default i18n;
