package ch.nokillswit

import ch.nokillswit.auth.LoginRequest
import ch.nokillswit.auth.LoginResponse
import ch.nokillswit.feedbacks.Feedback
import ch.nokillswit.feedbacks.FeedbackResponse
import ch.nokillswit.feedbacks.FeedbackStatus
import ch.nokillswit.feedbacks.FeedbackVisibility
import ch.nokillswit.teams.Team
import ch.nokillswit.teams.TeamResponse
import ch.nokillswit.users.UserRequest
import ch.nokillswit.users.UserResponse
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
import io.ktor.client.request.setBody
import io.ktor.serialization.kotlinx.json.json
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class AuthorizationTest {

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

    @Test
    fun `login response carries userId and role`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("login")
        val id = TestUsers.seed(email = email, password = "pw", role = UserRole.USER)

        val response = jsonClient().post("/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(email, "pw"))
        }
        assertEquals(HttpStatusCode.OK, response.status)
        val body = response.body<LoginResponse>()
        assertEquals(id, body.userId)
        assertEquals(UserRole.USER, body.role)
        assertTrue(body.token.isNotBlank())
    }

    @Test
    fun `non-admin POST users returns 403`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("plain")
        TestUsers.seed(email = email, password = "pw", role = UserRole.USER)

        val client = authedClient(email, "pw")
        val response = client.post("/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest("Sneaky", uniqueEmail("new"), "pw"))
        }
        assertEquals(HttpStatusCode.Forbidden, response.status)
    }

    @Test
    fun `admin POST users may set role, defaults to USER otherwise`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw", role = UserRole.ADMIN)
        val client = authedClient(adminEmail, "pw")

        val plain = client.post("/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest("Plain", uniqueEmail("plain"), "pw"))
        }.body<UserResponse>()
        assertEquals(UserRole.USER, plain.role)

        val elevated = client.post("/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest("Boss", uniqueEmail("boss"), "pw", role = UserRole.ADMIN))
        }.body<UserResponse>()
        assertEquals(UserRole.ADMIN, elevated.role)
    }

    @Test
    fun `non-admin GET other user returns 403, GET self returns 200`() = testApplication {
        usePostgresTestcontainer()
        val aliceEmail = uniqueEmail("alice")
        val aliceId = TestUsers.seed(email = aliceEmail, password = "pw", role = UserRole.USER)
        val bobId = TestUsers.seed(email = uniqueEmail("bob"), password = "pw", role = UserRole.USER)

        val aliceClient = authedClient(aliceEmail, "pw")
        assertEquals(HttpStatusCode.OK, aliceClient.get("/users/$aliceId").status)
        assertEquals(HttpStatusCode.Forbidden, aliceClient.get("/users/$bobId").status)
    }

    @Test
    fun `non-admin cannot escalate role via PUT users`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("alice")
        val id = TestUsers.seed(email = email, password = "pw", role = UserRole.USER)
        val client = authedClient(email, "pw")

        val response = client.put("/users/$id") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest("Alice", email, "pw", role = UserRole.ADMIN))
        }
        assertEquals(HttpStatusCode.Forbidden, response.status)
    }

    @Test
    fun `non-admin self PUT without role change succeeds`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("alice")
        val id = TestUsers.seed(email = email, password = "pw", role = UserRole.USER)
        val client = authedClient(email, "pw")

        val response = client.put("/users/$id") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest("Alice", email, "pw"))
        }
        assertEquals(HttpStatusCode.NoContent, response.status)
        val read = client.get("/users/$id").body<UserResponse>()
        assertEquals("Alice", read.name)
        assertEquals(UserRole.USER, read.role)
    }

    @Test
    fun `non-admin DELETE users returns 403`() = testApplication {
        usePostgresTestcontainer()
        val aliceEmail = uniqueEmail("alice")
        TestUsers.seed(email = aliceEmail, password = "pw", role = UserRole.USER)
        val victim = TestUsers.seed(email = uniqueEmail("victim"), password = "pw", role = UserRole.USER)

        val response = authedClient(aliceEmail, "pw").delete("/users/$victim")
        assertEquals(HttpStatusCode.Forbidden, response.status)
    }

    @Test
    fun `non-admin cannot create a team naming someone else as manager`() = testApplication {
        usePostgresTestcontainer()
        val aliceEmail = uniqueEmail("alice")
        TestUsers.seed(email = aliceEmail, password = "pw", role = UserRole.USER)
        val otherMgr = TestUsers.seed(email = uniqueEmail("mgr"), password = "pw", role = UserRole.USER)
        val member = TestUsers.seed(email = uniqueEmail("m"), password = "pw", role = UserRole.USER)

        val response = authedClient(aliceEmail, "pw").post("/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "Sneaky", managerId = otherMgr, memberIds = listOf(member)))
        }
        assertEquals(HttpStatusCode.Forbidden, response.status)
    }

    @Test
    fun `non-manager cannot mutate team or its members`() = testApplication {
        usePostgresTestcontainer()
        val mgrEmail = uniqueEmail("mgr")
        val mgrId = TestUsers.seed(email = mgrEmail, password = "pw", role = UserRole.USER)
        val otherEmail = uniqueEmail("other")
        TestUsers.seed(email = otherEmail, password = "pw", role = UserRole.USER)
        val member = TestUsers.seed(email = uniqueEmail("m"), password = "pw", role = UserRole.USER)
        val newcomer = TestUsers.seed(email = uniqueEmail("n"), password = "pw", role = UserRole.USER)

        val mgrClient = authedClient(mgrEmail, "pw")
        val team = mgrClient.post("/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "T", managerId = mgrId, memberIds = listOf(member)))
        }.body<TeamResponse>()

        val otherClient = authedClient(otherEmail, "pw")
        assertEquals(
            HttpStatusCode.Forbidden,
            otherClient.put("/teams/${team.id}") {
                contentType(ContentType.Application.Json)
                setBody(Team(name = "Hijack", managerId = mgrId, memberIds = listOf(member)))
            }.status,
        )
        assertEquals(
            HttpStatusCode.Forbidden,
            otherClient.put("/teams/${team.id}/members/$newcomer").status,
        )
        assertEquals(
            HttpStatusCode.Forbidden,
            otherClient.delete("/teams/${team.id}/members/$member").status,
        )
        assertEquals(HttpStatusCode.Forbidden, otherClient.delete("/teams/${team.id}").status)
    }

    @Test
    fun `any authenticated user may GET a team`() = testApplication {
        usePostgresTestcontainer()
        val mgrEmail = uniqueEmail("mgr")
        val mgrId = TestUsers.seed(email = mgrEmail, password = "pw", role = UserRole.USER)
        val onlooker = uniqueEmail("onlooker")
        TestUsers.seed(email = onlooker, password = "pw", role = UserRole.USER)
        val member = TestUsers.seed(email = uniqueEmail("m"), password = "pw", role = UserRole.USER)

        val team = authedClient(mgrEmail, "pw").post("/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "Public", managerId = mgrId, memberIds = listOf(member)))
        }.body<TeamResponse>()

        val response = authedClient(onlooker, "pw").get("/teams/${team.id}")
        assertEquals(HttpStatusCode.OK, response.status)
    }

    @Test
    fun `feedback visibility matrix is enforced on GET`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw", role = UserRole.ADMIN)

        val providerEmail = uniqueEmail("provider")
        val providerId = TestUsers.seed(email = providerEmail, password = "pw", role = UserRole.USER)
        val subjectEmail = uniqueEmail("subject")
        val subjectId = TestUsers.seed(email = subjectEmail, password = "pw", role = UserRole.USER)
        val requesterEmail = uniqueEmail("requester")
        val requesterId = TestUsers.seed(email = requesterEmail, password = "pw", role = UserRole.USER)
        val strangerEmail = uniqueEmail("stranger")
        TestUsers.seed(email = strangerEmail, password = "pw", role = UserRole.USER)

        val providerClient = authedClient(providerEmail, "pw")
        val subjectClient = authedClient(subjectEmail, "pw")
        val requesterClient = authedClient(requesterEmail, "pw")
        val strangerClient = authedClient(strangerEmail, "pw")
        val adminClient = authedClient(adminEmail, "pw")

        suspend fun createWith(visibility: FeedbackVisibility): UInt {
            val created = providerClient.post("/feedbacks") {
                contentType(ContentType.Application.Json)
                setBody(
                    Feedback(
                        requesterId = requesterId,
                        subjectId = subjectId,
                        providerId = providerId,
                        visibility = visibility,
                        status = FeedbackStatus.REQUESTED,
                    ),
                )
            }
            assertEquals(HttpStatusCode.Created, created.status, "create $visibility")
            return created.body<FeedbackResponse>().id
        }

        val matrix = listOf(
            FeedbackVisibility.PROVIDER_SUBJECT to mapOf(
                "provider" to HttpStatusCode.OK,
                "subject" to HttpStatusCode.OK,
                "requester" to HttpStatusCode.Forbidden,
                "stranger" to HttpStatusCode.Forbidden,
                "admin" to HttpStatusCode.OK,
            ),
            FeedbackVisibility.PROVIDER_REQUESTER to mapOf(
                "provider" to HttpStatusCode.OK,
                "subject" to HttpStatusCode.Forbidden,
                "requester" to HttpStatusCode.OK,
                "stranger" to HttpStatusCode.Forbidden,
                "admin" to HttpStatusCode.OK,
            ),
            FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT to mapOf(
                "provider" to HttpStatusCode.OK,
                "subject" to HttpStatusCode.OK,
                "requester" to HttpStatusCode.OK,
                "stranger" to HttpStatusCode.Forbidden,
                "admin" to HttpStatusCode.OK,
            ),
            FeedbackVisibility.PUBLIC to mapOf(
                "provider" to HttpStatusCode.OK,
                "subject" to HttpStatusCode.OK,
                "requester" to HttpStatusCode.OK,
                "stranger" to HttpStatusCode.OK,
                "admin" to HttpStatusCode.OK,
            ),
        )

        for ((visibility, expectations) in matrix) {
            val id = createWith(visibility)
            val actors = mapOf(
                "provider" to providerClient,
                "subject" to subjectClient,
                "requester" to requesterClient,
                "stranger" to strangerClient,
                "admin" to adminClient,
            )
            for ((label, c) in actors) {
                val response = c.get("/feedbacks/$id")
                assertEquals(
                    expectations.getValue(label),
                    response.status,
                    "visibility=$visibility actor=$label",
                )
            }
        }
    }

    @Test
    fun `non-provider cannot write feedback`() = testApplication {
        usePostgresTestcontainer()
        val providerEmail = uniqueEmail("provider")
        val providerId = TestUsers.seed(email = providerEmail, password = "pw", role = UserRole.USER)
        val subjectEmail = uniqueEmail("subject")
        val subjectId = TestUsers.seed(email = subjectEmail, password = "pw", role = UserRole.USER)

        val providerClient = authedClient(providerEmail, "pw")
        val created = providerClient.post("/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                Feedback(
                    subjectId = subjectId,
                    providerId = providerId,
                    visibility = FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT,
                    status = FeedbackStatus.DRAFT,
                ),
            )
        }.body<FeedbackResponse>()

        val subjectClient = authedClient(subjectEmail, "pw")
        val put = subjectClient.put("/feedbacks/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(
                Feedback(
                    subjectId = subjectId,
                    providerId = providerId,
                    visibility = FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT,
                    status = FeedbackStatus.SENT,
                    content = "hijacked",
                ),
            )
        }
        assertEquals(HttpStatusCode.Forbidden, put.status)

        val delete = subjectClient.delete("/feedbacks/${created.id}")
        assertEquals(HttpStatusCode.Forbidden, delete.status)
    }
}
