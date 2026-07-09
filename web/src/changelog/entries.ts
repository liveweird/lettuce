// The changelog is a build-time artifact: entries are authored here (newest first) and bundled
// into the SPA, so it can only change with a deploy — never at runtime. The newest entry's
// version doubles as the app's displayed version (see VersionStamp): adding an entry IS the
// version bump. Bodies are markdown, one per language (content, not chrome — hence not in
// locales/); keep the phrases tests assert on in plain text runs, and follow the Polish style
// conventions (declined loanword "feedback", inclusive slash forms, active voice).
export interface ChangelogEntry {
  version: string;
  /** Release date, YYYY-MM-DD. Keep the array strictly descending by date. */
  date: string;
  /** Markdown body, English. */
  en: string;
  /** Markdown body, Polish. */
  pl: string;
}

export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    version: "1.1",
    date: "2026-07-09",
    en: `Added a changelog page — click the version stamp or the *Changelog* menu entry to see what changed in each release. A small dot on the version stamp marks news you haven't seen yet.`,
    pl: `Dodaliśmy stronę historii zmian — kliknij numer wersji lub pozycję *Historia zmian* w menu, aby zobaczyć, co zmieniło się w każdym wydaniu. Mała kropka przy numerze wersji oznacza nowości, których jeszcze nie widziałeś/aś.`,
  },
  {
    version: "1.0",
    date: "2026-07-01",
    en: `Initial release: the full feedback lifecycle (requesting, drafting, sending, withdrawing), self-reflections, team management, feedback templates, in-app notifications, admin announcement alerts, and a bilingual English/Polish interface.`,
    pl: `Pierwsze wydanie: pełny cykl życia feedbacku (proszenie o feedback, szkice, wysyłanie, wycofywanie), autorefleksje, zarządzanie zespołami, szablony feedbacku, powiadomienia w aplikacji, alerty administracyjne oraz dwujęzyczny interfejs (angielski i polski).`,
  },
];

export const APP_VERSION = CHANGELOG[0].version;
