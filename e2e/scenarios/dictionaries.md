# Dictionaries — whole-list curation

- **Spec**: [tests/dictionaries.spec.ts](../tests/dictionaries.spec.ts)
- **Actors**: the seed admin (the editor), AAA One (a regular read-only user)
- **Owns** (exclusive server-side state): the `seniority-levels` dictionary document — each
  global dictionary document has exactly one writer file under parallel workers
  (`career-paths` belongs to `user-career.spec`). The spec only ever APPENDS its own unique
  throwaway entries after whatever the shared volume already holds — pre-existing entries ride
  along untouched in every save — and removes them at the end, leaving the document as found.
- **Since**: v2.6.0 (bilingual entries); v2.20.0 (language->value maps — English required, other languages optional with English fallback); v2.23.0 (N-language layout — the editor shows English beside ONE picked translation column, the read-only view a per-entry language-count badge with a popover)

## Scenario: admin curates a dictionary; a regular user sees the read-only list

1. The admin opens the Seniority levels dictionary editor.
   - *Expected*: the "Seniority levels" heading and an "Add entry" button.
2. The admin appends two new entries after the existing list — the first with an English
   AND a Polish value, the second with the English only (the Polish input stays blank: only
   English is required) — and Saves — one Save for the whole round (the
   dictionary saves atomically as a whole document).
   - *Expected*: after the save round-trips, the editor shows both entries at the end of the
     list, in order, with their values intact.
3. The admin moves the second new entry above the first AND renames the first one's English
   value, in the same save.
   - *Expected*: after saving, the entries appear swapped — B first, then the renamed A.
4. AAA One (a regular user) opens the same dictionary.
   - *Expected*: the read-only numbered view leads with the viewer's language (English under
     the EN locale), one line per entry; the translated entry carries a language-count badge
     whose popover reveals the stored Polish translation, the untranslated entry shows its
     English exactly once with no badge (the fallback); there are no inputs
     and no editor buttons ("Add entry" included).
5. Cleanup: the admin removes the two throwaway entries (removing the first shifts the
   positions up, so the same slot is removed twice) and Saves.
   - *Expected*: neither throwaway value remains anywhere on the page — the volume is left as
     found.
