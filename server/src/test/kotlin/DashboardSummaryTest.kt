package ch.nokillswit

import ch.nokillswit.dashboard.DashboardSummary
import ch.nokillswit.feedbacks.FeedbackCreateRequest
import ch.nokillswit.feedbacks.FeedbackStatus
import ch.nokillswit.feedbacks.FeedbackVisibility
import ch.nokillswit.goals.GoalCreateRequest
import ch.nokillswit.goals.GoalMilestoneInput
import ch.nokillswit.goals.GoalResponse
import ch.nokillswit.goals.GoalType
import ch.nokillswit.teams.Team
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import org.jetbrains.exposed.v1.r2dbc.insert
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

/**
 * GET /api/v1/dashboard/summary — the hero-tile aggregate. Fresh users per test keep every
 * caller-scoped count at a clean baseline despite the shared seeded container. The
 * current-period fields are null here by construction: the shared test timeline lives in the
 * 2000s and never covers the real current month (the period-selection logic itself is covered
 * by the injected-month `currentPeriod` case below).
 */
class DashboardSummaryTest {

    @Test
    fun `requires authentication`() = testApplication {
        usePostgresTestcontainer()
        val response = jsonClient().get("/api/v1/dashboard/summary")
        assertEquals(HttpStatusCode.Unauthorized, response.status)
    }

    @Test
    fun `caller-scoped counts - requests, goals, received feedback, direct reports`() = testApplication {
        usePostgresTestcontainer()
        val managerEmail = uniqueEmail("dash-manager")
        val managerId = TestUsers.seed(managerEmail, "pw", name = "Dash Manager", roles = emptySet())
        val subEmail = uniqueEmail("dash-sub")
        val subId = TestUsers.seed(subEmail, "pw", name = "Dash Sub", roles = emptySet())
        val peerEmail = uniqueEmail("dash-peer")
        val peerId = TestUsers.seed(peerEmail, "pw", name = "Dash Peer", roles = emptySet())
        val teamId = TestServices.teams.create(Team(name = "dash-${UUID.randomUUID()}", managerId = managerId))
        TestServices.teams.addMember(teamId, subId)
        TestServices.teams.addMember(teamId, peerId)

        // Baseline: a brand-new pair has nothing anywhere.
        val manager = authedClient(managerEmail, "pw")
        val baseline = manager.get("/api/v1/dashboard/summary").body<DashboardSummary>()
        assertEquals(0, baseline.pendingFeedbackRequests)
        assertEquals(0, baseline.activeGoals)
        assertEquals(0, baseline.feedbackReceived30d)
        assertEquals(2, baseline.directReports)
        assertNull(baseline.currentPeriodId)
        assertNull(baseline.currentPeriodReviewsDone)

        val sub = authedClient(subEmail, "pw")
        // The subordinate asks the MANAGER for feedback → a pending request for the manager.
        val requested = sub.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                FeedbackCreateRequest(
                    requesterId = subId, subjectId = subId, providerId = managerId,
                    visibility = FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT,
                    status = FeedbackStatus.REQUESTED,
                ),
            )
        }
        assertEquals(HttpStatusCode.Created, requested.status)

        // The manager sets + activates a goal for the SUBORDINATE → the subordinate's tile.
        val goal = manager.post("/api/v1/goals") {
            contentType(ContentType.Application.Json)
            setBody(
                GoalCreateRequest(
                    subordinateId = subId, title = "dash goal", type = GoalType.PLAN,
                    milestones = listOf(GoalMilestoneInput(description = "Done")),
                    dueDate = "2099-12-31",
                ),
            )
        }.body<GoalResponse>()
        assertEquals(HttpStatusCode.NoContent, manager.post("/api/v1/goals/${goal.id}/activate").status)

        // A peer sends the subordinate a feedback → received-in-30-days.
        val peer = authedClient(peerEmail, "pw")
        val sent = peer.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                FeedbackCreateRequest(
                    subjectId = subId, providerId = peerId,
                    visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                    status = FeedbackStatus.SENT, content = "well done",
                ),
            )
        }
        assertEquals(HttpStatusCode.Created, sent.status)

        val managerSummary = manager.get("/api/v1/dashboard/summary").body<DashboardSummary>()
        assertEquals(1, managerSummary.pendingFeedbackRequests)
        assertEquals(0, managerSummary.activeGoals) // the goal is the SUBORDINATE's, not theirs
        assertEquals(2, managerSummary.directReports)

        // The manager's pending request becomes a DRAFT and is sent — the STATUS_CHANGED{to=SENT}
        // event shape (the peer's direct "save & send" above covered CREATED{status=SENT}).
        val requestedId = requested.body<ch.nokillswit.feedbacks.FeedbackResponse>().id
        assertEquals(HttpStatusCode.NoContent, manager.post("/api/v1/feedbacks/$requestedId/pick-up").status)
        assertEquals(HttpStatusCode.NoContent, manager.post("/api/v1/feedbacks/$requestedId/send").status)

        val subSummary = sub.get("/api/v1/dashboard/summary").body<DashboardSummary>()
        assertEquals(0, subSummary.pendingFeedbackRequests)
        assertEquals(1, subSummary.activeGoals)
        // Both delivery paths count: the peer's created-as-SENT and the manager's draft→send.
        assertEquals(2, subSummary.feedbackReceived30d)
        // Everything just happened — nothing falls in the previous 30-day window.
        assertEquals(0, subSummary.feedbackReceivedPrev30d)
        assertEquals(0, subSummary.directReports) // non-manager — the manager tiles hide
    }

    @Test
    fun `receivedSentCount windows on the SENT moment, with lastModified fallback`() = testApplication {
        usePostgresTestcontainer()
        val subjectId = TestUsers.seed(uniqueEmail("dash-count-subject"), "pw", name = "Count Subject", roles = emptySet())
        val providerId = TestUsers.seed(uniqueEmail("dash-count-provider"), "pw", name = "Count Provider", roles = emptySet())

        // Service-level create mints NO audit event → the count falls back to lastModified (now).
        val feedbackId = TestServices.feedbacks.create(
            ch.nokillswit.feedbacks.Feedback(
                subjectId = subjectId, providerId = providerId,
                visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                status = FeedbackStatus.SENT, content = "count me",
            ),
        ).id
        val now = System.currentTimeMillis()
        val day = 24L * 60 * 60 * 1000
        val service = TestServices.feedbacks
        assertEquals(1, service.receivedSentCount(subjectId, now - day, now + day))
        assertEquals(0, service.receivedSentCount(subjectId, now - 60 * day, now - 30 * day))

        // A back-dated SENT event (45 days ago) moves the feedback into the PREVIOUS window —
        // the audit-trail moment wins over lastModified. Raw insert: the event service
        // deliberately stamps its own timestamps, and there is no clock seam on the route.
        val events = ch.nokillswit.feedbacks.FeedbackEventService.FeedbackEvents
        suspendTransaction(service.database) {
            events.insert {
                it[events.feedbackId] = feedbackId
                it[events.userId] = providerId
                it[events.timestamp] = now - 45 * day
                it[events.eventType] = ch.nokillswit.feedbacks.FeedbackEventType.STATUS_CHANGED.name
                it[events.params] = """{"from":"DRAFT","to":"SENT"}"""
            }
        }
        assertEquals(0, service.receivedSentCount(subjectId, now - day, now + day))
        assertEquals(1, service.receivedSentCount(subjectId, now - 60 * day, now - 30 * day))
    }

    @Test
    fun `currentPeriod picks the period containing the injected month, boundaries inclusive`() = testApplication {
        usePostgresTestcontainer()
        val period = TestReviewPeriods.append()
        val service = TestServices.reviewPeriods
        assertNotNull(service.currentPeriod(period.startMonth))
        assertNotNull(service.currentPeriod(period.endMonth))
        assertEquals(period.id, service.currentPeriod(period.startMonth)?.id)
        // A month after the whole timeline → no current period.
        val afterAll = java.time.YearMonth.parse(TestServices.reviewPeriods.list().last().endMonth)
            .plusMonths(1).toString()
        assertNull(service.currentPeriod(afterAll))
    }
}
