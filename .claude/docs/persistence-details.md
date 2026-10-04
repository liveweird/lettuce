### Persistence details

The on-demand companion of `.claude/docs/persistence.md` (always loaded).

### A hung database is bounded (v4.7.1)

The driver has NO socket read timeout, so a database that
accepts or holds connections but never answers used to hang requests and `/readyz` forever (an
in-process `withTimeout` cannot cancel the R2DBC handshake — tried and dropped in v4.5.2). The
bounds, all boot-validated:

- **every acquire validates with a round trip** (`ValidationDepth.REMOTE`), bounded by
  `maxValidationTimeSeconds` (`POSTGRES_POOL_MAX_VALIDATION_SECONDS`, default 5, 1..60) — a frozen
  or server-killed connection is discarded instead of handed out (this closed the pre-v4.7.1
  exception where a backend killed server-side was handed out once and failed its request
  with a 500 — for a SINGLE dropped connection: each acquire gets two validation attempts
  (r2dbc-pool's `acquireRetry` default 1, MRU idle order), so after a PostgreSQL restart, when
  every idle connection dies at once, a request whose two picks are both dead still fails fast
  until the pool has refreshed). Cost: one `SELECT 1` round trip per `suspendTransaction`
  (measured 2026-09-30 on the compose stack: +0.3 ms mean / +0.7 ms p95 per request); Exposed's
  per-statement `SET STATEMENT_TIMEOUT` round trip existed before (with 0) and is unchanged;
- **creating a connection** (TCP + startup/auth) is bounded by `maxCreateConnectionTimeSeconds`
  (`POSTGRES_POOL_MAX_CREATE_SECONDS`, default 10, 1..600); the TCP connect alone by
  `postgres.connectTimeoutSeconds` (`POSTGRES_CONNECT_TIMEOUT_SECONDS`, default 10); TCP keepalive on;
- **PostgreSQL's `statement_timeout`** = `postgres.statementTimeoutSeconds`
  (`POSTGRES_STATEMENT_TIMEOUT_SECONDS`, default 30, 0 = off, 0..3600) cancels a statement a LIVE
  but stuck server runs too long. It is set through **Exposed's `defaultQueryTimeout`**, NOT a driver
  option: Exposed's statement executor calls `connection.setStatementTimeout(queryTimeout)` before
  every statement from that default (0), silently overwriting any driver startup option or
  post-allocate `SET` — `ConnectionPoolTest` asserts the value the server reports.

Together a request waits at most about **2 × `maxAcquireTime`** for a hung database (~20 s by
default — r2dbc-pool retries a timed-out acquire once), then fails with the catch-all 500
(`/readyz` answers 503); a cancelled statement (SQLSTATE 57014) is a generic R2dbcException →
the same logged 500, with the transaction rolled back. **Still unbounded:** a query ALREADY in flight when the
network black-holes waits until TCP gives up. Pinned by `ConnectionPoolTest` through
`FreezableRelay` (a TCP relay in front of the Testcontainer that goes silent on demand).
