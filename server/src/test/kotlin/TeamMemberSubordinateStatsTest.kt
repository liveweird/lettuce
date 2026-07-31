package ch.nokillswit

import ch.nokillswit.feedbacks.FeedbackContentUpdate
import ch.nokillswit.feedbacks.FeedbackCreateRequest
import ch.nokillswit.feedbacks.FeedbackEventListResponse
import ch.nokillswit.feedbacks.FeedbackEventService
import ch.nokillswit.feedbacks.FeedbackEventType
import ch.nokillswit.feedbacks.FeedbackResponse
import ch.nokillswit.feedbacks.FeedbackStatus
import ch.nokillswit.feedbacks.FeedbackVisibility
import ch.nokillswit.oneonones.ActionItemOwner
import ch.nokillswit.oneonones.OneOnOneActionItemInput
import ch.nokillswit.oneonones.OneOnOneCreateRequest
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
import ch.nokillswit.goals.GoalCloseRequest
import ch.nokillswit.goals.GoalCreateRequest
import ch.nokillswit.goals.GoalResponse
import ch.nokillswit.goals.GoalType
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.r2dbc.deleteWhere
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The per-subordinate dashboard stats carried by `GET /api/v1/teams/members?view=managed` —
 * the role-reversed mirror of TeamMemberManagerStatsTest: the caller is the manager/provider,
 * computed route-side from OneOnOneService.latestMeetingStatsBySubordinate and
 * FeedbackService.lastProvidedTo (provider-side — no Received-visibility scoping).
 */
class TeamMemberSubordinateStatsTest {

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

    private suspend fun HttpClient.subordinateItem(
        subordinateId: UInt,
        includeIndirect: Boolean = false,
    ): TeamMemberListItem {
        val indirect = if (includeIndirect) "&includeIndirect=true" else ""
        val page = get("/api/v1/teams/members?view=managed&pageSize=100$indirect")
            .body<TeamMemberPageResponse>()
        return page.items.first { it.userId == subordinateId }
    }

    private fun item(content: String, resolved: Boolean = false) =
        OneOnOneActionItemInput(content = content, owner = ActionItemOwner.SUBORDINATE, resolved = resolved)

    private suspend fun HttpClient.createGoal(subordinateId: UInt, title: String): GoalResponse {
        val response = post("/api/v1/goals") {
            contentType(ContentType.Application.Json)
            setBody(
                GoalCreateRequest(
                    subordinateId = subordinateId, title = title, type = GoalType.BINARY, dueDate = "2099-12-31",
                ),
            )
        }
        assertEquals(HttpStatusCode.Created, response.status, "goal create failed")
        return response.body<GoalResponse>()
    }

    @Test
    fun `activeGoalCount counts only the caller's ACTIVE goals for this subordinate`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw")
        val callerEmail = uniqueEmail("caller")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", name = "Caller", roles = emptySet())
        val subEmail = uniqueEmail("sub")
        val subId = TestUsers.seed(email = subEmail, password = "pw", name = "Sub", roles = emptySet())
        val admin = authedClient(adminEmail, "pw")
        admin.createTeam("goal-cnt-${UUID.randomUUID()}", callerId, listOf(subId))
        // The reverse team (the subordinate manages the caller) pins the direction below.
        admin.createTeam("goal-rev-${UUID.randomUUID()}", subId, listOf(callerId))

        val caller = authedClient(callerEmail, "pw")
        val sub = authedClient(subEmail, "pw")

        // A goal-less pair shows 0, not null; a DRAFT never counts.
        assertEquals(0, caller.subordinateItem(subId).activeGoalCount)
        val first = caller.createGoal(subId, "count me later")
        assertEquals(0, caller.subordinateItem(subId).activeGoalCount)

        caller.post("/api/v1/goals/${first.id}/activate")
        assertEquals(1, caller.subordinateItem(subId).activeGoalCount)

        // The reverse direction (a goal the subordinate set FOR the caller) never counts here.
        val reverse = sub.createGoal(callerId, "wrong direction")
        sub.post("/api/v1/goals/${reverse.id}/activate")
        assertEquals(1, caller.subordinateItem(subId).activeGoalCount)

        // Closing takes the goal back out of the count.
        val closed = caller.post("/api/v1/goals/${first.id}/close") {
            contentType(ContentType.Application.Json)
            setBody(GoalCloseRequest(summary = "done"))
        }
        assertEquals(HttpStatusCode.NoContent, closed.status)
        assertEquals(0, caller.subordinateItem(subId).activeGoalCount)
    }

    @Test
    fun `stats are null without data and never populated for the member view`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw")
        val callerEmail = uniqueEmail("caller")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", name = "Caller", roles = emptySet())
        val subId = TestUsers.seed(email = uniqueEmail("sub"), password = "pw", name = "Sub", roles = emptySet())
        val peerId = TestUsers.seed(email = uniqueEmail("peer"), password = "pw", name = "Peer", roles = emptySet())
        val mgrId = TestUsers.seed(email = uniqueEmail("mgr"), password = "pw", name = "Mgr", roles = emptySet())
        val admin = authedClient(adminEmail, "pw")
        admin.createTeam("substats-null-${UUID.randomUUID()}", callerId, listOf(subId))
        admin.createTeam("substats-peer-${UUID.randomUUID()}", mgrId, listOf(callerId, peerId))

        val caller = authedClient(callerEmail, "pw")
        val sub = caller.subordinateItem(subId)
        assertNull(sub.lastOneOnOneDate)
        assertNull(sub.lastOneOnOneOpenItems)
        assertNull(sub.lastFeedbackAt)

        // The member view lists the peer — its rows never carry stats.
        val members = caller.get("/api/v1/teams/members?view=member").body<TeamMemberPageResponse>()
        val peer = members.items.first { it.userId == peerId }
        assertNull(peer.lastOneOnOneDate)
        assertNull(peer.lastOneOnOneOpenItems)
        assertNull(peer.lastFeedbackAt)
    }

    @Test
    fun `the latest directional meeting drives the date and open count`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw")
        val callerEmail = uniqueEmail("caller")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", name = "Caller", roles = emptySet())
        val subEmail = uniqueEmail("sub")
        val subId = TestUsers.seed(email = subEmail, password = "pw", name = "Sub", roles = emptySet())
        val admin = authedClient(adminEmail, "pw")
        admin.createTeam("substats-dir-${UUID.randomUUID()}", callerId, listOf(subId))

        val caller = authedClient(callerEmail, "pw")
        val sub = authedClient(subEmail, "pw")

        // Meeting A: one already-resolved item, so nothing carries over into later meetings.
        caller.createMeeting(subId, "2026-01-10", listOf(item("done thing", resolved = true)))
        var stats = caller.subordinateItem(subId)
        assertEquals("2026-01-10", stats.lastOneOnOneDate)
        assertEquals(0, stats.lastOneOnOneOpenItems) // zero open is 0, not null

        // Meeting B (newer): two unresolved items.
        val meetingB = caller.createMeeting(subId, "2026-02-01", listOf(item("open one"), item("open two")))
        stats = caller.subordinateItem(subId)
        assertEquals("2026-02-01", stats.lastOneOnOneDate)
        assertEquals(2, stats.lastOneOnOneOpenItems)

        // A reversed meeting (the subordinate manages the caller elsewhere and runs a 1:1 with
        // them) must not count, however new.
        admin.createTeam("substats-rev-${UUID.randomUUID()}", subId, listOf(callerId))
        sub.createMeeting(callerId, "2026-06-01", listOf(item("reversed open")))
        stats = caller.subordinateItem(subId)
        assertEquals("2026-02-01", stats.lastOneOnOneDate)
        assertEquals(2, stats.lastOneOnOneOpenItems)

        // Soft-deleting the latest meeting falls back to the previous one.
        assertEquals(HttpStatusCode.NoContent, caller.delete("/api/v1/one-on-ones/${meetingB.id}").status)
        stats = caller.subordinateItem(subId)
        assertEquals("2026-01-10", stats.lastOneOnOneDate)
        assertEquals(0, stats.lastOneOnOneOpenItems)
    }

    @Test
    fun `lastFeedbackAt is the SENT moment and survives later edits`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw")
        val callerEmail = uniqueEmail("caller")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", name = "Caller", roles = emptySet())
        val subId = TestUsers.seed(email = uniqueEmail("sub"), password = "pw", name = "Sub", roles = emptySet())
        authedClient(adminEmail, "pw").createTeam("substats-fb-${UUID.randomUUID()}", callerId, listOf(subId))

        val caller = authedClient(callerEmail, "pw")

        // Draft → send: the stat is the STATUS_CHANGED{to=SENT} event's timestamp.
        val draft = caller.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                FeedbackCreateRequest(
                    subjectId = subId, providerId = callerId,
                    visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                    status = FeedbackStatus.DRAFT, content = "draft first",
                ),
            )
        }.body<FeedbackResponse>()
        assertEquals(HttpStatusCode.NoContent, caller.post("/api/v1/feedbacks/${draft.id}/send").status)
        val sentEvent = caller.get("/api/v1/feedbacks/${draft.id}/events").body<FeedbackEventListResponse>()
            .items.first { it.type == FeedbackEventType.STATUS_CHANGED && it.params["to"] == FeedbackStatus.SENT.name }
        assertEquals(sentEvent.timestamp, caller.subordinateItem(subId).lastFeedbackAt)

        // A post-send content edit bumps lastModified but must not move the stat.
        assertEquals(
            HttpStatusCode.NoContent,
            caller.put("/api/v1/feedbacks/${draft.id}") {
                contentType(ContentType.Application.Json)
                setBody(FeedbackContentUpdate(content = "edited later", visibility = FeedbackVisibility.PROVIDER_SUBJECT))
            }.status,
        )
        assertEquals(sentEvent.timestamp, caller.subordinateItem(subId).lastFeedbackAt)

        // Created directly as SENT (the CREATED{status=SENT} branch) — newer, so it wins.
        val direct = caller.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                FeedbackCreateRequest(
                    subjectId = subId, providerId = callerId,
                    visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                    status = FeedbackStatus.SENT, content = "direct send",
                ),
            )
        }.body<FeedbackResponse>()
        val createdEvent = caller.get("/api/v1/feedbacks/${direct.id}/events").body<FeedbackEventListResponse>()
            .items.first { it.type == FeedbackEventType.CREATED }
        assertTrue(createdEvent.timestamp >= sentEvent.timestamp)
        assertEquals(createdEvent.timestamp, caller.subordinateItem(subId).lastFeedbackAt)

        // Withdrawing the newest falls back to the older still-SENT one; withdrawing both → null.
        assertEquals(HttpStatusCode.NoContent, caller.post("/api/v1/feedbacks/${direct.id}/withdraw").status)
        assertEquals(sentEvent.timestamp, caller.subordinateItem(subId).lastFeedbackAt)
        assertEquals(HttpStatusCode.NoContent, caller.post("/api/v1/feedbacks/${draft.id}/withdraw").status)
        assertNull(caller.subordinateItem(subId).lastFeedbackAt)
    }

    @Test
    fun `feedback the subordinate cannot see still counts for the providing caller`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw")
        val callerEmail = uniqueEmail("caller")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", name = "Caller", roles = emptySet())
        val subEmail = uniqueEmail("sub")
        val subId = TestUsers.seed(email = subEmail, password = "pw", name = "Sub", roles = emptySet())
        val requesterEmail = uniqueEmail("req")
        val requesterId = TestUsers.seed(email = requesterEmail, password = "pw", name = "Req", roles = emptySet())
        authedClient(adminEmail, "pw").createTeam("substats-vis-${UUID.randomUUID()}", callerId, listOf(subId))

        // A third party asks the caller for feedback about the subordinate, visible only to
        // provider + requester. The caller is the provider, so — unlike the managers-view stat,
        // which is scoped to what the subject can see — it counts here.
        val requester = authedClient(requesterEmail, "pw")
        val feedback = requester.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                FeedbackCreateRequest(
                    requesterId = requesterId, subjectId = subId, providerId = callerId,
                    visibility = FeedbackVisibility.PROVIDER_REQUESTER,
                    status = FeedbackStatus.REQUESTED,
                ),
            )
        }.body<FeedbackResponse>()
        val caller = authedClient(callerEmail, "pw")
        assertEquals(HttpStatusCode.NoContent, caller.post("/api/v1/feedbacks/${feedback.id}/pick-up").status)
        assertEquals(
            HttpStatusCode.NoContent,
            caller.put("/api/v1/feedbacks/${feedback.id}") {
                contentType(ContentType.Application.Json)
                setBody(FeedbackContentUpdate(content = "hidden", visibility = FeedbackVisibility.PROVIDER_REQUESTER))
            }.status,
        )
        assertEquals(HttpStatusCode.NoContent, caller.post("/api/v1/feedbacks/${feedback.id}/send").status)

        val sentEvent = caller.get("/api/v1/feedbacks/${feedback.id}/events").body<FeedbackEventListResponse>()
            .items.first { it.type == FeedbackEventType.STATUS_CHANGED && it.params["to"] == FeedbackStatus.SENT.name }
        assertEquals(sentEvent.timestamp, caller.subordinateItem(subId).lastFeedbackAt)

        // The subject-side mirror stays hidden: the subordinate's managers view of the caller
        // must not learn of the invisible feedback.
        val sub = authedClient(subEmail, "pw")
        val callerAsManager = sub.get("/api/v1/teams/members?view=managers&pageSize=100")
            .body<TeamMemberPageResponse>().items.first { it.userId == callerId }
        assertNull(callerAsManager.lastFeedbackAt)
    }

    @Test
    fun `pre-audit-trail feedbacks fall back to lastModified, shared teams repeat, indirect reports enrich`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw")
        val callerEmail = uniqueEmail("caller")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", name = "Caller", roles = emptySet())
        val subId = TestUsers.seed(email = uniqueEmail("sub"), password = "pw", name = "Sub", roles = emptySet())
        val otherSubId = TestUsers.seed(email = uniqueEmail("sub2"), password = "pw", name = "Sub2", roles = emptySet())
        val indirectId = TestUsers.seed(email = uniqueEmail("ind"), password = "pw", name = "Ind", roles = emptySet())
        val admin = authedClient(adminEmail, "pw")
        admin.createTeam("substats-legacy-a-${UUID.randomUUID()}", callerId, listOf(subId, otherSubId))
        admin.createTeam("substats-legacy-b-${UUID.randomUUID()}", callerId, listOf(subId))
        admin.createTeam("substats-legacy-c-${UUID.randomUUID()}", subId, listOf(indirectId))

        val caller = authedClient(callerEmail, "pw")
        val sent = caller.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                FeedbackCreateRequest(
                    subjectId = subId, providerId = callerId,
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
        val lastModified = caller.get("/api/v1/feedbacks/${sent.id}").body<FeedbackResponse>().lastModified
        assertEquals(lastModified, caller.subordinateItem(subId).lastFeedbackAt)

        // The subordinate shares two teams with the caller: both rows carry identical stats,
        // while the stat-less second subordinate stays null on the same page.
        val page = caller.get("/api/v1/teams/members?view=managed&pageSize=100").body<TeamMemberPageResponse>()
        val subRows = page.items.filter { it.userId == subId }
        assertEquals(2, subRows.size)
        assertEquals(1, subRows.map { it.lastFeedbackAt }.distinct().size)
        assertNotNull(subRows.first().lastFeedbackAt)
        val otherRows = page.items.filter { it.userId == otherSubId }
        assertTrue(otherRows.isNotEmpty())
        assertTrue(otherRows.all { it.lastFeedbackAt == null && it.lastOneOnOneDate == null })

        // includeIndirect widens to the transitive chain — indirect rows are enriched too:
        // a feedback the caller sent them counts, while the 1:1 stat is legitimately absent
        // (the caller runs no 1:1s with indirect reports).
        val indirectSent = caller.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                FeedbackCreateRequest(
                    subjectId = indirectId, providerId = callerId,
                    visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                    status = FeedbackStatus.SENT, content = "skip-level",
                ),
            )
        }.body<FeedbackResponse>()
        val createdEvent = caller.get("/api/v1/feedbacks/${indirectSent.id}/events").body<FeedbackEventListResponse>()
            .items.first { it.type == FeedbackEventType.CREATED }
        val indirect = caller.subordinateItem(indirectId, includeIndirect = true)
        assertEquals(createdEvent.timestamp, indirect.lastFeedbackAt)
        assertNull(indirect.lastOneOnOneDate)
        assertNull(indirect.lastOneOnOneOpenItems)
    }
}
