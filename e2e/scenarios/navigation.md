# Shell navigation — 404 catch-all, legacy redirects, the Peers tab

- **Spec**: [tests/navigation.spec.ts](../tests/navigation.spec.ts)
- **Actors**: AAA One (member journeys), Manager AAA (the redirect journey)
- **Owns** (exclusive server-side state): nothing — every journey is read-only over the seeded
  demo org
- **Since**: the 2026-08 audit round (these surfaces previously had unit coverage only)

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
