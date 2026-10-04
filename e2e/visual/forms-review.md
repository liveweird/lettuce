# Desktop visual coverage — stage 2 forms and details

Status: implemented; canonical capture and review in progress on `test/desktop-visual-forms`. The 18 approved v4.15.3
baselines remain the CI reference. This stage adds six candidates and requires a separate human
review before promotion or merge.

## Scope

| View | Purpose |
| --- | --- |
| New feedback | Recipient picker, visibility/template controls, rich editor and disabled save actions |
| Draft feedback editor | Multiple recipients, populated rich content, metadata, tabs and action footer |
| Sent feedback detail | Rendered Markdown, status/visibility, people metadata and available actions |
| Empty Team form after Create | Required-field errors and simple-form action footer; validation prevents any API write |
| Team detail | Read-only roster, long team/member names and available row actions |
| Person detail | Manager/report relationship, profile card, career data and action groups |

The real SPA renders fixed schema-typed responses. Every unexpected request, external request
or API mutation fails the test. The suite checks desktop presentation and client-side states;
the functional E2E suite remains responsible for persistence and authorization. Shared shell
fixtures match known reads rather than validating every query parameter; this is not an API
contract test.

No application, backend/API, dependency, shared E2E configuration or performance-test changes
are included. Screenshot tolerances and font/content readiness remain unchanged. Previous stage 1
review evidence is preserved under `review-history/stage-1/` so a later capture cannot overwrite
what the owner approved.

## Verification

Pending implementation, independent review, canonical capture and unchanged comparisons.
