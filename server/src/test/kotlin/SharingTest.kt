package ch.nokillswit

import ch.nokillswit.authz.CallerPrincipal
import ch.nokillswit.authz.ForbiddenException
import ch.nokillswit.daysoff.DaysOffCalendarShareable
import ch.nokillswit.feedbacks.Feedback
import ch.nokillswit.feedbacks.FeedbackContentUpdate
import ch.nokillswit.feedbacks.FeedbackCreateRequest
import ch.nokillswit.feedbacks.FeedbackDoc
import ch.nokillswit.feedbacks.FeedbackEventListResponse
import ch.nokillswit.feedbacks.FeedbackResponse
import ch.nokillswit.feedbacks.FeedbackService
import ch.nokillswit.feedbacks.FeedbackShareable
import ch.nokillswit.feedbacks.FeedbackStatus
import ch.nokillswit.feedbacks.FeedbackVisibility
import ch.nokillswit.goals.GoalArchiveRequest
import ch.nokillswit.goals.GoalCreateRequest
import ch.nokillswit.goals.GoalDefinitionUpdate
import ch.nokillswit.goals.GoalEventListResponse
import ch.nokillswit.goals.GoalProgressUpdate
import ch.nokillswit.goals.GoalResponse
import ch.nokillswit.goals.GoalType
import ch.nokillswit.impactlog.ImpactEntryEventListResponse
import ch.nokillswit.impactlog.ImpactEntryRequest
import ch.nokillswit.impactlog.ImpactEntryResponse
import ch.nokillswit.notifications.NotificationPageResponse
import ch.nokillswit.notifications.NotificationResponse
import ch.nokillswit.notifications.NotificationType
import ch.nokillswit.oneonones.ActionItemHistoryResponse
import ch.nokillswit.oneonones.ActionItemOwner
import ch.nokillswit.oneonones.OneOnOneActionItemInput
import ch.nokillswit.oneonones.OneOnOneCreateRequest
import ch.nokillswit.oneonones.OneOnOneEventListResponse
import ch.nokillswit.oneonones.OneOnOneEventType
import ch.nokillswit.oneonones.OneOnOneItemInput
import ch.nokillswit.oneonones.OneOnOneResponse
import ch.nokillswit.oneonones.OneOnOneUpdateRequest
import ch.nokillswit.plugins.ProblemDetail
import ch.nokillswit.reviews.CategoryAssessment
import ch.nokillswit.reviews.PerformanceReviewCreateRequest
import ch.nokillswit.reviews.PerformanceReviewEventListResponse
import ch.nokillswit.reviews.PerformanceReviewResponse
import ch.nokillswit.reviews.PerformanceReviewStatus
import ch.nokillswit.reviews.PerformanceReviewUpdateRequest
import ch.nokillswit.sharing.ShareAccess
import ch.nokillswit.sharing.ShareAccessKey
import ch.nokillswit.sharing.ShareBatchItemStatus
import ch.nokillswit.sharing.ShareBatchRequest
import ch.nokillswit.sharing.ShareBatchResponse
import ch.nokillswit.sharing.ShareCreateOutcome
import ch.nokillswit.sharing.SharePageResponse
import ch.nokillswit.sharing.ShareRequest
import ch.nokillswit.sharing.ShareResponse
import ch.nokillswit.sharing.ShareService
import ch.nokillswit.sharing.ShareServiceKey
import ch.nokillswit.sharing.ShareableResourceType
import ch.nokillswit.succession.CandidateAwareness
import ch.nokillswit.succession.NominationType
import ch.nokillswit.succession.RetentionRisk
import ch.nokillswit.succession.RoleCriticality
import ch.nokillswit.succession.SuccessionCompetencyGap
import ch.nokillswit.succession.SuccessionEventType
import ch.nokillswit.succession.SuccessionNominationRequest
import ch.nokillswit.succession.SuccessionNominationResponse
import ch.nokillswit.succession.SuccessionPlanCreateRequest
import ch.nokillswit.succession.SuccessionPlanEventListResponse
import ch.nokillswit.succession.SuccessionPlanResponse
import ch.nokillswit.succession.SuccessionPlanStatus
import ch.nokillswit.succession.SuccessionPlanUpdate
import ch.nokillswit.succession.SuccessorReadiness
import ch.nokillswit.teamkpis.TeamKpiCreateRequest
import ch.nokillswit.teamkpis.TeamKpiDefinitionUpdate
import ch.nokillswit.teamkpis.TeamKpiEventListResponse
import ch.nokillswit.teamkpis.TeamKpiResponse
import ch.nokillswit.teamkpis.TeamKpiType
import ch.nokillswit.teamkpis.TeamKpiValueListResponse
import ch.nokillswit.teamkpis.TeamKpiValueWrite
import ch.nokillswit.teams.Team
import ch.nokillswit.users.Feature
import ch.nokillswit.users.OPT_IN_FEATURES
import ch.nokillswit.users.UserRole
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.parameter
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import java.time.LocalDate
import kotlinx.coroutines.runBlocking
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Document sharing end to end, against REAL documents — one section per shareable feature (this
 * file starts with feedbacks; the others join as their adapters land). The generic share
 * routes are covered over a stub adapter in `ShareRoutesTest`; here the point is what a share
 * actually GRANTS through the real read guards, and what it never does.
 */
class SharingTest {

    private val password = "pw-123456789"

    private class Person(val id: UInt, val name: String, val email: String, val client: HttpClient)

    private suspend fun ApplicationTestBuilder.person(
        prefix: String,
        roles: Set<UserRole> = emptySet(),
        disabled: Set<Feature> = emptySet(),
    ): Person {
        val email = uniqueEmail(prefix)
        val name = "$prefix-${email.substringAfter('-').take(8)}"
        val id = TestUsers.seed(email = email, password = password, name = name, roles = roles)
        // setDisabledFeatures replaces wholesale — keep the inverted-default MFA/Teams rows.
        if (disabled.isNotEmpty()) TestServices.users.setDisabledFeatures(id, disabled + OPT_IN_FEATURES)
        return Person(id, name, email, authedClient(email, password))
    }

    private suspend fun HttpClient.share(feedbackId: UInt, shareeId: UInt, expiresOn: String? = null): HttpResponse =
        post("/api/v1/shares") {
            contentType(ContentType.Application.Json)
            setBody(ShareRequest(ShareableResourceType.FEEDBACK, feedbackId, shareeId, expiresOn))
        }

    private suspend fun HttpClient.shareId(feedbackId: UInt, shareeId: UInt, expiresOn: String? = null): UInt {
        val response = share(feedbackId, shareeId, expiresOn)
        assertEquals(HttpStatusCode.Created, response.status)
        return response.body<ShareResponse>().id
    }

    /** The app's own share clock — the one "today" dates are validated against. */
    private fun ApplicationTestBuilder.serverToday(): LocalDate = application.attributes[ShareServiceKey].today()

    private suspend fun HttpClient.feedback(id: UInt) = get("/api/v1/feedbacks/$id")

    private suspend fun HttpClient.notifications(): List<NotificationResponse> =
        get("/api/v1/notifications").body<NotificationPageResponse>().items

    /** A SENT feedback about [subject] written through the API (so it has its CREATED event). */
    private suspend fun Person.writeFeedback(
        subject: Person,
        visibility: FeedbackVisibility = FeedbackVisibility.PROVIDER_SUBJECT,
        content: String = "Confidential feedback text",
    ): UInt {
        val response = client.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                FeedbackCreateRequest(
                    subjectId = subject.id,
                    providerId = id,
                    visibility = visibility,
                    status = FeedbackStatus.SENT,
                    content = content,
                ),
            )
        }
        assertEquals(HttpStatusCode.Created, response.status)
        return response.body<FeedbackResponse>().id
    }

    private suspend fun HttpResponse.detail() = body<ProblemDetail>().detail

    @Test
    fun `a sharee reads the feedback and its events through the share - sharedBy set, canShare false`() = testApplication {
        usePostgresTestcontainer()
        val provider = person("provider")
        val subject = person("subject")
        val sharee = person("sharee")
        val id = provider.writeFeedback(subject)

        // Before the share: an outsider is denied the document and its history.
        assertEquals(HttpStatusCode.Forbidden, sharee.client.feedback(id).status)
        assertEquals(HttpStatusCode.Forbidden, sharee.client.get("/api/v1/feedbacks/$id/events").status)

        provider.client.shareId(id, sharee.id)

        val shared = sharee.client.feedback(id)
        assertEquals(HttpStatusCode.OK, shared.status)
        val body = shared.body<FeedbackResponse>()
        assertEquals("Confidential feedback text", body.content)
        assertEquals(provider.name, body.sharedBy)
        assertFalse(body.canShare, "access through a share is never shareable again")
        val events = sharee.client.get("/api/v1/feedbacks/$id/events")
        assertEquals(HttpStatusCode.OK, events.status)
        assertTrue(events.body<FeedbackEventListResponse>().items.isNotEmpty())

        // The provider and the subject read in their own right: canShare true, no banner.
        for (party in listOf(provider, subject)) {
            val own = party.client.feedback(id).body<FeedbackResponse>()
            assertTrue(own.canShare, "${party.name} reads in their own right")
            assertNull(own.sharedBy)
        }
        // The share list row carries the content-free snapshot and the view path.
        val row = sharee.client.get("/api/v1/shares").body<SharePageResponse>().items.single()
        assertEquals(mapOf("provider" to provider.name, "subjects" to subject.name), row.details)
        assertEquals("/feedback/$id/view", row.link)
        // The subject never sees the share list (reads in own right: only rows they created — none).
        val subjectView = subject.client.get("/api/v1/shares") {
            parameter("view", "document")
            parameter("resourceType", "FEEDBACK")
            parameter("resourceId", id.toString())
        }
        assertEquals(0L, subjectView.body<SharePageResponse>().total)
    }

    @Test
    fun `a sharee cannot write - edit, transitions and delete are all 403`() = testApplication {
        usePostgresTestcontainer()
        val provider = person("provider")
        val subject = person("subject")
        val sharee = person("sharee")
        val id = provider.writeFeedback(subject)
        provider.client.shareId(id, sharee.id)

        val put = sharee.client.put("/api/v1/feedbacks/$id") {
            contentType(ContentType.Application.Json)
            setBody(FeedbackContentUpdate("tampered", FeedbackVisibility.PUBLIC))
        }
        assertEquals(HttpStatusCode.Forbidden, put.status)
        for (action in listOf("send", "withdraw", "reject", "pick-up")) {
            assertEquals(HttpStatusCode.Forbidden, sharee.client.post("/api/v1/feedbacks/$id/$action").status, action)
        }
        assertEquals(HttpStatusCode.Forbidden, sharee.client.delete("/api/v1/feedbacks/$id").status)
        // Nothing changed: the provider still reads the original.
        assertEquals("Confidential feedback text", provider.client.feedback(id).body<FeedbackResponse>().content)
    }

    @Test
    fun `a share-granted reader cannot share again - 403, and the only own-right readers can`() = testApplication {
        usePostgresTestcontainer()
        val provider = person("provider")
        val subject = person("subject")
        val sharee = person("sharee")
        val third = person("third")
        val id = provider.writeFeedback(subject)
        provider.client.shareId(id, sharee.id)

        val reshare = sharee.client.share(id, third.id)
        assertEquals(HttpStatusCode.Forbidden, reshare.status)
        assertEquals("Only someone who can read this document in their own right may share it", reshare.detail())
        assertEquals(HttpStatusCode.Forbidden, third.client.feedback(id).status)
        // The subject, a party in their own right, can.
        assertEquals(HttpStatusCode.Created, subject.client.share(id, third.id).status)
    }

    @Test
    fun `HR with auditor-only access cannot share, an HR recipient of a share can be shared with`() = testApplication {
        usePostgresTestcontainer()
        val provider = person("provider")
        val subject = person("subject")
        val auditor = person("auditor", roles = setOf(UserRole.HR))
        val id = provider.writeFeedback(subject)

        // The HR role reads everything as an auditor — but that is not an own-right read.
        val audit = auditor.client.feedback(id)
        assertEquals(HttpStatusCode.OK, audit.status)
        assertFalse(audit.body<FeedbackResponse>().canShare)
        assertEquals(HttpStatusCode.Forbidden, auditor.client.share(id, person("friend").id).status)

        // A participant can share it WITH an HR user.
        assertEquals(HttpStatusCode.Created, provider.client.share(id, auditor.id).status)
        // …and an HR user who is a party in their own right can share.
        val hrProvider = person("hr-provider", roles = setOf(UserRole.HR))
        val ownId = hrProvider.writeFeedback(subject)
        assertTrue(hrProvider.client.feedback(ownId).body<FeedbackResponse>().canShare)
        assertEquals(HttpStatusCode.Created, hrProvider.client.share(ownId, person("recipient").id).status)
    }

    @Test
    fun `a sharee sees only what the sharer sees - the requester of an unfinished feedback shares no content`() =
        runBlockingApp {
            val provider = person("provider")
            val subject = person("subject")
            val requester = person("requester")
            val sharee = person("sharee")
            val draft = TestServices.feedbacks.create(
                Feedback(
                    requesterId = requester.id,
                    subjectId = subject.id,
                    providerId = provider.id,
                    visibility = FeedbackVisibility.PROVIDER_REQUESTER,
                    status = FeedbackStatus.DRAFT,
                    content = "The provider's private work in progress",
                ),
            ).id

            // The requester may see that it exists, not its content; the provider sees it all.
            assertEquals("", requester.client.feedback(draft).body<FeedbackResponse>().content)
            assertEquals(
                "The provider's private work in progress",
                provider.client.feedback(draft).body<FeedbackResponse>().content,
            )

            requester.client.shareId(draft, sharee.id)
            val viaShare = sharee.client.feedback(draft)
            assertEquals(HttpStatusCode.OK, viaShare.status, "the sharee sees that it exists")
            val body = viaShare.body<FeedbackResponse>()
            assertEquals("", body.content, "…but never more than the requester sees")
            assertEquals(requester.name, body.sharedBy)
        }

    @Test
    fun `a share lapses when the sharer leaves the management chain, with the distinct detail`() = runBlockingApp {
        val provider = person("provider")
        val subject = person("subject")
        val manager = person("manager")
        val sharee = person("sharee")
        val teamId = TestServices.teams.create(Team("Squad-${manager.id}", manager.id, listOf(subject.id)))
        val id = provider.writeFeedback(subject)

        // The manager reads a DELIVERED feedback about a report via the chain — in their own right.
        assertTrue(manager.client.feedback(id).body<FeedbackResponse>().canShare)
        manager.client.shareId(id, sharee.id)
        assertEquals(HttpStatusCode.OK, sharee.client.feedback(id).status)

        TestServices.teams.removeMember(teamId, subject.id)
        val lapsed = sharee.client.feedback(id)
        assertEquals(HttpStatusCode.Forbidden, lapsed.status)
        assertEquals("The person who shared this no longer has access to it", lapsed.detail())
        assertEquals(HttpStatusCode.Forbidden, sharee.client.get("/api/v1/feedbacks/$id/events").status)

        // The share is not gone — it works again as soon as the sharer could read it again.
        TestServices.teams.addMember(teamId, subject.id)
        assertEquals(HttpStatusCode.OK, sharee.client.feedback(id).status)
    }

    @Test
    fun `the end date is inclusive - readable through its day, a lapsed row grants nothing`() = runBlockingApp {
        val provider = person("provider")
        val subject = person("subject")
        val onTheDay = person("sharee-today")
        val dayAfter = person("sharee-expired")
        val id = provider.writeFeedback(subject)
        val shares = application.attributes[ShareServiceKey]
        val today = shares.today()

        // Through the API: a share ending tomorrow is accepted and readable now; one ending today is
        // accepted too (the end date is inclusive — pinned at the clock level in ShareServiceTest).
        provider.client.shareId(id, onTheDay.id, expiresOn = today.plusDays(1).toString())
        assertEquals(HttpStatusCode.OK, onTheDay.client.feedback(id).status)
        val lastDay = person("sharee-last-day")
        provider.client.shareId(id, lastDay.id, expiresOn = today.toString())
        assertEquals(HttpStatusCode.OK, lastDay.client.feedback(id).status)

        // An already-expired row (unreachable through the API) grants nothing — and the denial is
        // the plain one, not the lapse detail: no ACTIVE share exists any more.
        val expired = shares.create(
            ShareableResourceType.FEEDBACK, id, provider.id, dayAfter.id, today.minusDays(1).toString(),
        )
        assertTrue(expired is ShareCreateOutcome.Created)
        val denied = dayAfter.client.feedback(id)
        assertEquals(HttpStatusCode.Forbidden, denied.status)
        assertEquals("Caller may not read this feedback", denied.detail())
    }

    @Test
    fun `withdrawal by the sharer, the author and a stranger, the repeat, and who is notified with which link`() =
        runBlockingApp {
            val provider = person("provider")
            val subject = person("subject")
            val manager = person("manager")
            val sharee = person("sharee")
            val stranger = person("stranger")
            TestServices.teams.create(Team("Squad-${manager.id}", manager.id, listOf(subject.id)))
            val id = provider.writeFeedback(subject)

            // The share is minted with the view link and the end date.
            val first = manager.client.shareId(id, sharee.id, expiresOn = "2099-12-31")
            val shared = sharee.client.notifications().single { it.type == NotificationType.FEEDBACK_SHARED }
            assertEquals(mapOf("sharer" to manager.name, "expiresOn" to "2099-12-31"), shared.params)
            assertEquals("/feedback/$id/view", shared.link)

            // A stranger cannot withdraw it; the PROVIDER (the feedback's author) can.
            assertEquals(HttpStatusCode.Forbidden, stranger.client.post("/api/v1/shares/$first/withdraw").status)
            assertEquals(HttpStatusCode.NoContent, provider.client.post("/api/v1/shares/$first/withdraw").status)
            assertEquals(HttpStatusCode.Forbidden, sharee.client.feedback(id).status)
            assertEquals(HttpStatusCode.Conflict, provider.client.post("/api/v1/shares/$first/withdraw").status)

            // Both the sharee and the sharer are told when the author withdraws.
            val toSharee = sharee.client.notifications().single { it.type == NotificationType.FEEDBACK_SHARE_WITHDRAWN }
            assertEquals(
                mapOf("sharer" to manager.name, "sharee" to sharee.name, "actor" to provider.name),
                toSharee.params,
            )
            assertNull(toSharee.link)
            val toSharer = manager.client.notifications().single { it.type == NotificationType.FEEDBACK_SHARE_WITHDRAWN }
            assertEquals("sharer", toSharer.params["self"])
            assertEquals("/shares?tab=byMe", toSharer.link)

            // The sharer withdraws their own share: the sharee alone is told, with the sharer as actor.
            val second = manager.client.shareId(id, sharee.id)
            assertEquals(HttpStatusCode.OK, sharee.client.feedback(id).status)
            assertEquals(HttpStatusCode.NoContent, manager.client.post("/api/v1/shares/$second/withdraw").status)
            assertEquals(HttpStatusCode.Conflict, manager.client.post("/api/v1/shares/$second/withdraw").status)
            assertEquals(HttpStatusCode.Forbidden, sharee.client.feedback(id).status)
            val withdrawals = sharee.client.notifications().filter { it.type == NotificationType.FEEDBACK_SHARE_WITHDRAWN }
            assertEquals(2, withdrawals.size)
            assertEquals(1, manager.client.notifications().count { it.type == NotificationType.FEEDBACK_SHARE_WITHDRAWN })
        }

    @Test
    fun `a sharee with the feedback feature disabled gets the caller-gate 403, and the row is hidden from withMe`() =
        runBlockingApp {
            val provider = person("provider")
            val subject = person("subject")
            val sharee = person("sharee-off", disabled = setOf(Feature.FEEDBACKS))
            val id = provider.writeFeedback(subject)
            provider.client.shareId(id, sharee.id)

            val gated = sharee.client.feedback(id)
            assertEquals(HttpStatusCode.Forbidden, gated.status)
            assertEquals("The FEEDBACKS feature is disabled for this account", gated.detail())
            assertEquals(0L, sharee.client.get("/api/v1/shares").body<SharePageResponse>().total)
            assertTrue(sharee.client.notifications().none { it.type == NotificationType.FEEDBACK_SHARED })
        }

    @Test
    fun `canShare on the create response follows the creator's own-right read`() = runBlockingApp {
        val provider = person("provider")
        val subject = person("subject")
        val requester = person("requester")

        suspend fun requestAs(visibility: FeedbackVisibility, about: Person = subject) = requester.client.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                FeedbackCreateRequest(
                    requesterId = requester.id,
                    subjectId = about.id,
                    providerId = provider.id,
                    visibility = visibility,
                    status = FeedbackStatus.REQUESTED,
                ),
            )
        }
        // A requester reads their own request when the visibility includes them …
        assertTrue(requestAs(FeedbackVisibility.PROVIDER_REQUESTER).body<FeedbackResponse>().canShare)
        // … but not a PUBLIC one: that is readable by everyone only once it is SENT, so a REQUESTED
        // PUBLIC request is not readable by its requester in their own right (no share button).
        // (another subject: one open request per (subject, provider, requester) triple.)
        val publicRequest = requestAs(FeedbackVisibility.PUBLIC, about = person("public-subject"))
        assertEquals(HttpStatusCode.Created, publicRequest.status)
        assertFalse(publicRequest.body<FeedbackResponse>().canShare)
        // A provider creating a feedback reads it in their own right.
        val created = provider.client.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                FeedbackCreateRequest(
                    subjectId = person("another-subject").id,
                    providerId = provider.id,
                    visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                    status = FeedbackStatus.DRAFT,
                ),
            )
        }
        assertTrue(created.body<FeedbackResponse>().canShare)
    }

    @Test
    fun `a share upgrades a weaker own read - the requester of an unfinished feedback gets the content from the provider`() =
        runBlockingApp {
            val provider = person("provider")
            val subject = person("subject")
            val requester = person("requester")
            val draft = TestServices.feedbacks.create(
                Feedback(
                    requesterId = requester.id,
                    subjectId = subject.id,
                    providerId = provider.id,
                    visibility = FeedbackVisibility.PROVIDER_REQUESTER,
                    status = FeedbackStatus.DRAFT,
                    content = "The provider's draft, shared on purpose",
                ),
            ).id
            assertEquals("", requester.client.feedback(draft).body<FeedbackResponse>().content)

            // The provider shares their draft with the requester — "whoever I want".
            provider.client.shareId(draft, requester.id)
            val upgraded = requester.client.feedback(draft).body<FeedbackResponse>()
            assertEquals("The provider's draft, shared on purpose", upgraded.content)
            assertEquals(provider.name, upgraded.sharedBy)
            assertTrue(upgraded.canShare, "canShare stays tied to the requester's own right, share or not")
        }

    @Test
    fun `visibility widening is intended - a reader shares with the subject-excluded, the provider sees it`() = runBlockingApp {
        val provider = person("provider")
        val subject = person("subject")
        val requester = person("requester")
        val outsider = person("outsider")
        // Requester-visible only (the subject is NOT meant to see this one).
        val id = TestServices.feedbacks.create(
            Feedback(
                requesterId = requester.id,
                subjectId = subject.id,
                providerId = provider.id,
                visibility = FeedbackVisibility.PROVIDER_REQUESTER,
                status = FeedbackStatus.SENT,
                content = "Meant for the requester",
            ),
        ).id
        assertEquals(HttpStatusCode.Forbidden, subject.client.feedback(id).status)

        // The requester reads it in their own right and may share it even with the subject.
        val shareId = requester.client.shareId(id, subject.id)
        assertEquals(HttpStatusCode.OK, subject.client.feedback(id).status)
        requester.client.shareId(id, outsider.id)
        // The provider (the author) sees and can withdraw both.
        val all = provider.client.get("/api/v1/shares") {
            parameter("view", "document")
            parameter("resourceType", "FEEDBACK")
            parameter("resourceId", id.toString())
        }.body<SharePageResponse>()
        assertEquals(2L, all.total)
        assertEquals(HttpStatusCode.NoContent, provider.client.post("/api/v1/shares/$shareId/withdraw").status)
        assertEquals(HttpStatusCode.Forbidden, subject.client.feedback(id).status)
    }

    @Test
    fun `multi-recipient - an additional recipient and the manager of only the second recipient can share, labels list both`() =
        runBlockingApp {
            val provider = person("provider")
            val first = person("first")
            val second = person("second")
            val manager = person("manager-of-second")
            val viaSecond = person("sharee-a")
            val viaManager = person("sharee-b")
            TestServices.teams.create(Team("Squad-${manager.id}", manager.id, listOf(second.id)))
            val created = provider.client.post("/api/v1/feedbacks") {
                contentType(ContentType.Application.Json)
                setBody(
                    FeedbackCreateRequest(
                        subjectId = first.id,
                        additionalSubjectIds = listOf(second.id),
                        providerId = provider.id,
                        visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                        status = FeedbackStatus.SENT,
                        content = "For two people",
                    ),
                )
            }
            assertEquals(HttpStatusCode.Created, created.status)
            val id = created.body<FeedbackResponse>().id

            // The ADDITIONAL recipient reads and shares in their own right …
            assertTrue(second.client.feedback(id).body<FeedbackResponse>().canShare)
            val fromSecond = second.client.share(id, viaSecond.id)
            assertEquals(HttpStatusCode.Created, fromSecond.status)
            // … and the snapshot lists BOTH recipients, in position order.
            assertEquals(
                mapOf("provider" to provider.name, "subjects" to "${first.name}, ${second.name}"),
                fromSecond.body<ShareResponse>().details,
            )
            // The chain manager of the second recipient ONLY reads the delivered feedback and shares it.
            assertTrue(manager.client.feedback(id).body<FeedbackResponse>().canShare)
            manager.client.shareId(id, viaManager.id)
            assertEquals("For two people", viaManager.client.feedback(id).body<FeedbackResponse>().content)
        }

    @Test
    fun `the sharer's role-stripped evaluation emits no hr_read audit, and a lapsed HR sharer cannot carry the share`() =
        runBlockingApp {
            val provider = person("provider")
            val subject = person("subject")
            val hrManager = person("hr-manager", roles = setOf(UserRole.HR))
            val sharee = person("sharee")
            val hrSharee = person("hr-sharee", roles = setOf(UserRole.HR))
            val teamId = TestServices.teams.create(Team("Squad-${hrManager.id}", hrManager.id, listOf(subject.id)))
            val id = provider.writeFeedback(subject)
            val audit = LogCapture("ch.nokillswit.audit")
            try {
                // The HR user is a chain manager (own right): their own read is not an auditor read.
                hrManager.client.shareId(id, sharee.id)
                assertEquals(HttpStatusCode.OK, sharee.client.feedback(id).status)
                // Out of the chain they hold ONLY the HR role — which must not carry the share
                // (role stripped), and which therefore never reaches grantHrRead for the sharee's read.
                TestServices.teams.removeMember(teamId, subject.id)
                val lapsed = sharee.client.feedback(id)
                assertEquals(HttpStatusCode.Forbidden, lapsed.status)
                assertEquals("The person who shared this no longer has access to it", lapsed.detail())
                assertTrue(
                    audit.events.none { it.message == "hr.read" && it.keyValuePairs.any { kv -> kv.value == hrManager.id.toLong() } },
                    "the sharer's stripped evaluation must not emit hr.read",
                )

                // An HR SHAREE reading through the role is the ordinary audited auditor read (own path wins).
                provider.client.shareId(id, hrSharee.id)
                assertEquals(HttpStatusCode.OK, hrSharee.client.feedback(id).status)
                assertNotNull(
                    audit.events.find { it.message == "hr.read" && it.keyValuePairs.any { kv -> kv.value == hrSharee.id.toLong() } },
                    "an HR caller's own-path read is audited as always",
                )
            } finally {
                audit.detach()
            }
        }

    @Test
    fun `a failing chain walk is an outage, never swallowed into a denial`(): Unit = runBlocking {
        // A feedback service pointed at an unreachable database: the manager-chain lookup of a
        // DELIVERED feedback throws (not a ForbiddenException), and readOrShared must let it out.
        val broken = FeedbackService(
            R2dbcDatabase.connect(url = "r2dbc:postgresql://localhost:1/nonexistent", user = "nobody", password = "nobody"),
            TestServices.cipher,
            sweepIntervalMillis = 0,
        )
        val adapter = FeedbackShareable(broken)
        val provider = TestUsers.seed(uniqueEmail("p"), password, roles = emptySet())
        val subject = TestUsers.seed(uniqueEmail("s"), password, roles = emptySet())
        val sharee = TestUsers.seed(uniqueEmail("sh"), password, roles = emptySet())
        val doc = FeedbackDoc(
            TestShareDocuments.nextId(),
            Feedback(
                subjectId = subject,
                providerId = provider,
                visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                status = FeedbackStatus.SENT,
            ),
        )
        // An ACTIVE share from the PROVIDER exists. The provider passes the guard without touching the
        // database (a party), so a regression that swallowed any Exception would fall through to the
        // share and return a Shared read — which assertNotNull(failure) below catches.
        val shares = ShareService(TestServices.database)
        val documentId = TestShareDocuments.nextId()
        shares.create(ShareableResourceType.FEEDBACK, documentId, provider, sharee, null)
        val access = ShareAccess(shares, TestServices.users)
        val failure = runCatching {
            access.readOrShared(CallerPrincipal(sharee, "x@test", emptySet()), ShareableResourceType.FEEDBACK, documentId) {
                adapter.guard(it, doc)
            }
        }.exceptionOrNull()
        assertNotNull(failure)
        assertFalse(failure is ForbiddenException, "an infrastructure failure must stay a 500, not become a 403")
    }

    // ── Goals ────────────────────────────────────────────────────────────────────────────────

    private class GoalWorld(
        val manager: Person,
        val subordinate: Person,
        val grand: Person,
        val goalId: UInt,
    )

    private suspend fun HttpClient.shareGoal(goalId: UInt, shareeId: UInt, expiresOn: String? = null): HttpResponse =
        post("/api/v1/shares") {
            contentType(ContentType.Application.Json)
            setBody(ShareRequest(ShareableResourceType.GOAL, goalId, shareeId, expiresOn))
        }

    private suspend fun HttpClient.shareGoalId(goalId: UInt, shareeId: UInt): UInt {
        val response = shareGoal(goalId, shareeId)
        assertEquals(HttpStatusCode.Created, response.status)
        return response.body<ShareResponse>().id
    }

    /**
     * M manages S, G manages M (so G is in S's transitive chain). M creates a goal for S —
     * activated when [activate], otherwise a DRAFT private to the pair.
     */
    private suspend fun ApplicationTestBuilder.goalWorld(
        activate: Boolean = true,
        managerRoles: Set<UserRole> = emptySet(),
        grandRoles: Set<UserRole> = emptySet(),
    ): GoalWorld {
        val manager = person("manager", roles = managerRoles)
        val subordinate = person("subordinate")
        val grand = person("grand-manager", roles = grandRoles)
        TestServices.teams.create(Team("Squad-${manager.id}", manager.id, listOf(subordinate.id)))
        TestServices.teams.create(Team("Leads-${grand.id}", grand.id, listOf(manager.id)))
        val created = manager.client.post("/api/v1/goals") {
            contentType(ContentType.Application.Json)
            setBody(
                GoalCreateRequest(
                    subordinateId = subordinate.id,
                    title = "Original goal title",
                    description = "A private description",
                    type = GoalType.NUMBER,
                    targetValue = 10.0,
                    dueDate = serverToday().plusDays(30).toString(),
                ),
            )
        }
        assertEquals(HttpStatusCode.Created, created.status)
        val createdGoal = created.body<GoalResponse>()
        assertTrue(createdGoal.canShare, "the creating manager reads their own goal")
        val goalId = createdGoal.id
        if (activate) assertEquals(HttpStatusCode.NoContent, manager.client.post("/api/v1/goals/$goalId/activate").status)
        return GoalWorld(manager, subordinate, grand, goalId)
    }

    private suspend fun HttpClient.goal(id: UInt) = get("/api/v1/goals/$id")

    @Test
    fun `goals - a sharee reads the goal and its events, sharedBy set, canShare false, the parties can share`() =
        runBlockingApp {
            val w = goalWorld()
            val sharee = person("sharee")
            assertEquals(HttpStatusCode.Forbidden, sharee.client.goal(w.goalId).status)

            w.manager.client.shareGoalId(w.goalId, sharee.id)
            val body = sharee.client.goal(w.goalId).body<GoalResponse>()
            assertEquals("Original goal title", body.title)
            assertEquals("A private description", body.description)
            assertEquals(w.manager.name, body.sharedBy)
            assertFalse(body.canShare)
            val events = sharee.client.get("/api/v1/goals/${w.goalId}/events")
            assertEquals(HttpStatusCode.OK, events.status)
            assertTrue(events.body<GoalEventListResponse>().items.isNotEmpty())

            for (own in listOf(w.manager, w.subordinate, w.grand)) {
                val read = own.client.goal(w.goalId).body<GoalResponse>()
                assertTrue(read.canShare, "${own.name} reads in their own right")
                assertNull(read.sharedBy)
            }
            val row = sharee.client.get("/api/v1/shares").body<SharePageResponse>().items.single()
            assertEquals(mapOf("title" to "Original goal title", "subordinate" to w.subordinate.name), row.details)
            assertEquals("/goals/${w.goalId}/view", row.link)
        }

    @Test
    fun `goals - a sharee can write nothing, the subordinate's progress update included`() = runBlockingApp {
        val w = goalWorld()
        val viaManager = person("sharee-m")
        val viaSubordinate = person("sharee-s")
        w.manager.client.shareGoalId(w.goalId, viaManager.id)
        w.subordinate.client.shareGoalId(w.goalId, viaSubordinate.id)

        for (sharee in listOf(viaManager, viaSubordinate)) {
            val c = sharee.client
            val definition = c.put("/api/v1/goals/${w.goalId}") {
                contentType(ContentType.Application.Json)
                setBody(
                    GoalDefinitionUpdate(
                        title = "tampered",
                        type = GoalType.NUMBER,
                        targetValue = 1.0,
                        dueDate = serverToday().plusDays(5).toString(),
                    ),
                )
            }
            assertEquals(HttpStatusCode.Forbidden, definition.status)
            // PUT …/progress is open to the manager AND the subordinate — a sharee is neither.
            val progress = c.put("/api/v1/goals/${w.goalId}/progress") {
                contentType(ContentType.Application.Json)
                setBody(GoalProgressUpdate(currentValue = 5.0, comment = "sneaky"))
            }
            assertEquals(HttpStatusCode.Forbidden, progress.status)
            for (action in listOf("activate", "deactivate", "reopen")) {
                assertEquals(HttpStatusCode.Forbidden, c.post("/api/v1/goals/${w.goalId}/$action").status, action)
            }
            val archive = c.post("/api/v1/goals/${w.goalId}/archive") {
                contentType(ContentType.Application.Json)
                setBody(GoalArchiveRequest("nope"))
            }
            assertEquals(HttpStatusCode.Forbidden, archive.status)
            assertEquals(HttpStatusCode.Forbidden, c.delete("/api/v1/goals/${w.goalId}").status)
        }
        // Nothing changed.
        val after = w.manager.client.goal(w.goalId).body<GoalResponse>()
        assertEquals("Original goal title", after.title)
        assertNull(after.currentValue)
        assertEquals(ch.nokillswit.goals.GoalStatus.ACTIVE, after.status)
    }

    @Test
    fun `goals - no re-sharing, no HR-auditor sharing, HR can receive and share as a party`() = runBlockingApp {
        val w = goalWorld()
        val sharee = person("sharee")
        val third = person("third")
        val auditor = person("auditor", roles = setOf(UserRole.HR))
        w.manager.client.shareGoalId(w.goalId, sharee.id)

        val reshare = sharee.client.shareGoal(w.goalId, third.id)
        assertEquals(HttpStatusCode.Forbidden, reshare.status)
        assertEquals("Only someone who can read this document in their own right may share it", reshare.detail())

        // The HR role reads the goal as an auditor, which is not an own-right read.
        val audit = auditor.client.goal(w.goalId)
        assertEquals(HttpStatusCode.OK, audit.status)
        assertFalse(audit.body<GoalResponse>().canShare)
        assertEquals(HttpStatusCode.Forbidden, auditor.client.shareGoal(w.goalId, third.id).status)
        // …but anyone can share WITH an HR user.
        assertEquals(HttpStatusCode.Created, w.manager.client.shareGoal(w.goalId, auditor.id).status)
    }

    @Test
    fun `goals - an HR user who is a party or a chain manager shares in their own right`() =
        runBlockingApp {
            val w = goalWorld(managerRoles = setOf(UserRole.HR), grandRoles = setOf(UserRole.HR))
            val viaManager = person("sharee-a")
            val viaGrand = person("sharee-b")
            val audit = LogCapture("ch.nokillswit.audit")
            try {
                for ((hr, sharee) in listOf(w.manager to viaManager, w.grand to viaGrand)) {
                    // A party / chain manager reads through the ordinary rules (an own-right read,
                    // never the auditor grant) — so canShare holds and no auditor read is logged.
                    assertTrue(hr.client.goal(w.goalId).body<GoalResponse>().canShare, "${hr.name} reads in their own right")
                    assertEquals(HttpStatusCode.Created, hr.client.shareGoal(w.goalId, sharee.id).status)
                    assertEquals(HttpStatusCode.OK, sharee.client.goal(w.goalId).status)
                }
                // The PARTY's read is an ordinary one: no auditor read is logged for them. (An HR chain
                // manager is logged by grantHrRead before the chain walk — the documented ordering
                // exception in Guards.kt — which is why only the party is asserted.)
                assertTrue(
                    audit.events.none {
                        it.message == "hr.read" && it.keyValuePairs.any { kv -> kv.value == w.manager.id.toLong() }
                    },
                    "an own-right read by an HR party must not be logged as an auditor read",
                )
            } finally {
                audit.detach()
            }
        }

    @Test
    fun `goals - draft privacy - a chain manager cannot share a draft, and a share they made lapses when it returns to draft`() =
        runBlockingApp {
            val drafted = goalWorld(activate = false)
            val x = person("sharee-x")
            // A DRAFT stays private to the pair: the chain manager neither reads nor shares it.
            assertEquals(HttpStatusCode.Forbidden, drafted.grand.client.goal(drafted.goalId).status)
            assertEquals(HttpStatusCode.Forbidden, drafted.grand.client.shareGoal(drafted.goalId, x.id).status)

            val w = goalWorld()
            val viaChain = person("sharee-chain")
            val viaManager = person("sharee-manager")
            val viaSubordinate = person("sharee-subordinate")
            assertTrue(w.grand.client.goal(w.goalId).body<GoalResponse>().canShare)
            w.grand.client.shareGoalId(w.goalId, viaChain.id)
            w.manager.client.shareGoalId(w.goalId, viaManager.id)
            w.subordinate.client.shareGoalId(w.goalId, viaSubordinate.id)
            assertEquals(HttpStatusCode.OK, viaChain.client.goal(w.goalId).status)

            // Back to DRAFT: the chain manager's share lapses (with the distinct detail); the pair's keep working.
            assertEquals(HttpStatusCode.NoContent, w.manager.client.post("/api/v1/goals/${w.goalId}/deactivate").status)
            val lapsed = viaChain.client.goal(w.goalId)
            assertEquals(HttpStatusCode.Forbidden, lapsed.status)
            assertEquals("The person who shared this no longer has access to it", lapsed.detail())
            assertEquals(HttpStatusCode.OK, viaManager.client.goal(w.goalId).status)
            assertEquals(HttpStatusCode.OK, viaSubordinate.client.goal(w.goalId).status)
            assertEquals(HttpStatusCode.Forbidden, viaChain.client.get("/api/v1/goals/${w.goalId}/events").status)

            // Re-activated: the chain manager's share works again, as nothing was withdrawn.
            assertEquals(HttpStatusCode.NoContent, w.manager.client.post("/api/v1/goals/${w.goalId}/activate").status)
            assertEquals(HttpStatusCode.OK, viaChain.client.goal(w.goalId).status)
        }

    @Test
    fun `goals - the manager is the author - sees and withdraws a subordinate's share, notifications and links`() =
        runBlockingApp {
            val w = goalWorld()
            val sharee = person("sharee")
            val id = w.subordinate.client.shareGoalId(w.goalId, sharee.id)

            val shared = sharee.client.notifications().single { it.type == NotificationType.GOAL_SHARED }
            assertEquals(mapOf("sharer" to w.subordinate.name), shared.params)
            assertEquals("/goals/${w.goalId}/view", shared.link)

            // The author lists every share of the goal, the subordinate only their own.
            val all = w.manager.client.get("/api/v1/shares") {
                parameter("view", "document")
                parameter("resourceType", "GOAL")
                parameter("resourceId", w.goalId.toString())
            }.body<SharePageResponse>()
            assertEquals(listOf(id), all.items.map { it.id })
            assertEquals(HttpStatusCode.NoContent, w.manager.client.post("/api/v1/shares/$id/withdraw").status)
            assertEquals(HttpStatusCode.Forbidden, sharee.client.goal(w.goalId).status)

            val toSharee = sharee.client.notifications().single { it.type == NotificationType.GOAL_SHARE_WITHDRAWN }
            assertEquals(
                mapOf("sharer" to w.subordinate.name, "sharee" to sharee.name, "actor" to w.manager.name),
                toSharee.params,
            )
            assertNull(toSharee.link)
            val toSharer = w.subordinate.client.notifications().single { it.type == NotificationType.GOAL_SHARE_WITHDRAWN }
            assertEquals("sharer", toSharer.params["self"])
            assertEquals("/shares?tab=byMe", toSharer.link)
        }

    @Test
    fun `goals - the label snapshot survives a later retitle`() = runBlockingApp {
        val w = goalWorld()
        val sharee = person("sharee")
        w.manager.client.shareGoalId(w.goalId, sharee.id)
        // Retitle: back to DRAFT (definition edits are DRAFT-only), then edit.
        assertEquals(HttpStatusCode.NoContent, w.manager.client.post("/api/v1/goals/${w.goalId}/deactivate").status)
        val edit = w.manager.client.put("/api/v1/goals/${w.goalId}") {
            contentType(ContentType.Application.Json)
            setBody(
                GoalDefinitionUpdate(
                    title = "Retitled afterwards",
                    type = GoalType.NUMBER,
                    targetValue = 10.0,
                    dueDate = serverToday().plusDays(30).toString(),
                ),
            )
        }
        assertEquals(HttpStatusCode.NoContent, edit.status)
        assertEquals("Retitled afterwards", w.manager.client.goal(w.goalId).body<GoalResponse>().title)
        val row = sharee.client.get("/api/v1/shares").body<SharePageResponse>().items.single()
        assertEquals("Original goal title", row.details?.get("title"))
    }

    // ── 1:1 meetings ─────────────────────────────────────────────────────────────────────────

    private class MeetingWorld(
        val manager: Person,
        val subordinate: Person,
        val grand: Person,
        val leadsTeamId: UInt,
        val meeting: OneOnOneResponse,
    )

    private suspend fun HttpClient.shareMeeting(meetingId: UInt, shareeId: UInt): HttpResponse =
        post("/api/v1/shares") {
            contentType(ContentType.Application.Json)
            setBody(ShareRequest(ShareableResourceType.ONE_ON_ONE, meetingId, shareeId, null))
        }

    private suspend fun HttpClient.shareMeetingId(meetingId: UInt, shareeId: UInt): UInt {
        val response = shareMeeting(meetingId, shareeId)
        assertEquals(HttpStatusCode.Created, response.status)
        return response.body<ShareResponse>().id
    }

    private suspend fun HttpClient.meeting(id: UInt) = get("/api/v1/one-on-ones/$id")

    /** M manages S, G manages M; M documents a 1:1 with S carrying one action item. */
    private suspend fun ApplicationTestBuilder.meetingWorld(managerRoles: Set<UserRole> = emptySet()): MeetingWorld {
        val manager = person("manager", roles = managerRoles)
        val subordinate = person("subordinate")
        val grand = person("grand-manager")
        TestServices.teams.create(Team("Squad-${manager.id}", manager.id, listOf(subordinate.id)))
        val leads = TestServices.teams.create(Team("Leads-${grand.id}", grand.id, listOf(manager.id)))
        val created = manager.client.post("/api/v1/one-on-ones") {
            contentType(ContentType.Application.Json)
            setBody(
                OneOnOneCreateRequest(
                    subordinateId = subordinate.id,
                    meetingDate = "2026-07-01",
                    points = listOf(OneOnOneItemInput(content = "roadmap")),
                    decisions = listOf(OneOnOneItemInput(content = "ship in August")),
                    actionItems = listOf(
                        OneOnOneActionItemInput(content = "prepare demo", owner = ActionItemOwner.SUBORDINATE),
                    ),
                ),
            )
        }
        assertEquals(HttpStatusCode.Created, created.status)
        val meeting = created.body<OneOnOneResponse>()
        assertTrue(meeting.canShare, "the documenting manager reads their own meeting")
        return MeetingWorld(manager, subordinate, grand, leads, meeting)
    }

    @Test
    fun `one-on-ones - a sharee reads the meeting and its events but not the action-item history`() = runBlockingApp {
        val w = meetingWorld()
        val sharee = person("sharee")
        val itemId = w.meeting.actionItems.single().id
        assertEquals(HttpStatusCode.Forbidden, sharee.client.meeting(w.meeting.id).status)

        w.manager.client.shareMeetingId(w.meeting.id, sharee.id)
        val body = sharee.client.meeting(w.meeting.id).body<OneOnOneResponse>()
        assertEquals("roadmap", body.points.single().content)
        assertEquals(w.manager.name, body.sharedBy)
        assertFalse(body.canShare)
        val events = sharee.client.get("/api/v1/one-on-ones/${w.meeting.id}/events")
        assertEquals(HttpStatusCode.OK, events.status)
        assertTrue(events.body<OneOnOneEventListResponse>().items.isNotEmpty())

        // The action-item history spans carry-over copies in meetings that were never shared: it
        // stays OWN-RIGHT ONLY, so the sharee gets the ordinary 403 while the sharer reads it.
        val denied = sharee.client.get("/api/v1/one-on-ones/action-items/$itemId/history")
        assertEquals(HttpStatusCode.Forbidden, denied.status)
        assertEquals("Caller may not read this 1:1 meeting", denied.detail())
        assertEquals(HttpStatusCode.OK, w.manager.client.get("/api/v1/one-on-ones/action-items/$itemId/history").status)
        assertTrue(
            w.subordinate.client.get("/api/v1/one-on-ones/action-items/$itemId/history")
                .body<ActionItemHistoryResponse>().items.isNotEmpty(),
        )

        for (own in listOf(w.manager, w.subordinate, w.grand)) {
            val read = own.client.meeting(w.meeting.id).body<OneOnOneResponse>()
            assertTrue(read.canShare, "${own.name} reads in their own right")
            assertNull(read.sharedBy)
        }
        val row = sharee.client.get("/api/v1/shares").body<SharePageResponse>().items.single()
        assertEquals(
            mapOf("manager" to w.manager.name, "subordinate" to w.subordinate.name, "meetingDate" to "2026-07-01"),
            row.details,
        )
        assertEquals("/one-on-ones/${w.meeting.id}/view", row.link)
    }

    @Test
    fun `one-on-ones - a sharee can write nothing`() = runBlockingApp {
        val w = meetingWorld()
        val viaManager = person("sharee-m")
        val viaSubordinate = person("sharee-s")
        w.manager.client.shareMeetingId(w.meeting.id, viaManager.id)
        w.subordinate.client.shareMeetingId(w.meeting.id, viaSubordinate.id)
        for (sharee in listOf(viaManager, viaSubordinate)) {
            val put = sharee.client.put("/api/v1/one-on-ones/${w.meeting.id}") {
                contentType(ContentType.Application.Json)
                setBody(
                    OneOnOneUpdateRequest(
                        meetingDate = "2026-07-02",
                        points = listOf(OneOnOneItemInput(content = "tampered")),
                        decisions = emptyList(),
                        actionItems = emptyList(),
                    ),
                )
            }
            assertEquals(HttpStatusCode.Forbidden, put.status)
            assertEquals(HttpStatusCode.Forbidden, sharee.client.delete("/api/v1/one-on-ones/${w.meeting.id}").status)
        }
        val after = w.manager.client.meeting(w.meeting.id).body<OneOnOneResponse>()
        assertEquals("roadmap", after.points.single().content)
        assertEquals("2026-07-01", after.meetingDate)
    }

    @Test
    fun `one-on-ones - no re-sharing, no HR-auditor sharing, an HR party can share`() = runBlockingApp {
        val w = meetingWorld(managerRoles = setOf(UserRole.HR))
        val sharee = person("sharee")
        val third = person("third")
        val auditor = person("auditor", roles = setOf(UserRole.HR))
        // The HR user documenting the meeting is a party: an own-right read, so they can share.
        assertTrue(w.manager.client.meeting(w.meeting.id).body<OneOnOneResponse>().canShare)
        w.manager.client.shareMeetingId(w.meeting.id, sharee.id)

        val reshare = sharee.client.shareMeeting(w.meeting.id, third.id)
        assertEquals(HttpStatusCode.Forbidden, reshare.status)
        assertEquals("Only someone who can read this document in their own right may share it", reshare.detail())

        val audit = auditor.client.meeting(w.meeting.id)
        assertEquals(HttpStatusCode.OK, audit.status)
        assertFalse(audit.body<OneOnOneResponse>().canShare)
        assertEquals(HttpStatusCode.Forbidden, auditor.client.shareMeeting(w.meeting.id, third.id).status)
        assertEquals(HttpStatusCode.Created, w.manager.client.shareMeeting(w.meeting.id, auditor.id).status)
    }

    @Test
    fun `one-on-ones - a chain manager's share lapses when they leave the chain`() = runBlockingApp {
        val w = meetingWorld()
        val sharee = person("sharee")
        assertTrue(w.grand.client.meeting(w.meeting.id).body<OneOnOneResponse>().canShare)
        w.grand.client.shareMeetingId(w.meeting.id, sharee.id)
        assertEquals(HttpStatusCode.OK, sharee.client.meeting(w.meeting.id).status)

        TestServices.teams.removeMember(w.leadsTeamId, w.manager.id)
        val lapsed = sharee.client.meeting(w.meeting.id)
        assertEquals(HttpStatusCode.Forbidden, lapsed.status)
        assertEquals("The person who shared this no longer has access to it", lapsed.detail())
        assertEquals(HttpStatusCode.Forbidden, sharee.client.get("/api/v1/one-on-ones/${w.meeting.id}/events").status)

        TestServices.teams.addMember(w.leadsTeamId, w.manager.id)
        assertEquals(HttpStatusCode.OK, sharee.client.meeting(w.meeting.id).status)
    }

    @Test
    fun `one-on-ones - the manager is the author - withdraws a subordinate's share, notifications and links`() =
        runBlockingApp {
            val w = meetingWorld()
            val sharee = person("sharee")
            val id = w.subordinate.client.shareMeetingId(w.meeting.id, sharee.id)

            val shared = sharee.client.notifications().single { it.type == NotificationType.ONE_ON_ONE_SHARED }
            assertEquals(mapOf("sharer" to w.subordinate.name), shared.params)
            assertEquals("/one-on-ones/${w.meeting.id}/view", shared.link)

            val all = w.manager.client.get("/api/v1/shares") {
                parameter("view", "document")
                parameter("resourceType", "ONE_ON_ONE")
                parameter("resourceId", w.meeting.id.toString())
            }.body<SharePageResponse>()
            assertEquals(listOf(id), all.items.map { it.id })
            assertEquals(HttpStatusCode.NoContent, w.manager.client.post("/api/v1/shares/$id/withdraw").status)
            assertEquals(HttpStatusCode.Forbidden, sharee.client.meeting(w.meeting.id).status)

            val toSharee = sharee.client.notifications().single { it.type == NotificationType.ONE_ON_ONE_SHARE_WITHDRAWN }
            assertEquals(
                mapOf("sharer" to w.subordinate.name, "sharee" to sharee.name, "actor" to w.manager.name),
                toSharee.params,
            )
            assertNull(toSharee.link)
            val toSharer =
                w.subordinate.client.notifications().single { it.type == NotificationType.ONE_ON_ONE_SHARE_WITHDRAWN }
            assertEquals("sharer", toSharer.params["self"])
            assertEquals("/shares?tab=byMe", toSharer.link)
        }

    @Test
    fun `one-on-ones - a sharee sees the shared meeting, never facts about the pair's other meetings`() = runBlockingApp {
        val w = meetingWorld()
        val second = w.manager.client.post("/api/v1/one-on-ones") {
            contentType(ContentType.Application.Json)
            setBody(OneOnOneCreateRequest(subordinateId = w.subordinate.id, meetingDate = "2026-07-08"))
        }
        assertEquals(HttpStatusCode.Created, second.status)
        val secondMeeting = second.body<OneOnOneResponse>()
        // Carry-over copied the unresolved action item into #2, so #2 references meeting #1.
        val ownSecond = w.manager.client.meeting(secondMeeting.id).body<OneOnOneResponse>()
        assertTrue(ownSecond.isLatest)
        assertEquals("2026-07-01", ownSecond.minMeetingDate)
        assertNotNull(ownSecond.actionItems.single().copiedFromId)
        assertNotNull(ownSecond.actionItems.single().firstAppearedOn)
        // Meeting #1 (older) reveals the later sibling's date as its floor to its own parties.
        assertEquals("2026-07-08", w.manager.client.meeting(w.meeting.id).body<OneOnOneResponse>().minMeetingDate)

        val first = person("sharee-first")
        val latest = person("sharee-latest")
        w.manager.client.shareMeetingId(w.meeting.id, first.id)
        w.manager.client.shareMeetingId(secondMeeting.id, latest.id)

        // Sharing #1: the sharee does not learn that #2 exists or when it took place.
        val seenFirst = first.client.meeting(w.meeting.id).body<OneOnOneResponse>()
        assertEquals("2026-07-01", seenFirst.meetingDate)
        assertNull(seenFirst.minMeetingDate)
        assertFalse(seenFirst.isLatest)
        // Sharing #2: nothing about #1 either — no floor date, no carry-over link, no first-appearance date —
        // and no claim of being the latest.
        val seenSecond = latest.client.meeting(secondMeeting.id).body<OneOnOneResponse>()
        assertEquals("2026-07-08", seenSecond.meetingDate)
        assertNull(seenSecond.minMeetingDate)
        assertFalse(seenSecond.isLatest)
        assertEquals("prepare demo", seenSecond.actionItems.single().content)
        assertNull(seenSecond.actionItems.single().copiedFromId)
        assertNull(seenSecond.actionItems.single().firstAppearedOn)

        // The history too: the CREATED event of #2 records how many items were carried over from #1 — a
        // fact about the sibling meeting — which the owner sees and a sharee does not.
        suspend fun createdParams(client: HttpClient, meetingId: UInt) =
            client.get("/api/v1/one-on-ones/$meetingId/events").body<OneOnOneEventListResponse>().items
                .single { it.type == OneOnOneEventType.CREATED }.params
        assertEquals("1", createdParams(w.manager.client, secondMeeting.id)["carriedOver"])
        assertEquals(mapOf("date" to "2026-07-08"), createdParams(latest.client, secondMeeting.id))
        assertEquals(mapOf("date" to "2026-07-01"), createdParams(first.client, w.meeting.id))
    }

    @Test
    fun `one-on-ones - the label snapshot survives a later edit of the meeting date`() = runBlockingApp {
        val w = meetingWorld()
        val sharee = person("sharee")
        w.manager.client.shareMeetingId(w.meeting.id, sharee.id)
        val edit = w.manager.client.put("/api/v1/one-on-ones/${w.meeting.id}") {
            contentType(ContentType.Application.Json)
            setBody(
                OneOnOneUpdateRequest(
                    meetingDate = "2026-07-09",
                    points = listOf(OneOnOneItemInput(content = "roadmap")),
                    decisions = emptyList(),
                    actionItems = emptyList(),
                ),
            )
        }
        assertEquals(HttpStatusCode.NoContent, edit.status)
        assertEquals("2026-07-09", w.manager.client.meeting(w.meeting.id).body<OneOnOneResponse>().meetingDate)
        val row = sharee.client.get("/api/v1/shares").body<SharePageResponse>().items.single()
        assertEquals("2026-07-01", row.details?.get("meetingDate"))
    }

    // ── Performance reviews ──────────────────────────────────────────────────────────────────

    private class ReviewWorld(
        val manager: Person,
        val subordinate: Person,
        val grand: Person,
        val leadsTeamId: UInt,
        val review: PerformanceReviewResponse,
    )

    private suspend fun HttpClient.shareReview(reviewId: UInt, shareeId: UInt): HttpResponse =
        post("/api/v1/shares") {
            contentType(ContentType.Application.Json)
            setBody(ShareRequest(ShareableResourceType.PERFORMANCE_REVIEW, reviewId, shareeId, null))
        }

    private suspend fun HttpClient.shareReviewId(reviewId: UInt, shareeId: UInt): UInt {
        val response = shareReview(reviewId, shareeId)
        assertEquals(HttpStatusCode.Created, response.status)
        return response.body<ShareResponse>().id
    }

    private suspend fun HttpClient.review(id: UInt) = get("/api/v1/performance-reviews/$id")

    private suspend fun HttpClient.reviewAction(id: UInt, action: String) =
        post("/api/v1/performance-reviews/$id/$action")

    /**
     * M manages S, G manages M; M writes a complete review of S for a fresh period and moves it to
     * [stage] (DRAFT → CALIBRATION via submit → PUBLISHED via publish).
     */
    private suspend fun ApplicationTestBuilder.reviewWorld(
        stage: PerformanceReviewStatus = PerformanceReviewStatus.PUBLISHED,
        managerRoles: Set<UserRole> = emptySet(),
        subordinateRoles: Set<UserRole> = emptySet(),
    ): ReviewWorld {
        val manager = person("manager", roles = managerRoles)
        val subordinate = person("subordinate", roles = subordinateRoles)
        val grand = person("grand-manager")
        TestServices.teams.create(Team("Squad-${manager.id}", manager.id, listOf(subordinate.id)))
        val leads = TestServices.teams.create(Team("Leads-${grand.id}", grand.id, listOf(manager.id)))
        val period = TestReviewPeriods.append()
        val created = manager.client.post("/api/v1/performance-reviews") {
            contentType(ContentType.Application.Json)
            setBody(
                PerformanceReviewCreateRequest(
                    subordinateId = subordinate.id,
                    periodId = period.id,
                    attitude = CategoryAssessment(3, "attitude secret summary"),
                    delivery = CategoryAssessment(4, "delivery secret summary"),
                    skills = CategoryAssessment(5, "skills secret summary"),
                    aptitude = CategoryAssessment(5, "aptitude secret summary"),
                    overall = CategoryAssessment(4, "overall secret summary"),
                ),
            )
        }
        assertEquals(HttpStatusCode.Created, created.status)
        val review = created.body<PerformanceReviewResponse>()
        assertTrue(review.canShare, "the authoring manager reads their own review")
        if (stage != PerformanceReviewStatus.DRAFT) {
            assertEquals(HttpStatusCode.NoContent, manager.client.reviewAction(review.id, "submit").status)
        }
        if (stage == PerformanceReviewStatus.PUBLISHED) {
            assertEquals(HttpStatusCode.NoContent, manager.client.reviewAction(review.id, "publish").status)
        }
        return ReviewWorld(manager, subordinate, grand, leads, review)
    }

    @Test
    fun `reviews - a sharee reads the review with ratings and summaries exactly as the sharer sees them, and its events`() =
        runBlockingApp {
            val w = reviewWorld()
            val sharee = person("sharee")
            assertEquals(HttpStatusCode.Forbidden, sharee.client.review(w.review.id).status)

            w.manager.client.shareReviewId(w.review.id, sharee.id)
            val own = w.manager.client.review(w.review.id).body<PerformanceReviewResponse>()
            val shared = sharee.client.review(w.review.id).body<PerformanceReviewResponse>()
            assertEquals(own.attitude, shared.attitude)
            assertEquals(own.overall, shared.overall)
            assertEquals("skills secret summary", shared.skills.summary)
            assertEquals(5, shared.skills.rating)
            assertEquals(w.manager.name, shared.sharedBy)
            assertFalse(shared.canShare)
            val events = sharee.client.get("/api/v1/performance-reviews/${w.review.id}/events")
            assertEquals(HttpStatusCode.OK, events.status)
            assertTrue(events.body<PerformanceReviewEventListResponse>().items.isNotEmpty())

            for (party in listOf(w.manager, w.subordinate, w.grand)) {
                val read = party.client.review(w.review.id).body<PerformanceReviewResponse>()
                assertTrue(read.canShare, "${party.name} reads in their own right")
                assertNull(read.sharedBy)
            }
            val row = sharee.client.get("/api/v1/shares").body<SharePageResponse>().items.single()
            // The snapshot is the subordinate and the period bounds ONLY — never a rating or summary.
            assertEquals(
                mapOf(
                    "subordinate" to w.subordinate.name,
                    "startMonth" to w.review.periodStartMonth,
                    "endMonth" to w.review.periodEndMonth,
                ),
                row.details,
            )
            assertEquals("/performance-reviews/${w.review.id}/view", row.link)
        }

    @Test
    fun `reviews - a sharee can write nothing`() = runBlockingApp {
        val w = reviewWorld(stage = PerformanceReviewStatus.CALIBRATION)
        val viaManager = person("sharee-m")
        val viaGrand = person("sharee-g")
        w.manager.client.shareReviewId(w.review.id, viaManager.id)
        w.grand.client.shareReviewId(w.review.id, viaGrand.id)
        for (sharee in listOf(viaManager, viaGrand)) {
            val put = sharee.client.put("/api/v1/performance-reviews/${w.review.id}") {
                contentType(ContentType.Application.Json)
                setBody(
                    PerformanceReviewUpdateRequest(
                        attitude = CategoryAssessment(1, "tampered"),
                        delivery = CategoryAssessment(4, "delivery secret summary"),
                        skills = CategoryAssessment(5, "skills secret summary"),
                        aptitude = CategoryAssessment(5, "aptitude secret summary"),
                        overall = CategoryAssessment(4, "overall secret summary"),
                    ),
                )
            }
            assertEquals(HttpStatusCode.Forbidden, put.status)
            for (action in listOf("submit", "revert", "publish", "unpublish")) {
                assertEquals(HttpStatusCode.Forbidden, sharee.client.reviewAction(w.review.id, action).status, action)
            }
            assertEquals(HttpStatusCode.Forbidden, sharee.client.delete("/api/v1/performance-reviews/${w.review.id}").status)
        }
        val after = w.manager.client.review(w.review.id).body<PerformanceReviewResponse>()
        assertEquals(CategoryAssessment(3, "attitude secret summary"), after.attitude)
        assertEquals(PerformanceReviewStatus.CALIBRATION, after.status)
    }

    @Test
    fun `reviews - no re-sharing, no HR-auditor sharing, an HR party can share`() = runBlockingApp {
        val w = reviewWorld(managerRoles = setOf(UserRole.HR))
        val sharee = person("sharee")
        val third = person("third")
        val auditor = person("auditor", roles = setOf(UserRole.HR))
        assertTrue(w.manager.client.review(w.review.id).body<PerformanceReviewResponse>().canShare)
        w.manager.client.shareReviewId(w.review.id, sharee.id)

        val reshare = sharee.client.shareReview(w.review.id, third.id)
        assertEquals(HttpStatusCode.Forbidden, reshare.status)
        assertEquals("Only someone who can read this document in their own right may share it", reshare.detail())

        val audit = auditor.client.review(w.review.id)
        assertEquals(HttpStatusCode.OK, audit.status)
        assertFalse(audit.body<PerformanceReviewResponse>().canShare)
        assertEquals(HttpStatusCode.Forbidden, auditor.client.shareReview(w.review.id, third.id).status)
        assertEquals(HttpStatusCode.Created, w.manager.client.shareReview(w.review.id, auditor.id).status)
    }

    @Test
    fun `reviews - the subordinate shares only a PUBLISHED review, and the share lapses if it is un-published`() =
        runBlockingApp {
            val w = reviewWorld(stage = PerformanceReviewStatus.CALIBRATION)
            val viaSubordinate = person("sharee-s")
            val viaManager = person("sharee-m")
            val stranger = person("someone")
            // DRAFT/CALIBRATION is invisible to the subordinate — so they cannot share it either.
            assertEquals(HttpStatusCode.Forbidden, w.subordinate.client.review(w.review.id).status)
            assertEquals(HttpStatusCode.Forbidden, w.subordinate.client.shareReview(w.review.id, stranger.id).status)

            assertEquals(HttpStatusCode.NoContent, w.manager.client.reviewAction(w.review.id, "publish").status)
            assertTrue(w.subordinate.client.review(w.review.id).body<PerformanceReviewResponse>().canShare)
            w.subordinate.client.shareReviewId(w.review.id, viaSubordinate.id)
            w.manager.client.shareReviewId(w.review.id, viaManager.id)
            assertEquals(HttpStatusCode.OK, viaSubordinate.client.review(w.review.id).status)

            // Un-published (PUBLISHED is not terminal): the subordinate loses sight, so their share lapses;
            // the manager's keeps working.
            assertEquals(HttpStatusCode.NoContent, w.manager.client.reviewAction(w.review.id, "unpublish").status)
            val lapsed = viaSubordinate.client.review(w.review.id)
            assertEquals(HttpStatusCode.Forbidden, lapsed.status)
            assertEquals("The person who shared this no longer has access to it", lapsed.detail())
            assertEquals(HttpStatusCode.Forbidden, viaSubordinate.client.get("/api/v1/performance-reviews/${w.review.id}/events").status)
            assertEquals(HttpStatusCode.OK, viaManager.client.review(w.review.id).status)

            // Published again: the subordinate's share (never withdrawn) works again.
            assertEquals(HttpStatusCode.NoContent, w.manager.client.reviewAction(w.review.id, "publish").status)
            assertEquals(HttpStatusCode.OK, viaSubordinate.client.review(w.review.id).status)
        }

    @Test
    fun `reviews - an HR subordinate reads a CALIBRATION review only as an auditor and cannot share it until it is published`() =
        runBlockingApp {
            val w = reviewWorld(stage = PerformanceReviewStatus.CALIBRATION, subordinateRoles = setOf(UserRole.HR))
            val sharee = person("sharee")
            val audit = LogCapture("ch.nokillswit.audit")
            try {
                // The subordinate's own right needs PUBLISHED; the HR role still reads (audited) — but
                // that auditor read is not an own-right read, so no share.
                val read = w.subordinate.client.review(w.review.id)
                assertEquals(HttpStatusCode.OK, read.status)
                assertFalse(read.body<PerformanceReviewResponse>().canShare)
                assertNotNull(
                    audit.events.find {
                        it.message == "hr.read" && it.keyValuePairs.any { kv -> kv.value == w.subordinate.id.toLong() }
                    },
                    "the auditor read is logged",
                )
                val denied = w.subordinate.client.shareReview(w.review.id, sharee.id)
                assertEquals(HttpStatusCode.Forbidden, denied.status)
                assertEquals("Only someone who can read this document in their own right may share it", denied.detail())

                assertEquals(HttpStatusCode.NoContent, w.manager.client.reviewAction(w.review.id, "publish").status)
                assertTrue(w.subordinate.client.review(w.review.id).body<PerformanceReviewResponse>().canShare)
                assertEquals(HttpStatusCode.Created, w.subordinate.client.shareReview(w.review.id, sharee.id).status)
            } finally {
                audit.detach()
            }
        }

    @Test
    fun `reviews - a chain manager cannot share a DRAFT, and their CALIBRATION share lapses when it returns to DRAFT`() =
        runBlockingApp {
            val w = reviewWorld(stage = PerformanceReviewStatus.DRAFT)
            val sharee = person("sharee")
            assertEquals(HttpStatusCode.Forbidden, w.grand.client.review(w.review.id).status)
            assertEquals(HttpStatusCode.Forbidden, w.grand.client.shareReview(w.review.id, sharee.id).status)
            // The reviewed subordinate cannot read — so cannot share — a DRAFT either.
            assertEquals(HttpStatusCode.Forbidden, w.subordinate.client.review(w.review.id).status)
            assertEquals(HttpStatusCode.Forbidden, w.subordinate.client.shareReview(w.review.id, sharee.id).status)

            assertEquals(HttpStatusCode.NoContent, w.manager.client.reviewAction(w.review.id, "submit").status)
            assertTrue(w.grand.client.review(w.review.id).body<PerformanceReviewResponse>().canShare)
            w.grand.client.shareReviewId(w.review.id, sharee.id)
            assertEquals(HttpStatusCode.OK, sharee.client.review(w.review.id).status)

            assertEquals(HttpStatusCode.NoContent, w.manager.client.reviewAction(w.review.id, "revert").status)
            val lapsed = sharee.client.review(w.review.id)
            assertEquals(HttpStatusCode.Forbidden, lapsed.status)
            assertEquals("The person who shared this no longer has access to it", lapsed.detail())
            // The chain-manager lapse also holds when the sharer leaves the chain entirely.
            assertEquals(HttpStatusCode.NoContent, w.manager.client.reviewAction(w.review.id, "submit").status)
            assertEquals(HttpStatusCode.OK, sharee.client.review(w.review.id).status)
            TestServices.teams.removeMember(w.leadsTeamId, w.manager.id)
            val leftChain = sharee.client.review(w.review.id)
            assertEquals(HttpStatusCode.Forbidden, leftChain.status)
            assertEquals("The person who shared this no longer has access to it", leftChain.detail())
        }

    @Test
    fun `reviews - a batch through the real adapter - another manager's DRAFT is FORBIDDEN, a CALIBRATION review is created`() =
        runBlockingApp {
            val draft = reviewWorld(stage = PerformanceReviewStatus.DRAFT)
            val sharee = person("sharee")
            // A second report of the same manager M, whose review M moves to CALIBRATION.
            val second = person("second-report")
            TestServices.teams.create(Team("Squad2-${draft.manager.id}", draft.manager.id, listOf(second.id)))
            val period = TestReviewPeriods.append()
            val created = draft.manager.client.post("/api/v1/performance-reviews") {
                contentType(ContentType.Application.Json)
                setBody(
                    PerformanceReviewCreateRequest(
                        subordinateId = second.id,
                        periodId = period.id,
                        attitude = CategoryAssessment(3, "a"),
                        delivery = CategoryAssessment(4, "b"),
                        skills = CategoryAssessment(5, "c"),
                        aptitude = CategoryAssessment(5, "d"),
                        overall = CategoryAssessment(4, "e"),
                    ),
                )
            }
            assertEquals(HttpStatusCode.Created, created.status)
            val calibration = created.body<PerformanceReviewResponse>()
            assertEquals(HttpStatusCode.NoContent, draft.manager.client.reviewAction(calibration.id, "submit").status)

            // G (M's manager) cannot read M's DRAFT in their own right -> FORBIDDEN; the CALIBRATION one -> CREATED.
            val response = draft.grand.client.post("/api/v1/shares/batch") {
                contentType(ContentType.Application.Json)
                setBody(
                    ShareBatchRequest(
                        ShareableResourceType.PERFORMANCE_REVIEW,
                        listOf(draft.review.id, calibration.id),
                        listOf(sharee.id),
                    ),
                )
            }
            assertEquals(HttpStatusCode.OK, response.status)
            val report = response.body<ShareBatchResponse>()
            assertEquals(listOf(ShareBatchItemStatus.FORBIDDEN, ShareBatchItemStatus.CREATED), report.items.map { it.status })
            assertEquals(1, report.created)
            assertEquals(HttpStatusCode.OK, sharee.client.review(calibration.id).status)
            assertEquals(HttpStatusCode.Forbidden, sharee.client.review(draft.review.id).status)
            // The sharer alone (the DRAFT only) gets the whole-request 403.
            val onlyDraft = draft.grand.client.post("/api/v1/shares/batch") {
                contentType(ContentType.Application.Json)
                setBody(ShareBatchRequest(ShareableResourceType.PERFORMANCE_REVIEW, listOf(draft.review.id), listOf(sharee.id)))
            }
            assertEquals(HttpStatusCode.Forbidden, onlyDraft.status)
        }

    @Test
    fun `reviews - batch own-right edges - an HR auditor and a mere sharee are refused, the subordinate only once PUBLISHED`() =
        runBlockingApp {
            // ONE world (one review period — the shared timeline is scarce): PUBLISHED first.
            val w = reviewWorld()
            val hr = person("hr-auditor", roles = setOf(UserRole.HR))
            val sharee = person("sharee")
            val target = person("target")
            suspend fun HttpClient.batch(vararg ids: UInt) = post("/api/v1/shares/batch") {
                contentType(ContentType.Application.Json)
                setBody(ShareBatchRequest(ShareableResourceType.PERFORMANCE_REVIEW, ids.toList(), listOf(target.id)))
            }
            val missing = TestShareDocuments.nextId()

            // (a) An HR-only auditor reads every review but holds no own right: the whole call is 403 ...
            assertEquals(HttpStatusCode.OK, hr.client.review(w.review.id).status)
            assertEquals(HttpStatusCode.Forbidden, hr.client.batch(w.review.id).status)
            // (b) ... and so is a reader who got in through a share only (no re-sharing), also when the
            // other item does not exist (FORBIDDEN + NOT_FOUND is still 403, never a 404).
            w.manager.client.shareReviewId(w.review.id, sharee.id)
            assertEquals(HttpStatusCode.OK, sharee.client.review(w.review.id).status)
            assertEquals(HttpStatusCode.Forbidden, sharee.client.batch(w.review.id).status)
            assertEquals(HttpStatusCode.Forbidden, sharee.client.batch(w.review.id, missing).status)

            // (c) The subordinate reads — so may batch-share — their own review only once PUBLISHED.
            assertEquals(HttpStatusCode.NoContent, w.manager.client.reviewAction(w.review.id, "unpublish").status)
            assertEquals(HttpStatusCode.Forbidden, w.subordinate.client.batch(w.review.id).status)
            assertEquals(HttpStatusCode.NoContent, w.manager.client.reviewAction(w.review.id, "publish").status)
            val published = w.subordinate.client.batch(w.review.id)
            assertEquals(HttpStatusCode.OK, published.status)
            assertEquals(listOf(ShareBatchItemStatus.CREATED), published.body<ShareBatchResponse>().items.map { it.status })
        }

    @Test
    fun `reviews - accepted consequence - an own-right reader may share a pre-publication review with the subordinate`() =
        runBlockingApp {
            // (a) The manager shares a DRAFT with the reviewed subordinate, who cannot read it in their own right.
            val draft = reviewWorld(stage = PerformanceReviewStatus.DRAFT)
            assertEquals(HttpStatusCode.Forbidden, draft.subordinate.client.review(draft.review.id).status)
            draft.manager.client.shareReviewId(draft.review.id, draft.subordinate.id)
            val seen = draft.subordinate.client.review(draft.review.id)
            assertEquals(HttpStatusCode.OK, seen.status)
            val body = seen.body<PerformanceReviewResponse>()
            assertEquals(PerformanceReviewStatus.DRAFT, body.status)
            assertEquals(CategoryAssessment(3, "attitude secret summary"), body.attitude)
            assertEquals(draft.manager.name, body.sharedBy)
            assertFalse(body.canShare, "their only way in is the share")

            // (b) A chain manager shares a CALIBRATION review with the subordinate; the author withdraws it.
            val calibration = reviewWorld(stage = PerformanceReviewStatus.CALIBRATION)
            val shareId = calibration.grand.client.shareReviewId(calibration.review.id, calibration.subordinate.id)
            assertEquals(HttpStatusCode.OK, calibration.subordinate.client.review(calibration.review.id).status)
            assertEquals(HttpStatusCode.NoContent, calibration.manager.client.post("/api/v1/shares/$shareId/withdraw").status)
            assertEquals(HttpStatusCode.Forbidden, calibration.subordinate.client.review(calibration.review.id).status)
        }

    @Test
    fun `reviews - the manager is the author - withdraws a subordinate's share, notifications and links`() =
        runBlockingApp {
            val w = reviewWorld()
            val sharee = person("sharee")
            val id = w.subordinate.client.shareReviewId(w.review.id, sharee.id)

            val shared = sharee.client.notifications().single { it.type == NotificationType.PERFORMANCE_REVIEW_SHARED }
            assertEquals(mapOf("sharer" to w.subordinate.name), shared.params)
            assertEquals("/performance-reviews/${w.review.id}/view", shared.link)

            val all = w.manager.client.get("/api/v1/shares") {
                parameter("view", "document")
                parameter("resourceType", "PERFORMANCE_REVIEW")
                parameter("resourceId", w.review.id.toString())
            }.body<SharePageResponse>()
            assertEquals(listOf(id), all.items.map { it.id })
            assertEquals(HttpStatusCode.NoContent, w.manager.client.post("/api/v1/shares/$id/withdraw").status)
            assertEquals(HttpStatusCode.Forbidden, sharee.client.review(w.review.id).status)

            val toSharee =
                sharee.client.notifications().single { it.type == NotificationType.PERFORMANCE_REVIEW_SHARE_WITHDRAWN }
            assertEquals(
                mapOf("sharer" to w.subordinate.name, "sharee" to sharee.name, "actor" to w.manager.name),
                toSharee.params,
            )
            assertNull(toSharee.link)
            val toSharer = w.subordinate.client.notifications()
                .single { it.type == NotificationType.PERFORMANCE_REVIEW_SHARE_WITHDRAWN }
            assertEquals("sharer", toSharer.params["self"])
            assertEquals("/shares?tab=byMe", toSharer.link)
        }

    @Test
    fun `reviews - the label snapshot is unaffected by later assessment edits`() = runBlockingApp {
        val w = reviewWorld(stage = PerformanceReviewStatus.DRAFT)
        val sharee = person("sharee")
        w.manager.client.shareReviewId(w.review.id, sharee.id)
        val before = sharee.client.get("/api/v1/shares").body<SharePageResponse>().items.single().details
        val edit = w.manager.client.put("/api/v1/performance-reviews/${w.review.id}") {
            contentType(ContentType.Application.Json)
            setBody(PerformanceReviewUpdateRequest(attitude = CategoryAssessment(6, "rewritten afterwards")))
        }
        assertEquals(HttpStatusCode.NoContent, edit.status)
        val row = sharee.client.get("/api/v1/shares").body<SharePageResponse>().items.single()
        assertEquals(before, row.details)
        assertEquals(setOf("subordinate", "startMonth", "endMonth"), row.details?.keys)
        // …and the sharee reads the CURRENT document (a share is a live read of the document).
        assertEquals(
            "rewritten afterwards",
            sharee.client.review(w.review.id).body<PerformanceReviewResponse>().attitude.summary,
        )
    }

    // ── Impact log ───────────────────────────────────────────────────────────────────────────

    private class EntryWorld(
        val owner: Person,
        val manager: Person,
        val teamId: UInt,
        val entry: ImpactEntryResponse,
    )

    private suspend fun HttpClient.shareEntry(entryId: UInt, shareeId: UInt): HttpResponse =
        post("/api/v1/shares") {
            contentType(ContentType.Application.Json)
            setBody(ShareRequest(ShareableResourceType.IMPACT_LOG_ENTRY, entryId, shareeId, null))
        }

    private suspend fun HttpClient.shareEntryId(entryId: UInt, shareeId: UInt): UInt {
        val response = shareEntry(entryId, shareeId)
        assertEquals(HttpStatusCode.Created, response.status)
        return response.body<ShareResponse>().id
    }

    private suspend fun HttpClient.entry(id: UInt) = get("/api/v1/impact-log/$id")

    private fun entryRequest(title: String = "Original entry title") = ImpactEntryRequest(
        title = title,
        periodStart = "2026-07-01",
        periodEnd = "2026-07-31",
        whatHappened = "what happened (private section)",
        contribution = "my contribution (private section)",
        whyItMattered = "why it mattered (private section)",
        evidence = "evidence (private section)",
    )

    /** The owner O keeps a journal; M manages O (so M reads the owner's entries via the chain). */
    private suspend fun ApplicationTestBuilder.entryWorld(ownerRoles: Set<UserRole> = emptySet()): EntryWorld {
        val owner = person("owner", roles = ownerRoles)
        val manager = person("manager")
        val team = TestServices.teams.create(Team("Squad-${manager.id}", manager.id, listOf(owner.id)))
        val created = owner.client.post("/api/v1/impact-log") {
            contentType(ContentType.Application.Json)
            setBody(entryRequest())
        }
        assertEquals(HttpStatusCode.Created, created.status)
        val entry = created.body<ImpactEntryResponse>()
        assertTrue(entry.canShare, "the owner reads their own entry")
        return EntryWorld(owner, manager, team, entry)
    }

    @Test
    fun `impact log - a sharee reads the entry's sections and events exactly as the sharer sees them`() = runBlockingApp {
        val w = entryWorld()
        val sharee = person("sharee")
        assertEquals(HttpStatusCode.Forbidden, sharee.client.entry(w.entry.id).status)

        w.owner.client.shareEntryId(w.entry.id, sharee.id)
        val shared = sharee.client.entry(w.entry.id).body<ImpactEntryResponse>()
        val own = w.owner.client.entry(w.entry.id).body<ImpactEntryResponse>()
        assertEquals(own.whatHappened, shared.whatHappened)
        assertEquals(own.evidence, shared.evidence)
        assertEquals("my contribution (private section)", shared.contribution)
        assertEquals(w.owner.name, shared.sharedBy)
        assertFalse(shared.canShare)
        val events = sharee.client.get("/api/v1/impact-log/${w.entry.id}/events")
        assertEquals(HttpStatusCode.OK, events.status)
        assertTrue(events.body<ImpactEntryEventListResponse>().items.isNotEmpty())

        for (reader in listOf(w.owner, w.manager)) {
            val read = reader.client.entry(w.entry.id).body<ImpactEntryResponse>()
            assertTrue(read.canShare, "${reader.name} reads in their own right")
            assertNull(read.sharedBy)
        }
        val row = sharee.client.get("/api/v1/shares").body<SharePageResponse>().items.single()
        // The snapshot is the title, the owner and the period only — never a section.
        assertEquals(
            mapOf(
                "title" to "Original entry title",
                "author" to w.owner.name,
                "periodStart" to "2026-07-01",
                "periodEnd" to "2026-07-31",
            ),
            row.details,
        )
        assertEquals("/impact-log/${w.entry.id}/view", row.link)
    }

    @Test
    fun `impact log - a sharee can write nothing`() = runBlockingApp {
        val w = entryWorld()
        val viaOwner = person("sharee-o")
        val viaManager = person("sharee-m")
        w.owner.client.shareEntryId(w.entry.id, viaOwner.id)
        w.manager.client.shareEntryId(w.entry.id, viaManager.id)
        for (sharee in listOf(viaOwner, viaManager)) {
            val put = sharee.client.put("/api/v1/impact-log/${w.entry.id}") {
                contentType(ContentType.Application.Json)
                setBody(entryRequest("tampered"))
            }
            assertEquals(HttpStatusCode.Forbidden, put.status)
            assertEquals(HttpStatusCode.Forbidden, sharee.client.delete("/api/v1/impact-log/${w.entry.id}").status)
        }
        // The chain manager reads but never writes either — the share adds no pen.
        assertEquals(HttpStatusCode.Forbidden, w.manager.client.delete("/api/v1/impact-log/${w.entry.id}").status)
        assertEquals("Original entry title", w.owner.client.entry(w.entry.id).body<ImpactEntryResponse>().title)
    }

    @Test
    fun `impact log - no re-sharing, no HR-auditor sharing, an HR owner can share`() = runBlockingApp {
        val w = entryWorld(ownerRoles = setOf(UserRole.HR))
        val sharee = person("sharee")
        val third = person("third")
        val auditor = person("auditor", roles = setOf(UserRole.HR))
        assertTrue(w.owner.client.entry(w.entry.id).body<ImpactEntryResponse>().canShare)
        w.owner.client.shareEntryId(w.entry.id, sharee.id)

        val reshare = sharee.client.shareEntry(w.entry.id, third.id)
        assertEquals(HttpStatusCode.Forbidden, reshare.status)
        assertEquals("Only someone who can read this document in their own right may share it", reshare.detail())

        val audit = auditor.client.entry(w.entry.id)
        assertEquals(HttpStatusCode.OK, audit.status)
        assertFalse(audit.body<ImpactEntryResponse>().canShare)
        assertEquals(HttpStatusCode.Forbidden, auditor.client.shareEntry(w.entry.id, third.id).status)
        assertEquals(HttpStatusCode.Created, w.owner.client.shareEntry(w.entry.id, auditor.id).status)
    }

    @Test
    fun `impact log - a chain manager's share lapses when they leave the chain, and the owner withdraws it`() = runBlockingApp {
        val w = entryWorld()
        val sharee = person("sharee")
        val id = w.manager.client.shareEntryId(w.entry.id, sharee.id)
        assertEquals(HttpStatusCode.OK, sharee.client.entry(w.entry.id).status)

        TestServices.teams.removeMember(w.teamId, w.owner.id)
        val lapsed = sharee.client.entry(w.entry.id)
        assertEquals(HttpStatusCode.Forbidden, lapsed.status)
        assertEquals("The person who shared this no longer has access to it", lapsed.detail())
        assertEquals(HttpStatusCode.Forbidden, sharee.client.get("/api/v1/impact-log/${w.entry.id}/events").status)

        // Back in the chain it works again — then the OWNER (the author) lists and withdraws it.
        TestServices.teams.addMember(w.teamId, w.owner.id)
        assertEquals(HttpStatusCode.OK, sharee.client.entry(w.entry.id).status)
        val all = w.owner.client.get("/api/v1/shares") {
            parameter("view", "document")
            parameter("resourceType", "IMPACT_LOG_ENTRY")
            parameter("resourceId", w.entry.id.toString())
        }.body<SharePageResponse>()
        assertEquals(listOf(id), all.items.map { it.id })
        assertEquals(HttpStatusCode.NoContent, w.owner.client.post("/api/v1/shares/$id/withdraw").status)
        assertEquals(HttpStatusCode.Forbidden, sharee.client.entry(w.entry.id).status)
    }

    @Test
    fun `impact log - notifications and links for a share and an author withdrawal`() = runBlockingApp {
        val w = entryWorld()
        val sharee = person("sharee")
        val id = w.manager.client.shareEntryId(w.entry.id, sharee.id)
        val shared = sharee.client.notifications().single { it.type == NotificationType.IMPACT_ENTRY_SHARED }
        assertEquals(mapOf("sharer" to w.manager.name), shared.params)
        assertEquals("/impact-log/${w.entry.id}/view", shared.link)

        assertEquals(HttpStatusCode.NoContent, w.owner.client.post("/api/v1/shares/$id/withdraw").status)
        val toSharee = sharee.client.notifications().single { it.type == NotificationType.IMPACT_ENTRY_SHARE_WITHDRAWN }
        assertEquals(
            mapOf("sharer" to w.manager.name, "sharee" to sharee.name, "actor" to w.owner.name),
            toSharee.params,
        )
        assertNull(toSharee.link)
        val toSharer = w.manager.client.notifications().single { it.type == NotificationType.IMPACT_ENTRY_SHARE_WITHDRAWN }
        assertEquals("sharer", toSharer.params["self"])
        assertEquals("/shares?tab=byMe", toSharer.link)
    }

    @Test
    fun `impact log - the full label snapshot is stable after a retitle`() = runBlockingApp {
        val w = entryWorld()
        val sharee = person("sharee")
        w.owner.client.shareEntryId(w.entry.id, sharee.id)
        val before = sharee.client.get("/api/v1/shares").body<SharePageResponse>().items.single().details
        val edit = w.owner.client.put("/api/v1/impact-log/${w.entry.id}") {
            contentType(ContentType.Application.Json)
            setBody(entryRequest("Retitled afterwards"))
        }
        assertEquals(HttpStatusCode.NoContent, edit.status)
        assertEquals("Retitled afterwards", w.owner.client.entry(w.entry.id).body<ImpactEntryResponse>().title)
        assertEquals(before, sharee.client.get("/api/v1/shares").body<SharePageResponse>().items.single().details)
        assertEquals("Original entry title", before?.get("title"))
    }

    @Test
    fun `impact log - a sharee with the area disabled gets the caller-gate 403 and no row in withMe`() = runBlockingApp {
        val w = entryWorld()
        val sharee = person("sharee-off", disabled = setOf(Feature.IMPACT_LOG))
        w.owner.client.shareEntryId(w.entry.id, sharee.id)
        val gated = sharee.client.entry(w.entry.id)
        assertEquals(HttpStatusCode.Forbidden, gated.status)
        assertEquals("The IMPACT_LOG feature is disabled for this account", gated.detail())
        assertEquals(0L, sharee.client.get("/api/v1/shares").body<SharePageResponse>().total)
        assertTrue(sharee.client.notifications().none { it.type == NotificationType.IMPACT_ENTRY_SHARED })
    }

    // ── Succession plans ─────────────────────────────────────────────────────────────────────

    private class PlanWorld(
        val owner: Person,
        val manager: Person,
        val seat: Person,
        val candidate: Person,
        val teamId: UInt,
        val plan: SuccessionPlanResponse,
        val nomination: SuccessionNominationResponse,
        val goalTitle: String,
    )

    private suspend fun HttpClient.sharePlan(planId: UInt, shareeId: UInt, expiresOn: String? = null): HttpResponse =
        post("/api/v1/shares") {
            contentType(ContentType.Application.Json)
            setBody(ShareRequest(ShareableResourceType.SUCCESSION_PLAN, planId, shareeId, expiresOn))
        }

    private suspend fun HttpClient.sharePlanId(planId: UInt, shareeId: UInt, expiresOn: String? = null): UInt {
        val response = sharePlan(planId, shareeId, expiresOn)
        assertEquals(HttpStatusCode.Created, response.status)
        return response.body<ShareResponse>().id
    }

    private suspend fun HttpClient.plan(id: UInt) = get("/api/v1/succession-plans/$id")

    /**
     * The owner O plans the succession of the seat person S, nominating the candidate C with one
     * linked development goal of C's; M manages O (a chain reader of the owner's plans).
     */
    private suspend fun ApplicationTestBuilder.planWorld(ownerRoles: Set<UserRole> = emptySet()): PlanWorld {
        val owner = person("owner", roles = ownerRoles)
        val manager = person("manager")
        val seat = person("seat-person")
        val candidate = person("candidate")
        TestServices.teams.create(Team("Squad-${owner.id}", owner.id, listOf(seat.id, candidate.id)))
        val teamId = TestServices.teams.create(Team("Leads-${manager.id}", manager.id, listOf(owner.id)))
        val goal = owner.client.post("/api/v1/goals") {
            contentType(ContentType.Application.Json)
            setBody(
                GoalCreateRequest(
                    subordinateId = candidate.id,
                    title = "Lead the platform migration",
                    type = GoalType.NUMBER,
                    targetValue = 1.0,
                    dueDate = serverToday().plusDays(30).toString(),
                ),
            )
        }
        assertEquals(HttpStatusCode.Created, goal.status)
        val goalId = goal.body<GoalResponse>().id
        val created = owner.client.post("/api/v1/succession-plans") {
            contentType(ContentType.Application.Json)
            setBody(
                SuccessionPlanCreateRequest(
                    userId = seat.id,
                    roleCriticality = RoleCriticality.CRITICAL,
                    retentionRisk = RetentionRisk.HIGH,
                    lossImpact = listOf("Client trust (private)", "Domain knowledge (private)"),
                    targetBenchDepth = 2,
                ),
            )
        }
        assertEquals(HttpStatusCode.Created, created.status)
        val plan = created.body<SuccessionPlanResponse>()
        assertTrue(plan.canShare, "the owner reads their own plan")
        val nominated = owner.client.post("/api/v1/succession-plans/${plan.id}/nominations") {
            contentType(ContentType.Application.Json)
            setBody(
                SuccessionNominationRequest(
                    candidateId = candidate.id,
                    readiness = SuccessorReadiness.READY_SOON,
                    nominationType = NominationType.PRIMARY,
                    competencyGaps = listOf(SuccessionCompetencyGap("Stakeholder management (private)")),
                    awareness = CandidateAwareness.CONFIDENTIAL,
                    goalIds = listOf(goalId),
                ),
            )
        }
        assertEquals(HttpStatusCode.Created, nominated.status)
        val nomination = nominated.body<SuccessionNominationResponse>()
        return PlanWorld(owner, manager, seat, candidate, teamId, plan, nomination, "Lead the platform migration")
    }

    @Test
    fun `succession - a sharee reads the plan and events as the sharer sees them, but never the linked goals`() =
        runBlockingApp {
            val w = planWorld()
            val sharee = person("sharee")
            assertEquals(HttpStatusCode.Forbidden, sharee.client.plan(w.plan.id).status)

            w.owner.client.sharePlanId(w.plan.id, sharee.id)
            val own = w.owner.client.plan(w.plan.id).body<SuccessionPlanResponse>()
            val shared = sharee.client.plan(w.plan.id).body<SuccessionPlanResponse>()
            // The plan itself — as the sharer sees it …
            assertEquals(own.lossImpact, shared.lossImpact)
            assertEquals(own.benchCount, shared.benchCount)
            assertEquals(w.candidate.name, shared.nominations.single().candidateName)
            assertEquals("Stakeholder management (private)", shared.nominations.single().competencyGaps.single().text)
            assertEquals(w.owner.name, shared.sharedBy)
            assertFalse(shared.canShare)
            // … but the linked goals are OTHER documents the sharee could not read: the owner sees the
            // chip, the sharee sees none.
            assertEquals(listOf(w.goalTitle), own.nominations.single().goals.map { it.title })
            assertEquals(emptyList(), shared.nominations.single().goals)

            val events = sharee.client.get("/api/v1/succession-plans/${w.plan.id}/events")
            assertEquals(HttpStatusCode.OK, events.status)
            val types = events.body<SuccessionPlanEventListResponse>().items.map { it.type }
            assertTrue(types.containsAll(listOf(SuccessionEventType.CREATED, SuccessionEventType.NOMINATION_ADDED)), "$types")

            for (reader in listOf(w.owner, w.manager)) {
                val read = reader.client.plan(w.plan.id).body<SuccessionPlanResponse>()
                assertTrue(read.canShare, "${reader.name} reads in their own right")
                assertNull(read.sharedBy)
            }
            val row = sharee.client.get("/api/v1/shares").body<SharePageResponse>().items.single()
            // The snapshot is the seat's person and the owner ONLY.
            assertEquals(mapOf("person" to w.seat.name, "owner" to w.owner.name), row.details)
            assertEquals("/succession/${w.plan.id}/view", row.link)
        }

    @Test
    fun `succession - a sharee can write nothing`() = runBlockingApp {
        val w = planWorld()
        val viaOwner = person("sharee-o")
        val viaManager = person("sharee-m")
        w.owner.client.sharePlanId(w.plan.id, viaOwner.id)
        w.manager.client.sharePlanId(w.plan.id, viaManager.id)
        val nominationBody = SuccessionNominationRequest(
            candidateId = w.candidate.id,
            readiness = SuccessorReadiness.READY_NOW,
            nominationType = NominationType.SECONDARY,
            awareness = CandidateAwareness.TRANSPARENT,
        )
        for (sharee in listOf(viaOwner, viaManager)) {
            val c = sharee.client
            val base = "/api/v1/succession-plans/${w.plan.id}"
            val put = c.put(base) {
                contentType(ContentType.Application.Json)
                setBody(SuccessionPlanUpdate(RoleCriticality.STANDARD, RetentionRisk.LOW, listOf("tampered"), 5))
            }
            assertEquals(HttpStatusCode.Forbidden, put.status)
            assertEquals(HttpStatusCode.Forbidden, c.post("$base/close").status)
            assertEquals(HttpStatusCode.Forbidden, c.post("$base/complete-review").status)
            assertEquals(HttpStatusCode.Forbidden, c.delete(base).status)
            val addNomination = c.post("$base/nominations") {
                contentType(ContentType.Application.Json)
                setBody(nominationBody)
            }
            assertEquals(HttpStatusCode.Forbidden, addNomination.status)
            val editNomination = c.put("$base/nominations/${w.nomination.id}") {
                contentType(ContentType.Application.Json)
                setBody(nominationBody)
            }
            assertEquals(HttpStatusCode.Forbidden, editNomination.status)
            assertEquals(HttpStatusCode.Forbidden, c.delete("$base/nominations/${w.nomination.id}").status)
        }
        val after = w.owner.client.plan(w.plan.id).body<SuccessionPlanResponse>()
        assertEquals(RoleCriticality.CRITICAL, after.roleCriticality)
        assertEquals(1, after.nominations.size)
        assertEquals(SuccessionPlanStatus.OPEN, after.status)
    }

    @Test
    fun `succession - no re-sharing, no HR-auditor sharing, an HR owner can share`() = runBlockingApp {
        val w = planWorld(ownerRoles = setOf(UserRole.HR))
        val sharee = person("sharee")
        val third = person("third")
        val auditor = person("auditor", roles = setOf(UserRole.HR))
        assertTrue(w.owner.client.plan(w.plan.id).body<SuccessionPlanResponse>().canShare)
        w.owner.client.sharePlanId(w.plan.id, sharee.id)

        val reshare = sharee.client.sharePlan(w.plan.id, third.id)
        assertEquals(HttpStatusCode.Forbidden, reshare.status)
        assertEquals("Only someone who can read this document in their own right may share it", reshare.detail())

        val audit = auditor.client.plan(w.plan.id)
        assertEquals(HttpStatusCode.OK, audit.status)
        assertFalse(audit.body<SuccessionPlanResponse>().canShare)
        assertEquals(HttpStatusCode.Forbidden, auditor.client.sharePlan(w.plan.id, third.id).status)
        assertEquals(HttpStatusCode.Created, w.owner.client.sharePlan(w.plan.id, auditor.id).status)
    }

    @Test
    fun `succession - the seat person and a candidate gain nothing from their status, a share is the only way in`() =
        runBlockingApp {
            val w = planWorld()
            // Subject/candidate status grants no access — until the owner deliberately shares ("whoever I want").
            assertEquals(HttpStatusCode.Forbidden, w.seat.client.plan(w.plan.id).status)
            assertEquals(HttpStatusCode.Forbidden, w.candidate.client.plan(w.plan.id).status)
            assertEquals(HttpStatusCode.Forbidden, w.seat.client.get("/api/v1/succession-plans/${w.plan.id}/events").status)

            w.owner.client.sharePlanId(w.plan.id, w.seat.id)
            val seen = w.seat.client.plan(w.plan.id)
            assertEquals(HttpStatusCode.OK, seen.status)
            assertEquals(w.owner.name, seen.body<SuccessionPlanResponse>().sharedBy)
            // The candidate is still shut out by the seat person's share (no re-share).
            assertEquals(HttpStatusCode.Forbidden, w.seat.client.sharePlan(w.plan.id, w.candidate.id).status)
            assertEquals(HttpStatusCode.Forbidden, w.candidate.client.plan(w.plan.id).status)
            w.owner.client.sharePlanId(w.plan.id, w.candidate.id)
            assertEquals(HttpStatusCode.OK, w.candidate.client.plan(w.plan.id).status)
        }

    @Test
    fun `succession - a CLOSED plan stays readable and shareable, a chain manager's share lapses when they leave the chain`() =
        runBlockingApp {
            val w = planWorld()
            val sharee = person("sharee")
            val closedSharee = person("sharee-closed")
            val id = w.manager.client.sharePlanId(w.plan.id, sharee.id)
            assertEquals(HttpStatusCode.OK, sharee.client.plan(w.plan.id).status)

            // CLOSED is terminal and read-only — the read guard has no status nuance.
            assertEquals(HttpStatusCode.NoContent, w.owner.client.post("/api/v1/succession-plans/${w.plan.id}/close").status)
            assertEquals(HttpStatusCode.OK, sharee.client.plan(w.plan.id).status)
            assertEquals(HttpStatusCode.Created, w.owner.client.sharePlan(w.plan.id, closedSharee.id).status)
            assertEquals(HttpStatusCode.OK, closedSharee.client.plan(w.plan.id).status)

            TestServices.teams.removeMember(w.teamId, w.owner.id)
            val lapsed = sharee.client.plan(w.plan.id)
            assertEquals(HttpStatusCode.Forbidden, lapsed.status)
            assertEquals("The person who shared this no longer has access to it", lapsed.detail())
            assertEquals(HttpStatusCode.Forbidden, sharee.client.get("/api/v1/succession-plans/${w.plan.id}/events").status)
            // The owner's own share is unaffected by the chain change.
            assertEquals(HttpStatusCode.OK, closedSharee.client.plan(w.plan.id).status)

            // The OWNER (the author, not the seat person) lists and withdraws the chain manager's share.
            val all = w.owner.client.get("/api/v1/shares") {
                parameter("view", "document")
                parameter("resourceType", "SUCCESSION_PLAN")
                parameter("resourceId", w.plan.id.toString())
            }.body<SharePageResponse>()
            // The owner sees every share of the plan: the chain manager's and their own.
            assertEquals(2L, all.total)
            assertTrue(id in all.items.map { it.id })
            assertEquals(HttpStatusCode.NoContent, w.owner.client.post("/api/v1/shares/$id/withdraw").status)
        }

    @Test
    fun `succession - the notifications are content-free - the sharer's name and nothing else`() = runBlockingApp {
        val w = planWorld()
        val sharee = person("sharee")
        // An end date is given, and still must not ride the content-free succession notice.
        val id = w.manager.client.sharePlanId(w.plan.id, sharee.id, expiresOn = serverToday().plusDays(30).toString())

        val shared = sharee.client.notifications().single { it.type == NotificationType.SUCCESSION_PLAN_SHARED }
        assertEquals(setOf("sharer"), shared.params.keys)
        assertEquals(w.manager.name, shared.params["sharer"])
        assertEquals("/succession/${w.plan.id}/view", shared.link)

        assertEquals(HttpStatusCode.NoContent, w.owner.client.post("/api/v1/shares/$id/withdraw").status)
        val toSharee = sharee.client.notifications().single { it.type == NotificationType.SUCCESSION_PLAN_SHARE_WITHDRAWN }
        assertEquals(setOf("sharer"), toSharee.params.keys)
        assertNull(toSharee.link)
        val toSharer = w.manager.client.notifications().single { it.type == NotificationType.SUCCESSION_PLAN_SHARE_WITHDRAWN }
        assertEquals(setOf("sharer", "self"), toSharer.params.keys)
        assertEquals("/shares?tab=byMe", toSharer.link)

        // Nothing else about succession ever reaches anyone: the seat person and the candidate (who are
        // not sharees) have no succession notification at all.
        for (bystander in listOf(w.seat, w.candidate)) {
            assertTrue(
                bystander.client.notifications().none { it.type.name.startsWith("SUCCESSION_PLAN_") },
                "${bystander.name} must hear nothing about the plan",
            )
        }
    }

    @Test
    fun `succession - a sharee's history hides goal-link edits, the owner's keeps them`() = runBlockingApp {
        val w = planWorld()
        val sharee = person("sharee")
        w.owner.client.sharePlanId(w.plan.id, sharee.id)
        val goalId = w.nomination.goals.single().id
        val base = "/api/v1/succession-plans/${w.plan.id}/nominations/${w.nomination.id}"
        suspend fun edit(readiness: SuccessorReadiness, goals: List<UInt>) = w.owner.client.put(base) {
            contentType(ContentType.Application.Json)
            setBody(
                SuccessionNominationRequest(
                    candidateId = w.candidate.id,
                    readiness = readiness,
                    nominationType = NominationType.PRIMARY,
                    competencyGaps = w.nomination.competencyGaps,
                    awareness = CandidateAwareness.CONFIDENTIAL,
                    goalIds = goals,
                ),
            )
        }
        // One edit touching ONLY the goal links, one touching readiness AND the goal links.
        assertEquals(HttpStatusCode.NoContent, edit(SuccessorReadiness.READY_SOON, emptyList()).status)
        assertEquals(HttpStatusCode.NoContent, edit(SuccessorReadiness.READY_NOW, listOf(goalId)).status)

        suspend fun changedLists(client: HttpClient) = client.get("/api/v1/succession-plans/${w.plan.id}/events")
            .body<SuccessionPlanEventListResponse>().items
            .filter { it.type == SuccessionEventType.NOMINATION_UPDATED }
            .map { it.params["changed"] }
        // The owner sees the full history (newest first) …
        assertEquals(listOf("readiness,goals", "goals"), changedLists(w.owner.client))
        // … the sharee cannot infer goal links: the goals-only update is gone, the mixed one lost `goals`.
        assertEquals(listOf("readiness"), changedLists(sharee.client))
    }

    @Test
    fun `succession - the label snapshot is stable after a plan edit`() = runBlockingApp {
        val w = planWorld()
        val sharee = person("sharee")
        w.owner.client.sharePlanId(w.plan.id, sharee.id)
        val before = sharee.client.get("/api/v1/shares").body<SharePageResponse>().items.single().details
        val edit = w.owner.client.put("/api/v1/succession-plans/${w.plan.id}") {
            contentType(ContentType.Application.Json)
            setBody(SuccessionPlanUpdate(RoleCriticality.CORE, RetentionRisk.LOW, listOf("rewritten"), 3))
        }
        assertEquals(HttpStatusCode.NoContent, edit.status)
        assertEquals(before, sharee.client.get("/api/v1/shares").body<SharePageResponse>().items.single().details)
        assertEquals(setOf("person", "owner"), before?.keys)
    }

    // ── Team KPIs ────────────────────────────────────────────────────────────────────────────

    private class KpiWorld(
        val manager: Person,
        val member: Person,
        val otherMember: Person,
        val grand: Person,
        val teamId: UInt,
        val grandTeamId: UInt,
        val teamName: String,
        val kpi: TeamKpiResponse,
    )

    private suspend fun HttpClient.shareKpi(kpiId: UInt, shareeId: UInt): HttpResponse =
        post("/api/v1/shares") {
            contentType(ContentType.Application.Json)
            setBody(ShareRequest(ShareableResourceType.TEAM_KPI, kpiId, shareeId, null))
        }

    private suspend fun HttpClient.shareKpiId(kpiId: UInt, shareeId: UInt): UInt {
        val response = shareKpi(kpiId, shareeId)
        assertEquals(HttpStatusCode.Created, response.status)
        return response.body<ShareResponse>().id
    }

    private suspend fun HttpClient.kpi(id: UInt) = get("/api/v1/team-kpis/$id")

    private fun kpiDefinition(title: String) = TeamKpiDefinitionUpdate(
        title = title,
        description = "A private description",
        type = TeamKpiType.NUMBER,
        targetValue = 10.0,
    )

    /**
     * M manages team T (members m1, m2), G manages M. M creates a KPI for T — activated when
     * [activate] (with one recorded data point), otherwise a DRAFT private to the manager + chain.
     */
    private suspend fun ApplicationTestBuilder.kpiWorld(
        activate: Boolean = true,
        managerRoles: Set<UserRole> = emptySet(),
    ): KpiWorld {
        val manager = person("manager", roles = managerRoles)
        val member = person("member")
        val otherMember = person("other-member")
        val grand = person("grand-manager")
        val teamName = "Squad-${manager.id}"
        val teamId = TestServices.teams.create(Team(teamName, manager.id, listOf(member.id, otherMember.id)))
        val grandTeamId = TestServices.teams.create(Team("Leads-${grand.id}", grand.id, listOf(manager.id)))
        val created = manager.client.post("/api/v1/team-kpis") {
            contentType(ContentType.Application.Json)
            setBody(
                TeamKpiCreateRequest(
                    teamId = teamId,
                    title = "Original KPI title",
                    description = "A private description",
                    type = TeamKpiType.NUMBER,
                    targetValue = 10.0,
                ),
            )
        }
        assertEquals(HttpStatusCode.Created, created.status)
        val kpi = created.body<TeamKpiResponse>()
        assertTrue(kpi.canShare, "the creating manager reads their own KPI")
        if (activate) {
            assertEquals(HttpStatusCode.NoContent, manager.client.post("/api/v1/team-kpis/${kpi.id}/activate").status)
            val value = manager.client.post("/api/v1/team-kpis/${kpi.id}/values") {
                contentType(ContentType.Application.Json)
                setBody(TeamKpiValueWrite(date = serverToday().minusDays(1).toString(), value = 4.0))
            }
            assertEquals(HttpStatusCode.Created, value.status)
        }
        return KpiWorld(manager, member, otherMember, grand, teamId, grandTeamId, teamName, kpi)
    }

    @Test
    fun `team KPIs - a sharee reads the KPI, its data points and events, with no management or recording rights`() =
        runBlockingApp {
            val w = kpiWorld()
            val sharee = person("sharee")
            assertEquals(HttpStatusCode.Forbidden, sharee.client.kpi(w.kpi.id).status)

            w.manager.client.shareKpiId(w.kpi.id, sharee.id)
            val body = sharee.client.kpi(w.kpi.id).body<TeamKpiResponse>()
            assertEquals("A private description", body.description)
            assertEquals(4.0, body.currentValue)
            assertEquals(w.manager.name, body.sharedBy)
            assertFalse(body.canShare)
            assertFalse(body.canManage)
            assertFalse(body.canRecordValues)
            val values = sharee.client.get("/api/v1/team-kpis/${w.kpi.id}/values")
            assertEquals(HttpStatusCode.OK, values.status)
            assertEquals(1, values.body<TeamKpiValueListResponse>().items.size)
            val events = sharee.client.get("/api/v1/team-kpis/${w.kpi.id}/events")
            assertEquals(HttpStatusCode.OK, events.status)
            assertTrue(events.body<TeamKpiEventListResponse>().items.isNotEmpty())

            val own = w.manager.client.kpi(w.kpi.id).body<TeamKpiResponse>()
            assertTrue(own.canShare && own.canManage)
            val asMember = w.member.client.kpi(w.kpi.id).body<TeamKpiResponse>()
            assertTrue(asMember.canShare, "an ACTIVE KPI is readable — and shareable — by a team member")
            assertFalse(asMember.canManage)
            assertTrue(asMember.canRecordValues)
            assertTrue(w.grand.client.kpi(w.kpi.id).body<TeamKpiResponse>().canShare)

            val row = sharee.client.get("/api/v1/shares").body<SharePageResponse>().items.single()
            assertEquals(mapOf("title" to "Original KPI title", "team" to w.teamName), row.details)
            assertEquals("/team-kpis/${w.kpi.id}/view", row.link)
        }

    @Test
    fun `team KPIs - a pure sharee can write nothing - definition, lifecycle and data points alike`() = runBlockingApp {
        val w = kpiWorld()
        val sharee = person("sharee")
        w.manager.client.shareKpiId(w.kpi.id, sharee.id)
        val valueId = w.manager.client.get("/api/v1/team-kpis/${w.kpi.id}/values")
            .body<TeamKpiValueListResponse>().items.single().id
        val c = sharee.client
        val base = "/api/v1/team-kpis/${w.kpi.id}"
        val put = c.put(base) {
            contentType(ContentType.Application.Json)
            setBody(kpiDefinition("tampered"))
        }
        assertEquals(HttpStatusCode.Forbidden, put.status)
        for (action in listOf("activate", "deactivate", "reopen")) {
            assertEquals(HttpStatusCode.Forbidden, c.post("$base/$action").status, action)
        }
        assertEquals(HttpStatusCode.Forbidden, c.delete(base).status)
        // The data-point rights (manager + chain + CURRENT members) are not a share's to give.
        val write = TeamKpiValueWrite(date = serverToday().minusDays(2).toString(), value = 99.0)
        val post = c.post("$base/values") {
            contentType(ContentType.Application.Json)
            setBody(write)
        }
        assertEquals(HttpStatusCode.Forbidden, post.status)
        val putValue = c.put("$base/values/$valueId") {
            contentType(ContentType.Application.Json)
            setBody(write)
        }
        assertEquals(HttpStatusCode.Forbidden, putValue.status)
        assertEquals(HttpStatusCode.Forbidden, c.delete("$base/values/$valueId").status)
        val after = w.manager.client.kpi(w.kpi.id).body<TeamKpiResponse>()
        assertEquals("Original KPI title", after.title)
        assertEquals(4.0, after.currentValue)
    }

    @Test
    fun `team KPIs - no re-sharing, no HR-auditor sharing, an HR manager can share`() = runBlockingApp {
        val w = kpiWorld(managerRoles = setOf(UserRole.HR))
        val sharee = person("sharee")
        val third = person("third")
        val auditor = person("auditor", roles = setOf(UserRole.HR))
        assertTrue(w.manager.client.kpi(w.kpi.id).body<TeamKpiResponse>().canShare)
        w.manager.client.shareKpiId(w.kpi.id, sharee.id)

        val reshare = sharee.client.shareKpi(w.kpi.id, third.id)
        assertEquals(HttpStatusCode.Forbidden, reshare.status)
        assertEquals("Only someone who can read this document in their own right may share it", reshare.detail())

        // The HR auditor reads every KPI (the org-wide view=all auditor role) — not as an own-right reader.
        val audit = auditor.client.kpi(w.kpi.id)
        assertEquals(HttpStatusCode.OK, audit.status)
        assertFalse(audit.body<TeamKpiResponse>().canShare)
        assertEquals(HttpStatusCode.Forbidden, auditor.client.shareKpi(w.kpi.id, third.id).status)
        assertEquals(HttpStatusCode.Created, w.manager.client.shareKpi(w.kpi.id, auditor.id).status)
    }

    @Test
    fun `team KPIs - a member shares only a non-DRAFT KPI, and the share lapses on DRAFT, on leaving the team, and on reassignment`() =
        runBlockingApp {
            val w = kpiWorld(activate = false)
            val sharee = person("sharee")
            val viaManager = person("sharee-manager")
            // A DRAFT stays private to the manager and the chain: a member neither reads nor shares it.
            assertEquals(HttpStatusCode.Forbidden, w.member.client.kpi(w.kpi.id).status)
            assertEquals(HttpStatusCode.Forbidden, w.member.client.shareKpi(w.kpi.id, sharee.id).status)
            assertEquals(HttpStatusCode.NoContent, w.manager.client.post("/api/v1/team-kpis/${w.kpi.id}/activate").status)

            // ACTIVE: the member shares; back to DRAFT → their share lapses (the manager's keeps working).
            w.member.client.shareKpiId(w.kpi.id, sharee.id)
            w.manager.client.shareKpiId(w.kpi.id, viaManager.id)
            assertEquals(HttpStatusCode.OK, sharee.client.kpi(w.kpi.id).status)
            assertEquals(HttpStatusCode.NoContent, w.manager.client.post("/api/v1/team-kpis/${w.kpi.id}/deactivate").status)
            val lapsed = sharee.client.kpi(w.kpi.id)
            assertEquals(HttpStatusCode.Forbidden, lapsed.status)
            assertEquals("The person who shared this no longer has access to it", lapsed.detail())
            assertEquals(HttpStatusCode.Forbidden, sharee.client.get("/api/v1/team-kpis/${w.kpi.id}/values").status)
            assertEquals(HttpStatusCode.OK, viaManager.client.kpi(w.kpi.id).status)

            // Re-activated, then the member LEAVES the team: their share lapses.
            assertEquals(HttpStatusCode.NoContent, w.manager.client.post("/api/v1/team-kpis/${w.kpi.id}/activate").status)
            assertEquals(HttpStatusCode.OK, sharee.client.kpi(w.kpi.id).status)
            TestServices.teams.removeMember(w.teamId, w.member.id)
            assertEquals(HttpStatusCode.Forbidden, sharee.client.kpi(w.kpi.id).status)
            TestServices.teams.addMember(w.teamId, w.member.id)
            assertEquals(HttpStatusCode.OK, sharee.client.kpi(w.kpi.id).status)

            // Manager reassignment: the OLD manager is no longer the team's manager — nor in the chain
            // above the new one — so the share they made lapses.
            val newManager = person("new-manager")
            assertEquals(
                1,
                TestServices.teams.update(w.teamId, Team(w.teamName, newManager.id, listOf(w.member.id, w.otherMember.id))),
            )
            val oldManagerLapse = viaManager.client.kpi(w.kpi.id)
            assertEquals(HttpStatusCode.Forbidden, oldManagerLapse.status)
            assertEquals("The person who shared this no longer has access to it", oldManagerLapse.detail())
            // The member's share is unaffected by the reassignment (they are still a member).
            assertEquals(HttpStatusCode.OK, sharee.client.kpi(w.kpi.id).status)
        }

    @Test
    fun `team KPIs - a member reads a DRAFT through the manager's share with no rights, the ACTIVE KPI in their own right`() =
        runBlockingApp {
            val w = kpiWorld(activate = false)
            // The DRAFT is invisible to the member in their own right — the manager's share is their way in.
            assertEquals(HttpStatusCode.Forbidden, w.member.client.kpi(w.kpi.id).status)
            w.manager.client.shareKpiId(w.kpi.id, w.member.id)
            val viaShare = w.member.client.kpi(w.kpi.id).body<TeamKpiResponse>()
            assertEquals(w.manager.name, viaShare.sharedBy)
            assertFalse(viaShare.canManage)
            assertFalse(viaShare.canRecordValues, "a share confers read only — nothing is recorded on a DRAFT")
            assertFalse(viaShare.canShare)

            // ACTIVE: the member's ordinary own-right read takes over (no banner, their member rights).
            assertEquals(HttpStatusCode.NoContent, w.manager.client.post("/api/v1/team-kpis/${w.kpi.id}/activate").status)
            val own = w.member.client.kpi(w.kpi.id).body<TeamKpiResponse>()
            assertNull(own.sharedBy)
            assertTrue(own.canRecordValues)
            assertFalse(own.canManage)
            assertTrue(own.canShare)
        }

    @Test
    fun `team KPIs - after a reassignment an old manager still in the chain above the new one keeps a working share`() =
        runBlockingApp {
            val w = kpiWorld()
            val sharee = person("sharee")
            val newManager = person("new-manager")
            // The OLD manager manages the new manager (a team of their own): they stay in the chain above.
            TestServices.teams.create(Team("Over-${w.manager.id}", w.manager.id, listOf(newManager.id)))
            w.manager.client.shareKpiId(w.kpi.id, sharee.id)
            assertEquals(HttpStatusCode.OK, sharee.client.kpi(w.kpi.id).status)

            assertEquals(
                1,
                TestServices.teams.update(w.teamId, Team(w.teamName, newManager.id, listOf(w.member.id, w.otherMember.id))),
            )
            // The old manager is no longer the team's manager, but they read as the chain above the new one.
            assertEquals(HttpStatusCode.OK, sharee.client.kpi(w.kpi.id).status)
            assertTrue(w.manager.client.kpi(w.kpi.id).body<TeamKpiResponse>().canShare)
        }

    @Test
    fun `team KPIs - a chain manager's share lapses when they leave the chain`() = runBlockingApp {
        val w = kpiWorld()
        val sharee = person("sharee")
        w.grand.client.shareKpiId(w.kpi.id, sharee.id)
        assertEquals(HttpStatusCode.OK, sharee.client.kpi(w.kpi.id).status)
        TestServices.teams.removeMember(w.grandTeamId, w.manager.id)
        val lapsed = sharee.client.kpi(w.kpi.id)
        assertEquals(HttpStatusCode.Forbidden, lapsed.status)
        assertEquals("The person who shared this no longer has access to it", lapsed.detail())
    }

    @Test
    fun `team KPIs - the manage predicate is the author - manager and chain list and withdraw a member's share, notifications and links`() =
        runBlockingApp {
            val w = kpiWorld()
            val sharee = person("sharee")
            val id = w.member.client.shareKpiId(w.kpi.id, sharee.id)

            val shared = sharee.client.notifications().single { it.type == NotificationType.TEAM_KPI_SHARED }
            assertEquals(mapOf("sharer" to w.member.name), shared.params)
            assertEquals("/team-kpis/${w.kpi.id}/view", shared.link)

            // The chain manager (above the team's manager) is an author too; the plain member is not.
            suspend fun documentView(client: HttpClient) = client.get("/api/v1/shares") {
                parameter("view", "document")
                parameter("resourceType", "TEAM_KPI")
                parameter("resourceId", w.kpi.id.toString())
            }.body<SharePageResponse>()
            assertEquals(listOf(id), documentView(w.grand.client).items.map { it.id })
            assertEquals(listOf(id), documentView(w.member.client).items.map { it.id })
            assertEquals(0L, documentView(w.otherMember.client).total)
            // The DIRECT manager is an author as well: lists every share of the KPI and withdraws one.
            val sharee2 = person("sharee-2")
            val id2 = w.otherMember.client.shareKpiId(w.kpi.id, sharee2.id)
            assertEquals(setOf(id, id2), documentView(w.manager.client).items.map { it.id }.toSet())
            assertEquals(HttpStatusCode.NoContent, w.manager.client.post("/api/v1/shares/$id2/withdraw").status)
            assertEquals(HttpStatusCode.Forbidden, sharee2.client.kpi(w.kpi.id).status)
            assertEquals(HttpStatusCode.NoContent, w.grand.client.post("/api/v1/shares/$id/withdraw").status)
            assertEquals(HttpStatusCode.Forbidden, sharee.client.kpi(w.kpi.id).status)

            val toSharee = sharee.client.notifications().single { it.type == NotificationType.TEAM_KPI_SHARE_WITHDRAWN }
            assertEquals(
                mapOf("sharer" to w.member.name, "sharee" to sharee.name, "actor" to w.grand.name),
                toSharee.params,
            )
            assertNull(toSharee.link)
            val toSharer = w.member.client.notifications().single { it.type == NotificationType.TEAM_KPI_SHARE_WITHDRAWN }
            assertEquals("sharer", toSharer.params["self"])
            assertEquals("/shares?tab=byMe", toSharer.link)
        }

    @Test
    fun `team KPIs - the full label snapshot is stable after a retitle`() = runBlockingApp {
        val w = kpiWorld()
        val sharee = person("sharee")
        w.manager.client.shareKpiId(w.kpi.id, sharee.id)
        val before = sharee.client.get("/api/v1/shares").body<SharePageResponse>().items.single().details
        // Definition edits are DRAFT-only: back to DRAFT, then retitle.
        assertEquals(HttpStatusCode.NoContent, w.manager.client.post("/api/v1/team-kpis/${w.kpi.id}/deactivate").status)
        val edit = w.manager.client.put("/api/v1/team-kpis/${w.kpi.id}") {
            contentType(ContentType.Application.Json)
            setBody(kpiDefinition("Retitled afterwards"))
        }
        assertEquals(HttpStatusCode.NoContent, edit.status)
        assertEquals("Retitled afterwards", w.manager.client.kpi(w.kpi.id).body<TeamKpiResponse>().title)
        assertEquals(before, sharee.client.get("/api/v1/shares").body<SharePageResponse>().items.single().details)
        assertEquals("Original KPI title", before?.get("title"))
    }

    // ── Days-off calendars ───────────────────────────────────────────────────────────────────
    // The shared unit is a PERSON's calendar (the resource id is the person's user id). Own right =
    // the person themselves or a manager in their transitive chain; teammates and the HR auditor
    // alone cannot share; the person is the author (sees and withdraws every share of their calendar).

    private class CalendarWorld(
        val person: Person,
        val manager: Person,
        val grand: Person,
        val teammate: Person,
        val managerTeamId: UInt,
    )

    private suspend fun HttpClient.shareCalendar(personId: UInt, shareeId: UInt, expiresOn: String? = null): HttpResponse =
        post("/api/v1/shares") {
            contentType(ContentType.Application.Json)
            setBody(ShareRequest(ShareableResourceType.DAYS_OFF_CALENDAR, personId, shareeId, expiresOn))
        }

    private suspend fun HttpClient.shareCalendarId(personId: UInt, shareeId: UInt, expiresOn: String? = null): UInt {
        val response = shareCalendar(personId, shareeId, expiresOn)
        assertEquals(HttpStatusCode.Created, response.status)
        return response.body<ShareResponse>().id
    }

    private suspend fun HttpClient.calendarDocumentShares(personId: UInt): HttpResponse = get("/api/v1/shares") {
        parameter("view", "document")
        parameter("resourceType", "DAYS_OFF_CALENDAR")
        parameter("resourceId", personId.toString())
    }

    /**
     * P (the person) is on M's team (M = direct manager), M is on G's team (G = skip-level), T is P's
     * teammate (shares the team, so sees P's absences by calendar parity, but may not share).
     */
    private suspend fun ApplicationTestBuilder.calendarWorld(personRoles: Set<UserRole> = emptySet()): CalendarWorld {
        val person = person("cal-person", roles = personRoles)
        val manager = person("cal-manager")
        val grand = person("cal-grand")
        val teammate = person("cal-mate")
        val managerTeam = TestServices.teams.create(Team("CalSquad-${manager.id}", manager.id, listOf(person.id, teammate.id)))
        TestServices.teams.create(Team("CalDept-${grand.id}", grand.id, listOf(manager.id)))
        return CalendarWorld(person, manager, grand, teammate, managerTeam)
    }

    @Test
    fun `days-off calendars - the person shares their own, a direct manager and a skip-level manager share a report's`() =
        runBlockingApp {
            val w = calendarWorld()
            val sharee = person("sharee")
            val own = w.person.client.shareCalendar(w.person.id, sharee.id, expiresOn = serverToday().plusDays(30).toString())
            assertEquals(HttpStatusCode.Created, own.status)
            val ownShare = own.body<ShareResponse>()
            assertEquals(ShareableResourceType.DAYS_OFF_CALENDAR, ownShare.resourceType)
            assertEquals(w.person.id, ownShare.resourceId)
            assertEquals(mapOf("person" to w.person.name), ownShare.details)
            assertEquals("/days-off?tab=calendar&scope=shared&user=${w.person.id}", ownShare.link)

            // M (direct) and G (skip-level) share the report's calendar; so does the person to a second sharee.
            val other = person("sharee2")
            assertEquals(HttpStatusCode.Created, w.manager.client.shareCalendar(w.person.id, other.id).status)
            assertEquals(HttpStatusCode.Created, w.grand.client.shareCalendar(w.person.id, sharee.id).status)
            // A manager shares their OWN calendar too (self is own right), but not the unrelated person's.
            assertEquals(HttpStatusCode.Created, w.manager.client.shareCalendar(w.manager.id, sharee.id).status)
            assertEquals(HttpStatusCode.Forbidden, w.manager.client.shareCalendar(w.grand.id, sharee.id).status)
        }

    @Test
    fun `days-off calendars - a teammate, a stranger and an ADMIN without the relationship cannot share - the own-right reason`() =
        runBlockingApp {
            val w = calendarWorld()
            val sharee = person("sharee")
            val stranger = person("stranger")
            val admin = person("admin", roles = setOf(UserRole.ADMIN))
            listOf(w.teammate, stranger, admin).forEach { who ->
                val denied = who.client.shareCalendar(w.person.id, sharee.id)
                assertEquals(HttpStatusCode.Forbidden, denied.status, who.name)
                assertEquals("Only someone who can read this document in their own right may share it", denied.detail())
            }
            // The teammate lists no shares of the calendar either (not an own-right reader, not the author).
            assertEquals(HttpStatusCode.Forbidden, w.teammate.client.calendarDocumentShares(w.person.id).status)
        }

    @Test
    fun `days-off calendars - no re-sharing, no HR-auditor sharing, an HR user in the chain shares in their own right`() =
        runBlockingApp {
            val w = calendarWorld()
            val sharee = person("sharee")
            val third = person("third")
            val auditor = person("auditor", roles = setOf(UserRole.HR))
            w.manager.client.shareCalendarId(w.person.id, sharee.id)

            val reshare = sharee.client.shareCalendar(w.person.id, third.id)
            assertEquals(HttpStatusCode.Forbidden, reshare.status)
            assertEquals("Only someone who can read this document in their own right may share it", reshare.detail())
            // An HR auditor with no relationship has the read (audit) right only — not shareable. HR can RECEIVE a share.
            assertEquals(HttpStatusCode.Forbidden, auditor.client.shareCalendar(w.person.id, third.id).status)
            assertEquals(HttpStatusCode.Created, w.person.client.shareCalendar(w.person.id, auditor.id).status)

            // An HR user who is also the person's manager holds the right as a manager.
            val hrManager = person("hr-manager", roles = setOf(UserRole.HR))
            val report = person("hr-report")
            TestServices.teams.create(Team("HrSquad-${hrManager.id}", hrManager.id, listOf(report.id)))
            assertEquals(HttpStatusCode.Created, hrManager.client.shareCalendar(report.id, third.id).status)
        }

    @Test
    fun `days-off calendars - the person is the author - lists and withdraws a manager's share, a non-author chain manager cannot`() =
        runBlockingApp {
            val w = calendarWorld()
            val sharee = person("sharee")
            val managerShare = w.manager.client.shareCalendarId(w.person.id, sharee.id)
            val grandSharee = person("sharee2")
            val grandShare = w.grand.client.shareCalendarId(w.person.id, grandSharee.id)

            // The person sees BOTH shares of their calendar; a chain manager who is no author sees only their own.
            val all = w.person.client.calendarDocumentShares(w.person.id).body<SharePageResponse>()
            assertEquals(setOf(managerShare, grandShare), all.items.map { it.id }.toSet())
            val managerView = w.manager.client.calendarDocumentShares(w.person.id).body<SharePageResponse>()
            assertEquals(listOf(managerShare), managerView.items.map { it.id })

            // G did not author the calendar: cannot read or withdraw M's share.
            assertEquals(HttpStatusCode.Forbidden, w.grand.client.get("/api/v1/shares/$managerShare").status)
            assertEquals(HttpStatusCode.Forbidden, w.grand.client.post("/api/v1/shares/$managerShare/withdraw").status)
            // The person withdraws M's share: sharee and sharer are both told, the sharer's copy flagged.
            assertEquals(HttpStatusCode.NoContent, w.person.client.post("/api/v1/shares/$managerShare/withdraw").status)
            val toSharee = sharee.client.notifications().single { it.type == NotificationType.DAYS_OFF_CALENDAR_SHARE_WITHDRAWN }
            assertEquals(
                mapOf(
                    "sharer" to w.manager.name, "sharee" to sharee.name, "actor" to w.person.name, "person" to w.person.name,
                ),
                toSharee.params,
            )
            assertNull(toSharee.link)
            val toSharer = w.manager.client.notifications().single { it.type == NotificationType.DAYS_OFF_CALENDAR_SHARE_WITHDRAWN }
            assertEquals("sharer", toSharer.params["self"])
            assertEquals(w.person.name, toSharer.params["person"])
            assertEquals("/shares?tab=byMe", toSharer.link)
        }

    @Test
    fun `days-off calendars - own-right lapse - the manager leaves the chain, holdsOwnRight turns false and the share is told apart`() =
        runBlockingApp {
            val w = calendarWorld()
            val sharee = person("sharee")
            w.manager.client.shareCalendarId(w.person.id, sharee.id)
            val access = application.attributes[ShareAccessKey]
            val adapter = DaysOffCalendarShareable(TestServices.users, TestDaysOff.service)
            val principal = CallerPrincipal(userId = w.manager.id, email = w.manager.email, roles = emptySet())
            suspend fun ownRight(): Boolean = access.holdsOwnRight(principal, ShareableResourceType.DAYS_OFF_CALENDAR) {
                adapter.guard(it, checkNotNull(adapter.read(w.person.id)))
            }
            assertTrue(ownRight())
            // Moving the person out of M's team ends M's own right (the lapse rule's input) ...
            TestServices.teams.removeMember(w.managerTeamId, w.person.id)
            assertFalse(ownRight())
            // ... and M can no longer create a fresh share of that calendar, while the person's own right stands.
            assertEquals(HttpStatusCode.Forbidden, w.manager.client.shareCalendar(w.person.id, person("late").id).status)
            assertEquals(HttpStatusCode.Created, w.person.client.shareCalendar(w.person.id, person("late2").id).status)
            // Back in the team: restored.
            TestServices.teams.addMember(w.managerTeamId, w.person.id)
            assertTrue(ownRight())
        }

    @Test
    fun `days-off calendars - a deactivated person stays shareable, a soft-deleted one is 404`() = runBlockingApp {
        val w = calendarWorld()
        val sharee = person("sharee")
        assertEquals(1, TestServices.users.setDeactivated(w.person.id, true))
        assertEquals(HttpStatusCode.Created, w.manager.client.shareCalendar(w.person.id, sharee.id).status)

        val gone = person("gone")
        TestServices.teams.create(Team("GoneSquad-${w.manager.id}", w.manager.id, listOf(gone.id)))
        assertEquals(1, TestServices.users.delete(gone.id))
        val missing = w.manager.client.shareCalendar(gone.id, sharee.id)
        assertEquals(HttpStatusCode.NotFound, missing.status)
        assertEquals("Document not found", missing.detail())
    }

    @Test
    fun `days-off calendars - the notifications name the person, carry own for a self-share, expiresOn and the sharee's scope link`() =
        runBlockingApp {
            val w = calendarWorld()
            val sharee = person("sharee")
            val until = serverToday().plusDays(10).toString()
            w.manager.client.shareCalendarId(w.person.id, sharee.id, expiresOn = until)
            val viaManager = sharee.client.notifications().single { it.type == NotificationType.DAYS_OFF_CALENDAR_SHARED }
            assertEquals(
                mapOf("sharer" to w.manager.name, "person" to w.person.name, "expiresOn" to until),
                viaManager.params,
            )
            assertEquals("/days-off?tab=calendar&scope=shared&user=${w.person.id}", viaManager.link)

            val second = person("sharee2")
            w.person.client.shareCalendarId(w.person.id, second.id)
            val own = second.client.notifications().single { it.type == NotificationType.DAYS_OFF_CALENDAR_SHARED }
            assertEquals(mapOf("sharer" to w.person.name, "person" to w.person.name, "self" to "own"), own.params)
            assertEquals(viaManager.link, own.link)

            // The person's own share, withdrawn by them: ONE copy, the sharee's, flagged own, no link.
            val id = second.client.get("/api/v1/shares").body<SharePageResponse>().items.single().id
            assertEquals(HttpStatusCode.NoContent, w.person.client.post("/api/v1/shares/$id/withdraw").status)
            val withdrawn = second.client.notifications().single { it.type == NotificationType.DAYS_OFF_CALENDAR_SHARE_WITHDRAWN }
            assertEquals("own", withdrawn.params["self"])
            assertEquals(w.person.name, withdrawn.params["person"])
            assertNull(withdrawn.link)
            assertTrue(w.person.client.notifications().none { it.type == NotificationType.DAYS_OFF_CALENDAR_SHARE_WITHDRAWN })
        }

    @Test
    fun `days-off calendars - the details snapshot survives a rename`() = runBlockingApp {
        val w = calendarWorld()
        val sharee = person("sharee")
        w.manager.client.shareCalendarId(w.person.id, sharee.id)
        val before = sharee.client.get("/api/v1/shares").body<SharePageResponse>().items.single().details
        assertEquals(mapOf("person" to w.person.name), before)
        val existing = checkNotNull(TestServices.users.read(w.person.id))
        assertEquals(1, TestServices.users.update(w.person.id, existing.copy(name = "Renamed ${w.person.id}")))
        assertEquals(before, sharee.client.get("/api/v1/shares").body<SharePageResponse>().items.single().details)
        // A fresh share after the rename snapshots the new name.
        val late = person("late")
        w.person.client.shareCalendarId(w.person.id, late.id)
        assertEquals(
            mapOf("person" to "Renamed ${w.person.id}"),
            late.client.get("/api/v1/shares").body<SharePageResponse>().items.single().details,
        )
    }

    @Test
    fun `days-off calendars - sharing needs the caller's DAYS_OFF flag, an inert share for a flag-off sharee still exists`() =
        runBlockingApp {
            val w = calendarWorld()
            val off = person("flag-off", disabled = setOf(Feature.DAYS_OFF))
            assertEquals(HttpStatusCode.Forbidden, off.client.shareCalendar(off.id, w.person.id).status)
            // The person may share WITH someone whose flag is off: the share exists, hidden from their list.
            assertEquals(HttpStatusCode.Created, w.person.client.shareCalendar(w.person.id, off.id).status)
            assertEquals(0, off.client.get("/api/v1/shares").body<SharePageResponse>().total)
        }

    /** `testApplication` with the container started; the body is the test. */
    private fun runBlockingApp(block: suspend ApplicationTestBuilder.() -> Unit) = testApplication {
        usePostgresTestcontainer()
        block()
    }
}
