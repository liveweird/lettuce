# User details — the read-only person view

- **Spec**: [tests/user-details.spec.ts](../tests/user-details.spec.ts)
- **Actors**: Manager AAA (seed viewer); seed people viewed — Manager CCC (one of the viewer's
  managers), AAA One (a direct report), BBB One (unrelated), Manager BBB (a peer on team CCC),
  and the seed Administrator
- **Owns** (exclusive server-side state): nothing — read-only; no data is created or mutated
- **Since**: v1.21.0 (the details view itself), v1.51.0 (the subordinate card's create flows in
  topic dropdowns), v2.5.2 (the person's name as the "User details for …" link), v2.5.4 (team
  names as "Team details for …" links; the Members buttons are gone)

The details view renders the person's dashboard card, its flavor picked by the viewer's
relationship to them: their-manager beats my-direct-report beats peer, with an unrelated
fallback. Back links are origin-aware. Every Users-list visit filters to the wanted row first —
accumulated throwaway users push seed rows off page 1 of the shared database.

## Scenario: the Users list opens the details view in every relationship flavor

1. Manager AAA signs in and finds their **own** row on the Users list.
   - *Expected*: one's own row never gets a "User details" link — a relationship needs someone
     else.
2. Manager AAA finds Manager CCC's row and opens their user details (Manager CCC manages team
   CCC, of which the viewer is a member).
   - *Expected*: the **manager-flavor** card — "One of your managers", a "Last 1:1" stat, and a
     link to the goals from that manager.
3. Manager AAA uses the "Back to Users" link.
   - *Expected*: back on the users list.
4. Manager AAA opens direct report AAA One's details.
   - *Expected*: the **subordinate-flavor** card — "One of your subordinates"; the 1:1 actions
     menu offers "New 1:1 with AAA One" and the Feedback actions menu offers "Request feedback
     about AAA One" (the create flows sit in the card's topic dropdowns).
5. Manager AAA opens unrelated BBB One's details (team BBB).
   - *Expected*: still a card — the person's email is shown, but there is **no relationship
     hint** ("One of your …") and no stats; the Feedback actions menu still offers "Feedbacks
     with BBB One".

## Scenario: the teams list's manager chip opens the details view and round-trips back

1. Manager AAA signs in, opens the Teams list, and filters by name to team CCC (leftover
   throwaway teams may crowd page 1).
2. Manager AAA clicks the team's manager chip — "User details for Manager CCC".
   - *Expected*: the manager-flavor card — "One of your managers".
3. Manager AAA uses the "Back to Teams" link.
   - *Expected*: back on the teams list — the back link honors the teams-list origin.

## Scenario: a team roster opens the peer flavor and round-trips back to the roster

1. Manager AAA signs in, opens the Teams list, and opens team CCC's details via the team-name
   link.
   - *Expected*: fellow member Manager BBB has a "User details" link; the viewer's **own** roster
     row does not.
2. Manager AAA opens Manager BBB's details.
   - *Expected*: the **peer-flavor** card — "One of your peers", with "Feedback from me" and
     "Feedback from them".
3. Manager AAA uses the "Back to Team members" link.
   - *Expected*: back on **that team's roster** (the Team details page showing CCC), not the
     users list — the members origin wins.

## Scenario: the Users list's Teams button opens the read-only membership view

1. Manager AAA signs in, finds AAA One's row on the Users list, and clicks its **Teams** button
   (every authenticated user gets it).
   - *Expected*: the read-only membership view opens, headed "Teams — AAA One" — the person's
     name travels along with the link, because reading the user record directly is reserved to
     the person themselves or an admin.
2. Manager AAA reads the membership list.
   - *Expected*: AAA One's membership row for team AAA is there, linking to that team's details
     view. No roster is mutated — read-only against seed users.

## Not covered here (and why)

- The full authorization/visibility matrix behind the relationship flavors is exhaustively
  covered by server tests suite-wide; this journey asserts only the user-visible card flavors.
