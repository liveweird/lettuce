package ch.nokillswit

import ch.nokillswit.feedbacks.FeedbackCreateRequest
import ch.nokillswit.feedbacks.FeedbackPageResponse
import ch.nokillswit.feedbacks.FeedbackResponse
import ch.nokillswit.feedbacks.FeedbackStatus
import ch.nokillswit.feedbacks.FeedbackVisibility
import ch.nokillswit.goals.GoalCreateRequest
import ch.nokillswit.goals.GoalMilestoneInput
import ch.nokillswit.goals.GoalPageResponse
import ch.nokillswit.goals.GoalResponse
import ch.nokillswit.goals.GoalStatus
import ch.nokillswit.goals.GoalType
import ch.nokillswit.oneonones.OneOnOneCreateRequest
import ch.nokillswit.oneonones.OneOnOnePageResponse
import ch.nokillswit.oneonones.OneOnOneResponse
import ch.nokillswit.teams.Team
import ch.nokillswit.users.UserRole
import ch.nokillswit.users.UserUpdateRequest
import io.ktor.client.HttpClient
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
import java.time.LocalDate
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * The HR auditor role over HTTP: read access equal to ADMIN's (drafts included, content never
 * redacted) on records and via the `view=user` auditor lists, write access exactly regular-user,
 * and the `hr.read`/`hr.list` audit trail. The pure guard edges live in GuardsTest.
 */
class HrRoleTest {

    private data class Pair(
        val managerId: UInt,
        val managerEmail: String,
        val subordinateId: UInt,
        val subordinateEmail: String,
    )

    /** A manager with one direct report (fresh team per call), plus an HR-only observer. */
    private suspend fun seedPairAndHr(): Triple<Pair, String, UInt> {
        val managerEmail = uniqueEmail("hr-manager")
        val managerId = TestUsers.seed(managerEmail, "pw", name = "Mia Manager", roles = emptySet())
        val subordinateEmail = uniqueEmail("hr-subordinate")
        val subordinateId = TestUsers.seed(subordinateEmail, "pw", name = "Sam Subordinate", roles = emptySet())
        val teamId = TestServices.teams.create(Team(name = "hr-${UUID.randomUUID()}", managerId = managerId))
        TestServices.teams.addMember(teamId, subordinateId)
        val hrEmail = uniqueEmail("hr-auditor")
        val hrId = TestUsers.seed(hrEmail, "pw", name = "Harry Auditor", roles = setOf(UserRole.HR))
        return Triple(Pair(managerId, managerEmail, subordinateId, subordinateEmail), hrEmail, hrId)
    }

    private suspend fun HttpClient.createDraftFeedback(providerId: UInt, subjectId: UInt): FeedbackResponse =
        post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                FeedbackCreateRequest(
                    subjectId = subjectId,
                    providerId = providerId,
                    visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                    status = FeedbackStatus.DRAFT,
                    content = "private draft content",
                ),
            )
        }.body()

    private suspend fun HttpClient.createMeeting(subordinateId: UInt): OneOnOneResponse =
        post("/api/v1/one-on-ones") {
            contentType(ContentType.Application.Json)
            setBody(OneOnOneCreateRequest(subordinateId, "2026-07-01"))
        }.body()

    private suspend fun HttpClient.createDraftGoal(subordinateId: UInt, title: String = "hr-goal"): GoalResponse =
        post("/api/v1/goals") {
            contentType(ContentType.Application.Json)
            setBody(
                GoalCreateRequest(
                    subordinateId = subordinateId,
                    title = title,
                    description = "auditable",
                    type = GoalType.PLAN,
                    milestones = listOf(GoalMilestoneInput(description = "Done")),
                    dueDate = LocalDate.now().plusDays(30).toString(),
                ),
            )
        }.body()

    // ── Id-addressed reads (drafts included) ───────────────────────────────────

    @Test
    fun `hr reads a private draft feedback with content, and its events, but cannot write it`() = testApplication {
        usePostgresTestcontainer()
        val (pair, hrEmail, _) = seedPairAndHr()
        val provider = authedClient(pair.managerEmail, "pw")
        val draft = provider.createDraftFeedback(pair.managerId, pair.subordinateId)

        val hr = authedClient(hrEmail, "pw")
        val read = hr.get("/api/v1/feedbacks/${draft.id}")
        assertEquals(HttpStatusCode.OK, read.status)
        // Content is never blanked for the auditor, even on someone else's DRAFT.
        assertEquals("private draft content", read.body<FeedbackResponse>().content)
        assertEquals(HttpStatusCode.OK, hr.get("/api/v1/feedbacks/${draft.id}/events").status)

        // Writes stay regular-user: not the provider → 403 on every mutation.
        assertEquals(HttpStatusCode.Forbidden, hr.post("/api/v1/feedbacks/${draft.id}/send").status)
        assertEquals(HttpStatusCode.Forbidden, hr.delete("/api/v1/feedbacks/${draft.id}").status)
    }

    @Test
    fun `hr reads a one-on-one and its events but cannot modify it`() = testApplication {
        usePostgresTestcontainer()
        val (pair, hrEmail, _) = seedPairAndHr()
        val manager = authedClient(pair.managerEmail, "pw")
        val meeting = manager.createMeeting(pair.subordinateId)

        val hr = authedClient(hrEmail, "pw")
        assertEquals(HttpStatusCode.OK, hr.get("/api/v1/one-on-ones/${meeting.id}").status)
        assertEquals(HttpStatusCode.OK, hr.get("/api/v1/one-on-ones/${meeting.id}/events").status)
        assertEquals(HttpStatusCode.Forbidden, hr.delete("/api/v1/one-on-ones/${meeting.id}").status)
    }

    @Test
    fun `hr reads a DRAFT goal (hidden even from chain managers) but cannot transition it`() = testApplication {
        usePostgresTestcontainer()
        val (pair, hrEmail, _) = seedPairAndHr()
        val manager = authedClient(pair.managerEmail, "pw")
        val goal = manager.createDraftGoal(pair.subordinateId)
        assertEquals(GoalStatus.DRAFT, goal.status)

        val hr = authedClient(hrEmail, "pw")
        assertEquals(HttpStatusCode.OK, hr.get("/api/v1/goals/${goal.id}").status)
        assertEquals(HttpStatusCode.OK, hr.get("/api/v1/goals/${goal.id}/events").status)
        assertEquals(HttpStatusCode.Forbidden, hr.post("/api/v1/goals/${goal.id}/activate").status)
        assertEquals(HttpStatusCode.Forbidden, hr.delete("/api/v1/goals/${goal.id}").status)
    }

    @Test
    fun `hr reads any user but cannot update them, and keeps no admin surface`() = testApplication {
        usePostgresTestcontainer()
        val (pair, hrEmail, _) = seedPairAndHr()
        val hr = authedClient(hrEmail, "pw")

        val read = hr.get("/api/v1/users/${pair.subordinateId}")
        assertEquals(HttpStatusCode.OK, read.status)

        // Writes and admin management stay shut.
        assertEquals(
            HttpStatusCode.Forbidden,
            hr.put("/api/v1/users/${pair.subordinateId}") {
                contentType(ContentType.Application.Json)
                setBody(UserUpdateRequest(name = "Renamed", email = uniqueEmail("renamed"), roles = emptyList()))
            }.status,
        )
        assertEquals(HttpStatusCode.Forbidden, hr.delete("/api/v1/users/${pair.subordinateId}").status)
        // Alerts management (reads included) is ADMIN-only — HR gets nothing there.
        assertEquals(HttpStatusCode.Forbidden, hr.get("/api/v1/alerts").status)
    }

    @Test
    fun `hr reads a career timeline (audited) - the list seniority ride-along mints nothing`() = testApplication {
        usePostgresTestcontainer()
        val (pair, hrEmail, hrId) = seedPairAndHr()
        val appender = LogCapture("ch.nokillswit.audit")
        try {
            val hr = authedClient(hrEmail, "pw")
            // The timeline is self/chain/HR-only (v2.25.0); the HR grant is the per-record
            // hr.read idiom, resource `careerPositions`.
            assertEquals(HttpStatusCode.OK, hr.get("/api/v1/users/${pair.subordinateId}/career-positions").status)
            val read = appender.events.find { it.message == "hr.read" }
            assertNotNull(read, "expected an hr.read audit event")
            assertEquals("careerPositions", read.keyValuePairs.first { it.key == "resource" }.value)
            assertEquals(pair.subordinateId.toLong(), read.keyValuePairs.first { it.key == "resourceId" }.value)
            assertEquals(hrId.toLong(), read.keyValuePairs.first { it.key == "byUserId" }.value)

            // The seniority values HR sees on the open users/members lists are the REGISTERED
            // not-audited exception (a per-page-load event for one metadata field would be
            // noise, not signal — see the observability doc): no hr.* event mints. The list
            // call filters to this test's own seed (the shared-container etiquette — and an
            // unfiltered page would trip the conformance email check on other tests' residue).
            val before = appender.events.size
            assertEquals(HttpStatusCode.OK, hr.get("/api/v1/users?email=${pair.subordinateEmail}").status)
            assertEquals(HttpStatusCode.OK, hr.get("/api/v1/teams/members?view=member").status)
            assertEquals(0, appender.events.drop(before).count { it.message.startsWith("hr.") })
        } finally {
            appender.detach()
        }
    }

    // ── The auditor list view (view=user) ──────────────────────────────────────

    @Test
    fun `view=user lists everything the target is a party to, drafts and previews included`() = testApplication {
        usePostgresTestcontainer()
        val (pair, hrEmail, _) = seedPairAndHr()
        val manager = authedClient(pair.managerEmail, "pw")
        val draft = manager.createDraftFeedback(pair.managerId, pair.subordinateId)
        val meeting = manager.createMeeting(pair.subordinateId)
        val goal = manager.createDraftGoal(pair.subordinateId, title = "hr-list-${UUID.randomUUID()}")

        val hr = authedClient(hrEmail, "pw")

        val feedbacks = hr.get("/api/v1/feedbacks?view=user&userId=${pair.subordinateId}").body<FeedbackPageResponse>()
        val feedbackRow = feedbacks.items.single { it.id == draft.id }
        // The auditor list never redacts previews — the DRAFT's content is visible.
        assertTrue(feedbackRow.contentPreview.startsWith("private draft"))

        val meetings = hr.get("/api/v1/one-on-ones?view=user&userId=${pair.subordinateId}").body<OneOnOnePageResponse>()
        assertNotNull(meetings.items.singleOrNull { it.id == meeting.id })

        // Target on the MANAGER side works too, and DRAFT goals are listed.
        val goals = hr.get("/api/v1/goals?view=user&userId=${pair.managerId}").body<GoalPageResponse>()
        val goalRow = goals.items.single { it.id == goal.id }
        assertEquals(GoalStatus.DRAFT, goalRow.status)
    }

    @Test
    fun `view=user is HR-only - ADMIN and regular users are rejected - and validates userId`() = testApplication {
        usePostgresTestcontainer()
        val (pair, hrEmail, _) = seedPairAndHr()
        val adminEmail = uniqueEmail("hr-admin")
        TestUsers.seed(adminEmail, "pw", roles = setOf(UserRole.ADMIN))
        val admin = authedClient(adminEmail, "pw")
        val hr = authedClient(hrEmail, "pw")
        val regular = authedClient(pair.subordinateEmail, "pw")

        for (path in listOf("/api/v1/feedbacks", "/api/v1/one-on-ones", "/api/v1/goals")) {
            // The auditor view belongs to HR alone — ADMIN is a management role now.
            assertEquals(HttpStatusCode.Forbidden, admin.get("$path?view=user&userId=${pair.managerId}").status)
            assertEquals(HttpStatusCode.Forbidden, regular.get("$path?view=user&userId=${pair.managerId}").status)
            // Shape validation mirrors counterpartId: required on view=user, rejected elsewhere.
            assertEquals(HttpStatusCode.BadRequest, hr.get("$path?view=user").status)
            assertEquals(HttpStatusCode.BadRequest, hr.get("$path?userId=${pair.managerId}").status)
        }
        // Params foreign to the auditor view stay rejected.
        assertEquals(
            HttpStatusCode.BadRequest,
            hr.get("/api/v1/goals?view=user&userId=${pair.managerId}&includeIndirect=true").status,
        )
        assertEquals(
            HttpStatusCode.BadRequest,
            hr.get("/api/v1/one-on-ones?view=user&userId=${pair.managerId}&counterpartId=${pair.subordinateId}").status,
        )
    }

    @Test
    fun `view=user composes with the ordinary narrowing filters`() = testApplication {
        usePostgresTestcontainer()
        val (pair, hrEmail, _) = seedPairAndHr()
        val manager = authedClient(pair.managerEmail, "pw")
        manager.createDraftFeedback(pair.managerId, pair.subordinateId)

        val hr = authedClient(hrEmail, "pw")
        val all = hr.get("/api/v1/feedbacks?view=user&userId=${pair.subordinateId}").body<FeedbackPageResponse>()
        assertEquals(1, all.total)
        val other = hr.get(
            "/api/v1/feedbacks?view=user&userId=${pair.subordinateId}&providerId=${pair.subordinateId}",
        ).body<FeedbackPageResponse>()
        assertEquals(0, other.total)
    }

    // ── The audit trail ────────────────────────────────────────────────────────

    @Test
    fun `hr reads and lists are audit-logged - party reads mint nothing and admin gets 403`() = testApplication {
        usePostgresTestcontainer()
        val (pair, hrEmail, hrId) = seedPairAndHr()
        val adminEmail = uniqueEmail("hr-admin")
        TestUsers.seed(adminEmail, "pw", roles = setOf(UserRole.ADMIN))
        val manager = authedClient(pair.managerEmail, "pw")
        val goal = manager.createDraftGoal(pair.subordinateId)

        val appender = LogCapture("ch.nokillswit.audit")
        try {
            val hr = authedClient(hrEmail, "pw")
            val admin = authedClient(adminEmail, "pw")

            hr.get("/api/v1/goals/${goal.id}")
            val read = appender.events.find { it.message == "hr.read" }
            assertNotNull(read, "expected an hr.read audit event")
            assertEquals("goal", read.keyValuePairs.first { it.key == "resource" }.value)
            assertEquals(goal.id.toLong(), read.keyValuePairs.first { it.key == "resourceId" }.value)
            assertEquals(hrId.toLong(), read.keyValuePairs.first { it.key == "byUserId" }.value)

            hr.get("/api/v1/goals?view=user&userId=${pair.subordinateId}")
            val list = appender.events.find { it.message == "hr.list" }
            assertNotNull(list, "expected an hr.list audit event")
            assertEquals("goal", list.keyValuePairs.first { it.key == "resource" }.value)
            assertEquals(pair.subordinateId.toLong(), list.keyValuePairs.first { it.key == "targetUserId" }.value)

            // A party reading their own record mints nothing, and an ADMIN is simply denied
            // the auditor view (no hr.* event — the 403 lands in authz.denied instead).
            val before = appender.events.size
            manager.get("/api/v1/goals/${goal.id}")
            assertEquals(
                HttpStatusCode.Forbidden,
                admin.get("/api/v1/goals?view=user&userId=${pair.subordinateId}").status,
            )
            assertEquals(0, appender.events.drop(before).count { it.message.startsWith("hr.") })

            // Every HR auditor-list call is logged — a second call mints a second event.
            hr.get("/api/v1/goals?view=user&userId=${pair.subordinateId}")
            assertEquals(2, appender.events.count { it.message == "hr.list" })
        } finally {
            appender.detach()
        }
    }

    @Test
    fun `hr reads an impact log entry and the auditor journal (both audited) but cannot write it`() = testApplication {
        usePostgresTestcontainer()
        val (pair, hrEmail, hrId) = seedPairAndHr()
        val owner = authedClient(pair.subordinateEmail, "pw")
        val entry = owner.post("/api/v1/impact-log") {
            contentType(ContentType.Application.Json)
            setBody(
                ch.nokillswit.impactlog.ImpactEntryRequest(
                    periodStart = "2026-07-01",
                    periodEnd = "2026-07-31",
                    whatHappened = "Auditable happening",
                    contribution = "Auditable contribution",
                    whyItMattered = "Auditable impact",
                    evidence = "Auditable evidence",
                ),
            )
        }.body<ch.nokillswit.impactlog.ImpactEntryResponse>()

        val appender = LogCapture("ch.nokillswit.audit")
        try {
            val hr = authedClient(hrEmail, "pw")
            assertEquals(HttpStatusCode.OK, hr.get("/api/v1/impact-log/${entry.id}").status)
            val read = appender.events.find { it.message == "hr.read" }
            assertNotNull(read, "expected an hr.read audit event")
            assertEquals("impactLog", read.keyValuePairs.first { it.key == "resource" }.value)
            assertEquals(entry.id.toLong(), read.keyValuePairs.first { it.key == "resourceId" }.value)
            assertEquals(hrId.toLong(), read.keyValuePairs.first { it.key == "byUserId" }.value)
            assertEquals(HttpStatusCode.OK, hr.get("/api/v1/impact-log/${entry.id}/events").status)

            val page = hr.get("/api/v1/impact-log?view=user&userId=${pair.subordinateId}")
            assertEquals(HttpStatusCode.OK, page.status)
            val list = appender.events.find { it.message == "hr.list" }
            assertNotNull(list, "expected an hr.list audit event")
            assertEquals("impactLog", list.keyValuePairs.first { it.key == "resource" }.value)

            // Writes stay regular-user: HR is not the owner → 403 on every mutation.
            assertEquals(HttpStatusCode.Forbidden, hr.delete("/api/v1/impact-log/${entry.id}").status)
        } finally {
            appender.detach()
        }
    }
}
