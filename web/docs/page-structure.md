# Page structure & accessibility — SPA (v4.21.0, `web/`)

Moved out of `web/CLAUDE.md` so it is read on demand; `web/CLAUDE.md` keeps a mandatory-read pointer here and the two always-on rules (one h1 per page; spinners via `LoadingSpinner`).

## Headings

- **One `h1` per page, no skipped levels.** The page title is `<Title order={1} size="h2">` (`PageHeader` does it; pages titling themselves copy the pair) — the `size` keeps the look the old `order={2}` had. In-page sections are `order={2}` with `size` = the look they need (`h3`/`h4`); never `order={1}` twice, never jump a level.
- A heading inside a Modal/Drawer sits under that dialog's own title (an h2): leave it. The telemetry panel is an aside with its own h2/h3/h4 outline. `AuthCard` (Login/ResetPassword): the brand is plain text, the card title is the h1.
- **User markdown never adds an h1** (`components/MarkdownView.tsx`): its headings render one level lower (`#` → h2 … `#####` → h6, `######` stays h6) and keep the SIZE of the level they were written at through `data-md-level` rules in `MarkdownView.module.css` (Mantine's Typography sizes by tag).

## Title + focus on navigation — ONE Shell mechanism

`hooks/usePageTitleAndFocus.ts`, called from `Shell`. No per-page title code.

- `document.title` = `<main h1> · <brand>` (just the brand while there is no h1), kept current by a MutationObserver on `#main-content` that updates directly in its callback (no animation frame: it must work in a background tab); the unauthenticated `AuthCard` sets its own.
- A PATHNAME change (not the first load, not a search-param/tab change) focuses the new h1 (`tabindex="-1"`, `preventScroll` so Back/Forward scroll restoration survives) unless focus is already inside main, the telemetry aside, or an overlay (`[role="dialog"]`, `[role="alertdialog"]` — the Joyride tour tooltip —, `[aria-modal="true"]`). A request still pending after 3 s or at the next pathname change is dropped, so a heading that mounts very late cannot pull focus.
- The one focus rule is `index.css`'s `#main-content h1[tabindex="-1"]:focus-visible` (the theme ring; `:focus` draws nothing, so a mouse navigation shows none).

## Spinners

`components/LoadingSpinner.tsx` (a Mantine `Loader` with `role="progressbar"` named `common.state.loading`) — never a bare `<Loader>`; `CenteredLoader`/`TableLoadingRow` use it. Where the surrounding control already announces busy state (`aria-busy`), pass `aria-hidden`.

## Intent preload

Nav links (`appShell/AppNav.tsx`) spread `useIntentPreload()`'s `onPointerEnter`/`onFocus`, which warm the target's lazy chunk through `routePreload.ts`'s `preloadRoute` — it never rejects, and `lazyPage.preload()` is memoised (a rejection clears the memo). The route table is INJECTED by the Shell (`IntentPreloadContext`, App.tsx `warmRoute`), never imported: the table contains the Shell, which contains the nav. Without the provider the handlers are no-ops. A new link that should warm its page spreads the same hook.

## Sign-in autofill

The email field is `autoComplete="username"` + `name="email"` + `spellCheck={false}`; `ChangeUserPassword` carries a hidden read-only username input with the target account's email so password managers save the new password against the right account.

## Related (in `web/docs/list-pages.md`)

- `TruncatedText`/`TruncationTooltip` — single-line names and emails whose full text stays reachable (hover + keyboard focus host; not full WCAG 1.4.13).
- `scrollEdges.module.css` — edge shadows and pinned columns on the matrix scrollers and DaysOffMonthGrid.
