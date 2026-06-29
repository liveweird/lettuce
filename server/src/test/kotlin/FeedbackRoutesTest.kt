package ch.nokillswit

import ch.nokillswit.auth.LoginRequest
import ch.nokillswit.auth.LoginResponse
import ch.nokillswit.feedbacks.Feedback
import ch.nokillswit.feedbacks.FeedbackPageResponse
import ch.nokillswit.feedbacks.FeedbackResponse
import ch.nokillswit.feedbacks.FeedbackStatus
import ch.nokillswit.feedbacks.FeedbackVisibility
import ch.nokillswit.notifications.NotificationPageResponse
import ch.nokillswit.notifications.NotificationResponse
import ch.nokillswit.teams.Team
import ch.nokillswit.teams.TeamResponse
import ch.nokillswit.users.UserRole
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
import kotlinx.coroutines.delay
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class FeedbackRoutesTest {

    private fun uniqueEmail(prefix: String) = "$prefix-${UUID.randomUUID()}@test"

    private suspend fun ApplicationTestBuilder.authedClient(email: String, password: String): HttpClient {
        val client = jsonClient()
        val token = client.post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(email, password))
        }.body<LoginResponse>().token
        return createClient {
            install(ContentNegotiation) { json(); json(contentType = ContentType.parse("application/problem+json")) }
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
        val createResponse = client.post("/api/v1/feedbacks") {
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
        assertTrue(location.endsWith("/api/v1/feedbacks/${created.id}"), "Location was $location")

        val readResponse = client.get("/api/v1/feedbacks/${created.id}")
        assertEquals(HttpStatusCode.OK, readResponse.status)
        assertEquals(created, readResponse.body<FeedbackResponse>())
    }

    @Test
    fun `read resolves party display names`() = testApplication {
        usePostgresTestcontainer()
        val providerEmail = uniqueEmail("provider")
        val providerId = TestUsers.seed(email = providerEmail, password = "pw", name = "Paula Provider")
        val subjectId = TestUsers.seed(email = uniqueEmail("subject"), password = "pw", name = "Sam Subject")
        val requesterId = TestUsers.seed(email = uniqueEmail("requester"), password = "pw", name = "Rita Requester")
        val client = authedClient(providerEmail, "pw")

        val withRequester = client.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                Feedback(
                    requesterId = requesterId,
                    subjectId = subjectId,
                    providerId = providerId,
                    visibility = FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT,
                    status = FeedbackStatus.REQUESTED,
                )
            )
        }.body<FeedbackResponse>()

        // The create response is already enriched with names.
        assertEquals("Paula Provider", withRequester.providerName)
        assertEquals("Sam Subject", withRequester.subjectName)
        assertEquals("Rita Requester", withRequester.requesterName)

        val read = client.get("/api/v1/feedbacks/${withRequester.id}").body<FeedbackResponse>()
        assertEquals("Paula Provider", read.providerName)
        assertEquals("Sam Subject", read.subjectName)
        assertEquals("Rita Requester", read.requesterName)

        // No requester → requesterName is null, the others still resolve.
        val noRequester = client.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                Feedback(
                    subjectId = subjectId,
                    providerId = providerId,
                    visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                    status = FeedbackStatus.DRAFT,
                )
            )
        }.body<FeedbackResponse>()
        val readNoRequester = client.get("/api/v1/feedbacks/${noRequester.id}").body<FeedbackResponse>()
        assertNull(readNoRequester.requesterName)
        assertEquals("Sam Subject", readNoRequester.subjectName)
        assertEquals("Paula Provider", readNoRequester.providerName)
    }

    @Test
    fun `create requested with requester`() = testApplication {
        usePostgresTestcontainer()
        val t = seedTriad()
        val client = authedClient(t.providerEmail, "pw")

        val response = client.post("/api/v1/feedbacks") {
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
    fun `create with sent status succeeds`() = testApplication {
        usePostgresTestcontainer()
        val t = seedTriad()
        val client = authedClient(t.providerEmail, "pw")

        // "Save & send" creates the feedback directly as SENT; the transition restriction
        // only applies on update, so this must be accepted on create.
        val response = client.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                Feedback(
                    requesterId = null,
                    subjectId = t.subjectId,
                    providerId = t.providerId,
                    visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                    status = FeedbackStatus.SENT,
                    content = "Shipping this feedback",
                )
            )
        }
        assertEquals(HttpStatusCode.Created, response.status)
        val body = response.body<FeedbackResponse>()
        assertEquals(FeedbackStatus.SENT, body.status)
        assertNull(body.requesterId)
    }

    @Test
    fun `requested without requester is rejected`() = testApplication {
        usePostgresTestcontainer()
        val t = seedTriad()
        val client = authedClient(t.providerEmail, "pw")

        val response = client.post("/api/v1/feedbacks") {
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

        val response = client.post("/api/v1/feedbacks") {
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

        val response = client.post("/api/v1/feedbacks") {
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
    fun `requester with PROVIDER_SUBJECT visibility is rejected`() = testApplication {
        usePostgresTestcontainer()
        val t = seedTriad()
        val client = authedClient(t.providerEmail, "pw")

        // On create: a requester is incompatible with PROVIDER_SUBJECT visibility.
        val onCreate = client.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                Feedback(
                    requesterId = t.requesterId,
                    subjectId = t.subjectId,
                    providerId = t.providerId,
                    visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                    status = FeedbackStatus.REQUESTED,
                )
            )
        }
        assertEquals(HttpStatusCode.BadRequest, onCreate.status)

        // On update: a valid feedback cannot be moved into the illegal combination either.
        val created = client.post("/api/v1/feedbacks") {
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
        val onUpdate = client.put("/api/v1/feedbacks/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(
                Feedback(
                    requesterId = t.requesterId,
                    subjectId = t.subjectId,
                    providerId = t.providerId,
                    visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                    status = FeedbackStatus.DRAFT,
                )
            )
        }
        assertEquals(HttpStatusCode.BadRequest, onUpdate.status)
    }

    @Test
    fun `unknown user id is rejected`() = testApplication {
        usePostgresTestcontainer()
        val t = seedTriad()
        val client = authedClient(t.providerEmail, "pw")

        val response = client.post("/api/v1/feedbacks") {
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
        val created = client.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(draft)
        }.body<FeedbackResponse>()

        val putResponse = client.put("/api/v1/feedbacks/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(draft.copy(status = FeedbackStatus.SENT))
        }
        assertEquals(HttpStatusCode.NoContent, putResponse.status)
        val after = client.get("/api/v1/feedbacks/${created.id}").body<FeedbackResponse>()
        assertEquals(FeedbackStatus.SENT, after.status)
    }

    @Test
    fun `update draft edits stay draft`() = testApplication {
        usePostgresTestcontainer()
        val t = seedTriad()
        val client = authedClient(t.providerEmail, "pw")

        val draft = Feedback(
            subjectId = t.subjectId,
            providerId = t.providerId,
            visibility = FeedbackVisibility.PROVIDER_SUBJECT,
            status = FeedbackStatus.DRAFT,
            content = "First pass",
        )
        val created = client.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(draft)
        }.body<FeedbackResponse>()

        // "Save draft" on the edit screen: DRAFT -> DRAFT with changed content/visibility.
        val putResponse = client.put("/api/v1/feedbacks/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(draft.copy(content = "Revised", visibility = FeedbackVisibility.PUBLIC))
        }
        assertEquals(HttpStatusCode.NoContent, putResponse.status)
        val after = client.get("/api/v1/feedbacks/${created.id}").body<FeedbackResponse>()
        assertEquals(FeedbackStatus.DRAFT, after.status)
        assertEquals("Revised", after.content)
        assertEquals(FeedbackVisibility.PUBLIC, after.visibility)
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
        val created = client.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(draft)
        }.body<FeedbackResponse>()

        client.put("/api/v1/feedbacks/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(draft.copy(status = FeedbackStatus.SENT))
        }

        val response = client.put("/api/v1/feedbacks/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(draft.copy(status = FeedbackStatus.DRAFT))
        }
        assertEquals(HttpStatusCode.BadRequest, response.status)
        val after = client.get("/api/v1/feedbacks/${created.id}").body<FeedbackResponse>()
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
        val created = client.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(draft)
        }.body<FeedbackResponse>()

        client.put("/api/v1/feedbacks/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(draft.copy(status = FeedbackStatus.WITHDRAWN))
        }

        for (target in listOf(FeedbackStatus.DRAFT, FeedbackStatus.SENT, FeedbackStatus.REQUESTED)) {
            val attempt = client.put("/api/v1/feedbacks/${created.id}") {
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
    fun `transition requested to rejected`() = testApplication {
        usePostgresTestcontainer()
        val t = seedTriad()
        val client = authedClient(t.providerEmail, "pw")

        val requested = Feedback(
            requesterId = t.requesterId,
            subjectId = t.subjectId,
            providerId = t.providerId,
            visibility = FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT,
            status = FeedbackStatus.REQUESTED,
        )
        val created = client.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(requested)
        }.body<FeedbackResponse>()

        val putResponse = client.put("/api/v1/feedbacks/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(requested.copy(status = FeedbackStatus.REJECTED))
        }
        assertEquals(HttpStatusCode.NoContent, putResponse.status)
        val after = client.get("/api/v1/feedbacks/${created.id}").body<FeedbackResponse>()
        assertEquals(FeedbackStatus.REJECTED, after.status)
    }

    @Test
    fun `rejected is terminal`() = testApplication {
        usePostgresTestcontainer()
        val t = seedTriad()
        val client = authedClient(t.providerEmail, "pw")

        val requested = Feedback(
            requesterId = t.requesterId,
            subjectId = t.subjectId,
            providerId = t.providerId,
            visibility = FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT,
            status = FeedbackStatus.REQUESTED,
        )
        val created = client.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(requested)
        }.body<FeedbackResponse>()

        client.put("/api/v1/feedbacks/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(requested.copy(status = FeedbackStatus.REJECTED))
        }

        for (target in listOf(FeedbackStatus.DRAFT, FeedbackStatus.SENT, FeedbackStatus.WITHDRAWN, FeedbackStatus.REQUESTED)) {
            val attempt = client.put("/api/v1/feedbacks/${created.id}") {
                contentType(ContentType.Application.Json)
                setBody(
                    requested.copy(
                        status = target,
                        requesterId = if (target == FeedbackStatus.REQUESTED) t.requesterId else null,
                    )
                )
            }
            assertEquals(HttpStatusCode.BadRequest, attempt.status, "Rejected -> $target should be rejected")
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
        val created = client.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(draft)
        }.body<FeedbackResponse>()

        val putResponse = client.put("/api/v1/feedbacks/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(draft.copy(content = "v2", visibility = FeedbackVisibility.PUBLIC))
        }
        assertEquals(HttpStatusCode.NoContent, putResponse.status)

        val after = client.get("/api/v1/feedbacks/${created.id}").body<FeedbackResponse>()
        assertEquals("v2", after.content)
        assertEquals(FeedbackVisibility.PUBLIC, after.visibility)
        assertEquals(FeedbackStatus.DRAFT, after.status)
    }

    @Test
    fun `delete removes the feedback and subsequent GET returns 404`() = testApplication {
        usePostgresTestcontainer()
        val t = seedTriad()
        val client = authedClient(t.providerEmail, "pw")

        val created = client.post("/api/v1/feedbacks") {
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

        assertEquals(HttpStatusCode.NoContent, client.delete("/api/v1/feedbacks/${created.id}").status)
        assertEquals(HttpStatusCode.NotFound, client.get("/api/v1/feedbacks/${created.id}").status)
    }

    @Test
    fun `get for nonexistent feedback returns 404`() = testApplication {
        usePostgresTestcontainer()
        val t = seedTriad()
        val client = authedClient(t.providerEmail, "pw")
        assertEquals(HttpStatusCode.NotFound, client.get("/api/v1/feedbacks/999999").status)
    }

    @Test
    fun `feedback endpoints require authentication`() = testApplication {
        usePostgresTestcontainer()
        val client = jsonClient()
        val endpoints = listOf(
            HttpMethod.Post to "/api/v1/feedbacks",
            HttpMethod.Get to "/api/v1/feedbacks",
            HttpMethod.Get to "/api/v1/feedbacks/1",
            HttpMethod.Put to "/api/v1/feedbacks/1",
            HttpMethod.Delete to "/api/v1/feedbacks/1",
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

    // Seeds list/view test data via a lazily-created ADMIN client. An admin may create feedback on
    // behalf of any provider/requester; the create-time party check (no impersonation) is enforced
    // for non-admins and covered in AuthorizationTest. Who seeds doesn't affect the rows under test.
    private var seederClient: HttpClient? = null

    private suspend fun ApplicationTestBuilder.feedbackSeeder(): HttpClient =
        seederClient ?: run {
            val email = uniqueEmail("seeder")
            TestUsers.seed(email = email, password = "pw") // ADMIN by default
            authedClient(email, "pw").also { seederClient = it }
        }

    private suspend fun ApplicationTestBuilder.createFeedback(
        subjectId: UInt,
        providerId: UInt,
        visibility: FeedbackVisibility,
        status: FeedbackStatus = FeedbackStatus.SENT,
        requesterId: UInt? = null,
        content: String = "",
    ): FeedbackResponse = feedbackSeeder().post("/api/v1/feedbacks") {
        contentType(ContentType.Application.Json)
        setBody(
            Feedback(
                requesterId = requesterId,
                subjectId = subjectId,
                providerId = providerId,
                visibility = visibility,
                status = status,
                content = content,
            )
        )
    }.body<FeedbackResponse>()

    @Test
    fun `PUT a non-existent feedback returns 404`() = testApplication {
        usePostgresTestcontainer()
        val admin = uniqueEmail("admin")
        TestUsers.seed(email = admin, password = "pw") // ADMIN by default
        val client = authedClient(admin, "pw")

        val response = client.put("/api/v1/feedbacks/999999") {
            contentType(ContentType.Application.Json)
            setBody(
                Feedback(
                    subjectId = 1u, providerId = 2u,
                    visibility = FeedbackVisibility.PUBLIC, status = FeedbackStatus.SENT,
                )
            )
        }
        assertEquals(HttpStatusCode.NotFound, response.status)
    }

    @Test
    fun `DELETE a non-existent feedback returns 404`() = testApplication {
        usePostgresTestcontainer()
        val admin = uniqueEmail("admin")
        TestUsers.seed(email = admin, password = "pw")
        val client = authedClient(admin, "pw")

        // Deleting a row that does not exist reports 404 (consistent across resources).
        assertEquals(HttpStatusCode.NotFound, client.delete("/api/v1/feedbacks/999999").status)
    }

    @Test
    fun `list received returns only caller-as-subject rows with subject-readable visibilities`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("subject")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", role = UserRole.USER)
        val providerId = TestUsers.seed(email = uniqueEmail("provider"), password = "pw")
        val requesterId = TestUsers.seed(email = uniqueEmail("requester"), password = "pw")
        val otherSubjectId = TestUsers.seed(email = uniqueEmail("other"), password = "pw")
        val client = authedClient(callerEmail, "pw")

        val visible = listOf(
            createFeedback(callerId, providerId, FeedbackVisibility.PUBLIC),
            createFeedback(callerId, providerId, FeedbackVisibility.PROVIDER_SUBJECT),
            createFeedback(callerId, providerId, FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT, requesterId = requesterId),
        )
        // Excluded: subject may not read PROVIDER_REQUESTER; other rows belong to a different subject.
        createFeedback(callerId, providerId, FeedbackVisibility.PROVIDER_REQUESTER, requesterId = requesterId)
        createFeedback(otherSubjectId, providerId, FeedbackVisibility.PUBLIC)

        val response = client.get("/api/v1/feedbacks")
        assertEquals(HttpStatusCode.OK, response.status)
        val page = response.body<FeedbackPageResponse>()
        assertEquals(3, page.total)
        assertEquals(visible.map { it.id }.sorted(), page.items.map { it.id }.sorted())
        assertTrue(page.items.none { it.visibility == FeedbackVisibility.PROVIDER_REQUESTER })
    }

    @Test
    fun `received list shows feedback the subject requested for themselves under any visibility and status`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("subject")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", role = UserRole.USER)
        val providerId = TestUsers.seed(email = uniqueEmail("provider"), password = "pw")
        val client = authedClient(callerEmail, "pw")

        // Self-asked feedback (subject == requester == caller) with a requester-only visibility that
        // is NOT subject-readable; rule B shows it anyway because the caller is the requester.
        val pending = createFeedback(
            callerId, providerId, FeedbackVisibility.PROVIDER_REQUESTER,
            status = FeedbackStatus.REQUESTED, requesterId = callerId, content = "secret",
        )
        val sent = createFeedback(
            callerId, providerId, FeedbackVisibility.PROVIDER_REQUESTER,
            status = FeedbackStatus.SENT, requesterId = callerId, content = "delivered",
        )

        val items = client.get("/api/v1/feedbacks?view=received").body<FeedbackPageResponse>().items
        assertEquals(setOf(pending.id, sent.id), items.map { it.id }.toSet())
        // The unfinished one is visible but its content preview is still redacted from the requester.
        assertEquals("", items.single { it.id == pending.id }.contentPreview)
        assertEquals("delivered", items.single { it.id == sent.id }.contentPreview)
    }

    @Test
    fun `received list hides another user's request about the subject until it is delivered`() = testApplication {
        usePostgresTestcontainer()
        val subjectEmail = uniqueEmail("subject")
        val subjectId = TestUsers.seed(email = subjectEmail, password = "pw", role = UserRole.USER)
        val providerEmail = uniqueEmail("provider")
        val providerId = TestUsers.seed(email = providerEmail, password = "pw")
        val requesterId = TestUsers.seed(email = uniqueEmail("requester"), password = "pw")
        val subjectClient = authedClient(subjectEmail, "pw")
        val providerClient = authedClient(providerEmail, "pw")

        fun body(status: FeedbackStatus) = Feedback(
            requesterId = requesterId, subjectId = subjectId, providerId = providerId,
            visibility = FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT, status = status,
        )

        // Someone else requested feedback about the subject — one stays pending, one gets rejected.
        val pending = createFeedback(
            subjectId, providerId, FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT,
            status = FeedbackStatus.REQUESTED, requesterId = requesterId,
        )
        val toReject = createFeedback(
            subjectId, providerId, FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT,
            status = FeedbackStatus.REQUESTED, requesterId = requesterId,
        )
        providerClient.put("/api/v1/feedbacks/${toReject.id}") {
            contentType(ContentType.Application.Json)
            setBody(body(FeedbackStatus.REJECTED))
        }

        // While REQUESTED / REJECTED the subject (not the requester) does not see them — rule C needs
        // a delivered status (SENT/WITHDRAWN).
        val before = subjectClient.get("/api/v1/feedbacks?view=received").body<FeedbackPageResponse>()
        assertTrue(before.items.none { it.id == pending.id || it.id == toReject.id })

        // Deliver the pending one (REQUESTED -> DRAFT -> SENT); now it appears, the rejected one never does.
        for (next in listOf(FeedbackStatus.DRAFT, FeedbackStatus.SENT)) {
            providerClient.put("/api/v1/feedbacks/${pending.id}") {
                contentType(ContentType.Application.Json)
                setBody(body(next))
            }
        }
        val after = subjectClient.get("/api/v1/feedbacks?view=received").body<FeedbackPageResponse>()
        assertEquals(listOf(pending.id), after.items.map { it.id })
    }

    @Test
    fun `list received resolves joined names and null requester`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("subject")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", role = UserRole.USER)
        val providerId = TestUsers.seed(email = uniqueEmail("provider"), password = "pw", name = "Paula Provider")
        val requesterId = TestUsers.seed(email = uniqueEmail("requester"), password = "pw", name = "Rita Requester")
        val client = authedClient(callerEmail, "pw")

        val withRequester = createFeedback(
            callerId, providerId, FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT, requesterId = requesterId,
        )
        val withoutRequester = createFeedback(callerId, providerId, FeedbackVisibility.PUBLIC)

        val page = client.get("/api/v1/feedbacks").body<FeedbackPageResponse>()
        val itemWith = page.items.single { it.id == withRequester.id }
        assertEquals("Rita Requester", itemWith.requesterName)
        assertEquals(requesterId, itemWith.requesterId)
        assertEquals("Paula Provider", itemWith.providerName)
        assertEquals(providerId, itemWith.providerId)
        val itemWithout = page.items.single { it.id == withoutRequester.id }
        assertNull(itemWithout.requesterId)
        assertNull(itemWithout.requesterName)
        assertEquals(false, itemWithout.requesterDeleted)
    }

    @Test
    fun `list received caps contentPreview at 200 characters`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("subject")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", role = UserRole.USER)
        val providerId = TestUsers.seed(email = uniqueEmail("provider"), password = "pw")
        val client = authedClient(callerEmail, "pw")

        createFeedback(callerId, providerId, FeedbackVisibility.PUBLIC, content = "x".repeat(300))

        val page = client.get("/api/v1/feedbacks").body<FeedbackPageResponse>()
        assertEquals(200, page.items.single().contentPreview.length)
    }

    @Test
    fun `list received filters by names visibility and status`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("subject")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", role = UserRole.USER)
        val aliceId = TestUsers.seed(email = uniqueEmail("alice"), password = "pw", name = "Alice Provider")
        val bobId = TestUsers.seed(email = uniqueEmail("bob"), password = "pw", name = "Bob Provider")
        val requesterId = TestUsers.seed(email = uniqueEmail("carol"), password = "pw", name = "Carol Requester")
        val client = authedClient(callerEmail, "pw")

        val fromAlice = createFeedback(callerId, aliceId, FeedbackVisibility.PUBLIC, status = FeedbackStatus.SENT)
        // Not a DRAFT: the subject cannot see drafts in their received list, so the filter
        // fixtures use visible statuses (SENT vs WITHDRAWN).
        val fromBob = createFeedback(
            callerId, bobId, FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT,
            status = FeedbackStatus.WITHDRAWN, requesterId = requesterId,
        )

        val byProvider = client.get("/api/v1/feedbacks?providerName=ALICE").body<FeedbackPageResponse>()
        assertEquals(listOf(fromAlice.id), byProvider.items.map { it.id })
        assertEquals(1, byProvider.total)

        val byRequester = client.get("/api/v1/feedbacks?requesterName=carol").body<FeedbackPageResponse>()
        assertEquals(listOf(fromBob.id), byRequester.items.map { it.id })

        val byVisibility = client.get("/api/v1/feedbacks?visibility=PUBLIC").body<FeedbackPageResponse>()
        assertEquals(listOf(fromAlice.id), byVisibility.items.map { it.id })

        val byStatus = client.get("/api/v1/feedbacks?status=WITHDRAWN").body<FeedbackPageResponse>()
        assertEquals(listOf(fromBob.id), byStatus.items.map { it.id })
    }

    @Test
    fun `subject cannot read a draft feedback but can once it is sent`() = testApplication {
        usePostgresTestcontainer()
        val provider = seedParty("provider", "Pat Provider")
        val subject = seedParty("subject", "Sam Subject")
        val providerClient = authedClient(provider.email, "pw")
        val subjectClient = authedClient(subject.email, "pw")

        val draft = createFeedback(
            subjectId = subject.id,
            providerId = provider.id,
            visibility = FeedbackVisibility.PROVIDER_SUBJECT,
            status = FeedbackStatus.DRAFT,
        )

        // While it's a draft the subject is locked out; the provider (author) is not.
        assertEquals(HttpStatusCode.Forbidden, subjectClient.get("/api/v1/feedbacks/${draft.id}").status)
        assertEquals(HttpStatusCode.OK, providerClient.get("/api/v1/feedbacks/${draft.id}").status)

        // Sending it opens it up to the subject.
        assertEquals(
            HttpStatusCode.NoContent,
            providerClient.put("/api/v1/feedbacks/${draft.id}") {
                contentType(ContentType.Application.Json)
                setBody(
                    Feedback(
                        subjectId = subject.id,
                        providerId = provider.id,
                        visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                        status = FeedbackStatus.SENT,
                    )
                )
            }.status,
        )
        assertEquals(HttpStatusCode.OK, subjectClient.get("/api/v1/feedbacks/${draft.id}").status)
    }

    @Test
    fun `received list hides drafts from the subject`() = testApplication {
        usePostgresTestcontainer()
        val provider = seedParty("provider", "Pat Provider")
        val subject = seedParty("subject", "Sam Subject")
        val providerClient = authedClient(provider.email, "pw")
        val subjectClient = authedClient(subject.email, "pw")

        createFeedback(
            subjectId = subject.id, providerId = provider.id,
            visibility = FeedbackVisibility.PROVIDER_SUBJECT, status = FeedbackStatus.DRAFT,
        )
        val sent = createFeedback(
            subjectId = subject.id, providerId = provider.id,
            visibility = FeedbackVisibility.PUBLIC, status = FeedbackStatus.SENT,
        )

        val received = subjectClient.get("/api/v1/feedbacks?view=received").body<FeedbackPageResponse>()
        assertEquals(listOf(sent.id), received.items.map { it.id })
    }

    @Test
    fun `requester who is the subject may watch their own draft but not its content`() = testApplication {
        usePostgresTestcontainer()
        val provider = seedParty("provider", "Pat Provider")
        // The subject asked for this feedback, so they are also the requester.
        val subject = seedParty("subject", "Sam Subject")
        val providerClient = authedClient(provider.email, "pw")
        val subjectClient = authedClient(subject.email, "pw")

        val draft = createFeedback(
            subjectId = subject.id,
            providerId = provider.id,
            // A requester's read access requires a requester-inclusive visibility; the subject is also
            // the requester here, so PROVIDER_REQUESTER_SUBJECT lets them watch their own draft.
            visibility = FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT,
            status = FeedbackStatus.DRAFT,
            requesterId = subject.id,
            content = "secret draft",
        )

        // The requester may now read the record (it was 403 before this change) — but the content
        // is redacted while it is a draft. The provider still sees the real content.
        val asRequester = subjectClient.get("/api/v1/feedbacks/${draft.id}")
        assertEquals(HttpStatusCode.OK, asRequester.status)
        assertEquals("", asRequester.body<FeedbackResponse>().content)
        assertEquals("secret draft", providerClient.get("/api/v1/feedbacks/${draft.id}").body<FeedbackResponse>().content)

        // It appears in their received list, with the preview redacted too.
        val received = subjectClient.get("/api/v1/feedbacks?view=received").body<FeedbackPageResponse>()
        val row = received.items.single { it.id == draft.id }
        assertEquals(FeedbackStatus.DRAFT, row.status)
        assertEquals("", row.contentPreview)

        // Once sent, the content opens up to the subject/requester.
        assertEquals(
            HttpStatusCode.NoContent,
            providerClient.put("/api/v1/feedbacks/${draft.id}") {
                contentType(ContentType.Application.Json)
                setBody(
                    Feedback(
                        requesterId = subject.id,
                        subjectId = subject.id,
                        providerId = provider.id,
                        visibility = FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT,
                        status = FeedbackStatus.SENT,
                        content = "secret draft",
                    )
                )
            }.status,
        )
        assertEquals("secret draft", subjectClient.get("/api/v1/feedbacks/${draft.id}").body<FeedbackResponse>().content)
    }

    @Test
    fun `team view shows a requested draft to the requesting manager (redacted) but hides it from a non-party manager`() =
        testApplication {
            usePostgresTestcontainer()
            val provider = seedParty("provider", "Pat Provider")
            val subject = seedParty("subject", "Sam Subject")
            val requestingManager = seedParty("manager-req", "Mary Manager")
            val otherManager = seedParty("manager-oth", "Mona Manager")
            val providerClient = authedClient(provider.email, "pw")
            val requestingManagerClient = authedClient(requestingManager.email, "pw")
            val otherManagerClient = authedClient(otherManager.email, "pw")

            // Both managers manage a team the subject belongs to.
            for ((managerClient, manager) in listOf(
                requestingManagerClient to requestingManager,
                otherManagerClient to otherManager,
            )) {
                managerClient.post("/api/v1/teams") {
                    contentType(ContentType.Application.Json)
                    setBody(Team(name = "Squad-${manager.id}", managerId = manager.id, memberIds = listOf(subject.id)))
                }
            }

            // Mary requested this feedback about Sam; it is still a draft.
            val draft = createFeedback(
                subjectId = subject.id,
                providerId = provider.id,
                visibility = FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT,
                status = FeedbackStatus.DRAFT,
                requesterId = requestingManager.id,
                content = "draft for the team",
            )

            // The requesting manager is a party (the requester), so the draft appears in her team
            // view — but its content is redacted while unfinished.
            val asRequester = requestingManagerClient.get("/api/v1/feedbacks?view=team").body<FeedbackPageResponse>()
            assertEquals("", asRequester.items.single { it.id == draft.id }.contentPreview)
            assertEquals("", requestingManagerClient.get("/api/v1/feedbacks/${draft.id}").body<FeedbackResponse>().content)

            // The other manager is not a party to this draft, so it does not surface in her team view
            // at all (only delivered feedback shows for a non-party manager).
            val asOther = otherManagerClient.get("/api/v1/feedbacks?view=team").body<FeedbackPageResponse>()
            assertTrue(asOther.items.none { it.id == draft.id })
        }

    @Test
    fun `team view hides in-progress feedback unless the manager is the provider or requester`() = testApplication {
        usePostgresTestcontainer()
        val manager = seedParty("manager", "Manny Manager")
        val subordinate = seedParty("sub", "Sam Sub")
        val provider = seedParty("provider", "Pat Provider")
        val otherRequester = seedParty("requester", "Rita Requester")
        val managerClient = authedClient(manager.email, "pw")
        val providerClient = authedClient(provider.email, "pw")

        managerClient.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "Squad", managerId = manager.id, memberIds = listOf(subordinate.id)))
        }

        // (a) a draft by another provider — the manager is not a party → hidden.
        createFeedback(
            subordinate.id, provider.id, FeedbackVisibility.PUBLIC, status = FeedbackStatus.DRAFT,
        )
        // (b) a draft the manager themselves provides → shown (party: provider).
        val mine = createFeedback(
            subordinate.id, manager.id, FeedbackVisibility.PROVIDER_SUBJECT, status = FeedbackStatus.DRAFT,
        )
        // (c) a request by someone else — the manager is not a party → hidden.
        createFeedback(
            subordinate.id, provider.id, FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT,
            status = FeedbackStatus.REQUESTED, requesterId = otherRequester.id,
        )
        // (d) a delivered feedback — non-party, but SENT → shown.
        val sent = createFeedback(
            subordinate.id, provider.id, FeedbackVisibility.PUBLIC, status = FeedbackStatus.SENT,
        )

        val items = managerClient.get("/api/v1/feedbacks?view=team").body<FeedbackPageResponse>().items
        assertEquals(setOf(mine.id, sent.id), items.map { it.id }.toSet())
    }

    @Test
    fun `list scopes to a single counterparty by providerId and subjectId`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", role = UserRole.USER)
        val aliceId = TestUsers.seed(email = uniqueEmail("alice"), password = "pw", name = "Alice")
        val bobId = TestUsers.seed(email = uniqueEmail("bob"), password = "pw", name = "Bob")
        val client = authedClient(callerEmail, "pw")

        // Feedbacks the caller received, from two different providers.
        val fromAlice = createFeedback(callerId, aliceId, FeedbackVisibility.PUBLIC)
        createFeedback(callerId, bobId, FeedbackVisibility.PUBLIC)
        // Feedbacks the caller provided, about two different subjects (all statuses count).
        val toAlice = createFeedback(aliceId, callerId, FeedbackVisibility.PROVIDER_SUBJECT, status = FeedbackStatus.DRAFT)
        createFeedback(bobId, callerId, FeedbackVisibility.PROVIDER_SUBJECT, status = FeedbackStatus.DRAFT)

        // received + providerId → only what Alice gave me.
        val received = client.get("/api/v1/feedbacks?view=received&providerId=$aliceId").body<FeedbackPageResponse>()
        assertEquals(listOf(fromAlice.id), received.items.map { it.id })
        assertEquals(1, received.total)

        // provided + subjectId → only what I gave Alice, regardless of status.
        val provided = client.get("/api/v1/feedbacks?view=provided&subjectId=$aliceId").body<FeedbackPageResponse>()
        assertEquals(listOf(toAlice.id), provided.items.map { it.id })
        assertEquals(1, provided.total)
    }

    @Test
    fun `list rejects malformed providerId and subjectId`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw", role = UserRole.USER)
        val client = authedClient(callerEmail, "pw")

        assertEquals(
            HttpStatusCode.BadRequest,
            client.get("/api/v1/feedbacks?providerId=abc").status,
        )
        assertEquals(
            HttpStatusCode.BadRequest,
            client.get("/api/v1/feedbacks?view=provided&subjectId=-1").status,
        )
    }

    @Test
    fun `list received sorts by providerName descending and defaults to id ascending`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("subject")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", role = UserRole.USER)
        val aliceId = TestUsers.seed(email = uniqueEmail("alice"), password = "pw", name = "Alice Provider")
        val bobId = TestUsers.seed(email = uniqueEmail("bob"), password = "pw", name = "Bob Provider")
        val client = authedClient(callerEmail, "pw")

        val fromBob = createFeedback(callerId, bobId, FeedbackVisibility.PUBLIC)
        val fromAlice = createFeedback(callerId, aliceId, FeedbackVisibility.PUBLIC)

        val desc = client.get("/api/v1/feedbacks?sort=-providerName").body<FeedbackPageResponse>()
        assertEquals(listOf(fromBob.id, fromAlice.id), desc.items.map { it.id })

        val byDefault = client.get("/api/v1/feedbacks").body<FeedbackPageResponse>()
        assertEquals(listOf(fromBob.id, fromAlice.id).sorted(), byDefault.items.map { it.id })
    }

    @Test
    fun `list received paginates with stable pages`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("subject")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", role = UserRole.USER)
        val providerId = TestUsers.seed(email = uniqueEmail("provider"), password = "pw")
        val client = authedClient(callerEmail, "pw")

        val created = (1..5).map {
            createFeedback(callerId, providerId, FeedbackVisibility.PUBLIC).id
        }

        val pages = (1..3).map { p ->
            client.get("/api/v1/feedbacks?pageSize=2&page=$p").body<FeedbackPageResponse>()
        }
        assertTrue(pages.all { it.total == 5L })
        assertEquals(listOf(2, 2, 1), pages.map { it.items.size })
        assertEquals(created.sorted(), pages.flatMap { it.items.map { item -> item.id } })
    }

    @Test
    fun `list provided returns caller-as-provider rows regardless of visibility`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("provider")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", role = UserRole.USER)
        val subjectId = TestUsers.seed(email = uniqueEmail("subject"), password = "pw")
        val requesterId = TestUsers.seed(email = uniqueEmail("requester"), password = "pw")
        val otherProviderId = TestUsers.seed(email = uniqueEmail("other"), password = "pw")
        val client = authedClient(callerEmail, "pw")

        val provided = listOf(
            createFeedback(subjectId, callerId, FeedbackVisibility.PUBLIC),
            createFeedback(subjectId, callerId, FeedbackVisibility.PROVIDER_SUBJECT),
            createFeedback(subjectId, callerId, FeedbackVisibility.PROVIDER_REQUESTER, requesterId = requesterId),
            createFeedback(subjectId, callerId, FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT, requesterId = requesterId),
        )
        // Excluded: caller is the subject here, not the provider.
        createFeedback(callerId, otherProviderId, FeedbackVisibility.PUBLIC)

        val page = client.get("/api/v1/feedbacks?view=provided").body<FeedbackPageResponse>()
        assertEquals(4, page.total)
        assertEquals(provided.map { it.id }.sorted(), page.items.map { it.id }.sorted())
        assertEquals(
            FeedbackVisibility.entries.toSet(),
            page.items.map { it.visibility }.toSet(),
        )
    }

    @Test
    fun `list provided resolves subject names and supports subjectName filter and sort`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("provider")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", role = UserRole.USER)
        val annId = TestUsers.seed(email = uniqueEmail("ann"), password = "pw", name = "Ann Subject")
        val zoeId = TestUsers.seed(email = uniqueEmail("zoe"), password = "pw", name = "Zoe Subject")
        val client = authedClient(callerEmail, "pw")

        val forAnn = createFeedback(annId, callerId, FeedbackVisibility.PROVIDER_SUBJECT)
        val forZoe = createFeedback(zoeId, callerId, FeedbackVisibility.PUBLIC)

        val all = client.get("/api/v1/feedbacks?view=provided").body<FeedbackPageResponse>()
        assertEquals("Ann Subject", all.items.single { it.id == forAnn.id }.subjectName)
        assertEquals(annId, all.items.single { it.id == forAnn.id }.subjectId)

        val filtered = client.get("/api/v1/feedbacks?view=provided&subjectName=ZOE").body<FeedbackPageResponse>()
        assertEquals(listOf(forZoe.id), filtered.items.map { it.id })

        val sorted = client.get("/api/v1/feedbacks?view=provided&sort=-subjectName").body<FeedbackPageResponse>()
        assertEquals(listOf(forZoe.id, forAnn.id), sorted.items.map { it.id })
    }

    @Test
    fun `list received rejects malformed query parameters`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("subject")
        TestUsers.seed(email = callerEmail, password = "pw", role = UserRole.USER)
        val client = authedClient(callerEmail, "pw")

        val badRequests = listOf(
            "/api/v1/feedbacks?sort=content",
            "/api/v1/feedbacks?visibility=BOGUS",
            "/api/v1/feedbacks?status=BOGUS",
            "/api/v1/feedbacks?view=bogus",
            "/api/v1/feedbacks?pageSize=200",
            "/api/v1/feedbacks?page=0",
        )
        for (url in badRequests) {
            assertEquals(HttpStatusCode.BadRequest, client.get(url).status, "Expected 400 for $url")
        }
    }

    @Test
    fun `soft-deleting subject user preserves feedback rows`() = testApplication {
        usePostgresTestcontainer()
        val t = seedTriad()
        val client = authedClient(t.providerEmail, "pw")

        val created = client.post("/api/v1/feedbacks") {
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

        assertEquals(HttpStatusCode.NoContent, client.delete("/api/v1/users/${t.subjectId}").status)

        val after = client.get("/api/v1/feedbacks/${created.id}").body<FeedbackResponse>()
        assertEquals(t.subjectId, after.subjectId)
        assertEquals(t.providerId, after.providerId)
    }

    @Test
    fun `soft-deleting requester user preserves requester_id on feedback`() = testApplication {
        usePostgresTestcontainer()
        val t = seedTriad()
        val client = authedClient(t.providerEmail, "pw")

        val created = client.post("/api/v1/feedbacks") {
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

        assertEquals(HttpStatusCode.NoContent, client.delete("/api/v1/users/${t.requesterId}").status)
        val after = client.get("/api/v1/feedbacks/${created.id}").body<FeedbackResponse>()
        assertEquals(t.requesterId, after.requesterId)
        assertEquals(t.subjectId, after.subjectId)
        assertEquals(t.providerId, after.providerId)
    }

    @Test
    fun `create and read expose a non-zero lastModified`() = testApplication {
        usePostgresTestcontainer()
        val t = seedTriad()
        val client = authedClient(t.providerEmail, "pw")

        val created = client.post("/api/v1/feedbacks") {
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

        assertTrue(created.lastModified > 0, "created.lastModified was ${created.lastModified}")
        val read = client.get("/api/v1/feedbacks/${created.id}").body<FeedbackResponse>()
        assertEquals(created.lastModified, read.lastModified)
    }

    @Test
    fun `update advances lastModified and ignores client-supplied value`() = testApplication {
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
        val created = client.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(draft)
        }.body<FeedbackResponse>()

        delay(10)
        // Send a bogus lastModified in the body; the server must overwrite it with the clock.
        client.put("/api/v1/feedbacks/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(draft.copy(content = "v2", lastModified = 1L))
        }

        val after = client.get("/api/v1/feedbacks/${created.id}").body<FeedbackResponse>()
        assertEquals("v2", after.content)
        assertTrue(
            after.lastModified > created.lastModified,
            "expected ${after.lastModified} > ${created.lastModified}",
        )
    }

    @Test
    fun `list filters by lastModified gte`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("subject")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", role = UserRole.USER)
        val providerId = TestUsers.seed(email = uniqueEmail("provider"), password = "pw")
        val client = authedClient(callerEmail, "pw")

        val older = createFeedback(callerId, providerId, FeedbackVisibility.PUBLIC)
        delay(10)
        val newer = createFeedback(callerId, providerId, FeedbackVisibility.PUBLIC)

        // A cutoff strictly between the two rows returns only the newer one.
        val cutoff = (older.lastModified + newer.lastModified) / 2
        val narrowed = client.get("/api/v1/feedbacks?lastModified%5Bgte%5D=$cutoff")
        assertEquals(HttpStatusCode.OK, narrowed.status)
        assertEquals(listOf(newer.id), narrowed.body<FeedbackPageResponse>().items.map { it.id })

        // A cutoff at or below the older row returns both.
        val all = client.get("/api/v1/feedbacks?lastModified%5Bgte%5D=${older.lastModified}")
            .body<FeedbackPageResponse>()
        assertEquals(listOf(older.id, newer.id).sorted(), all.items.map { it.id }.sorted())

        // Malformed bound is a 400.
        assertEquals(
            HttpStatusCode.BadRequest,
            client.get("/api/v1/feedbacks?lastModified%5Bgte%5D=abc").status,
        )
    }

    @Test
    fun `list exposes lastModified and sorts by it`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("subject")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", role = UserRole.USER)
        val providerId = TestUsers.seed(email = uniqueEmail("provider"), password = "pw")
        val client = authedClient(callerEmail, "pw")

        val older = createFeedback(callerId, providerId, FeedbackVisibility.PUBLIC)
        delay(10)
        val newer = createFeedback(callerId, providerId, FeedbackVisibility.PUBLIC)

        val page = client.get("/api/v1/feedbacks").body<FeedbackPageResponse>()
        assertTrue(page.items.all { it.lastModified > 0 })

        val desc = client.get("/api/v1/feedbacks?sort=-lastModified")
        assertEquals(HttpStatusCode.OK, desc.status)
        assertEquals(listOf(newer.id, older.id), desc.body<FeedbackPageResponse>().items.map { it.id })

        val asc = client.get("/api/v1/feedbacks?sort=lastModified")
        assertEquals(HttpStatusCode.OK, asc.status)
        assertEquals(listOf(older.id, newer.id), asc.body<FeedbackPageResponse>().items.map { it.id })
    }

    private suspend fun HttpClient.createTeam(
        name: String,
        managerId: UInt,
        memberIds: List<UInt>,
    ): TeamResponse = post("/api/v1/teams") {
        contentType(ContentType.Application.Json)
        setBody(Team(name = name, managerId = managerId, memberIds = memberIds))
    }.body<TeamResponse>()

    @Test
    fun `list team returns subordinate feedback across all visibilities`() = testApplication {
        usePostgresTestcontainer()
        val managerEmail = uniqueEmail("manager")
        val managerId = TestUsers.seed(email = managerEmail, password = "pw")
        val subordinateId = TestUsers.seed(email = uniqueEmail("sub"), password = "pw")
        val providerId = TestUsers.seed(email = uniqueEmail("provider"), password = "pw")
        val requesterId = TestUsers.seed(email = uniqueEmail("requester"), password = "pw")
        val outsiderId = TestUsers.seed(email = uniqueEmail("outsider"), password = "pw")
        val client = authedClient(managerEmail, "pw")

        client.createTeam("Squad", managerId = managerId, memberIds = listOf(subordinateId))

        // The team view is unrestricted by visibility — even PROVIDER_REQUESTER, which the
        // subject themselves could not read via the "received" view, is visible to the manager.
        val onSubordinate = listOf(
            createFeedback(subordinateId, providerId, FeedbackVisibility.PROVIDER_SUBJECT),
            createFeedback(subordinateId, providerId, FeedbackVisibility.PUBLIC),
            createFeedback(
                subordinateId, providerId, FeedbackVisibility.PROVIDER_REQUESTER, requesterId = requesterId,
            ),
        )
        // Excluded: the subject is not a member of any team the caller manages.
        createFeedback(outsiderId, providerId, FeedbackVisibility.PUBLIC)

        val page = client.get("/api/v1/feedbacks?view=team")
        assertEquals(HttpStatusCode.OK, page.status)
        val body = page.body<FeedbackPageResponse>()
        assertEquals(3, body.total)
        assertEquals(onSubordinate.map { it.id }.sorted(), body.items.map { it.id }.sorted())
        assertTrue(body.items.any { it.visibility == FeedbackVisibility.PROVIDER_REQUESTER })
    }

    @Test
    fun `list team is empty for a caller who manages no team`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("loner")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", role = UserRole.USER)
        val providerId = TestUsers.seed(email = uniqueEmail("provider"), password = "pw")
        val client = authedClient(callerEmail, "pw")

        // Feedback where the caller is the subject still must not surface in the team view.
        createFeedback(callerId, providerId, FeedbackVisibility.PUBLIC)

        val body = client.get("/api/v1/feedbacks?view=team").body<FeedbackPageResponse>()
        assertEquals(0, body.total)
        assertTrue(body.items.isEmpty())
    }

    @Test
    fun `list team excludes feedback once the team is soft-deleted`() = testApplication {
        usePostgresTestcontainer()
        val managerEmail = uniqueEmail("manager")
        val managerId = TestUsers.seed(email = managerEmail, password = "pw")
        val subordinateId = TestUsers.seed(email = uniqueEmail("sub"), password = "pw")
        val providerId = TestUsers.seed(email = uniqueEmail("provider"), password = "pw")
        val client = authedClient(managerEmail, "pw")

        val team = client.createTeam("Squad", managerId = managerId, memberIds = listOf(subordinateId))
        createFeedback(subordinateId, providerId, FeedbackVisibility.PUBLIC)

        assertEquals(1, client.get("/api/v1/feedbacks?view=team").body<FeedbackPageResponse>().total)

        assertEquals(HttpStatusCode.NoContent, client.delete("/api/v1/teams/${team.id}").status)

        // The TEAM scope filters on non-deleted teams, so the subordinate is no longer in scope.
        assertEquals(0, client.get("/api/v1/feedbacks?view=team").body<FeedbackPageResponse>().total)
    }

    @Test
    fun `list team honors subjectName filter and sort`() = testApplication {
        usePostgresTestcontainer()
        val managerEmail = uniqueEmail("manager")
        val managerId = TestUsers.seed(email = managerEmail, password = "pw")
        val annId = TestUsers.seed(email = uniqueEmail("ann"), password = "pw", name = "Ann Sub")
        val zoeId = TestUsers.seed(email = uniqueEmail("zoe"), password = "pw", name = "Zoe Sub")
        val providerId = TestUsers.seed(email = uniqueEmail("provider"), password = "pw")
        val client = authedClient(managerEmail, "pw")

        client.createTeam("Squad", managerId = managerId, memberIds = listOf(annId, zoeId))
        val forAnn = createFeedback(annId, providerId, FeedbackVisibility.PUBLIC)
        val forZoe = createFeedback(zoeId, providerId, FeedbackVisibility.PUBLIC)

        val sorted = client.get("/api/v1/feedbacks?view=team&sort=-subjectName").body<FeedbackPageResponse>()
        assertEquals(listOf(forZoe.id, forAnn.id), sorted.items.map { it.id })

        val filtered = client.get("/api/v1/feedbacks?view=team&subjectName=ann").body<FeedbackPageResponse>()
        assertEquals(listOf(forAnn.id), filtered.items.map { it.id })
    }

    // ── Notifications generated by status transitions ─────────────────────────

    private data class Party(val email: String, val id: UInt)

    private suspend fun seedParty(prefix: String, name: String): Party {
        val email = uniqueEmail(prefix)
        return Party(email, TestUsers.seed(email = email, password = "pw", role = UserRole.USER, name = name))
    }

    private suspend fun ApplicationTestBuilder.notificationsOf(email: String): List<NotificationResponse> =
        authedClient(email, "pw").get("/api/v1/notifications").body<NotificationPageResponse>().items

    @Test
    fun `transition draft to sent notifies subject and requester`() = testApplication {
        usePostgresTestcontainer()
        val provider = seedParty("provider", "Pat Provider")
        val subject = seedParty("subject", "Sam Subject")
        val requester = seedParty("requester", "Rita Requester")
        val providerClient = authedClient(provider.email, "pw")

        val draft = Feedback(
            requesterId = requester.id,
            subjectId = subject.id,
            providerId = provider.id,
            visibility = FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT,
            status = FeedbackStatus.DRAFT,
            content = "Notes",
        )
        val created = providerClient.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(draft)
        }.body<FeedbackResponse>()

        assertEquals(
            HttpStatusCode.NoContent,
            providerClient.put("/api/v1/feedbacks/${created.id}") {
                contentType(ContentType.Application.Json)
                setBody(draft.copy(status = FeedbackStatus.SENT))
            }.status,
        )

        val subjectNotes = notificationsOf(subject.email)
        val subjectNote = subjectNotes.single()
        assertTrue(subjectNote.message.contains("Pat Provider") && subjectNote.message.contains("Sam Subject"))
        assertTrue(subjectNote.message.contains("has been sent"))
        assertEquals("/feedback/${created.id}/view", subjectNote.link)
        assertFalse(subjectNote.wasSeen)

        val requesterNote = notificationsOf(requester.email).single()
        assertTrue(requesterNote.message.contains("Rita Requester"))
        assertTrue(requesterNote.message.contains("has been sent"))
        assertEquals("/feedback/${created.id}/view", requesterNote.link)
    }

    @Test
    fun `transition requested to rejected notifies the requester without a link`() = testApplication {
        usePostgresTestcontainer()
        val provider = seedParty("provider", "Pat Provider")
        val subject = seedParty("subject", "Sam Subject")
        val requester = seedParty("requester", "Rita Requester")
        val providerClient = authedClient(provider.email, "pw")

        val requested = Feedback(
            requesterId = requester.id,
            subjectId = subject.id,
            providerId = provider.id,
            visibility = FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT,
            status = FeedbackStatus.REQUESTED,
        )
        val created = providerClient.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(requested)
        }.body<FeedbackResponse>()

        providerClient.put("/api/v1/feedbacks/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(requested.copy(status = FeedbackStatus.REJECTED))
        }

        val note = notificationsOf(requester.email).single()
        assertTrue(note.message.contains("rejected"))
        assertTrue(note.message.contains("Rita Requester") && note.message.contains("Pat Provider"))
        assertNull(note.link)
        // The subject is not told about a rejected request.
        assertTrue(notificationsOf(subject.email).isEmpty())
    }

    @Test
    fun `transition requested to draft notifies the requester it was picked up`() = testApplication {
        usePostgresTestcontainer()
        val provider = seedParty("provider", "Pat Provider")
        val subject = seedParty("subject", "Sam Subject")
        val requester = seedParty("requester", "Rita Requester")
        val providerClient = authedClient(provider.email, "pw")

        val requested = Feedback(
            requesterId = requester.id,
            subjectId = subject.id,
            providerId = provider.id,
            visibility = FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT,
            status = FeedbackStatus.REQUESTED,
        )
        val created = providerClient.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(requested)
        }.body<FeedbackResponse>()

        providerClient.put("/api/v1/feedbacks/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(requested.copy(status = FeedbackStatus.DRAFT))
        }

        val note = notificationsOf(requester.email).single()
        assertTrue(note.message.contains("picked up"))
        assertNull(note.link)
    }

    @Test
    fun `transition sent to withdrawn notifies subject and requester`() = testApplication {
        usePostgresTestcontainer()
        val provider = seedParty("provider", "Pat Provider")
        val subject = seedParty("subject", "Sam Subject")
        val requester = seedParty("requester", "Rita Requester")
        val providerClient = authedClient(provider.email, "pw")

        val draft = Feedback(
            requesterId = requester.id,
            subjectId = subject.id,
            providerId = provider.id,
            visibility = FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT,
            status = FeedbackStatus.DRAFT,
        )
        val created = providerClient.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(draft)
        }.body<FeedbackResponse>()
        providerClient.put("/api/v1/feedbacks/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(draft.copy(status = FeedbackStatus.SENT))
        }
        providerClient.put("/api/v1/feedbacks/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(draft.copy(status = FeedbackStatus.WITHDRAWN))
        }

        assertTrue(notificationsOf(subject.email).any { it.message.contains("withdrawn") })
        val requesterWithdrawn = notificationsOf(requester.email).filter { it.message.contains("withdrawn") }
        assertEquals(1, requesterWithdrawn.size)
        assertTrue(requesterWithdrawn.single().message.contains("Rita Requester"))
        assertTrue(requesterWithdrawn.single().link == null)
    }

    @Test
    fun `editing content without a status change creates no notification`() = testApplication {
        usePostgresTestcontainer()
        val provider = seedParty("provider", "Pat Provider")
        val subject = seedParty("subject", "Sam Subject")
        val requester = seedParty("requester", "Rita Requester")
        val providerClient = authedClient(provider.email, "pw")

        val draft = Feedback(
            requesterId = requester.id,
            subjectId = subject.id,
            providerId = provider.id,
            visibility = FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT,
            status = FeedbackStatus.DRAFT,
            content = "v1",
        )
        val created = providerClient.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(draft)
        }.body<FeedbackResponse>()

        providerClient.put("/api/v1/feedbacks/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(draft.copy(content = "v2"))
        }

        assertTrue(notificationsOf(subject.email).isEmpty())
        assertTrue(notificationsOf(requester.email).isEmpty())
    }

    @Test
    fun `creating a requested feedback notifies the provider with an edit link`() = testApplication {
        usePostgresTestcontainer()
        val provider = seedParty("provider", "Pat Provider")
        val subject = seedParty("subject", "Sam Subject")
        val requester = seedParty("requester", "Rita Requester")
        // The requester is the one filing the request; any authenticated user may POST.
        val requesterClient = authedClient(requester.email, "pw")

        val created = requesterClient.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                Feedback(
                    requesterId = requester.id,
                    subjectId = subject.id,
                    providerId = provider.id,
                    visibility = FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT,
                    status = FeedbackStatus.REQUESTED,
                )
            )
        }.body<FeedbackResponse>()

        val providerNote = notificationsOf(provider.email).single()
        assertTrue(providerNote.message.contains("Rita Requester"), "names the requester")
        assertTrue(providerNote.message.contains("Sam Subject"), "names the subject")
        assertEquals("/feedback/${created.id}/edit", providerNote.link)
        assertFalse(providerNote.wasSeen)

        // Only the provider is told; the subject and requester are not notified on creation.
        assertTrue(notificationsOf(subject.email).isEmpty())
        assertTrue(notificationsOf(requester.email).isEmpty())
    }

    @Test
    fun `creating a draft feedback notifies no one`() = testApplication {
        usePostgresTestcontainer()
        val provider = seedParty("provider", "Pat Provider")
        val subject = seedParty("subject", "Sam Subject")
        val providerClient = authedClient(provider.email, "pw")

        providerClient.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                Feedback(
                    subjectId = subject.id,
                    providerId = provider.id,
                    visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                    status = FeedbackStatus.DRAFT,
                )
            )
        }

        assertTrue(notificationsOf(provider.email).isEmpty())
        assertTrue(notificationsOf(subject.email).isEmpty())
    }
}
