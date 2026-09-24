# Tutorials in the account menu — launched from any page

- **Spec**: [tests/tutorials-menu.spec.ts](../tests/tutorials-menu.spec.ts)
- **Actors**: AAA One (a non-manager), Manager AAA (a manager) — seed accounts
- **Owns** (exclusive server-side state): nothing — read-only. The Tutorials submenu lists the
  quick app tour and every per-feature tutorial the caller can use, in navbar order, and starts any
  of them from any page (a launch away from the tutorial's hub opens that hub first). A tutorial
  only navigates and spotlights, so the oracle is that no API request other than a read is made
  while it runs. Safe under parallel workers.
- **Since**: v4.4.0

## Scenario: a team member launches the goals tutorial from the Dashboard's account menu and it returns to Goals

1. AAA One signs in and opens the Dashboard.
2. They open the account menu and its Tutorials submenu.
   - *Expected*: the submenu offers "Quick app tour" and eight tutorials, from "How feedback
     works" to "How pulse surveys work" in navbar order — no "How succession plans work", since
     the Succession plans area is only in a manager's navbar.
3. They pick "How goals work".
   - *Expected*: the Goals page opens on My goals and the tutorial starts at "Step 1 of 6".
4. They walk it with Next to the sixth step and press Done.
   - *Expected*: they are back on the Goals page with no tutorial showing, and nothing was
     written while it ran.

## Scenario: a manager's Tutorials list includes succession plans, and a launch from Kudos opens that hub

1. Manager AAA signs in and opens the Kudos wall.
2. They open the account menu and its Tutorials submenu.
   - *Expected*: the same eight tutorials, followed by "How succession plans work".
3. They pick "How succession plans work".
   - *Expected*: the Succession plans page opens on My plans and the tutorial starts at step 1.
4. They press Abandon.
   - *Expected*: the tutorial closes, and nothing was written while it ran.
