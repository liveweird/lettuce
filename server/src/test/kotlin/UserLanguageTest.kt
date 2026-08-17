package ch.nokillswit

import ch.nokillswit.plugins.ProblemDetail
import ch.nokillswit.users.UserLanguageUpdateRequest
import ch.nokillswit.users.UserRequest
import ch.nokillswit.users.UserResponse
import ch.nokillswit.users.UserUpdateRequest
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/** PUT /api/v1/users/{id}/language + the create-time assignment — the V61 per-user language. */
class UserLanguageTest {

    private suspend fun io.ktor.client.HttpClient.putLanguage(id: Any, language: String) =
        put("/api/v1/users/$id/language") {
            contentType(ContentType.Application.Json)
            setBody(UserLanguageUpdateRequest(language = language))
        }

    @Test
    fun `self-service change round-trips and defaults to English`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("lang-self")
        val userId = TestUsers.seed(email = email, password = "pw", roles = emptySet())
        val client = authedClient(email, "pw")

        assertEquals("en", client.get("/api/v1/users/$userId").body<UserResponse>().language)

        assertEquals(HttpStatusCode.NoContent, client.putLanguage(userId, "pl").status)
        assertEquals("pl", client.get("/api/v1/users/$userId").body<UserResponse>().language)

        // Idempotent: the same value again is 204, not 409.
        assertEquals(HttpStatusCode.NoContent, client.putLanguage(userId, "pl").status)
    }

    @Test
    fun `admin may change another user, a regular user may not - and 403 wins over 400`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("lang-admin")
        val strangerEmail = uniqueEmail("lang-stranger")
        TestUsers.seed(email = adminEmail, password = "pw")
        TestUsers.seed(email = strangerEmail, password = "pw", roles = emptySet())
        val targetId = TestUsers.seed(email = uniqueEmail("lang-target"), password = "pw", roles = emptySet())

        val stranger = authedClient(strangerEmail, "pw")
        assertEquals(HttpStatusCode.Forbidden, stranger.putLanguage(targetId, "pl").status)
        // An unsupported code from an unauthorized caller is still the uniform 403.
        assertEquals(HttpStatusCode.Forbidden, stranger.putLanguage(targetId, "xx").status)

        assertEquals(HttpStatusCode.NoContent, authedClient(adminEmail, "pw").putLanguage(targetId, "pl").status)
        assertEquals("pl", TestServices.users.read(targetId)!!.language)
    }

    @Test
    fun `an unsupported language code is 400`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("lang-bad")
        val userId = TestUsers.seed(email = email, password = "pw", roles = emptySet())
        val response = authedClient(email, "pw").putLanguage(userId, "xx")
        assertEquals(HttpStatusCode.BadRequest, response.status)
        assertTrue("Unsupported language" in response.body<ProblemDetail>().detail.orEmpty())
    }

    @Test
    fun `unknown and soft-deleted targets are 404`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("lang-404")
        TestUsers.seed(email = adminEmail, password = "pw")
        val deletedId = TestUsers.seed(email = uniqueEmail("lang-deleted"), password = "pw")
        assertEquals(1, TestServices.users.delete(deletedId))
        val client = authedClient(adminEmail, "pw")

        for (id in listOf(999999u, deletedId)) {
            assertEquals(HttpStatusCode.NotFound, client.putLanguage(id, "pl").status, "for id $id")
        }
    }

    @Test
    fun `audited only on an actual change`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("lang-audit")
        val userId = TestUsers.seed(email = email, password = "pw", roles = emptySet())
        val client = authedClient(email, "pw")
        val auditEvents = LogCapture("ch.nokillswit.audit")
        try {
            assertEquals(HttpStatusCode.NoContent, client.putLanguage(userId, "pl").status)
            val event = auditEvents.events.firstOrNull { it.message == "user.language_changed" }
            assertNotNull(event, "the change must be audited")
            assertTrue(
                event.keyValuePairs.orEmpty().any { it.key == "from" && it.value == "en" } &&
                    event.keyValuePairs.orEmpty().any { it.key == "to" && it.value == "pl" },
                "the audit event must carry the from/to delta",
            )

            assertEquals(HttpStatusCode.NoContent, client.putLanguage(userId, "pl").status)
            assertEquals(
                1,
                auditEvents.events.count { it.message == "user.language_changed" },
                "a same-value re-PUT must not audit again",
            )
        } finally {
            auditEvents.detach()
        }
    }

    @Test
    fun `a deactivated target may still be changed — the setting is inert until reactivation`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("lang-deact-admin")
        TestUsers.seed(email = adminEmail, password = "pw")
        val targetId = TestUsers.seed(email = uniqueEmail("lang-deact"), password = "pw", roles = emptySet())
        assertEquals(1, TestServices.users.setDeactivated(targetId, true))

        assertEquals(HttpStatusCode.NoContent, authedClient(adminEmail, "pw").putLanguage(targetId, "pl").status)
        assertEquals("pl", TestServices.users.read(targetId)!!.language)
    }

    @Test
    fun `unauthenticated is 401`() = testApplication {
        usePostgresTestcontainer()
        assertEquals(HttpStatusCode.Unauthorized, jsonClient().putLanguage(1, "pl").status)
    }

    @Test
    fun `create accepts a language, defaults to English, and rejects unknown codes`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("lang-create-admin")
        TestUsers.seed(email = adminEmail, password = "pw")
        val client = authedClient(adminEmail, "pw")

        val plUser = client.post("/api/v1/users") {
            contentType(ContentType.Application.Json)
            setBody(
                UserRequest(
                    name = "Lang PL",
                    email = uniqueEmail("lang-create-pl"),
                    password = "longenough1",
                    language = "pl",
                ),
            )
        }
        assertEquals(HttpStatusCode.Created, plUser.status)
        assertEquals("pl", plUser.body<UserResponse>().language)

        val defaulted = client.post("/api/v1/users") {
            contentType(ContentType.Application.Json)
            setBody(
                UserRequest(
                    name = "Lang Default",
                    email = uniqueEmail("lang-create-def"),
                    password = "longenough1",
                ),
            )
        }
        assertEquals(HttpStatusCode.Created, defaulted.status)
        assertEquals("en", defaulted.body<UserResponse>().language)

        val rejected = client.post("/api/v1/users") {
            contentType(ContentType.Application.Json)
            setBody(
                UserRequest(
                    name = "Lang Bad",
                    email = uniqueEmail("lang-create-bad"),
                    password = "longenough1",
                    language = "xx",
                ),
            )
        }
        assertEquals(HttpStatusCode.BadRequest, rejected.status)
    }

    @Test
    fun `the whole-user PUT leaves the language unchanged`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("lang-put-admin")
        TestUsers.seed(email = adminEmail, password = "pw")
        val targetId = TestUsers.seed(
            email = uniqueEmail("lang-put-target"),
            password = "pw",
            roles = emptySet(),
            language = "pl",
        )
        val client = authedClient(adminEmail, "pw")

        val put = client.put("/api/v1/users/$targetId") {
            contentType(ContentType.Application.Json)
            setBody(UserUpdateRequest(name = "Renamed", email = uniqueEmail("lang-put-renamed"), roles = emptyList()))
        }
        assertEquals(HttpStatusCode.NoContent, put.status)
        assertEquals("pl", TestServices.users.read(targetId)!!.language)
    }
}
