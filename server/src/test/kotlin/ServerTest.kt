package ch.nokillswit

import io.ktor.client.request.get
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import kotlin.test.*

class ServerTest {

    @Test
    fun `unauthenticated API request returns a 401 problem+json body`() = testApplication {
        usePostgresTestcontainer()
        val response = client.get("/api/v1/users")
        assertEquals(HttpStatusCode.Unauthorized, response.status)
        assertTrue(
            response.headers["Content-Type"]?.startsWith("application/problem+json") == true,
            "401 challenge must be RFC 7807 problem+json",
        )
        assertContains(response.bodyAsText(), "\"status\":401")
    }

    @Test
    fun `security headers are set on responses`() = testApplication {
        usePostgresTestcontainer()
        val response = client.get("/api/v1/users")
        assertEquals("nosniff", response.headers["X-Content-Type-Options"])
        assertEquals("DENY", response.headers["X-Frame-Options"])
        assertEquals("no-referrer", response.headers["Referrer-Policy"])
        val csp = response.headers["Content-Security-Policy"]
        assertNotNull(csp, "Content-Security-Policy header should be present")
        assertContains(csp, "default-src 'self'")
        assertContains(csp, "frame-ancestors 'none'")
    }

    @Test
    fun `swagger UI is excluded from the strict CSP but still hardened`() = testApplication {
        usePostgresTestcontainer()
        val response = client.get("/openapi")
        // The strict app CSP must not cover the Swagger UI (it needs inline script/style)...
        assertNull(response.headers["Content-Security-Policy"])
        // ...but the non-CSP hardening headers still apply.
        assertEquals("nosniff", response.headers["X-Content-Type-Options"])
    }

}
