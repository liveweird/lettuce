### Integration API (read-only GraphQL for other apps)

The v3.0.0 machine-to-machine read surface: **`POST /integration/graphql`** (+ `GET
/integration/graphql/schema` serving the SDL as text), mounted deliberately OUTSIDE `/api/v1`
— its contract is the hand-authored SDL at `server/src/main/resources/graphql/schema.graphqls`
(the `documentation.yaml` sibling; the server parses that exact file at boot, so runtime and
contract cannot drift), governed by **`api-guidelines/GRAPHQL-GUIDELINES.md`** (stable
`GQL-*-NNN` rule IDs — cite them like the REST ones). Gated by `integration.enabled`
(`$INTEGRATION_ENABLED`, **default false — fail-closed**: a disabled deployment registers no
`/integration` routes at all; compose ships it `true` as the local demo). Callers are
**integration clients** — dedicated technical identities in `integration_clients` (V71, NOT
`users` rows: a user row would leak into people lists/pickers/the pyramid), each holding one
admin-issued API key. **The deliberate product rule: integration reads bypass ALL per-caller
authorization** — every family in scope is readable in full (DRAFTs included, encrypted content
decrypted), and per-user feature flags don't apply (caller-side gates). Scope v1: users +
career timelines, teams + memberships + KPIs, days off (requests/budgets — per paid pool since v3.2.0 — /corrections, plus the pool kinds registry),
performance reviews, review periods. **NOT in scope** (deliberate, each addition is its own
decision): succession plans (invisible-to-subjects is the product rule), feedbacks, 1:1s,
goals, impact log, pulse, notifications, alerts, templates.

- **Consumer-facing docs**: the root `README.md` section "Integration API (read-only, for other apps)" is the integrator quick-start (enable flag, get a key, curl example, schema discovery, semantics) — keep it in sync with behavior changes here.
- **Clients & keys** (`integration/IntegrationClient*.kt`): `/api/v1/integration-clients` —
  ADMIN-only INCLUDING reads (the alerts posture), ungated by `integration.enabled` (keys can
  be prepared before enabling). `GET` list (unpaged registry) + `GET {id}` + `POST` create +
  `POST {id}/revoke`; **no PUT/DELETE — keys are immutable, revoke is the terminal removal**
  (`revoked_at`, the CANCELLED-status analogue; rows stay listed as audit trail; repeat revoke
  409). Key = `lettuce_int_` + 43 alphabet chars (~258 bits, `generateApiKey` in
  `auth/Passwords.kt`), returned EXACTLY ONCE in the create response
  (`IntegrationClientCreateResponse.apiKey` — the CSV-import password precedent); at rest only
  the SHA-256 hex (`apiKeyHash`; no bcrypt — high-entropy random keys need no work factor;
  V71's unique index doubles as the auth lookup). `authenticate(rawKey)` stamps
  `last_used_at`. Audited: `integration_client.created/revoked`.
- **Endpoint plumbing** (`integration/Integration.kt`): auth is the guard-style
  `integrationCaller()` (the authz/Guards.kt shape — deliberately NOT a Ktor auth provider,
  whose bearer challenge can't emit ProblemDetail), uniform 401 for every failure mode
  (reasons only in `integration.auth_failed`). Per-key RateLimit bucket `"integration"`
  (`integration.rateLimitPerMinute`, default 120/min) — registered inside
  `auth/AuthRoutes.kt`'s single `install(RateLimit)` (the one-install constraint), keyed on
  the SHA-256 of the presented bearer header. Module order: `configureIntegration` runs after
  `configureAuthRoutes` (bucket before wrapper) and before `configureRouting`. The OpenAPI
  conformance test plugin skips non-`/api/` paths, so GraphQL traffic is contract-checked by
  its own gates instead: `IntegrationSchemaContractTest` (Docker-free — parses the committed
  SDL, pins read-only/no-Mutation, the exact root-field surface, full documentation coverage
  incl. enum values, and the no-capability-flags/secrets field walk).
- **Execution model** (`integration/GraphQLFactory.kt` + `Fetchers.kt` + `DataLoaders.kt` +
  `GraphQLJson.kt`): SDL-first graphql-java (pure Java — chosen over graphql-kotlin's
  kotlin-reflect schema generation, which both inverts the hand-maintained-contract philosophy
  and breaks on new Kotlin versions). Resolvers are suspend lambdas bridged via
  `scope.future {}` on the request's `supervisorScope` (supervisor, NOT `coroutineScope` — a
  failing fetcher must fail its own future into a GraphQL error, not cancel the request;
  disconnect still cancels children). **Resolvers hand graphql-java `Map` trees serialized
  from the shared response DTOs** (`toGraphQL()` — kotlinx-serialization round-trip), never
  the DTOs themselves: Kotlin name-mangles UInt-property getters, so `PropertyDataFetcher`
  reflection would silently null every id; hand-built maps (team(id), UserRef) must convert
  UInt→Long explicitly. Nested lists batch through a per-request `DataLoaderRegistry` (~10
  mapped loaders, one service call per (loader, arg-set)). Guardrails: depth 15 (above the standard
  introspection query's 12 — checkup #30 A-H2) + complexity 1000 under the pageSize-weighted
  calculator (subtree × ceil(pageSize/20), cap 5; a variable pageSize charges the cap —
  checkup #30 A-M5) → 200 + errors; `SanitizingExceptionHandler` passes through `BadRequestException`
  messages, everything else logs + "Internal error" (no FQCNs — MT-007). Error split:
  transport = ProblemDetail (401 key, 400 malformed JSON via StatusPages — app-wide), executed
  documents = 200 + `errors`. Introspection stays ON (authenticated contract discovery). Two
  compiler landmines are documented in-code: graphql-java's F-bounded `GraphqlErrorBuilder`
  crashes the Kotlin 2.4.10 frontend (StackOverflow in FIR substitution) — use the plain
  `GraphQLError` impl — and `getArgument<T>` requires non-null type args.
- **Service layer**: resolvers call ONLY services (encrypted fields decrypt in the owning
  service — GQL-SEC-002). Additive unscoped reads (the scoped view enums untouched):
  `DaysOffService.listAllFull/listByUserIds/listCorrectionsByUserIds` (+ the extracted
  `toFullResponse` row converter `read` now shares), `PerformanceReviewService.listAllFull/
  listBySubordinateIds` (full-decryption rows, unlike the ratings-only product list),
  `TeamKpiService.listAllFull/listByTeamIds/valuesByKpiIds`,
  `CareerPositionService.listRowsByUserIds`, `UserService.teamsByUserIds`; reused as-is:
  `UserService.list(callerSeesAllSeniority = true)/read`, `TeamService.list/readDetail/
  membersWithNamesByTeamIds`, `DaysOffService.budgets`, `ReviewPeriodService.list`; the career
  end-date derivation reuses the route's `toResponses` (made internal — one implementation of
  the derived-end model). Capability flags keep their false defaults and the schema never
  declares them.
- **Schema v1 roots** (all documented in the SDL): `users(page, pageSize, name, email,
  deactivated)` / `user(id)` (+ nested careerHistory, teams, daysOff(year),
  daysOffBudget(year!) — the DEFAULT paid pool's row since v3.2.0 — daysOffBudgets(year!) — every
  pool, v3.2.0, with `poolArchived` since v3.2.1 — daysOffCorrections(year), performanceReviews), `teams(page, pageSize,
  name)` / `team(id)` (+ manager, members, kpis → values), `reviewPeriods`, and the bulk-sync
  roots `daysOff(from, to, status, userId)`, `daysOffPoolTypes` (v3.2.0 — the active paid pool
  kinds, default first), `performanceReviews(periodId, subordinateId)`,
  `teamKpis(teamId, status)` — REST-mirroring `{items, page, pageSize, total}` envelopes,
  ids `Int`, dates ISO strings, timestamps the one custom `Long` scalar.
- **Audit**: every executed request → `integration.request` (clientId, clientName,
  operationName, root field names — never query text/variables); `integration.auth_failed`
  (reason) on every rejected key.
- **SPA management** (`pages/IntegrationClients.tsx`, `/integration-clients`, Config nav —
  admin-only like the alerts pages, i18n area `integration`): registry list (Active/Revoked `StatusPill`, creator, last-used relative time), inline "Add client" whose response shows the key
  once in a warning panel via `RevealablePassword` (no toast — the panel IS the confirmation,
  the CreateUser precedent), Revoke behind the ConfirmDeleteModal flow with a "Revoke" confirm
  label. API wrapper `api/integrationClients.ts`.
- **Checkup #30 hardening (v3.0.1)**: the RateLimit bucket keys on the SHA-256 of the
  NORMALIZED token via the shared `integrationBearerToken()` parse (raw-header keying let
  rotated garbage headers mint fresh buckets — limit bypass + unbounded limiter registry;
  non-parsing headers share the per-host bucket, exactly ONE Authorization header accepted);
  `daysOff(from/to)` are strict-ISO-validated and every `year` argument is bounded 2000..2100
  (the REST rules — unvalidated bounds silently dropped rows lexicographically / overflowed the
  budget math); lenient-JSON tokens in `variables` fall back to strings instead of a 500;
  revoke and the `last_used_at` stamp are race-safe conditional updates; `toGraphQL()` uses
  `encodeDefaults = true`; the SDL documents every enum value, the dangling-reference rule
  (soft-deleted users/teams stay embedded as historical labels — the `*Deleted` flag fields
  remain a REGISTERED FUTURE ADDITIVE addition), and the three previously order-silent nested
  lists; audit `rootFields` are RESPONSE KEYS (alias names under aliases — documented
  trade-off) and `operationName` is length-capped. Deferred (registered): the `*Deleted`
  boolean fields on DaysOff/PerformanceReview/Team/TeamKpi, the careerHistory loader's second
  transaction when the batch is empty, the SPA's failed-create alert lingering while editing.
- **Tests**: `IntegrationClientTest` (CRUD/403 incl. HR/validation/audit),
  `IntegrationGraphQlTest` (config gate, uniform 401 matrix incl. revoked, per-family reads
  asserting decryption + the DRAFT bypass, nesting/loaders, paging semantics, guardrails,
  transport-400, SDL route, audit), `IntegrationSchemaContractTest` (Docker-free contract
  statics); SPA `IntegrationClients.test.tsx`; e2e `integration-clients.spec.ts` (admin
  creates → key shown once → GraphQL round-trip via the API → revoke kills it → non-admin
  sees no nav entry).
