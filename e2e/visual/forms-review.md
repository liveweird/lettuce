# Desktop visual coverage — stage 2 forms and details

Status: six new candidate images await owner approval on `test/desktop-visual-forms`. The 18 approved v4.15.3
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

## Review artifacts

- [Six new screenshots](candidate-review.html).
- [24-image manifest and hashes](candidate-manifest.json): six candidates plus 18 unchanged references.
- Source revision: `6118bee0` (includes approved master `4c1e30ab`); application version **4.15.3**.

All six new screenshots were visually inspected. The editor, labels, errors, metadata, cards
and actions are settled with no visible loading placeholders or horizontal overflow. Existing
requester-name truncation in the sent-feedback metadata is retained for review.

Independent review found an inconsistent manager/team fixture; it was corrected before final
capture. The manager detail now shows only a team owned by that manager. No actionable findings
remain. Hidden Activity-tab loaders are excluded from readiness checks; visible loaders and
skeletons still block capture, alongside identifying content/action assertions.

| Check | Result |
| --- | --- |
| E2E TypeScript | Passed |
| Functional scenario pairing | 59 specs paired |
| Visual scenario pairing | 21 tests paired |
| Final canonical capture | 21/21 passed; 24 images; 1.1 min |
| Unchanged comparison 1 | 21/21 passed; 1.1 min |
| Unchanged comparison 2 | 21/21 passed; 1.1 min |
| Approved references | All 18 hashes unchanged; newly captured equivalents are byte-identical |
| Manifest hashes and current/historical gallery links | Passed |

The v4.15.3 production source is unchanged from [PR #111](https://github.com/liveweird/lettuce/pull/111),
whose six CI jobs passed before merge; that batch also passed 2,257 frontend tests and 144
functional E2E tests against the updated source frontend. Those suites were not rerun for this
test-only stage. The new visual tests exercise the real built SPA in the pinned Linux amd64 runtime.

The six new images remain separate candidates. Default CI comparison deliberately rejects missing
approved baselines until owner review and explicit promotion. No merge of this stage is authorized
by the earlier stage 1 approval.
