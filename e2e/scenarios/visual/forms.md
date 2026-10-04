# Desktop forms and detail visual baselines

- **Spec**: [forms.spec.ts](../../visual/tests/forms.spec.ts)
- **Actors**: synthetic ordinary member, manager without ADMIN, and administrator without managed teams.
- **Owns**: isolated browser contexts and schema-typed GET responses; no server state.
- **Status**: six stage 2 images approved by the repository owner on 2026-10-05 as part of the
  24-image, 21-test visual reference. The baselines are promoted; stage 3 is parked.
- **Scope**: six approved desktop full-page snapshots at 1280/1440px. These views cover client rendering
  and validation; they do not claim backend authorization or mutation correctness.

## Scenario: feedback create keeps its initial recipient picker editor and disabled save actions

1. As an ordinary member, open New feedback at 1280px.
   - *Expected*: recipient, visibility and template controls load; the empty rich-text editor is
     visible; Insert, Save draft and Save & send remain disabled.
2. Capture the full page after loaders and skeletons have cleared.
   - *Expected*: the initial picker/editor composition and disabled footer actions are stable.

## Scenario: feedback draft edit keeps rich markdown multiple recipients and footer actions

1. Open a supplied draft with three immutable recipients at 1440px.
   - *Expected*: Draft status, every recipient and representative rich Markdown content render;
     Delete, Cancel, Save draft and Save & send are enabled.
2. Capture the full page without editing or saving.
   - *Expected*: the multi-recipient controls, editor and footer remain visible and aligned.

## Scenario: sent feedback detail keeps content metadata status and provider actions

1. Open a supplied sent feedback as its provider at 1280px.
   - *Expected*: Sent status, provider/requester/subject visibility, requester, single recipient and
     rendered Markdown appear with Close, Share and Withdraw actions.
2. Capture the full page without opening history, sharing or withdrawing.
   - *Expected*: content, metadata, status and provider actions retain their desktop layout.

## Scenario: empty team create shows client validation without issuing a mutation

1. As an administrator, open New team at 1280px and submit the untouched empty form.
   - *Expected*: the client shows the name-length and required-manager errors and stays on the form.
2. Capture the full page after validation settles.
   - *Expected*: validation is visible with the complete form and action footer; the route fixture
     rejects every non-GET request, so an accidental API mutation fails the journey.

## Scenario: team member detail keeps identity metadata and a read-only roster

1. As an ordinary member, open a supplied team detail at 1280px.
   - *Expected*: team and manager metadata plus exactly two supplied roster rows render; membership
     editing controls are absent and the total reads two.
2. Capture the full page after loaders and skeletons have cleared.
   - *Expected*: long names remain readable in the read-only roster.

## Scenario: user detail keeps the subordinate PersonCard stats badges and actions

1. As a manager, open a supplied subordinate's user detail at 1440px.
   - *Expected*: the subordinate relationship, managed-team badge, profile/performance/collaboration/
     days-off sections, supplied statistics and the manager action panel render.
2. Capture the full page without opening an action.
   - *Expected*: the PersonCard and action panel retain their two-column desktop composition.

## Acceptance outside the individual journeys

- Every API request is an explicit fixture and every non-GET request is rejected.
- Every capture waits for identifying content, actions and the absence of loaders/skeletons.
- The six stage 2 images were manually approved before promotion into the canonical snapshots.

## Not covered here

Mobile layouts, live authentication, backend authorization, successful mutations, real data,
cross-browser rendering and the optional feedback-history timeline.
