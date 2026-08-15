# Repository Guidelines

## Sources of Truth

This file is the Codex entry point. Before changing code, also read the relevant sections of
`CLAUDE.md`; when working under `web/`, read `web/CLAUDE.md` as well. `CLAUDE.md` uses Claude's
`@...` import syntax to reference the cross-cutting conventions in `.claude/docs/` (persistence,
list endpoints, security, authorization, observability, testing); Codex must open the applicable
files directly. Each feature's authoritative deep-dive lives in `.claude/docs/features/` — read
the matching feature doc before changing that feature, and read `migrations.md` before adding a
migration or reasoning about schema history. Together those files contain the detailed, actively
maintained domain, security, persistence, UI, and testing conventions shared by the project. For
API work, `api-guidelines/API-GUIDELINES.md` is authoritative and its stable rule IDs should be
cited in reviews. If documentation and executable configuration disagree, the configuration and
code win; update the affected guidance in the same change.

The playbooks in `.claude/skills/` are useful repository-local references even outside Claude:
`api-review` covers the two-pass OpenAPI review, `run-stack` covers packaging/deployment, and
`verify` covers browser verification and cleanup.

## Project Structure & Architecture

This is a Kotlin/Gradle backend plus a separate React frontend:

- `core/` is Kotlin Multiplatform (currently JVM-targeted) and owns the shared OpenTelemetry SDK
  bootstrap.
- `server/` is the Kotlin/JVM Ktor application. Feature packages live directly under
  `server/src/main/kotlin/` (`auth`, `users`, `teams`, `feedbacks`, `oneonones`, `goals`,
  `teamkpis`, `reviews`, `daysoff`, `pulse`, `settings`, `templates`, `dictionaries`,
  `notifications`, `alerts`, and `dashboard`). Cross-cutting wiring and policy live in
  `plugins/`, `audit/`, and `authz/`; infrastructure is in `infra/`.
- `server/src/main/resources/application.yaml` declaratively registers application modules.
  `main.kt` only starts `EngineMain`; do not wire features from it. Module order matters because
  modules publish and consume Ktor application attributes.
- PostgreSQL is the only database. Flyway migrations under
  `server/src/main/resources/db/migration/` are the schema source of truth; Exposed over R2DBC is
  used for runtime queries. Never introduce runtime DDL such as `SchemaUtils.create`.
- `server/src/main/resources/openapi/documentation.yaml` is the hand-maintained API contract.
- `web/` is a standalone Vite + React 19 + TypeScript SPA. Gradle does not build it. Source is
  organized into `pages/`, `components/`, `api/`, `hooks/`, `utils/`, `changelog/`, and bilingual
  resources under `locales/{en,pl}/`.
- Backend tests are in `server/src/test/kotlin/`, colocated frontend tests use `*.test.ts(x)`, and
  Playwright journeys are in `e2e/tests/*.spec.ts`.

Routing is feature-local. Cross-cutting Ktor wiring functions are named `configureXxx` and must be
registered in `application.yaml`. `plugins/Routing.kt` is only the final SPA/static-file catch-all.

## Build, Test, and Development Commands

- `docker compose up --build`: build and run PostgreSQL, Mailpit, the API, and the SPA at
  `http://localhost:8080`; Mailpit is at `http://localhost:8025`.
- `docker compose up postgres`: start only the development database.
- `./gradlew build`: compile and verify the Gradle modules with the JDK 21 toolchain.
- `./gradlew :server:run`: start Ktor/Netty on port 8080.
- `./gradlew test` or `./gradlew :server:test`: run Kotlin tests; Docker is required for
  Testcontainers.
- `./gradlew :server:test --tests "<fully-qualified test name>"`: run one backend test.
- `cd web && npm run dev`: start Vite on port 5173, proxying `/api` to Ktor.
- `cd web && npm run build && npm run lint && npm test`: type-check, bundle, lint, and run Vitest.
- `cd web && npm run test:coverage`: run frontend coverage gates.
- `cd web && npm run gen:api`: regenerate `web/src/api/schema.ts` from the OpenAPI contract.
- `cd e2e && npm test`: run Playwright against the full stack on port 8080.

For a clean frontend install, use `cd web && npm install --legacy-peer-deps`;
`openapi-typescript` declares a TypeScript 5 peer while the project uses TypeScript 6. Keep the
Gradle and npm toolchains disjoint.

Package deployments with `./gradlew :server:installDist`. Never use `buildFatJar`: merging Flyway
service descriptors breaks plugin discovery at runtime. JVM runtime flags are intentionally set in
`server/build.gradle.kts`; consult `.claude/skills/run-stack/SKILL.md` before changing them.

## API and Backend Conventions

Follow `api-guidelines/API-GUIDELINES.md` for resource naming, pagination, filtering, sorting,
errors, statuses, auth, and conformance. List endpoints use the shared paging helpers and the
`{items, page, pageSize, total}` envelope. Keep authorization checks before resource-dependent
validation so callers cannot infer inaccessible state.

When an API changes, update all of the following in the same change:

1. Route/service behavior and focused tests.
2. `server/src/main/resources/openapi/documentation.yaml`.
3. The generated `web/src/api/schema.ts` via `npm run gen:api`.
4. API guideline conformance, using the Spectral ruleset and review checklist described in
   `.claude/skills/api-review/SKILL.md`.

Use `V<number>__description.sql` for migrations. Most business entities follow the established
soft-delete convention (`marked_as_deleted`, active-row filtering on every read/count/mutation,
and partial unique indexes where deleted values may be reused); follow the detailed pattern in
`.claude/docs/persistence.md` rather than inventing a variant, and keep
`.claude/docs/features/migrations.md` current. Emit structured `audit(...)` events for
security-relevant mutations and denials, and never log passwords or tokens.

Use four-space indentation, preserve existing package boundaries, PascalCase for Kotlin types,
and camelCase for functions and variables. Name backend test classes `*Test`.

## Frontend Conventions

Use two-space indentation, PascalCase for React components, and the existing shared
components/hooks instead of cloning list, pagination, filtering, confirmation,
query-invalidation, link-building, or error-mapping logic.
The design system is owned by `web/src/theme.ts` and `web/src/theme.module.css`: brand green is the
interactive accent, semantic success is teal, and table framing is theme-wide. Keep accessibility
roles, labels, semantic tables, and `data-tour` anchors stable.

All user-facing strings must use react-i18next. Keep English and Polish resources in parity;
Polish uses inclusive slash forms and the declined loanword `feedback`, not `opinia`. Successful
mutations use the shared fixed-vocabulary success toast, while errors remain inline. Follow
`web/CLAUDE.md` for the exact list-page, form-container, navigation, and Markdown discard-confirm
patterns.

Per-user feature flags are enforced independently by the server and SPA. When adding or changing
a gated surface, keep route guards, navigation, page guards, cards/actions, notifications, and
tour-step gates aligned with the feature-flag rules in `web/CLAUDE.md` and
`.claude/docs/authorization.md`.

`web/src/changelog/entries.ts` is the sole source of the displayed app version. Adding a newest
English/Polish changelog entry is the release bump; the Gradle snapshot version is unrelated.

## Testing and Verification

Use Kotlin Test/Ktor Test Host, Vitest with Testing Library, and Playwright for cross-stack
journeys. Add focused regression coverage for behavioral changes. Backend tests boot PostgreSQL
through Testcontainers, apply every Flyway migration, and include seeded data; use unique markers
instead of asserting global counts.

Every `/api/` interaction made through the shared backend test clients is checked against OpenAPI.
Prefer `jsonClient()`/`authedClient()` so tests do not bypass conformance validation. `check`
enforces Kover floors of 90% lines and 69% branches. Frontend coverage floors in
`web/vite.config.ts` are 93% lines, 91% statements, 88% functions, and 84% branches. Any test-local
Mantine provider must set `env="test"` so popovers and selects work under happy-dom.

For nontrivial cross-stack behavior, verify through the SPA using the workflow in
`.claude/skills/verify/SKILL.md`, and clean up any records created in the development database.

## Commit, Documentation, and Security

Use Conventional Commit subjects such as `feat:`, `fix:`, `fix(e2e):`, and `docs:`. PRs should
explain behavior and risk, list verification commands, link issues, and include screenshots for UI
changes. Keep migrations, API contract, generated schema, tests, changelog, and both translations
synchronized when applicable.

Never commit production JWT, encryption, SMTP, or database secrets. Committed `changeme` values
and development keys are burned demo credentials; production mode deliberately refuses them.
Field-encryption key changes require the documented rotation procedure, because losing the active
and fallback keys makes encrypted content unrecoverable.
