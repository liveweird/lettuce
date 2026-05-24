package ch.nokillswit

import org.testcontainers.containers.PostgreSQLContainer

object PostgresTestSupport {
    private val container: PostgreSQLContainer<*> by lazy {
        PostgreSQLContainer("postgres:17-alpine").apply {
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
