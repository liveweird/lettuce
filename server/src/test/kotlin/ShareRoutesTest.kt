package ch.nokillswit

import ch.nokillswit.authz.CallerPrincipal
import ch.nokillswit.authz.ForbiddenException
import ch.nokillswit.notifications.NotificationPageResponse
import ch.nokillswit.notifications.NotificationType
import ch.nokillswit.plugins.ProblemDetail
import ch.nokillswit.sharing.ShareCreateOutcome
import ch.nokillswit.sharing.SharePageResponse
import ch.nokillswit.sharing.ShareRegistry
import ch.nokillswit.sharing.ShareRegistryKey
import ch.nokillswit.sharing.ShareRequest
import ch.nokillswit.sharing.ShareResponse
import ch.nokillswit.sharing.ShareService
import ch.nokillswit.sharing.ShareServiceKey
import ch.nokillswit.sharing.ShareStatus
import ch.nokillswit.sharing.ShareableResource
import ch.nokillswit.sharing.ShareableResourceType
import ch.nokillswit.users.Feature
import ch.nokillswit.users.OPT_IN_FEATURES
import ch.nokillswit.users.UserRole
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.client.request.parameter
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import java.time.LocalDate
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.isNotNull
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import org.jetbrains.exposed.v1.r2dbc.update
import java.util.concurrent.ConcurrentHashMap
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** A fake shareable document: one author, a set of readers; HR reads everything (as an auditor). */
internal class FakeDoc(
    val id: UInt,
    val authorId: UInt,
    val readers: Set<UInt>,
    @Volatile var title: String,
    /** Flip to false to model an author who has since lost the right to read their own document. */
    @Volatile var authorMayRead: Boolean = true,
)

/**
 * A test-only [ShareableResource] standing in for a real feature adapter (none is registered
 * until the per-feature steps land). Its guard mirrors the real guards' shape: author/readers
 * read in their own right, and the HR ROLE reads everything — which is exactly what the role
 * stripping in `ShareAccess.holdsOwnRight` has to take away.
 */
internal class FakeShareable(override val type: ShareableResourceType) : ShareableResource<FakeDoc, Unit> {
    val docs = ConcurrentHashMap<UInt, FakeDoc>()

    // Ids come from the JVM-wide synthetic range (TestShareDocuments) — never a real document's id.
    fun add(authorId: UInt, readers: Set<UInt> = emptySet(), title: String = "Fake document"): UInt {
        val id = TestShareDocuments.nextId()
        docs[id] = FakeDoc(id, authorId, readers, title)
        return id
    }

    override suspend fun read(id: UInt): FakeDoc? = docs[id]

    override suspend fun guard(principal: CallerPrincipal, doc: FakeDoc) {
        val allowed = (principal.userId == doc.authorId && doc.authorMayRead) ||
            principal.userId in doc.readers || UserRole.HR in principal.roles
        if (!allowed) throw ForbiddenException("Not allowed to read the fake document")
    }

    override suspend fun isAuthor(userId: UInt, doc: FakeDoc): Boolean = userId == doc.authorId

    override suspend fun label(doc: FakeDoc): Map<String, String> = mapOf("title" to doc.title)

    override fun viewPath(id: UInt): String = "/fake/$id/view"
}

/**
 * The central `/api/v1/shares` routes (v4.8.0, `sharing/ShareRoutes.kt` + `ShareHandlers.kt`) over a fake adapter —
 * ordering of the gates, validation after the guard, the 409 duplicate, the withdrawal matrix
 * with its notifications, and the three list views. What a REAL feature grants through a share
 * is covered by the per-feature sharing tests; here the adapter is a stub.
 */
class ShareRoutesTest {

    private class Person(val id: UInt, val email: String, val client: HttpClient)

    private val password = "pw-123456789"

    private suspend fun ApplicationTestBuilder.startWithFake(
        type: ShareableResourceType = ShareableResourceType.GOAL,
        vararg overrides: Pair<String, String>,
    ): FakeShareable {
        // The registry is complete by construction (one adapter per kind), so the stub registry is too:
        // one fake per kind, each with its OWN (initially empty) document store — only [type]'s is
        // returned for the test to fill. The routes look the registry up per request, so swapping the
        // attribute after the modules ran takes effect.
        val fakes = ShareableResourceType.entries.associateWith { FakeShareable(it) }
        configureApp(*overrides)
        application { attributes.put(ShareRegistryKey, ShareRegistry { fakes.getValue(it) }) }
        startApplication()
        return fakes.getValue(type)
    }

    /** A seeded user with a logged-in client. [disabled] is applied BEFORE login so the JWT carries it. */
    private suspend fun ApplicationTestBuilder.person(
        prefix: String,
        roles: Set<UserRole> = emptySet(),
        disabled: Set<Feature> = emptySet(),
    ): Person {
        val email = uniqueEmail(prefix)
        val id = TestUsers.seed(email = email, password = password, name = prefix, roles = roles)
        // setDisabledFeatures replaces wholesale: keep the inverted-default opt-in rows (MFA would
        // otherwise be switched ON and the login would answer a challenge instead of tokens).
        if (disabled.isNotEmpty()) TestServices.users.setDisabledFeatures(id, disabled + OPT_IN_FEATURES)
        return Person(id, email, authedClient(email, password))
    }

    private suspend fun HttpClient.share(
        documentId: UInt,
        shareeId: UInt,
        expiresOn: String? = null,
        type: ShareableResourceType = ShareableResourceType.GOAL,
    ): HttpResponse = post("/api/v1/shares") {
        contentType(ContentType.Application.Json)
        setBody(ShareRequest(type, documentId, shareeId, expiresOn))
    }

    private suspend fun HttpClient.shareId(documentId: UInt, shareeId: UInt, expiresOn: String? = null): UInt {
        val response = share(documentId, shareeId, expiresOn)
        assertEquals(HttpStatusCode.Created, response.status)
        return response.body<ShareResponse>().id
    }

    /** The app's own share clock — the ONE "today" the route validates against and statuses derive from. */
    private fun ApplicationTestBuilder.shareService() = application.attributes[ShareServiceKey]

    private fun ApplicationTestBuilder.serverToday(): LocalDate = shareService().today()

    /** An already-EXPIRED share — unreachable through the API (a past end date is a 400), so written via the store. */
    private suspend fun ApplicationTestBuilder.expiredShare(sharer: UInt, sharee: UInt, documentId: UInt): UInt =
        (shareService().create(
            ShareableResourceType.GOAL, documentId, sharer, sharee, serverToday().minusDays(1).toString(),
        ) as ShareCreateOutcome.Created).id

    private suspend fun HttpClient.notifications() =
        get("/api/v1/notifications").body<NotificationPageResponse>().items

    private suspend fun HttpResponse.detail() = body<ProblemDetail>().detail

    @Test
    fun `a reader shares - 201 with Location, the sharee is notified with the link and end date, and it is audited`() =
        testApplication {
            val fake = startWithFake()
            val author = person("author")
            val sharee = person("sharee")
            val documentId = fake.add(author.id)
            val audit = LogCapture("ch.nokillswit.audit")
            try {
                val response = author.client.share(documentId, sharee.id, expiresOn = "2099-12-31")
                assertEquals(HttpStatusCode.Created, response.status)
                val share = response.body<ShareResponse>()
                assertEquals("/api/v1/shares/${share.id}", response.headers[HttpHeaders.Location])
                assertEquals(ShareableResourceType.GOAL, share.resourceType)
                assertEquals(documentId, share.resourceId)
                assertEquals(author.id, share.sharerId)
                assertEquals("author", share.sharerName)
                assertEquals(sharee.id, share.shareeId)
                assertEquals("sharee", share.shareeName)
                assertEquals("2099-12-31", share.expiresOn)
                assertEquals(ShareStatus.ACTIVE, share.status)
                assertNull(share.withdrawnAt)
                assertEquals("/fake/$documentId/view", share.link)
                assertEquals(mapOf("title" to "Fake document"), share.details)

                val notification = sharee.client.notifications().single { it.type == NotificationType.GOAL_SHARED }
                assertEquals(mapOf("sharer" to "author", "expiresOn" to "2099-12-31"), notification.params)
                assertEquals("/fake/$documentId/view", notification.link)
                // The sharer is not told about their own action.
                assertTrue(author.client.notifications().none { it.type == NotificationType.GOAL_SHARED })

                val event = audit.events.find {
                    it.message == "share.created" && it.keyValuePairs.any { kv -> kv.key == "shareId" && kv.value == share.id.toLong() }
                }
                assertNotNull(event, "expected a share.created audit event")
                assertTrue(event.hasKeyValue("resourceType", "GOAL"))
                assertTrue(event.hasKeyValue("role", "sharer"))
                assertTrue(event.keyValuePairs.any { it.key == "byUserId" && it.value == author.id.toLong() })
                assertTrue(event.keyValuePairs.any { it.key == "shareeId" && it.value == sharee.id.toLong() })
            } finally {
                audit.detach()
            }
        }

    @Test
    fun `an open-ended share carries no end date in its notification, and any reader may share`() = testApplication {
        val fake = startWithFake()
        val author = person("author")
        val reader = person("reader")
        val sharee = person("sharee")
        val documentId = fake.add(author.id, readers = setOf(reader.id))
        val share = reader.client.share(documentId, sharee.id).body<ShareResponse>()
        assertNull(share.expiresOn)
        assertEquals(mapOf("sharer" to "reader"), sharee.client.notifications().single().params)
    }

    @Test
    fun `POST gates run in order - flag, adapter, document, own right - and validation comes after the guard`() =
        testApplication {
            val fake = startWithFake()
            val author = person("author")
            val stranger = person("stranger")
            val hrOnly = person("hr", roles = setOf(UserRole.HR))
            val noGoals = person("no-goals", disabled = setOf(Feature.GOALS))
            val sharee = person("sharee")
            val documentId = fake.add(author.id)

            // The caller's own flag wins even over a missing document (uniform 403, no 404 oracle).
            assertEquals(HttpStatusCode.Forbidden, noGoals.client.share(TestShareDocuments.nextId(), sharee.id).status)
            // An unknown document is 404 — also under another kind (FEEDBACK's stub store has no such id).
            assertEquals(
                HttpStatusCode.NotFound,
                author.client.share(documentId, sharee.id, type = ShareableResourceType.FEEDBACK).status,
            )
            assertEquals(HttpStatusCode.NotFound, author.client.share(TestShareDocuments.nextId(), sharee.id).status)
            // A non-reader and an HR auditor-only reader are 403 — and 403 beats the payload 400s.
            assertEquals(HttpStatusCode.Forbidden, stranger.client.share(documentId, sharee.id).status)
            assertEquals(HttpStatusCode.Forbidden, stranger.client.share(documentId, stranger.id, "garbage").status)
            val hrDenied = hrOnly.client.share(documentId, sharee.id)
            assertEquals(HttpStatusCode.Forbidden, hrDenied.status)
            assertEquals("Only someone who can read this document in their own right may share it", hrDenied.detail())
            // Nothing was created by any of the above.
            assertEquals(0L, author.client.get("/api/v1/shares") { parameter("view", "byMe") }.body<SharePageResponse>().total)
        }

    @Test
    fun `an HR user who is also a reader in their own right can share`() = testApplication {
        val fake = startWithFake()
        val hr = person("hr-reader", roles = setOf(UserRole.HR))
        val sharee = person("sharee")
        val documentId = fake.add(authorId = hr.id)
        assertEquals(HttpStatusCode.Created, hr.client.share(documentId, sharee.id).status)
    }

    @Test
    fun `payload validation is 400 after the guard - dates, self, unknown and deactivated sharees, bad bodies`() =
        testApplication {
            val fake = startWithFake()
            val author = person("author")
            val sharee = person("sharee")
            val gone = person("gone")
            TestServices.users.setDeactivated(gone.id, true)
            val documentId = fake.add(author.id)

            val today = serverToday()
            assertEquals(HttpStatusCode.BadRequest, author.client.share(documentId, sharee.id, "2020-01-01").status)
            // No timezone tolerance: yesterday (server clock) is already past — a share must not be born expired.
            val past = author.client.share(documentId, sharee.id, today.minusDays(1).toString())
            assertEquals(HttpStatusCode.BadRequest, past.status)
            assertEquals("expiresOn must not be in the past", past.detail())
            assertEquals(HttpStatusCode.BadRequest, author.client.share(documentId, sharee.id, "31/12/2099").status)
            assertEquals(HttpStatusCode.BadRequest, author.client.share(documentId, sharee.id, "+12099-12-31").status)
            val self = author.client.share(documentId, author.id)
            assertEquals(HttpStatusCode.BadRequest, self.status)
            assertEquals("A document cannot be shared with yourself", self.detail())
            assertEquals(HttpStatusCode.BadRequest, author.client.share(documentId, 4_000_000u).status)
            assertEquals(HttpStatusCode.BadRequest, author.client.share(documentId, gone.id).status)
            // A malformed body — including an unknown resourceType — precedes the gates (the type
            // that picks the flag and adapter lives in the body).
            val unknownType = author.client.post("/api/v1/shares") {
                contentType(ContentType.Application.Json)
                setBody("""{"resourceType":"NOPE","resourceId":1,"shareeId":${sharee.id}}""")
            }
            assertEquals(HttpStatusCode.BadRequest, unknownType.status)
            val missingFields = author.client.post("/api/v1/shares") {
                contentType(ContentType.Application.Json)
                setBody("""{"resourceType":"GOAL"}""")
            }
            assertEquals(HttpStatusCode.BadRequest, missingFields.status)

            // Nothing was created by the rejected attempts; today itself is accepted (inclusive end date).
            assertEquals(
                0L,
                author.client.get("/api/v1/shares") { parameter("view", "byMe") }.body<SharePageResponse>().total,
            )
            assertEquals(HttpStatusCode.Created, author.client.share(documentId, sharee.id, today.toString()).status)
        }

    @Test
    fun `an active duplicate is 409 with instance pointing at the existing share, and a withdrawn one frees the slot`() =
        testApplication {
            val fake = startWithFake()
            val author = person("author")
            val sharee = person("sharee")
            val documentId = fake.add(author.id)
            val first = author.client.shareId(documentId, sharee.id)

            val duplicate = author.client.share(documentId, sharee.id, "2099-01-01")
            assertEquals(HttpStatusCode.Conflict, duplicate.status)
            assertEquals("/api/v1/shares/$first", duplicate.body<ProblemDetail>().instance)

            assertEquals(HttpStatusCode.NoContent, author.client.post("/api/v1/shares/$first/withdraw").status)
            assertEquals(HttpStatusCode.Created, author.client.share(documentId, sharee.id).status)
        }

    @Test
    fun `GET by id is for the sharer and the author only`() = testApplication {
        val fake = startWithFake()
        val author = person("author")
        val reader = person("reader")
        val sharee = person("sharee")
        val stranger = person("stranger")
        val documentId = fake.add(author.id, readers = setOf(reader.id))
        val id = reader.client.shareId(documentId, sharee.id)

        assertEquals(id, reader.client.get("/api/v1/shares/$id").body<ShareResponse>().id)
        assertEquals(id, author.client.get("/api/v1/shares/$id").body<ShareResponse>().id)
        assertEquals(HttpStatusCode.Forbidden, sharee.client.get("/api/v1/shares/$id").status)
        assertEquals(HttpStatusCode.Forbidden, stranger.client.get("/api/v1/shares/$id").status)
        assertEquals(HttpStatusCode.NotFound, author.client.get("/api/v1/shares/4000000").status)
    }

    @Test
    fun `the sharer withdraws - 204, the sharee is told with no link, repeat is 409, the others are 403`() =
        testApplication {
            val fake = startWithFake()
            val author = person("author")
            val sharee = person("sharee")
            val stranger = person("stranger")
            val documentId = fake.add(author.id)
            val id = author.client.shareId(documentId, sharee.id)
            val audit = LogCapture("ch.nokillswit.audit")
            try {
                assertEquals(HttpStatusCode.Forbidden, stranger.client.post("/api/v1/shares/$id/withdraw").status)
                // The sharee cannot withdraw their own access either — the share is the sharer's.
                assertEquals(HttpStatusCode.Forbidden, sharee.client.post("/api/v1/shares/$id/withdraw").status)
                assertEquals(HttpStatusCode.NotFound, author.client.post("/api/v1/shares/4000000/withdraw").status)

                assertEquals(HttpStatusCode.NoContent, author.client.post("/api/v1/shares/$id/withdraw").status)
                val told = sharee.client.notifications().single { it.type == NotificationType.GOAL_SHARE_WITHDRAWN }
                assertEquals(mapOf("sharer" to "author", "sharee" to "sharee", "actor" to "author"), told.params)
                assertNull(told.link)
                // The sharer acted themselves: no copy for them.
                assertTrue(author.client.notifications().none { it.type == NotificationType.GOAL_SHARE_WITHDRAWN })

                val withdrawn = author.client.get("/api/v1/shares/$id").body<ShareResponse>()
                assertEquals(ShareStatus.WITHDRAWN, withdrawn.status)
                assertEquals(author.id, withdrawn.withdrawnById)
                assertEquals("author", withdrawn.withdrawnByName)
                assertNotNull(withdrawn.withdrawnAt)

                val repeat = author.client.post("/api/v1/shares/$id/withdraw")
                assertEquals(HttpStatusCode.Conflict, repeat.status)
                // 403 still precedes the 409 state check for a stranger.
                assertEquals(HttpStatusCode.Forbidden, stranger.client.post("/api/v1/shares/$id/withdraw").status)

                val event = audit.events.find {
                    it.message == "share.withdrawn" && it.keyValuePairs.any { kv -> kv.key == "shareId" && kv.value == id.toLong() }
                }
                assertNotNull(event, "expected a share.withdrawn audit event")
                assertTrue(event.hasKeyValue("role", "sharer"))
                assertTrue(event.keyValuePairs.any { it.key == "wasActive" && it.value == true })
            } finally {
                audit.detach()
            }
        }

    @Test
    fun `the author withdraws someone else's share - the sharee and the sharer are both told`() = testApplication {
        val fake = startWithFake()
        val author = person("author")
        val sharer = person("sharer")
        val sharee = person("sharee")
        val documentId = fake.add(author.id, readers = setOf(sharer.id))
        val id = sharer.client.shareId(documentId, sharee.id)
        val audit = LogCapture("ch.nokillswit.audit")
        try {
            assertEquals(HttpStatusCode.NoContent, author.client.post("/api/v1/shares/$id/withdraw").status)

            val toSharee = sharee.client.notifications().single { it.type == NotificationType.GOAL_SHARE_WITHDRAWN }
            assertEquals(mapOf("sharer" to "sharer", "sharee" to "sharee", "actor" to "author"), toSharee.params)
            assertNull(toSharee.link)
            val toSharer = sharer.client.notifications().single { it.type == NotificationType.GOAL_SHARE_WITHDRAWN }
            assertEquals(
                mapOf("sharer" to "sharer", "sharee" to "sharee", "actor" to "author", "self" to "sharer"),
                toSharer.params,
            )
            assertEquals("/shares?tab=byMe", toSharer.link)
            // The acting author gets nothing.
            assertTrue(author.client.notifications().none { it.type == NotificationType.GOAL_SHARE_WITHDRAWN })

            val withdrawn = sharer.client.get("/api/v1/shares/$id").body<ShareResponse>()
            assertEquals(author.id, withdrawn.withdrawnById)
            val event = audit.events.find {
                it.message == "share.withdrawn" && it.keyValuePairs.any { kv -> kv.key == "shareId" && kv.value == id.toLong() }
            }
            assertNotNull(event)
            assertTrue(event.hasKeyValue("role", "author"))
        } finally {
            audit.detach()
        }
    }

    @Test
    fun `withdrawing an already expired share stamps it silently`() = testApplication {
        val fake = startWithFake()
        val author = person("author")
        val sharee = person("sharee")
        val documentId = fake.add(author.id)
        val id = expiredShare(author.id, sharee.id, documentId)
        val before = author.client.get("/api/v1/shares/$id").body<ShareResponse>()
        assertEquals(ShareStatus.EXPIRED, before.status)
        val notificationsBefore = sharee.client.notifications().size

        assertEquals(HttpStatusCode.NoContent, author.client.post("/api/v1/shares/$id/withdraw").status)
        assertEquals(notificationsBefore, sharee.client.notifications().size, "nobody is told about an expired share")
        assertEquals(ShareStatus.WITHDRAWN, author.client.get("/api/v1/shares/$id").body<ShareResponse>().status)
    }

    @Test
    fun `list shape errors are 400 before any gate`() = testApplication {
        val fake = startWithFake()
        val stranger = person("stranger")
        val documentId = fake.add(authorId = person("author").id)

        suspend fun status(vararg params: Pair<String, String>) =
            stranger.client.get("/api/v1/shares") { params.forEach { (k, v) -> parameter(k, v) } }.status

        assertEquals(HttpStatusCode.BadRequest, status("view" to "everyone"))
        assertEquals(HttpStatusCode.BadRequest, status("sort" to "sharerName"))
        assertEquals(HttpStatusCode.BadRequest, status("pageSize" to "101"))
        assertEquals(HttpStatusCode.BadRequest, status("resourceType" to "NOPE"))
        assertEquals(HttpStatusCode.BadRequest, status("status" to "PENDING"))
        // resourceId belongs to view=document only; document needs both identifiers.
        assertEquals(HttpStatusCode.BadRequest, status("resourceId" to "$documentId"))
        assertEquals(HttpStatusCode.BadRequest, status("view" to "byMe", "resourceId" to "$documentId"))
        assertEquals(HttpStatusCode.BadRequest, status("view" to "document", "resourceType" to "GOAL"))
        assertEquals(HttpStatusCode.BadRequest, status("view" to "document", "resourceId" to "$documentId"))
        // The shape 400 precedes the gate: the stranger is NOT told 403 for a malformed request,
        // and a well-formed one is the gate's 403.
        assertEquals(
            HttpStatusCode.Forbidden,
            status("view" to "document", "resourceType" to "GOAL", "resourceId" to "$documentId"),
        )
        // A repeated key is a 400, never silent first-value-wins.
        val repeated = stranger.client.get("/api/v1/shares") {
            parameter("view", "byMe")
            parameter("view", "withMe")
        }
        assertEquals(HttpStatusCode.BadRequest, repeated.status)
    }

    @Test
    fun `withMe and byMe list the caller's side - withdrawn rows leave withMe, expired ones stay, statuses filter`() =
        testApplication {
            val fake = startWithFake()
            val sharer = person("sharer")
            val sharee = person("sharee")
            val liveDoc = fake.add(sharer.id)
            val expiredDoc = fake.add(sharer.id)
            val withdrawnDoc = fake.add(sharer.id)
            val live = sharer.client.shareId(liveDoc, sharee.id, "2099-01-01")
            val withdrawn = sharer.client.shareId(withdrawnDoc, sharee.id)
            val expired = expiredShare(sharer.id, sharee.id, expiredDoc)
            sharer.client.post("/api/v1/shares/$withdrawn/withdraw")

            val withMe = sharee.client.get("/api/v1/shares").body<SharePageResponse>()
            assertEquals(setOf(live, expired), withMe.items.map { it.id }.toSet())
            assertEquals(2L, withMe.total)
            assertEquals(ShareStatus.EXPIRED, withMe.items.single { it.id == expired }.status)
            assertEquals("/fake/$liveDoc/view", withMe.items.single { it.id == live }.link)

            val onlyActive = sharee.client.get("/api/v1/shares") { parameter("status", "ACTIVE") }.body<SharePageResponse>()
            assertEquals(listOf(live), onlyActive.items.map { it.id })
            // A withdrawn row never shows on withMe, whatever the filter.
            val noWithdrawn = sharee.client.get("/api/v1/shares") { parameter("status", "WITHDRAWN") }.body<SharePageResponse>()
            assertEquals(0L, noWithdrawn.total)
            // …and a status SET containing WITHDRAWN doesn't resurrect it either.
            val mixed = sharee.client.get("/api/v1/shares") {
                parameter("status", "WITHDRAWN")
                parameter("status", "ACTIVE")
            }.body<SharePageResponse>()
            assertEquals(listOf(live), mixed.items.map { it.id })

            // Newest first, deterministically: ids are monotonic, createdAt millis may tie.
            val newestFirst = sharee.client.get("/api/v1/shares") { parameter("sort", "-id") }.body<SharePageResponse>()
            assertEquals(listOf(expired, live), newestFirst.items.map { it.id })
            val byExpiry = sharee.client.get("/api/v1/shares") { parameter("sort", "expiresOn") }.body<SharePageResponse>()
            assertEquals(listOf(expired, live), byExpiry.items.map { it.id })

            val byMe = sharer.client.get("/api/v1/shares") { parameter("view", "byMe") }.body<SharePageResponse>()
            assertEquals(setOf(live, expired, withdrawn), byMe.items.map { it.id }.toSet())
            assertEquals(3L, byMe.total)
            // A repeated status is an IN set (API-LIST-004): the union of the derived statuses.
            suspend fun byMeStatuses(vararg statuses: String) = sharer.client.get("/api/v1/shares") {
                parameter("view", "byMe")
                statuses.forEach { parameter("status", it) }
            }.body<SharePageResponse>().items.map { it.id }.toSet()
            assertEquals(setOf(live, withdrawn), byMeStatuses("ACTIVE", "WITHDRAWN"))
            assertEquals(setOf(expired, withdrawn), byMeStatuses("EXPIRED", "WITHDRAWN"))
            assertEquals(setOf(live), byMeStatuses("ACTIVE"))
            assertEquals(
                HttpStatusCode.BadRequest,
                sharer.client.get("/api/v1/shares") {
                    parameter("view", "byMe")
                    parameter("status", "ACTIVE")
                    parameter("status", "BOGUS")
                }.status,
            )
            // resourceType stays single-valued.
            assertEquals(
                HttpStatusCode.BadRequest,
                sharer.client.get("/api/v1/shares") {
                    parameter("resourceType", "GOAL")
                    parameter("resourceType", "FEEDBACK")
                }.status,
            )
            // Someone else's byMe is empty — the lists are strictly caller-scoped.
            assertEquals(0L, sharee.client.get("/api/v1/shares") { parameter("view", "byMe") }.body<SharePageResponse>().total)
        }

    @Test
    fun `the document view - the author sees every row, a reader only their own, everyone else is 403`() =
        testApplication {
            val fake = startWithFake()
            val author = person("author")
            val readerA = person("reader-a")
            val readerB = person("reader-b")
            val subject = person("subject")
            val hrOnly = person("hr", roles = setOf(UserRole.HR))
            val shareeA = person("sharee-a")
            val shareeB = person("sharee-b")
            val documentId = fake.add(author.id, readers = setOf(readerA.id, readerB.id))
            val fromA = readerA.client.shareId(documentId, shareeA.id)
            val fromB = readerB.client.shareId(documentId, shareeB.id)
            val fromAuthor = author.client.shareId(documentId, subject.id)

            suspend fun Person.documentView() = client.get("/api/v1/shares") {
                parameter("view", "document")
                parameter("resourceType", "GOAL")
                parameter("resourceId", documentId.toString())
            }

            assertEquals(
                setOf(fromA, fromB, fromAuthor),
                author.documentView().body<SharePageResponse>().items.map { it.id }.toSet(),
            )
            assertEquals(listOf(fromA), readerA.documentView().body<SharePageResponse>().items.map { it.id })
            assertEquals(listOf(fromB), readerB.documentView().body<SharePageResponse>().items.map { it.id })
            // The subject-like outsider never sees the share list; neither does HR auditor-only access.
            assertEquals(HttpStatusCode.Forbidden, subject.documentView().status)
            assertEquals(HttpStatusCode.Forbidden, hrOnly.documentView().status)
            // Unknown document → 404 (also under another kind, whose stub store has no such id).
            assertEquals(
                HttpStatusCode.NotFound,
                author.client.get("/api/v1/shares") {
                    parameter("view", "document")
                    parameter("resourceType", "GOAL")
                    parameter("resourceId", "4000000")
                }.status,
            )
            assertEquals(
                HttpStatusCode.NotFound,
                author.client.get("/api/v1/shares") {
                    parameter("view", "document")
                    parameter("resourceType", "FEEDBACK")
                    parameter("resourceId", documentId.toString())
                }.status,
            )
        }

    @Test
    fun `a sharee with the area disabled gets the share minted but sees neither the row nor the notification`() =
        testApplication {
            val fake = startWithFake()
            val author = person("author")
            val sharee = person("sharee-off", disabled = setOf(Feature.GOALS))
            val documentId = fake.add(author.id)
            val id = author.client.shareId(documentId, sharee.id)

            // Hidden from the sharee's list (rows AND total) while the flag is off …
            assertEquals(0L, sharee.client.get("/api/v1/shares").body<SharePageResponse>().total)
            // … the GOAL_SHARED bell row is hidden too (the notifications-list feature exclusion) …
            assertTrue(sharee.client.notifications().none { it.type == NotificationType.GOAL_SHARED })
            // … but the sharer still sees the share, and the row is real.
            assertEquals(ShareStatus.ACTIVE, author.client.get("/api/v1/shares/$id").body<ShareResponse>().status)
            val back = person("sharee-back")
            assertEquals(1L, author.client.get("/api/v1/shares") { parameter("view", "byMe") }.body<SharePageResponse>().total)
            assertEquals(HttpStatusCode.Created, author.client.share(documentId, back.id).status)
        }

    @Test
    fun `details are a creation-time snapshot - later retitling or deleting the document changes nothing`() =
        testApplication {
            val fake = startWithFake()
            val author = person("author")
            val sharee = person("sharee")
            val documentId = fake.add(author.id, title = "Original title")
            val id = author.client.shareId(documentId, sharee.id)

            fake.docs.getValue(documentId).title = "Retitled after the share"
            fun SharePageResponse.titles() = items.map { it.details?.get("title") }
            assertEquals(listOf("Original title"), sharee.client.get("/api/v1/shares").body<SharePageResponse>().titles())
            assertEquals("Original title", author.client.get("/api/v1/shares/$id").body<ShareResponse>().details?.get("title"))

            // Even a document that no longer exists keeps the snapshot and the derived link; the
            // sharer can still withdraw such a share (and the withdrawn row keeps its snapshot).
            fake.docs.remove(documentId)
            val row = sharee.client.get("/api/v1/shares").body<SharePageResponse>().items.single()
            assertEquals(mapOf("title" to "Original title"), row.details)
            assertEquals("/fake/$documentId/view", row.link)
            assertEquals(HttpStatusCode.NoContent, author.client.post("/api/v1/shares/$id/withdraw").status)
            val byMe = author.client.get("/api/v1/shares") { parameter("view", "byMe") }.body<SharePageResponse>()
            assertEquals(mapOf("title" to "Original title"), byMe.items.single().details)
        }

    @Test
    fun `an author who can no longer read the document cannot withdraw others' shares, the sharer still can`() =
        testApplication {
            val fake = startWithFake()
            val author = person("author")
            val sharer = person("sharer")
            val sharee = person("sharee")
            val documentId = fake.add(author.id, readers = setOf(sharer.id))
            val id = sharer.client.shareId(documentId, sharee.id)

            fake.docs.getValue(documentId).authorMayRead = false
            assertEquals(HttpStatusCode.Forbidden, author.client.post("/api/v1/shares/$id/withdraw").status)
            assertEquals(HttpStatusCode.Forbidden, author.client.get("/api/v1/shares/$id").status)
            assertEquals(HttpStatusCode.NoContent, sharer.client.post("/api/v1/shares/$id/withdraw").status)
        }

    @Test
    fun `share mutations share one per-caller rate limit - the 5th call 429s, other callers and reads are unaffected`() =
        testApplication {
            // The production default is 60/min; the bucket is configurable, so pin a small one.
            startWithFake(ShareableResourceType.GOAL, "sharing.rateLimitPerMinute" to "4")
            val busy = person("busy")
            val other = person("other")
            val missing = TestShareDocuments.nextId()

            repeat(3) { assertEquals(HttpStatusCode.NotFound, busy.client.share(missing, other.id).status) }
            // The withdraw route draws on the SAME bucket (404: no such share).
            assertEquals(HttpStatusCode.NotFound, busy.client.post("/api/v1/shares/4000000/withdraw").status)
            assertEquals(HttpStatusCode.TooManyRequests, busy.client.share(missing, other.id).status)
            assertEquals(HttpStatusCode.TooManyRequests, busy.client.post("/api/v1/shares/4000000/withdraw").status)
            // Keyed per caller, not per host: someone else on the same host still gets through …
            assertEquals(HttpStatusCode.NotFound, other.client.share(missing, busy.id).status)
            // … and reads are not throttled at all.
            repeat(6) { assertEquals(HttpStatusCode.OK, busy.client.get("/api/v1/shares").status) }
        }

    @Test
    fun `the per-pair daily notification cap - shares and withdrawals still happen, but mint no notification`() =
        testApplication {
            val fake = startWithFake(ShareableResourceType.GOAL, "sharing.notificationDailyCapPerPair" to "2")
            val author = person("author")
            val sharee = person("sharee")
            val other = person("other-sharee")
            val docs = List(3) { fake.add(author.id) }
            val audit = LogCapture("ch.nokillswit.audit")
            try {
                val ids = docs.map { author.client.shareId(it, sharee.id) }
                // The first two shares notified; the third (cap = 2 already caused) did not — but exists.
                assertEquals(2, sharee.client.notifications().count { it.type == NotificationType.GOAL_SHARED })
                assertEquals(ShareStatus.ACTIVE, author.client.get("/api/v1/shares/${ids[2]}").body<ShareResponse>().status)
                fun notifiedOf(shareId: UInt, event: String) = audit.events.single {
                    it.message == event && it.keyValuePairs.any { kv -> kv.key == "shareId" && kv.value == shareId.toLong() }
                }.keyValuePairs.single { it.key == "notified" }.value
                assertEquals(listOf(true, true, false), ids.map { notifiedOf(it, "share.created") })

                // Withdrawals between the capped pair are silent too …
                assertEquals(HttpStatusCode.NoContent, author.client.post("/api/v1/shares/${ids[0]}/withdraw").status)
                assertEquals(0, sharee.client.notifications().count { it.type == NotificationType.GOAL_SHARE_WITHDRAWN })
                assertEquals(false, notifiedOf(ids[0], "share.withdrawn"))
                // … and the cap is per PAIR: the same sharer toward someone else still notifies.
                author.client.shareId(docs[0], other.id)
                assertEquals(1, other.client.notifications().count { it.type == NotificationType.GOAL_SHARED })
            } finally {
                audit.detach()
            }
        }

    @Test
    fun `the cap gates only the sharee-facing notices - an author withdrawal still tells the sharer`() = testApplication {
        val fake = startWithFake(ShareableResourceType.GOAL, "sharing.notificationDailyCapPerPair" to "2")
        val author = person("author")
        val sharer = person("sharer")
        val sharee = person("sharee")
        val docs = List(3) { fake.add(author.id, readers = setOf(sharer.id)) }
        val ids = docs.map { sharer.client.shareId(it, sharee.id) }
        // The pair is capped now (two notices minted, the third share silent).
        assertEquals(2, sharee.client.notifications().count { it.type == NotificationType.GOAL_SHARED })

        assertEquals(HttpStatusCode.NoContent, author.client.post("/api/v1/shares/${ids[2]}/withdraw").status)
        // The sharee hears nothing about it …
        assertEquals(0, sharee.client.notifications().count { it.type == NotificationType.GOAL_SHARE_WITHDRAWN })
        // … but the sharer, who did not act, still gets their own copy — the cap never silences it.
        val toSharer = sharer.client.notifications().single { it.type == NotificationType.GOAL_SHARE_WITHDRAWN }
        assertEquals("sharer", toSharer.params["self"])
        assertEquals("/shares?tab=byMe", toSharer.link)
    }

    @Test
    fun `a withdrawal counts toward the cap, and the cap rolls off after 24 hours`() = testApplication {
        val fake = startWithFake(ShareableResourceType.GOAL, "sharing.notificationDailyCapPerPair" to "2")
        val author = person("author")
        val sharee = person("sharee")
        val docs = List(4) { fake.add(author.id) }

        // share (notice 1), withdraw (notice 2) — the next share would be notice 3: suppressed.
        val firstShare = author.client.shareId(docs[0], sharee.id)
        assertEquals(HttpStatusCode.NoContent, author.client.post("/api/v1/shares/$firstShare/withdraw").status)
        assertEquals(1, sharee.client.notifications().count { it.type == NotificationType.GOAL_SHARE_WITHDRAWN })
        author.client.shareId(docs[1], sharee.id)
        assertEquals(1, sharee.client.notifications().count { it.type == NotificationType.GOAL_SHARED }, "capped")

        // Roll-off: age every created/withdrawn stamp of the pair past 24 h and the pair is clean again.
        val aged = System.currentTimeMillis() - 25L * 60 * 60 * 1000
        suspendTransaction(TestServices.database) {
            val pair = (ShareService.DocumentShares.sharerId eq author.id) and
                (ShareService.DocumentShares.shareeId eq sharee.id)
            ShareService.DocumentShares.update({ pair }) { it[createdAt] = aged }
            ShareService.DocumentShares.update({ pair and ShareService.DocumentShares.withdrawnAt.isNotNull() }) {
                it[withdrawnAt] = aged
            }
        }
        author.client.shareId(docs[2], sharee.id)
        assertEquals(2, sharee.client.notifications().count { it.type == NotificationType.GOAL_SHARED }, "rolled off")
    }

    @Test
    fun `the notification cap is boot-validated`() = testApplication {
        configureApp("sharing.notificationDailyCapPerPair" to "0")
        assertStartupFails("sharing.notificationDailyCapPerPair") { startApplication() }
    }

    @Test
    fun `the REAL registry answers 404 for a missing document under every kind`() = testApplication {
        // No stub registry swap here: each real feature adapter's read answers the missing id.
        usePostgresTestcontainer()
        val author = person("author")
        val sharee = person("sharee")
        val missing = TestShareDocuments.nextId()
        ShareableResourceType.entries.forEach { type ->
            assertEquals(HttpStatusCode.NotFound, author.client.share(missing, sharee.id, type = type).status, "POST $type")
            val view = author.client.get("/api/v1/shares") {
                parameter("view", "document")
                parameter("resourceType", type.name)
                parameter("resourceId", missing.toString())
            }
            assertEquals(HttpStatusCode.NotFound, view.status, "view=document $type")
        }
    }

    @Test
    fun `every share route requires authentication`() = testApplication {
        startWithFake()
        val plain = jsonClient()
        assertEquals(HttpStatusCode.Unauthorized, plain.get("/api/v1/shares").status)
        assertEquals(HttpStatusCode.Unauthorized, plain.share(TestShareDocuments.nextId(), 2u).status)
        assertEquals(HttpStatusCode.Unauthorized, plain.get("/api/v1/shares/1").status)
        assertEquals(HttpStatusCode.Unauthorized, plain.post("/api/v1/shares/1/withdraw").status)
    }
}
