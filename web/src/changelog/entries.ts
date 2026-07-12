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
    version: "1.12",
    date: "2026-07-12",
    en: `Notifications now cover every moment something starts concerning you: managers are notified when feedback about one of their direct reports is delivered; abandoning a draft notifies the subject just like a retraction (the record appears in their list either way); every password change — by you, by an administrator, or via email reset — leaves a notification; and documenting a 1:1 meeting now confirms to the manager as well as the subordinate.`,
    pl: `Powiadomienia obejmują teraz każdy moment, w którym coś zaczyna Cię dotyczyć: menedżerowie dostają powiadomienie, gdy feedback o ich bezpośrednim podwładnym zostaje dostarczony; porzucenie szkicu powiadamia osobę, której dotyczył, tak samo jak wycofanie (wpis i tak pojawia się na jej liście); każda zmiana hasła — przez Ciebie, przez administratora lub przez reset e-mailem — zostawia powiadomienie; a udokumentowanie spotkania 1:1 potwierdza się teraz także menedżerowi, nie tylko podwładnemu.`,
  },
  {
    version: "1.11.2",
    date: "2026-07-12",
    en: `Sending feedback right away with *Save & send* now notifies the recipient (and the requester, for requested feedback) exactly like sending a saved draft does. Previously only the draft path produced notifications — the direct one was silent.`,
    pl: `Wysłanie feedbacku od razu przyciskiem *Zapisz i wyślij* powiadamia teraz odbiorcę (a przy feedbacku na prośbę także osobę proszącą) dokładnie tak samo, jak wysłanie zapisanego szkicu. Wcześniej powiadomienia powstawały tylko na ścieżce ze szkicem — bezpośrednia wysyłka była cicha.`,
  },
  {
    version: "1.11.1",
    date: "2026-07-12",
    en: `Table headers across the app now carry a subtle green tint, so they stand out clearly from the data rows — in both the light and the dark theme.`,
    pl: `Nagłówki tabel w całej aplikacji mają teraz delikatne zielone tło, dzięki czemu wyraźnie odróżniają się od wierszy z danymi — zarówno w jasnym, jak i ciemnym motywie.`,
  },
  {
    version: "1.11",
    date: "2026-07-12",
    en: `The *My peers* cards on the Dashboard complete the stats revamp: each teammate card now shows the two feedback directions between you — when you last gave that person feedback, and when they last gave you feedback you can see.`,
    pl: `Karty *Moi współpracownicy* na Pulpicie domykają odświeżenie statystyk: karta każdej osoby pokazuje teraz oba kierunki feedbacku między Wami — kiedy ostatnio przekazałeś/aś tej osobie feedback oraz kiedy ta osoba ostatnio przekazała Ci feedback, który możesz zobaczyć.`,
  },
  {
    version: "1.10",
    date: "2026-07-12",
    en: `The *My subordinates* cards on the Dashboard now show the same stats your manager cards got in 1.9 — from the other side: for each direct report, how long ago your last 1:1 with them was, how many action items from that meeting are still open, and when you last gave them feedback. The stats appear while the Reports filter is set to direct reports.`,
    pl: `Karty *Moi podwładni* na Pulpicie pokazują teraz te same statystyki, które karty menedżerów zyskały w 1.9 — z drugiej strony: przy każdej osobie z bezpośrednich podwładnych widzisz, jak dawno odbyło się Wasze ostatnie 1:1, ile zadań z tego spotkania wciąż jest otwartych oraz kiedy ostatnio przekazałeś/aś tej osobie feedback. Statystyki są widoczne, gdy filtr podwładnych jest ustawiony na bezpośrednich.`,
  },
  {
    version: "1.9",
    date: "2026-07-12",
    en: `The *My managers* cards on the Dashboard now show, for each manager, how long ago your last 1:1 with them was, how many action items from that meeting are still open, and when they last gave you feedback.`,
    pl: `Karty *Moi menedżerowie* na Pulpicie pokazują teraz przy każdym menedżerze/ce, jak dawno odbyło się Wasze ostatnie 1:1, ile zadań z tego spotkania wciąż jest otwartych oraz kiedy ostatnio ta osoba przekazała Ci feedback.`,
  },
  {
    version: "1.8.1",
    date: "2026-07-11",
    en: `Notifications got two small upgrades: you can now *delete* a notification from the bell menu, and older notifications are reachable through a pager instead of being cut off at the newest fifty. Plus a round of polish: deleted users are labelled consistently in the 1:1 lists, the *New 1:1* button moved next to the other create buttons, and a load failure no longer shows a misleading "empty list" message underneath the error.`,
    pl: `Powiadomienia zyskały dwa drobne ulepszenia: możesz teraz *usunąć* powiadomienie z menu dzwonka, a starsze powiadomienia są dostępne dzięki stronicowaniu, zamiast urywać się na najnowszych pięćdziesięciu. Do tego porcja szlifów: usunięci użytkownicy są spójnie oznaczeni na listach 1:1, przycisk *Nowe 1:1* przeniósł się obok pozostałych przycisków tworzenia, a przy błędzie ładowania nie pojawia się już mylący komunikat o pustej liście pod treścią błędu.`,
  },
  {
    version: "1.8",
    date: "2026-07-11",
    en: `The Dashboard person cards now offer a *1:1 meetings* button for your managers and your direct subordinates. It opens a per-person view of every 1:1 between the two of you — in both directions, so meetings from before a role switch stay visible in one place.`,
    pl: `Karty osób na Pulpicie mają teraz przycisk *Spotkania 1:1* dla Twoich menedżerów i bezpośrednich podwładnych. Otwiera on widok wszystkich spotkań 1:1 między Wami — w obu kierunkach, więc spotkania sprzed zamiany ról pozostają widoczne w jednym miejscu.`,
  },
  {
    version: "1.7.1",
    date: "2026-07-11",
    en: `Clearer 1:1 meeting tabs: *I'm a manager* (meetings you run), *I'm a subordinate* (meetings with your manager), and *My subordinate's a manager* — the 1:1s your own reports run with their teams, with the existing direct/all-reports filter. The last tab previously listed meetings by who attended them; it now lists them by who runs them.`,
    pl: `Czytelniejsze zakładki spotkań 1:1: *Jestem menedżerem/ką* (spotkania, które prowadzisz), *Jestem podwładnym/ą* (spotkania z Twoim menedżerem) oraz *Mój podwładny/a jest menedżerem/ką* — spotkania 1:1, które Twoi podwładni prowadzą ze swoimi zespołami, z dotychczasowym filtrem podwładnych bezpośrednich/wszystkich. Ostatnia zakładka pokazywała wcześniej spotkania według uczestników; teraz pokazuje je według prowadzącego.`,
  },
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
