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
import enTeamKpis from "./locales/en/teamKpis.json";
import enPerformanceReviews from "./locales/en/performanceReviews.json";
import enDaysOff from "./locales/en/daysOff.json";
import enPulse from "./locales/en/pulse.json";
import enUsers from "./locales/en/users.json";
import enTeams from "./locales/en/teams.json";
import enTemplates from "./locales/en/templates.json";
import enDictionaries from "./locales/en/dictionaries.json";
import enNotifications from "./locales/en/notifications.json";
import enEmailNotifications from "./locales/en/emailNotifications.json";
import enAlerts from "./locales/en/alerts.json";
import enChangelog from "./locales/en/changelog.json";
import enTour from "./locales/en/tour.json";
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
  emailNotifications: enEmailNotifications,
  alerts: enAlerts,
  changelog: enChangelog,
  tour: enTour,
  org: enOrg,
};


// Every non-EN bundle is assembled from its locales/<lang>/ folder — adding a language never
// adds imports here. Eager on purpose: at 2 shipped languages the whole set rides the main
// chunk (~95KB raw per language); move non-EN to lazy loading when a 3rd language ships or a
// bundle passes ~150KB (documented in web/CLAUDE.md).
const NON_EN_MODULES = import.meta.glob<Record<string, unknown>>(
  ["./locales/*/*.json", "!./locales/en/**"],
  { eager: true, import: "default" },
);

// Area files whose mount key differs from the filename (the EN tree above is the reference).
const AREA_MOUNT: Record<string, string> = {
  goals: "goal",
  teamKpis: "teamKpi",
  performanceReviews: "performanceReview",
  dictionaries: "dictionary",
};

function bundleFor(lang: SupportedLanguage): Record<string, unknown> {
  const bundle: Record<string, unknown> = {};
  for (const [path, module] of Object.entries(NON_EN_MODULES)) {
    const match = /\/([^/]+)\/([^/]+)\.json$/.exec(path);
    if (!match || match[1] !== lang) continue;
    bundle[AREA_MOUNT[match[2]] ?? match[2]] = module;
  }
  return bundle;
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: Object.fromEntries(
      SUPPORTED_LANGUAGES.map((lang) => [
        lang,
        { translation: lang === "en" ? en : bundleFor(lang) },
      ]),
    ),
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
