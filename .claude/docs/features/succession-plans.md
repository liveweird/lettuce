### Succession plans

A **succession plan** (v2.42.0) is a manager's private planning record for a **critical
role/seat**: one person (`user_id` — in the owning manager's TRANSITIVE chain at creation,
immutable afterwards) with a **role criticality** (`CRITICAL/CORE/STANDARD`), a **retention
risk** (`HIGH/MEDIUM/LOW`), an ordered list of short **loss-impact** texts, and a **target
bench depth** (1–10, default 2 — the minimum nominated successors). Each plan holds
**successor nominations**: a candidate (ANY active user except the seat's person — cross-team
/lateral candidates are deliberate, no chain requirement; `readiness`
`READY_NOW/READY_SOON/FUTURE_PIPELINE/EMERGENCY_INTERIM`, `nomination_type`
`PRIMARY/SECONDARY/CROSS_TEAM`, ordered **competency-gap** texts, `awareness`
`TRANSPARENT/IMPLICIT/CONFIDENTIAL` — **pure metadata**: whatever the value, the candidate is
never notified and never granted any read), each linkable to the candidate's existing personal
goals as **development action items**. Tables `succession_plans` + `succession_nominations`
(`V68`, both standard soft-delete) + the hard-delete join `succession_nomination_goals`
(wholesale-replaced on every nomination PUT, position = payload order — the goal_milestones
class). Implementation in `server/src/main/kotlin/succession/` (`SuccessionPlan.kt` DTOs +
validators, `SuccessionPlanService.kt`, `SuccessionRoutes.kt`), cloned from impactlog.

- **Authorization** (see the resource bullet in `.claude/docs/authorization.md`): **writes are
  owner-only** (`requireSuccessionPlanWrite` — the chain rule's authorship carve-out; ADMIN and
  HR get nothing); **reads** are the owner + any manager in the OWNER's transitive chain + the
  HR auditor (audited `hr.read`, resource `successionPlans`) — `requireSuccessionPlanRead`, the
  `requireImpactEntryRead` shape keyed on the AUTHOR, not the subject. **The feature is
  invisible to its subjects**: the seat's person and the nominated candidates get 403 whatever
  the awareness value says. Read-before-guard idiom (missing → 404, forbidden → 403); the write
  guard runs before `receive`. Create-time chain rule: the seat's person must be in the
  caller's transitive chain (403) and active (400); **one OPEN plan per (owner, person)** —
  pre-checked 409 with the `uq_succession_plans_owner_user_open` partial index as the race
  backstop (other managers keep their own independent plans; closed/deleted plans never
  block). Feature-gated by **`SUCCESSION_PLANS`** (standard default-enabled flag) via
  `successionCaller()` — first guard in every handler.
- **Lifecycle**: OPEN → CLOSED via `POST …/{id}/close` — **terminal** (repeat close → 409, no
  reopen); a CLOSED plan stays browsable but every mutation (plan PUT, nomination
  POST/PUT/DELETE) answers 409 "A closed succession plan is read-only"; DELETE (soft) stays
  available at any status. `last_reviewed_at` is stamped at create and updated **ONLY by the
  explicit review action `POST …/{id}/complete-review`** (v2.44.0 — owner-only, OPEN-only 409,
  repeatable; the v2.42.0 editing-is-reviewing model is REVERSED by the user: plan/nomination
  mutations and closing never touch the stamp; the V68 SQL comment saying otherwise is
  historical — Flyway checksums freeze it). No event tables (the days-off class —
  HR reads are still audited) and **NO notifications of any kind** (deliberate: confidential,
  pull-not-push; the SPA's invalidation skips the bell).
- **Bench math (user decision)**: `benchCount` counts ALL active nominations — emergency
  interims included; the under-bench cue compares it against `targetBenchDepth` (orange
  warning while short, teal once met, equality good). List rows get it via one grouped count
  per page (the milestones-tally idiom); the document via the embedded nominations.
- **One PRIMARY per plan (v2.43.0, V69)**: at most one active nomination may be
  `nomination_type = PRIMARY`. The server enforces it by **auto-demoting** — a nomination
  create/PUT that sets PRIMARY flips any other active PRIMARY on the plan to SECONDARY in the
  same transaction (`demoteExistingPrimary`, self-excluding on PUT; the demoted row's
  `last_modified` bumps too), never by rejecting (user decision — no acknowledge flag in the
  API). The `uq_succession_nominations_plan_primary` partial unique index is the
  concurrent-write backstop (23505 → the global 409 mapping; a retry then succeeds by
  demoting); V69 also normalized pre-rule data (per plan, the most recently modified PRIMARY
  kept, the rest demoted). The SPA is the UX gate: submitting PRIMARY while the loaded plan
  document holds another PRIMARY opens a ConfirmActionModal naming both candidates
  (`succession.primaryConfirm*`), and the nomination create form seeds its type to SECONDARY
  when the plan already holds a PRIMARY, so the confirm fires only on a deliberate choice.
- **Goal links**: `SuccessionNominationRequest.goalIds` (wholesale replace, ordered, dupes →
  400) must each be a non-deleted goal whose `subordinateId` IS the candidate and which the
  plan's OWNER may read under the goal rules minus HR (the owner authored it, or it has left
  DRAFT and the candidate is in the owner's transitive chain) — validated inside the mutation
  transaction (cross-feature table read, the service-layer rule). Reads carry light
  `SuccessionGoalRef`s (id/title/status/type — **title is plaintext by design**; a soft-deleted
  goal drops out silently). **Registered disclosure**: a chain/HR reader of the plan sees the
  linked goals' titles even when the goal document itself is outside their goal-read rights
  (possible only for lateral candidates) — title-only, the plaintext-title class, accepted.
  The goals themselves are untouched: a linked goal renders to its subordinate exactly as
  before, with no hint of the succession context.
- **Encryption at rest**: `loss_impact` and `competency_gaps` are each ONE
  application-encrypted JSON array (kotlinx list codec inside the service; nothing SQL-queries
  them, neither ever rides list rows) — `SuccessionPlanService` is the TENTH `EncryptedAtRest`
  registrant (both tables in one `encryptLegacyRows` transaction, the GoalService two-table
  shape). Everything else (enums, ids, bench depth, timestamps) stays plaintext.
- **List** (`GET /api/v1/succession-plans?view=own|team|user`): `own` (default) = the caller's
  plans (a non-manager just gets an empty page); `team` = plans owned by the caller's direct
  reports, widened to the whole transitive chain with `includeIndirect=true` (team-only, else
  400 — the goals view=team shape; every listed row is openable); `user` (HR-only via
  `requireAuditListAccess`, audited `hr.list`; requires `userId`, rejected elsewhere) = every
  plan the target is a party to — as the seat's person OR the owner (the feedback auditor
  rule). Sortable `id`/`userName`/`managerName`/`status`/`createdAt`/`lastReviewedAt`, default
  `-lastReviewedAt` (recent planning activity first); `userName`/`managerName` substring
  (`containsNormalized`) + `status` equality filters. Rows carry parties, the two labels, the
  bench tally, status, and the reviewed stamp — never loss-impact or nomination detail.
- **SPA**: nav leaf **"Succession plans"** (`IconUserShield`, `feature: "SUCCESSION_PLANS"`,
  tour `nav-succession`) — **the first `managerOnly` nav gate**: resolved via `useIsManager()`
  in `Shell`, an ASYNC query, so the leaf pops in once the managed-teams probe answers (HR
  reaches the feature via the Audit drill-down instead; a non-manager's direct visit renders
  the empty own list — no async redirect race, the MyGoals-own precedent). `/succession`
  (`SuccessionPlans.tsx`, the ImpactLog two-tab shape): "My plans" (`SuccessionPlanTable
  view="own"` — row actions are **Review** (everyone; the screen renders read-only where the
  caller can't write) **+ the owner's Delete** (any status, `useDeleteConfirm`) since v2.44.0
  — there is NO Edit action or edit page anymore; footer "New plan", managers only) and —
  managers only — "My subordinates' plans" (`view="team"`, read-only, `withReportsScope` →
  `includeIndirect`). Columns: seat person, Criticality/Retention-risk badges
  (`components/SuccessionBadges.tsx` — CRITICAL red.7/CORE orange.6/STANDARD gray.6; HIGH
  orange.8/MEDIUM yellow.6/LOW teal; **the two severity badges are `variant="filled"` +
  `autoContrast`** since v2.44.0 — the light variant was unreadable on yellow/orange — and
  their color maps are exported for the definition sliders), **Bench** ("n / target"
  `BenchBadge`, orange under target / teal met), Status (OPEN teal/CLOSED gray), **Last
  reviewed** (`formatRelativeTime` + absolute `title` — the house relative-time idiom).
  `/succession/new` and the Review screen share `components/SuccessionPlanFields.tsx`
  (v2.44.0: criticality/risk as **discrete 3-stop `Slider`s** — mild→severe left-to-right,
  marks = the enum labels, track colored from the badge maps, aria via `thumbLabel` (the
  CareerPyramid rule), driven by keyboard in tests; the bench-depth NumberInput's hint moved
  from `description` into a `HintIcon` (the PulseTeamResultCard reusable) beside the label;
  and the loss-impact list via **`components/OrderedTextListEditor.tsx`** — the
  GoalMilestonesEditor generalized over the form type, reusing `RowControls`; used again for
  competency gaps). **`/succession/:id/view` is the Review screen**
  (`ReviewSuccessionPlan.tsx`, v2.44.0 — the former read-only view + `/succession/:id/edit`
  page folded into one, no view/edit switching): two Tabs (`keepMounted={false}`, the
  EditGoal-inside-form idiom) — **Basic info** (party row + Last reviewed; the definition
  INLINE-EDITABLE via a page-level `useForm` + `SuccessionPlanFields` for the owner of an
  OPEN plan, the read-only badge/list render otherwise; the under-bench Alert lives here) and
  **Nominations** (the bench badge, the Paper cards with linked-goal chips → `goalViewLink`;
  owner+OPEN keeps always-visible Add/per-card Edit+Delete navigating to the nomination
  editor). Footer (owner+OPEN, in order): **Close** — ConfirmActionModal warning the visit
  won't count as a review (+ an unsaved-changes sentence when the form is dirty), confirm =
  Leave; **Complete review** — validates, PUTs the definition only when dirty, then POSTs
  `complete-review`, toasts `succession.toast.reviewed`, exits; **Close plan** — the
  unchanged confirm + close, the screen re-renders read-only in place. Non-owners and CLOSED
  plans get a single plain Close; **plan Delete lives on the list only**. The nomination
  editor `/succession/:id/nominations/new` +
  `…/:nominationId/edit` (`EditSuccessionNomination.tsx`, one screen both modes): candidate
  Select over `useAllUsers` minus the seat person/deactivated/already-nominated, the three
  enum Selects, the gaps list, and the **Development action items MultiSelect** over
  `listGoals({view:"managed", subordinateId: candidate, includeIndirect})` (already-linked
  out-of-pool goals stay selectable) plus the **"New development goal" Modal**
  (`GoalDefinitionFields` embedded — creates a DRAFT for the candidate, auto-selects it =
  linked by default, no navigation; shown only when the candidate is in the caller's
  `useManagedReports` pool, since the server would 403 the create). HR audit drill-down
  `/users/:userId/succession?mode=audit` (`UserSuccessionPlans.tsx`, `view="user"`) via the
  User-details Audit block (`succession` ButtonKey in `personCardSupport.ts` — audit-flavor
  labels only, `FEATURE_OF` = SUCCESSION_PLANS; remember `auditBlockHasActions` lists it).
  Per-area quartet `api/successionPlans.ts`, `utils/successionLinks.ts`,
  `utils/successionQueries.ts` (`invalidateSuccession` — no bell), `utils/successionForm.ts`;
  i18n area `succession` (`locales/{en,pl}/succession.json`); view-settings keys
  `succession.own`/`succession.team`/`userSuccession.audit`.
- **Tests**: `SuccessionRoutesTest` (create round-trip + chain 403 + deactivated 400 +
  duplicate-open 409, the read matrix incl. the seat-person/candidate 403s, owner-only writes,
  the closed-plan 409 matrix, nomination CRUD + candidate rules + the goal-link 400 matrix,
  the mutations-never-touch-the-stamp pins + the `complete review` matrix (sole stamp writer,
  owner-only, OPEN-only, repeatable), the three list views + filters, the no-notifications
  pin), `SuccessionValidationTest` (pure), `SuccessionEncryptionTest` (envelopes on both JSON
  columns, backfill + rotation), `GuardsTest` succession section, the FeatureFlagsTest gate
  probes. SPA: the five page tests (`ReviewSuccessionPlan.test.tsx` covers the tabs, the
  slider fields, the Complete-review save+stamp flows, and the Close warning) +
  `SuccessionBadges`/`OrderedTextListEditor` component tests + `successionForm.test.ts` + the
  App nav-gate and Tour cases; e2e `succession.spec.ts` (owns Manager AAA's plans — seat AAA
  One, candidates AAA Two/Three — and the modal-created goal for the (Manager AAA, AAA Two)
  pair).
