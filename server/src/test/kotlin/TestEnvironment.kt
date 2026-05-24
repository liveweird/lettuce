package ch.nokillswit

import ch.nokillswit.auth.hashPassword
import ch.nokillswit.users.User
import ch.nokillswit.users.UserService
import io.ktor.client.HttpClient
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.config.ApplicationConfig
import io.ktor.server.config.MapApplicationConfig
import io.ktor.server.config.mergeWith
import io.ktor.server.testing.ApplicationTestBuilder
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase

suspend fun ApplicationTestBuilder.usePostgresTestcontainer() {
    environment {
        config = ApplicationConfig("application.yaml").mergeWith(
            MapApplicationConfig(
                "postgres.jdbcUrl" to PostgresTestSupport.jdbcUrl,
                "postgres.r2dbcUrl" to PostgresTestSupport.r2dbcUrl,
                "postgres.user" to PostgresTestSupport.user,
                "postgres.password" to PostgresTestSupport.password,
                "security.csrf.enabled" to "false",
            )
        )
    }
    startApplication()
}

fun ApplicationTestBuilder.jsonClient(): HttpClient = createClient {
    install(ContentNegotiation) { json() }
}

object TestUsers {
    private val service: UserService by lazy {
        UserService(
            R2dbcDatabase.connect(
                url = PostgresTestSupport.r2dbcUrl,
                user = PostgresTestSupport.user,
                password = PostgresTestSupport.password,
            )
        )
    }

    suspend fun seed(
        email: String,
        password: String,
        name: String = "Test",
        age: Int = 30,
    ): UInt = service.create(
        User(name = name, age = age, email = email, passwordHash = hashPassword(password, cost = 4))
    )
}
