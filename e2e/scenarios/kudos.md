# Kudos wall — creating a kudo and public visibility to non-parties

- **Spec**: [tests/kudos.spec.ts](../tests/kudos.spec.ts)
- **Actors**: AAA Two (the provider), AAA Three (the subject — never signs in), Manager CCC (the
  non-party viewer)
- **Owns** (exclusive server-side state): the (AAA Three ← AAA Two) feedback triple, created
  directly as SENT — no open DRAFT/REQUESTED window, so no duplicate-409 exposure; the sent
  feedback deliberately persists (the wall accumulates rows on the shared database, and every
  wall assert goes by this run's unique content, never by position)
- **Since**: v2.2.0 (the Kudos wall); the create-from-the-wall flow since v2.27.0

## Scenario: a kudo created from the wall's New kudo screen lands there for a non-party viewer

1. AAA Two signs in, opens the **Kudos** page, and clicks the sticky header's **New kudo**
   button — landing on the wall's own create screen.
   - *Expected*: Visibility is pinned to **Public** and read-only (a badge, not a picker).
2. They pick **AAA Three** in the Recipients picker (a multi-recipient picker since v3.1.0 —
   one pick suffices here; it offers everyone but themselves), write a
   long unique-marked body (long enough to overflow the three-line preview clamp, so the expand
   toggle will appear), and send it in one step with **Save & send** — created directly as SENT,
   no open window.
   - *Expected*: they land back on the wall, where this run's card already shows.
3. Manager CCC — neither provider nor subject — signs in and opens the **Kudos** page; the wall is
   org-wide by design (it shows precisely what PUBLIC + SENT already grants everyone).
   - *Expected*: this run's card (found by its unique content marker — the wall accumulates rows)
     is on the wall, naming both AAA Two and AAA Three.
4. The long card is clamped to a three-line preview with a **Show more** toggle; Manager CCC
   expands it.
   - *Expected*: the full content shows and the toggle flips to **Show less**.
5. They collapse it again with **Show less**.
   - *Expected*: the card returns to the clamped preview with **Show more** back.

## Not covered here (and why)

- Short cards get no Show more/Show less toggle at all — this journey deliberately writes a long
  body so the toggle path is the one exercised.
- Who may read which feedback (the visibility matrix) is exhaustively covered by the server's
  `AuthorizationTest`; the wall adds no new read surface, and this journey asserts only its
  user-visible consequence — a non-party seeing a PUBLIC sent feedback.
- The header's sticky positioning (staying pinned while the wall scrolls) is a pure CSS concern —
  verified visually, not asserted here.
- Saving a kudo as a draft (it lands under Provided, not on the wall) rides the ordinary feedback
  draft flow, covered by `feedback.spec.ts` and the `CreateKudo.test.tsx` unit suite.
