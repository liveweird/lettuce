### Document sharing (v4.8.0, V86)

A person who can read a document **in their own right** may share it **read-only** with another
person, open-ended or until a date. Sharees are notified when a share starts and when it is
withdrawn; shares are withdrawn from the document's view screen and from the Shared screen. The
package is `sharing/`; each shareable feature contributes one small adapter. Authoritative
decisions (user-confirmed unless marked as a technical default):

- **Scope.** Feedbacks, 1:1 meetings, goals, impact-log entries, performance reviews, team KPIs,
  succession plans (`ShareableResourceType`, 7 values). **Days-off is deferred** to a point
  release — it has no per-entry view screen yet; pulse surveys are out of scope. The adapters land
  per feature: a type with no registered adapter is simply not shareable (`POST`/`view=document`
  answer `404`). **Shareable today: feedbacks only** (M1); the other six follow in M2.
- **Non-transitive.** Access that came from a share, and access held only through the **HR
  auditor role**, cannot be shared again (`403`). HR users CAN share documents they reach as
  ordinary parties/chain managers, and anyone can share WITH an HR user.
- **The lapse rule, one line: _a share works exactly while the sharer could open the document
  themselves without the HR role._** Nothing is stored about it — it is re-evaluated on every
  read (`ShareAccess.readOrShared`): the feature's EXISTING read guard is run for the sharer with a
  **role-stripped principal** (`roles = emptySet()` turns every `grantHrRead` branch in
  `authz/Guards.kt` into a no-op), so no guard body changed and "own right" has exactly one
  definition per feature. A sharer who left the management chain, lost party status, was
  deactivated/soft-deleted or has the area's feature flag off simply stops carrying the share.
  The sharee sees at most what the sharer sees: content gates and DRAFT privacy still apply (the
  feedback content gate `canReadFeedbackContent` is evaluated on the SHARER's principal).
- **Visibility widening is intended.** The user's spec is "share it with whoever I want if I can read
  it in my own right": an own-right reader — including a requester or a chain manager — may share
  a document with people its author's visibility settings excluded, even the document's subject
  (e.g. the requester of a `PROVIDER_REQUESTER` feedback may share it with the subject). That is
  not a leak to close: the **author sees every share of the document and can withdraw any**, and
  the sharee gets exactly the sharer's read, never more.
- **A share also upgrades a weaker own read.** `readOrShared` takes an optional
  `sufficient(principal, grant)`: when the caller's own read passes but is not sufficient (feedback:
  the content gate fails — the requester of an unfinished feedback sees that it exists, not its
  content) the active shares are tried too, and a sharer whose read passes AND is sufficient
  yields `ReadVia.Shared` (banner, content as the sharer); otherwise the own read stands. A denied
  caller needs only a passing sharer, preferring a sufficient one. `canShare` stays tied to the
  caller's OWN right, whichever way the read was granted — **the SPA must gate the Share button on
  `canShare` only, never on `sharedBy`** (an upgraded read carries `sharedBy` AND `canShare`). The
  feedback events sub-route passes no `sufficient` (events carry no content, so a content-blank
  requester pays no extra share lookup there). Reusable by every adapter.
- **Who is the author** (sees every share of the document and may withdraw any — while they can
  still read it in their own right; the document's subject never sees the share list): feedback →
  the provider; 1:1/goal/review → the stored `manager_id`; impact log/succession plan → the owner;
  **team KPI → whoever passes `requireTeamKpiManage`** (current manager + the chain above —
  `created_by` grants nothing, the v2.26.0 decision). The sharer manages their own shares always.

#### Read-side mechanism

- `ShareAccess.readOrShared(caller, type, id, guard)` runs `guard(caller)`; **only** a
  `ForbiddenException` (or, below, an own read that is not `sufficient`) falls through to the
  caller's active shares of that document — for each
  sharer still active (not deleted/deactivated, feature enabled) the same guard runs for their
  role-stripped principal; the first passing sharer wins, preferring a sufficient one
  (`ReadVia.Shared` carries the sharer's id, name, effective principal and `ownDenied` — whether the
  share was the caller's only way in). No active share → the ORIGINAL denial is rethrown untouched (the
  `authz.denied` audit is unchanged); shares that no longer pass → `403` with the detail "The person
  who shared this no longer has access to it". A throwing chain walk is a `500`, never a denial
  (pinned by `ShareAccessTest` + `SharingTest`).
- `ShareAccess.holdsOwnRight(principal, type, guard)` = the guard with the roles stripped. It backs
  `canShare` (a detail-DTO flag: the share button's gate) and the `POST /shares` precondition.
- Each feature has ONE read preamble that the document's GET sub-routes funnel through (feedback and
  1:1 `…/events`, team-KPI `…/events` and `…/values`, goal and review `…/events`, impact-log and
  succession `…/events`); it is switched to `readOrShared`, covering them. **Two deliberate
  non-follows**: `GET /api/v1/one-on-ones/action-items/{id}/history` stays OWN-RIGHT ONLY (a sharee
  gets the ordinary `403`) — it spans carry-over copies of the item across meetings that were never
  shared, so it is not "this document"; and succession plans have no nominations sub-route — the
  nominations ride embedded in the plan GET, so they are shared with the plan. **The
  adapter's `guard` is the RAW guard, never that preamble** — otherwise a share-granted reader
  would look like an own-right reader and re-sharing would work. Write preambles are untouched: a
  sharee never matches an author id or a team membership.
- Detail DTOs gain `canShare` and `sharedBy` (the sharer's name on a share read — the "Shared with
  you by …" banner); the create response carries `canShare` too.

#### Data model (V86 `document_shares`)

One polymorphic table: `resource_type` (the enum NAME, no CHECK — the V27/V46 idiom) +
`resource_id` (no FK — polymorphic, the V81 `mfa_challenges.user_id` precedent; a soft-deleted
document just stops resolving), `sharer_id`/`sharee_id` (FK `RESTRICT`, `CHECK (sharer_id <>
sharee_id)`), `expires_on` (nullable strict-ISO `VARCHAR(10)`, **inclusive** — the share works
through the end of that day), `created_at`, `withdrawn_at`/`withdrawn_by` (paired CHECK — a
**terminal stamp, rows are never deleted**: the `integration_clients.revoked_at` precedent, a
registered soft-delete exception), and `details`.

- **Status is derived, never stored**: `WITHDRAWN` beats `EXPIRED` beats `ACTIVE`. **Silent
  expiry**: no sweep, no notification; an expired share stays listed as `EXPIRED`. Everything
  date-sensitive (statuses, the active predicates, the create-time validation) runs on
  `ShareService`'s ONE injectable clock (`today()`).
- **No unique index** for "one active share per (document, sharer, sharee)": "active" depends on
  today's date, so it is an in-transaction pre-check serialized per sharer by the two-key
  `pg_advisory_xact_lock(86, sharerId)` (the two-key form cannot collide with
  `MfaChallenges`' one-key lock on a bare user id). A duplicate is `409` with `instance` pointing at
  the existing share; expired/withdrawn rows never block a fresh share (a new row). Property names
  inside the transaction lambdas must not shadow `R2dbcTransaction` members (the service's clock is
  named `clock` for that class of reason).
- **The `details` snapshot — and why.** `details` is a content-free map (`ShareableResource.label`:
  plaintext title/party columns only, never a decrypt, **never a status**) taken ONCE when the share
  is created and served as-is on every list/GET/POST response — there is no live label lookup on
  read. Reason: a lapsed, expired or withdrawn share must not keep leaking the document's CURRENT
  title or state (a goal shared while ACTIVE that later goes back to DRAFT and is retitled would
  otherwise show the DRAFT title to someone who no longer has access). Keys: FEEDBACK
  `{provider, subjects}`, ONE_ON_ONE `{manager, subordinate, meetingDate}`, GOAL `{title,
  subordinate}`, PERFORMANCE_REVIEW `{subordinate, startMonth, endMonth}`, TEAM_KPI `{title, team}`,
  IMPACT_LOG_ENTRY `{title, author, periodStart, periodEnd}`, SUCCESSION_PLAN `{person, owner}`.
  `link` is derived from kind + id (the adapter's `viewPath`), null only when the kind has no adapter.

#### API (`sharing/ShareRoutes.kt`, `/api/v1/shares`)

- `POST` `{resourceType, resourceId, shareeId, expiresOn?}` → `201` + `Location` + `ShareResponse`.
  One sharee per call (the dialog submits sequentially and itemizes failures). Order: body
  (the type that selects the flag and adapter lives IN it, so a malformed body is the one `400`
  before the gates) → the caller's feature flag (`403`) → no adapter → `404` → adapter read (`404`,
  read-before-guard) → `holdsOwnRight` (`403`) → validation after the guard (`400`): `expiresOn` a strict
  ISO date **not before the server's today — no timezone tolerance**, a share EXPIRED at birth must
  never exist or notify; the sharee exists, is active, is not the caller → the locked create (`409`) →
  audit → notification. A sharee whose feature flag is off is allowed: the share is inert and hidden
  from their list until the flag returns.
- `GET /{id}` → the sharer or the author (`403` otherwise — the sharee, the subject and strangers
  included; the author path also needs own-right read and the feature flag).
- `POST /{id}/withdraw` → `204`, terminal; the sharer always (even with the flag since switched
  off), the author while they can still read the document in their own right; repeat → `409`.
  Withdrawing an already-expired share stamps it silently.
- `GET` list (`parsePaging`/`applyPaging`, `SharePage`): `view=withMe|byMe|document` (default
  `withMe`), `resourceType`/`status` equality filters, `resourceId` only with — and required by —
  `view=document` (which also requires `resourceType`), sort `id|createdAt|expiresOn`, default
  `-createdAt`. Shape `400`s precede the gate (the registered list-ordering rule). `withMe` hides
  WITHDRAWN rows and the types of areas the caller has disabled — both in SQL, so `total` stays
  honest; `byMe` shows every status. `document`: the author sees every row, an own-right holder only
  the rows they created, everyone else (HR-auditor-only included) `403`; unknown document/unshareable
  kind `404`.
- **Rate limit**: the `shares` RateLimit bucket, **per caller** (keyed on the JWT principal's
  `userId`), covers `POST /shares` and `POST /shares/{id}/withdraw` — `sharing.rateLimitPerMinute`
  (`$SHARING_RATE_LIMIT_PER_MINUTE`, default 60, boot-validated `1..100000`), registered in
  `AuthRoutes`' single `install(RateLimit)` — which is why `configureShareRoutes` runs AFTER
  `configureAuthRoutes`. `429` is declared on both operations. Reads are not throttled.

#### Notifications (14 types), audit, history

- Per-feature types `<AREA>_SHARED` / `<AREA>_SHARE_WITHDRAWN` for `FEEDBACK_`, `ONE_ON_ONE_`,
  `GOAL_`, `TEAM_KPI_`, `PERFORMANCE_REVIEW_`, `IMPACT_ENTRY_`, `SUCCESSION_PLAN_` (per-feature so the
  `feature` mapping, the preference grouping and the Polish per-noun wording stay precise;
  `lockedOn = false`; email/Teams/preferences ride the `NotificationService` chokepoint). `SHARED`
  → the sharee, params `{sharer}` + the raw ISO `expiresOn` when bound, link = the document's view
  path. `SHARE_WITHDRAWN` → the sharee, params `{sharer, sharee, actor}`, **no link**; when the actor
  is not the sharer (the author withdrew) the **sharer also** gets a copy with `self: "sharer"`
  linking `/shares?tab=byMe`. **Succession is content-free by decision**: its copies carry
  `{sharer}` only (plus the `self` carrier on the sharer's copy) — the type name already says
  "succession plan", nothing about the seat or the end date.
- Audit (`audit/Audit.kt`): `share.created` (byUserId, shareId, shareeId, resourceType, resourceId,
  expiresOn, `role` = always `sharer`) and `share.withdrawn` (byUserId, shareId, sharerId, shareeId,
  resourceType, resourceId, `role` = sharer|author, `wasActive`). **No `*_events` rows** — the
  subject reads several of those histories and must not learn about shares.
- **Not audited, deliberately:** a read that goes through a share is not an audit event (reads
  are not audited in this app except the HR auditor's — `hr.read`/`hr.list`), and the sharer's
  role-stripped evaluation can never emit `hr.read` (every `grantHrRead` branch is a no-op without
  the role). An HR caller who holds a share AND the HR role is read on their OWN path first (the
  guard runs unchanged for the caller before any share is consulted) — so that read is logged as
  `hr.read` exactly as without the share.
- The GraphQL integration API is unaffected (it resolves through services, never the route
  preambles, and its SDL names no share type).

#### Deferred / not done

Days-off entries (needs a per-entry view page first); the SPA (dialog, button, banner, `/shares`
page, notification wording) lands in a later milestone; re-sharing is intentionally impossible.

#### Test map

`ShareServiceTest` (store: expiry boundary on the injected clock, duplicate, the concurrent-create
race, terminal withdraw, list views, the snapshot), `ShareAccessTest` (the mechanism over plain
guards: stripped roles, lapse detail, only-Forbidden-is-a-denial), `ShareRoutesTest` (the generic
routes over a stub adapter: gate ordering, validation, 409, withdrawal matrix + notifications, list
views, rate limit), `SharingTest` (real documents — one section per feature; feedbacks today: the read/events grant, write
403s, no re-share, HR cases, the visibility widening and the upgrade, multi-recipient, lapse,
expiry, withdrawal + notifications, feature-disabled sharee, the HR audit rules; the chain-walk-500
case runs the real adapter against an unreachable database with an ACTIVE share from a party
(the provider, who passes WITHOUT touching the database) — a catch-`Exception` regression in
`readOrShared` would then return a `Shared` read instead of surfacing the outage, which the test's
`assertNotNull(failure)` catches),
`NotificationEmailTest` + `FeatureFlagsTest` (the 14 types). Synthetic ids in store/stub tests come
from `TestShareDocuments` (a high range) so they never collide with real documents.
