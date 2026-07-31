package ch.nokillswit

import ch.nokillswit.feedbacks.FeedbackContentUpdate
import ch.nokillswit.feedbacks.FeedbackCreateRequest
import ch.nokillswit.feedbacks.FeedbackEventListResponse
import ch.nokillswit.feedbacks.FeedbackEventService
import ch.nokillswit.feedbacks.FeedbackEventType
import ch.nokillswit.feedbacks.FeedbackResponse
import ch.nokillswit.feedbacks.FeedbackStatus
import ch.nokillswit.feedbacks.FeedbackVisibility
import ch.nokillswit.teams.Team
import ch.nokillswit.teams.TeamMemberListItem
import ch.nokillswit.teams.TeamMemberPageResponse
import ch.nokillswit.users.UserRole
import io.ktor.client.HttpClient
import io.ktor.client.call.body
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
 * The per-peer dashboard stats carried by `GET /api/v1/teams/members?view=member` —
 * `lastFeedbackGivenAt` (caller → peer, provider-side via FeedbackService.lastProvidedTo, never
 * visibility-filtered) and `lastFeedbackReceivedAt` (peer → caller, received-scoped via
 * FeedbackService.lastProvidedAt — an invisible feedback never leaks). Third sibling of
 * TeamMemberManagerStatsTest / TeamMemberSubordinateStatsTest; peers carry no 1:1 stat.
 */
class TeamMemberPeerStatsTest {

    private suspend fun HttpClient.createTeam(name: String, managerId: UInt, memberIds: List<UInt>) =
        post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = name, managerId = managerId, memberIds = memberIds))
        }

    private suspend fun HttpClient.peerItem(peerId: UInt): TeamMemberListItem {
        val page = get("/api/v1/teams/members?view=member&pageSize=100").body<TeamMemberPageResponse>()
        return page.items.first { it.userId == peerId }
    }

    private suspend fun HttpClient.sendFeedback(
        providerId: UInt,
        subjectId: UInt,
        content: String = "well done",
        visibility: FeedbackVisibility = FeedbackVisibility.PROVIDER_SUBJECT,
    ): FeedbackResponse = post("/api/v1/feedbacks") {
        contentType(ContentType.Application.Json)
        setBody(
            FeedbackCreateRequest(
                subjectId = subjectId, providerId = providerId,
                visibility = visibility, status = FeedbackStatus.SENT, content = content,
            ),
        )
    }.body<FeedbackResponse>()

    private suspend fun HttpClient.createdEventTimestamp(feedbackId: UInt): Long =
        get("/api/v1/feedbacks/$feedbackId/events").body<FeedbackEventListResponse>()
            .items.first { it.type == FeedbackEventType.CREATED }.timestamp

    private suspend fun HttpClient.sentEventTimestamp(feedbackId: UInt): Long =
        get("/api/v1/feedbacks/$feedbackId/events").body<FeedbackEventListResponse>()
            .items.first {
                it.type == FeedbackEventType.STATUS_CHANGED && it.params["to"] == FeedbackStatus.SENT.name
            }.timestamp

    @Test
    fun `stats are null without data and the pair is never populated for the other views`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw")
        val callerEmail = uniqueEmail("caller")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", name = "Caller", roles = emptySet())
        val peerId = TestUsers.seed(email = uniqueEmail("peer"), password = "pw", name = "Peer", roles = emptySet())
        val mgrEmail = uniqueEmail("mgr")
        val mgrId = TestUsers.seed(email = mgrEmail, password = "pw", name = "Mgr", roles = emptySet())
        val subId = TestUsers.seed(email = uniqueEmail("sub"), password = "pw", name = "Sub", roles = emptySet())
        val admin = authedClient(adminEmail, "pw")
        admin.createTeam("peerstats-null-${UUID.randomUUID()}", mgrId, listOf(callerId, peerId))
        admin.createTeam("peerstats-managed-${UUID.randomUUID()}", callerId, listOf(subId))

        val caller = authedClient(callerEmail, "pw")
        val peer = caller.peerItem(peerId)
        assertNull(peer.lastFeedbackGivenAt)
        assertNull(peer.lastFeedbackReceivedAt)
        assertNull(peer.lastOneOnOneDate)
        assertNull(peer.lastOneOnOneOpenItems)
        assertNull(peer.lastFeedbackAt)
        assertNull(peer.activeGoalCount) // peers have no goal relationship — null, never 0

        // Feedback that populates the directional views' lastFeedbackAt must never bleed
        // into the member-only given/received pair.
        caller.sendFeedback(providerId = callerId, subjectId = subId)
        val managed = caller.get("/api/v1/teams/members?view=managed&pageSize=100")
            .body<TeamMemberPageResponse>().items.first { it.userId == subId }
        assertNotNull(managed.lastFeedbackAt)
        assertNull(managed.lastFeedbackGivenAt)
        assertNull(managed.lastFeedbackReceivedAt)

        authedClient(mgrEmail, "pw").sendFeedback(providerId = mgrId, subjectId = callerId)
        val manager = caller.get("/api/v1/teams/members?view=managers&pageSize=100")
            .body<TeamMemberPageResponse>().items.first { it.userId == mgrId }
        assertNotNull(manager.lastFeedbackAt)
        assertNull(manager.lastFeedbackGivenAt)
        assertNull(manager.lastFeedbackReceivedAt)
    }

    @Test
    fun `lastFeedbackGivenAt is the SENT moment and survives later edits`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw")
        val callerEmail = uniqueEmail("caller")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", name = "Caller", roles = emptySet())
        val peerId = TestUsers.seed(email = uniqueEmail("peer"), password = "pw", name = "Peer", roles = emptySet())
        val mgrId = TestUsers.seed(email = uniqueEmail("mgr"), password = "pw", name = "Mgr", roles = emptySet())
        authedClient(adminEmail, "pw").createTeam("peerstats-given-${UUID.randomUUID()}", mgrId, listOf(callerId, peerId))

        val caller = authedClient(callerEmail, "pw")

        // Draft → send: the stat is the STATUS_CHANGED{to=SENT} event's timestamp.
        val draft = caller.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                FeedbackCreateRequest(
                    subjectId = peerId, providerId = callerId,
                    visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                    status = FeedbackStatus.DRAFT, content = "draft first",
                ),
            )
        }.body<FeedbackResponse>()
        assertEquals(HttpStatusCode.NoContent, caller.post("/api/v1/feedbacks/${draft.id}/send").status)
        val sentAt = caller.sentEventTimestamp(draft.id)
        assertEquals(sentAt, caller.peerItem(peerId).lastFeedbackGivenAt)

        // A post-send content edit bumps lastModified but must not move the stat.
        assertEquals(
            HttpStatusCode.NoContent,
            caller.put("/api/v1/feedbacks/${draft.id}") {
                contentType(ContentType.Application.Json)
                setBody(FeedbackContentUpdate(content = "edited later", visibility = FeedbackVisibility.PROVIDER_SUBJECT))
            }.status,
        )
        assertEquals(sentAt, caller.peerItem(peerId).lastFeedbackGivenAt)

        // Created directly as SENT (the CREATED{status=SENT} branch) — newer, so it wins.
        val direct = caller.sendFeedback(providerId = callerId, subjectId = peerId, content = "direct send")
        val createdAt = caller.createdEventTimestamp(direct.id)
        assertTrue(createdAt >= sentAt)
        assertEquals(createdAt, caller.peerItem(peerId).lastFeedbackGivenAt)

        // Withdrawing the newest falls back to the older still-SENT one; withdrawing both → null.
        assertEquals(HttpStatusCode.NoContent, caller.post("/api/v1/feedbacks/${direct.id}/withdraw").status)
        assertEquals(sentAt, caller.peerItem(peerId).lastFeedbackGivenAt)
        assertEquals(HttpStatusCode.NoContent, caller.post("/api/v1/feedbacks/${draft.id}/withdraw").status)
        assertNull(caller.peerItem(peerId).lastFeedbackGivenAt)
    }

    @Test
    fun `lastFeedbackReceivedAt is the SENT moment and is visibility-scoped`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw")
        val callerEmail = uniqueEmail("caller")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", name = "Caller", roles = emptySet())
        val peerEmail = uniqueEmail("peer")
        val peerId = TestUsers.seed(email = peerEmail, password = "pw", name = "Peer", roles = emptySet())
        val mgrId = TestUsers.seed(email = uniqueEmail("mgr"), password = "pw", name = "Mgr", roles = emptySet())
        val requesterEmail = uniqueEmail("req")
        val requesterId = TestUsers.seed(email = requesterEmail, password = "pw", name = "Req", roles = emptySet())
        authedClient(adminEmail, "pw").createTeam("peerstats-recv-${UUID.randomUUID()}", mgrId, listOf(callerId, peerId))

        val caller = authedClient(callerEmail, "pw")
        val peer = authedClient(peerEmail, "pw")

        // A visible peer → caller feedback sets the received stat to its SENT moment.
        val visible = peer.sendFeedback(providerId = peerId, subjectId = callerId)
        assertEquals(peer.createdEventTimestamp(visible.id), caller.peerItem(peerId).lastFeedbackReceivedAt)

        // Withdrawing it clears the stat.
        assertEquals(HttpStatusCode.NoContent, peer.post("/api/v1/feedbacks/${visible.id}/withdraw").status)
        assertNull(caller.peerItem(peerId).lastFeedbackReceivedAt)

        // A peer → caller feedback the caller cannot see (visible only to provider + requester)
        // must not set the caller's received stat — while the peer's own given stat IS set.
        val requester = authedClient(requesterEmail, "pw")
        val hidden = requester.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                FeedbackCreateRequest(
                    requesterId = requesterId, subjectId = callerId, providerId = peerId,
                    visibility = FeedbackVisibility.PROVIDER_REQUESTER,
                    status = FeedbackStatus.REQUESTED,
                ),
            )
        }.body<FeedbackResponse>()
        assertEquals(HttpStatusCode.NoContent, peer.post("/api/v1/feedbacks/${hidden.id}/pick-up").status)
        assertEquals(
            HttpStatusCode.NoContent,
            peer.put("/api/v1/feedbacks/${hidden.id}") {
                contentType(ContentType.Application.Json)
                setBody(FeedbackContentUpdate(content = "hidden", visibility = FeedbackVisibility.PROVIDER_REQUESTER))
            }.status,
        )
        assertEquals(HttpStatusCode.NoContent, peer.post("/api/v1/feedbacks/${hidden.id}/send").status)

        assertNull(caller.peerItem(peerId).lastFeedbackReceivedAt)
        assertEquals(peer.sentEventTimestamp(hidden.id), peer.peerItem(callerId).lastFeedbackGivenAt)
    }

    @Test
    fun `a hidden feedback the caller provided counts as given but never leaks to the peer`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw")
        val callerEmail = uniqueEmail("caller")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", name = "Caller", roles = emptySet())
        val peerEmail = uniqueEmail("peer")
        val peerId = TestUsers.seed(email = peerEmail, password = "pw", name = "Peer", roles = emptySet())
        val mgrId = TestUsers.seed(email = uniqueEmail("mgr"), password = "pw", name = "Mgr", roles = emptySet())
        val requesterEmail = uniqueEmail("req")
        val requesterId = TestUsers.seed(email = requesterEmail, password = "pw", name = "Req", roles = emptySet())
        authedClient(adminEmail, "pw").createTeam("peerstats-leak-${UUID.randomUUID()}", mgrId, listOf(callerId, peerId))

        val requester = authedClient(requesterEmail, "pw")
        val feedback = requester.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                FeedbackCreateRequest(
                    requesterId = requesterId, subjectId = peerId, providerId = callerId,
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

        // Provider-side: the caller's given stat is set …
        assertEquals(caller.sentEventTimestamp(feedback.id), caller.peerItem(peerId).lastFeedbackGivenAt)
        // … while the member view is symmetric, and the subject-peer must not learn of it.
        assertNull(authedClient(peerEmail, "pw").peerItem(callerId).lastFeedbackReceivedAt)
    }

    @Test
    fun `pre-audit-trail feedbacks fall back to lastModified and shared teams repeat the stats`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw")
        val callerEmail = uniqueEmail("caller")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", name = "Caller", roles = emptySet())
        val peerId = TestUsers.seed(email = uniqueEmail("peer"), password = "pw", name = "Peer", roles = emptySet())
        val otherPeerId = TestUsers.seed(email = uniqueEmail("peer2"), password = "pw", name = "Peer2", roles = emptySet())
        val mgrId = TestUsers.seed(email = uniqueEmail("mgr"), password = "pw", name = "Mgr", roles = emptySet())
        val admin = authedClient(adminEmail, "pw")
        admin.createTeam("peerstats-legacy-a-${UUID.randomUUID()}", mgrId, listOf(callerId, peerId, otherPeerId))
        admin.createTeam("peerstats-legacy-b-${UUID.randomUUID()}", mgrId, listOf(callerId, peerId))

        val caller = authedClient(callerEmail, "pw")
        val sent = caller.sendFeedback(providerId = callerId, subjectId = peerId, content = "old-school")

        // Simulate a pre-V15 row: strip its audit events; the stat falls back to lastModified.
        suspendTransaction(TestFeedbackEvents.service.database) {
            FeedbackEventService.FeedbackEvents.deleteWhere {
                FeedbackEventService.FeedbackEvents.feedbackId eq sent.id
            }
        }
        val lastModified = caller.get("/api/v1/feedbacks/${sent.id}").body<FeedbackResponse>().lastModified
        assertEquals(lastModified, caller.peerItem(peerId).lastFeedbackGivenAt)

        // The peer shares two teams with the caller: both rows carry identical stats,
        // while the stat-less second peer stays null on the same page.
        val page = caller.get("/api/v1/teams/members?view=member&pageSize=100").body<TeamMemberPageResponse>()
        val peerRows = page.items.filter { it.userId == peerId }
        assertEquals(2, peerRows.size)
        assertEquals(1, peerRows.map { it.lastFeedbackGivenAt }.distinct().size)
        assertNotNull(peerRows.first().lastFeedbackGivenAt)
        val otherRows = page.items.filter { it.userId == otherPeerId }
        assertTrue(otherRows.isNotEmpty())
        assertTrue(otherRows.all { it.lastFeedbackGivenAt == null && it.lastFeedbackReceivedAt == null })
    }

    @Test
    fun `the stats are symmetric between two peers`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw")
        val aEmail = uniqueEmail("peer-a")
        val aId = TestUsers.seed(email = aEmail, password = "pw", name = "PeerA", roles = emptySet())
        val bEmail = uniqueEmail("peer-b")
        val bId = TestUsers.seed(email = bEmail, password = "pw", name = "PeerB", roles = emptySet())
        val mgrId = TestUsers.seed(email = uniqueEmail("mgr"), password = "pw", name = "Mgr", roles = emptySet())
        authedClient(adminEmail, "pw").createTeam("peerstats-sym-${UUID.randomUUID()}", mgrId, listOf(aId, bId))

        val a = authedClient(aEmail, "pw")
        val b = authedClient(bEmail, "pw")
        val aToB = a.sendFeedback(providerId = aId, subjectId = bId, content = "a to b")
        val bToA = b.sendFeedback(providerId = bId, subjectId = aId, content = "b to a")
        val ts1 = a.createdEventTimestamp(aToB.id)
        val ts2 = b.createdEventTimestamp(bToA.id)

        val aSeesB = a.peerItem(bId)
        assertEquals(ts1, aSeesB.lastFeedbackGivenAt)
        assertEquals(ts2, aSeesB.lastFeedbackReceivedAt)
        val bSeesA = b.peerItem(aId)
        assertEquals(ts2, bSeesA.lastFeedbackGivenAt)
        assertEquals(ts1, bSeesA.lastFeedbackReceivedAt)
    }
}
