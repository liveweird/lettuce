# Per-user feature flags — both admin surfaces and the team bulk toggle

- **Spec**: [tests/feature-flags.spec.ts](../tests/feature-flags.spec.ts)
- **Actors**: the seed admin (`admin@lettuce.local`); prefix-unique throwaway users created
  through the UI (they sign in with their real generated passwords — the fresh login is what
  proves a flag change took effect); in the bulk journey the seed Administrator serves as the
  fresh team's manager
- **Owns** (exclusive server-side state): fresh prefix-unique users per run (no shared-DB
  residue, nothing to sweep — flag changes mint no notifications) and the bulk journey's fresh
  team, deleted at the end so the Team filter dropdown doesn't accumulate run residue
- **Since**: v1.53.0 (per-user feature flags, the per-user editor, and the per-feature screen),
  v2.1.0 (the Team filter + the count-stating bulk toggle)

## Scenario: admin toggles a user's Goals feature via both surfaces; the user's UI follows

1. The admin signs in, creates a throwaway user, finds their row on the Users list, and chooses
   **Modify ▾ → "Features of ‹name›"**.
   - *Expected*: the per-user features editor opens; the **Goals** switch is on (every feature
     starts enabled).
2. The admin turns the Goals switch off and clicks **Save**.
   - *Expected*: back on the users list.
3. The admin signs out; the user signs in with their own credentials.
   - *Expected*: the feature is gone end to end — the **Feedback** nav link is still there but
     **Goals** is not, and navigating straight to the Goals page bounces to the dashboard while
     staying signed in.
4. The admin signs back in and opens the per-feature screen (**Feature flags**), picking
   Feature = Goals and State = Disabled, then filtering by the user's unique email (the
   shared-database rule: never assume the row sits on page 1).
   - *Expected*: the user's row shows Goals switched off.
5. The admin flips the row's switch back on and signs out.
6. The user signs in again — a fresh login carries the fresh flags.
   - *Expected*: the **Goals** nav link is back and the Goals page opens normally.

## Scenario: bulk toggle by team: filter to a fresh team, disable Goals for all members, re-enable

1. The admin signs in, creates two throwaway users, and creates a fresh team managed by the
   **Administrator** — the roster's "Add a user" pool deliberately excludes the team's manager,
   so the manager must be a third party for both fresh users to be addable (and the Team filter
   is membership-only anyway). The admin adds both users as members.
2. On the Feature flags screen the admin picks Feature = Goals and filters by **Team** = the
   fresh team.
   - *Expected*: exactly the two members' rows, both Goals switches on, with the team badge
     shown.
3. The admin clicks **Disable for all matching** — the bulk buttons act on ALL rows matching the
   current filters.
   - *Expected*: the confirm states the affected count — "This will disable Goals for 2
     users."; after confirming, both row switches are off.
4. The admin clicks **Enable for all matching**.
   - *Expected*: the confirm states "This will enable Goals for 2 users."; after confirming,
     both switches are on again.
5. The admin deletes the fresh team from the Teams list (confirming in the modal) and signs out —
   the fresh users stay, like the first journey's.
