# Team CRUD, member management, and the manager handoff

- **Spec**: [tests/teams.spec.ts](../tests/teams.spec.ts)
- **Actors**: the seed admin (`admin@lettuce.local`); two throwaway users created through the UI
  (the initial manager and the member/eventual manager)
- **Owns** (exclusive server-side state): its throwaway team (deleted at the end) and the two
  throwaway users — the seeded AAA/BBB/CCC org the feedback specs rely on is never touched
- **Since**: v2.5.7 (the historical `/teams/:id/members` URL redirects to the renamed Team
  details page — the journey doubles as that redirect's regression check)

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
