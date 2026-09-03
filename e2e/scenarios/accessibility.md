# Accessibility smoke — axe over login plus every nav area

- **Spec**: [tests/accessibility.spec.ts](../tests/accessibility.spec.ts)
- **Actors**: nobody (the login screen), Administrator (all authenticated pages — the admin's
  read-only views of every nav area)
- **Owns** (exclusive server-side state): nothing — strictly read-only, which is why it shares
  the main chromium phase safely: that includes scanning the /alerts and /pulse *management
  lists* (reading them mutates nothing the later alerts/pulse phases own)

Every scan runs axe with the WCAG 2.0/2.1 A and AA rule tags. **`color-contrast` is a conscious
waiver, not a fix backlog**: the theme's dimmed/muted text and brand surfaces (the v1.35.0
design language) sit below the 4.5:1 AA ratio by design across every page — revisit only as a
deliberate theme-wide design pass, never by patching single elements. Consequently any new
violation this spec reports is a regression in names, roles, or structure.

## Scenario: login screen has no WCAG A/AA violations

1. Open the sign-in screen (unauthenticated) and wait for the "Sign in" button.
2. Run the axe scan (WCAG A/AA tags, `color-contrast` waived).
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
