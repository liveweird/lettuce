package ch.nokillswit

import org.flywaydb.core.Flyway
import org.testcontainers.postgresql.PostgreSQLContainer

object PostgresTestSupport {
    private val container: PostgreSQLContainer by lazy {
        // Keep this digest aligned with Compose and Kubernetes.
        // PostgreSQL 18.4 Alpine 3.24; Testcontainers requires the digest-only form.
        PostgreSQLContainer(
            "postgres@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15"
        ).apply {
            withDatabaseName("lettuce_test")
            withUsername("lettuce")
            withPassword("lettuce")
            start()
            Runtime.getRuntime().addShutdownHook(Thread { stop() })
        }
    }

    val jdbcUrl: String get() = container.jdbcUrl
    val user: String get() = container.username
    val password: String get() = container.password
    val r2dbcUrl: String
        get() = "r2dbc:postgresql://${container.host}:${container.firstMappedPort}/${container.databaseName}"

    // Most tests boot a real Application (whose configureFlyway module migrates the schema)
    // well before touching the database directly. A few — TestServices/TestUsers/TestBlocklist
    // and the pure store tests riding TestServices.database (V81) — read/write tables via a raw
    // R2dbcDatabase.connect with no app in the loop. Test-class execution order across one
    // `gradle test` JVM is NOT guaranteed (observed: a store test running before any
    // testApplication in a `--tests`-filtered subset), so relying on "some other class already
    // migrated it" is fragile. This lazy val runs Flyway once per JVM, idempotently (Flyway's
    // own schema_history no-ops a repeat migrate — the "container runs all migrations"
    // precedent), the moment ANY direct-DB accessor is first touched.
    private val migrationsApplied: Unit by lazy {
        Flyway.configure()
            .dataSource(jdbcUrl, user, password)
            .locations("classpath:db/migration")
            .load()
            .migrate()
        Unit
    }

    /** Ensures the schema is migrated before a caller connects directly (bypassing a booted
     *  Application's own `configureFlyway`). Safe to call any number of times. */
    fun ensureMigrated() {
        migrationsApplied
    }
}
