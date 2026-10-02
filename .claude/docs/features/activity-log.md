### Activity log (v4.9.0, V87 — a multi-step series)

A chronological, per-person log of **what that person did** — `GET /api/v1/users/{id}/activity`
(package `activity/`). Every feature already keeps a per-document history (the seven `*_events`
tables, one `EventLogTable` shape); nothing answered "what did this person do, in order". This
doc is the authoritative design; it grows with each step (the last section says what is in force
and what is still to come).

#### Decisions (user-locked 2026-10-02)

- **Actor only.** A row lives in the log of the person who ACTED — the event tables are
  actor-attributed. "What happened to me" is the notifications bell, not this log. (A later
  step's days-off entry a manager records for a report therefore shows in the MANAGER's log.)
  System-originated events (`user_id NULL`, V80) are nobody's activity.
- **Access = self / the HR auditor / a manager in the target's transitive chain** (the chain viewer
  sees only the entries whose document they can read themselves). ADMIN gets nothing special.
  No new feature flag; the VIEWER's disabled areas are left out.
- **HR sees the target's share rows** (a later step; the endpoint is `hr.list`-audited and the
  succession-plan precedent already grants HR audit reads).
- **Forward-only history.** New persisted trails start at their deploy; nothing before it can be
  reconstructed (the OTel audit stream is not a store). Step 1 needs none — the seven event tables
  are the history.

#### Query architecture — a query-time `UNION ALL`, no table

`ActivityService` builds, per request, one Exposed `UNION ALL` over the existing event table
objects. Each branch projects the same seven-column tuple, as aliases —
`(area, source, event_id, document_id, created_at, event_type, params)` — filtered on the ACTING
user (`user_id = target`) and the `createdAt` window; the union is ordered/paged/counted **in one
`suspendTransaction`** (API-LIST-001/002), then a second phase hydrates the ≤100 page rows
set-at-a-time (one query per area present, explicit joins — a table with several FKs to `users`
makes an implicit join ambiguous: `EventLog.listFor` was switched to an explicit LEFT JOIN on
`user_id` for the same reason). Why not a `user_activity` table: dual-write plus a backfill, and
every future params-rewriting migration would owe a second copy. Why not a VIEW: `ALTER/DROP
COLUMN` on any referenced column would need drop-and-recreate choreography in every later
migration.

- **The pin (the plan's first task).** `ActivityUnionPinTest` proves, against the real
  Testcontainer, that Exposed 1.5's set operation renders `ORDER BY` over the OUTPUT ALIASES,
  honours `limit`/`offset`, answers `count()` over the union, and that the chain predicate's id set
  binds as ONE `= ANY(?)` array. The pinned behaviour held, so the **VIEW contingency was not
  needed**. If a future Exposed upgrade breaks any of it, the fallback is a migration-owned
  `CREATE VIEW` over the same SELECTs queried through a plain `Table`; nothing above the service
  would change.
- **One branch.** Exposed has no one-branch set operation; a single source (an `area` filter, or
  every other area disabled for the viewer) is paired with its own `WHERE FALSE` twin — same rows,
  one code path. No source at all (a disabled/empty area) answers an empty page without a query.
- **V87 indexes.** `(user_id, created_at)` on each of the seven event tables turns every branch
  into one index range scan (`user_id` is nullable since V80 — a NULL actor is never in the
  range), plus the partial `document_shares(withdrawn_by)` index for the share rows of a later
  step.
- **Deep offset pages** over the union are accepted at this app's scale.

#### Entry shape and order

`ActivityEntry { id, createdAt, area, eventType, params, documentId, link, details }` (nullable
fields are always encoded as explicit nulls).

- **`id` is a synthetic string** `<AREA>:<SOURCE>:<eventId>` (SOURCE `EVENT` here; the share
  sources arrive in step 3). A union row has no scalar id; the string is the stable unique key.
- **Order is total: `createdAt DESC, area, source, eventId DESC`** — the id's own components. The
  only sortable field is `createdAt` (default `-createdAt`; ascending reverses the WHOLE key — the
  tiebreak directions flip with it, so ascending is the exact reverse of the default). This is
  a registered deviation from API-LIST-003 (see the rulebook's known-gaps register).
- `area` = the seven `ShareableResourceType` names for document rows (so `link` is the sharing
  adapter's `viewPath`), plus `DAYS_OFF`, `CAREER_POSITION`, `ACCOUNT` — declared up front (the
  OpenAPI enum is append-only) but producing no rows until their steps.
- **`params`** is the event's content-free map, the same one the document's History tab renders
  (localized client-side by dispatching `area` + `eventType` to the existing describers). The goal
  progress comment and every other encrypted column are **never read** by this service — the union
  carries only the event type and params, and the label queries only plaintext title/party columns
  (the sharing snapshot vocabulary: FEEDBACK `{provider, subjects}`, ONE_ON_ONE
  `{manager, subordinate, meetingDate}`, GOAL `{title, subordinate}`, TEAM_KPI `{title, team,
  type}`, PERFORMANCE_REVIEW `{subordinate, startMonth, endMonth}`, IMPACT_LOG_ENTRY
  `{title, author, periodStart, periodEnd}`, SUCCESSION_PLAN `{person, owner}`). Unlike a share's
  snapshot these labels are the document's CURRENT ones, read at request time — which is exactly
  why they are withheld when the viewer can no longer read the document.

#### Access and visibility

`requireActivityRead` (`authz/Guards.kt`): **self → HR → transitive chain → 403**. Route order:
shape 400s → unknown/soft-deleted target 404 (a deactivated target stays
readable) → guard. HR is audited as `hr.list` resource `activity` with `targetUserId` (+ `area`
when pinned); HR reading their OWN log is self access and is not audited.

- **Self mode** lists EVERY own row, but `details` and `link` are null when the self viewer can no
  longer read the document in their own right: the fact that they acted is theirs, the document's
  current title is not. Implemented by `ActivityVisibility` — one SQL predicate per area, each
  written next to (and mirroring) the `authz/Guards.kt` read guard with the HR role stripped (the
  sharing "own right" definition), selected as a `CASE` boolean in the label query of the ≤100 page
  rows. The viewer's transitive subordinate set is computed once per request and bound as one
  array. A soft-deleted document is never readable.
- **Chain mode** (a manager in the target's transitive chain): a row is listed ONLY if the document
  is one the viewer can currently read in their OWN right — the same `ActivityVisibility`
  predicate, applied as the WHERE of each union branch (the branch joins the parent document, and
  `teams` for KPIs), so hidden rows are never listed or counted and `total` is exact (hide, never
  redact: the viewer must not learn that the report touched a document they cannot open). The
  viewer's own party roles count (a document the viewer authored is theirs), skip-level managers
  follow the transitive chain, DRAFT goals/reviews and undelivered feedback stay private to their
  author pair, KPIs follow the current-manager derivation (the manager and the chain above at any
  status, live members past DRAFT), journal entries and succession plans follow the OWNER's chain.
  The chain set is computed once per request and bound as one array. **Deliberately excluded:**
  share-granted reads (shares are never a list scope) and the days-off teammate grant (calendar
  parity for one entry is no reason to list a colleague's actions).
- **HR mode** (HR on anyone, and HR on themselves) shows every row with labels and links (a deleted
  document's link answers 404, the share-list precedent).
- **The viewer's disabled areas** are not added to the union, so `total` stays honest; an `area`
  filter naming one answers an empty page (never 400). Uniform for every role, HR included.
- **Guard authors:** any change to a document read guard must update the matching predicate in
  `ActivityVisibility.kt` — the guard is the oracle and `ActivityVisibilityParityTest` enforces it:
  for every shareable area it runs the SQL predicate (end to end through the service, chain mode
  AND self mode) against `adapter.read(id) != null && guard(role-stripped viewer, doc)` over a
  seeded matrix (statuses × party / chain / skip-level / team member / outsider / requester
  visibility / multi-recipient feedback / soft-deleted documents and teams), and fails on any
  disagreement; a new `ShareableResourceType` without a matrix fails its exhaustiveness check.

#### Tests

`ActivityLogTest` (the access matrix, seven areas with labels, deleted/KPI-member
readability, the chain section — skip-level goal/feedback/review/KPI/impact/succession visibility,
hidden rows not counted, an ex-chain manager 403, HR + audit, ADMIN/peer 403, 404/deactivated,
paging totals, the order/tiebreak with
injected equal timestamps, filters and bounds, disabled areas, shape-400-before-gate),
`ActivityVisibilityParityTest`, `ActivityUnionPinTest`, the `hr.list` case in `AuditTest`; the
shared `EventLog` mechanics stay
covered by `EventLogTest`.

#### Status — what is in force and what is next

- **Step 1:** V87 indexes, the union read model for the seven document trails, the self + HR
  endpoint, the OpenAPI path/schemas, the guard, the self `readable` projection.
- **Step 2 (in force):** chain-viewer visibility — `ActivityVisibility` as the WHERE of each branch
  (hide, never redact), the chain branch of `requireActivityRead`, `ActivityVisibilityParityTest`.
- **Step 3:** share rows (`document_shares` created/withdrawn; HR sees them, chain viewers only for
  documents they author). **Steps 4–6:** the days-off, career-position and sign-in trails
  (V88–V90, forward-only). **Steps 7–8:** the SPA page and the release.
