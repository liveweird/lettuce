package ch.nokillswit

import ch.nokillswit.auth.LoginRequest
import ch.nokillswit.auth.LoginResponse
import ch.nokillswit.feedbacks.FeedbackContentUpdate
import ch.nokillswit.feedbacks.FeedbackCreateRequest
import ch.nokillswit.feedbacks.FeedbackResponse
import ch.nokillswit.feedbacks.FeedbackStatus
import ch.nokillswit.feedbacks.FeedbackVisibility
import ch.nokillswit.plugins.ProblemDetail
import ch.nokillswit.teams.Team
import ch.nokillswit.templates.Template
import ch.nokillswit.users.UserRequest
import ch.nokillswit.users.UserRole
import ch.nokillswit.users.UserUpdateRequest
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.plugins.DefaultRequest
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Up-front payload validation (400 + ProblemDetail) instead of DB-level failures (500):
 * blank/oversized names and emails, and the password minimum on user creation.
 */
class PayloadValidationTest {


    private suspend fun ApplicationTestBuilder.adminClient(): HttpClient {
        val email = uniqueEmail("admin")
        TestUsers.seed(email = email, password = "pw-123456789", roles = setOf(UserRole.ADMIN))
        val base = jsonClient()
        val token = base.post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(email, "pw-123456789"))
        }.body<LoginResponse>().token
        return createClient {
            lettuceTestClientDefaults()
            install(DefaultRequest) { header(HttpHeaders.Authorization, "Bearer $token") }
        }
    }

    @Test
    fun `user create rejects blank and oversized fields and short passwords with 400`() = testApplication {
        usePostgresTestcontainer()
        val client = adminClient()

        suspend fun createStatus(name: String, email: String, password: String): HttpStatusCode =
            client.post("/api/v1/users") {
                contentType(ContentType.Application.Json)
                setBody(UserRequest(name = name, email = email, password = password))
            }.status

        assertEquals(HttpStatusCode.BadRequest, createStatus("  ", uniqueEmail("u"), "pw-123456789"))
        assertEquals(HttpStatusCode.BadRequest, createStatus("x".repeat(51), uniqueEmail("u"), "pw-123456789"))
        assertEquals(HttpStatusCode.BadRequest, createStatus("Ok", " ", "pw-123456789"))
        assertEquals(HttpStatusCode.BadRequest, createStatus("Ok", "a".repeat(255) + "@x", "pw-123456789"))
        assertEquals(HttpStatusCode.BadRequest, createStatus("Ok", "no-at-sign.example", "pw-123456789"))
        assertEquals(HttpStatusCode.BadRequest, createStatus("Ok", uniqueEmail("u"), "short"))
        // Over bcrypt's 71-UTF-8-byte ceiling: a 400, not a 500 from the hasher — by char count…
        assertEquals(HttpStatusCode.BadRequest, createStatus("Ok", uniqueEmail("u"), "x".repeat(72)))
        // …and by byte count (36 × 2-byte 'ó' = 72 bytes from only 36 chars).
        assertEquals(HttpStatusCode.BadRequest, createStatus("Ok", uniqueEmail("u"), "ó".repeat(36)))
        // Control: a valid payload passes.
        assertEquals(HttpStatusCode.Created, createStatus("Ok", uniqueEmail("u"), "pw-123456789"))
    }

    @Test
    fun `user create rejects a blank or oversized unique id with 400`() = testApplication {
        usePostgresTestcontainer()
        val client = adminClient()

        suspend fun createStatus(uniqueId: String?): HttpStatusCode =
            client.post("/api/v1/users") {
                contentType(ContentType.Application.Json)
                setBody(
                    UserRequest(
                        name = "Ok", email = uniqueEmail("uid"),
                        password = "pw-123456789", uniqueId = uniqueId,
                    ),
                )
            }.status

        assertEquals(HttpStatusCode.BadRequest, createStatus("  "))
        assertEquals(HttpStatusCode.BadRequest, createStatus("x".repeat(51)))
        // Control: exactly at the cap (unique per run — the id is a unique column) and absent both pass.
        val atCap = (uniqueEmail("cap").substringBefore("@") + "-" + "x".repeat(50)).take(50)
        assertEquals(HttpStatusCode.Created, createStatus(atCap))
        assertEquals(HttpStatusCode.Created, createStatus(null))
    }

    @Test
    fun `a NUL character in stored text is a 400 problem - not a 500`() = testApplication {
        usePostgresTestcontainer()
        val client = adminClient()
        // PostgreSQL rejects 0x00 inside text values (SQLSTATE 22021); the central mapping in
        // ErrorHandling.kt turns that into a 400 for every plaintext column at once.
        val response = client.post("/api/v1/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "bad\u0000name", email = uniqueEmail("nul"), password = "pw-123456789"))
        }
        assertEquals(HttpStatusCode.BadRequest, response.status)
    }

    @Test
    fun `a body-less POST is a 400 problem - not a 500`() = testApplication {
        usePostgresTestcontainer()
        val client = adminClient()
        // No body and no Content-Type: ContentNegotiation never runs (no converter matches
        // ContentType.Any), so `receive` throws CannotTransformContentToTypeException — which
        // used to escape to the 500 catch-all; the v2.34.0 central mapping (the 22021
        // precedent) turns it into a 400 for every body-receiving route at once. (CSRF is off
        // in tests, so the request reaches the handler.)
        val response = client.post("/api/v1/templates")
        assertEquals(HttpStatusCode.BadRequest, response.status)
        val problem = response.body<ProblemDetail>()
        assertEquals(HttpStatusCode.BadRequest.value, problem.status)
        assertEquals("Request body is missing or not JSON", problem.detail)
    }

    @Test
    fun `a non-numeric or out-of-range path id is a 400 problem`() = testApplication {
        usePostgresTestcontainer()
        val client = adminClient()
        // Ktor's resource transform rejects both before the handler; the spec declares the 400
        // (the OpenApiConformance plugin checks that declaration on these very requests).
        assertEquals(HttpStatusCode.BadRequest, client.get("/api/v1/users/not-a-number").status)
        assertEquals(HttpStatusCode.BadRequest, client.get("/api/v1/users/4161833451198").status)
    }

    @Test
    fun `user update applies the same name and email checks`() = testApplication {
        usePostgresTestcontainer()
        val client = adminClient()
        val id = TestUsers.seed(email = uniqueEmail("target"), password = "pw-123456789")

        val response = client.put("/api/v1/users/$id") {
            contentType(ContentType.Application.Json)
            setBody(UserUpdateRequest(name = "x".repeat(51), email = uniqueEmail("t"), roles = emptyList()))
        }
        assertEquals(HttpStatusCode.BadRequest, response.status)
    }

    @Test
    fun `team create and update reject blank or oversized names with 400`() = testApplication {
        usePostgresTestcontainer()
        val client = adminClient()
        val managerId = TestUsers.seed(email = uniqueEmail("mgr"), password = "pw-123456789")

        val blank = client.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "  ", managerId = managerId, memberIds = emptyList()))
        }
        assertEquals(HttpStatusCode.BadRequest, blank.status)

        val oversized = client.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "x".repeat(101), managerId = managerId, memberIds = emptyList()))
        }
        assertEquals(HttpStatusCode.BadRequest, oversized.status)
    }

    @Test
    fun `team create and update reject rosters above the member cap with 400`() = testApplication {
        usePostgresTestcontainer()
        val client = adminClient()
        val managerId = TestUsers.seed(email = uniqueEmail("capmgr"), password = "pw-123456789")
        // 201 distinct ids — over the MAX_TEAM_MEMBERS = 200 cap; the shape check fires before
        // any per-id existence/deactivation lookups, so fabricated ids never reach the DB.
        val oversizedRoster = (1_000_000u until 1_000_201u).toList()

        val create = client.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "cap-${java.util.UUID.randomUUID()}", managerId = managerId, memberIds = oversizedRoster))
        }
        assertEquals(HttpStatusCode.BadRequest, create.status)
        assertEquals("A team may have at most 200 members", create.body<ProblemDetail>().detail)

        val teamId = TestServices.teams.create(
            Team(name = "cap-${java.util.UUID.randomUUID()}", managerId = managerId),
        )
        val update = client.put("/api/v1/teams/$teamId") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "still-fine", managerId = managerId, memberIds = oversizedRoster))
        }
        assertEquals(HttpStatusCode.BadRequest, update.status)
        assertEquals("A team may have at most 200 members", update.body<ProblemDetail>().detail)
    }

    @Test
    fun `template create rejects blank or oversized names with 400`() = testApplication {
        usePostgresTestcontainer()
        val client = adminClient()

        val blank = client.post("/api/v1/templates") {
            contentType(ContentType.Application.Json)
            setBody(Template(name = " ", content = "body"))
        }
        assertEquals(HttpStatusCode.BadRequest, blank.status)

        val oversized = client.post("/api/v1/templates") {
            contentType(ContentType.Application.Json)
            setBody(Template(name = "x".repeat(101), content = "body"))
        }
        assertEquals(HttpStatusCode.BadRequest, oversized.status)
    }

    @Test
    fun `template content is capped at 5000 - 400 over, 201 at the boundary`() = testApplication {
        usePostgresTestcontainer()
        val client = adminClient()

        val over = client.post("/api/v1/templates") {
            contentType(ContentType.Application.Json)
            setBody(Template(name = uniqueEmail("tpl-over"), content = "x".repeat(5001)))
        }
        assertEquals(HttpStatusCode.BadRequest, over.status)

        val atLimit = client.post("/api/v1/templates") {
            contentType(ContentType.Application.Json)
            setBody(Template(name = uniqueEmail("tpl-max"), content = "x".repeat(5000)))
        }
        assertEquals(HttpStatusCode.Created, atLimit.status)
    }

    @Test
    fun `feedback content and requester message are length-capped with 400`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("fb-len")
        val callerId = TestUsers.seed(email = email, password = "pw-123456789", roles = emptySet())
        val providerId = TestUsers.seed(email = uniqueEmail("fb-len-p"), password = "pw", roles = emptySet())
        val client = authedClient(email, "pw-123456789")

        // Self-reflection draft (provider == subject == caller) keeps the party rules simple.
        suspend fun create(content: String) = client.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                FeedbackCreateRequest(
                    subjectId = callerId,
                    providerId = callerId,
                    visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                    status = FeedbackStatus.DRAFT,
                    content = content,
                ),
            )
        }

        assertEquals(HttpStatusCode.BadRequest, create("x".repeat(5001)).status)
        val atLimit = create("x".repeat(5000))
        assertEquals(HttpStatusCode.Created, atLimit.status)

        // The PUT edit path applies the same content cap (reuse the draft — a second
        // in-progress create for the same parties would hit the no-duplicate 409).
        val id = atLimit.body<FeedbackResponse>().id
        val putOver = client.put("/api/v1/feedbacks/$id") {
            contentType(ContentType.Application.Json)
            setBody(FeedbackContentUpdate(content = "x".repeat(5001), visibility = FeedbackVisibility.PROVIDER_SUBJECT))
        }
        assertEquals(HttpStatusCode.BadRequest, putOver.status)

        // Requester message (create-only field) has its own 1000 cap.
        val requestOver = client.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                FeedbackCreateRequest(
                    requesterId = callerId,
                    subjectId = callerId,
                    providerId = providerId,
                    visibility = FeedbackVisibility.PROVIDER_REQUESTER,
                    status = FeedbackStatus.REQUESTED,
                    requesterMessage = "x".repeat(1001),
                ),
            )
        }
        assertEquals(HttpStatusCode.BadRequest, requestOver.status)
    }
}
