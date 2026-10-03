-- Runs once, on the fresh perf volume only (postgres docker-entrypoint-initdb.d). The library is
-- preloaded by the compose command (shared_preload_libraries); this creates the SQL views.
-- `unaccent` is NOT created here — Flyway's V43 owns it.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
