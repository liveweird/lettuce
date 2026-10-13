package ch.nokillswit

import ch.nokillswit.dictionaries.Dictionary
import ch.nokillswit.feedbacks.FeedbackCreateRequest
import ch.nokillswit.feedbacks.FeedbackStatus
import ch.nokillswit.feedbacks.FeedbackVisibility
import ch.nokillswit.goals.GoalCreateRequest
import ch.nokillswit.goals.GoalType
import ch.nokillswit.auth.LoginRequest
import ch.nokillswit.auth.LoginResponse
import ch.nokillswit.notifications.Notification
import ch.nokillswit.notifications.NotificationMirror
import ch.nokillswit.notifications.NotificationPageResponse
import ch.nokillswit.notifications.NotificationService
import ch.nokillswit.notifications.NotificationType
import ch.nokillswit.oneonones.OneOnOneCreateRequest
import ch.nokillswit.plugins.ProblemDetail
import ch.nokillswit.reviews.PerformanceReviewCreateRequest
import ch.nokillswit.teams.Team
import ch.nokillswit.teams.TeamMemberPageResponse
import ch.nokillswit.users.PasswordUpdateRequest
import ch.nokillswit.users.CareerPositionList
import ch.nokillswit.users.CareerPositionWrite
import ch.nokillswit.users.UserPageResponse
import ch.nokillswit.users.UserRequest
import ch.nokillswit.users.UserResponse
import io.ktor.client.call.body
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import java.time.LocalDate
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.r2dbc.selectAll
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import kotlinx.coroutines.flow.toList

/**
 * The reversible-deactivation feature end to end: the POST deactivate/activate transition
 * matrix, the unchanged-readability guarantee, the list filter, and the NEW-assignment blocks
 * (team member/manager, goal/1:1/review subordinate, feedback party — delta-validated).
 * Also pinned here (the "one consistent treatment" change): the `deactivated` flag + filter on
 * the `/teams/members` rows, immediate invalidation of a live access token, no notification row
 * ever minted for a deactivated or deleted recipient, and the ACCOUNT_REACTIVATED notice.
 * The login/lockout/refresh interactions live with their features (LoginTest,
 * LoginLockoutTest, RefreshTest); the password-reset skip in PasswordResetTest; the audit
 * events in AuditTest.
 */
class UserDeactivationTest {

    @Test
    fun `deactivate and activate walk the transition matrix, the user stays readable throughout`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw-123456789")
        val admin = authedClient(adminEmail, "pw-123456789")
        val target = admin.post("/api/v1/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "Dormant", email = uniqueEmail("dormant"), password = "pw-123456789"))
        }.body<UserResponse>()
        assertEquals(false, target.deactivated)

        assertEquals(HttpStatusCode.NoContent, admin.post("/api/v1/users/${target.id}/deactivate").status)
        // Unchanged readability: unlike a soft-delete, the user still reads 200 — only the flag moved.
        val deactivated = admin.get("/api/v1/users/${target.id}").body<UserResponse>()
        assertEquals(true, deactivated.deactivated)

        // Same-state repeats are 409, both directions (the house transition rule).
        assertEquals(HttpStatusCode.Conflict, admin.post("/api/v1/users/${target.id}/deactivate").status)
        assertEquals(HttpStatusCode.NoContent, admin.post("/api/v1/users/${target.id}/activate").status)
        assertEquals(false, admin.get("/api/v1/users/${target.id}").body<UserResponse>().deactivated)
        assertEquals(HttpStatusCode.Conflict, admin.post("/api/v1/users/${target.id}/activate").status)
    }

    @Test
    fun `deactivation closes the final career position and reactivation reopens it`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw-123456789")
        val admin = authedClient(adminEmail, "pw-123456789")
        val mgrEmail = uniqueEmail("cdx-m")
        val mgrId = TestUsers.seed(mgrEmail, "pw", roles = emptySet())
        val subId = TestUsers.seed(uniqueEmail("cdx-s"), "pw", roles = emptySet())
        val bareId = TestUsers.seed(uniqueEmail("cdx-b"), "pw", roles = emptySet())
        val teamId = TestServices.teams.create(Team(name = "cdx-${UUID.randomUUID()}", managerId = mgrId))
        TestServices.teams.addMember(teamId, subId)
        val marker = UUID.randomUUID().toString().take(8)
        val (pathA, pathB) = TestDictionaries.append(Dictionary.CAREER_PATH, "CdxA $marker", "CdxB $marker")
        val (specId) = TestDictionaries.append(Dictionary.CAREER_SPECIALIZATION, "CdxS $marker")
        val (levelId) = TestDictionaries.append(Dictionary.SENIORITY_LEVEL, "CdxL $marker")
        TestServices.careerPositions.create(mgrId, subId, CareerPositionWrite("2020-01-01", pathA, specId, levelId))
        TestServices.careerPositions.create(mgrId, subId, CareerPositionWrite("2023-06-01", pathB, specId, levelId))

        // The timeline is self/chain/HR-only since v2.25.0 — the ADMIN driving the
        // deactivation can flip the flag but not read the positions; the manager verifies.
        val mgr = authedClient(mgrEmail, "pw")
        suspend fun endDates() = mgr
            .get("/api/v1/users/$subId/career-positions")
            .body<CareerPositionList>()
            .items.map { it.endDate }

        // Deactivation stamps TODAY on the final position; the earlier row keeps its derived end.
        assertEquals(HttpStatusCode.NoContent, admin.post("/api/v1/users/$subId/deactivate").status)
        assertEquals(listOf("2023-05-31", LocalDate.now().toString()), endDates())

        // Reactivation clears the stamp — the position resumes as the open-ended current one.
        assertEquals(HttpStatusCode.NoContent, admin.post("/api/v1/users/$subId/activate").status)
        assertEquals(listOf("2023-05-31", null), endDates())

        // No positions at all: the stamp is a silent no-op, the transition still works.
        assertEquals(HttpStatusCode.NoContent, admin.post("/api/v1/users/$bareId/deactivate").status)
        assertEquals(HttpStatusCode.NoContent, admin.post("/api/v1/users/$bareId/activate").status)
    }

    @Test
    fun `deactivation is ADMIN-only and never self`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        val adminId = TestUsers.seed(email = adminEmail, password = "pw-123456789")
        val plainEmail = uniqueEmail("plain")
        val plainId = TestUsers.seed(email = plainEmail, password = "pw-123456789", roles = emptySet())

        val plain = authedClient(plainEmail, "pw-123456789")
        assertEquals(HttpStatusCode.Forbidden, plain.post("/api/v1/users/$adminId/deactivate").status)
        assertEquals(HttpStatusCode.Forbidden, plain.post("/api/v1/users/$adminId/activate").status)

        val admin = authedClient(adminEmail, "pw-123456789")
        val self = admin.post("/api/v1/users/$adminId/deactivate")
        assertEquals(HttpStatusCode.Forbidden, self.status)
        assertEquals("You cannot deactivate your own account", self.body<ProblemDetail>().detail)
        // The other admin-only target still works — the 403 above was the self rule, not authz.
        assertEquals(HttpStatusCode.NoContent, admin.post("/api/v1/users/$plainId/deactivate").status)
    }

    @Test
    fun `unknown and soft-deleted targets answer 404`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw-123456789")
        val admin = authedClient(adminEmail, "pw-123456789")

        assertEquals(HttpStatusCode.NotFound, admin.post("/api/v1/users/999999999/deactivate").status)

        val doomed = admin.post("/api/v1/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "Doomed", email = uniqueEmail("doomed"), password = "pw-123456789"))
        }.body<UserResponse>()
        assertEquals(HttpStatusCode.NoContent, admin.delete("/api/v1/users/${doomed.id}").status)
        assertEquals(HttpStatusCode.NotFound, admin.post("/api/v1/users/${doomed.id}/deactivate").status)
    }

    @Test
    fun `the users list filters on deactivated as a strict boolean`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw-123456789")
        val admin = authedClient(adminEmail, "pw-123456789")
        val tag = UUID.randomUUID().toString().substring(0, 8)
        val active = admin.post("/api/v1/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "awake-$tag", email = uniqueEmail("awake-$tag"), password = "pw-123456789"))
        }.body<UserResponse>()
        val dormant = admin.post("/api/v1/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "asleep-$tag", email = uniqueEmail("asleep-$tag"), password = "pw-123456789"))
        }.body<UserResponse>()
        assertEquals(HttpStatusCode.NoContent, admin.post("/api/v1/users/${dormant.id}/deactivate").status)

        // Unfiltered: both rows, each carrying its flag (the only place the state surfaces).
        val all = admin.get("/api/v1/users") { parameter("name", tag) }.body<UserPageResponse>()
        assertEquals(2L, all.total)
        assertEquals(
            mapOf(active.id to false, dormant.id to true),
            all.items.associate { it.id to it.deactivated },
        )

        val inactiveOnly = admin.get("/api/v1/users") {
            parameter("name", tag)
            parameter("deactivated", "true")
        }.body<UserPageResponse>()
        assertEquals(dormant.id, inactiveOnly.items.single().id)

        val activeOnly = admin.get("/api/v1/users") {
            parameter("name", tag)
            parameter("deactivated", "false")
        }.body<UserPageResponse>()
        assertEquals(active.id, activeOnly.items.single().id)

        val garbage = admin.get("/api/v1/users") { parameter("deactivated", "banana") }
        assertEquals(HttpStatusCode.BadRequest, garbage.status)
    }

    // ---- NEW-assignment blocks -------------------------------------------------------------

    @Test
    fun `team create rejects a deactivated member or manager`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw-123456789")
        val admin = authedClient(adminEmail, "pw-123456789")
        val dormantId = TestUsers.seed(email = uniqueEmail("dormant"), password = "pw", roles = emptySet())
        val managerId = TestUsers.seed(email = uniqueEmail("mgr"), password = "pw", roles = emptySet())
        TestServices.users.setDeactivated(dormantId, true)

        val asMember = admin.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "t-${UUID.randomUUID()}", managerId = managerId, memberIds = listOf(dormantId)))
        }
        assertEquals(HttpStatusCode.BadRequest, asMember.status)
        assertTrue(asMember.body<ProblemDetail>().detail!!.contains("deactivated"))

        val asManager = admin.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "t-${UUID.randomUUID()}", managerId = dormantId, memberIds = emptyList()))
        }
        assertEquals(HttpStatusCode.BadRequest, asManager.status)
    }

    @Test
    fun `team PUT validates only the delta - existing deactivated references keep working`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw-123456789")
        val admin = authedClient(adminEmail, "pw-123456789")
        val managerId = TestUsers.seed(email = uniqueEmail("mgr"), password = "pw", roles = emptySet())
        val memberId = TestUsers.seed(email = uniqueEmail("member"), password = "pw", roles = emptySet())
        val otherId = TestUsers.seed(email = uniqueEmail("other"), password = "pw", roles = emptySet())
        val teamId = TestServices.teams.create(Team(name = "delta-${UUID.randomUUID()}", managerId = managerId))
        TestServices.teams.addMember(teamId, memberId)
        // Deactivate AFTER the roster is in place — the point of the delta rule.
        TestServices.users.setDeactivated(memberId, true)
        TestServices.users.setDeactivated(otherId, true)

        // Resubmitting the existing (now deactivated) member is not a new assignment.
        val resubmit = admin.put("/api/v1/teams/$teamId") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "delta-renamed", managerId = managerId, memberIds = listOf(memberId)))
        }
        assertEquals(HttpStatusCode.NoContent, resubmit.status)

        // NEWLY adding a deactivated user is.
        val addNew = admin.put("/api/v1/teams/$teamId") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "delta-renamed", managerId = managerId, memberIds = listOf(memberId, otherId)))
        }
        assertEquals(HttpStatusCode.BadRequest, addNew.status)

        // So is handing the team to a deactivated manager.
        val newManager = admin.put("/api/v1/teams/$teamId") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "delta-renamed", managerId = otherId, memberIds = listOf(memberId)))
        }
        assertEquals(HttpStatusCode.BadRequest, newManager.status)
    }

    @Test
    fun `member-add rejects a deactivated user but stays idempotent for existing members`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw-123456789")
        val admin = authedClient(adminEmail, "pw-123456789")
        val managerId = TestUsers.seed(email = uniqueEmail("mgr"), password = "pw", roles = emptySet())
        val memberId = TestUsers.seed(email = uniqueEmail("member"), password = "pw", roles = emptySet())
        val newcomerId = TestUsers.seed(email = uniqueEmail("newcomer"), password = "pw", roles = emptySet())
        val teamId = TestServices.teams.create(Team(name = "add-${UUID.randomUUID()}", managerId = managerId))
        TestServices.teams.addMember(teamId, memberId)
        TestServices.users.setDeactivated(memberId, true)
        TestServices.users.setDeactivated(newcomerId, true)

        assertEquals(HttpStatusCode.BadRequest, admin.put("/api/v1/teams/$teamId/members/$newcomerId").status)
        // Re-PUT of the already-present (deactivated) member stays the idempotent no-op.
        assertEquals(HttpStatusCode.NoContent, admin.put("/api/v1/teams/$teamId/members/$memberId").status)
    }

    @Test
    fun `goal, 1-1, and review creation reject a deactivated subordinate with 400`() = testApplication {
        usePostgresTestcontainer()
        val managerEmail = uniqueEmail("mgr")
        val managerId = TestUsers.seed(email = managerEmail, password = "pw", roles = emptySet())
        val subordinateId = TestUsers.seed(email = uniqueEmail("sub"), password = "pw", roles = emptySet())
        val teamId = TestServices.teams.create(Team(name = "blk-${UUID.randomUUID()}", managerId = managerId))
        TestServices.teams.addMember(teamId, subordinateId)
        TestServices.users.setDeactivated(subordinateId, true)
        val period = TestReviewPeriods.append()
        val manager = authedClient(managerEmail, "pw")

        val goal = manager.post("/api/v1/goals") {
            contentType(ContentType.Application.Json)
            setBody(
                GoalCreateRequest(
                    subordinateId = subordinateId,
                    title = "Blocked goal",
                    type = GoalType.NUMBER,
                    targetValue = 10.0,
                    dueDate = LocalDate.now().toString(),
                ),
            )
        }
        assertEquals(HttpStatusCode.BadRequest, goal.status)
        assertTrue(goal.body<ProblemDetail>().detail!!.contains("deactivated"))

        val meeting = manager.post("/api/v1/one-on-ones") {
            contentType(ContentType.Application.Json)
            setBody(OneOnOneCreateRequest(subordinateId, "2026-08-06", emptyList(), emptyList(), emptyList()))
        }
        assertEquals(HttpStatusCode.BadRequest, meeting.status)

        val review = manager.post("/api/v1/performance-reviews") {
            contentType(ContentType.Application.Json)
            setBody(PerformanceReviewCreateRequest(subordinateId = subordinateId, periodId = period.id))
        }
        assertEquals(HttpStatusCode.BadRequest, review.status)

        // Order check: for an OUTSIDER the not-your-direct-report 403 still wins over the 400.
        val outsiderEmail = uniqueEmail("outsider")
        TestUsers.seed(email = outsiderEmail, password = "pw", roles = emptySet())
        val outsider = authedClient(outsiderEmail, "pw")
        val outsiderGoal = outsider.post("/api/v1/goals") {
            contentType(ContentType.Application.Json)
            setBody(
                GoalCreateRequest(
                    subordinateId = subordinateId,
                    title = "Nope",
                    type = GoalType.NUMBER,
                    targetValue = 1.0,
                    dueDate = LocalDate.now().toString(),
                ),
            )
        }
        assertEquals(HttpStatusCode.Forbidden, outsiderGoal.status)
    }

    @Test
    fun `feedback creation rejects a deactivated party`() = testApplication {
        usePostgresTestcontainer()
        val providerEmail = uniqueEmail("provider")
        val providerId = TestUsers.seed(email = providerEmail, password = "pw", roles = emptySet())
        val subjectId = TestUsers.seed(email = uniqueEmail("subject"), password = "pw", roles = emptySet())
        TestServices.users.setDeactivated(subjectId, true)

        val provider = authedClient(providerEmail, "pw")
        val response = provider.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                FeedbackCreateRequest(
                    requesterId = null,
                    subjectId = subjectId,
                    providerId = providerId,
                    visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                    status = FeedbackStatus.DRAFT,
                    content = "Blocked",
                ),
            )
        }
        assertEquals(HttpStatusCode.BadRequest, response.status)
        assertTrue(response.body<ProblemDetail>().detail!!.contains("deactivated"))
    }

    // ---- member-row flag + filter ----------------------------------------------------------

    @Test
    fun `team member rows carry the deactivated flag and the strict-boolean filter narrows every view`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("tm-caller")
        val callerId = TestUsers.seed(callerEmail, "pw", roles = emptySet())
        val activeReport = TestUsers.seed(uniqueEmail("tm-active"), "pw", roles = emptySet())
        val dormantReport = TestUsers.seed(uniqueEmail("tm-dormant"), "pw", roles = emptySet())
        val bossId = TestUsers.seed(uniqueEmail("tm-boss"), "pw", roles = emptySet())
        val activePeer = TestUsers.seed(uniqueEmail("tm-peer-a"), "pw", roles = emptySet())
        val dormantPeer = TestUsers.seed(uniqueEmail("tm-peer-d"), "pw", roles = emptySet())
        val dormantManager = TestUsers.seed(uniqueEmail("tm-dmgr"), "pw", roles = emptySet())
        // managed: the caller manages a team of one active + one deactivated report.
        val managedTeam = TestServices.teams.create(Team(name = "tm-m-${UUID.randomUUID()}", managerId = callerId))
        TestServices.teams.addMember(managedTeam, activeReport)
        TestServices.teams.addMember(managedTeam, dormantReport)
        // member: the caller sits on a boss's team with an active and a deactivated peer.
        val peerTeam = TestServices.teams.create(Team(name = "tm-p-${UUID.randomUUID()}", managerId = bossId))
        TestServices.teams.addMember(peerTeam, callerId)
        TestServices.teams.addMember(peerTeam, activePeer)
        TestServices.teams.addMember(peerTeam, dormantPeer)
        // managers: the caller is also a member of a team run by a (later) deactivated manager.
        val dormantMgrTeam = TestServices.teams.create(Team(name = "tm-d-${UUID.randomUUID()}", managerId = dormantManager))
        TestServices.teams.addMember(dormantMgrTeam, callerId)
        listOf(dormantReport, dormantPeer, dormantManager).forEach { TestServices.users.setDeactivated(it, true) }

        val caller = authedClient(callerEmail, "pw")
        suspend fun members(view: String, deactivated: String? = null) =
            caller.get("/api/v1/teams/members") {
                parameter("view", view)
                parameter("pageSize", "100")
                if (deactivated != null) parameter("deactivated", deactivated)
            }.body<TeamMemberPageResponse>()

        val managed = members("managed")
        assertEquals(mapOf(activeReport to false, dormantReport to true), managed.items.associate { it.userId to it.deactivated })
        assertEquals(setOf(dormantReport), members("managed", "true").items.map { it.userId }.toSet())
        assertEquals(1L, members("managed", "true").total)
        assertEquals(setOf(activeReport), members("managed", "false").items.map { it.userId }.toSet())
        assertEquals(1L, members("managed", "false").total)

        val peers = members("member")
        assertEquals(mapOf(activePeer to false, dormantPeer to true), peers.items.associate { it.userId to it.deactivated })
        assertEquals(setOf(dormantPeer), members("member", "true").items.map { it.userId }.toSet())
        assertEquals(setOf(activePeer), members("member", "false").items.map { it.userId }.toSet())

        // managers: the row user is the manager — the flag/filter apply to HIM.
        val managers = members("managers")
        assertEquals(
            mapOf(bossId to false, dormantManager to true),
            managers.items.associate { it.userId to it.deactivated },
        )
        assertEquals(setOf(dormantManager), members("managers", "true").items.map { it.userId }.toSet())
        assertEquals(setOf(bossId), members("managers", "false").items.map { it.userId }.toSet())

        // Strict boolean, the GET /users semantics: anything else is a 400.
        val garbage = caller.get("/api/v1/teams/members") { parameter("deactivated", "banana") }
        assertEquals(HttpStatusCode.BadRequest, garbage.status)
    }

    // ---- live access tokens ----------------------------------------------------------------

    private suspend fun io.ktor.client.HttpClient.tokenFor(email: String, password: String): String =
        post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(email, password))
        }.body<LoginResponse>().token

    @Test
    fun `a live access token stops working on the next request after deactivation or soft-delete`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw-123456789")
        val admin = authedClient(adminEmail, "pw-123456789")
        val client = jsonClient()
        val dormantEmail = uniqueEmail("tok-dormant")
        val dormantId = TestUsers.seed(dormantEmail, "pw", roles = emptySet())
        val goneEmail = uniqueEmail("tok-gone")
        val goneId = TestUsers.seed(goneEmail, "pw", roles = emptySet())
        val bystanderEmail = uniqueEmail("tok-bystander")
        TestUsers.seed(bystanderEmail, "pw", roles = emptySet())
        val dormantToken = client.tokenFor(dormantEmail, "pw")
        val goneToken = client.tokenFor(goneEmail, "pw")
        val bystanderToken = client.tokenFor(bystanderEmail, "pw")
        suspend fun status(token: String) = client.get("/api/v1/notifications") {
            header(HttpHeaders.Authorization, "Bearer $token")
        }.status

        // Before: all three sessions are live.
        assertEquals(HttpStatusCode.OK, status(dormantToken))
        assertEquals(HttpStatusCode.OK, status(goneToken))

        assertEquals(HttpStatusCode.NoContent, admin.post("/api/v1/users/$dormantId/deactivate").status)
        assertEquals(HttpStatusCode.NoContent, admin.delete("/api/v1/users/$goneId").status)

        // The access tokens have ~15 minutes left, yet both die at once (deactivation / soft-delete
        // is checked on every request, together with the jti blocklist, in ONE statement)…
        assertEquals(HttpStatusCode.Unauthorized, status(dormantToken))
        assertEquals(HttpStatusCode.Unauthorized, status(goneToken))
        // …while an unrelated active user's token is untouched.
        assertEquals(HttpStatusCode.OK, status(bystanderToken))

        // Nothing is revoked: after reactivation the person's own unexpired ACCESS token is live
        // again (bounded by the access TTL) — the refresh side stays dead, see RefreshTest.
        assertEquals(HttpStatusCode.NoContent, admin.post("/api/v1/users/$dormantId/activate").status)
        assertEquals(HttpStatusCode.OK, status(dormantToken))
    }

    // ---- notification suppression ----------------------------------------------------------

    private suspend fun notificationCount(recipientId: UInt): Int =
        suspendTransaction(TestBlocklist.service.database) {
            NotificationService.Notifications.selectAll()
                .where { NotificationService.Notifications.recipientId eq recipientId }
                .toList().size
        }

    @Test
    fun `no notification row is ever minted for a deactivated or soft-deleted recipient, locked-on types included`() =
        testApplication {
            usePostgresTestcontainer()
            val awake = TestUsers.seed(uniqueEmail("ns-awake"), "pw", roles = emptySet())
            val dormant = TestUsers.seed(uniqueEmail("ns-dormant"), "pw", roles = emptySet())
            val gone = TestUsers.seed(uniqueEmail("ns-gone"), "pw", roles = emptySet())
            TestServices.users.setDeactivated(dormant, true)
            TestServices.users.delete(gone)
            fun normal(id: UInt) = Notification(id, NotificationType.FEEDBACK_SENT_TO_SUBJECT, mapOf("subject" to "S"))
            fun locked(id: UInt) = Notification(id, NotificationType.PASSWORD_CHANGED)
            val service = TestNotifications.service

            // create(): the active recipient gets a row, the others get null — locked-on or not.
            assertTrue(service.create(normal(awake)) != null)
            assertTrue(service.create(locked(awake)) != null)
            listOf(dormant, gone).forEach { id ->
                assertEquals(null, service.create(normal(id)))
                assertEquals(null, service.create(locked(id)), "a locked-on type is not exempt from the account-state rule")
            }
            // createAll(): the same rule across a mixed batch, in one pass.
            service.createAll(listOf(normal(awake), normal(dormant), locked(dormant), normal(gone), locked(gone)))

            assertEquals(3, notificationCount(awake))
            assertEquals(0, notificationCount(dormant))
            assertEquals(0, notificationCount(gone))
        }

    @Test
    fun `create and createAll never dispatch an inactive recipient's notification to the mirrors`() =
        testApplication {
            usePostgresTestcontainer()
            val awake = TestUsers.seed(uniqueEmail("md-awake"), "pw", roles = emptySet())
            val dormant = TestUsers.seed(uniqueEmail("md-dormant"), "pw", roles = emptySet())
            val gone = TestUsers.seed(uniqueEmail("md-gone"), "pw", roles = emptySet())
            TestServices.users.setDeactivated(dormant, true)
            TestServices.users.delete(gone)
            fun normal(id: UInt) = Notification(id, NotificationType.FEEDBACK_SENT_TO_SUBJECT, mapOf("subject" to "S"))
            fun locked(id: UInt) = Notification(id, NotificationType.PASSWORD_CHANGED)
            val dispatched = mutableListOf<UInt>()
            val recorder = object : NotificationMirror {
                override fun dispatch(notifications: List<Notification>) {
                    dispatched += notifications.map { it.recipientId }
                }
            }
            val service = NotificationService(TestServices.database, listOf(recorder))

            listOf(dormant, gone).forEach { id ->
                service.create(normal(id))
                service.create(locked(id))
            }
            assertEquals(emptyList(), dispatched, "create must not dispatch an inactive recipient")
            service.createAll(listOf(normal(dormant), locked(dormant), normal(gone), locked(gone)))
            assertEquals(emptyList(), dispatched, "createAll must not dispatch an inactive recipient")

            // The active recipient still dispatches — the recorder is wired, not vacuously empty.
            service.create(normal(awake))
            service.createAll(listOf(normal(awake), normal(dormant)))
            assertEquals(listOf(awake, awake), dispatched)
        }

    @Test
    fun `an admin password change on a deactivated account mints nothing, reactivation mints exactly ACCOUNT_REACTIVATED`() =
        testApplication {
            usePostgresTestcontainer()
            val adminEmail = uniqueEmail("admin")
            TestUsers.seed(email = adminEmail, password = "pw-123456789")
            val admin = authedClient(adminEmail, "pw-123456789")
            val email = uniqueEmail("ra-user")
            val userId = TestUsers.seed(email, "old-password-1", roles = emptySet())
            val mail = LogCapture("ch.nokillswit.mail")
            try {
                assertEquals(HttpStatusCode.NoContent, admin.post("/api/v1/users/$userId/deactivate").status)
                // A locked-on PASSWORD_CHANGED for a deactivated recipient is skipped too.
                assertEquals(
                    HttpStatusCode.NoContent,
                    admin.put("/api/v1/users/$userId/password") {
                        contentType(ContentType.Application.Json)
                        setBody(PasswordUpdateRequest(password = "admin-set-pass-1"))
                    }.status,
                )
                assertEquals(0, notificationCount(userId))

                // Reactivation mints the one notice, for the (now active) person.
                assertEquals(HttpStatusCode.NoContent, admin.post("/api/v1/users/$userId/activate").status)
                assertEquals(1, notificationCount(userId))

                // Listed after they sign in again: typed, feature-neutral, no params, no link.
                val note = authedClient(email, "admin-set-pass-1")
                    .get("/api/v1/notifications").body<NotificationPageResponse>().items.single()
                assertEquals(NotificationType.ACCOUNT_REACTIVATED, note.type)
                assertEquals(emptyMap(), note.params)
                assertEquals(null, note.link)
                assertEquals(false, note.wasSeen)

                // The email mirror sent the reactivation notice, and nothing for the skipped password change.
                val message = mail.requireEvent("the reactivation email") {
                    "To: $email" in it.formattedMessage
                }.formattedMessage
                assertTrue("Your account was reactivated." in message, message)
                assertTrue(
                    mail.events.none { "To: $email" in it.formattedMessage && "An administrator changed" in it.formattedMessage },
                )
            } finally {
                mail.detach()
            }
        }

    // ---- service unit ----------------------------------------------------------------------

    @Test
    fun `deactivatedIdsAmong reports only deactivated active users`() = testApplication {
        usePostgresTestcontainer()
        val dormant = TestUsers.seed(email = uniqueEmail("svc-dormant"), password = "pw", roles = emptySet())
        val awake = TestUsers.seed(email = uniqueEmail("svc-awake"), password = "pw", roles = emptySet())
        val gone = TestUsers.seed(email = uniqueEmail("svc-gone"), password = "pw", roles = emptySet())
        TestServices.users.setDeactivated(dormant, true)
        TestServices.users.setDeactivated(gone, true)
        TestServices.users.delete(gone)

        assertEquals(emptySet(), TestServices.users.deactivatedIdsAmong(emptyList()))
        // Soft-deleted ids are excluded — they fall through to the FK/reference validation.
        assertEquals(
            setOf(dormant),
            TestServices.users.deactivatedIdsAmong(listOf(dormant, awake, gone)),
        )
    }
}
