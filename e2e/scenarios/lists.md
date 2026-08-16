# Shared list plumbing — filters, sort, page size (Users page)

- **Spec**: [tests/lists.spec.ts](../tests/lists.spec.ts)
- **Actors**: Administrator; two throwaway users sharing one unique stamp in their names/emails
- **Owns** (exclusive server-side state): the two throwaway users it creates through the UI —
  their residue is inert for every other file (unique-stamped names, never referenced again)

## Scenario: users list filters, sorts, and changes page size

1. The administrator signs in and creates two throwaway users whose names share a unique stamp
   and end in "-AAAA" and "-ZZZZ". Why: the pair gives the name filter a deterministic two-row
   result with a known alphabetical order; the stamp stays short (names are capped at 50 chars)
   and carries a random tail so it is unique even against a parallel worker in the same
   millisecond. The Users page is the representative — all lists share the same filter / sort /
   pagination building blocks.
2. On the Users list, they open the filters and fill the Name filter with the stamp.
   - *Expected*: exactly the two throwaway rows, with the "-AAAA" user first (the default sort
     is name ascending).
3. They toggle the Name column header.
   - *Expected*: the sort flips to descending — the "-ZZZZ" user is now first.
4. They additionally fill the Email filter with the second user's email.
   - *Expected*: exactly one row — filters compose (both rows share the stamp in their emails
     too).
5. They clear the email filter.
   - *Expected*: back to the two rows.
6. They flip the sort back to ascending and clear the name filter.
   - *Expected*: the unfiltered list shows the seeded "AAA One" on page 1 — stable forever under
     name-ascending, unlike the old descending "Manager CCC" assert, which accumulating
     throwaway users would eventually push off page 1 of the shared database.
7. They change "Rows per page" to 40.
   - *Expected*: the list re-queries the server with the new page size of 40.
