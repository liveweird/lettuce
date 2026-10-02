### Document sharing (v4.8.0, V86)

A person who can read a document **in their own right** may share it **read-only** with another
person, open-ended or until a date. Sharees are notified when a share starts and when it is
withdrawn; shares are withdrawn from the document's view screen and from the Shared screen. The
package is `sharing/`; each shareable feature contributes one small adapter. Authoritative
decisions (user-confirmed unless marked as a technical default):

- **Scope.** Feedbacks, 1:1 meetings, goals, impact-log entries, performance reviews, team KPIs,
  succession plans, and (v4.11.0) a **person's days-off calendar** (`ShareableResourceType`, 8 values;
  `DAYS_OFF_CALENDAR`'s resource id is the PERSON's user id — see its table row). Days-off ENTRIES are
  not shareable (no per-entry view screen; the calendar is the unit); pulse surveys are out of scope. **Every kind has an
  adapter, enforced by the compiler**: `ShareRegistry` is built from a function over every
  `ShareableResourceType` and its single construction site (`infra/db/Database.kt`) is an exhaustive
  `when (type)` with no `else` — a new enum value without an adapter does not compile, so
  `ShareRegistry.forType` is non-null and the routes have no "not shareable" branch. (A stored row
  whose `resource_type` name is not in the enum is still hidden by the open-set `knownType()` filter.)
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
- **A sharee sees the shared document, never facts about sibling documents.** A share read must not leak the OTHER documents of the same pair/owner through the shared document's read-model fields. 1:1 meetings are the case: on a share read `minMeetingDate` (a sibling's date) is null, `isLatest` is false (nothing editable; `true` would reveal that no later meeting exists) and each embedded action item's `copiedFromId`/`firstAppearedOn` (they name/date another meeting) are null (`OneOnOneResponse.forSharee`, pinned by a test with two meetings). The meeting's own `meetingDate` and content are what was shared and stay. Every future adapter must apply the same rule to its sibling-revealing fields. **Adapters also feed the activity log's visibility rules:** changing an adapter's `isAuthor` — or the read guard its `guard` calls — MUST update `activity/ActivityVisibility.kt` (`authoredShares` for the author rule, `readable` for the read rule); `ActivityVisibilityParityTest` runs both against the adapters and fails on a disagreement, and a new `ShareableResourceType` needs a matrix there. **Audited so far:** feedback (`FeedbackResponse`), goals (`GoalResponse`), performance reviews (`PerformanceReviewResponse`) and impact-log entries (`ImpactEntryResponse`) carry no field that references or dates another document, so nothing is stripped there (their event params — enum names, own dates/positions/values, own period bounds — reference no other document either: audited for feedback, goal, review, impact-log and team-KPI events); two kinds needed it — 1:1 meetings (sibling-meeting dates and carry-over links, above — and the history's CREATED event `carriedOver` count, dropped from `…/events` on a share read by `OneOnOneEventResponse.forSharee`) and succession plans (each nomination's linked development goals — other documents — are emptied by `SuccessionPlanResponse.forSharee`, and the plan's history is filtered to match: `goals` is dropped from every NOMINATION_UPDATED event's `changed` list on a share read, and an update that changed only the goal links is dropped altogether; storage is untouched, own-right readers see everything).
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
  `created_by` grants nothing, the v2.26.0 decision); **days-off calendar → the PERSON themselves, nobody
  else** (v4.11.0 — the data subject sees and may withdraw every share of their calendar, including their
  managers' shares of it; a chain manager who did not share learns nothing). The sharer manages their own
  shares always.

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
  would look like an own-right reader and re-sharing would work. Write preambles are untouched: **share access never satisfies a write guard** (a sharee who is also a
  team member writes in their own right, never because of the share).
- Detail DTOs gain `canShare` and `sharedBy` (the sharer's name on a share read — the "Shared with
  you by …" banner); the create response carries `canShare` too.

#### Data model (V86 `document_shares`)

One polymorphic table: `resource_type` (the enum NAME, no CHECK — the V27/V46 idiom) +
`resource_id` (no FK — polymorphic, the V81 `mfa_challenges.user_id` precedent; a soft-deleted
document just stops resolving), `sharer_id`/`sharee_id` (FK `RESTRICT`, `CHECK (sharer_id <>
sharee_id)`), `expires_on` (nullable strict-ISO `VARCHAR(10)`, **inclusive** — the share works
through the end of that day), `created_at`, `withdrawn_at`/`withdrawn_by` (paired CHECK — a
**terminal stamp, rows are never deleted**: the `integration_clients.revoked_at` precedent, a
registered soft-delete exception), `details`, and — since V91 (v4.10.0) — `batch_id`
(nullable UUID string stamped on every row one mass share creates; NULL for a single share; never
on the wire — it lets the flood cap count a batch as one notice and joins the rows to their
`share.batch_created` audit event).

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
  IMPACT_LOG_ENTRY `{title, author, periodStart, periodEnd}`, SUCCESSION_PLAN `{person, owner}`, DAYS_OFF_CALENDAR `{person}`.
  `link` is derived from kind + id (the adapter's `viewPath`; never null — the document may be gone, opening it then answers 404/the lapse 403).

#### API (`sharing/ShareRoutes.kt`, `/api/v1/shares`)

- `POST` `{resourceType, resourceId, shareeId, expiresOn?}` → `201` + `Location` + `ShareResponse`.
  One sharee per call (the dialog submits sequentially and itemizes failures). Order: body
  (the type that selects the flag and adapter lives IN it, so a malformed body is the one `400`
  before the gates) → the caller's feature flag (`403`) → adapter read (`404`,
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
- **Notification flood cap**: besides the per-caller rate limit, a per-(sharer, sharee) cap
  bounds what ONE victim can be made to receive — once a sharer has already caused
  `SHARE_NOTIFICATION_DAILY_CAP_PER_PAIR` (20, `sharing/Share.kt`; override `sharing.notificationDailyCapPerPair`
  / `$SHARING_NOTIFICATION_DAILY_CAP_PER_PAIR`, boot-validated 1..1000) share notifications
  (SHARED + WITHDRAWN) to that sharee in a rolling 24 h — counted from `document_shares`
  `created_at`/`withdrawn_at` for the pair, no extra table; since V91 (v4.10.0) the rows of one batch share a `batch_id` and count as ONE notice, `COUNT(DISTINCT COALESCE(batch_id, id::text))` — further shares and withdrawals between
  them STILL HAPPEN but mint no notification, and the audit event carries `notified=false`
  (`share.created`/`share.withdrawn`; a withdrawal of an already-expired share is also
  `notified=false`). The count is taken before the operation, so the cap-th notice is the last minted.
  The decision is made INSIDE the per-sharer advisory lock of the create/withdraw transaction (the
  same `pg_advisory_xact_lock(86, sharerId)` that serializes the duplicate check), so concurrent
  operations by one sharer cannot overshoot it. It gates ONLY the sharee-facing notices: on an author
  withdrawal the sharer's own copy is always sent. Silent operations (capped notices, withdrawals of
  already-expired shares) still count — the cap is slightly stricter than "notices actually sent",
  the safe direction.
- **Rate limit**: the `shares` RateLimit bucket, **per caller** (keyed on the JWT principal's
  `userId`), covers `POST /shares` and `POST /shares/{id}/withdraw` — `sharing.rateLimitPerMinute`
  (`$SHARING_RATE_LIMIT_PER_MINUTE`, default 60, boot-validated `1..100000`); **`POST /shares/batch` has its
  own `shares-batch` bucket** (v4.10.0, same keying and validation) — `sharing.batchRateLimitPerMinute`
  (`$SHARING_BATCH_RATE_LIMIT_PER_MINUTE`, default 10): one batch fans out up to 20 summary notices (+ email +
  Teams), so it neither rides nor spends the single-share tokens. Both are registered in
  `AuthRoutes`' single `install(RateLimit)` — which is why `configureShareRoutes` runs AFTER
  `configureAuthRoutes`. `429` is declared on all three operations. Reads are not throttled.

#### Mass share (v4.10.0, `POST /api/v1/shares/batch`)

Many documents of ONE kind × several sharees in one call; **`PERFORMANCE_REVIEW` and (v4.11.0) `DAYS_OFF_CALENDAR` are batchable**
(`ShareableResourceType.batchSharedNotification` non-null = batchable; every other kind answers `400`;
for calendars the `resourceIds` are persons' user ids and `FORBIDDEN` = a person outside the caller's chain who is not the caller).
Each created row is an ordinary `document_shares` row (per-share withdrawal, author visibility, the lapse
rule, the Shared screen and the activity log all work unchanged) stamped with the batch's `batch_id` (V91).

- **Body** `{resourceType, resourceIds[1..200], shareeIds[1..20], expiresOn?}` (`MAX_BATCH_SHARE_RESOURCES`/
  `MAX_BATCH_SHARE_SHAREES` in `sharing/Share.kt`; at most 4,000 pairs; the SPA chunks a bigger selection
  into sequential calls of at most 200 documents). **Response `200` + `ShareBatchResponse`** — the
  `POST /users/import` precedent (a batch may create nothing, there is no single `Location`):
  `{batchId, items[], created, alreadyShared, forbidden, notFound}`. `batchId` is **null when nothing was
  created** (a pure replay — no id for a batch that was never stored). Items follow the request order:
  per document one item per sharee in request order (`CREATED` with the new `shareId`, or `ALREADY_SHARED`
  with the existing ACTIVE share's id — the single POST's 409 `instance`, itemized; **the existing share is left
  completely unchanged, its end date included — the batch's `expiresOn` is NOT applied to it**, the SPA result
  panel must say so), or ONE item with a null
  `shareeId` for a `FORBIDDEN` / `NOT_FOUND` document; the four counts equal the number of items with that
  status.
- **Order of checks** (the route KDoc mirrors it): malformed body `400` (the one pre-gate 400) → the caller's
  feature flag `403` → non-batchable kind `400` → list shape `400` (sizes/duplicates, schema-declared, before any
  document is read) → per document in request order: adapter read, then `holdsOwnRight` (missing =
  `NOT_FOUND` item, unreadable = `FORBIDDEN` item — the single POST's read-before-guard existence idiom,
  ids only, never content — up to 200 ids per call) → **no shareable document at all = the whole-request `403`** ("You can't share any of
  these documents in your own right", at least one `FORBIDDEN`) **or `404`** ("None of the documents exist"),
  BEFORE any semantic 400, so a caller with no right learns nothing about them → semantic `400`s after the
  guard: `expiresOn` (strict, not before the server's today), every sharee exists, is active and is **not the
  caller** (`createBatch` does not exclude the sharer itself — the DB CHECK would roll the whole batch back
  with a `500`, hence the route check) → `ShareService.createBatch` → audit → notifications → `200`.
  Documents the caller may not share and documents that do not exist never fail the call as long as at least
  one document is shareable.
- **One transaction**: `createBatch` takes the same per-sharer advisory lock as the single create, reads the
  existing ACTIVE pairs, inserts the rest with ONE `created_at` and ONE `batch_id`; a failure creates nothing and
  a concurrent identical batch yields exactly one set of rows. **Idempotent in effect** (API-IDEM-001 stays a
  registered gap): a replay reports every pair `ALREADY_SHARED` and creates nothing; expired and withdrawn rows
  never block a pair. The snapshot `details` are the same per-document labels as a single share's, taken once
  per document after the semantic validation.
- **Notifications**: ONE summary notice per sharee (`PERFORMANCE_REVIEWS_BATCH_SHARED` /
  `DAYS_OFF_CALENDARS_BATCH_SHARED`, params `{sharer, count}` + `expiresOn`, link per kind —
  `ShareableResourceType.batchSharedLink`: `/shares` for reviews, `/days-off?tab=calendar&scope=shared` for
  calendars; `NotificationService.createAll`) — only for a sharee with
  at least one NEWLY created pair whose per-pair cap check passed, `count` = that sharee's created pairs;
  nothing for a sharee whose pairs were all duplicates or whose cap is exhausted (their shares still exist,
  silently); **never** the per-share `PERFORMANCE_REVIEW_SHARED`. The cap counts a batch as ONE notice
  (`COUNT(DISTINCT COALESCE(batch_id, id::text))`), so a batch of 30 does not exhaust a cap of 20; withdrawals
  stay per share and per notice. Each ≤200-document chunk the SPA sends is a separate server batch, so a recipient gets one summary notice per chunk (the dialog hints at it only when a selection exceeds 200).
- **Audit**: ONE `share.batch_created` event per call (`byUserId`, `batchId`, `resourceType`, `resourceIds`,
  `shareeIds`, `created`/`alreadyShared`/`forbidden`/`notFound`, `forbiddenResourceIds`/`notFoundResourceIds`,
  `expiresOn`, `notifiedShareeIds`; comma-joined id lists, `""` = none) and **no per-share `share.created`** for
  batch rows (the `batch_id` joins the rows to the event). A whole-request `403` is the ordinary `authz.denied`;
  a `404`/`400` emits no batch event. A replay that created nothing is still audited (`created=0`, `batchId`
  null).
- **Rate limit**: one call = one token of the per-caller `shares-batch` bucket (default 10/min, its own — see the rate-limit bullet above); the SPA's >200-document chunks run sequentially.
- **Candidates (the picker's data source)**: `GET /api/v1/performance-reviews/share-candidates?periodId=`
  (reviews package — see "Mass share" in `.claude/docs/features/performance-reviews.md`): every person in the
  caller's transitive chain with the period's review and the server-computed `shareable`/`reason`
  (`NO_REVIEW` | `UNREADABLE_DRAFT`) — the in-memory twin of `holdsOwnRight` for this adapter
  (`canShareInOwnRight`: author, or not DRAFT), pinned against the real adapter guard by
  `ShareCandidatesTest`. The batch itself never trusts it — the route re-runs the real guard per document.
- **Accepted consequences**: the activity log lists one `SHARE_CREATED` row per created share (its SQL projects
  `document_shares` rows and ignores `batch_id`) — accurate, verbose at 100+; the Shared screen shows one row
  per share (no batch grouping); the pre-flight cost is at most 200 adapter reads and 200 role-stripped guard
  runs per call (each review guard is one chain walk) — accepted for a deliberate bulk action, no `readMany`
  on the adapter interface; sharing with a subordinate whose own review is in the batch reveals
  pre-publication ratings to them (the v4.8.0 accepted consequence — the author can withdraw); a sharee with
  PERFORMANCE_REVIEWS disabled still gets the rows and the minted notice, both hidden by the list filter (the
  single-share rule).

#### Notifications (18 types), audit, history

- Per-feature types `<AREA>_SHARED` / `<AREA>_SHARE_WITHDRAWN` for `FEEDBACK_`, `ONE_ON_ONE_`,
  `GOAL_`, `TEAM_KPI_`, `PERFORMANCE_REVIEW_`, `IMPACT_ENTRY_`, `SUCCESSION_PLAN_`, and (v4.11.0)
  `DAYS_OFF_CALENDAR_` (per-feature so the
  `feature` mapping, the preference grouping and the Polish per-noun wording stay precise;
  `lockedOn = false`; email/Teams/preferences ride the `NotificationService` chokepoint). `SHARED`
  → the sharee, params `{sharer}` + the raw ISO `expiresOn` when bound, link = the document's view
  path. `SHARE_WITHDRAWN` → the sharee, params `{sharer, sharee, actor}`, **no link**; when the actor
  is not the sharer (the author withdrew) the **sharer also** gets a copy with `self: "sharer"`
  linking `/shares?tab=byMe`. **Succession is content-free by decision**: its copies carry
  `{sharer}` only (plus the `self` carrier on the sharer's copy) — the type name already says
  "succession plan", nothing about the seat or the end date. **The days-off calendar (v4.11.0) names the
  person**: its notices carry the adapter label `person` (`ShareableResourceType.notificationLabelKeys` —
  empty for the seven document kinds, whose params stay byte-identical; the SHARED notice takes it from the
  route's creation-time label, the WITHDRAWN copies from the stored `details` snapshot) because the link opens
  a scope listing many people and the notice must say whose; `self: "own"` rides the sharee's copy when the
  sharer IS the person (EN "shared their days-off calendar", PL "swój kalendarz dni wolnych" — the email
  catalog builds the noun from the params, `calendarShareNoun`), and the author-withdrawal copy for the
  sharer keeps `self: "sharer"` (the author of a calendar is its person, so a sharer's copy never co-occurs
  with `own`). Never dates, pools or entry facts. `share.created`/`share.withdrawn`/`share.batch_created`
  are unchanged.
- Audit (`audit/Audit.kt`): `share.created` (byUserId, shareId, shareeId, resourceType, resourceId,
  expiresOn, `role` = always `sharer`) and `share.withdrawn` (byUserId, shareId, sharerId, shareeId,
  resourceType, resourceId, `role` = sharer|author, `wasActive`). **No `*_events` rows** — the
  subject reads several of those histories and must not learn about shares.
  (The per-user activity log, v4.9.0, lists a person's own share actions — `SHARE_CREATED`
  dated `created_at` for the sharer, `SHARE_WITHDRAWN` dated `withdrawn_at` for the WITHDRAWER — straight
  from `document_shares`, so "no `*_events` rows" stays true: the log is a read model over this table,
  not a second store. Chain viewers see a share row only for a document they AUTHOR; see
  `.claude/docs/features/activity-log.md`.)
- **Not audited, deliberately:** a read that goes through a share is not an audit event (reads
  are not audited in this app except the HR auditor's — `hr.read`/`hr.list`), and the sharer's
  role-stripped evaluation can never emit `hr.read` (every `grantHrRead` branch is a no-op without
  the role). An HR caller who holds a share AND the HR role is read on their OWN path first (the
  guard runs unchanged for the caller before any share is consulted) — so that read is logged as
  `hr.read` exactly as without the share.
- The GraphQL integration API is unaffected (it resolves through services, never the route
  preambles, and its SDL names no share type).

#### Per-type specifics (what each adapter pins)

| Type | Raw guard | Author | Snapshot labels | View path | Notes |
|---|---|---|---|---|---|
| FEEDBACK | `requireFeedbackReadAllowingManager` | provider | `{provider, subjects}` | `/feedback/{id}/view` | content gate on the sharer's principal + the `sufficient` upgrade (requester of an unfinished feedback) |
| GOAL | `requireGoalReadAllowingManager` | stored `manager_id` | `{title, subordinate}` | `/goals/{id}/view` | **no content gate and no `sufficient`** (every reader sees the same description/summary/milestones); DRAFT privacy pinned: a chain manager cannot read a DRAFT so cannot share it, and a share they made while ACTIVE lapses when the goal returns to DRAFT (the pair's own shares keep working); `PUT …/progress` stays manager+subordinate only — a sharee never passes `requireGoalProgressWrite` |
| ONE_ON_ONE | `requireOneOnOneReadAllowingManager` | stored `manager_id` | `{manager, subordinate, meetingDate}` | `/one-on-ones/{id}/view` | **no content gate, no `sufficient`** (notes, decisions and action items are the same for every reader); share-aware routes: the single GET and `…/events`; **sibling-meeting facts are stripped on a share read** (`minMeetingDate` null, `isLatest` false, action items' `copiedFromId`/`firstAppearedOn` null — the contract keeps them nullable, so there is no residual disclosure); **`GET /one-on-ones/action-items/{id}/history` stays OWN-RIGHT ONLY** (raw guard, a sharee gets the ordinary 403 — the chain spans carry-over copies in meetings that were never shared); no write is subordinate-writable, so a sharee never passes any |
| PERFORMANCE_REVIEW | `requirePerformanceReviewReadAllowingManager` | stored `manager_id` | `{subordinate, startMonth, endMonth}` (period bounds, plaintext — never a rating or summary) | `/performance-reviews/{id}/view` | **no content gate, no `sufficient`** (all ten assessment fields read the same for every reader); share-aware routes: the single GET and `…/events` (the other GETs are the caller-scoped list, the create and the v4.10.0 `share-candidates` picker read); **batchable** (v4.10.0 mass share — `POST /shares/batch`, summary notice `PERFORMANCE_REVIEWS_BATCH_SHARED`); **accepted consequence (user decision, 2026-10-01): an own-right reader — the author manager, or a chain manager from CALIBRATION — may share a pre-publication review with anyone, the subordinate included, so a share can reveal pre-publication ratings to the subordinate; the author sees every share and can withdraw it** (pinned by a test); **status nuances come from the guard, not from sharing**: the subordinate reads — so can share — only a PUBLISHED review and their share lapses if it is un-published (PUBLISHED is not terminal), a chain manager cannot read — so cannot share — a DRAFT and their CALIBRATION share lapses if it returns to DRAFT; no sibling-document facts in the response (`periodId` is a registry row, not another review), so no stripping; writes (PUT, submit/revert/publish/unpublish, DELETE) are manager-only and untouched |
| IMPACT_LOG_ENTRY | `requireImpactEntryRead` | the owner (`user_id`) | `{title, author, periodStart, periodEnd}` (plaintext title and period — never the four encrypted sections) | `/impact-log/{id}/view` | **no content gate, no `sufficient`** (the four sections read the same for every reader; a journal has no lifecycle/status nuance); share-aware routes: the single GET and `…/events`; not share-aware (by design): the list (caller-scoped), the dashboard summary, `/teams/members` and the GraphQL API (impact log is not in its v1 schema); no sibling-document facts in the response (nothing references another entry); writes (PUT/DELETE) are owner-only — the chain's read right and a share carry no pen |
| SUCCESSION_PLAN | `requireSuccessionPlanRead` (keyed on the OWNER's chain) | the OWNER (`manager_id`) — never the seat's person | `{person, owner}` ONLY (no criticality, risk, loss impact, candidates or gaps) | `/succession/{id}/view` | the most confidential kind: **content-free notifications** (`{sharer}` only — also no `expiresOn`; the sharer's withdrawal copy adds only the `self` carrier; the sharee's withdrawal copy is deliberately **actor-neutral** — "You no longer have access to a succession plan {sharer} shared with you" — because with `{sharer}` only it cannot say whether the sharer or the author withdrew, so it never claims "{sharer} stopped sharing"; email/Teams use the same catalog, which names the kind of document and the sharer, nothing else) and **no other succession notification can ever be minted** (the plan has none of its own); **sibling-facts rule applied**: each nomination embeds light refs to the candidate's linked development GOALS (`{id, title, status, type}` — other documents the sharee could not read under the goal rules), so on a share read every nomination's `goals` is emptied (`SuccessionPlanResponse.forSharee`); the candidate, readiness, gaps, awareness, bench depth and `last_reviewed_at` are plan content and stay; the plan has **no nominations GET route** (they ride embedded in the plan GET) and its events carry only enum names, field names (the NOMINATION_UPDATED `changed` list — filtered for sharees, see above) and candidate display names (the same disclosure class as the plan itself — no dates); share-aware routes: the single GET and `…/events` (the list stays caller-scoped); subject/candidate status grants nothing, but the owner may share with the seat's person or a candidate on purpose ("whoever I want" — no re-share); a CLOSED plan is read/shared like any other (the guard has no status nuance); writes (plan PUT, close, complete-review, DELETE, every nomination mutation) are owner-only and untouched |
| DAYS_OFF_CALENDAR | `requireDaysOffCalendarRead` (the person, any manager in their TRANSITIVE chain, HR audited — role-stripped for a sharer; **no teammate branch**) | the PERSON themselves (`userId == doc.userId`) — never a chain manager as such | `{person}` (plaintext display name only) | `/days-off?tab=calendar&scope=shared&user={personId}` (the sharee's destination; the SPA re-targets it for sharer/author/HR) | **the resource id is a user id**: `read` resolves the user — null for a soft-deleted one (404), a deactivated one stays shareable; own right = the person themselves or a chain manager, so a teammate (who sees absences by calendar parity), an HR auditor without the relationship and ADMIN-as-such get `403`, and a mere sharee cannot re-share; the share is read through the calendar's `scope=shared` (step 2 of v4.11.0), **not** through `GET /days-off/{id}` (own-right only, a deliberate non-follow: the entry stays unshared); **batchable** (v4.11.0: `DAYS_OFF_CALENDARS_BATCH_SHARED`); the person's rename is not reflected in the stored snapshot; the lapse rule re-runs the chain walk for the sharer (leaving the person's chain ends the share, the person's own share never lapses while they are active) |
| TEAM_KPI | `requireTeamKpiReadAllowingChain` | whoever passes `requireTeamKpiManage` — the team's CURRENT manager + the chain above them (`isAuthor` is a suspend predicate; `created_by` grants nothing) | `{title, team}` (plaintext title and team name — never the description/summary) | `/team-kpis/{id}/view` | share-aware routes: the single GET, `…/values` and `…/events` (the team-scoped lists and the `view=all` HR list stay caller-scoped; the **GraphQL integration API exposes team KPIs but resolves through services with its deliberate authorization bypass — shares do not touch it**); **status/membership nuances come from the guard**: a team member reads — so can share — only a non-DRAFT KPI, and their share lapses if it returns to DRAFT or they leave the team; after a manager reassignment the old manager's shares lapse unless they are still in the chain above the new one; **no content gate, no `sufficient`**; no sibling-KPI facts in the response (team name/id, manager and the stored creator are part of the KPI); a share-only caller gets `canManage = canRecordValues = false` (stamped without a query), and the value writes (manager + chain + CURRENT members) and every definition/lifecycle write stay untouched — a pure sharee passes none |

#### SPA (shipped in M3) and deferred

**Shipped.** `api/shares.ts` (typed client), `utils/shareQueries.ts` (`invalidateShares`), `components/ShareButton.tsx` + `ShareDialog.tsx` + `SharedByBanner.tsx`, the Shared screen (`pages/Shares.tsx`, `/shares?tab=withMe|byMe` — the withdrawal notification links to `?tab=byMe`; ungated "My work" nav leaf, tour id `nav-shares`, a whirlwind stop) and the notification wording (`notifications.event.<area>Shared*`/`<area>ShareWithdrawn*`, EN+PL, context variants `until`/`author`/`sharer`/`owner` computed from the params). Rules the SPA follows:

- **Gate the Share button on `canShare` only, never on `sharedBy`** (an upgraded read carries both). The button sits in the `PageHeader` actions of the seven view pages; a "Shared with you by …" banner shows when `sharedBy` is set.
- **Dialog:** a people picker excluding the caller, deactivated accounts and anyone already holding an ACTIVE share from the caller; an optional "Until" date (a calendar hint — the server decides, "server time"); one POST per person, sequential, failures itemized and retryable (409 drops the person from the selection, 429/400/403/404 get their own reasons); the "Current shares" list is the `view=document` read (all rows for the author, the caller's own for any other own-right holder) with Withdraw behind a confirm.
- **Sharee-specific view rules:** `ViewOneOnOne` hides the per-action-item history icon when `sharedBy != null` (that route is own-right only and 403s sharees); `ReviewSuccessionPlan` hides the development-goals field entirely when `sharedBy != null` (a share read always returns empty `goals` — "no linked goals" would be false); `ViewFeedback` stops hiding the content of an unfinished feedback from a requester whose read came through a share (the server already applied the sharer's content gate). Edit/transition/delete/record-value actions need no sharee branch — they key on author ids and the server's capability flags.
- **The lapse 403** (the detail phrase above, recognised by `utils/shareLapse.ts`) renders the localized `sharing.lapsed` message on every view page.
- **Shared screen:** per tab the list shows document (type pill + a label built client-side from the `details` snapshot per kind, null → "No longer available"), the counterpart (sharer / sharee), until, status, shared-on; Open (`link` + `back=`), Withdraw on ACTIVE rows of "Shared by me". A kind whose feature the viewer disabled is missing from the type filter, and on "Shared by me" its rows stay listed and withdrawable but have no Open; "Shared with me" never offers Open on a non-ACTIVE share.
- **Notification links:** a started share opens the document, the sharee's withdrawal copy has no link, the sharer's copy opens `/shares?tab=byMe` (query string preserved by the bell's relative-path navigation).

**Deferred:** days-off ENTRIES (the calendar, since v4.11.0, is the unit; entries need a per-entry view page first); re-sharing is intentionally impossible.

#### Test map

`ShareServiceTest` (store: expiry boundary on the injected clock, duplicate, the concurrent-create
race, terminal withdraw, list views, the snapshot), `ShareAccessTest` (the mechanism over plain
guards: stripped roles, lapse detail, only-Forbidden-is-a-denial), `ShareRoutesTest` (the generic
routes over a stub registry (the routes look the registry up per request, so a test swaps the attribute with one fake per kind — no production test hook): gate ordering, validation, 409, withdrawal matrix + notifications, list
views, rate limit), `ShareBatchRoutesTest` (mass share over the stub registry under `PERFORMANCE_REVIEW`: the gate order incl. 403/404-before-400, the itemized report with one batch id + snapshots + the single audit event, one summary notice per sharee with the right count and none per-share, the replay, the batch-aware cap with a capped sharee, the 200 × 20 bounds, the shared rate-limit bucket), `SharingTest` (real documents — one section per feature; all eight kinds (the team-KPI section: doc + values + events with no manage/record rights, every definition/lifecycle/data-point write 403, no re-share/HR-auditor share + HR manager, member-of-DRAFT cannot share + the DRAFT/leave-team/reassignment lapses, chain-manager lapse, author (manage predicate incl. the chain) lists + withdraws a member's share, notifications + links, snapshot stable after a retitle; the succession section: plan + events as the sharer sees them with the linked goals stripped, every write incl. nominations 403, no re-share/HR-auditor share + HR owner, seat person/candidate gain nothing from status but can be shared with, CLOSED plans, chain-manager lapse + owner withdrawal, notification params keys pinned exactly, bystanders hear nothing, snapshot stable; the impact-log section: sections as the sharer sees them + events, write 403s, no re-share/HR-auditor share + HR owner, chain-manager lapse with the detail and back, owner lists + withdraws, notifications + links, the full snapshot stable after a retitle, feature-disabled sharee; the reviews section: ratings/summaries as the sharer sees them + events, write 403s incl. every transition, no re-share/HR-auditor share + HR party, subordinate-of-DRAFT/CALIBRATION cannot share, the un-publish and back-to-DRAFT lapses, author withdrawal + notifications, snapshot unaffected by assessment edits; the 1:1 section: read grant + events, the history 403 for a sharee while the sharer reads it, write 403s, no re-share/HR-auditor share + HR party share, chain-manager lapse, author withdrawal + notifications, snapshot stable after a date edit; the goals section: read grant + events, every write incl. the progress PUT 403, no re-share/HR-auditor share, DRAFT privacy + lapse, author withdrawal with notifications, the snapshot surviving a retitle); feedbacks: the read/events grant, write
403s, no re-share, HR cases, the visibility widening and the upgrade, multi-recipient, lapse,
expiry, withdrawal + notifications, feature-disabled sharee, the HR audit rules; the chain-walk-500
case runs the real adapter against an unreachable database with an ACTIVE share from a party
(the provider, who passes WITHOUT touching the database) — a catch-`Exception` regression in
`readOrShared` would then return a `Shared` read instead of surfacing the outage, which the test's
`assertNotNull(failure)` catches),
`NotificationEmailTest` + `FeatureFlagsTest` (the 18 types; `ShareNotificationsTest` pins the per-kind builders — batchable kinds, batch link, label params, the `own` carrier; `GuardsTest` pins `requireDaysOffCalendarRead`; the SharingTest days-off section: own/chain/skip-level share, teammate/stranger/ADMIN 403, no re-share/HR-auditor, the person as author, own-right lapse, deactivated/soft-deleted, notification params, snapshot after a rename, flag gating). Synthetic ids in store/stub tests come
from `TestShareDocuments` (a high range) so they never collide with real documents.

SPA tests: `ShareDialog.test.tsx`, `api/shares.test.ts`, `Shares.test.tsx`, the sharing blocks of the seven view-page tests and `NotificationsButton.test.tsx`; browser journey: `e2e/tests/sharing.spec.ts` (throwaway provider/subject/sharee — share with an end date, bell link to a read-only view, Shared screen, withdraw, lock-out).
