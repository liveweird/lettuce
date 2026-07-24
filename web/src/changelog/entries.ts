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
    version: "1.15.8",
    date: "2026-07-24",
    en: `On the read-only 1:1 meeting view, the *Action items* table now shows each item's position in a leading *#* column — the saved order was always there, but only *Points discussed* and *Decisions made* displayed their numbering.`,
    pl: `W widoku spotkania 1:1 tylko do odczytu tabela *Zadania* pokazuje teraz pozycję każdego zadania w początkowej kolumnie *Lp.* — zapisana kolejność zawsze istniała, ale numerację wyświetlały dotąd tylko *Omówione punkty* i *Podjęte decyzje*.`,
  },
  {
    version: "1.15.7",
    date: "2026-07-23",
    en: `The row *Feedback* dropdown (Users list and team members screen) gained a third entry: *List feedbacks* opens the two-way "Feedbacks with …" view for that person, and its "Back to …" link correctly returns to the screen you came from.`,
    pl: `Lista rozwijana *Feedback* w wierszach (lista użytkowników i ekran członków zespołu) zyskała trzecią pozycję: *Pokaż feedbacki* otwiera dwukierunkowy widok „Feedbacki dotyczące …" danej osoby, a jego link „Powrót do …" poprawnie wraca do ekranu, z którego przyszedłeś/aś.`,
  },
  {
    version: "1.15.6",
    date: "2026-07-23",
    en: `On the Users list and the team members screen, the per-row *Provide feedback* and *Ask for feedback* buttons are now grouped behind a single compact *Feedback* dropdown, so rows take less horizontal space. The Dashboard cards keep their inline buttons.`,
    pl: `Na liście użytkowników i na ekranie członków zespołu przyciski *Wystaw feedback* i *Poproś o feedback* w wierszach są teraz zgrupowane w jednej zwięzłej liście rozwijanej *Feedback*, dzięki czemu wiersze zajmują mniej miejsca w poziomie. Karty na Pulpicie zachowują osobne przyciski.`,
  },
  {
    version: "1.15.5",
    date: "2026-07-23",
    en: `The per-person "Feedbacks with …" screen (opened from the Dashboard's managers, peers and subordinates cards) now shows its two directions — *From them to you* and *From you to them* — as tabs instead of two stacked lists, and returning from a feedback you opened there lands back on the tab you left.`,
    pl: `Ekran „Feedbacki dotyczące …" (otwierany z kart menedżerów, współpracowników i podwładnych na Pulpicie) pokazuje teraz oba kierunki — *Od nich do Ciebie* i *Od Ciebie do nich* — jako zakładki zamiast dwóch list jedna pod drugą, a powrót z otwartego tam feedbacku prowadzi z powrotem do zakładki, z której wyszedłeś/aś.`,
  },
  {
    version: "1.15.4",
    date: "2026-07-23",
    en: `The guided tour caught up with the app: it now walks you through the 1:1 meetings section (including the manager-side tabs, shown only to managers) and points out Self-reflection. Replay it anytime from the "?" button in the header.`,
    pl: `Przewodnik dogonił aplikację: teraz oprowadza po sekcji spotkań 1:1 (łącznie z zakładkami menedżerskimi, widocznymi tylko dla menedżerów) i pokazuje Autorefleksję. Odtworzysz go w każdej chwili przyciskiem „?" w nagłówku.`,
  },
  {
    version: "1.15.3",
    date: "2026-07-12",
    en: `Starting a 1:1 from a subordinate's Dashboard card or the per-person drill-down now returns you there after you create it — no more landing on the generic managed list. The "New 1:1" button also uses the same plus icon as every other create button.`,
    pl: `Rozpoczęcie 1:1 z karty podwładnego na Pulpicie lub z widoku konkretnej osoby wraca teraz właśnie tam po utworzeniu spotkania — koniec z lądowaniem na ogólnej liście zarządzanych. Przycisk „Nowe 1:1" ma też tę samą ikonę plusa co pozostałe przyciski tworzenia.`,
  },
  {
    version: "1.15.2",
    date: "2026-07-12",
    en: `Creation buttons now speak one language: *New <thing>* (New team, New user, New template, New feedback, New alert, New 1:1) opens a create screen, *Add* appends an item to a list you are editing, and *Create* submits the form. The Polish labels follow suit: *Nowy/Nowe*, *Dodaj*, *Utwórz*.`,
    pl: `Przyciski tworzenia mówią teraz jednym językiem: *Nowy/Nowe <coś>* (Nowy zespół, Nowy użytkownik, Nowy szablon, Nowy feedback, Nowy alert, Nowe 1:1) otwiera ekran tworzenia, *Dodaj* dokłada pozycję do edytowanej listy, a *Utwórz* zatwierdza formularz. Angielskie etykiety idą tym samym śladem: *New*, *Add*, *Create*.`,
  },
  {
    version: "1.15.1",
    date: "2026-07-12",
    en: `The *1:1 meetings with …* screen (opened from a subordinate's Dashboard card) now offers its own *New 1:1* button, with that person already selected — same as the button on their card.`,
    pl: `Ekran *Spotkania 1:1 z…* (otwierany z karty podwładnego na Pulpicie) ma teraz własny przycisk *Nowe 1:1* z tą osobą już wybraną — tak samo jak przycisk na jej karcie.`,
  },
  {
    version: "1.15",
    date: "2026-07-12",
    en: `1:1 meetings now stay in chronological order: a new meeting cannot be dated before the most recent one with the same person (same-day follow-ups are fine), and the edit form enforces the same floor on the date field. Documenting 1:1s is a continuous record, not a scrapbook.`,
    pl: `Spotkania 1:1 zachowują teraz porządek chronologiczny: nowego spotkania nie można datować przed najnowszym spotkaniem z tą samą osobą (dogrywki tego samego dnia są w porządku), a formularz edycji pilnuje tej samej granicy w polu daty. Dokumentowanie 1:1 to ciągły zapis, nie album z wycinkami.`,
  },
  {
    version: "1.14.2",
    date: "2026-07-12",
    en: `The *My subordinates* cards on the Dashboard gained a *New 1:1* button: it opens the usual new-meeting screen with that person already selected (and locked), so documenting a fresh 1:1 is one click away.`,
    pl: `Karty *Moi podwładni* na Pulpicie zyskały przycisk *Nowe 1:1*: otwiera on zwykły ekran nowego spotkania z tą osobą już wybraną (bez możliwości zmiany), więc udokumentowanie świeżego 1:1 jest o jedno kliknięcie.`,
  },
  {
    version: "1.14.1",
    date: "2026-07-12",
    en: `Navigation fix: closing a 1:1 meeting opened from the *I'm a manager* tab now returns you there — previously you landed on *I'm a subordinate*. The same context is kept when an older, read-only meeting bounces from its edit link to the view screen.`,
    pl: `Poprawka nawigacji: zamknięcie spotkania 1:1 otwartego z zakładki *Jestem menedżerem/ką* wraca teraz właśnie tam — wcześniej lądowałeś/aś w *Jestem podwładnym/ą*. Ten sam kontekst jest zachowany, gdy starsze spotkanie (tylko do odczytu) przekierowuje z linku edycji do podglądu.`,
  },
  {
    version: "1.14",
    date: "2026-07-12",
    en: `Past 1:1 meetings are now immutable records: only the most recent meeting with each person can be edited or deleted. Older meetings open read-only, and their table rows offer View instead of Edit. Deleting the most recent meeting makes the previous one editable again.`,
    pl: `Minione spotkania 1:1 są teraz niezmiennym zapisem: edytować i usuwać można tylko najnowsze spotkanie z daną osobą. Starsze spotkania otwierają się w trybie tylko do odczytu, a ich wiersze w tabeli oferują Podgląd zamiast Edycji. Usunięcie najnowszego spotkania ponownie odblokowuje edycję poprzedniego.`,
  },
  {
    version: "1.13.2",
    date: "2026-07-12",
    en: `Visual fix on the 1:1 meeting screens: the header fields (manager, team member, meeting date) now sit flush on one line — the meeting date no longer floats slightly above the others.`,
    pl: `Poprawka wizualna na ekranach spotkań 1:1: pola nagłówka (menedżer, członek zespołu, data spotkania) leżą teraz równo w jednej linii — data spotkania nie unosi się już nieco ponad pozostałymi.`,
  },
  {
    version: "1.13.1",
    date: "2026-07-12",
    en: `Carried-over action items on the 1:1 screens now show since when they have been open — the badge reads *Carried over since <date>*, naming the meeting where the item first appeared. Continually postponed items stand out at a glance.`,
    pl: `Przenoszone zadania na ekranach 1:1 pokazują teraz, od kiedy pozostają otwarte — plakietka brzmi *Przeniesione od <data>*, wskazując spotkanie, na którym zadanie pojawiło się po raz pierwszy. Stale odkładane zadania widać na pierwszy rzut oka.`,
  },
  {
    version: "1.13",
    date: "2026-07-12",
    en: `No more accidental duplicates: while a feedback for the same subject, provider, and requester is still in progress (a draft or a pending request), a second one cannot be created. The create screens tell you right away — before you type anything — and link straight to the existing feedback.`,
    pl: `Koniec z przypadkowymi duplikatami: dopóki feedback dla tej samej osoby, wystawiającego i proszącego jest w toku (szkic lub oczekująca prośba), nie da się utworzyć drugiego. Ekrany tworzenia informują o tym od razu — zanim cokolwiek wpiszesz — i prowadzą prosto do istniejącego feedbacku.`,
  },
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
