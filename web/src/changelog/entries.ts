// The changelog is a build-time artifact: entries are authored here (newest first) and bundled
// into the SPA, so it can only change with a deploy — never at runtime. The newest entry's
// version doubles as the app's displayed version (see VersionStamp): adding an entry IS the
// version bump. Bodies are markdown, one per language (content, not chrome — hence not in
// locales/); keep the phrases tests assert on in plain text runs, and follow the Polish style
// conventions (declined loanword "feedback", inclusive slash forms, active voice).
interface ChangelogEntry {
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
    version: "1.7",
    date: "2026-07-11",
    en: `Managers can now document *1:1 meetings* with their team members: the meeting date, points discussed, decisions made, and action items with an owner, a due date, and a resolved flag. Unresolved action items carry over automatically into the next 1:1 with the same person, with a full cross-meeting history per item. Team members see their meetings read-only and get a notification when one is documented; every change is tracked in the meeting's history.`,
    pl: `Menedżerowie mogą teraz dokumentować *spotkania 1:1* z członkami swoich zespołów: datę spotkania, omówione punkty, podjęte decyzje oraz zadania z właścicielem, terminem i oznaczeniem realizacji. Nierozwiązane zadania przechodzą automatycznie do kolejnego 1:1 z tą samą osobą, a każde zadanie ma pełną historię między spotkaniami. Członkowie zespołu widzą swoje spotkania w trybie tylko do odczytu i dostają powiadomienie o nowym wpisie; każda zmiana trafia do historii spotkania.`,
  },
  {
    version: "1.6",
    date: "2026-07-11",
    en: `Creating a single user can now email them their credentials directly — the same option the mass import already had — with the delivery outcome shown in the confirmation window. The email checkboxes also read more clearly.`,
    pl: `Tworząc pojedynczego użytkownika, możesz teraz od razu wysłać mu e-mail z danymi logowania — tak jak w imporcie masowym — a wynik wysyłki widać w oknie potwierdzenia. Pola wyboru dotyczące e-maila są też czytelniej opisane.`,
  },
  {
    version: "1.5",
    date: "2026-07-10",
    en: `Generated passwords (single user creation and mass import) are now hidden behind stars until you press the eye button — no more shoulder-surfing while the confirmation is on screen. Copying works without revealing.`,
    pl: `Wygenerowane hasła (tworzenie pojedynczego użytkownika i import masowy) są teraz ukryte za gwiazdkami, dopóki nie naciśniesz przycisku z okiem — koniec z podglądaniem przez ramię, gdy potwierdzenie jest na ekranie. Kopiowanie działa bez odsłaniania.`,
  },
  {
    version: "1.4",
    date: "2026-07-10",
    en: `Administrators can now onboard whole teams at once: *Mass import* on the Users page accepts a simple CSV (name,email per line), creates each account with a generated password, shows a per-row summary with copyable passwords, and can optionally email every new user their credentials.`,
    pl: `Administratorzy mogą teraz wdrażać całe zespoły naraz: *Import masowy* na stronie Użytkowników przyjmuje prosty plik CSV (nazwa,e-mail w każdym wierszu), tworzy każde konto z wygenerowanym hasłem, pokazuje podsumowanie wierszy z hasłami do skopiowania i opcjonalnie wysyła każdemu nowemu użytkownikowi e-mail z danymi logowania.`,
  },
  {
    version: "1.3",
    date: "2026-07-10",
    en: `Forgot your password? The sign-in screen now offers a self-service reset: enter your email address and, if an account exists, a new password lands in your inbox. Change it after signing back in.`,
    pl: `Nie pamiętasz hasła? Ekran logowania oferuje teraz samodzielny reset: podaj swój adres e-mail, a jeśli konto istnieje, nowe hasło trafi na Twoją skrzynkę. Po ponownym zalogowaniu zmień je.`,
  },
  {
    version: "1.2",
    date: "2026-07-10",
    en: `Faster onboarding: after creating a user, the confirmation window now offers a *Compose onboarding email* button that opens your mail client with a ready-to-send draft — the sign-in link and the generated password included.`,
    pl: `Szybsze wdrażanie: po utworzeniu użytkownika okno potwierdzenia oferuje teraz przycisk *Przygotuj e-mail powitalny*, który otwiera Twój program pocztowy z gotowym do wysłania szkicem — z linkiem do logowania i wygenerowanym hasłem.`,
  },
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
