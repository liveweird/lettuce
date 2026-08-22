package ch.nokillswit

import ch.nokillswit.auth.LoginRequest
import ch.nokillswit.auth.LoginResponse
import ch.nokillswit.feedbacks.FeedbackCreateRequest
import ch.nokillswit.feedbacks.FeedbackPageResponse
import ch.nokillswit.feedbacks.FeedbackResponse
import ch.nokillswit.feedbacks.FeedbackContentUpdate
import ch.nokillswit.feedbacks.FeedbackStatus
import ch.nokillswit.feedbacks.FeedbackVisibility
import ch.nokillswit.teams.Team
import ch.nokillswit.teams.TeamResponse
import ch.nokillswit.users.UserRequest
import ch.nokillswit.users.UserUpdateRequest
import ch.nokillswit.users.UserResponse
import ch.nokillswit.users.UserRole
import io.ktor.client.call.body
import io.ktor.client.request.delete
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
import kotlin.test.assertTrue

class AuthorizationTest {


    @Test
    fun `login response carries userId and role`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("login")
        val id = TestUsers.seed(email = email, password = "pw-123456789", roles = emptySet())

        val response = jsonClient().post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(email, "pw-123456789"))
        }
        assertEquals(HttpStatusCode.OK, response.status)
        val body = response.body<LoginResponse>()
        assertEquals(id, body.userId)
        assertEquals(emptyList(), body.roles)
        assertTrue(body.token.isNotBlank())
    }

    @Test
    fun `non-admin POST users returns 403`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("plain")
        TestUsers.seed(email = email, password = "pw-123456789", roles = emptySet())

        val client = authedClient(email, "pw-123456789")
        val response = client.post("/api/v1/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest("Sneaky", uniqueEmail("new"), "pw-123456789"))
        }
        assertEquals(HttpStatusCode.Forbidden, response.status)
    }

    @Test
    fun `admin POST users may set roles, defaults to none otherwise`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw-123456789", roles = setOf(UserRole.ADMIN))
        val client = authedClient(adminEmail, "pw-123456789")

        val plain = client.post("/api/v1/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest("Plain", uniqueEmail("plain"), "pw-123456789"))
        }.body<UserResponse>()
        assertEquals(emptyList(), plain.roles)

        val elevated = client.post("/api/v1/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest("Boss", uniqueEmail("boss"), "pw-123456789", roles = listOf(UserRole.ADMIN)))
        }.body<UserResponse>()
        assertEquals(listOf(UserRole.ADMIN), elevated.roles)
    }

    @Test
    fun `non-admin GET other user returns 403, GET self returns 200`() = testApplication {
        usePostgresTestcontainer()
        val aliceEmail = uniqueEmail("alice")
        val aliceId = TestUsers.seed(email = aliceEmail, password = "pw-123456789", roles = emptySet())
        val bobId = TestUsers.seed(email = uniqueEmail("bob"), password = "pw-123456789", roles = emptySet())

        val aliceClient = authedClient(aliceEmail, "pw-123456789")
        assertEquals(HttpStatusCode.OK, aliceClient.get("/api/v1/users/$aliceId").status)
        assertEquals(HttpStatusCode.Forbidden, aliceClient.get("/api/v1/users/$bobId").status)
    }

    @Test
    fun `non-admin cannot escalate roles via PUT users`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("alice")
        val id = TestUsers.seed(email = email, password = "pw-123456789", roles = emptySet())
        val client = authedClient(email, "pw-123456789")

        val response = client.put("/api/v1/users/$id") {
            contentType(ContentType.Application.Json)
            setBody(UserUpdateRequest("Alice", email, roles = listOf(UserRole.ADMIN)))
        }
        assertEquals(HttpStatusCode.Forbidden, response.status)
    }

    @Test
    fun `non-admin self PUT without roles change succeeds`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("alice")
        val id = TestUsers.seed(email = email, password = "pw-123456789", roles = emptySet())
        val client = authedClient(email, "pw-123456789")

        val response = client.put("/api/v1/users/$id") {
            contentType(ContentType.Application.Json)
            setBody(UserUpdateRequest("Alice", email, roles = emptyList()))
        }
        assertEquals(HttpStatusCode.NoContent, response.status)
        val read = client.get("/api/v1/users/$id").body<UserResponse>()
        assertEquals("Alice", read.name)
        assertEquals(emptyList(), read.roles)
    }

    @Test
    fun `non-admin DELETE users returns 403`() = testApplication {
        usePostgresTestcontainer()
        val aliceEmail = uniqueEmail("alice")
        TestUsers.seed(email = aliceEmail, password = "pw-123456789", roles = emptySet())
        val victim = TestUsers.seed(email = uniqueEmail("victim"), password = "pw-123456789", roles = emptySet())

        val response = authedClient(aliceEmail, "pw-123456789").delete("/api/v1/users/$victim")
        assertEquals(HttpStatusCode.Forbidden, response.status)
    }

    @Test
    fun `admin can DELETE own account and afterwards cannot log in`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        val adminId = TestUsers.seed(email = adminEmail, password = "pw-123456789", roles = setOf(UserRole.ADMIN))

        val client = authedClient(adminEmail, "pw-123456789")
        val deleted = client.delete("/api/v1/users/$adminId")
        assertEquals(HttpStatusCode.NoContent, deleted.status)

        val loginAgain = jsonClient().post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(adminEmail, "pw-123456789"))
        }
        assertEquals(HttpStatusCode.Unauthorized, loginAgain.status)
    }

    @Test
    fun `non-admin cannot create a team naming someone else as manager`() = testApplication {
        usePostgresTestcontainer()
        val aliceEmail = uniqueEmail("alice")
        TestUsers.seed(email = aliceEmail, password = "pw-123456789", roles = emptySet())
        val otherMgr = TestUsers.seed(email = uniqueEmail("mgr"), password = "pw-123456789", roles = emptySet())
        val member = TestUsers.seed(email = uniqueEmail("m"), password = "pw-123456789", roles = emptySet())

        val response = authedClient(aliceEmail, "pw-123456789").post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "Sneaky", managerId = otherMgr, memberIds = listOf(member)))
        }
        assertEquals(HttpStatusCode.Forbidden, response.status)
    }

    @Test
    fun `non-manager cannot mutate team or its members`() = testApplication {
        usePostgresTestcontainer()
        val mgrEmail = uniqueEmail("mgr")
        val mgrId = TestUsers.seed(email = mgrEmail, password = "pw-123456789", roles = emptySet())
        val otherEmail = uniqueEmail("other")
        TestUsers.seed(email = otherEmail, password = "pw-123456789", roles = emptySet())
        val member = TestUsers.seed(email = uniqueEmail("m"), password = "pw-123456789", roles = emptySet())
        val newcomer = TestUsers.seed(email = uniqueEmail("n"), password = "pw-123456789", roles = emptySet())

        val mgrClient = authedClient(mgrEmail, "pw-123456789")
        val team = mgrClient.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "T", managerId = mgrId, memberIds = listOf(member)))
        }.body<TeamResponse>()

        val otherClient = authedClient(otherEmail, "pw-123456789")
        assertEquals(
            HttpStatusCode.Forbidden,
            otherClient.put("/api/v1/teams/${team.id}") {
                contentType(ContentType.Application.Json)
                setBody(Team(name = "Hijack", managerId = mgrId, memberIds = listOf(member)))
            }.status,
        )
        assertEquals(
            HttpStatusCode.Forbidden,
            otherClient.put("/api/v1/teams/${team.id}/members/$newcomer").status,
        )
        assertEquals(
            HttpStatusCode.Forbidden,
            otherClient.delete("/api/v1/teams/${team.id}/members/$member").status,
        )
        assertEquals(HttpStatusCode.Forbidden, otherClient.delete("/api/v1/teams/${team.id}").status)
    }

    @Test
    fun `any authenticated user may GET a team`() = testApplication {
        usePostgresTestcontainer()
        val mgrEmail = uniqueEmail("mgr")
        val mgrId = TestUsers.seed(email = mgrEmail, password = "pw-123456789", roles = emptySet())
        val onlooker = uniqueEmail("onlooker")
        TestUsers.seed(email = onlooker, password = "pw-123456789", roles = emptySet())
        val member = TestUsers.seed(email = uniqueEmail("m"), password = "pw-123456789", roles = emptySet())

        val team = authedClient(mgrEmail, "pw-123456789").post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "Public", managerId = mgrId, memberIds = listOf(member)))
        }.body<TeamResponse>()

        val response = authedClient(onlooker, "pw-123456789").get("/api/v1/teams/${team.id}")
        assertEquals(HttpStatusCode.OK, response.status)
    }

    @Test
    fun `feedback visibility matrix is enforced on GET`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw-123456789", roles = setOf(UserRole.ADMIN))

        val providerEmail = uniqueEmail("provider")
        val providerId = TestUsers.seed(email = providerEmail, password = "pw-123456789", roles = emptySet())
        val subjectEmail = uniqueEmail("subject")
        val subjectId = TestUsers.seed(email = subjectEmail, password = "pw-123456789", roles = emptySet())
        val requesterEmail = uniqueEmail("requester")
        val requesterId = TestUsers.seed(email = requesterEmail, password = "pw-123456789", roles = emptySet())
        val strangerEmail = uniqueEmail("stranger")
        TestUsers.seed(email = strangerEmail, password = "pw-123456789", roles = emptySet())

        val providerClient = authedClient(providerEmail, "pw-123456789")
        val subjectClient = authedClient(subjectEmail, "pw-123456789")
        val requesterClient = authedClient(requesterEmail, "pw-123456789")
        val strangerClient = authedClient(strangerEmail, "pw-123456789")
        val adminClient = authedClient(adminEmail, "pw-123456789")

        // Visibility only governs access once a feedback is delivered, so the matrix is exercised at
        // SENT — under the visibility-and-status read rules, a non-terminal status (e.g. REQUESTED)
        // would gate every non-provider read regardless of visibility.
        suspend fun createWith(visibility: FeedbackVisibility): UInt {
            val created = providerClient.post("/api/v1/feedbacks") {
                contentType(ContentType.Application.Json)
                setBody(
                    FeedbackCreateRequest(
                        // A requester is incompatible with PROVIDER_SUBJECT visibility (server invariant),
                        // so that row carries none; the matrix's "requester" actor is then a non-party
                        // user and is expected to be Forbidden for PROVIDER_SUBJECT anyway.
                        requesterId = if (visibility == FeedbackVisibility.PROVIDER_SUBJECT) null else requesterId,
                        subjectId = subjectId,
                        providerId = providerId,
                        visibility = visibility,
                        status = FeedbackStatus.SENT,
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
                "admin" to HttpStatusCode.Forbidden,
            ),
            FeedbackVisibility.PROVIDER_REQUESTER to mapOf(
                "provider" to HttpStatusCode.OK,
                "subject" to HttpStatusCode.Forbidden,
                "requester" to HttpStatusCode.OK,
                "stranger" to HttpStatusCode.Forbidden,
                "admin" to HttpStatusCode.Forbidden,
            ),
            FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT to mapOf(
                "provider" to HttpStatusCode.OK,
                "subject" to HttpStatusCode.OK,
                "requester" to HttpStatusCode.OK,
                "stranger" to HttpStatusCode.Forbidden,
                "admin" to HttpStatusCode.Forbidden,
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
                val response = c.get("/api/v1/feedbacks/$id")
                assertEquals(
                    expectations.getValue(label),
                    response.status,
                    "visibility=$visibility actor=$label",
                )
            }
        }
    }

    @Test
    fun `manager may read but not write a subordinate's feedback`() = testApplication {
        usePostgresTestcontainer()
        val providerEmail = uniqueEmail("provider")
        val providerId = TestUsers.seed(email = providerEmail, password = "pw-123456789", roles = emptySet())
        val subjectEmail = uniqueEmail("subject")
        val subjectId = TestUsers.seed(email = subjectEmail, password = "pw-123456789", roles = emptySet())
        val managerEmail = uniqueEmail("manager")
        val managerId = TestUsers.seed(email = managerEmail, password = "pw-123456789", roles = emptySet())
        val strangerEmail = uniqueEmail("stranger")
        TestUsers.seed(email = strangerEmail, password = "pw-123456789", roles = emptySet())

        val providerClient = authedClient(providerEmail, "pw-123456789")
        val managerClient = authedClient(managerEmail, "pw-123456789")
        val strangerClient = authedClient(strangerEmail, "pw-123456789")

        // The manager manages a team the subject belongs to.
        managerClient.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "Squad", managerId = managerId, memberIds = listOf(subjectId)))
        }

        // PROVIDER_SUBJECT feedback would normally hide from anyone but provider/subject.
        val feedback = providerClient.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                FeedbackCreateRequest(
                    subjectId = subjectId,
                    providerId = providerId,
                    visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                    status = FeedbackStatus.DRAFT,
                    content = "private",
                ),
            )
        }.body<FeedbackResponse>()

        // While the feedback is an unfinished DRAFT it is the provider's private work:
        // even the subject's manager may not read it.
        assertEquals(HttpStatusCode.Forbidden, managerClient.get("/api/v1/feedbacks/${feedback.id}").status)

        // The provider delivers it.
        val sent = providerClient.post("/api/v1/feedbacks/${feedback.id}/send")
        assertEquals(HttpStatusCode.NoContent, sent.status)

        // Once delivered, the manager of the subject's team may read it…
        assertEquals(HttpStatusCode.OK, managerClient.get("/api/v1/feedbacks/${feedback.id}").status)
        // …a stranger who manages nobody still may not.
        assertEquals(HttpStatusCode.Forbidden, strangerClient.get("/api/v1/feedbacks/${feedback.id}").status)
        // …and read access does not grant write access.
        assertEquals(
            HttpStatusCode.Forbidden,
            managerClient.put("/api/v1/feedbacks/${feedback.id}") {
                contentType(ContentType.Application.Json)
                setBody(
                    FeedbackCreateRequest(
                        subjectId = subjectId,
                        providerId = providerId,
                        visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                        status = FeedbackStatus.WITHDRAWN,
                        content = "hijacked",
                    ),
                )
            }.status,
        )
    }

    @Test
    fun `a manager higher up the management chain may read a delivered feedback but not write it`() = testApplication {
        usePostgresTestcontainer()
        val providerEmail = uniqueEmail("provider")
        val providerId = TestUsers.seed(email = providerEmail, password = "pw-123456789", roles = emptySet())
        val subjectEmail = uniqueEmail("subject")
        val subjectId = TestUsers.seed(email = subjectEmail, password = "pw-123456789", roles = emptySet())
        val midManagerEmail = uniqueEmail("mid-manager")
        val midManagerId = TestUsers.seed(email = midManagerEmail, password = "pw-123456789", roles = emptySet())
        val grandManagerEmail = uniqueEmail("grand-manager")
        val grandManagerId = TestUsers.seed(email = grandManagerEmail, password = "pw-123456789", roles = emptySet())

        val providerClient = authedClient(providerEmail, "pw-123456789")
        val midManagerClient = authedClient(midManagerEmail, "pw-123456789")
        val grandManagerClient = authedClient(grandManagerEmail, "pw-123456789")

        // Two hops: the subject reports to the mid manager, who reports to the grand manager.
        midManagerClient.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "Squad", managerId = midManagerId, memberIds = listOf(subjectId)))
        }
        grandManagerClient.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "Leads", managerId = grandManagerId, memberIds = listOf(midManagerId)))
        }

        val feedback = providerClient.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                FeedbackCreateRequest(
                    subjectId = subjectId,
                    providerId = providerId,
                    visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                    status = FeedbackStatus.DRAFT,
                    content = "private",
                ),
            )
        }.body<FeedbackResponse>()

        // An unfinished DRAFT stays private from the whole management chain.
        assertEquals(HttpStatusCode.Forbidden, grandManagerClient.get("/api/v1/feedbacks/${feedback.id}").status)

        assertEquals(HttpStatusCode.NoContent, providerClient.post("/api/v1/feedbacks/${feedback.id}/send").status)

        // Once delivered, the manager's manager may read the record and its history…
        assertEquals(HttpStatusCode.OK, grandManagerClient.get("/api/v1/feedbacks/${feedback.id}").status)
        assertEquals(HttpStatusCode.OK, grandManagerClient.get("/api/v1/feedbacks/${feedback.id}/events").status)
        // …but read access still does not grant write access.
        assertEquals(
            HttpStatusCode.Forbidden,
            grandManagerClient.put("/api/v1/feedbacks/${feedback.id}") {
                contentType(ContentType.Application.Json)
                setBody(
                    FeedbackCreateRequest(
                        subjectId = subjectId,
                        providerId = providerId,
                        visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                        status = FeedbackStatus.WITHDRAWN,
                        content = "hijacked",
                    ),
                )
            }.status,
        )
    }

    @Test
    fun `a management cycle terminates and still grants transitive reads`() = testApplication {
        usePostgresTestcontainer()
        // A manages a team containing B; B manages a team containing A and C — a cycle A→B→A.
        val aEmail = uniqueEmail("cycle-a")
        val aId = TestUsers.seed(email = aEmail, password = "pw-123456789", roles = emptySet())
        val bEmail = uniqueEmail("cycle-b")
        val bId = TestUsers.seed(email = bEmail, password = "pw-123456789", roles = emptySet())
        val cEmail = uniqueEmail("cycle-c")
        val cId = TestUsers.seed(email = cEmail, password = "pw-123456789", roles = emptySet())
        val providerEmail = uniqueEmail("provider")
        val providerId = TestUsers.seed(email = providerEmail, password = "pw-123456789", roles = emptySet())

        val aClient = authedClient(aEmail, "pw-123456789")
        val bClient = authedClient(bEmail, "pw-123456789")
        val providerClient = authedClient(providerEmail, "pw-123456789")

        aClient.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "Loop-A", managerId = aId, memberIds = listOf(bId)))
        }
        bClient.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "Loop-B", managerId = bId, memberIds = listOf(aId, cId)))
        }

        val feedback = providerClient.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                FeedbackCreateRequest(
                    subjectId = cId,
                    providerId = providerId,
                    visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                    status = FeedbackStatus.SENT,
                    content = "delivered",
                ),
            )
        }.body<FeedbackResponse>()

        // A transitively manages C (via B); both the single read and the widened team list
        // terminate despite the A→B→A cycle.
        assertEquals(HttpStatusCode.OK, aClient.get("/api/v1/feedbacks/${feedback.id}").status)
        val teamPage = aClient.get("/api/v1/feedbacks?view=team&includeIndirect=true")
            .body<FeedbackPageResponse>()
        assertTrue(teamPage.items.any { it.id == feedback.id })
    }

    @Test
    fun `non-provider cannot write feedback`() = testApplication {
        usePostgresTestcontainer()
        val providerEmail = uniqueEmail("provider")
        val providerId = TestUsers.seed(email = providerEmail, password = "pw-123456789", roles = emptySet())
        val subjectEmail = uniqueEmail("subject")
        val subjectId = TestUsers.seed(email = subjectEmail, password = "pw-123456789", roles = emptySet())

        val providerClient = authedClient(providerEmail, "pw-123456789")
        val created = providerClient.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                FeedbackCreateRequest(
                    subjectId = subjectId,
                    providerId = providerId,
                    visibility = FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT,
                    status = FeedbackStatus.DRAFT,
                ),
            )
        }.body<FeedbackResponse>()

        val subjectClient = authedClient(subjectEmail, "pw-123456789")
        val put = subjectClient.put("/api/v1/feedbacks/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(
                FeedbackCreateRequest(
                    subjectId = subjectId,
                    providerId = providerId,
                    visibility = FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT,
                    status = FeedbackStatus.SENT,
                    content = "hijacked",
                ),
            )
        }
        assertEquals(HttpStatusCode.Forbidden, put.status)

        val delete = subjectClient.delete("/api/v1/feedbacks/${created.id}")
        assertEquals(HttpStatusCode.Forbidden, delete.status)
    }

    @Test
    fun `admin has no special feedback access - non-party reads and writes are denied`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw-123456789", roles = setOf(UserRole.ADMIN))
        val providerEmail = uniqueEmail("provider")
        val providerId = TestUsers.seed(email = providerEmail, password = "pw-123456789", roles = emptySet())
        val subjectEmail = uniqueEmail("subject")
        val subjectId = TestUsers.seed(email = subjectEmail, password = "pw-123456789", roles = emptySet())

        val adminClient = authedClient(adminEmail, "pw-123456789")
        val providerClient = authedClient(providerEmail, "pw-123456789")

        val created = providerClient.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                FeedbackCreateRequest(
                    subjectId = subjectId,
                    providerId = providerId,
                    visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                    status = FeedbackStatus.SENT,
                    content = "delivered",
                ),
            )
        }.body<FeedbackResponse>()

        // A non-party admin may not read a non-public feedback — nor its events, nor probe
        // the pair via duplicate-check (the party rule applies to everyone now).
        assertEquals(HttpStatusCode.Forbidden, adminClient.get("/api/v1/feedbacks/${created.id}").status)
        assertEquals(HttpStatusCode.Forbidden, adminClient.get("/api/v1/feedbacks/${created.id}/events").status)
        assertEquals(
            HttpStatusCode.Forbidden,
            adminClient.get("/api/v1/feedbacks/duplicate-check?subjectId=$subjectId&providerId=$providerId").status,
        )

        // Writes are denied like before.
        assertEquals(
            HttpStatusCode.Forbidden,
            adminClient.post("/api/v1/feedbacks/${created.id}/withdraw").status,
        )
        assertEquals(
            HttpStatusCode.Forbidden,
            adminClient.delete("/api/v1/feedbacks/${created.id}").status,
        )

        // The denied attempts left the feedback untouched, and the provider can still write.
        assertEquals(
            HttpStatusCode.NoContent,
            providerClient.post("/api/v1/feedbacks/${created.id}/withdraw").status,
        )
    }

    @Test
    fun `admin reads a PUBLIC delivered feedback like any user - standard rights are kept`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw-123456789", roles = setOf(UserRole.ADMIN))
        val providerEmail = uniqueEmail("provider")
        val providerId = TestUsers.seed(email = providerEmail, password = "pw-123456789", roles = emptySet())
        val subjectId = TestUsers.seed(email = uniqueEmail("subject"), password = "pw-123456789", roles = emptySet())

        val created = authedClient(providerEmail, "pw-123456789").post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                FeedbackCreateRequest(
                    subjectId = subjectId,
                    providerId = providerId,
                    visibility = FeedbackVisibility.PUBLIC,
                    status = FeedbackStatus.SENT,
                    content = "public praise",
                ),
            )
        }.body<FeedbackResponse>()

        assertEquals(HttpStatusCode.OK, authedClient(adminEmail, "pw-123456789").get("/api/v1/feedbacks/${created.id}").status)
    }

    @Test
    fun `admin may edit a draft they provide`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        val adminId = TestUsers.seed(email = adminEmail, password = "pw-123456789", roles = setOf(UserRole.ADMIN))
        val subjectEmail = uniqueEmail("subject")
        val subjectId = TestUsers.seed(email = subjectEmail, password = "pw-123456789", roles = emptySet())

        val adminClient = authedClient(adminEmail, "pw-123456789")

        // The admin creates a feedback in which they are the provider (the normal "Provide
        // feedback" flow) — write access follows provider identity, not role.
        val created = adminClient.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                FeedbackCreateRequest(
                    subjectId = subjectId,
                    providerId = adminId,
                    visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                    status = FeedbackStatus.DRAFT,
                    content = "first draft",
                ),
            )
        }.body<FeedbackResponse>()

        // Edit the draft content (content/visibility PUT) → allowed.
        assertEquals(
            HttpStatusCode.NoContent,
            adminClient.put("/api/v1/feedbacks/${created.id}") {
                contentType(ContentType.Application.Json)
                setBody(
                    FeedbackContentUpdate(
                        content = "revised draft",
                        visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                    ),
                )
            }.status,
        )
        assertEquals(
            "revised draft",
            adminClient.get("/api/v1/feedbacks/${created.id}").body<FeedbackResponse>().content,
        )

        // …and they can advance their own draft (DRAFT → SENT).
        assertEquals(
            HttpStatusCode.NoContent,
            adminClient.post("/api/v1/feedbacks/${created.id}/send").status,
        )
        assertEquals(
            FeedbackStatus.SENT,
            adminClient.get("/api/v1/feedbacks/${created.id}").body<FeedbackResponse>().status,
        )
    }

    @Test
    fun `a non-party cannot create feedback attributed to others`() = testApplication {
        usePostgresTestcontainer()
        val providerId = TestUsers.seed(email = uniqueEmail("provider"), password = "pw-123456789", roles = emptySet())
        val subjectId = TestUsers.seed(email = uniqueEmail("subject"), password = "pw-123456789", roles = emptySet())
        val strangerEmail = uniqueEmail("stranger")
        TestUsers.seed(email = strangerEmail, password = "pw-123456789", roles = emptySet())

        // The stranger is neither provider nor requester → must not forge feedback authored by someone else.
        val response = authedClient(strangerEmail, "pw-123456789").post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                FeedbackCreateRequest(
                    subjectId = subjectId,
                    providerId = providerId,
                    visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                    status = FeedbackStatus.DRAFT,
                    content = "forged",
                ),
            )
        }
        assertEquals(HttpStatusCode.Forbidden, response.status)
    }

    @Test
    fun `the requester may create a requested feedback`() = testApplication {
        usePostgresTestcontainer()
        val providerId = TestUsers.seed(email = uniqueEmail("provider"), password = "pw-123456789", roles = emptySet())
        val subjectId = TestUsers.seed(email = uniqueEmail("subject"), password = "pw-123456789", roles = emptySet())
        val requesterEmail = uniqueEmail("requester")
        val requesterId = TestUsers.seed(email = requesterEmail, password = "pw-123456789", roles = emptySet())

        val response = authedClient(requesterEmail, "pw-123456789").post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                FeedbackCreateRequest(
                    requesterId = requesterId,
                    subjectId = subjectId,
                    providerId = providerId,
                    visibility = FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT,
                    status = FeedbackStatus.REQUESTED,
                ),
            )
        }
        assertEquals(HttpStatusCode.Created, response.status)
    }

    @Test
    fun `an admin may not create feedback on behalf of others`() = testApplication {
        // The management role has no feedback privileges: the party rule applies to everyone.
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw-123456789", roles = setOf(UserRole.ADMIN))
        val providerId = TestUsers.seed(email = uniqueEmail("provider"), password = "pw-123456789", roles = emptySet())
        val subjectId = TestUsers.seed(email = uniqueEmail("subject"), password = "pw-123456789", roles = emptySet())

        val response = authedClient(adminEmail, "pw-123456789").post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                FeedbackCreateRequest(
                    subjectId = subjectId,
                    providerId = providerId,
                    visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                    status = FeedbackStatus.DRAFT,
                    content = "admin-authored",
                ),
            )
        }
        assertEquals(HttpStatusCode.Forbidden, response.status)
    }

    @Test
    fun `a team manager may edit the team but not reassign the manager`() = testApplication {
        usePostgresTestcontainer()
        val managerEmail = uniqueEmail("manager")
        val managerId = TestUsers.seed(email = managerEmail, password = "pw-123456789", roles = emptySet())
        val otherId = TestUsers.seed(email = uniqueEmail("other"), password = "pw-123456789", roles = emptySet())
        val mgr = authedClient(managerEmail, "pw-123456789")

        val team = mgr.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "Squad", managerId = managerId, memberIds = emptyList()))
        }.body<TeamResponse>()

        // Editing the team (manager unchanged) is allowed.
        assertEquals(
            HttpStatusCode.NoContent,
            mgr.put("/api/v1/teams/${team.id}") {
                contentType(ContentType.Application.Json)
                setBody(Team(name = "Squad Renamed", managerId = managerId, memberIds = emptyList()))
            }.status,
        )
        // Reassigning the manager to someone else is admin-only → forbidden for a manager.
        assertEquals(
            HttpStatusCode.Forbidden,
            mgr.put("/api/v1/teams/${team.id}") {
                contentType(ContentType.Application.Json)
                setBody(Team(name = "Squad Renamed", managerId = otherId, memberIds = emptyList()))
            }.status,
        )
    }

    @Test
    fun `unauthorized reassignment answers 403 even with an invalid payload`() = testApplication {
        usePostgresTestcontainer()
        val managerEmail = uniqueEmail("manager")
        val managerId = TestUsers.seed(email = managerEmail, password = "pw-123456789", roles = emptySet())
        val otherId = TestUsers.seed(email = uniqueEmail("other"), password = "pw-123456789", roles = emptySet())
        val mgr = authedClient(managerEmail, "pw-123456789")

        val team = mgr.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "Squad", managerId = managerId, memberIds = emptyList()))
        }.body<TeamResponse>()

        // Handoff attempt (admin-only) combined with an over-long name: authz wins → 403, not 400.
        assertEquals(
            HttpStatusCode.Forbidden,
            mgr.put("/api/v1/teams/${team.id}") {
                contentType(ContentType.Application.Json)
                setBody(Team(name = "x".repeat(101), managerId = otherId, memberIds = emptyList()))
            }.status,
        )
    }

    @Test
    fun `unauthorized role change answers 403 even with an invalid payload`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("plain")
        val id = TestUsers.seed(email = email, password = "pw-123456789", roles = emptySet())
        val client = authedClient(email, "pw-123456789")

        // Self-edit escalating to ADMIN (admin-only) with an invalid email: authz wins → 403, not 400.
        assertEquals(
            HttpStatusCode.Forbidden,
            client.put("/api/v1/users/$id") {
                contentType(ContentType.Application.Json)
                setBody(UserUpdateRequest(name = "Plain", email = "not-an-email", roles = listOf(UserRole.ADMIN)))
            }.status,
        )
    }

    @Test
    fun `an admin may reassign a team's manager`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw-123456789", roles = setOf(UserRole.ADMIN))
        val managerEmail = uniqueEmail("manager")
        val managerId = TestUsers.seed(email = managerEmail, password = "pw-123456789", roles = emptySet())
        val otherId = TestUsers.seed(email = uniqueEmail("other"), password = "pw-123456789", roles = emptySet())

        val team = authedClient(managerEmail, "pw-123456789").post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "Squad", managerId = managerId, memberIds = emptyList()))
        }.body<TeamResponse>()

        assertEquals(
            HttpStatusCode.NoContent,
            authedClient(adminEmail, "pw-123456789").put("/api/v1/teams/${team.id}") {
                contentType(ContentType.Application.Json)
                setBody(Team(name = "Squad", managerId = otherId, memberIds = emptyList()))
            }.status,
        )
    }
}
