# Changelog page — versioned entries in both languages

- **Spec**: [tests/changelog.spec.ts](../tests/changelog.spec.ts)
- **Actors**: Administrator (to create the throwaway user), then a throwaway user
- **Owns** (exclusive server-side state): one throwaway user (created by the journey) whose
  server-side language it flips — since v2.21.0 the language switch persists on the server,
  so the PL leg never runs on a seeded account; otherwise read-only (the visit only marks the
  "new entries" dot as seen in the viewer's own browser storage)

## Scenario: the changelog lists versioned entries and renders them in the picked language

1. The administrator signs in, creates a throwaway user, and signs out; the throwaway user
   signs in.
   - *Expected*: the navbar version stamp carries the red "What's new" dot — a fresh profile
     has never seen the current version (2026-08 audit round).
2. They open the Changelog page.
   - *Expected*: the "Changelog" heading is visible, and the "What's new" dot is gone — the
     visit marks the version as seen.
3. They look at the newest entry — the bundled release history whose newest entry *is* the app's
   displayed version.
   - *Expected*: a semver-shaped version title (vX.Y.Z), a release date (YYYY-MM-DD), and a
     rendered entry body. Why no exact-version assert: it would need a hand-edit every release;
     the semver shape plus a rendered body already prove the page wires the bundled entries in.
4. They switch the interface language to Polish through the header language menu.
   - *Expected*: the heading re-renders as "Historia zmian" and the version timeline stays —
     entry bodies are bilingual content, not just translated chrome.
5. They switch back to English (hygiene; the account is a throwaway either way).
   - *Expected*: the "Changelog" heading is back.
