# Shell navigation — 404 catch-all, legacy redirects, the Peers tab

- **Spec**: [tests/navigation.spec.ts](../tests/navigation.spec.ts)
- **Actors**: AAA One (member journeys), Manager AAA (the redirect and pinned-column journeys)
- **Owns** (exclusive server-side state): nothing — every journey is read-only over the seeded
  demo org
- **Since**: the 2026-08 audit round (these surfaces previously had unit coverage only); the page
  title, focus and pinned-column journeys since v4.21.0

## Scenario: an unknown URL renders the in-shell 404 page and its dashboard link recovers

1. AAA One signs in and opens a URL that matches no page.
   - *Expected*: the "Page not found" screen renders INSIDE the shell — the navbar (with its
     Dashboard link) is still there, because the catch-all is a routed page, not a crash.
2. They click "Back to dashboard".
   - *Expected*: the Dashboard renders.

## Scenario: the legacy performance URLs redirect to the Performance page

1. Manager AAA signs in and opens `/my-performance` (the pre-v1.45 bookmark target).
   - *Expected*: the browser lands on the Performance page.
2. They open `/?tab=reviews` (the pre-v1.45 dashboard-tab deep link that old notification
   landings may still carry).
   - *Expected*: the browser lands on the Performance page's team tab
     (`/performance?tab=managed`).

## Scenario: the dashboard Peers tab shows teammates as cards with both feedback directions

1. AAA One signs in and opens the Dashboard's "My peers" tab.
   - *Expected*: their AAA teammates (AAA Two, AAA Three) render as person cards carrying the
     peer stats variant — "Feedback from me" and "Feedback from them" — with no 1:1 stat
     (that one is manager/subordinate-only).

## Scenario: a keyboard navigation names the page in the tab title and moves focus to its heading

1. AAA One signs in.
   - *Expected*: the Dashboard renders with its title as the page's only top-level heading, and
     the browser tab reads "Dashboard · Lettuce".
2. They move the keyboard focus to the "Goals" link in the sidebar and press Enter.
   - *Expected*: the Goals page opens, the keyboard focus lands on its "Goals" heading (so the next
     Tab starts on the new page and a screen reader announces it), and the tab reads
     "Goals · Lettuce".

## Scenario: a wide table keeps the person column pinned while it scrolls sideways

1. Manager AAA signs in on a narrow (1000 px) window and opens "Share days-off calendars" — a
   matrix table wider than its scroll region. Read-only: nothing is selected or shared.
   - *Expected*: the table's region scrolls sideways and lists AAA One.
2. They scroll the table all the way to its end.
   - *Expected*: AAA One's person cell is still visible at the start edge of the region — the
     person column is pinned while the other columns slide under it.
