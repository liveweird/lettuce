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
    version: "2.5.3",
    date: "2026-08-10",
    en: `Team details view. A team's Members screen is now a full team-details view: the team name and its manager sit at the top as read-only fields, with the member roster below under its own header. The manager's name is clickable — like everywhere else since the last release, it opens their user details.`,
    pl: `Widok szczegółów zespołu. Ekran Członkowie zespołu jest teraz pełnym widokiem szczegółów zespołu: nazwa zespołu i jego menedżer znajdują się na górze jako pola tylko do odczytu, a skład zespołu poniżej pod własnym nagłówkiem. Imię i nazwisko menedżera jest klikalne — tak jak wszędzie od poprzedniego wydania, otwiera jego/jej szczegóły użytkownika.`,
  },
  {
    version: "2.5.2",
    date: "2026-08-10",
    en: `Names are now links. On the Users and Teams lists, a team's roster, and a user's Teams screen, clicking a person's name opens their details view directly — the separate "User details" buttons are gone, which also declutters the tables. Your own name and deleted users stay plain, as before.`,
    pl: `Imiona i nazwiska są teraz linkami. Na listach Użytkowników i Zespołów, w składzie zespołu oraz na ekranie Zespoły użytkownika kliknięcie czyjegoś imienia i nazwiska otwiera bezpośrednio widok szczegółów tej osoby — osobne przyciski „Szczegóły użytkownika" zniknęły, co dodatkowo porządkuje tabele. Twoje własne imię i nazwisko oraz usunięci użytkownicy pozostają zwykłym tekstem, jak dotychczas.`,
  },
  {
    version: "2.5.1",
    date: "2026-08-10",
    en: `Kudos cards polished. Each kudos now sits in the same bordered content frame the rest of the app uses, and the preview shows properly rendered formatting instead of raw markdown source. Short kudos display in full with nothing to click; only longer ones are trimmed to five lines with an explicit "Show more" / "Show less" control below.`,
    pl: `Dopracowane karty Kudos. Każdy kudos znajduje się teraz w tej samej obramowanej ramce treści, której używa reszta aplikacji, a podgląd pokazuje poprawnie wyrenderowane formatowanie zamiast surowego zapisu markdown. Krótkie kudosy wyświetlają się w całości i nie mają nic do klikania; tylko dłuższe są przycinane do pięciu linii z wyraźnym przyciskiem „Pokaż więcej" / „Pokaż mniej" poniżej.`,
  },
  {
    version: "2.5.0",
    date: "2026-08-10",
    en: `Emoji everywhere. The rich-text editor toolbar (feedback, templates, alerts, goals, team KPIs) gains an emoji button with a full picker — search, categories, skin tones, in your language. The same picker sits in comment and summary fields too: 1:1 discussion points and action items, review summaries, closing summaries, pulse comments, request messages and days-off correction comments. And GitHub-style codes like :tada: now render as real emoji wherever formatted text is displayed — including the Kudos wall.`,
    pl: `Emoji wszędzie. Pasek narzędzi edytora tekstu (feedback, szablony, alerty, cele, KPI zespołów) zyskuje przycisk emoji z pełnym wyborem — wyszukiwarka, kategorie, odcienie skóry, w Twoim języku. Ten sam wybór znajdziesz też w polach komentarzy i podsumowań: punkty dyskusji i zadania ze spotkań 1:1, podsumowania ocen, podsumowania zamknięcia, komentarze pulsu, wiadomości próśb oraz komentarze korekt dni wolnych. A kody w stylu GitHuba, takie jak :tada:, wyświetlają się teraz jako prawdziwe emoji wszędzie tam, gdzie pokazujemy sformatowany tekst — także na ścianie Kudos.`,
  },
  {
    version: "2.4.2",
    date: "2026-08-10",
    en: `Tidier dashboard tiles. The stat tiles at the top of the Dashboard now line up: every tile reserves the same space for its label, so the numbers sit on one line across the row regardless of how long a label is (also in Polish, where labels run longer). The "vs previous 30 days" trend under the received-feedback count moved into a small info icon next to the number — hover it to see the comparison — so all tiles share the same clean shape.`,
    pl: `Bardziej uporządkowane kafelki pulpitu. Kafelki statystyk na górze Pulpitu są teraz wyrównane: każdy kafelek rezerwuje tyle samo miejsca na etykietę, więc liczby leżą w jednej linii w całym rzędzie niezależnie od długości etykiety (także po polsku, gdzie etykiety są dłuższe). Trend „vs poprzednie 30 dni" pod liczbą otrzymanego feedbacku przenieśliśmy do małej ikony informacji obok liczby — najedź na nią, aby zobaczyć porównanie — dzięki czemu wszystkie kafelki mają ten sam czysty kształt.`,
  },
  {
    version: "2.4.1",
    date: "2026-08-09",
    en: `Consistency fixes across the app. People pickers no longer truncate in large organizations — every list that offers users, teams, or direct reports now loads all of them, not just the first hundred (the "ask for feedback" provider picker, team rosters, and the goal, 1:1, and review subordinate pickers included). Success states now use one color everywhere: the notification bell's sent/activated/published/accepted entries match the teal badges the tables use. The pulse survey tabs share one width, "You" and deleted users render consistently on the Kudos wall and participation lists, and changes managers make to days-off budget corrections are now recorded in the security audit log.`,
    pl: `Poprawki spójności w całej aplikacji. Listy wyboru osób nie ucinają się już w dużych organizacjach — każda lista oferująca użytkowników, zespoły lub podwładnych ładuje teraz wszystkich, a nie tylko pierwszą setkę (w tym wybór dostarczycieli w prośbie o feedback, składy zespołów oraz wybór podwładnych przy celach, spotkaniach 1:1 i ocenach). Stany sukcesu mają teraz jeden kolor wszędzie: wpisy dzwonka o wysłaniu, aktywacji, publikacji i akceptacji pasują do morskich odznak w tabelach. Zakładki ankiety pulsu mają wspólną szerokość, „Ty" i usunięci użytkownicy wyświetlają się spójnie na ścianie Kudos i listach udziału, a zmiany korekt budżetu dni wolnych wprowadzane przez menedżerów są teraz zapisywane w dzienniku audytu.`,
  },
  {
    version: "2.4.0",
    date: "2026-08-09",
    en: `Optional two-step sign-in. Administrators can now require a second sign-in step for selected accounts: with the new MFA flag enabled, entering the correct password emails you a 6-digit code, and signing in finishes only once you type it in. Codes expire after a few minutes and each one works exactly once. MFA is off for everyone by default — an administrator enables it per person on the user's Features screen, or for a whole team at once on the Feature flags screen.`,
    pl: `Opcjonalne logowanie dwuetapowe. Administratorzy mogą teraz wymagać drugiego kroku logowania dla wybranych kont: przy włączonej nowej fladze MFA po wpisaniu poprawnego hasła otrzymujesz e-mailem 6-cyfrowy kod, a logowanie kończy się dopiero po jego wpisaniu. Kody wygasają po kilku minutach i każdy działa dokładnie raz. MFA jest domyślnie wyłączone dla wszystkich — administrator włącza je pojedynczo na ekranie Funkcje użytkownika albo dla całego zespołu naraz na ekranie Flagi funkcji.`,
  },
  {
    version: "2.3.0",
    date: "2026-08-09",
    en: `Notifications now reach your inbox too. Every notification the app shows you — a feedback request, a published review, an accepted leave, a pulse survey opening — is also sent to your email address the moment it appears, in both English and Polish, with a link straight to the item when there is one. That way you learn about things that concern you even on days you don't open Lettuce. It's on for everyone by default; if you'd rather keep notifications in-app only, the new "Email notifications" entry in your account menu (top right) has a single switch to turn the emails off — and back on — whenever you like.`,
    pl: `Powiadomienia trafiają teraz także na Twoją skrzynkę. Każde powiadomienie, które aplikacja Ci pokazuje — prośba o feedback, opublikowana ocena, zaakceptowany urlop, otwarcie ankiety pulsu — wysyłamy również na Twój adres e-mail w chwili, gdy się pojawia, po angielsku i po polsku, z linkiem prowadzącym wprost do elementu, którego dotyczy. Dzięki temu dowiadujesz się o sprawach, które Cię dotyczą, nawet w dni, gdy nie otwierasz Lettuce. Opcja jest domyślnie włączona dla wszystkich; jeśli wolisz powiadomienia tylko w aplikacji, nowa pozycja „Powiadomienia e-mail" w menu konta (prawy górny róg) ma jeden przełącznik, którym w każdej chwili wyłączysz — i ponownie włączysz — wysyłkę.`,
  },
  {
    version: "2.2.0",
    date: "2026-08-09",
    en: `Kudos — public feedback finally has a home. Until now a feedback marked Public was readable by anyone in theory, but nobody was told it existed. The new "Kudos" entry in the menu opens a wall of every public feedback across the organization, newest first: who gave it, who received it, and the content itself, trimmed to five lines — click a card to read the whole thing. No filters and no page buttons; just scroll, and older kudos keep loading. Part of the Feedbacks feature, so it follows the same feature flag.`,
    pl: `Kudos — publiczny feedback ma wreszcie swoje miejsce. Dotąd feedback oznaczony jako publiczny teoretycznie mógł przeczytać każdy, ale nikt nie wiedział o jego istnieniu. Nowa pozycja „Kudos" w menu otwiera ścianę wszystkich publicznych feedbacków z całej organizacji, od najnowszych: kto go przekazał, kto otrzymał i sama treść, przycięta do pięciu linii — kliknij kartę, aby przeczytać całość. Bez filtrów i bez przycisków stron; po prostu przewijasz, a starsze kudosy się dogrywają. To część funkcji Feedbacki, więc podlega tej samej fladze funkcji.`,
  },
  {
    version: "2.1.1",
    date: "2026-08-09",
    en: `The guided tour now covers the whole app. It had fallen behind as new screens landed, so it gained thirteen steps: the "My performance" tab, all three Days off tabs, all three Pulse tabs, and the Config screens it never mentioned — Review periods, Public holidays, Pulse cycles, Feature flags and Alerts — plus a stop at the Dictionaries group. Every left-menu entry and every tab it opens is now explained, and each step still appears only for people who can actually see that screen.`,
    pl: `Przewodnik obejmuje teraz całą aplikację. Nie nadążał za nowymi ekranami, więc zyskał trzynaście kroków: zakładkę „Moje oceny", wszystkie trzy zakładki Dni wolnych, wszystkie trzy zakładki Pulsu oraz ekrany Konfiguracji, o których dotąd milczał — Okresy ocen, Święta, Cykle pulsu, Flagi funkcji i Alerty — a także przystanek przy grupie Słowniki. Każda pozycja lewego menu i każda otwierana przez nią zakładka ma teraz swoje wyjaśnienie, a poszczególne kroki nadal pokazują się tylko tym, którzy dany ekran faktycznie widzą.`,
  },
  {
    version: "2.1.0",
    date: "2026-08-08",
    en: `Feature flags can now be changed for a whole team at once. The Feature flags screen (Config) gains a Team filter and a Teams column showing each user's teams, and two new bulk actions — "Enable for all matching" and "Disable for all matching" — that flip the picked feature for every user matching the current filters, after a confirmation stating exactly how many people will be affected. Pick a team, click once, done.`,
    pl: `Flagi funkcji można teraz zmieniać dla całego zespołu naraz. Ekran Flagi funkcji (Konfiguracja) zyskuje filtr Zespół i kolumnę Zespoły z zespołami każdego użytkownika oraz dwie nowe akcje zbiorcze — „Włącz dla wszystkich pasujących" i „Wyłącz dla wszystkich pasujących" — które przełączają wybraną funkcję dla każdego użytkownika pasującego do bieżących filtrów, po potwierdzeniu z dokładną liczbą osób objętych zmianą. Wybierasz zespół, klikasz raz, gotowe.`,
  },
  {
    version: "2.0.1",
    date: "2026-08-08",
    en: `The pulse survey is now a step-by-step wizard: one question per screen, with Back and Next to move around and an automatic step forward right after you answer. Progress shows both where you are ("Question 3 of 7") and how much is answered. Answers are also color-coded by favourability — from orange for the least favourable ("Strongly disagree", low eNPS scores) through yellow to green for the most favourable ("Strongly agree", high scores) — the same color language as the performance-review ratings.`,
    pl: `Ankieta pulsu jest teraz krok po kroku: jedno pytanie na ekran, z przyciskami Wstecz i Dalej oraz automatycznym przejściem dalej zaraz po udzieleniu odpowiedzi. Pasek postępu pokazuje zarówno miejsce w ankiecie („Pytanie 3 z 7"), jak i liczbę udzielonych odpowiedzi. Odpowiedzi mają też kolory według przychylności — od pomarańczowego dla najmniej przychylnych („Zdecydowanie się nie zgadzam", niskie oceny eNPS) przez żółty po zielony dla najbardziej przychylnych („Zdecydowanie się zgadzam", wysokie oceny) — ten sam język kolorów co oceny okresowe.`,
  },
  {
    version: "2.0.0",
    date: "2026-08-08",
    en: `Pulse surveys arrive — a new major feature, and the reason for the 2.0 version. Every few weeks the administrator opens a short anonymous survey: the eNPS question ("How likely are you to recommend this company as a place to work?"), four fixed statements about everyday work, one rotating question drawn from an admin-editable bank, and an optional written comment. You'll find it under the new "Pulse" entry in the menu, get a notification when a cycle opens, and can edit your answers until the cycle closes.

Results are anonymous by design. Once a cycle closes, the Results tab shows each team's eNPS, the promoter/passive/detractor split, per-question scores with changes against the previous cycle, and an eNPS trend chart — always aggregated by team (your teams and those below them), never per person, and only when at least 3 people responded. You see a closed cycle's results if you took part in it. Managers additionally see who has submitted (never the answers) and read the written comments for their teams — anonymized and shuffled; HR sees the same across the whole organization.

Administrators manage everything under Config → Pulse cycles: schedule a cycle (dates prefilled from the new cadence settings), open it, extend it, close it, or cancel it, with participation counts along the way. The rotating-question bank lives under Dictionaries → Pulse questions, and the new Pulse Surveys feature flag works like the other six.`,
    pl: `Debiutują ankiety pulsu — nowa duża funkcja i powód wersji 2.0. Co kilka tygodni administrator otwiera krótką anonimową ankietę: pytanie eNPS („Jak bardzo prawdopodobne jest, że polecisz naszą firmę jako miejsce pracy?"), cztery stałe stwierdzenia o codziennej pracy, jedno pytanie rotacyjne z edytowalnej przez administratora puli oraz opcjonalny komentarz. Znajdziesz ją pod nową pozycją „Puls" w menu, dostaniesz powiadomienie o otwarciu cyklu i możesz edytować swoje odpowiedzi aż do jego zamknięcia.

Wyniki są z założenia anonimowe. Po zamknięciu cyklu zakładka Wyniki pokazuje eNPS każdego zespołu, podział na promotorów/neutralnych/krytyków, wyniki poszczególnych pytań ze zmianami względem poprzedniego cyklu oraz wykres trendu eNPS — zawsze zagregowane per zespół (Twoje zespoły i te poniżej), nigdy per osoba, i tylko gdy odpowiedziały co najmniej 3 osoby. Wyniki zamkniętego cyklu widzisz, jeśli wziąłeś/wzięłaś w nim udział. Menedżerowie dodatkowo widzą, kto wypełnił ankietę (nigdy odpowiedzi), i czytają komentarze swoich zespołów — anonimowe i w losowej kolejności; HR widzi to samo w całej organizacji.

Administratorzy zarządzają wszystkim w Konfiguracja → Cykle pulsu: planują cykl (daty podpowiadane z nowych ustawień częstotliwości), otwierają go, przedłużają, zamykają lub anulują, widząc po drodze liczby uczestników. Pula pytań rotacyjnych mieszka w Słownikach → Pytania pulsu, a nowa flaga funkcji Ankiety pulsu działa jak pozostałe sześć.`,
  },
  {
    version: "1.53.0",
    date: "2026-08-07",
    en: `Administrators can now tailor the app per person with feature flags. Any of the six feature areas — Feedbacks (including self-reflection), 1:1 Meetings, Goals, Team KPIs, Performance Reviews, and Days Off — can be switched off for a specific user, which hides it from their menus, dashboard, cards, and notifications entirely (and blocks the underlying access too). Everything stays on by default. Two places to manage it: "Features" in a user's "Modify" menu on the Users list edits one person's switches, and the new "Feature flags" screen under Config starts from a feature and lets you toggle it per user. Turning a feature back on restores everything, including notifications that arrived in the meantime.`,
    pl: `Administratorzy mogą teraz dopasować aplikację do każdej osoby za pomocą flag funkcji. Każdy z sześciu obszarów — Feedbacki (wraz z autorefleksją), Spotkania 1:1, Cele, KPI zespołów, Oceny okresowe i Dni wolne — można wyłączyć dla wybranego użytkownika, co całkowicie ukrywa go w jego menu, pulpicie, kartach i powiadomieniach (i blokuje też sam dostęp). Domyślnie wszystko pozostaje włączone. Zarządzasz tym w dwóch miejscach: pozycja „Funkcje" w menu „Modyfikuj" na liście użytkowników edytuje przełączniki jednej osoby, a nowy ekran „Flagi funkcji" w Konfiguracji wychodzi od funkcji i pozwala przełączać ją per użytkownik. Ponowne włączenie funkcji przywraca wszystko, łącznie z powiadomieniami, które przyszły w międzyczasie.`,
  },
  {
    version: "1.52.0",
    date: "2026-08-07",
    en: `The Users list is tidier for administrators. The four account actions on each row — Edit details, Change password, Deactivate (or Reactivate), and Delete — are now grouped behind one "Modify" button that opens a small menu, next to the existing "Feedback" one. The actions themselves work exactly as before.`,
    pl: `Lista użytkowników jest bardziej przejrzysta dla administratorów. Cztery akcje konta w każdym wierszu — Edytuj dane, Zmień hasło, Dezaktywuj (lub Aktywuj ponownie) i Usuń — są teraz zgrupowane pod jednym przyciskiem „Modyfikuj", który otwiera małe menu, obok istniejącego przycisku „Feedback". Same akcje działają dokładnie jak wcześniej.`,
  },
  {
    version: "1.51.0",
    date: "2026-08-07",
    en: `Person cards take less space. The feedback actions (Provide, Ask, Request, and the feedback list) are now grouped behind one "Feedbacks" button, and the 1:1 actions (New 1:1 and the meeting list) behind one "1:1 meetings" button — click either to open a small menu. Where only a single action exists (say, just the 1:1 list on a manager's card), it stays a plain button as before. Goals, Performance reviews, and Days off keep their own buttons.

Also fixed: the manager picker on team forms and the Teams filter now offers every user — previously it silently stopped at the first hundred names.`,
    pl: `Karty osób zajmują mniej miejsca. Akcje feedbacku (Wystaw, Poproś, Zamów i lista feedbacków) są teraz zgrupowane pod jednym przyciskiem „Feedbacki", a akcje 1:1 (Nowe 1:1 i lista spotkań) pod przyciskiem „Spotkania 1:1" — kliknięcie otwiera małe menu. Tam, gdzie dostępna jest tylko jedna akcja (np. sama lista 1:1 na karcie menedżera), pozostaje ona zwykłym przyciskiem jak dotąd. Cele, oceny okresowe i dni wolne zachowują własne przyciski.

Poprawione przy okazji: wybór menedżera w formularzach zespołów i filtrze Zespołów obejmuje teraz wszystkich użytkowników — wcześniej po cichu kończył się na pierwszej setce nazwisk.`,
  },
  {
    version: "1.50.0",
    date: "2026-08-07",
    en: `Person cards are easier to read. Each card's details (the Dashboard grids and user details) are now laid out in two columns — labels on the left, values on the right — with one shared split for the whole card, so every value lines up in a single column no matter which section it belongs to. Nothing was added or removed; the same information is simply easier to scan.`,
    pl: `Karty osób czyta się teraz łatwiej. Dane na każdej karcie (siatki Pulpitu i szczegóły osoby) są ułożone w dwie kolumny — etykiety po lewej, wartości po prawej — ze wspólnym podziałem dla całej karty, więc każda wartość trafia do jednej kolumny niezależnie od sekcji, w której się znajduje. Nic nie doszło ani nie zniknęło; te same informacje po prostu łatwiej przejrzeć.`,
  },
  {
    version: "1.49.0",
    date: "2026-08-07",
    en: `Performance-review ratings are now encrypted in the database, just like the written summaries have always been — a database backup or a stolen disk reveals neither the numbers nor the texts of anyone's review. One visible consequence: a review's History tab now records that a rating changed, without showing the old and new values.`,
    pl: `Oceny liczbowe w ocenach okresowych są teraz szyfrowane w bazie danych — tak samo, jak od zawsze pisemne podsumowania. Kopia zapasowa bazy ani skradziony dysk nie ujawnią ani liczb, ani tekstów niczyjej oceny. Jedna widoczna zmiana: zakładka Historia odnotowuje teraz, że ocena się zmieniła, bez pokazywania starej i nowej wartości.`,
  },
  {
    version: "1.48.0",
    date: "2026-08-06",
    en: `Administrators can now deactivate a user account — and bring it back. A deactivated person cannot sign in (they see a clear "account has been deactivated" message) and cannot be newly added to teams or given new goals, 1:1s, reviews, or feedback — but everything they did stays visible exactly as before, and reactivating restores access with the same password. Look for the Deactivate action and the new Status filter on the Users list; inactive accounts carry an "Inactive" badge there.`,
    pl: `Administratorzy mogą teraz dezaktywować konto użytkownika — i je przywrócić. Osoba dezaktywowana nie może się zalogować (widzi wyraźny komunikat „konto zostało dezaktywowane") i nie można jej dodawać do zespołów ani przypisywać nowych celów, spotkań 1:1, ocen czy feedbacków — ale wszystko, co zrobiła, pozostaje widoczne dokładnie jak wcześniej, a ponowna aktywacja przywraca dostęp z tym samym hasłem. Szukaj akcji Dezaktywuj i nowego filtra Status na liście użytkowników; nieaktywne konta mają tam znaczek „Nieaktywny".`,
  },
  {
    version: "1.47.0",
    date: "2026-08-06",
    en: `Search ignores Polish diacritics now. Every list filter (people, teams, goals, KPIs, reviews, feedback, days off, templates, alerts) and every searchable dropdown (picking a manager, a subordinate, a team, a template…) matches accent-insensitively in both directions: typing "zolw" finds "Żółw", and typing "Żółw" finds "Zolw". Capital letters with diacritics work too.`,
    pl: `Wyszukiwanie ignoruje teraz polskie znaki. Każdy filtr list (osoby, zespoły, cele, KPI, oceny, feedbacki, dni wolne, szablony, ogłoszenia) i każda przeszukiwalna lista rozwijana (wybór menedżera, podwładnego, zespołu, szablonu…) dopasowuje bez rozróżniania znaków diakrytycznych w obie strony: wpisując „zolw" znajdziesz „Żółw", a wpisując „Żółw" znajdziesz „Zolw". Wielkie litery ze znakami też działają.`,
  },
  {
    version: "1.46.0",
    date: "2026-08-06",
    en: `Person cards got tidied up. The information on each card (the Dashboard grids and user details) is now grouped into clearly labeled sections: Profile (career path, specialization, seniority), Collaboration (last 1:1, feedback, active goals — with the feedback, 1:1, and goal buttons right there), Performance (last review with its button), and Days off (next vacation and budget left with theirs). Every button now sits next to the information it relates to, instead of piling up at the bottom of the card.`,
    pl: `Karty osób zostały uporządkowane. Informacje na każdej karcie (siatki Pulpitu i szczegóły osoby) są teraz pogrupowane w wyraźnie opisane sekcje: Profil (ścieżka kariery, specjalizacja, poziom), Współpraca (ostatnie 1:1, feedback, aktywne cele — z przyciskami feedbacku, 1:1 i celów tuż obok), Oceny okresowe (ostatnia ocena ze swoim przyciskiem) oraz Dni wolne (najbliższy urlop i pozostały budżet ze swoim). Każdy przycisk sąsiaduje teraz z informacją, której dotyczy, zamiast piętrzyć się na dole karty.`,
  },
  {
    version: "1.45.0",
    date: "2026-08-05",
    en: `Performance found its place in the menu. The left-side item is now called "Performance" and opens two tabs: "My performance" (your published reviews — the old page, unchanged) and, for managers, "Team's performance" — the per-period completion view that used to live as a Dashboard tab. Every big feature in the menu now follows the same shape: your own perspective first, the manager's beside it. Old bookmarks keep working and land on the right tab.`,
    pl: `Oceny okresowe znalazły swoje miejsce w menu. Pozycja po lewej nazywa się teraz „Oceny okresowe" i otwiera dwie zakładki: „Moje oceny" (Twoje opublikowane oceny — dawna strona, bez zmian) oraz, dla menedżerów, „Oceny zespołu" — widok kompletności ocen za wybrany okres, który dotąd był zakładką Pulpitu. Każda duża funkcja w menu ma teraz ten sam kształt: najpierw Twoja perspektywa, obok menedżerska. Stare zakładki w przeglądarce nadal działają i trafiają na właściwą zakładkę.`,
  },
  {
    version: "1.44.0",
    date: "2026-08-05",
    en: `Person cards know about days off now. Your direct reports' cards (on the Dashboard and their details pages) show the start date of their next accepted vacation and how much of this year's paid budget they have left; teammate cards show the next vacation too (budgets stay private). Each report's card also gained a "Days off" button opening a dedicated per-person view — their requests (with accept/reject at hand), their yearly budget, and their corrections — without wading through the whole team tab.`,
    pl: `Karty osób znają teraz dni wolne. Karty Twoich bezpośrednich podwładnych (na Pulpicie i na stronach szczegółów) pokazują datę początku najbliższego zaakceptowanego urlopu oraz ile zostało im z tegorocznego płatnego budżetu; karty osób z zespołu też pokazują najbliższy urlop (budżety pozostają prywatne). Karta każdego podwładnego zyskała też przycisk „Dni wolne" otwierający dedykowany widok tej osoby — jej wnioski (z akceptacją/odrzuceniem pod ręką), roczny budżet i korekty — bez przedzierania się przez całą zakładkę zespołu.`,
  },
  {
    version: "1.43.0",
    date: "2026-08-05",
    en: `Days off got three upgrades. The calendar now clearly marks weekends (gray) and public holidays (warm tint, name on hover) as two distinct kinds of off days. The public-holiday list comes pre-filled with the confirmed Polish statutory holidays for 2026 and 2027 — including movable feasts and the Christmas Eve day off. And managers can now add budget corrections: ± days (halves allowed) on a chosen year of a report's paid-days budget, with a mandatory reason — applied immediately, no approval step, editable and deletable, visible to the person (who also gets a notification), their management chain, and HR — never to teammates.`,
    pl: `Dni wolne dostały trzy ulepszenia. Kalendarz wyraźnie oznacza teraz weekendy (szare) i święta (ciepły odcień, nazwa po najechaniu) jako dwa różne rodzaje dni wolnych. Lista świąt jest wstępnie wypełniona potwierdzonymi polskimi dniami ustawowo wolnymi na lata 2026 i 2027 — łącznie ze świętami ruchomymi i wolną Wigilią. Menedżerowie mogą też dodawać korekty budżetu: ± dni (dozwolone połówki) w wybranym roku budżetu płatnych dni podwładnego, z obowiązkowym uzasadnieniem — działają natychmiast, bez akceptacji, można je edytować i usuwać, widzą je: dana osoba (dostaje też powiadomienie), jej łańcuch menedżerski i HR — nigdy koledzy z zespołu.`,
  },
  {
    version: "1.42.0",
    date: "2026-08-05",
    en: `Days off arrived. The new "Days off" section has a team calendar (everyone sees their teammates' days off; managers also their reports'), your own requests with a paid-days budget — an annual allowance set by an administrator, with unused days carrying over to the next year — and, for managers, a tab to accept or reject their reports' requests and review budgets. A request covers one consecutive period (half days allowed on its first and last day); weekends and the new admin-maintained public holidays never count against the budget.`,
    pl: `Doszły dni wolne. Nowa sekcja „Dni wolne" zawiera kalendarz zespołu (każdy widzi dni wolne osób ze swoich zespołów, menedżerowie także podwładnych), Twoje wnioski z budżetem płatnych dni — roczną pulą ustawianą przez administratora, z przenoszeniem niewykorzystanych dni na kolejny rok — a dla menedżerów zakładkę do akceptowania lub odrzucania wniosków podwładnych i przeglądu budżetów. Wniosek obejmuje jeden ciągły okres (pierwszy i ostatni dzień mogą być połówkami); weekendy oraz nowe, prowadzone przez administratorów święta nigdy nie pomniejszają budżetu.`,
  },
  {
    version: "1.41.0",
    date: "2026-08-04",
    en: `Goals are now "archived" instead of "closed" — the same wording Team KPIs already use, so finishing a goal no longer sounds like closing a window. The status badge, the Archive action (with its summary), "Save & archive", and notifications all use the new wording; existing closed goals and their history were converted automatically.`,
    pl: `Cele są teraz „archiwizowane" zamiast „zamykane" — tak samo jak KPI zespołów, więc zakończenie celu nie brzmi już jak zamykanie okna. Znaczek statusu, akcja Archiwizuj (z podsumowaniem), „Zapisz i zarchiwizuj" oraz powiadomienia używają nowego nazewnictwa; istniejące zamknięte cele i ich historia zostały przekonwertowane automatycznie.`,
  },
  {
    version: "1.40.1",
    date: "2026-08-04",
    en: `The card on a user's details page now renders at the same width as the Dashboard's person cards — no more cramped, narrow layout on wide screens.`,
    pl: `Karta na stronie szczegółów użytkownika ma teraz tę samą szerokość co karty osób na Pulpicie — koniec ze ściśniętym, wąskim układem na szerokich ekranach.`,
  },
  {
    version: "1.40.0",
    date: "2026-08-04",
    en: `The Performance reviews dashboard gained a Distribution view: a toggle next to the period picker switches the table to bar charts showing how ratings spread across your selected group — one tab per category (attitude, delivery, skills, overall), bars colored by the rating scale, with a note on how many people are rated. The period and all filters apply exactly as they do to the table, so a manager can quickly check whether the ratings in any slice of the team are balanced.`,
    pl: `Pulpit ocen okresowych zyskał widok Rozkład: przełącznik obok wyboru okresu zamienia tabelę na wykresy słupkowe pokazujące, jak oceny rozkładają się w wybranej grupie — po jednej zakładce na kategorię (postawa, dostarczanie, umiejętności, ogółem), słupki w kolorach skali ocen, z informacją ile osób jest ocenionych. Okres i wszystkie filtry działają dokładnie tak jak dla tabeli, więc menedżer może szybko sprawdzić, czy oceny w dowolnym wycinku zespołu są zbalansowane.`,
  },
  {
    version: "1.39.0",
    date: "2026-08-04",
    en: `The Dashboard's "Feedback received" tile now counts by the moment feedback was actually delivered (not when it was last edited) and shows a small trend — how the last 30 days compare with the 30 before. Also fixed: opening Feedbacks, 1:1s, Goals, or Reviews from a person's details page now returns you to that details page instead of a Dashboard tab.`,
    pl: `Kafelek „Otrzymany feedback" na Pulpicie liczy teraz według momentu faktycznego dostarczenia feedbacku (a nie ostatniej edycji) i pokazuje mały trend — jak ostatnie 30 dni wypada wobec poprzednich 30. Poprawione też: otwarcie Feedbacków, spotkań 1:1, Celów lub Ocen ze strony szczegółów osoby wraca teraz na tę stronę szczegółów, a nie na zakładkę Pulpitu.`,
  },
  {
    version: "1.38.0",
    date: "2026-08-04",
    en: `Every successful action now confirms itself with a small green toast at the top of the screen — saving a draft, sending feedback, activating a goal, recording a KPI value, publishing a review, changing a password, and every other save or delete. Errors keep appearing right next to the form, as before.`,
    pl: `Każda udana akcja potwierdza się teraz małym zielonym powiadomieniem u góry ekranu — zapisanie wersji roboczej, wysłanie feedbacku, aktywacja celu, zapisanie wartości KPI, publikacja oceny, zmiana hasła i każdy inny zapis lub usunięcie. Błędy nadal pojawiają się bezpośrednio przy formularzu, tak jak dotychczas.`,
  },
  {
    version: "1.37.0",
    date: "2026-08-04",
    en: `Your name and avatar in the header are now a menu: click them to see your email, jump to changing your password, or sign out. The standalone Logout button is gone — signing out lives in the menu, where every modern app keeps it.`,
    pl: `Twoje imię i awatar w nagłówku są teraz menu: kliknij je, aby zobaczyć swój e-mail, przejść do zmiany hasła lub się wylogować. Osobny przycisk wylogowania zniknął — wylogowanie mieszka w menu, tam gdzie trzyma je każda nowoczesna aplikacja.`,
  },
  {
    version: "1.36.0",
    date: "2026-08-04",
    en: `The Dashboard opens with an at-a-glance row of your numbers: feedback requests waiting for your reply, your active goals, and feedback received over the last 30 days — managers additionally see their direct-report count and how many performance reviews they've written for the current period (e.g. 3/7). Every tile is a shortcut to the screen behind the number.`,
    pl: `Pulpit otwiera się teraz rzędem Twoich liczb: prośby o feedback czekające na Twoją odpowiedź, Twoje aktywne cele i feedback otrzymany w ostatnich 30 dniach — menedżerowie widzą dodatkowo liczbę bezpośrednich podwładnych oraz ile ocen okresowych napisali za bieżący okres (np. 3/7). Każdy kafelek jest skrótem do ekranu, z którego pochodzi liczba.`,
  },
  {
    version: "1.35.1",
    date: "2026-08-04",
    en: `Consistent page widths: forms and detail screens now come in exactly two sizes — compact for simple settings forms, comfortable for everything with content — so the layout no longer jumps between narrow and wide as you move through a flow. Editing a feedback or creating a 1:1 now gets the same roomy width as the rest of its flow.`,
    pl: `Spójne szerokości stron: formularze i ekrany szczegółów mają teraz dokładnie dwa rozmiary — zwarty dla prostych formularzy ustawień, wygodny dla wszystkiego z treścią — więc układ nie skacze już między wąskim a szerokim w trakcie przechodzenia przez proces. Edycja feedbacku czy tworzenie 1:1 dostają teraz tę samą przestronną szerokość co reszta ich procesu.`,
  },
  {
    version: "1.35.0",
    date: "2026-08-04",
    en: `A visual refresh across the whole app — the clean, professional look of modern business software. A new logo; a calmer, deeper brand green reserved for buttons, links, and navigation; teal for "delivered/active/published" states so status colors stop imitating the brand; white header and sidebar over a softly tinted canvas; data tables framed as cards with quiet, compact headers and row highlighting; a redesigned sign-in screen; filters on their own surface; softer shadows and tuned typography throughout. Dark mode got the same treatment.`,
    pl: `Wizualne odświeżenie całej aplikacji — czysty, profesjonalny wygląd nowoczesnego oprogramowania biznesowego. Nowe logo; spokojniejsza, głębsza zieleń marki zarezerwowana dla przycisków, linków i nawigacji; morski (teal) dla stanów „wysłany/aktywny/opublikowany", by kolory statusów nie udawały marki; biały nagłówek i panel boczny na delikatnie przyciemnionym tle; tabele danych w ramkach jak karty, z cichymi, zwartymi nagłówkami i podświetlaniem wierszy; przeprojektowany ekran logowania; filtry na własnej powierzchni; miększe cienie i dopracowana typografia w całej aplikacji. Tryb ciemny dostał to samo traktowanie.`,
  },
  {
    version: "1.34.2",
    date: "2026-08-04",
    en: `A performance review can no longer be created for a review period that hasn't started yet. Future periods appear greyed-out in the period picker, the newest already-started period is preselected, and the server enforces the same rule. The currently-running period remains reviewable.`,
    pl: `Oceny okresowej nie można już utworzyć dla okresu, który jeszcze się nie rozpoczął. Przyszłe okresy są wyszarzone w wyborze okresu, domyślnie wybierany jest najnowszy już rozpoczęty okres, a serwer egzekwuje tę samą zasadę. Trwający obecnie okres pozostaje dostępny do oceny.`,
  },
  {
    version: "1.34.1",
    date: "2026-08-04",
    en: `Review periods opened up: Config → Review periods is now visible to everyone, read-only — like Templates. Anyone can check the timeline (with the *Current* marker); adding and deleting periods stays with administrators.`,
    pl: `Okresy ocen otwarte dla wszystkich: Konfiguracja → Okresy ocen jest teraz widoczna dla każdego, tylko do odczytu — jak Szablony. Każdy może sprawdzić oś czasu (ze znacznikiem *Bieżący*); dodawanie i usuwanie okresów pozostaje w rękach administratorów.`,
  },
  {
    version: "1.34.0",
    date: "2026-08-03",
    en: `A round of app-wide polish. The left navigation can now be **hidden and brought back** with the toggle next to the logo — the choice sticks per device, and replaying the tour brings the menu back so every step has its anchor. The review period containing **today** carries a green *Current* marker everywhere periods appear: the period pickers, the Config timeline, and the review screens. Subordinate cards gained a **Last review** line (the period you assessed plus its status), and the dashboard person cards got roomier — two wider cards per row instead of three cramped ones, with long stat lines wrapping cleanly instead of breaking the card.`,
    pl: `Runda szlifów w całej aplikacji. Lewą nawigację można teraz **ukryć i przywrócić** przełącznikiem obok logo — wybór zapamiętuje się na urządzeniu, a ponowne odtworzenie samouczka przywraca menu, by każdy krok miał swój punkt zaczepienia. Okres ocen obejmujący **dzisiaj** nosi zielony znacznik *Bieżący* wszędzie tam, gdzie pojawiają się okresy: w wyborach okresu, na osi czasu w Konfiguracji i na ekranach ocen. Karty podwładnych zyskały wiersz **Ostatnia ocena** (okres, który oceniłeś/aś, plus jej status), a karty osób na Pulpicie mają więcej miejsca — dwie szersze karty w wierszu zamiast trzech ściśniętych, z długimi wierszami statystyk zawijającymi się czysto zamiast rozjeżdżać kartę.`,
  },
  {
    version: "1.33.4",
    date: "2026-08-02",
    en: `The Dashboard's Performance reviews tab now behaves like every other list: the scope and career filters live in the collapsible, auto-saved Filters panel (the period picker stays always visible — it defines what you're looking at), every column is sortable (ratings sort numerically with missing reviews last; status by lifecycle stage), and long teams paginate.`,
    pl: `Zakładka Oceny okresowe na Pulpicie zachowuje się teraz jak każda inna lista: filtry zakresu i kariery mieszkają w zwijanym, samozapisującym się panelu Filtrów (wybór okresu pozostaje zawsze widoczny — on określa, na co patrzysz), każda kolumna jest sortowalna (oceny sortują się liczbowo z brakującymi ocenami na końcu; status według etapu cyklu życia), a długie zespoły są stronicowane.`,
  },
  {
    version: "1.33.3",
    date: "2026-08-02",
    en: `Review periods list each range once: the redundant raw "2026-01 – 2026-06" line under the formatted period is gone.`,
    pl: `Okresy ocen pokazują każdy zakres tylko raz: zbędny surowy wiersz „2026-01 – 2026-06" pod sformatowanym okresem zniknął.`,
  },
  {
    version: "1.33.2",
    date: "2026-08-02",
    en: `Adding a review period no longer requires knowing any date format: the fixed start month is shown as plain text (with the no-gaps rule spelled out), the period's end is picked from month and year dropdowns that simply don't offer anything before the start, a 6-month period comes pre-selected, and a live preview shows exactly what "Add period" will create — including when defining the very first period.`,
    pl: `Dodawanie okresu ocen nie wymaga już znajomości żadnego formatu dat: stały miesiąc początkowy jest zwykłym tekstem (z wyjaśnioną zasadą braku luk), koniec okresu wybiera się z list rozwijanych miesiąca i roku, które po prostu nie oferują niczego przed początkiem, sześciomiesięczny okres jest wstępnie wybrany, a podgląd na żywo pokazuje dokładnie, co utworzy „Dodaj okres" — także przy definiowaniu pierwszego okresu.`,
  },
  {
    version: "1.33.1",
    date: "2026-08-02",
    en: `Performance-review ratings now carry a consistent color scale everywhere they appear — the lower the rating the more orange, the higher the more green. Tables and the Dashboard show colored rating pills, the review screen pairs the colored number with its wording, and the editor's rating picker previews each step's color.`,
    pl: `Oceny w ocenach okresowych mają teraz spójną skalę kolorów wszędzie tam, gdzie się pojawiają — im niższa ocena, tym bardziej pomarańczowa, im wyższa, tym bardziej zielona. Tabele i Pulpit pokazują kolorowe plakietki ocen, ekran oceny łączy kolorowy numer z jego opisem, a wybieraki ocen w edytorze pokazują kolor każdego stopnia.`,
  },
  {
    version: "1.33.0",
    date: "2026-08-02",
    en: `**Performance reviews** arrive. Administrators define the global **review periods** (month ranges, appended without gaps, under Config → Review periods). A manager writes one review per team member and period — four categories (attitude, delivery, skills, overall), each a **1–6 rating** plus a written summary — and walks it through *draft → calibration → published*; during calibration, managers up the chain can read it. Once published, the team member sees it under the new **My performance** menu and gets a notification. Managers get two new vantage points: a **Performance reviews** button on each subordinate's card, and a Dashboard tab showing **every subordinate's review for a chosen period** — including who has none yet — filterable by team, career path, specialization, and seniority. HR auditors can inspect any person's reviews from the user-details page.`,
    pl: `Nadchodzą **oceny okresowe**. Administratorzy definiują globalne **okresy ocen** (zakresy miesięcy, dodawane bez luk, w Konfiguracja → Okresy ocen). Menedżer pisze jedną ocenę na członka zespołu i okres — cztery kategorie (postawa, realizacja, umiejętności, ocena ogólna), każda z **oceną 1–6** i pisemnym podsumowaniem — i prowadzi ją przez *szkic → kalibrację → publikację*; podczas kalibracji ocenę widzą menedżerowie wyżej w strukturze. Po publikacji członek zespołu widzi ją w nowym menu **Moje oceny** i dostaje powiadomienie. Menedżerowie zyskują dwa nowe widoki: przycisk **Oceny okresowe** na karcie każdego podwładnego oraz zakładkę Pulpitu pokazującą **oceny wszystkich podwładnych za wybrany okres** — także tych, którzy jeszcze oceny nie mają — z filtrami zespołu, ścieżki kariery, specjalizacji i poziomu. Audytorzy HR przeglądają oceny dowolnej osoby ze strony szczegółów użytkownika.`,
  },
  {
    version: "1.32.2",
    date: "2026-08-02",
    en: `Person-card polish: the career column now sits reliably beside the stats on every card — previously it silently dropped below whenever the stats ran wide, so some grids appeared single-column. The redundant "Career profile" caption is gone, and the card labels are compact (Path, Specialization, Seniority); the edit forms keep the full wordings.`,
    pl: `Szlif kart osób: kolumna kariery stoi teraz niezawodnie obok statystyk na każdej karcie — wcześniej po cichu spadała niżej, gdy statystyki były szerokie, przez co niektóre listy wyglądały na jednokolumnowe. Zbędny nagłówek „Profil kariery" zniknął, a etykiety na kartach są zwięzłe (Ścieżka, Specjalizacja, Poziom); formularze edycji zachowują pełne nazwy.`,
  },
  {
    version: "1.32.1",
    date: "2026-08-02",
    en: `The career profile moved into the person cards themselves: on the user-details page and on all three Dashboard grids (My managers, My peers, My subordinates), each card now shows the career path, specialization, and seniority level in a second column next to the existing stats — with the orange "Not set" marker where a value is still missing. The separate panel on the details page is gone.`,
    pl: `Profil kariery przeniósł się do samych kart osób: na stronie szczegółów użytkownika i na wszystkich trzech listach Pulpitu (Moi menedżerowie, Moi współpracownicy, Moi podwładni) każda karta pokazuje teraz ścieżkę kariery, specjalizację i poziom zaszeregowania w drugiej kolumnie obok dotychczasowych statystyk — z pomarańczowym znacznikiem „Nie ustawiono" tam, gdzie wartości wciąż brakuje. Osobny panel na stronie szczegółów zniknął.`,
  },
  {
    version: "1.32.0",
    date: "2026-08-02",
    en: `Every user now carries a **career profile**: a career path, a career specialization, and a seniority level, picked from the global dictionaries. The values appear on the user-details page for everyone; administrators set them when creating a user or later on the edit form. They start empty — an orange hint flags what's still missing — but once set, a value can only be replaced, never removed. Renaming a dictionary entry updates every profile that uses it, immediately.`,
    pl: `Każda osoba ma teraz **profil kariery**: ścieżkę kariery, specjalizację i poziom zaszeregowania, wybierane z globalnych słowników. Wartości widać na stronie szczegółów użytkownika dla każdego; administratorzy ustawiają je przy tworzeniu konta lub później w formularzu edycji. Na starcie są puste — pomarańczowa wskazówka pokazuje, czego jeszcze brakuje — ale raz ustawioną wartość można tylko zastąpić, nigdy usunąć. Zmiana nazwy wpisu w słowniku natychmiast aktualizuje każdy profil, który z niego korzysta.`,
  },
  {
    version: "1.31.1",
    date: "2026-08-02",
    en: `The global dictionaries no longer start empty: **Career paths** (Software Engineer, System Analyst, QA Engineer, QA Specialist), **Career specializations** (N/A, Java, Python, PHP, Front-End), and **Seniority levels** (Associate through Principal) come pre-filled with sensible defaults. Values an administrator already entered are left untouched.`,
    pl: `Globalne słowniki nie zaczynają już od zera: **Ścieżki kariery** (Software Engineer, System Analyst, QA Engineer, QA Specialist), **Specjalizacje** (N/A, Java, Python, PHP, Front-End) i **Poziomy zaszeregowania** (od Associate po Principal) mają teraz sensowne wartości domyślne. Wartości wprowadzone wcześniej przez administratora pozostają nietknięte.`,
  },
  {
    version: "1.31.0",
    date: "2026-08-02",
    en: `Three global dictionaries arrive under the new **Dictionaries** menu: **Career paths**, **Career specializations**, and **Seniority levels**. Everyone can browse the ordered values; administrators curate each list in place — add, rename, reorder, and remove entries, then save the whole dictionary in one go. Values are unique within a dictionary, and removed entries are retired rather than erased.`,
    pl: `Pod nowym menu **Słowniki** pojawiają się trzy globalne słowniki: **Ścieżki kariery**, **Specjalizacje** i **Poziomy zaszeregowania**. Każdy może przeglądać uporządkowane wartości; administratorzy pielęgnują każdą listę na miejscu — dodają, zmieniają, przestawiają i usuwają wpisy, a potem zapisują cały słownik za jednym razem. Wartości są unikalne w obrębie słownika, a usunięte wpisy są wycofywane, nie kasowane.`,
  },
  {
    version: "1.30.2",
    date: "2026-08-02",
    en: `The org chart no longer loses people: users who belong to no team (and manage none) now appear in a **Not in any team** section below the chart, as ordinary clickable nodes — previously they were missing from the picture entirely.`,
    pl: `Struktura organizacji nie gubi już ludzi: osoby, które nie należą do żadnego zespołu (i żadnym nie kierują), pojawiają się teraz w sekcji **Poza zespołami** pod strukturą, jako zwykłe klikalne kafelki — wcześniej w ogóle brakowało ich na obrazie.`,
  },
  {
    version: "1.30.1",
    date: "2026-08-02",
    en: `Housekeeping after the Team-KPI releases: the guided tour caught up with reality (KPIs are *archived*, not closed; the KPI data tab and the wider notification bell get a mention), the Goals page's "Goals I've set" tab gained its own **New goal** button (no more detouring through a subordinate's card), and KPIs of a disbanded team now say *(deleted)* next to the team's name in the list.`,
    pl: `Porządki po wydaniach KPI zespołów: samouczek dogonił rzeczywistość (KPI się *archiwizuje*, nie zamyka; zakładka Dane KPI i szerszy dzwonek powiadomień doczekały się wzmianki), zakładka „Cele wyznaczone przeze mnie" na stronie Celów zyskała własny przycisk **Nowy cel** (koniec z okrężną drogą przez kartę podwładnego), a KPI rozwiązanego zespołu mają teraz dopisek *(usunięty)* przy nazwie zespołu na liście.`,
  },
  {
    version: "1.30.0",
    date: "2026-08-02",
    en: `Team members now hear about their KPIs' data changing, not just their lifecycle: when the manager records, corrects, or removes a data point, every member gets a notification naming the value and its date ("Mona recorded 72% for Jul 27, 2026 on the KPI …"), linking straight to the KPI. Activation and archiving notified already — the set is now complete.`,
    pl: `Członkowie zespołu dowiadują się teraz o zmianach danych swoich KPI, nie tylko o ich cyklu życia: gdy menedżer zapisze, poprawi lub usunie punkt danych, każdy członek dostaje powiadomienie z wartością i jej datą („Mona zapisała 72% z dnia 27 lip 2026 w KPI …"), prowadzące prosto do KPI. Aktywacja i archiwizacja powiadamiały już wcześniej — zestaw jest teraz kompletny.`,
  },
  {
    version: "1.29.2",
    date: "2026-08-01",
    en: `A percentage team KPI's history now says so: value and target entries carry the % suffix ("Value 72% recorded for Jul 27, 2026."), matching how the rest of the screen formats them.`,
    pl: `Historia procentowego KPI zespołu w końcu to pokazuje: wpisy o wartościach i celu mają przyrostek % („Zapisano wartość 72% z dnia 27 lip 2026"), tak jak formatuje je reszta ekranu.`,
  },
  {
    version: "1.29.1",
    date: "2026-08-01",
    en: `Team-KPI polish: the graph's hover tooltip renders as one tidy card again (a missing chart stylesheet had been scattering its pieces across the plot), a draft KPI's row button in the lists is now **Edit** — straight into the editor, no detour through the view — and the *New team KPI* button moved below the list, where every other create button in the app lives.`,
    pl: `Szlify KPI zespołów: dymek na wykresie znów wyświetla się jako jedna schludna karta (brakujący arkusz stylów wykresów rozrzucał jego elementy po całym rysunku), przycisk wiersza szkicu KPI na listach to teraz **Edytuj** — prosto do edytora, bez skoku przez widok — a przycisk *Nowe KPI zespołu* przeniósł się pod listę, gdzie mieszkają wszystkie pozostałe przyciski tworzenia w aplikacji.`,
  },
  {
    version: "1.29.0",
    date: "2026-08-01",
    en: `The Team-KPI screen was rebuilt around **editable data points**: one screen with four tabs — *General* (title, description, type, target), the new **KPI data** (every collected date + value, newest first, where the manager of an active KPI adds, corrects, and removes points directly — each change applies immediately), *Graph*, and *History*. Lists always open a KPI in this view (the separate progress editor is gone), the current value simply follows the latest-dated point, and closing a KPI is now called **archiving** — the status reads *Archived*. The graph also got two fixes: hovering a point no longer conjures a phantom second value, and the dashed target line stays visible even when all recorded values are far from it.`,
    pl: `Ekran KPI zespołu został przebudowany wokół **edytowalnych punktów danych**: jeden ekran z czterema zakładkami — *Ogólne* (tytuł, opis, typ, wartość docelowa), nowa zakładka **Dane KPI** (wszystkie zebrane pary data + wartość, od najnowszych, gdzie menedżer aktywnego KPI dodaje, poprawia i usuwa punkty bezpośrednio — każda zmiana zapisuje się od razu), *Wykres* i *Historia*. Listy zawsze otwierają KPI w tym widoku (osobny edytor postępu zniknął), wartość bieżąca po prostu podąża za punktem o najnowszej dacie, a zamykanie KPI nazywa się teraz **archiwizacją** — status brzmi *Zarchiwizowane*. Wykres dostał też dwie poprawki: najechanie na punkt nie wyczarowuje już widmowej drugiej wartości, a przerywana linia celu pozostaje widoczna nawet wtedy, gdy wszystkie zapisane wartości są od niej daleko.`,
  },
  {
    version: "1.28.0",
    date: "2026-08-01",
    en: `Team-KPI refinements: recording a value now asks **when it was measured** — the new *Value date* field defaults to today and accepts any past date (never a future one), so history can be backfilled; the graph plots each value at its measurement date, the KPI's *Current* value always reflects the latest-dated recording (a backfill never overwrites it), and the view shows *Current* with its "as of" date. The **Graph** tab is also available while updating progress, so a manager sees the trend as they record.`,
    pl: `Usprawnienia KPI zespołów: przy zapisie wartości aplikacja pyta teraz, **kiedy ją zmierzono** — nowe pole *Data wartości* domyślnie wskazuje dziś i przyjmuje dowolną datę z przeszłości (nigdy z przyszłości), więc można uzupełniać historię wstecz; wykres umieszcza każdą wartość pod datą pomiaru, *Wartość bieżąca* KPI zawsze odpowiada zapisowi o najnowszej dacie (uzupełnienie wsteczne nigdy jej nie nadpisuje), a widok pokazuje ją wraz z datą „na dzień". Zakładka **Wykres** jest też dostępna podczas aktualizacji postępu, więc menedżer widzi trend już w trakcie zapisywania.`,
  },
  {
    version: "1.27.0",
    date: "2026-08-01",
    en: `New feature: **Team KPIs** — measurable indicators a manager sets for a whole team (a number or a percentage, with a target and a tracked current value; same draft/active/closed lifecycle as goals, without a due date). The team's current manager defines and updates them; team members see every active or closed KPI of their teams under the new left-menu **Team KPIs** section and are notified about status changes. Each KPI's view offers a **Graph** tab plotting its value over time against the target, and the Dashboard's *My teams* tab gained a per-team **Team KPIs** button.`,
    pl: `Nowa funkcja: **KPI zespołów** — mierzalne wskaźniki, które menedżer wyznacza całemu zespołowi (liczba lub procent, z wartością docelową i śledzoną wartością bieżącą; ten sam cykl życia szkic/aktywny/zamknięty co przy celach, ale bez terminu). Definiuje i aktualizuje je aktualny menedżer zespołu; członkowie zespołu widzą każde aktywne lub zamknięte KPI swoich zespołów w nowej sekcji **KPI zespołów** w menu bocznym i otrzymują powiadomienia o zmianach statusu. Widok każdego KPI ma zakładkę **Wykres** z wartością w czasie na tle celu, a zakładka *Moje zespoły* na Pulpicie zyskała przycisk **KPI zespołu** przy każdym zespole.`,
  },
  {
    version: "1.26.0",
    date: "2026-08-01",
    en: `The **Admin** role is now strictly a management role: admins create and manage users, teams, and templates (and alerts), but no longer have any special access to feedbacks, 1:1 meetings, goals, or other users' notifications — there they act as regular users. Auditing (the *Audit* section on a user's details page and its read-only views) now belongs exclusively to the **HR** role; a person who needs both capabilities simply holds both roles.`,
    pl: `Rola **Administrator** jest teraz ściśle rolą zarządczą: administratorzy tworzą i zarządzają użytkownikami, zespołami i szablonami (oraz alertami), ale nie mają już żadnego specjalnego dostępu do feedbacków, spotkań 1:1, celów ani powiadomień innych użytkowników — tam działają jak zwykli użytkownicy. Audyt (sekcja *Audyt* na stronie szczegółów użytkownika i jej widoki tylko do odczytu) należy teraz wyłącznie do roli **HR**; osoba potrzebująca obu możliwości po prostu posiada obie role.`,
  },
  {
    version: "1.25.0",
    date: "2026-07-31",
    en: `A new **HR** role turns its holder into a read-only auditor: they can browse everything any user is a party to — feedbacks (drafts included), 1:1 meetings, and goals — without gaining any write access; other users' data stays exactly as editable as before, which for HR means not at all. Auditors reach it from a user's details page via the new *Audit* section, and every such access is recorded in the security audit trail. Admins get the same browsing surface.`,
    pl: `Nowa rola **HR** czyni jej posiadacza/posiadaczkę audytorem tylko do odczytu: może przeglądać wszystko, czego stroną jest dowolny użytkownik — feedbacki (łącznie ze szkicami), spotkania 1:1 i cele — nie zyskując żadnych praw zapisu; dane innych użytkowników pozostają dokładnie tak edytowalne jak wcześniej, czyli dla HR wcale. Audytorzy docierają do nich ze strony szczegółów użytkownika przez nową sekcję *Audyt*, a każdy taki dostęp jest rejestrowany w dzienniku bezpieczeństwa. Administratorzy dostają tę samą możliwość przeglądania.`,
  },
  {
    version: "1.24.1",
    date: "2026-07-31",
    en: `Accessibility fix: the remove button on each selected role in the *Roles* field now announces itself to screen readers ("Remove role Admin") instead of being an unnamed button.`,
    pl: `Poprawka dostępności: przycisk usuwania przy każdej wybranej roli w polu *Role* przedstawia się teraz czytnikom ekranu („Usuń rolę Administrator") zamiast być przyciskiem bez nazwy.`,
  },
  {
    version: "1.24.0",
    date: "2026-07-31",
    en: `User roles work differently now: everyone is a regular user by default, and roles such as **Admin** are additional grants on top — a user can hold none, one, or (in the future) several. The user form's single role dropdown became a *Roles* multi-select, the *Users* list shows a badge per additional role (and a dash for none), and the role column is no longer sortable. Nothing changes about what admins can do — their privileges still add to, never replace, regular-user rights.`,
    pl: `Role użytkowników działają teraz inaczej: każdy jest domyślnie zwykłym użytkownikiem, a role takie jak **Administrator** są dodatkowymi uprawnieniami — użytkownik może nie mieć żadnej, mieć jedną albo (w przyszłości) kilka. Pojedyncza lista rozwijana roli w formularzu użytkownika stała się polem wielokrotnego wyboru *Role*, lista *Użytkownicy* pokazuje odznakę dla każdej dodatkowej roli (a kreskę przy jej braku), a kolumny ról nie da się już sortować. Zakres możliwości administratorów się nie zmienia — ich uprawnienia nadal dodają się do praw zwykłego użytkownika, nigdy ich nie zastępują.`,
  },
  {
    version: "1.23.2",
    date: "2026-07-31",
    en: `The top bar now shows your initials avatar next to your name — the same colored avatar you know from the dashboard cards and lists — instead of a generic icon.`,
    pl: `Górny pasek pokazuje teraz obok Twojego imienia awatar z inicjałami — ten sam kolorowy awatar, który znasz z kart pulpitu i list — zamiast ogólnej ikony.`,
  },
  {
    version: "1.23.1",
    date: "2026-07-30",
    en: `Fix: opening a team from the *Org chart* now shows a *Back to Org chart* link on the roster — previously it pointed back to the teams list.`,
    pl: `Poprawka: po otwarciu zespołu ze *Struktury organizacji* lista członków ma teraz link *Powrót do: Struktura organizacji* — wcześniej prowadził z powrotem do listy zespołów.`,
  },
  {
    version: "1.23.0",
    date: "2026-07-30",
    en: `A new **Org chart** (Config → Org chart) draws the whole organization on one zoomable canvas: each manager connects down to the teams they run, teams connect to their members — and a member who manages a team of their own links onward, so the full chain is visible at a glance. Click a person to open their details, or a team to open its roster. The guided tour introduces the new page.`,
    pl: `Nowa **Struktura organizacji** (Konfiguracja → Struktura organizacji) rysuje całą organizację na jednym przybliżanym diagramie: każdy menedżer łączy się w dół z zespołami, którymi kieruje, zespoły ze swoimi członkami — a członek kierujący własnym zespołem prowadzi dalej, więc cały łańcuch widać od razu. Kliknij osobę, aby otworzyć jej szczegóły, albo zespół, aby zobaczyć jego skład. Samouczek przedstawia nową stronę.`,
  },
  {
    version: "1.22.2",
    date: "2026-07-30",
    en: `The *Teams* list now offers *User details* right next to each team's manager, opening the manager's relationship-aware card; its back link returns to the teams list. On the *Users* list the row actions lead with *User details* and *Teams*.`,
    pl: `Lista *Zespoły* oferuje teraz *Szczegóły użytkownika* tuż obok menedżera każdego zespołu — przycisk otwiera kartę menedżera dobraną według Waszej relacji, a link powrotny prowadzi z powrotem do listy zespołów. Na liście *Użytkownicy* akcje wiersza zaczynają się teraz od *Szczegółów użytkownika* i *Zespołów*.`,
  },
  {
    version: "1.22.1",
    date: "2026-07-30",
    en: `The guided tour caught up with the new *Goals* page: it now walks both tabs — *My goals* for everyone, and *Goals I've set* (with its Reports filter) for managers.`,
    pl: `Samouczek nadrobił nową stronę *Cele*: przechodzi teraz przez obie zakładki — *Moje cele* dla wszystkich oraz *Cele wyznaczone przeze mnie* (z filtrem Podwładni) dla menedżerów.`,
  },
  {
    version: "1.22.0",
    date: "2026-07-29",
    en: `The left-menu *My goals* is now **Goals**, with two tabs. *My goals* is the list you know — every goal your managers set for you. The new *Goals I've set* tab (managers only) lists the goals you created across all your team members, with a subordinate column and filter, plus a *Reports* filter: your own goals by default, or — with *All reports (including indirect)* — also the goals set by managers further down your chain (their drafts stay private).`,
    pl: `Pozycja *Moje cele* w lewym menu to teraz **Cele**, z dwiema zakładkami. *Moje cele* to znana Ci lista — wszystkie cele wyznaczone Ci przez menedżerów. Nowa zakładka *Cele wyznaczone przeze mnie* (tylko dla menedżerów) pokazuje cele, które utworzyłeś/aś dla wszystkich swoich podwładnych, z kolumną i filtrem podwładnego oraz filtrem *Podwładni*: domyślnie Twoje własne cele, a z opcją *Wszyscy podwładni (także pośredni)* — również cele wyznaczone przez menedżerów niżej w Twoim łańcuchu (ich szkice pozostają prywatne).`,
  },
  {
    version: "1.21.0",
    date: "2026-07-29",
    en: `A new read-only **User details** view shows a person's card — the same card as on the Dashboard, picked by your relationship to them (one of your managers, one of your subordinates, or a peer), with the matching stats and quick actions. Open it with the new *User details* button next to each person on the *Users* list and on a team's members list; a link takes you back to where you came from.`,
    pl: `Nowy widok **Szczegóły użytkownika** (tylko do odczytu) pokazuje kartę osoby — taką samą jak na Pulpicie, dobraną według Twojej relacji z tą osobą (jeden/jedna z Twoich menedżerów, podwładnych albo współpracowników), z pasującymi statystykami i szybkimi akcjami. Otwórz go nowym przyciskiem *Szczegóły użytkownika* obok każdej osoby na liście *Użytkownicy* oraz na liście członków zespołu; link przeniesie Cię z powrotem tam, skąd przyszedłeś/przyszłaś.`,
  },
  {
    version: "1.20.0",
    date: "2026-07-27",
    en: `A new **My teams** tab on the Dashboard lists the teams you manage. Each team opens its own members view — the same cards, stats, and actions as *My subordinates*, just limited to that one team — and every screen you open from there (feedback forms, 1:1s, goals) brings you back to it.`,
    pl: `Nowa zakładka **Moje zespoły** na Pulpicie pokazuje zespoły, którymi zarządzasz. Każdy zespół otwiera własny widok członków — te same karty, statystyki i akcje co *Moi podwładni*, tylko ograniczone do tego jednego zespołu — a każdy ekran otwarty z tego miejsca (formularze feedbacku, spotkania 1:1, cele) przywraca Cię do niego.`,
  },
  {
    version: "1.19.0",
    date: "2026-07-27",
    en: `Goals now have a **due date** — the date by which the goal should be completed. It is required when creating a goal, editable while the goal is a draft, and shown on the goal's pages and as a new sortable *Due date* column in every goals list. The due date can never be set in the past, a stale draft must get a fresh date before it can be activated, and an active goal past its due date is flagged with an orange *Overdue* badge.`,
    pl: `Cele mają teraz **termin** — datę, do której cel powinien zostać zrealizowany. Jest wymagany przy tworzeniu celu, edytowalny póki cel jest szkicem i widoczny na stronach celu oraz jako nowa sortowalna kolumna *Termin* na każdej liście celów. Terminu nie można ustawić w przeszłości, przeterminowany szkic musi dostać nowy termin przed aktywacją, a aktywny cel po terminie jest oznaczony pomarańczową plakietką *Po terminie*.`,
  },
  {
    version: "1.18.6",
    date: "2026-07-26",
    en: `Polish under the hood: the Dashboard's *Active goals* and *Last 1:1* card stats now refresh immediately after you change a goal or 1:1 meeting (no page reload needed); on a goal's page each action button shows its own progress spinner; and goal lists show plain *You* instead of your own avatar chip.`,
    pl: `Szlify pod maską: statystyki *Aktywne cele* i *Ostatnie 1:1* na kartach Pulpitu odświeżają się teraz natychmiast po zmianie celu lub spotkania 1:1 (bez przeładowania strony); na stronie celu każdy przycisk akcji pokazuje własny wskaźnik postępu; a listy celów pokazują zwykłe *Ty* zamiast Twojego własnego awatara.`,
  },
  {
    version: "1.18.5",
    date: "2026-07-26",
    en: `The guided tour now walks the whole left menu first — including a new step for the *Changelog* page — and only then the top-right header icons (notifications, language, theme).`,
    pl: `Samouczek przechodzi teraz najpierw przez całe lewe menu — w tym nowy krok dla strony *Historia zmian* — a dopiero potem przez ikony w prawym górnym rogu (powiadomienia, język, motyw).`,
  },
  {
    version: "1.18.4",
    date: "2026-07-26",
    en: `The guided tour now also introduces the *My goals* page — the step comes right after the 1:1 meetings section.`,
    pl: `Samouczek obejmuje teraz także stronę *Moje cele* — ten krok pojawia się zaraz po sekcji spotkań 1:1.`,
  },
  {
    version: "1.18.3",
    date: "2026-07-26",
    en: `After creating a goal you're now asked whether to activate it immediately — *Yes* makes it active on the spot, *No* keeps it a draft — and either way you return to the screen you started from, instead of landing in the goal's editor.`,
    pl: `Po utworzeniu celu pojawia się teraz pytanie, czy od razu go aktywować — *Tak* natychmiast go aktywuje, *Nie* pozostawia szkic — i niezależnie od odpowiedzi wracasz na ekran, z którego przyszedłeś/przyszłaś, zamiast lądować w edytorze celu.`,
  },
  {
    version: "1.18.2",
    date: "2026-07-26",
    en: `Creating a goal now takes you straight to its editor — the same place a new 1:1 meeting lands — so you can keep refining the draft or activate it with one click, instead of passing through the read-only view first.`,
    pl: `Utworzenie celu przenosi Cię teraz prosto do jego edytora — tam, gdzie ląduje też nowe spotkanie 1:1 — więc możesz dalej dopracowywać szkic albo aktywować go jednym kliknięciem, zamiast przechodzić najpierw przez widok tylko do odczytu.`,
  },
  {
    version: "1.18.1",
    date: "2026-07-26",
    en: `The manager and subordinate cards on the Dashboard now show *Active goals* — the number of currently active goals between you and that person (goals they set for you on the *My managers* tab, goals you set for them on *My subordinates*), next to the existing *Last 1:1* and *Last feedback* stats.`,
    pl: `Karty menedżerów i podwładnych na Pulpicie pokazują teraz *Aktywne cele* — liczbę aktualnie aktywnych celów między Tobą a daną osobą (cele wyznaczone Tobie na zakładce *Moi menedżerowie*, cele wyznaczone przez Ciebie na *Moich podwładnych*), obok dotychczasowych statystyk *Ostatnie 1:1* i *Ostatni feedback*.`,
  },
  {
    version: "1.18.0",
    date: "2026-07-26",
    en: `A new *My goals* entry in the left menu opens all the goals your managers set for you — across every manager — in one list, with a *Manager* column (sortable and filterable) showing who each goal comes from. Opening a goal from a notification now also returns you to *My goals* instead of the dashboard.`,
    pl: `Nowa pozycja *Moje cele* w lewym menu otwiera wszystkie cele wyznaczone Ci przez menedżerów — od wszystkich naraz — na jednej liście, z kolumną *Menedżer* (sortowaną i filtrowaną) pokazującą, od kogo pochodzi każdy cel. Otwarcie celu z powiadomienia wraca teraz także do *Moich celów* zamiast na pulpit.`,
  },
  {
    version: "1.17.2",
    date: "2026-07-26",
    en: `The active goal editor completes the pattern: its footer now offers *Return to draft* (saves your progress, then reopens the definition for editing right there) and *Save & close* (saves and opens the closing dialog, which requires a summary) alongside the plain *Save*.`,
    pl: `Edytor aktywnego celu domyka wzorzec: jego stopka oferuje teraz *Wróć do szkicu* (zapisuje postęp i od razu otwiera definicję do edycji) oraz *Zapisz i zamknij* (zapisuje i otwiera okno zamknięcia, które wymaga podsumowania) obok zwykłego *Zapisz*.`,
  },
  {
    version: "1.17.1",
    date: "2026-07-26",
    en: `The draft goal editor can now move the goal forward directly: its footer offers *Save draft* and *Save & activate* (the feedback editor's pattern), so activating a finished draft no longer requires a detour through the goal's view.`,
    pl: `Edytor szkicu celu może teraz od razu przenieść cel dalej: jego stopka oferuje *Zapisz wersję roboczą* i *Zapisz i aktywuj* (wzorem edytora feedbacku), więc aktywacja gotowego szkicu nie wymaga już wchodzenia w widok celu.`,
  },
  {
    version: "1.17.0",
    date: "2026-07-25",
    en: `Managers can now create goals. Each direct-report card on the Dashboard's *My subordinates* tab gained a *Goals* button opening the list of goals you set for that person, and at its bottom a *New goal* button (the *New 1:1* pattern) opens the goal form with that team member preselected — title, description, type and target. A created goal starts as a draft and lands on its view, where *Activate* is one click away.`,
    pl: `Menedżerowie mogą teraz tworzyć cele. Każda karta bezpośredniego podwładnego na zakładce *Moi podwładni* na Pulpicie zyskała przycisk *Cele*, otwierający listę celów, które wyznaczyłeś/aś tej osobie, a na jej dole przycisk *Nowy cel* (wzorem *Nowe 1:1*) otwiera formularz celu z wybranym już członkiem zespołu — tytuł, opis, typ i wartość docelowa. Utworzony cel zaczyna jako szkic i otwiera się w swoim widoku, gdzie *Aktywuj* jest o jedno kliknięcie.`,
  },
  {
    version: "1.16.0",
    date: "2026-07-25",
    en: `Goals arrive: a manager can set tracked goals for their team members (done/not-done, numeric, or percentage targets). Each manager card on the Dashboard's *My managers* tab gained a *Goals* button opening the list of goals that manager set for you — filterable by title, creation date and status, sortable and paginated — and every goal opens into a full view with its description, progress and change history. Managers activate, close (with a summary) and reopen goals, and you get a notification on every such change.`,
    pl: `Nadchodzą cele: menedżer może wyznaczać członkom zespołu śledzone cele (zrobione/niezrobione, liczbowe lub procentowe). Każda karta menedżera na zakładce *Moi menedżerowie* na Pulpicie zyskała przycisk *Cele*, otwierający listę celów, które ten menedżer wyznaczył dla Ciebie — filtrowaną po tytule, dacie utworzenia i statusie, sortowaną i stronicowaną — a każdy cel otwiera się w pełnym widoku z opisem, postępem i historią zmian. Menedżerowie aktywują, zamykają (z podsumowaniem) i ponownie otwierają cele, a Ty dostajesz powiadomienie o każdej takiej zmianie.`,
  },
  {
    version: "1.15.9",
    date: "2026-07-24",
    en: `When editing a 1:1 meeting, all three lists — *Points discussed*, *Decisions made* and *Action items* — now number their rows (separately per list), so you can see the order you are rearranging with the up/down arrows.`,
    pl: `Podczas edycji spotkania 1:1 wszystkie trzy listy — *Omówione punkty*, *Podjęte decyzje* i *Zadania* — numerują teraz swoje wiersze (osobno w każdej liście), więc widzisz kolejność, którą zmieniasz strzałkami w górę/w dół.`,
  },
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
