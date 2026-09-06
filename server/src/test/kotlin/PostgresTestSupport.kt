package ch.nokillswit

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
}
