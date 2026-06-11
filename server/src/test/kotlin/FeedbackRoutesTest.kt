package ch.nokillswit

import ch.nokillswit.auth.LoginRequest
import ch.nokillswit.auth.LoginResponse
import ch.nokillswit.feedbacks.Feedback
import ch.nokillswit.feedbacks.FeedbackPageResponse
import ch.nokillswit.feedbacks.FeedbackResponse
import ch.nokillswit.feedbacks.FeedbackStatus
import ch.nokillswit.feedbacks.FeedbackVisibility
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
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class FeedbackRoutesTest {

    private fun uniqueEmail(prefix: String) = "$prefix-${UUID.randomUUID()}@test"

    private suspend fun ApplicationTestBuilder.authedClient(email: String, password: String): HttpClient {
        val client = jsonClient()
        val token = client.post("/api/login") {
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
        val createResponse = client.post("/api/feedbacks") {
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
        assertTrue(location.endsWith("/api/feedbacks/${created.id}"), "Location was $location")

        val readResponse = client.get("/api/feedbacks/${created.id}")
        assertEquals(HttpStatusCode.OK, readResponse.status)
        assertEquals(created, readResponse.body<FeedbackResponse>())
    }

    @Test
    fun `create requested with requester`() = testApplication {
        usePostgresTestcontainer()
        val t = seedTriad()
        val client = authedClient(t.providerEmail, "pw")

        val response = client.post("/api/feedbacks") {
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

        val response = client.post("/api/feedbacks") {
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

        val response = client.post("/api/feedbacks") {
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

        val response = client.post("/api/feedbacks") {
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

        val response = client.post("/api/feedbacks") {
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
        val created = client.post("/api/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(draft)
        }.body<FeedbackResponse>()

        val putResponse = client.put("/api/feedbacks/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(draft.copy(status = FeedbackStatus.SENT))
        }
        assertEquals(HttpStatusCode.NoContent, putResponse.status)
        val after = client.get("/api/feedbacks/${created.id}").body<FeedbackResponse>()
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
        val created = client.post("/api/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(draft)
        }.body<FeedbackResponse>()

        client.put("/api/feedbacks/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(draft.copy(status = FeedbackStatus.SENT))
        }

        val response = client.put("/api/feedbacks/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(draft.copy(status = FeedbackStatus.DRAFT))
        }
        assertEquals(HttpStatusCode.BadRequest, response.status)
        val after = client.get("/api/feedbacks/${created.id}").body<FeedbackResponse>()
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
        val created = client.post("/api/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(draft)
        }.body<FeedbackResponse>()

        client.put("/api/feedbacks/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(draft.copy(status = FeedbackStatus.WITHDRAWN))
        }

        for (target in listOf(FeedbackStatus.DRAFT, FeedbackStatus.SENT, FeedbackStatus.REQUESTED)) {
            val attempt = client.put("/api/feedbacks/${created.id}") {
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
        val created = client.post("/api/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(draft)
        }.body<FeedbackResponse>()

        val putResponse = client.put("/api/feedbacks/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(draft.copy(content = "v2", visibility = FeedbackVisibility.PUBLIC))
        }
        assertEquals(HttpStatusCode.NoContent, putResponse.status)

        val after = client.get("/api/feedbacks/${created.id}").body<FeedbackResponse>()
        assertEquals("v2", after.content)
        assertEquals(FeedbackVisibility.PUBLIC, after.visibility)
        assertEquals(FeedbackStatus.DRAFT, after.status)
    }

    @Test
    fun `delete removes the feedback and subsequent GET returns 404`() = testApplication {
        usePostgresTestcontainer()
        val t = seedTriad()
        val client = authedClient(t.providerEmail, "pw")

        val created = client.post("/api/feedbacks") {
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

        assertEquals(HttpStatusCode.NoContent, client.delete("/api/feedbacks/${created.id}").status)
        assertEquals(HttpStatusCode.NotFound, client.get("/api/feedbacks/${created.id}").status)
    }

    @Test
    fun `get for nonexistent feedback returns 404`() = testApplication {
        usePostgresTestcontainer()
        val t = seedTriad()
        val client = authedClient(t.providerEmail, "pw")
        assertEquals(HttpStatusCode.NotFound, client.get("/api/feedbacks/999999").status)
    }

    @Test
    fun `feedback endpoints require authentication`() = testApplication {
        usePostgresTestcontainer()
        val client = jsonClient()
        val endpoints = listOf(
            HttpMethod.Post to "/api/feedbacks",
            HttpMethod.Get to "/api/feedbacks",
            HttpMethod.Get to "/api/feedbacks/1",
            HttpMethod.Put to "/api/feedbacks/1",
            HttpMethod.Delete to "/api/feedbacks/1",
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

    private suspend fun HttpClient.createFeedback(
        subjectId: UInt,
        providerId: UInt,
        visibility: FeedbackVisibility,
        status: FeedbackStatus = FeedbackStatus.SENT,
        requesterId: UInt? = null,
        content: String = "",
    ): FeedbackResponse = post("/api/feedbacks") {
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
    fun `list received returns only caller-as-subject rows with subject-readable visibilities`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("subject")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", role = UserRole.USER)
        val providerId = TestUsers.seed(email = uniqueEmail("provider"), password = "pw")
        val requesterId = TestUsers.seed(email = uniqueEmail("requester"), password = "pw")
        val otherSubjectId = TestUsers.seed(email = uniqueEmail("other"), password = "pw")
        val client = authedClient(callerEmail, "pw")

        val visible = listOf(
            client.createFeedback(callerId, providerId, FeedbackVisibility.PUBLIC),
            client.createFeedback(callerId, providerId, FeedbackVisibility.PROVIDER_SUBJECT),
            client.createFeedback(callerId, providerId, FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT, requesterId = requesterId),
        )
        // Excluded: subject may not read PROVIDER_REQUESTER; other rows belong to a different subject.
        client.createFeedback(callerId, providerId, FeedbackVisibility.PROVIDER_REQUESTER, requesterId = requesterId)
        client.createFeedback(otherSubjectId, providerId, FeedbackVisibility.PUBLIC)

        val response = client.get("/api/feedbacks")
        assertEquals(HttpStatusCode.OK, response.status)
        val page = response.body<FeedbackPageResponse>()
        assertEquals(3, page.total)
        assertEquals(visible.map { it.id }.sorted(), page.items.map { it.id }.sorted())
        assertTrue(page.items.none { it.visibility == FeedbackVisibility.PROVIDER_REQUESTER })
    }

    @Test
    fun `list received resolves joined names and null requester`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("subject")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", role = UserRole.USER)
        val providerId = TestUsers.seed(email = uniqueEmail("provider"), password = "pw", name = "Paula Provider")
        val requesterId = TestUsers.seed(email = uniqueEmail("requester"), password = "pw", name = "Rita Requester")
        val client = authedClient(callerEmail, "pw")

        val withRequester = client.createFeedback(
            callerId, providerId, FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT, requesterId = requesterId,
        )
        val withoutRequester = client.createFeedback(callerId, providerId, FeedbackVisibility.PUBLIC)

        val page = client.get("/api/feedbacks").body<FeedbackPageResponse>()
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

        client.createFeedback(callerId, providerId, FeedbackVisibility.PUBLIC, content = "x".repeat(300))

        val page = client.get("/api/feedbacks").body<FeedbackPageResponse>()
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

        val fromAlice = client.createFeedback(callerId, aliceId, FeedbackVisibility.PUBLIC, status = FeedbackStatus.SENT)
        val fromBob = client.createFeedback(
            callerId, bobId, FeedbackVisibility.PROVIDER_SUBJECT,
            status = FeedbackStatus.DRAFT, requesterId = requesterId,
        )

        val byProvider = client.get("/api/feedbacks?providerName=ALICE").body<FeedbackPageResponse>()
        assertEquals(listOf(fromAlice.id), byProvider.items.map { it.id })
        assertEquals(1, byProvider.total)

        val byRequester = client.get("/api/feedbacks?requesterName=carol").body<FeedbackPageResponse>()
        assertEquals(listOf(fromBob.id), byRequester.items.map { it.id })

        val byVisibility = client.get("/api/feedbacks?visibility=PUBLIC").body<FeedbackPageResponse>()
        assertEquals(listOf(fromAlice.id), byVisibility.items.map { it.id })

        val byStatus = client.get("/api/feedbacks?status=DRAFT").body<FeedbackPageResponse>()
        assertEquals(listOf(fromBob.id), byStatus.items.map { it.id })
    }

    @Test
    fun `list received sorts by providerName descending and defaults to id ascending`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("subject")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", role = UserRole.USER)
        val aliceId = TestUsers.seed(email = uniqueEmail("alice"), password = "pw", name = "Alice Provider")
        val bobId = TestUsers.seed(email = uniqueEmail("bob"), password = "pw", name = "Bob Provider")
        val client = authedClient(callerEmail, "pw")

        val fromBob = client.createFeedback(callerId, bobId, FeedbackVisibility.PUBLIC)
        val fromAlice = client.createFeedback(callerId, aliceId, FeedbackVisibility.PUBLIC)

        val desc = client.get("/api/feedbacks?sort=-providerName").body<FeedbackPageResponse>()
        assertEquals(listOf(fromBob.id, fromAlice.id), desc.items.map { it.id })

        val byDefault = client.get("/api/feedbacks").body<FeedbackPageResponse>()
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
            client.createFeedback(callerId, providerId, FeedbackVisibility.PUBLIC).id
        }

        val pages = (1..3).map { p ->
            client.get("/api/feedbacks?pageSize=2&page=$p").body<FeedbackPageResponse>()
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
            client.createFeedback(subjectId, callerId, FeedbackVisibility.PUBLIC),
            client.createFeedback(subjectId, callerId, FeedbackVisibility.PROVIDER_SUBJECT),
            client.createFeedback(subjectId, callerId, FeedbackVisibility.PROVIDER_REQUESTER, requesterId = requesterId),
            client.createFeedback(subjectId, callerId, FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT, requesterId = requesterId),
        )
        // Excluded: caller is the subject here, not the provider.
        client.createFeedback(callerId, otherProviderId, FeedbackVisibility.PUBLIC)

        val page = client.get("/api/feedbacks?view=provided").body<FeedbackPageResponse>()
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

        val forAnn = client.createFeedback(annId, callerId, FeedbackVisibility.PROVIDER_SUBJECT)
        val forZoe = client.createFeedback(zoeId, callerId, FeedbackVisibility.PUBLIC)

        val all = client.get("/api/feedbacks?view=provided").body<FeedbackPageResponse>()
        assertEquals("Ann Subject", all.items.single { it.id == forAnn.id }.subjectName)
        assertEquals(annId, all.items.single { it.id == forAnn.id }.subjectId)

        val filtered = client.get("/api/feedbacks?view=provided&subjectName=ZOE").body<FeedbackPageResponse>()
        assertEquals(listOf(forZoe.id), filtered.items.map { it.id })

        val sorted = client.get("/api/feedbacks?view=provided&sort=-subjectName").body<FeedbackPageResponse>()
        assertEquals(listOf(forZoe.id, forAnn.id), sorted.items.map { it.id })
    }

    @Test
    fun `list received rejects malformed query parameters`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("subject")
        TestUsers.seed(email = callerEmail, password = "pw", role = UserRole.USER)
        val client = authedClient(callerEmail, "pw")

        val badRequests = listOf(
            "/api/feedbacks?sort=content",
            "/api/feedbacks?visibility=BOGUS",
            "/api/feedbacks?status=BOGUS",
            "/api/feedbacks?view=bogus",
            "/api/feedbacks?pageSize=200",
            "/api/feedbacks?page=0",
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

        val created = client.post("/api/feedbacks") {
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

        assertEquals(HttpStatusCode.NoContent, client.delete("/api/users/${t.subjectId}").status)

        val after = client.get("/api/feedbacks/${created.id}").body<FeedbackResponse>()
        assertEquals(t.subjectId, after.subjectId)
        assertEquals(t.providerId, after.providerId)
    }

    @Test
    fun `soft-deleting requester user preserves requester_id on feedback`() = testApplication {
        usePostgresTestcontainer()
        val t = seedTriad()
        val client = authedClient(t.providerEmail, "pw")

        val created = client.post("/api/feedbacks") {
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

        assertEquals(HttpStatusCode.NoContent, client.delete("/api/users/${t.requesterId}").status)
        val after = client.get("/api/feedbacks/${created.id}").body<FeedbackResponse>()
        assertEquals(t.requesterId, after.requesterId)
        assertEquals(t.subjectId, after.subjectId)
        assertEquals(t.providerId, after.providerId)
    }
}
