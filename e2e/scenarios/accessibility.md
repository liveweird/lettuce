# Accessibility smoke — axe over login plus every nav area

- **Spec**: [tests/accessibility.spec.ts](../tests/accessibility.spec.ts)
- **Actors**: nobody (the login screen), Administrator (all authenticated pages — the admin's
  read-only views of every nav area)
- **Owns** (exclusive server-side state): nothing — strictly read-only, which is why it shares
  the main chromium phase safely: that includes scanning the /alerts and /pulse *management
  lists* (reading them mutates nothing the later alerts/pulse phases own)

Every scan runs axe with the WCAG 2.0/2.1 A and AA rule tags and **no waived rules** (since
v3.3.0): the theme-wide colour pass brought every text/badge/link colour to the 4.5:1 AA ratio
in both schemes, so `color-contrast` runs like every other rule — a contrast finding is a token
bug in `themeVariables.ts`, never a reason to re-waive. Any other violation is a regression in
names, roles, or structure.

## Scenario: login screen has no WCAG A/AA violations

1. Open the sign-in screen (unauthenticated) and wait for the "Sign in" button.
2. Run the axe scan (WCAG A/AA tags, nothing waived).
   - *Expected*: zero violations, reported one line per violation with the offending elements
     when it fails.

## Scenario: <path> has no WCAG A/AA violations

One generated test per scanned page — the title pattern instantiates once per path, keeping the
report line-per-page. The 27 authenticated pages currently scanned (path → the heading that must
be visible before scanning):

- `/` → Dashboard
- `/users` → Users
- `/users/new` → New user
- `/teams` → Teams
- `/feedback` → Feedback
- `/kudos` → Kudos
- `/goals` → Goals
- `/impact-log` → Impact log
- `/one-on-ones` → 1:1 meetings
- `/performance` → Performance
- `/career` → Career
- `/days-off` → Days off
- `/pulse` → Pulse surveys
- `/org` → Org chart
- `/templates` → Feedback templates
- `/dictionaries/career-paths` → Career paths
- `/alerts` → Alerts
- `/changelog` → Changelog
- `/kudos/new` → New kudo
- `/feedback/new` → New feedback (the picker-mode create)
- `/impact-log/new` → New journal entry
- `/succession` → Succession plans
- `/succession/new` → New succession plan
- `/days-off/new` → New days-off request
- `/feature-flags` → Feature flags
- `/integration-clients` → Integration clients
- `/days-off-pools` → Paid-leave pools

1. The administrator signs in (the session is re-minted per test — the serial unit is the spec
   file, not a shared browser context).
2. They navigate to the page and wait for its heading to be visible.
3. Run the axe scan (WCAG A/AA tags, `color-contrast` waived).
   - *Expected*: zero violations.

## Not covered here (and why)

- **Color contrast** — consciously waived suite-wide (see above): a theme-owned design decision,
  to be revisited only as a theme-wide design pass.
- **The alerts and pulse interactive journeys** — only their management *lists* are scanned;
  the interactive flows stay unscanned because those journeys belong to their own chained
  project phases and this spec must stay read-only in the shared phase.
- **Dark-mode rendering** — the theme toggle is unit-tested and the palette is theme-owned; no
  e2e asserts colors and there is no visual-regression suite.
- **Responsive / cross-browser / visual automation** — the suite deliberately runs Desktop
  Chrome only, with no mobile project or screenshot comparison; layout relies on Mantine
  semantics plus the role/label-based locators every spec uses. This axe smoke covers
  structural rules only.

## Scenario: the open notifications panel has no WCAG A/AA violations

1. Sign in as the Administrator, open the dashboard, and open the notifications bell — the
   right-hand panel (a dialog titled "Notifications") appears.
2. Run the axe scan with the panel open.
   - *Expected*: zero violations — the panel's close button, per-row actions, and pager are all
     named.

## Scenario: the collapsed icon rail has no WCAG A/AA violations

1. Sign in as the Administrator, open the Users page, and collapse the navigation with "Show
   or hide the navigation" — the navbar becomes the 64px icon rail (the Dashboard link stays
   visible, icon-only).
2. Run the axe scan.
   - *Expected*: zero violations — every rail link keeps its name via `aria-label`, and the
     Config/Dictionaries groups are named menu triggers.
