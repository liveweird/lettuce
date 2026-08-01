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
