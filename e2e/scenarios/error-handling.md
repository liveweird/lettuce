# Error handling — the SPA's failure surfaces under injected network faults

- **Spec**: [tests/error-handling.spec.ts](../tests/error-handling.spec.ts)
- **Actors**: the seed admin (`admin@lettuce.local` — the templates screens are admin-gated,
  and they are the cheapest single-query page + form pair)
- **Owns** (exclusive server-side state): nothing — read-only. Failures are injected with
  `page.route` interception, so no mutating request ever reaches the server; the suite's
  first interception specs (v2.34.0).
- **Since**: v2.34.0 (browser-verifying the v2.22–v2.24 error-hardening arc: load errors,
  save errors, and the refresh TRANSIENT/DEFINITIVE split)

## Scenario: a failing list load shows the error alert instead of an empty table

1. The admin signs in; the templates list endpoint is stubbed to answer 500 (a problem+json
   body, and the stub keeps answering — React Query retries a 5xx twice before giving up).
2. They open the Feedback templates page.
   - *Expected*: a red alert titled "Failed to load templates" with the body
     "Loading failed (500)." — never a silently empty table.

## Scenario: an unreachable server on a list load says so

1. The admin signs in; the templates list request is aborted at the network layer (the
   server is unreachable, not answering an error).
2. They open the Feedback templates page.
   - *Expected*: the same titled alert, with the network-specific body "Can't reach the
     server. Check your connection and try again." — the transport failure is worded
     distinctly from an HTTP error.

## Scenario: a failing save shows the inline error and keeps the form

1. The admin signs in, opens the new-template form, and fills the name.
2. The create POST is stubbed to answer 500; they press Create.
   - *Expected*: the inline red alert reads "Create failed (500)", the URL stays on the
     create form, and the name field still holds what was typed — nothing is lost, nothing
     navigates away, and the mutation is not retried.

## Scenario: a transient refresh failure keeps the session

1. The admin signs in. The first templates fetch is stubbed to answer 401 exactly once
   (forcing the silent token refresh), and the refresh endpoint is stubbed to answer 500 —
   a TRANSIENT outage, not a rejection.
2. They open the Feedback templates page.
   - *Expected*: the page shows "Loading failed (401)." but the session survives — the user
     menu stays visible and the URL never leaves the app.
3. The stubs are removed and the page reloaded.
   - *Expected*: the templates table renders normally — proof the tokens were kept.

## Scenario: a rejected refresh signs the user out

1. The same 401-once trigger, but the refresh endpoint answers 401 — a DEFINITIVE rejection.
2. They open the Feedback templates page.
   - *Expected*: the app signs the user out to /login, the Sign in button renders, and the
     blue banner explains "You've been signed out."

## Not covered here (and why)

- The ErrorBoundary crash fallback ("Something went wrong") — it catches render-time
  throws, which network interception cannot produce; covered by the unit tests.
- The 30-second transport-timeout wording — reaching it would require delaying a route past
  the test timeout budget.
- `shouldRetryQuery`'s never-retry-4xx policy — no distinct user-visible surface; the
  transient-refresh scenario exercises it implicitly (the 401 renders after exactly one
  attempt).
