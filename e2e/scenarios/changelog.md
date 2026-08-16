# Changelog page — versioned entries in both languages

- **Spec**: [tests/changelog.spec.ts](../tests/changelog.spec.ts)
- **Actors**: Administrator (any authenticated user would do — the page is not role-gated)
- **Owns** (exclusive server-side state): nothing — read-only; the visit only marks the "new
  entries" dot as seen in the viewer's own browser storage, never on the server

## Scenario: the changelog lists versioned entries and renders them in the picked language

1. The administrator signs in and opens the Changelog page.
   - *Expected*: the "Changelog" heading is visible.
2. They look at the newest entry — the bundled release history whose newest entry *is* the app's
   displayed version.
   - *Expected*: a semver-shaped version title (vX.Y.Z), a release date (YYYY-MM-DD), and a
     rendered entry body. Why no exact-version assert: it would need a hand-edit every release;
     the semver shape plus a rendered body already prove the page wires the bundled entries in.
3. They collapse the alert banner and switch the interface language to PL.
   - *Expected*: the heading re-renders as "Historia zmian" and the version timeline stays —
     entry bodies are bilingual content, not just translated chrome.
4. They switch back to EN (hygiene, matching the i18n journey — contexts are per-test anyway).
   - *Expected*: the "Changelog" heading is back.
