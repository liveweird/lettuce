# The ADMIN telemetry panel

- **Spec**: [tests/telemetry.spec.ts](../tests/telemetry.spec.ts)
- **Actors**: the seed administrator (`admin@lettuce.local`) and one seeded regular user (AAA One)
- **Owns** (exclusive server-side state): nothing — read-only. The panel only reads, its open flag,
  expanded sections and range are DEVICE-level localStorage (a fresh browser context per test), and the
  regular user is a seeded account whose session is minted over the API (nothing created or changed).
  Every test that reads figures first waits, through the API (bounded, 90 s, a slow poll because the read
  API shares a per-user budget of 30 requests a minute with the panel itself), until the sampler has taken
  its first sample of the most recently started live (non-stale) process and the first database
  measurement (the first tick comes seconds after the app starts); the file's timeout is 150 s to fit
  that wait. A stack rebuilt within the hour still lists the previous container's process (live for
  three sample intervals after it stopped, stale after), so the Memory and Database locators are
  scoped to the newest instance by name.
- **Since**: v4.20.0

## Scenario: an admin opens the telemetry panel from the user menu and reads the Memory section

1. The admin signs in, waits for the first sample, opens the user menu and picks **Telemetry panel**.
   - *Expected*: an aside landmark named "Telemetry" appears beside the page with an h2 "Telemetry".
2. They read the **Memory** section (open by default).
   - *Expected*: the live instance's "Memory of <instance>" table whose Container limit row reads either
     a size in MB/GB or "No limit" (it depends on whether the stack runs in a container), and whose
     Heap used row shows a size.
3. They open the user menu again.
   - *Expected*: the Telemetry panel item is marked as on (`aria-current`).

## Scenario: the Database section shows the pool against its maximum, the database size and the user row count

1. The admin waits for the first sample and database measurement and opens the panel.
2. They open **Database**.
   - *Expected*: the live instance's "Database connections of <instance>" table reads Connections in use
     as "n of 20" (the pool's configured maximum); the "Database size per table group" table has a
     Database row in KB/MB/GB and a People and access row; the "Rows per table" table has a Users row
     with a count.

## Scenario: the open telemetry panel survives a reload and closes with its own button

1. The admin opens the panel and expands **Database**, then reloads the page.
   - *Expected*: the panel is still open and Database is still expanded.
2. They press the panel's **Close** button and reload.
   - *Expected*: no panel before or after the reload.

## Scenario: a regular user has no telemetry item in the user menu

1. A regular user (seeded AAA One) signs in and opens the user menu.
   - *Expected*: Change password is there, "Telemetry panel" is not.
2. They store the open flag by hand (`lettuce.viewSettings.telemetry.panelOpen` = true) and reload.
   - *Expected*: still no panel.

## Scenario: the open telemetry panel has no WCAG A/AA violations

1. The admin waits for the first sample, opens the panel and expands every section.
   - *Expected*: the Memory table, its trend chart group and the database size table are visible.
2. An axe WCAG A/AA scan of `<main>` and the panel's `<aside>` runs (every rule, `color-contrast`
   included — the suite has waived nothing since v3.3.0).
   - *Expected*: no violations.
