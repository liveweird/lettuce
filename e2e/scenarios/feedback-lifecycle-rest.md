# Feedback lifecycle — the rest of the state machine

- **Spec**: [tests/feedback-lifecycle-rest.spec.ts](../tests/feedback-lifecycle-rest.spec.ts)
- **Actors**: Manager AAA (provider), AAA Two (subject) — seed accounts
- **Owns** (exclusive server-side state): the (subject AAA Two ← provider Manager AAA)
  feedback triple

Completes the state-machine coverage the other feedback specs leave out: create directly as
SENT ("Save & send" straight on the create form — one create, no separate send step), the
provider-only DRAFT soft-delete, and the History/Lifecycle tabs on the view screen.

## Scenario: provider creates a feedback directly as Sent; History and Lifecycle tabs render

1. Manager AAA signs in and provides feedback about AAA Two, typing a unique text and choosing
   "Save & send" directly on the create form (the direct-to-SENT path — no draft stage).
   - *Expected*: the feedback's view page shows status "Sent" and the typed content.
2. Manager AAA opens the "History" tab.
   - *Expected*: the single created-as-SENT audit event is shown — "Feedback created and
     sent." — with the author's name (Manager AAA), rendered in the viewer's language.
3. Manager AAA opens the "Lifecycle" tab.
   - *Expected*: the state diagram renders with its caption "How a feedback moves from request
     to delivery. Rejected and Withdrawn are final."

## Scenario: provider deletes a draft (soft-delete) via the editor's Delete action

1. Manager AAA signs in and saves a draft feedback about AAA Two ("Save draft").
2. Manager AAA reopens the draft in the editor and clicks "Delete".
   - *Expected*: the confirmation dialog asks "Delete this draft feedback?".
3. Manager AAA confirms "Delete" in the dialog.
4. Manager AAA opens the feedback's view page.
   - *Expected*: "Feedback not found." — the soft-deleted row drops out of reads, even for
     its own provider.
5. Manager AAA opens the feedback screen's "Provided" tab.
   - *Expected*: the deleted feedback no longer appears anywhere in the list.

## Not covered here (and why)

- **DRAFT → WITHDRAWN (abandoning a draft)** — a valid backend transition with no UI
  affordance (the editor offers Delete instead), so it cannot be exercised through the
  browser.
