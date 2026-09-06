package ch.nokillswit

import org.testcontainers.postgresql.PostgreSQLContainer
import org.testcontainers.utility.DockerImageName

object PostgresTestSupport {
    private val container: PostgreSQLContainer by lazy {
        // Keep this digest aligned with Compose and Kubernetes.
        // Testcontainers requires explicit compatibility for tag-plus-digest references.
        PostgreSQLContainer(
            DockerImageName.parse(
                "postgres:18.4-alpine3.24@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15"
            ).asCompatibleSubstituteFor("postgres")
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
