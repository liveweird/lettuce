# Feedback request triage — accept and reject

- **Spec**: [tests/feedback-request-triage.spec.ts](../tests/feedback-request-triage.spec.ts)
- **Actors**: AAA One and AAA Two (requesters asking about themselves), Manager AAA (the asked
  provider) — seed accounts
- **Owns** (exclusive server-side state): the two self-requested feedback triples
  (subject/requester AAA One ← provider Manager AAA) and (subject/requester AAA Two ←
  provider Manager AAA) — one per test, so the two requests never collide with each other or
  with any other file's open feedback

## Scenario: provider accepts a request, then drafts and sends it

1. AAA One signs in, filters the users list by name to find Manager AAA, and chooses
   "Ask for feedback".
   - *Expected*: the ask screen opens.
2. AAA One clicks "Send request".
   - *Expected*: the feedback request is created (its id is captured so the provider leg acts
     on exactly this row).
3. AAA One signs out; Manager AAA signs in and opens the request.
   - *Expected*: the "Feedback request" triage screen for the pending request.
4. Manager AAA clicks "Accept".
   - *Expected*: the screen reloads in place as the draft editor — the request has been
     picked up.
5. Manager AAA writes a unique feedback text and clicks "Save & send".
6. Manager AAA opens the feedback's view page.
   - *Expected*: the typed content is visible and the status reads "Sent".

## Scenario: provider rejects a request

1. AAA Two signs in, filters the users list by name to find Manager AAA, chooses
   "Ask for feedback", and clicks "Send request".
   - *Expected*: the feedback request is created.
2. AAA Two signs out; Manager AAA signs in and opens the request.
   - *Expected*: the "Feedback request" triage screen.
3. Manager AAA clicks "Reject" and confirms "Reject" in the confirmation dialog.
4. Manager AAA opens the feedback's view page.
   - *Expected*: the status reads "Rejected".
