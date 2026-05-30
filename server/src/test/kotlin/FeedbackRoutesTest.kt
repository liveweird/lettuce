package ch.nokillswit

import ch.nokillswit.auth.LoginRequest
import ch.nokillswit.auth.LoginResponse
import ch.nokillswit.feedbacks.Feedback
import ch.nokillswit.feedbacks.FeedbackResponse
import ch.nokillswit.feedbacks.FeedbackStatus
import ch.nokillswit.feedbacks.FeedbackVisibility
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.plugins.DefaultRequest
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.request
import io.ktor.client.request.setBody
import io.ktor.serialization.kotlinx.json.json
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class FeedbackRoutesTest {

    private fun uniqueEmail(prefix: String) = "$prefix-${UUID.randomUUID()}@test"

    private suspend fun ApplicationTestBuilder.authedClient(email: String, password: String): HttpClient {
        val client = jsonClient()
        val token = client.post("/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(email, password))
        }.body<LoginResponse>().token
        return createClient {
            install(ContentNegotiation) { json() }
            install(DefaultRequest) {
                header(HttpHeaders.Authorization, "Bearer $token")
            }
        }
    }

    private suspend fun seedTriad(): Triad {
        val providerEmail = uniqueEmail("provider")
        val providerId = TestUsers.seed(email = providerEmail, password = "pw")
        val subjectId = TestUsers.seed(email = uniqueEmail("subject"), password = "pw")
        val requesterId = TestUsers.seed(email = uniqueEmail("requester"), password = "pw")
        return Triad(providerEmail, providerId, subjectId, requesterId)
    }

    private data class Triad(
        val providerEmail: String,
        val providerId: UInt,
        val subjectId: UInt,
        val requesterId: UInt,
    )

    @Test
    fun `create draft + read round-trip`() = testApplication {
        usePostgresTestcontainer()
        val t = seedTriad()
        val client = authedClient(t.providerEmail, "pw")

        val payload = Feedback(
            requesterId = null,
            subjectId = t.subjectId,
            providerId = t.providerId,
            visibility = FeedbackVisibility.PROVIDER_SUBJECT,
            status = FeedbackStatus.DRAFT,
            content = "Initial thoughts",
        )
        val createResponse = client.post("/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(payload)
        }
        assertEquals(HttpStatusCode.Created, createResponse.status)
        val created = createResponse.body<FeedbackResponse>()
        assertEquals(t.subjectId, created.subjectId)
        assertEquals(t.providerId, created.providerId)
        assertNull(created.requesterId)
        assertEquals(FeedbackStatus.DRAFT, created.status)
        assertEquals(FeedbackVisibility.PROVIDER_SUBJECT, created.visibility)
        assertEquals("Initial thoughts", created.content)
        val location = createResponse.headers[HttpHeaders.Location]
        assertNotNull(location)
        assertTrue(location.endsWith("/feedbacks/${created.id}"), "Location was $location")

        val readResponse = client.get("/feedbacks/${created.id}")
        assertEquals(HttpStatusCode.OK, readResponse.status)
        assertEquals(created, readResponse.body<FeedbackResponse>())
    }

    @Test
    fun `create requested with requester`() = testApplication {
        usePostgresTestcontainer()
        val t = seedTriad()
        val client = authedClient(t.providerEmail, "pw")

        val response = client.post("/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                Feedback(
                    requesterId = t.requesterId,
                    subjectId = t.subjectId,
                    providerId = t.providerId,
                    visibility = FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT,
                    status = FeedbackStatus.REQUESTED,
                )
            )
        }
        assertEquals(HttpStatusCode.Created, response.status)
        val body = response.body<FeedbackResponse>()
        assertEquals(t.requesterId, body.requesterId)
        assertEquals(FeedbackStatus.REQUESTED, body.status)
    }

    @Test
    fun `requested without requester is rejected`() = testApplication {
        usePostgresTestcontainer()
        val t = seedTriad()
        val client = authedClient(t.providerEmail, "pw")

        val response = client.post("/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                Feedback(
                    requesterId = null,
                    subjectId = t.subjectId,
                    providerId = t.providerId,
                    visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                    status = FeedbackStatus.REQUESTED,
                )
            )
        }
        assertEquals(HttpStatusCode.BadRequest, response.status)
    }

    @Test
    fun `provider equals subject is rejected`() = testApplication {
        usePostgresTestcontainer()
        val t = seedTriad()
        val client = authedClient(t.providerEmail, "pw")

        val response = client.post("/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                Feedback(
                    subjectId = t.providerId,
                    providerId = t.providerId,
                    visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                    status = FeedbackStatus.DRAFT,
                )
            )
        }
        assertEquals(HttpStatusCode.BadRequest, response.status)
    }

    @Test
    fun `requester equals provider is rejected`() = testApplication {
        usePostgresTestcontainer()
        val t = seedTriad()
        val client = authedClient(t.providerEmail, "pw")

        val response = client.post("/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                Feedback(
                    requesterId = t.providerId,
                    subjectId = t.subjectId,
                    providerId = t.providerId,
                    visibility = FeedbackVisibility.PROVIDER_REQUESTER,
                    status = FeedbackStatus.REQUESTED,
                )
            )
        }
        assertEquals(HttpStatusCode.BadRequest, response.status)
    }

    @Test
    fun `unknown user id is rejected`() = testApplication {
        usePostgresTestcontainer()
        val t = seedTriad()
        val client = authedClient(t.providerEmail, "pw")

        val response = client.post("/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                Feedback(
                    subjectId = 999_999u,
                    providerId = t.providerId,
                    visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                    status = FeedbackStatus.DRAFT,
                )
            )
        }
        assertEquals(HttpStatusCode.BadRequest, response.status)
    }

    @Test
    fun `transition draft to sent`() = testApplication {
        usePostgresTestcontainer()
        val t = seedTriad()
        val client = authedClient(t.providerEmail, "pw")

        val draft = Feedback(
            subjectId = t.subjectId,
            providerId = t.providerId,
            visibility = FeedbackVisibility.PROVIDER_SUBJECT,
            status = FeedbackStatus.DRAFT,
            content = "Notes",
        )
        val created = client.post("/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(draft)
        }.body<FeedbackResponse>()

        val putResponse = client.put("/feedbacks/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(draft.copy(status = FeedbackStatus.SENT))
        }
        assertEquals(HttpStatusCode.NoContent, putResponse.status)
        val after = client.get("/feedbacks/${created.id}").body<FeedbackResponse>()
        assertEquals(FeedbackStatus.SENT, after.status)
    }

    @Test
    fun `invalid transition sent to draft is rejected`() = testApplication {
        usePostgresTestcontainer()
        val t = seedTriad()
        val client = authedClient(t.providerEmail, "pw")

        val draft = Feedback(
            subjectId = t.subjectId,
            providerId = t.providerId,
            visibility = FeedbackVisibility.PROVIDER_SUBJECT,
            status = FeedbackStatus.DRAFT,
        )
        val created = client.post("/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(draft)
        }.body<FeedbackResponse>()

        client.put("/feedbacks/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(draft.copy(status = FeedbackStatus.SENT))
        }

        val response = client.put("/feedbacks/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(draft.copy(status = FeedbackStatus.DRAFT))
        }
        assertEquals(HttpStatusCode.BadRequest, response.status)
        val after = client.get("/feedbacks/${created.id}").body<FeedbackResponse>()
        assertEquals(FeedbackStatus.SENT, after.status)
    }

    @Test
    fun `withdrawn is terminal`() = testApplication {
        usePostgresTestcontainer()
        val t = seedTriad()
        val client = authedClient(t.providerEmail, "pw")

        val draft = Feedback(
            subjectId = t.subjectId,
            providerId = t.providerId,
            visibility = FeedbackVisibility.PROVIDER_SUBJECT,
            status = FeedbackStatus.DRAFT,
        )
        val created = client.post("/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(draft)
        }.body<FeedbackResponse>()

        client.put("/feedbacks/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(draft.copy(status = FeedbackStatus.WITHDRAWN))
        }

        for (target in listOf(FeedbackStatus.DRAFT, FeedbackStatus.SENT, FeedbackStatus.REQUESTED)) {
            val attempt = client.put("/feedbacks/${created.id}") {
                contentType(ContentType.Application.Json)
                setBody(
                    draft.copy(
                        status = target,
                        requesterId = if (target == FeedbackStatus.REQUESTED) t.requesterId else null,
                    )
                )
            }
            assertEquals(HttpStatusCode.BadRequest, attempt.status, "Withdrawn -> $target should be rejected")
        }
    }

    @Test
    fun `content and visibility editable without status change`() = testApplication {
        usePostgresTestcontainer()
        val t = seedTriad()
        val client = authedClient(t.providerEmail, "pw")

        val draft = Feedback(
            subjectId = t.subjectId,
            providerId = t.providerId,
            visibility = FeedbackVisibility.PROVIDER_SUBJECT,
            status = FeedbackStatus.DRAFT,
            content = "v1",
        )
        val created = client.post("/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(draft)
        }.body<FeedbackResponse>()

        val putResponse = client.put("/feedbacks/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(draft.copy(content = "v2", visibility = FeedbackVisibility.PUBLIC))
        }
        assertEquals(HttpStatusCode.NoContent, putResponse.status)

        val after = client.get("/feedbacks/${created.id}").body<FeedbackResponse>()
        assertEquals("v2", after.content)
        assertEquals(FeedbackVisibility.PUBLIC, after.visibility)
        assertEquals(FeedbackStatus.DRAFT, after.status)
    }

    @Test
    fun `delete removes the feedback and subsequent GET returns 404`() = testApplication {
        usePostgresTestcontainer()
        val t = seedTriad()
        val client = authedClient(t.providerEmail, "pw")

        val created = client.post("/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                Feedback(
                    subjectId = t.subjectId,
                    providerId = t.providerId,
                    visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                    status = FeedbackStatus.DRAFT,
                )
            )
        }.body<FeedbackResponse>()

        assertEquals(HttpStatusCode.NoContent, client.delete("/feedbacks/${created.id}").status)
        assertEquals(HttpStatusCode.NotFound, client.get("/feedbacks/${created.id}").status)
    }

    @Test
    fun `get for nonexistent feedback returns 404`() = testApplication {
        usePostgresTestcontainer()
        val t = seedTriad()
        val client = authedClient(t.providerEmail, "pw")
        assertEquals(HttpStatusCode.NotFound, client.get("/feedbacks/999999").status)
    }

    @Test
    fun `feedback endpoints require authentication`() = testApplication {
        usePostgresTestcontainer()
        val client = jsonClient()
        val endpoints = listOf(
            HttpMethod.Post to "/feedbacks",
            HttpMethod.Get to "/feedbacks/1",
            HttpMethod.Put to "/feedbacks/1",
            HttpMethod.Delete to "/feedbacks/1",
        )
        for ((verb, path) in endpoints) {
            val response = client.request(path) { method = verb }
            assertEquals(
                HttpStatusCode.Unauthorized,
                response.status,
                "$verb $path expected 401, got ${response.status}",
            )
        }
    }

    @Test
    fun `deleting subject user while feedback exists is rejected`() = testApplication {
        usePostgresTestcontainer()
        val t = seedTriad()
        val client = authedClient(t.providerEmail, "pw")

        val created = client.post("/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                Feedback(
                    subjectId = t.subjectId,
                    providerId = t.providerId,
                    visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                    status = FeedbackStatus.DRAFT,
                )
            )
        }.body<FeedbackResponse>()

        val blocked = client.delete("/users/${t.subjectId}")
        assertNotEquals(HttpStatusCode.NoContent, blocked.status)

        assertEquals(HttpStatusCode.NoContent, client.delete("/feedbacks/${created.id}").status)
        assertEquals(HttpStatusCode.NoContent, client.delete("/users/${t.subjectId}").status)
    }

    @Test
    fun `deleting requester user nullifies requester_id`() = testApplication {
        usePostgresTestcontainer()
        val t = seedTriad()
        val client = authedClient(t.providerEmail, "pw")

        val created = client.post("/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                Feedback(
                    requesterId = t.requesterId,
                    subjectId = t.subjectId,
                    providerId = t.providerId,
                    visibility = FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT,
                    status = FeedbackStatus.REQUESTED,
                )
            )
        }.body<FeedbackResponse>()

        assertEquals(HttpStatusCode.NoContent, client.delete("/users/${t.requesterId}").status)
        val after = client.get("/feedbacks/${created.id}").body<FeedbackResponse>()
        assertNull(after.requesterId)
        assertEquals(t.subjectId, after.subjectId)
        assertEquals(t.providerId, after.providerId)
    }
}
