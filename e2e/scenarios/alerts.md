# Alerts — broadcast banner lifecycle

- **Spec**: [tests/alerts.spec.ts](../tests/alerts.spec.ts)
- **Actors**: the seed admin (alert management), AAA One (a regular banner viewer)
- **Owns** (exclusive server-side state): the globally visible alert banner — an active alert
  overlays the header for every worker, so the spec runs in its **own serial `alerts` project
  phase**, chained after the main chromium phase (and before `pulse`). The unique-titled alert
  it creates is deleted in-test; a safety net additionally deletes it via the admin API after
  the test even if a run dies mid-way, so no active alert ever leaks to later specs.

## Scenario: admin creates an alert; users see, hide, and re-show the banner; deactivation and delete remove it

1. The admin opens Alerts → "New alert", fills a unique title and body, leaves both
   visibility-window bounds unchecked (why: no window = visible immediately), and clicks
   Create.
   - *Expected*: back on the management list; filtered by the title (why: the default sort
     would page the fresh row away on the shared database), the alert is listed.
2. AAA One signs in.
   - *Expected*: the banner arrives collapsed to the "alerts hidden" strip (the hidden state is
     device-level, and the preceding sign-out collapsed the banner on this device).
3. AAA One clicks "Show alerts" and pages through the banner to this run's alert (the dev
   volume may carry other active alerts — the banner shows one at a time).
   - *Expected*: the alert's title and body are visible.
4. AAA One clicks "Hide alerts".
   - *Expected*: the strip returns and the alert's body disappears.
5. AAA One clicks "Show alerts" again.
   - *Expected*: the alert's body is back — and the regular user has no alert-management
     surface (no Alerts entry anywhere in the navigation).
6. The admin renames the alert (a "-v2" suffix), switches its Active toggle off, saves, and
   visits the home page.
   - *Expected*: the banner no longer shows the deactivated alert.
7. The admin deletes the alert from the management list (filtered by the new title), confirming
   the deletion dialog.
   - *Expected*: the row is gone — "No alerts" under the filter.
