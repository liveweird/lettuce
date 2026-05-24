package ch.nokillswit

import at.favre.lib.crypto.bcrypt.BCrypt
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
    private val service: ExposedUserService by lazy {
        ExposedUserService(
            R2dbcDatabase.connect(
                url = PostgresTestSupport.r2dbcUrl,
                user = PostgresTestSupport.user,
                password = PostgresTestSupport.password,
            )
        )
    }

    fun hash(plain: String): String = BCrypt.withDefaults().hashToString(4, plain.toCharArray())

    suspend fun seed(
        email: String,
        password: String,
        name: String = "Test",
        age: Int = 30,
    ): UInt = service.create(
        ExposedUser(name = name, age = age, email = email, passwordHash = hash(password))
    )
}
