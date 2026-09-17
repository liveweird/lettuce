# Responsive list rows and contained wide-table scrolling

- **Spec**: [tests/list-layout.spec.ts](../tests/list-layout.spec.ts)
- **Actors**: one throwaway ordinary employee; a throwaway requester, provider, and three
  recipients; the seed administrator only creates and removes the fixture
- **Owns** (exclusive server-side state): six throwaway users, one 99-character E2E-named team,
  and four feedbacks whose parties are all throwaways; feedbacks are closed or deleted, then the
  team and users are deleted in cleanup
- **Since**: responsive list-table pass following the 14 September 2026 overflow audit

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

## Not covered here (and why)

The journey verifies layout and interaction behavior in Chromium. Pixel-perfect appearance and
other browser engines remain outside the blackbox suite.

## Visual evidence

Synthetic long-name feedback fixtures, captured during the responsive layout audit at 1440 and
390 pixels. These illustrate the layout; automated acceptance uses the geometry and interaction
assertions above rather than screenshot comparison.

[Desktop feedback](assets/list-layout/feedback-desktop.png) · [Mobile feedback](assets/list-layout/feedback-mobile.png)
