# Repository Guidelines

## Project Structure & Module Organization

This repository contains a Kotlin/Gradle backend and React frontend. `server/src/main/kotlin/` holds Ktor features, infrastructure, and plugins; migrations and the OpenAPI contract live under `server/src/main/resources/`. Shared Kotlin code belongs in `core/src/`. The Vite/React application is in `web/src/`, organized into `pages/`, `components/`, `api/`, `hooks/`, and localized resources under `locales/`. Backend tests are in `server/src/test/kotlin/`, colocated frontend tests use `*.test.ts(x)`, and browser tests are in `e2e/tests/*.spec.ts`.

## Build, Test, and Development Commands

- `docker compose up --build`: build and run PostgreSQL, the API, and the SPA at `http://localhost:8080`.
- `docker compose up postgres`: run the development database.
- `./gradlew build`: compile and verify Gradle modules (JDK 21).
- `./gradlew :server:run`: start Ktor on port 8080.
- `./gradlew test`: run Kotlin tests; a Docker daemon is required for Testcontainers.
- `cd web && npm run dev`: start Vite on port 5173, proxying `/api` to Ktor.
- `cd web && npm run build && npm run lint && npm test`: type-check, bundle, lint, and run Vitest.
- `cd e2e && npm test`: run Playwright against the full stack.

Package deployments with `./gradlew :server:installDist`; do not use `buildFatJar`, which breaks Flyway service discovery.

## Coding Style & Naming Conventions

Use four-space indentation for Kotlin and two spaces for TypeScript/TSX. Follow existing Kotlin package boundaries and name Ktor wiring functions `configureXxx`. Use PascalCase for React components and Kotlin types, camelCase for functions and variables, and `V<number>__description.sql` for Flyway migrations. ESLint enforces frontend rules; TypeScript is configured with strict unused-code checks. Regenerate `web/src/api/schema.ts` with `npm run gen:api` after OpenAPI changes. API design (URLs, pagination, errors, status codes, naming) follows the authoritative rulebook in `api-guidelines/API-GUIDELINES.md` — lint spec changes with its Spectral ruleset.

## Testing Guidelines

Use Kotlin Test/Ktor Test Host, Vitest with Testing Library, and Playwright for cross-stack journeys. Name backend classes `*Test`, frontend tests `*.test.tsx`, and E2E specs `*.spec.ts`. Add focused regression coverage with behavioral changes. `check` enforces server coverage floors of 90% lines and 68% branches; `npm run test:coverage` enforces frontend thresholds.

## Commit & Pull Request Guidelines

History follows Conventional Commit prefixes such as `feat:`, `fix:`, `fix(e2e):`, and `docs:`; keep subjects imperative and scoped. PRs should explain behavior and risk, list verification commands, link relevant issues, and include screenshots for visible UI changes. Keep API, migrations, generated schema, tests, and both English and Polish translations synchronized when applicable.

## Security & Configuration

Never commit production JWT, encryption, or database secrets. Defaults and seeded `changeme` credentials are development-only. Add schema changes through Flyway migrations rather than runtime DDL.
