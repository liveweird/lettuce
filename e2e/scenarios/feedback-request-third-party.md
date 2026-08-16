# Third-party feedback request with a requester message

- **Spec**: [tests/feedback-request-third-party.spec.ts](../tests/feedback-request-third-party.spec.ts)
- **Actors**: Manager AAA (requester), AAA One (subject), AAA Three (provider) — seed accounts
- **Owns** (exclusive server-side state): the (subject AAA One ← provider AAA Three,
  requester Manager AAA) feedback triple

The manager-driven request flow (distinct from the self "Ask for feedback"): a manager
requests feedback ABOUT a subordinate FROM a third party, with a requester message. The
message rides along read-only through triage and the draft editor, and the requester is
notified on pick-up and on send.

## Scenario: manager requests feedback about a subordinate; provider sees the message, accepts and sends

1. Manager AAA signs in, opens the Dashboard's "My subordinates" tab, and from AAA One's
   card's Feedback dropdown (v1.51.0) chooses "Request feedback about AAA One".
   - *Expected*: the request-feedback screen opens.
2. Manager AAA adds AAA Three as a provider, writes a unique "Message to the provider", and
   clicks "Request".
   - *Expected*: the request is created; Manager AAA signs out.
3. AAA Three signs in and opens the request.
   - *Expected*: the "Feedback request" triage screen states "Manager AAA requested feedback
     from you about AAA One." and shows the requester's message read-only.
4. AAA Three clicks "Accept".
   - *Expected*: the screen becomes the draft editor; the requester's message is still
     readable there, behind a collapsed "Message from the requester" toggle that expands
     on click.
5. AAA Three writes a unique feedback text, clicks "Save & send", and signs out.
6. Manager AAA signs in and opens the notification bell.
   - *Expected*: two cards are present — "AAA Three is now drafting feedback about AAA One."
     (the pick-up) and "The feedback you requested from AAA Three about AAA One has been
     sent." (the delivery).
7. Manager AAA opens the feedback's view page.
   - *Expected*: the content is visible and the status reads "Sent" — the default visibility
     (Provider + requester + subject) includes the requester.
