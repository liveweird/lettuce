# Impact log — the personal accomplishment journal

- **Spec**: [tests/impact-log.spec.ts](../tests/impact-log.spec.ts)
- **Actors**: AAA Two (the journal owner — the slot freed by the retired self-reflection spec),
  Manager AAA (their direct manager, reading from the managed tab)
- **Owns** (exclusive server-side state): AAA Two's impact-log entries — unique-texted, deleted
  in-test with an API fallback in `afterEach`, so a failed run leaves no residue; seeded accounts
  are never mutated
- **Since**: v2.36.0 (the feature's introduction, replacing Self-reflection)

## Scenario: an employee journals an accomplishment, their manager reads it, and the owner deletes it

1. AAA Two signs in, opens "Impact log" from the left menu, and clicks "New entry" under
   "My journal".
   - *Expected*: the "New journal entry" screen opens with the owner shown as plain "You".
2. They fill the period (2026-07-01 – 2026-07-31) and all four rich-text sections (unique texts
   for "What happened" and "My contribution"), then click **Create**.
   - *Expected*: a "Journal entry created" toast; back on the journal, the fresh row shows the
     formatted period and the "What happened" preview.
3. They open the entry ("View entry …").
   - *Expected*: all four sections render; the **History** tab shows "Entry created for the
     period Jul 1, 2026 – Jul 31, 2026.".
4. From the view they click **Edit**, append a sentence to "Why did it matter", and **Save**.
   - *Expected*: a "Journal entry updated" toast; reopening the entry's History shows
     "Entry updated: Why did it matter.".
5. AAA Two signs out; Manager AAA signs in, opens "Impact log" → "My subordinates' journals",
   and filters Author to "AAA Two".
   - *Expected*: the entry's row is listed **without** an Edit action; opening it shows the
     content read-only (no Edit button on the view either) — the chain reads, only the owner
     writes.
6. Manager AAA signs out; AAA Two signs back in and deletes the entry from "My journal"
   (confirming the "Delete entry?" dialog).
   - *Expected*: a "Journal entry deleted" toast and the row is gone from the journal.
