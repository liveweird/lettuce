package ch.nokillswit.perf

import java.net.URI

/** Where a database URL points — host, port and database name only (never userinfo or query parameters). */
data class DbTarget(val host: String, val port: Int, val database: String) {
    override fun toString() = "$host:$port/$database"
}

/** The perf compose stack's published Postgres port (`perf/docker-compose.perf.yaml`). */
const val PERF_POSTGRES_PORT = 15432

private const val POSTGRES_DEFAULT_PORT = 5432
private val LOOPBACK = setOf("127.0.0.1", "localhost", "::1", "[::1]")

/**
 * Parses a `jdbc:postgresql://…` or `r2dbc[:pool]:postgresql://…` URL into its [DbTarget]: implicit port
 * 5432, an absent path is the empty database name, query strings and userinfo are ignored (and never echoed).
 * A URL without an explicit host (`jdbc:postgresql:db`, `jdbc:postgresql:///db`) is rejected — it would mean
 * "whatever the driver defaults to", which is exactly what a guard must not guess.
 */
fun parseDbTarget(url: String): DbTarget {
    val stripped = url.trim().removePrefix("jdbc:").removePrefix("r2dbc:").removePrefix("pool:")
    require(stripped.startsWith("postgresql://")) { "Not a PostgreSQL URL: ${stripped.substringBefore('?').take(40)}" }
    val uri = runCatching { URI(stripped) }.getOrNull()
    val host = uri?.host?.lowercase()
    require(!host.isNullOrBlank()) { "The database URL must name its host explicitly" }
    return DbTarget(host, if (uri.port == -1) POSTGRES_DEFAULT_PORT else uri.port, uri.path.orEmpty().removePrefix("/"))
}

/**
 * The generator's target guard — runs BEFORE Flyway or any connection. Always (even with `force`): the JDBC
 * and R2DBC URLs must name the same host, port and database; port 5432 (the dev stack's database) is refused;
 * and the target must be either a loopback host on the perf port ([PERF_POSTGRES_PORT]) or listed in
 * [SeedConfig.allowedTargets] (`host:port` — the smoke test's Testcontainer, or a second perf Postgres via
 * `-Pperf.allowTarget=`). `force` skips only the occupancy check ([guardTarget] in `SeedMain.kt`), never this.
 * A perf-seeded database holds well-known accounts (the shared `perf-pass-2026` hash) and must never be
 * reachable from a production-mode app — hence the loopback-only rule.
 */
fun validateSeedTarget(config: SeedConfig) {
    val jdbc = parseDbTarget(config.jdbcUrl)
    val r2dbc = parseDbTarget(config.r2dbcUrl)
    require(jdbc == r2dbc) { "The JDBC target ($jdbc) and the R2DBC target ($r2dbc) must be the same database" }
    require(jdbc.port != POSTGRES_DEFAULT_PORT) {
        "Refusing to seed $jdbc: port 5432 is the dev stack's database. Seed the perf stack " +
            "(perf/run.sh up postgres, port $PERF_POSTGRES_PORT)."
    }
    val allowed = (jdbc.host in LOOPBACK && jdbc.port == PERF_POSTGRES_PORT) || "${jdbc.host}:${jdbc.port}" in config.allowedTargets
    require(allowed) {
        "Refusing to seed $jdbc: only a loopback host on port $PERF_POSTGRES_PORT (the perf stack) is allowed; " +
            "pass -Pperf.allowTarget=host:port to name another throwaway Postgres."
    }
}
