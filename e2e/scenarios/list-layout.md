# Responsive list rows and contained wide-table scrolling

- **Spec**: [tests/list-layout.spec.ts](../tests/list-layout.spec.ts)
- **Actors**: one throwaway ordinary employee; a throwaway requester, provider, and three
  recipients; the seed administrator only creates and removes the fixture; the seeded Manager AAA
  drives the second and third scenarios over their own throwaway subordinate/team/review fixtures
- **Owns** (exclusive server-side state): six throwaway users, one 99-character E2E-named team,
  and four feedbacks whose parties are all throwaways; feedbacks are closed or deleted, then the
  team and users are deleted in cleanup. The second scenario below is read-only (it only signs in
  as the seeded Manager AAA and sorts a list client-side) and creates or mutates nothing. The
  third scenario owns one throwaway subordinate, one throwaway team under Manager AAA, and one
  performance review in calibration (reverted to a draft and deleted), all removed in cleanup.
- **Since**: responsive list-table pass following the 14 September 2026 overflow audit; the
  Team's-performance matrix scenario since the v3.11.1 rotated-header round; the dashboard
  last-review dot scenario since the v4.x card-review layout fix

## Scenario: list rows stay contained and usable across desktop and mobile widths

1. The fixture creates an ordinary employee and long-named colleagues, including long unbroken
   email and employee identifiers, then creates a 99-character unbroken team name.
2. It gives the employee a received feedback with a long requester, visible content, and
   Provider + requester + subject visibility. At 1440, 1280, 1024, and 390 pixels:
   - *Expected*: the page has no horizontal overflow; the requester, provider, preview, the
     compact "P+R+S" visibility pill (its full wording on hover), and row action remain
     discoverable; the action stays inside the viewport.
3. At 390 pixels the employee opens the received feedback through its visible View action.
   - *Expected*: the correct feedback detail opens and retains the full content.
4. The employee opens Provided, which contains a public three-recipient feedback, a draft, and a
   requested feedback with a deadline. At the same four widths:
   - *Expected*: the page stays contained; every recipient, preview, visibility, status, deadline,
     and every row action remain discoverable; the sent fixture's exact View action and both the
     draft and requested fixtures' exact Edit actions stay inside the viewport.
5. At 390 pixels the employee uses the original Last modified table header.
   - *Expected*: the list performs a request sorted by Last modified and keeps the fixture rows.
6. The employee opens the paired-feedback screen for the long-named requester at 390 pixels.
   - *Expected*: the complete "From [name] to you" and "From you to [name]" tab labels wrap within
     the viewport without clipped text or internal overflow, both tab controls remain horizontally
     reachable, switching direction updates the active tab, and the page remains contained.
7. The employee switches to Polish and repeats Received and Provided at representative desktop
   and mobile widths (1280 and 390 pixels).
   - *Expected*: the compact Polish visibility pill (full wording on hover), the longer Polish
     status labels, the deadline, content, and actions remain available without widening the
     page.
8. Back in English, the employee filters Users to a colleague with maximum-length identity
   values and checks the list at all four widths.
   - *Expected*: the name, email, employee identifier, exact Teams link, and Feedback menu remain
     discoverable and horizontally reachable. At 390 pixels the Feedback menu opens normally.
9. The employee filters Teams to the 99-character unbroken team at all four widths.
   - *Expected*: the team and manager names do not widen the page, and the Team details link stays
     horizontally reachable.
10. At 390 pixels the employee opens the days-off calendar, the representative table designed for
   local horizontal scrolling.
   - *Expected*: the document remains contained while the calendar's own scroll region is wider
     than its viewport and can be scrolled horizontally.

## Scenario: Team's performance table fits a 1280px laptop and still shows its rating numbers

1. Manager AAA signs in and opens the Performance page's Team's-performance tab at a 1280×900
   viewport — the width the rotated rating headers (v3.11.1) were measured to fit.
   - *Expected*: the sortable "Overall" column header is visible, the table's own scroll region
     is no wider than its viewport (it does not need to scroll), and the scroll hint is not
     shown — there is nothing to scroll to.
   - *Expected* (v3.25.1): every rating pill in the body shows its whole number. The columns are
     squeezed on purpose, and a badge label that overflows is HIDDEN rather than spilling, so
     this is measured (a pill's label scrolls no wider than it renders) — the regression it
     guards rendered five empty coloured boxes per row while every digit sat in the DOM.
   - *Expected* (v4.3.1): every word of every status pill sits on one line — "Calibration", the
     fixture review's status (the fixture completes the review and submits it for calibration),
     is among the measured pills. The Status column used to collapse below the pill's longest
     word and split "Publish|ed" / "Calibrat|ion" over two lines; this too is measured (each
     word's text range yields a single line box), since the split is invisible in the DOM.
2. They click the "Overall" header.
   - *Expected*: the list re-sorts with no error and the header stays visible — sorting still
     works with the rating column's rotated label.
3. They switch to Polish and repeat the same check at the same viewport, using the Polish
   "Ogólna" header and its scroll-hint wording.
   - *Expected*: the table and its region still fit with no scroll needed, the Polish hint is
     not shown, and the header remains clickable — the longer Polish labels were the original
     failure case (1302px demanded) this table now clears — and "Kalibracja" stays whole.

## Scenario: dashboard subordinate card keeps the last-review dot and period on one line at 1440px

1. The fixture creates a throwaway subordinate under Manager AAA (a throwaway team with the
   subordinate as its only member) and a complete performance review authored by Manager AAA for
   the current review period, submitted to calibration — "Calibration" is one of the long status
   names whose pill used to push the row onto a second line (a short "Draft" pill fitted anyway).
2. Manager AAA signs in at a 1440×1000 viewport and opens the Dashboard's "My subordinates" tab.
   - *Expected*: the subordinate's card shows a "Last review" row with a coloured status dot and
     the review period text, and the two sit on the same visual line — vertically centred within
     2 pixels of each other — rather than the period wrapping onto a line of its own beneath the
     dot.

## Not covered here (and why)

The journey verifies layout and interaction behavior in Chromium. Pixel-perfect appearance and
other browser engines remain outside the blackbox suite.

## Visual evidence

Synthetic long-name feedback fixtures, captured during the responsive layout audit at 1440 and
390 pixels. These illustrate the layout; automated acceptance uses the geometry and interaction
assertions above rather than screenshot comparison.

[Desktop feedback](assets/list-layout/feedback-desktop.png) · [Mobile feedback](assets/list-layout/feedback-mobile.png)
