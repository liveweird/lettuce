# Impact log — the personal accomplishment journal

- **Spec**: [tests/impact-log.spec.ts](../tests/impact-log.spec.ts)
- **Actors**: AAA Two (the journal owner — the slot freed by the retired self-reflection spec),
  Manager AAA (their direct manager, reading from the managed tab)
- **Owns** (exclusive server-side state): AAA Two's impact-log entries — unique-texted, deleted
  in-test with an API fallback in `afterEach`, so a failed run leaves no residue; seeded accounts
  are never mutated
- **Since**: v2.36.0 (the feature's introduction, replacing Self-reflection); v2.37.0 (the
  create/edit screens became a five-step wizard)

## Scenario: an employee journals an accomplishment, their manager reads it, and the owner deletes it

1. AAA Two signs in, opens "Impact log" from the left menu, and clicks "New entry" under
   "My journal".
   - *Expected*: the "New journal entry" wizard opens with the owner shown as plain "You",
     the period date pair permanently visible above the step rail, and all five steps named
     in order (What happened → My contribution → Why it mattered → Evidence → Review).
2. They fill the always-visible header fields — the required **Title** (a unique text; it
   becomes the entry's identity on the lists) and the period (2026-07-01 – 2026-07-31) — then
   walk the four sections one step at a time — exactly one rich-text editor is mounted per
   step — typing each section (unique texts for "What happened" and "My contribution") and
   clicking **Next**.
   - *Expected*: the Review step shows the whole entry rendered read-only.
3. They click **Create** on the Review step.
   - *Expected*: a "Journal entry created" toast; back on the journal, the fresh row shows the
     entry's title and the formatted period.
4. They open the entry ("View entry …").
   - *Expected*: the title shows in the header and all four sections render; the **History**
     tab shows "Entry created for the
     period Jul 1, 2026 – Jul 31, 2026.".
5. From the view they click **Edit**, walk **Next** twice to "Why it mattered" (the step
   arrives pre-filled — walking forward never loses input), append a sentence, continue to
   the Review step (which shows the appended sentence), and **Save**.
   - *Expected*: a "Journal entry updated" toast; reopening the entry's History shows
     "Entry updated: Why did it matter.".
6. AAA Two signs out; Manager AAA signs in, opens "Impact log" → "My subordinates' journals",
   and filters Author to "AAA Two".
   - *Expected*: the entry's row is listed **without** an Edit action; opening it shows the
     content read-only (no Edit button on the view either) — the chain reads, only the owner
     writes.
7. Manager AAA signs out; AAA Two signs back in and deletes the entry from "My journal"
   (confirming the "Delete entry?" dialog).
   - *Expected*: a "Journal entry deleted" toast and the row is gone from the journal.
