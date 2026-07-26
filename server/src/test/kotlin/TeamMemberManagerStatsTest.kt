package ch.nokillswit

import ch.nokillswit.feedbacks.FeedbackContentUpdate
import ch.nokillswit.feedbacks.FeedbackCreateRequest
import ch.nokillswit.feedbacks.FeedbackEventListResponse
import ch.nokillswit.feedbacks.FeedbackEventService
import ch.nokillswit.feedbacks.FeedbackEventType
import ch.nokillswit.feedbacks.FeedbackResponse
import ch.nokillswit.feedbacks.FeedbackStatus
import ch.nokillswit.feedbacks.FeedbackVisibility
import ch.nokillswit.goals.GoalCloseRequest
import ch.nokillswit.goals.GoalCreateRequest
import ch.nokillswit.goals.GoalResponse
import ch.nokillswit.goals.GoalType
import ch.nokillswit.oneonones.ActionItemOwner
import ch.nokillswit.oneonones.OneOnOneActionItemInput
import ch.nokillswit.oneonones.OneOnOneCreateRequest
import ch.nokillswit.oneonones.OneOnOneItemInput
import ch.nokillswit.oneonones.OneOnOneResponse
import ch.nokillswit.teams.Team
import ch.nokillswit.teams.TeamMemberListItem
import ch.nokillswit.teams.TeamMemberPageResponse
import ch.nokillswit.users.UserRole
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
import java.util.UUID
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.r2dbc.deleteWhere
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The per-manager dashboard stats carried by `GET /api/v1/teams/members?view=managers`
 * (`lastOneOnOneDate` / `lastOneOnOneOpenItems` / `lastFeedbackAt`) — computed route-side from
 * OneOnOneService.latestMeetingStats and FeedbackService.lastProvidedAt.
 */
class TeamMemberManagerStatsTest {

    private suspend fun HttpClient.createTeam(name: String, managerId: UInt, memberIds: List<UInt>) =
        post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = name, managerId = managerId, memberIds = memberIds))
        }

    private suspend fun HttpClient.createMeeting(
        subordinateId: UInt,
        meetingDate: String,
        actionItems: List<OneOnOneActionItemInput> = emptyList(),
    ): OneOnOneResponse {
        val response = post("/api/v1/one-on-ones") {
            contentType(ContentType.Application.Json)
            setBody(OneOnOneCreateRequest(subordinateId, meetingDate, emptyList(), emptyList(), actionItems))
        }
        assertEquals(HttpStatusCode.Created, response.status, "meeting create failed")
        return response.body<OneOnOneResponse>()
    }

    private suspend fun HttpClient.managerItem(managerId: UInt): TeamMemberListItem {
        val page = get("/api/v1/teams/members?view=managers&pageSize=100").body<TeamMemberPageResponse>()
        return page.items.first { it.userId == managerId }
    }

    private fun item(content: String, resolved: Boolean = false) =
        OneOnOneActionItemInput(content = content, owner = ActionItemOwner.SUBORDINATE, resolved = resolved)

    private suspend fun HttpClient.createGoal(subordinateId: UInt, title: String): GoalResponse {
        val response = post("/api/v1/goals") {
            contentType(ContentType.Application.Json)
            setBody(GoalCreateRequest(subordinateId = subordinateId, title = title, type = GoalType.BINARY))
        }
        assertEquals(HttpStatusCode.Created, response.status, "goal create failed")
        return response.body<GoalResponse>()
    }

    @Test
    fun `activeGoalCount counts only this manager's ACTIVE goals for the caller`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw")
        val callerEmail = uniqueEmail("caller")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", name = "Caller", role = UserRole.USER)
        val mgrEmail = uniqueEmail("mgr")
        val managerId = TestUsers.seed(email = mgrEmail, password = "pw", name = "Mgr", role = UserRole.USER)
        val admin = authedClient(adminEmail, "pw")
        admin.createTeam("goal-cnt-${UUID.randomUUID()}", managerId, listOf(callerId))
        // The reverse team (the caller manages the manager) lets us pin the direction below.
        admin.createTeam("goal-rev-${UUID.randomUUID()}", callerId, listOf(managerId))

        val caller = authedClient(callerEmail, "pw")
        val manager = authedClient(mgrEmail, "pw")

        // A goal-less pair shows 0, not null (a count has no "absent" state on this view).
        assertEquals(0, caller.managerItem(managerId).activeGoalCount)

        // A DRAFT never counts.
        val first = manager.createGoal(callerId, "count me later")
        assertEquals(0, caller.managerItem(managerId).activeGoalCount)

        manager.post("/api/v1/goals/${first.id}/activate")
        assertEquals(1, caller.managerItem(managerId).activeGoalCount)

        val second = manager.createGoal(callerId, "count me too")
        manager.post("/api/v1/goals/${second.id}/activate")
        assertEquals(2, caller.managerItem(managerId).activeGoalCount)

        // The reverse direction (a goal the caller set FOR this manager) never counts here.
        val reverse = caller.createGoal(managerId, "wrong direction")
        caller.post("/api/v1/goals/${reverse.id}/activate")
        assertEquals(2, caller.managerItem(managerId).activeGoalCount)

        // Closing takes a goal back out of the count.
        val closed = manager.post("/api/v1/goals/${first.id}/close") {
            contentType(ContentType.Application.Json)
            setBody(GoalCloseRequest(summary = "done"))
        }
        assertEquals(HttpStatusCode.NoContent, closed.status)
        assertEquals(1, caller.managerItem(managerId).activeGoalCount)
    }

    @Test
    fun `stats are null without data and never populated outside the managers view`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw")
        val callerEmail = uniqueEmail("caller")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", name = "Caller", role = UserRole.USER)
        val managerId = TestUsers.seed(email = uniqueEmail("mgr"), password = "pw", name = "Mgr", role = UserRole.USER)
        val peerId = TestUsers.seed(email = uniqueEmail("peer"), password = "pw", name = "Peer", role = UserRole.USER)
        authedClient(adminEmail, "pw").createTeam("stats-null-${UUID.randomUUID()}", managerId, listOf(callerId, peerId))

        val caller = authedClient(callerEmail, "pw")
        val manager = caller.managerItem(managerId)
        assertNull(manager.lastOneOnOneDate)
        assertNull(manager.lastOneOnOneOpenItems)
        assertNull(manager.lastFeedbackAt)
        assertEquals(0, manager.activeGoalCount) // a count, not an "absent" stat

        // The member view lists the peer — its rows never carry stats.
        val members = caller.get("/api/v1/teams/members?view=member").body<TeamMemberPageResponse>()
        val peer = members.items.first { it.userId == peerId }
        assertNull(peer.lastOneOnOneDate)
        assertNull(peer.lastOneOnOneOpenItems)
        assertNull(peer.lastFeedbackAt)
        assertNull(peer.activeGoalCount)
    }

    @Test
    fun `the latest directional meeting drives the date and open count`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw")
        val callerEmail = uniqueEmail("caller")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", name = "Caller", role = UserRole.USER)
        val mgrEmail = uniqueEmail("mgr")
        val managerId = TestUsers.seed(email = mgrEmail, password = "pw", name = "Mgr", role = UserRole.USER)
        val admin = authedClient(adminEmail, "pw")
        admin.createTeam("stats-dir-${UUID.randomUUID()}", managerId, listOf(callerId))

        val mgr = authedClient(mgrEmail, "pw")
        val caller = authedClient(callerEmail, "pw")

        // Meeting A: one already-resolved item, so nothing carries over into later meetings.
        mgr.createMeeting(callerId, "2026-01-10", listOf(item("done thing", resolved = true)))
        var stats = caller.managerItem(managerId)
        assertEquals("2026-01-10", stats.lastOneOnOneDate)
        assertEquals(0, stats.lastOneOnOneOpenItems) // zero open is 0, not null

        // Meeting B (newer): two unresolved items.
        val meetingB = mgr.createMeeting(callerId, "2026-02-01", listOf(item("open one"), item("open two")))
        stats = caller.managerItem(managerId)
        assertEquals("2026-02-01", stats.lastOneOnOneDate)
        assertEquals(2, stats.lastOneOnOneOpenItems)

        // A reversed meeting (caller manages the manager) must not count, however new.
        admin.createTeam("stats-rev-${UUID.randomUUID()}", callerId, listOf(managerId))
        caller.createMeeting(managerId, "2026-06-01", listOf(item("reversed open")))
        stats = caller.managerItem(managerId)
        assertEquals("2026-02-01", stats.lastOneOnOneDate)
        assertEquals(2, stats.lastOneOnOneOpenItems)

        // Soft-deleting the latest meeting falls back to the previous one.
        assertEquals(HttpStatusCode.NoContent, mgr.delete("/api/v1/one-on-ones/${meetingB.id}").status)
        stats = caller.managerItem(managerId)
        assertEquals("2026-01-10", stats.lastOneOnOneDate)
        assertEquals(0, stats.lastOneOnOneOpenItems)
    }

    @Test
    fun `lastFeedbackAt is the SENT moment and survives later edits`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw")
        val callerEmail = uniqueEmail("caller")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", name = "Caller", role = UserRole.USER)
        val mgrEmail = uniqueEmail("mgr")
        val managerId = TestUsers.seed(email = mgrEmail, password = "pw", name = "Mgr", role = UserRole.USER)
        authedClient(adminEmail, "pw").createTeam("stats-fb-${UUID.randomUUID()}", managerId, listOf(callerId))

        val mgr = authedClient(mgrEmail, "pw")
        val caller = authedClient(callerEmail, "pw")

        // Draft → send: the stat is the STATUS_CHANGED{to=SENT} event's timestamp.
        val draft = mgr.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                FeedbackCreateRequest(
                    subjectId = callerId, providerId = managerId,
                    visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                    status = FeedbackStatus.DRAFT, content = "draft first",
                ),
            )
        }.body<FeedbackResponse>()
        assertEquals(HttpStatusCode.NoContent, mgr.post("/api/v1/feedbacks/${draft.id}/send").status)
        val sentEvent = mgr.get("/api/v1/feedbacks/${draft.id}/events").body<FeedbackEventListResponse>()
            .items.first { it.type == FeedbackEventType.STATUS_CHANGED && it.params["to"] == FeedbackStatus.SENT.name }
        assertEquals(sentEvent.timestamp, caller.managerItem(managerId).lastFeedbackAt)

        // A post-send content edit bumps lastModified but must not move the stat.
        assertEquals(
            HttpStatusCode.NoContent,
            mgr.put("/api/v1/feedbacks/${draft.id}") {
                contentType(ContentType.Application.Json)
                setBody(FeedbackContentUpdate(content = "edited later", visibility = FeedbackVisibility.PROVIDER_SUBJECT))
            }.status,
        )
        assertEquals(sentEvent.timestamp, caller.managerItem(managerId).lastFeedbackAt)

        // Created directly as SENT (the CREATED{status=SENT} branch) — newer, so it wins.
        val direct = mgr.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                FeedbackCreateRequest(
                    subjectId = callerId, providerId = managerId,
                    visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                    status = FeedbackStatus.SENT, content = "direct send",
                ),
            )
        }.body<FeedbackResponse>()
        val createdEvent = mgr.get("/api/v1/feedbacks/${direct.id}/events").body<FeedbackEventListResponse>()
            .items.first { it.type == FeedbackEventType.CREATED }
        assertTrue(createdEvent.timestamp >= sentEvent.timestamp)
        assertEquals(createdEvent.timestamp, caller.managerItem(managerId).lastFeedbackAt)

        // Withdrawing the newest falls back to the older still-SENT one; withdrawing both → null.
        assertEquals(HttpStatusCode.NoContent, mgr.post("/api/v1/feedbacks/${direct.id}/withdraw").status)
        assertEquals(sentEvent.timestamp, caller.managerItem(managerId).lastFeedbackAt)
        assertEquals(HttpStatusCode.NoContent, mgr.post("/api/v1/feedbacks/${draft.id}/withdraw").status)
        assertNull(caller.managerItem(managerId).lastFeedbackAt)
    }

    @Test
    fun `feedback the caller cannot see never counts`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw")
        val callerEmail = uniqueEmail("caller")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", name = "Caller", role = UserRole.USER)
        val mgrEmail = uniqueEmail("mgr")
        val managerId = TestUsers.seed(email = mgrEmail, password = "pw", name = "Mgr", role = UserRole.USER)
        val requesterEmail = uniqueEmail("req")
        val requesterId = TestUsers.seed(email = requesterEmail, password = "pw", name = "Req", role = UserRole.USER)
        authedClient(adminEmail, "pw").createTeam("stats-vis-${UUID.randomUUID()}", managerId, listOf(callerId))

        // A third party asks the manager for feedback about the caller, visible only to
        // provider + requester — delivered, but the subject must never learn of it via the stat.
        val requester = authedClient(requesterEmail, "pw")
        val feedback = requester.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                FeedbackCreateRequest(
                    requesterId = requesterId, subjectId = callerId, providerId = managerId,
                    visibility = FeedbackVisibility.PROVIDER_REQUESTER,
                    status = FeedbackStatus.REQUESTED,
                ),
            )
        }.body<FeedbackResponse>()
        val mgr = authedClient(mgrEmail, "pw")
        assertEquals(HttpStatusCode.NoContent, mgr.post("/api/v1/feedbacks/${feedback.id}/pick-up").status)
        assertEquals(
            HttpStatusCode.NoContent,
            mgr.put("/api/v1/feedbacks/${feedback.id}") {
                contentType(ContentType.Application.Json)
                setBody(FeedbackContentUpdate(content = "hidden", visibility = FeedbackVisibility.PROVIDER_REQUESTER))
            }.status,
        )
        assertEquals(HttpStatusCode.NoContent, mgr.post("/api/v1/feedbacks/${feedback.id}/send").status)

        assertNull(authedClient(callerEmail, "pw").managerItem(managerId).lastFeedbackAt)
    }

    @Test
    fun `pre-audit-trail feedbacks fall back to lastModified and shared teams repeat the stats`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw")
        val callerEmail = uniqueEmail("caller")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", name = "Caller", role = UserRole.USER)
        val mgrEmail = uniqueEmail("mgr")
        val managerId = TestUsers.seed(email = mgrEmail, password = "pw", name = "Mgr", role = UserRole.USER)
        val otherMgrId = TestUsers.seed(email = uniqueEmail("mgr2"), password = "pw", name = "Mgr2", role = UserRole.USER)
        val admin = authedClient(adminEmail, "pw")
        admin.createTeam("stats-legacy-a-${UUID.randomUUID()}", managerId, listOf(callerId))
        admin.createTeam("stats-legacy-b-${UUID.randomUUID()}", managerId, listOf(callerId))
        admin.createTeam("stats-legacy-c-${UUID.randomUUID()}", otherMgrId, listOf(callerId))

        val mgr = authedClient(mgrEmail, "pw")
        val sent = mgr.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                FeedbackCreateRequest(
                    subjectId = callerId, providerId = managerId,
                    visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                    status = FeedbackStatus.SENT, content = "old-school",
                ),
            )
        }.body<FeedbackResponse>()

        // Simulate a pre-V15 row: strip its audit events; the stat falls back to lastModified.
        suspendTransaction(TestFeedbackEvents.service.database) {
            FeedbackEventService.FeedbackEvents.deleteWhere {
                FeedbackEventService.FeedbackEvents.feedbackId eq sent.id
            }
        }
        val caller = authedClient(callerEmail, "pw")
        val lastModified = caller.get("/api/v1/feedbacks/${sent.id}").body<FeedbackResponse>().lastModified
        assertEquals(lastModified, caller.managerItem(managerId).lastFeedbackAt)

        // The manager shares two teams with the caller: both rows carry identical stats,
        // while the stat-less second manager stays null on the same page.
        val page = caller.get("/api/v1/teams/members?view=managers&pageSize=100").body<TeamMemberPageResponse>()
        val mgrRows = page.items.filter { it.userId == managerId }
        assertEquals(2, mgrRows.size)
        assertEquals(1, mgrRows.map { it.lastFeedbackAt }.distinct().size)
        assertNotNull(mgrRows.first().lastFeedbackAt)
        val otherRows = page.items.filter { it.userId == otherMgrId }
        assertTrue(otherRows.isNotEmpty())
        assertTrue(otherRows.all { it.lastFeedbackAt == null && it.lastOneOnOneDate == null })
    }
}
