package ch.nokillswit

import io.ktor.client.request.get
import io.ktor.http.HttpStatusCode
import io.ktor.server.config.ApplicationConfig
import io.ktor.server.config.MapApplicationConfig
import io.ktor.server.config.mergeWith
import io.ktor.server.testing.testApplication
import kotlin.test.*

class ServerTest {

    @Test
    fun `test root endpoint`() = testApplication {
        environment {
            config = ApplicationConfig("application.yaml").mergeWith(
                MapApplicationConfig(
                    "postgres.jdbcUrl" to PostgresTestSupport.jdbcUrl,
                    "postgres.r2dbcUrl" to PostgresTestSupport.r2dbcUrl,
                    "postgres.user" to PostgresTestSupport.user,
                    "postgres.password" to PostgresTestSupport.password,
                )
            )
        }
        assertEquals(HttpStatusCode.OK, client.get("/").status)
    }

}
