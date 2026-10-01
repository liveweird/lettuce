package ch.nokillswit

import ch.nokillswit.authz.CallerPrincipal
import ch.nokillswit.authz.ForbiddenException
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
import ch.nokillswit.notifications.NotificationPageResponse
import ch.nokillswit.notifications.NotificationResponse
import ch.nokillswit.notifications.NotificationType
import ch.nokillswit.plugins.ProblemDetail
import ch.nokillswit.sharing.ShareAccess
import ch.nokillswit.sharing.ShareCreateOutcome
import ch.nokillswit.sharing.SharePageResponse
import ch.nokillswit.sharing.ShareRequest
import ch.nokillswit.sharing.ShareResponse
import ch.nokillswit.sharing.ShareService
import ch.nokillswit.sharing.ShareServiceKey
import ch.nokillswit.sharing.ShareableResourceType
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

    /** `testApplication` with the container started; the body is the test. */
    private fun runBlockingApp(block: suspend ApplicationTestBuilder.() -> Unit) = testApplication {
        usePostgresTestcontainer()
        block()
    }
}
