# Team CRUD, member management, the manager handoff, and the team's dated history

- **Spec**: [tests/teams.spec.ts](../tests/teams.spec.ts)
- **Actors**: the seed admin (`admin@lettuce.local`); throwaway users created through the UI — two
  for the CRUD journey (the initial manager and the member/eventual manager) and three for the
  history journey (the current manager, an earlier back-dated manager, a past member)
- **Owns** (exclusive server-side state): its two throwaway teams (each deleted at the end) and the
  five throwaway users — the seeded AAA/BBB/CCC org the feedback specs rely on is never touched
- **Since**: v2.5.7 (the historical `/teams/:id/members` URL redirects to the renamed Team
  details page — the journey doubles as that redirect's regression check); v4.17.0 (dated team
  memberships and manager periods: the History page, the person's Team history, the as-of org chart)

## Scenario: admin creates a team, manages members, reassigns the manager, and deletes it

1. The admin signs in and creates two throwaway users (A and B) through the UI. The team name is
   run-unique and space-free, so later list-filter assertions need no encoding gymnastics.
2. On the new-team form the admin names the team, picks user A as **Manager** (an admin may
   designate anyone), and clicks **Create**.
3. The admin navigates to the team's **historical members URL**.
   - *Expected*: redirected to the **Team details** page (the v2.5.7 rename regression check),
     showing the "Team details" heading and the team's name.
4. The admin adds user B via **Add a user** + **Add**.
   - *Expected*: B appears in the roster.
5. The admin removes B via the roster row's **More actions** menu → **Remove** and confirms in the modal.
   - *Expected*: B is gone from the roster.
6. On the team's edit form the admin renames the team and reassigns the **Manager** to user B —
   the admin-only handoff path — then clicks **Save**.
7. The admin reopens the edit form.
   - *Expected*: the new name and the new manager (B) persisted.
8. On the Teams list the admin filters by the renamed team's name, picks **Delete** from the row's
   **More actions** menu,
   and confirms in the modal.
9. The admin loads the Teams list fresh and filters by the name again.
   - *Expected*: "No teams" — the team is gone.

## Scenario: admin records a team's manager and membership history and sees it on the person's page and the as-of org chart

Dates are fixed past days (2023-01-01, 2024-01-01 to 2024-06-30, as-of 2024-03-01), so the journey
needs no clock control; the manager's own period starts the day the team is created.

1. The admin signs in and creates three throwaway users: M (the team's manager), O (an earlier
   manager) and P (a past member). On the new-team form the admin names a throwaway team, picks M
   as **Manager** and clicks **Create**.
2. The admin opens the team's details page and follows its **History** link.
   - *Expected*: the URL is the team's history page and the heading reads "History of {team}".
3. The admin looks at the **Managers** section.
   - *Expected*: one manager row (M's) carrying the **Current** badge.
4. In the Managers form the admin picks O as **Manager**, sets **Starts on** to 2023-01-01 and clicks
   **Add manager period**.
   - *Expected*: a "Manager period added" toast; the timeline now shows two rows, O's and M's.
5. In the **Membership history** form the admin picks P as **Person**, sets **From** 2024-01-01 and
   **Until** 2024-06-30 and clicks **Add membership period**.
   - *Expected*: a "Membership period added" toast; P's row appears with the **Past** pill.
6. The admin opens P's **Teams** page (`/users/:id/teams`).
   - *Expected*: the **Team history** section (subheadings **Memberships** and **Teams managed**)
     lists the team through a "Team history of {team}" link, as **Past**.
7. The admin opens O's Teams page.
   - *Expected*: the same team link is listed under **Teams managed**, as **Past** (O's period ended
     the day before M's began).
8. The admin opens the org chart as of 2024-03-01 (`/org?asOf=2024-03-01`).
   - *Expected*: the team node, O as its manager and P as its member are drawn. (M, who only
     started managing today, may still appear under "Not in any team" — that section is taken
     from today's directory.)
9. Back on the team's History page the admin deletes P's membership from the row's **More actions**
   menu and confirms "Delete membership period?", then deletes O's manager period from its
   **Delete** button and confirms "Delete manager period?".
   - *Expected*: P's row is gone; one manager row remains (the deleted first period's days are
     absorbed by its successor, so the line still covers 2024).
10. The admin deletes the team from the filtered Teams list (the existing flow) and reloads the
    filtered list.
    - *Expected*: "No teams" for the team's name.
11. The admin opens the org chart as of 2024-03-01 again.
    - *Expected*: the deleted team is still drawn on that earlier day, tagged "(deleted)" — deleting
      a team ends its structure on the deletion day and leaves earlier days intact.
