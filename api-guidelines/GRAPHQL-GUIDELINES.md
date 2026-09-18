# GraphQL Integration API Guidelines

The normative rulebook for the read-only integration GraphQL API at `POST /integration/graphql`
(v3.0.0) — the GraphQL sibling of `API-GUIDELINES.md`, same conventions: every rule has a
stable ID (`GQL-<SECTION>-<NNN>`), a MUST/SHOULD statement, and a one-line **Check**. Cite IDs
when discussing schema design. Rules marked `[test]` are enforced mechanically by
`IntegrationSchemaContractTest`/`IntegrationGraphQlTest`; the rest are review checks. The
committed SDL at `server/src/main/resources/graphql/schema.graphqls` is **the contract
artifact** (the `documentation.yaml` sibling): the server parses that exact file at boot, so
the runtime schema cannot drift from it.

## Contract & evolution

- **GQL-CON-001** `[test]` The schema MUST be SDL-first: hand-authored in `schema.graphqls`,
  loaded at boot, never generated from code. **Check**: `configureIntegration` reads the
  resource; the contract test parses the same file.
- **GQL-CON-002** `[test]` The schema MUST declare no `Mutation` or `Subscription` type — the
  API is read-only by construction, not by guard. **Check**: contract test asserts both absent.
- **GQL-CON-003** The schema MUST evolve additively: new fields/types/arguments are fine;
  renaming or removing anything, or tightening nullability, REQUIRES a major app version.
  Retired fields carry `@deprecated(reason: "...")` for at least one major version first.
  **Check**: diff review of `schema.graphqls`; the contract test pins the root-field surface
  so root changes are conscious.
- **GQL-CON-004** `[test]` Every type, field, argument, and enum value MUST carry a
  description string —
  the schema is self-documenting via introspection (which stays enabled) and
  `GET /integration/graphql/schema`. **Check**: contract test walks the schema.
- **GQL-CON-005** `[test]` Any non-additive change (rename, removal, or nullability
  tightening) follows a fixed two-step protocol instead of an ad hoc breaking change: (a) in a
  MINOR app release, mark every affected member `@deprecated(reason: "<why>. Removed in
  <MAJOR>.0.0.")` and add a "scheduled" row to the known-gaps register below naming the target
  major version; (b) the removal itself lands ONLY in that MAJOR app release, together with the
  SDL header's `Schema version` bump (`v1` → `v2`) and a changelog entry naming every removed
  member. The endpoint path (`/integration/graphql`) never changes — there is no URL
  versioning; clients pin the app version instead. An already-shipped, unregistered removal
  (see the v3.9.0 row below) becomes a register row when discovered — the register is never
  rewritten as if the deprecation window had happened. **Check**: `IntegrationSchemaContractTest`
  pins that every `@deprecated` reason names its removal version in that exact form.

## Naming & shape

- **GQL-NAME-001** Types are `PascalCase` nouns; fields and arguments `camelCase`; enums mirror
  the server's Kotlin enum values verbatim (`SCREAMING_SNAKE`). Field names MUST match the REST
  wire names for the same data (the DTO-serialization bridge guarantees it — divergence means a
  hand-built map drifted). Registered carve-out: deliberate GRAPH reshapes of flat REST pairs
  (`Team.manager: UserRef` over `managerId`/`managerName`) are allowed — the nested object's own
  fields still follow the rule. **Check**: review against the REST response schemas.
- **GQL-NAME-002** Ids are `Int` (unsigned 31-bit, numeric parity with REST JSON); dates are
  ISO `String` (`YYYY-MM-DD`, months `YYYY-MM`); timestamps are epoch-millis via the custom
  `Long` scalar — the ONE custom scalar; adding another needs a registered reason here.
  **Check**: grep the SDL for `scalar`.
- **GQL-LIST-001** `[test]` Every unbounded collection MUST be a paged root field with
  `page`/`pageSize` args and an `XPage { items page pageSize total }` envelope carrying the
  REST list semantics (1-based, default 20, max 100, `total` after filters before pagination;
  violations are GraphQL errors). Small closed registries (review periods) and parent-scoped
  nested lists MAY be unpaged. **Check**: `DataFetchingEnvironment.pageRequest()` (Fetchers.kt) is the only paging parser;
  route test covers the bounds.
- **GQL-LIST-002** Nested list fields MUST resolve through a per-request DataLoader batching
  one service call per (loader, arg-set) — a per-row SQL call is a defect. **Check**: new
  nested fields register in `DataLoaders.kt`.

## Data access & security

- **GQL-SEC-001** Access REQUIRES an integration-client API key (`Authorization: Bearer
  lettuce_int_…`); every failure mode answers the SAME 401 ProblemDetail (reasons only in the
  audit trail). Keys are admin-issued, shown once, SHA-256-at-rest, terminally revocable
  (`/api/v1/integration-clients` — REST, governed by API-GUIDELINES.md). **Check**:
  `IntegrationGraphQlTest` auth matrix.
- **GQL-SEC-002** Resolvers read through the owning feature services ONLY — encrypted columns
  decrypt exactly once, in the service that owns the cipher; a resolver touching an Exposed
  table with encrypted columns directly is a defect. The per-caller authorization bypass is
  deliberate and total; per-user feature flags do not apply (caller-side gates).
  **Check**: review; the encryption tests pin service-side decryption.
- **GQL-SEC-003** `[test]` Caller-relative capability flags (`canCancel`, `canManage`, …) and
  secrets (password hashes, key hashes) MUST NOT appear in the schema. **Check**: the contract
  test's forbidden-field walk (checkup #30, B-M4) plus the unknown-field route test.
- **GQL-SEC-004** `[test]` Scope additions are opt-in per family: succession plans, feedbacks,
  1:1s, goals, impact log, pulse, notifications, alerts, templates are NOT exposed in v1 —
  adding a family is a deliberate decision recorded in the feature doc, never a side effect.
  **Check**: contract test pins the root surface.
- **GQL-SEC-005** The endpoint exists only when `integration.enabled` is true (default false —
  fail-closed); the per-key rate-limit bucket (`integration.rateLimitPerMinute`) MUST wrap
  every `/integration` route. **Check**: disabled-404 route test; `rateLimit` wrapper in
  `Integration.kt`.

## Errors & operations

- **GQL-ERR-001** `[test]` Transport errors are RFC 7807 ProblemDetail (401 bad key, 400
  malformed JSON body — StatusPages); everything after a parsed transport request — validation,
  guardrails, resolver failures — is HTTP 200 with the spec `errors` array. Never mix the two.
  **Check**: route tests for both classes.
- **GQL-ERR-002** `[test]` Resolver failures MUST surface sanitized: argument-validation
  messages pass through; unexpected exceptions become a bare "Internal error" (logged
  server-side) — never exception class names (the MT-007 rule). **Check**:
  `SanitizingExceptionHandler` + tests.
- **GQL-OPS-001** `[test]` Query-shape guardrails MUST stay installed: max depth 15 (above
  the standard introspection query's depth 12 — checkup #30 A-H2: a lower limit breaks the
  contract-discovery promise) and max complexity 1000 under the pageSize-weighted calculator
  (a paged field multiplies its subtree by ceil(pageSize/20), cap 5 — checkup #30 A-M5:
  flat budgets ignore page size and let alias fan-outs amplify the year-scoped DataLoaders);
  changing either is a reviewed change here. **Check**: the introspection-succeeds,
  depth-probe, and alias-fan-out route tests.
- **GQL-OPS-002** `[test]` Every executed request MUST audit `integration.request` (client id,
  client name, operation name, root field names) — never query text or variables; auth
  failures audit `integration.auth_failed`. **Check**: audit route test.

## LLM review checklist

For a change touching the integration API, verify: (1) SDL and resolvers changed together, and
the change is additive [GQL-CON-003]; (2) every new member documented [GQL-CON-004]; (3) new
collections paged [GQL-LIST-001] and batched [GQL-LIST-002]; (4) new data flows through the
owning service, encrypted columns decrypt there [GQL-SEC-002]; (5) no capability flags or
secrets [GQL-SEC-003]; (6) scope additions deliberate + documented [GQL-SEC-004]; (7) the
contract test's root-field list updated consciously; (8) every `@deprecated` reason names its
removal version [GQL-CON-005]; (9) `IntegrationGraphQlTest` covers the new surface's happy path
and its error shape.

## Appendix: known-gaps / decision register

Accepted, registered non-conformances against the rules above — the `API-GUIDELINES.md`
known-gaps register's sibling. A breaking change (removal, rename, or nullability tightening)
that skips the GQL-CON-003 major-bump/deprecation-window requirement is registered here, with
its rationale, rather than treated as undocumented drift. Reviewers cite a registered row as
"registered gap", not as a finding.

| Rule | What happened | Rationale | Decision |
|---|---|---|---|
| GQL-CON-003 | v3.9.0 removed the days-off approval lifecycle from the schema without a deprecation window: the `DaysOffStatus` enum; `DaysOff.status`/`resolvedById`/`resolvedByName`/`resolvedAt`/`cancelledAt`/`cancelledById`/`cancelledByName`/`cancelReason`; the `daysOff(status:)` root argument; and `DaysOffBudget.reserved` | Internal v1 contract with no external consumer yet, and the endpoint is off by default (`INTEGRATION_ENABLED=false`, fail-closed) — no deployed integration could have depended on the removed members | Accepted without a major app version bump; the next removal follows GQL-CON-005 |

**Going forward**: the next removal or breaking change to any member already exposed in a
shipped schema MUST follow GQL-CON-005 in full (a MINOR release's `@deprecated` window naming
the removal version, then the removal itself only in that MAJOR app release) unless it is
registered here first, with a rationale, before the change ships.
