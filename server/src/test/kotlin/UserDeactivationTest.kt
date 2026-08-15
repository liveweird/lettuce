package ch.nokillswit

import ch.nokillswit.dictionaries.Dictionary
import ch.nokillswit.feedbacks.FeedbackCreateRequest
import ch.nokillswit.feedbacks.FeedbackStatus
import ch.nokillswit.feedbacks.FeedbackVisibility
import ch.nokillswit.goals.GoalCreateRequest
import ch.nokillswit.goals.GoalType
import ch.nokillswit.oneonones.OneOnOneCreateRequest
import ch.nokillswit.plugins.ProblemDetail
import ch.nokillswit.reviews.PerformanceReviewCreateRequest
import ch.nokillswit.teams.Team
import ch.nokillswit.users.CareerPositionList
import ch.nokillswit.users.CareerPositionWrite
import ch.nokillswit.users.UserPageResponse
import ch.nokillswit.users.UserRequest
import ch.nokillswit.users.UserResponse
import io.ktor.client.call.body
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.parameter
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import java.time.LocalDate
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The reversible-deactivation feature end to end: the POST deactivate/activate transition
 * matrix, the unchanged-readability guarantee, the list filter, and the NEW-assignment blocks
 * (team member/manager, goal/1:1/review subordinate, feedback party — delta-validated).
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
        val mgrId = TestUsers.seed(uniqueEmail("cdx-m"), "pw", roles = emptySet())
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

        suspend fun endDates() = admin
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
