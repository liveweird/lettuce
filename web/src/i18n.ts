import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

// Per-namespace resource files (one folder per language). Each area file is merged into a single
// `translation` namespace keyed by area, so keys read as e.g. `common.cancel`, `feedback.editTitle`.
import enCommon from "./locales/en/common.json";
import enAppShell from "./locales/en/appShell.json";
import enAuth from "./locales/en/auth.json";
import enDashboard from "./locales/en/dashboard.json";
import enFeedback from "./locales/en/feedback.json";
import enOneOnOne from "./locales/en/oneOnOne.json";
import enGoals from "./locales/en/goals.json";
import enTeamKpis from "./locales/en/teamKpis.json";
import enUsers from "./locales/en/users.json";
import enTeams from "./locales/en/teams.json";
import enTemplates from "./locales/en/templates.json";
import enDictionaries from "./locales/en/dictionaries.json";
import enNotifications from "./locales/en/notifications.json";
import enAlerts from "./locales/en/alerts.json";
import enChangelog from "./locales/en/changelog.json";
import enTour from "./locales/en/tour.json";
import enOrg from "./locales/en/org.json";

import plCommon from "./locales/pl/common.json";
import plAppShell from "./locales/pl/appShell.json";
import plAuth from "./locales/pl/auth.json";
import plDashboard from "./locales/pl/dashboard.json";
import plFeedback from "./locales/pl/feedback.json";
import plOneOnOne from "./locales/pl/oneOnOne.json";
import plGoals from "./locales/pl/goals.json";
import plTeamKpis from "./locales/pl/teamKpis.json";
import plUsers from "./locales/pl/users.json";
import plTeams from "./locales/pl/teams.json";
import plTemplates from "./locales/pl/templates.json";
import plDictionaries from "./locales/pl/dictionaries.json";
import plNotifications from "./locales/pl/notifications.json";
import plAlerts from "./locales/pl/alerts.json";
import plChangelog from "./locales/pl/changelog.json";
import plTour from "./locales/pl/tour.json";
import plOrg from "./locales/pl/org.json";

export const SUPPORTED_LANGUAGES = ["en", "pl"] as const;

const LANGUAGE_STORAGE_KEY = "lettuce.lang";

const en = {
  common: enCommon,
  appShell: enAppShell,
  auth: enAuth,
  dashboard: enDashboard,
  feedback: enFeedback,
  oneOnOne: enOneOnOne,
  goal: enGoals,
  teamKpi: enTeamKpis,
  users: enUsers,
  teams: enTeams,
  templates: enTemplates,
  // Mounted as the singular area `dictionary` (the goals.json -> goal filename precedent).
  dictionary: enDictionaries,
  notifications: enNotifications,
  alerts: enAlerts,
  changelog: enChangelog,
  tour: enTour,
  org: enOrg,
};

const pl = {
  common: plCommon,
  appShell: plAppShell,
  auth: plAuth,
  dashboard: plDashboard,
  feedback: plFeedback,
  oneOnOne: plOneOnOne,
  goal: plGoals,
  teamKpi: plTeamKpis,
  users: plUsers,
  teams: plTeams,
  templates: plTemplates,
  dictionary: plDictionaries,
  notifications: plNotifications,
  alerts: plAlerts,
  changelog: plChangelog,
  tour: plTour,
  org: plOrg,
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      pl: { translation: pl },
    },
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
