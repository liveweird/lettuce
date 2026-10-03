package ch.nokillswit

import ch.nokillswit.notifications.NotificationPageResponse
import ch.nokillswit.notifications.NotificationType
import ch.nokillswit.plugins.ProblemDetail
import ch.nokillswit.sharing.MAX_BATCH_SHARE_RESOURCES
import ch.nokillswit.sharing.MAX_BATCH_SHARE_SHAREES
import ch.nokillswit.sharing.ShareBatchItem
import ch.nokillswit.sharing.ShareBatchItemStatus
import ch.nokillswit.sharing.ShareBatchRequest
import ch.nokillswit.sharing.ShareBatchResponse
import ch.nokillswit.sharing.ShareRegistry
import ch.nokillswit.sharing.ShareRegistryKey
import ch.nokillswit.sharing.ShareRequest
import ch.nokillswit.sharing.SharePageResponse
import ch.nokillswit.sharing.ShareResponse
import ch.nokillswit.sharing.ShareStatus
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
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * `POST /api/v1/shares/batch` (v4.10.0, mass share) over the fake adapter registered under
 * `PERFORMANCE_REVIEW` (and, v4.11.0, one summary-notice case under `DAYS_OFF_CALENDAR`, the
 * second batchable kind): the evaluation order of the route KDoc, the
 * itemized report, the replay, the one summary notification per sharee with the batch-aware cap,
 * the single `share.batch_created` audit event and the shared `shares` rate-limit bucket.
 */
class ShareBatchRoutesTest {

    private class Person(val id: UInt, val client: HttpClient)

    private val password = "pw-123456789"
    private val review = ShareableResourceType.PERFORMANCE_REVIEW

    private suspend fun ApplicationTestBuilder.startWithFake(vararg overrides: Pair<String, String>): FakeShareable =
        startWithFakeOf(review, *overrides)

    /** The stub registry; the returned fake is the one registered under [type] (the kind under test). */
    private suspend fun ApplicationTestBuilder.startWithFakeOf(
        type: ShareableResourceType,
        vararg overrides: Pair<String, String>,
    ): FakeShareable {
        val fakes = ShareableResourceType.entries.associateWith { FakeShareable(it) }
        // The production batch bucket is 10/min; most cases here call far more often — the bucket test overrides it.
        configureApp("sharing.batchRateLimitPerMinute" to "1000", *overrides)
        application { attributes.put(ShareRegistryKey, ShareRegistry { fakes.getValue(it) }) }
        startApplication()
        return fakes.getValue(type)
    }

    private suspend fun ApplicationTestBuilder.person(
        prefix: String,
        roles: Set<UserRole> = emptySet(),
        disabled: Set<Feature> = emptySet(),
    ): Person {
        val email = uniqueEmail(prefix)
        val id = TestUsers.seed(email = email, password = password, name = prefix, roles = roles)
        if (disabled.isNotEmpty()) TestServices.users.setDisabledFeatures(id, disabled + OPT_IN_FEATURES)
        return Person(id, authedClient(email, password))
    }

    private suspend fun HttpClient.batch(
        resourceIds: List<UInt>,
        shareeIds: List<UInt>,
        expiresOn: String? = null,
        type: ShareableResourceType = ShareableResourceType.PERFORMANCE_REVIEW,
    ): HttpResponse = post("/api/v1/shares/batch") {
        contentType(ContentType.Application.Json)
        setBody(ShareBatchRequest(type, resourceIds, shareeIds, expiresOn))
    }

    private suspend fun HttpClient.rawBatch(json: String): HttpResponse = post("/api/v1/shares/batch") {
        contentType(ContentType.Application.Json)
        setBody(json)
    }

    private suspend fun HttpClient.ok(resourceIds: List<UInt>, shareeIds: List<UInt>, expiresOn: String? = null): ShareBatchResponse {
        val response = batch(resourceIds, shareeIds, expiresOn)
        assertEquals(HttpStatusCode.OK, response.status)
        return response.body()
    }

    private suspend fun HttpClient.notifications() =
        get("/api/v1/notifications").body<NotificationPageResponse>().items

    private suspend fun HttpClient.byMeTotal() =
        get("/api/v1/shares") { parameter("view", "byMe") }.body<SharePageResponse>().total

    private suspend fun HttpResponse.detail() = body<ProblemDetail>().detail

    private fun ShareBatchResponse.statuses() = items.map { it.status }

    private fun LogCapture.batchEvents(byUserId: UInt) = events.filter {
        it.message == "share.batch_created" && it.keyValuePairs.any { kv -> kv.key == "byUserId" && kv.value == byUserId.toLong() }
    }

    private fun kv(event: ch.qos.logback.classic.spi.ILoggingEvent, key: String): Any? =
        event.keyValuePairs.single { it.key == key }.value

    @Test
    fun `gates run in order - body, flag, kind, shape, own right - and validation comes after the authz outcome`() =
        testApplication {
            val fake = startWithFake()
            val author = person("author")
            val stranger = person("stranger")
            val hrOnly = person("hr", roles = setOf(UserRole.HR))
            val noReviews = person("no-reviews", disabled = setOf(Feature.PERFORMANCE_REVIEWS))
            val sharee = person("sharee")
            val gone = person("gone")
            TestServices.users.setDeactivated(gone.id, true)
            val doc = fake.add(author.id)
            val missing = TestShareDocuments.nextId()
            val audit = LogCapture("ch.nokillswit.audit")
            try {
                // A malformed body — unknown type, missing fields, not-a-list — is the one 400 before the gates.
                assertEquals(
                    HttpStatusCode.BadRequest,
                    author.client.rawBatch("""{"resourceType":"NOPE","resourceIds":[1],"shareeIds":[2]}""").status,
                )
                assertEquals(HttpStatusCode.BadRequest, author.client.rawBatch("""{"resourceType":"PERFORMANCE_REVIEW"}""").status)
                assertEquals(
                    HttpStatusCode.BadRequest,
                    author.client.rawBatch("""{"resourceType":"PERFORMANCE_REVIEW","resourceIds":"1","shareeIds":[2]}""").status,
                )
                // The caller's own flag wins over everything after it (no existence oracle).
                assertEquals(HttpStatusCode.Forbidden, noReviews.client.batch(listOf(missing), listOf(sharee.id)).status)
                assertEquals(HttpStatusCode.Forbidden, noReviews.client.batch(emptyList(), listOf(sharee.id)).status)
                // A non-batchable kind is 400 — even for a document that exists under it.
                val goal = author.client.batch(listOf(doc), listOf(sharee.id), type = ShareableResourceType.GOAL)
                assertEquals(HttpStatusCode.BadRequest, goal.status)
                assertEquals("Batch sharing is not available for this document kind", goal.detail())
                // Pulse team results (v4.12.0) are not batchable either: a team, not a person, is the unit.
                val pulse = author.client.batch(listOf(doc), listOf(sharee.id), type = ShareableResourceType.PULSE_TEAM_RESULTS)
                assertEquals(HttpStatusCode.BadRequest, pulse.status)
                assertEquals("Batch sharing is not available for this document kind", pulse.detail())
                // Shape: empty / over-cap / duplicate lists are 400 BEFORE any document is read.
                assertEquals(HttpStatusCode.BadRequest, author.client.batch(emptyList(), listOf(sharee.id)).status)
                assertEquals(HttpStatusCode.BadRequest, author.client.batch(listOf(doc), emptyList()).status)
                assertEquals(HttpStatusCode.BadRequest, author.client.batch(listOf(doc, doc), listOf(sharee.id)).status)
                assertEquals(HttpStatusCode.BadRequest, author.client.batch(listOf(doc), listOf(sharee.id, sharee.id)).status)
                val tooManyDocs = stranger.client.batch(List(MAX_BATCH_SHARE_RESOURCES + 1) { it.toUInt() }, listOf(sharee.id))
                assertEquals(HttpStatusCode.BadRequest, tooManyDocs.status)
                val tooManySharees = author.client.batch(listOf(doc), List(MAX_BATCH_SHARE_SHAREES + 1) { 1_000_000u + it.toUInt() })
                assertEquals(HttpStatusCode.BadRequest, tooManySharees.status)

                // All NOT_FOUND -> 404; all FORBIDDEN -> 403; a FORBIDDEN + NOT_FOUND mix -> 403.
                val none = author.client.batch(listOf(missing, TestShareDocuments.nextId()), listOf(sharee.id))
                assertEquals(HttpStatusCode.NotFound, none.status)
                assertEquals("None of the documents exist", none.detail())
                val denied = stranger.client.batch(listOf(doc), listOf(sharee.id))
                assertEquals(HttpStatusCode.Forbidden, denied.status)
                // The whole-request 403 is the ordinary authz.denied audit event, naming the caller.
                assertTrue(
                    audit.events.any {
                        it.message == "authz.denied" &&
                            it.keyValuePairs.any { kv -> kv.key == "userId" && kv.value == stranger.id.toLong() }
                    },
                )
                assertEquals("You can't share any of these documents in your own right", denied.detail())
                assertEquals(HttpStatusCode.Forbidden, stranger.client.batch(listOf(doc, missing), listOf(sharee.id)).status)
                // HR auditor-only access is not the own right.
                assertEquals(HttpStatusCode.Forbidden, hrOnly.client.batch(listOf(doc), listOf(sharee.id)).status)
                // 403/404 beat the semantic 400s: a caller with no right learns nothing about them.
                assertEquals(HttpStatusCode.Forbidden, stranger.client.batch(listOf(doc), listOf(stranger.id), "garbage").status)
                assertEquals(HttpStatusCode.NotFound, author.client.batch(listOf(missing), listOf(author.id), "garbage").status)

                // With a shareable document the semantic 400s apply.
                assertEquals(HttpStatusCode.BadRequest, author.client.batch(listOf(doc), listOf(sharee.id), "2020-01-01").status)
                assertEquals(HttpStatusCode.BadRequest, author.client.batch(listOf(doc), listOf(sharee.id), "31/12/2099").status)
                val self = author.client.batch(listOf(doc), listOf(sharee.id, author.id))
                assertEquals(HttpStatusCode.BadRequest, self.status)
                assertEquals("A document cannot be shared with yourself", self.detail())
                assertEquals(HttpStatusCode.BadRequest, author.client.batch(listOf(doc), listOf(sharee.id, 4_000_000u)).status)
                assertEquals(HttpStatusCode.BadRequest, author.client.batch(listOf(doc), listOf(sharee.id, gone.id)).status)

                // Nothing was created, minted or audited by any of the above.
                assertEquals(0L, author.client.byMeTotal())
                assertTrue(sharee.client.notifications().isEmpty())
                assertTrue(audit.batchEvents(author.id).isEmpty())
                assertTrue(audit.batchEvents(stranger.id).isEmpty())
            } finally {
                audit.detach()
            }
        }

    @Test
    fun `the report itemizes created, forbidden and missing documents - one batch id, snapshots, and one audit event`() =
        testApplication {
            val fake = startWithFake()
            val author = person("author")
            val other = person("other-author")
            val first = person("first")
            val second = person("second")
            val mine1 = fake.add(author.id, title = "Review one")
            val mine2 = fake.add(author.id, title = "Review two")
            val readable = fake.add(other.id, readers = setOf(author.id), title = "Review of a chain peer")
            val theirs = fake.add(other.id, title = "Not mine")
            val missing = TestShareDocuments.nextId()
            val audit = LogCapture("ch.nokillswit.audit")
            try {
                val request = listOf(mine1, theirs, missing, mine2, readable)
                val report = author.client.ok(request, listOf(first.id, second.id), "2099-12-31")
                assertEquals(6, report.created)
                assertEquals(0, report.alreadyShared)
                assertEquals(1, report.forbidden)
                assertEquals(1, report.notFound)
                val batchId = assertNotNull(report.batchId)
                assertEquals(java.util.UUID.fromString(batchId).toString(), batchId)
                // Request order: per document, one item per sharee in request order; one item for each bad document.
                assertEquals(
                    listOf(
                        mine1 to first.id, mine1 to second.id, theirs to null, missing to null,
                        mine2 to first.id, mine2 to second.id, readable to first.id, readable to second.id,
                    ),
                    report.items.map { it.resourceId to it.shareeId },
                )
                assertEquals(
                    listOf(
                        ShareBatchItemStatus.CREATED, ShareBatchItemStatus.CREATED, ShareBatchItemStatus.FORBIDDEN,
                        ShareBatchItemStatus.NOT_FOUND, ShareBatchItemStatus.CREATED, ShareBatchItemStatus.CREATED,
                        ShareBatchItemStatus.CREATED, ShareBatchItemStatus.CREATED,
                    ),
                    report.statuses(),
                )
                assertTrue(report.items.filter { it.status == ShareBatchItemStatus.CREATED }.all { it.shareId != null })
                val rejected = report.items.filter { it.status != ShareBatchItemStatus.CREATED }
                assertTrue(rejected.all { it.shareId == null && it.shareeId == null })

                // Every created row is an ordinary share, with its creation-time snapshot and end date.
                val firstRow = report.items.first()
                val share = author.client.get("/api/v1/shares/${firstRow.shareId}").body<ShareResponse>()
                assertEquals(review, share.resourceType)
                assertEquals(mine1, share.resourceId)
                assertEquals(first.id, share.shareeId)
                assertEquals("2099-12-31", share.expiresOn)
                assertEquals(ShareStatus.ACTIVE, share.status)
                assertEquals(mapOf("title" to "Review one"), share.details)
                assertEquals(6L, author.client.byMeTotal())

                // ONE audit event for the whole batch — and no per-share share.created for batch rows.
                val event = audit.batchEvents(author.id).single()
                assertEquals(batchId, kv(event, "batchId"))
                assertEquals(review.name, kv(event, "resourceType"))
                assertEquals(request.joinToString(","), kv(event, "resourceIds"))
                assertEquals("${first.id},${second.id}", kv(event, "shareeIds"))
                assertEquals(6, kv(event, "created"))
                assertEquals(0, kv(event, "alreadyShared"))
                assertEquals(1, kv(event, "forbidden"))
                assertEquals(1, kv(event, "notFound"))
                assertEquals("$theirs", kv(event, "forbiddenResourceIds"))
                assertEquals("$missing", kv(event, "notFoundResourceIds"))
                assertEquals("2099-12-31", kv(event, "expiresOn"))
                assertEquals("${first.id},${second.id}", kv(event, "notifiedShareeIds"))
                assertTrue(
                    audit.events.none {
                        it.message == "share.created" && it.keyValuePairs.any { p -> p.key == "byUserId" && p.value == author.id.toLong() }
                    },
                )
            } finally {
                audit.detach()
            }
        }

    @Test
    fun `each sharee gets exactly one summary notification with their own count - never the per-share notice`() =
        testApplication {
            val fake = startWithFake()
            val author = person("author")
            val first = person("first")
            val second = person("second")
            val docs = List(3) { fake.add(author.id) }
            // second already holds an ACTIVE share of the first document, so only 2 of their pairs are new.
            assertEquals(HttpStatusCode.Created, author.client.post("/api/v1/shares") {
                contentType(ContentType.Application.Json)
                setBody(ShareRequest(review, docs[0], second.id, null))
            }.status)
            val singleNotices = second.client.notifications().count { it.type == NotificationType.PERFORMANCE_REVIEW_SHARED }
            assertEquals(1, singleNotices)

            val report = author.client.ok(docs, listOf(first.id, second.id), "2099-12-31")
            assertEquals(5, report.created)
            assertEquals(1, report.alreadyShared)

            val firstNotice = first.client.notifications().single { it.type == NotificationType.PERFORMANCE_REVIEWS_BATCH_SHARED }
            assertEquals(mapOf("sharer" to "author", "count" to "3", "expiresOn" to "2099-12-31"), firstNotice.params)
            assertEquals("/shares", firstNotice.link)
            val secondNotice = second.client.notifications().single { it.type == NotificationType.PERFORMANCE_REVIEWS_BATCH_SHARED }
            assertEquals(mapOf("sharer" to "author", "count" to "2", "expiresOn" to "2099-12-31"), secondNotice.params)
            // No per-share notice for batch rows (second's single pre-existing one is the only one), none for the sharer.
            assertTrue(first.client.notifications().none { it.type == NotificationType.PERFORMANCE_REVIEW_SHARED })
            assertEquals(1, second.client.notifications().count { it.type == NotificationType.PERFORMANCE_REVIEW_SHARED })
            assertTrue(author.client.notifications().isEmpty())

            // An open-ended batch carries no expiresOn param.
            val more = listOf(fake.add(author.id))
            author.client.ok(more, listOf(first.id))
            val open = first.client.notifications().filter { it.type == NotificationType.PERFORMANCE_REVIEWS_BATCH_SHARED }
                .first { it.params["count"] == "1" }
            assertEquals(mapOf("sharer" to "author", "count" to "1"), open.params)
        }

    @Test
    fun `a calendar batch mints ONE DAYS_OFF_CALENDARS_BATCH_SHARED notice per sharee, linking the shared scope`() =
        testApplication {
            val calendar = ShareableResourceType.DAYS_OFF_CALENDAR
            val fake = startWithFakeOf(calendar)
            val author = person("author")
            val first = person("first")
            val second = person("second")
            val docs = List(3) { fake.add(author.id) }
            val report = author.client.batch(docs, listOf(first.id, second.id), "2099-12-31", type = calendar)
                .also { assertEquals(HttpStatusCode.OK, it.status) }.body<ShareBatchResponse>()
            assertEquals(6, report.created)
            val link = "/days-off?tab=calendar&scope=shared"
            for (sharee in listOf(first, second)) {
                val notices = sharee.client.notifications()
                val summary = notices.single { it.type == NotificationType.DAYS_OFF_CALENDARS_BATCH_SHARED }
                assertEquals(mapOf("sharer" to "author", "count" to "3", "expiresOn" to "2099-12-31"), summary.params)
                assertEquals(link, summary.link)
                assertTrue(notices.none { it.type == NotificationType.DAYS_OFF_CALENDAR_SHARED })
                assertTrue(notices.none { it.type == NotificationType.PERFORMANCE_REVIEWS_BATCH_SHARED })
            }
            // Open-ended: no expiresOn param.
            author.client.batch(listOf(fake.add(author.id)), listOf(first.id), type = calendar)
            val open = first.client.notifications().filter { it.type == NotificationType.DAYS_OFF_CALENDARS_BATCH_SHARED }
                .first { it.params["count"] == "1" }
            assertEquals(mapOf("sharer" to "author", "count" to "1"), open.params)
            // A kind that is still not batchable is refused, calendars being the second batchable one.
            val feedback = author.client.batch(docs, listOf(first.id), type = ShareableResourceType.FEEDBACK)
            assertEquals(HttpStatusCode.BadRequest, feedback.status)
        }

    @Test
    fun `a replay is idempotent - every pair is ALREADY_SHARED with the existing id, no batch id, no notice, still audited`() =
        testApplication {
            val fake = startWithFake()
            val author = person("author")
            val sharee = person("sharee")
            val extra = person("extra")
            val docs = List(2) { fake.add(author.id) }
            val audit = LogCapture("ch.nokillswit.audit")
            try {
                val firstRun = author.client.ok(docs, listOf(sharee.id))
                assertEquals(2, firstRun.created)
                val replay = author.client.ok(docs, listOf(sharee.id))
                assertEquals(0, replay.created)
                assertEquals(2, replay.alreadyShared)
                assertNull(replay.batchId)
                assertEquals(List(2) { ShareBatchItemStatus.ALREADY_SHARED }, replay.statuses())
                assertEquals(firstRun.items.map { it.shareId }, replay.items.map { it.shareId })
                assertEquals(2L, author.client.byMeTotal())
                assertEquals(1, sharee.client.notifications().count { it.type == NotificationType.PERFORMANCE_REVIEWS_BATCH_SHARED })

                // A replay widened by a new person: the old pair is ALREADY_SHARED, only the new one is created and told.
                val widened = author.client.ok(docs, listOf(sharee.id, extra.id))
                assertEquals(listOf(ShareBatchItemStatus.ALREADY_SHARED, ShareBatchItemStatus.CREATED), widened.statuses().take(2))
                assertEquals(2, widened.created)
                assertEquals(2, widened.alreadyShared)
                assertEquals(1, sharee.client.notifications().count { it.type == NotificationType.PERFORMANCE_REVIEWS_BATCH_SHARED })
                assertEquals(1, extra.client.notifications().count { it.type == NotificationType.PERFORMANCE_REVIEWS_BATCH_SHARED })

                val events = audit.batchEvents(author.id)
                assertEquals(3, events.size)
                assertNull(kv(events[1], "batchId"))
                assertEquals(0, kv(events[1], "created"))
                assertEquals("", kv(events[1], "notifiedShareeIds"))
                assertEquals("${extra.id}", kv(events[2], "notifiedShareeIds"))
            } finally {
                audit.detach()
            }
        }

    @Test
    fun `an expired or withdrawn share never blocks a batch pair`() = testApplication {
        val fake = startWithFake()
        val author = person("author")
        val sharee = person("sharee")
        val doc = fake.add(author.id)
        val created = author.client.ok(listOf(doc), listOf(sharee.id)).items.single()
        assertEquals(HttpStatusCode.NoContent, author.client.post("/api/v1/shares/${created.shareId}/withdraw").status)
        val again = author.client.ok(listOf(doc), listOf(sharee.id))
        assertEquals(1, again.created)
        assertTrue(again.items.single().shareId != created.shareId)
    }

    @Test
    fun `the per-pair daily cap counts a batch as ONE notice - and a capped sharee still gets the shares, silently`() =
        testApplication {
            val fake = startWithFake("sharing.notificationDailyCapPerPair" to "2")
            val author = person("author")
            val sharee = person("sharee")
            val fresh = person("fresh-sharee")
            val audit = LogCapture("ch.nokillswit.audit")
            try {
                suspend fun batchNotices(p: Person) =
                    p.client.notifications().count { it.type == NotificationType.PERFORMANCE_REVIEWS_BATCH_SHARED }
                // Batches of 5 documents each: rows would exhaust a cap of 2 at once, notices do not.
                val one = author.client.ok(List(5) { fake.add(author.id) }, listOf(sharee.id))
                val two = author.client.ok(List(5) { fake.add(author.id) }, listOf(sharee.id))
                assertEquals(2, batchNotices(sharee))
                // The third batch hits the cap: shares created, no notice — and a fresh sharee beside them still gets one.
                val three = author.client.ok(List(5) { fake.add(author.id) }, listOf(sharee.id, fresh.id))
                assertEquals(10, three.created)
                assertEquals(2, batchNotices(sharee))
                assertEquals(1, batchNotices(fresh))
                assertEquals(20L, author.client.byMeTotal())
                val events = audit.batchEvents(author.id)
                assertEquals(listOf("${sharee.id}", "${sharee.id}", "${fresh.id}"), events.map { kv(it, "notifiedShareeIds") })
                assertEquals(3, events.size)
                assertTrue(one.batchId != two.batchId)
            } finally {
                audit.detach()
            }
        }

    @Test
    fun `the chunk bounds - 200 documents by 20 people pass, one more of either is 400`() = testApplication {
        val fake = startWithFake()
        val author = person("author")
        val sharees = List(MAX_BATCH_SHARE_SHAREES) { person("s$it").id }
        val docs = List(MAX_BATCH_SHARE_RESOURCES) { fake.add(author.id) }
        val report = author.client.ok(docs, sharees)
        assertEquals(MAX_BATCH_SHARE_RESOURCES * MAX_BATCH_SHARE_SHAREES, report.created)
        assertEquals(MAX_BATCH_SHARE_RESOURCES * MAX_BATCH_SHARE_SHAREES, report.items.size)
        assertEquals(
            HttpStatusCode.BadRequest,
            author.client.batch(docs + fake.add(author.id), sharees.take(1)).status,
        )
        assertEquals(HttpStatusCode.BadRequest, author.client.batch(docs.take(1), sharees + person("one-more").id).status)
    }

    @Test
    fun `the batch has its OWN per-caller bucket - it never spends the single-share tokens and vice versa`() =
        testApplication {
            // Distinct limits so a mix-up between the two buckets cannot pass by accident.
            startWithFake("sharing.rateLimitPerMinute" to "4", "sharing.batchRateLimitPerMinute" to "3")
            val busy = person("busy")
            val other = person("other")
            val missing = TestShareDocuments.nextId()
            suspend fun single() = busy.client.post("/api/v1/shares") {
                contentType(ContentType.Application.Json)
                setBody(ShareRequest(review, missing, other.id, null))
            }.status
            // The batch bucket (3) is enforced on its own ...
            repeat(3) { assertEquals(HttpStatusCode.NotFound, busy.client.batch(listOf(missing), listOf(other.id)).status) }
            assertEquals(HttpStatusCode.TooManyRequests, busy.client.batch(listOf(missing), listOf(other.id)).status)
            // ... and spent none of the single/withdraw bucket (4): four calls pass, the fifth 429s.
            repeat(3) { assertEquals(HttpStatusCode.NotFound, single()) }
            assertEquals(HttpStatusCode.NotFound, busy.client.post("/api/v1/shares/4000000/withdraw").status)
            assertEquals(HttpStatusCode.TooManyRequests, single())
            // Keyed per caller: someone else's batch still gets through.
            assertEquals(HttpStatusCode.NotFound, other.client.batch(listOf(missing), listOf(busy.id)).status)
            // A fresh caller who exhausts the single bucket is not blocked from the batch.
            val singleOnly = person("single-only")
            repeat(4) { assertEquals(HttpStatusCode.NotFound, singleOnly.client.post("/api/v1/shares/4000000/withdraw").status) }
            assertEquals(HttpStatusCode.TooManyRequests, singleOnly.client.post("/api/v1/shares/4000000/withdraw").status)
            assertEquals(HttpStatusCode.NotFound, singleOnly.client.batch(listOf(missing), listOf(other.id)).status)
        }

    @Test
    fun `an HR user who is a reader in their own right can batch-share, a mere HR auditor cannot`() = testApplication {
        val fake = startWithFake()
        val hr = person("hr-reader", roles = setOf(UserRole.HR))
        val sharee = person("sharee")
        val own = fake.add(hr.id)
        val someoneElses = fake.add(person("elsewhere").id)
        val report = hr.client.ok(listOf(own, someoneElses), listOf(sharee.id))
        assertEquals(listOf(ShareBatchItemStatus.CREATED, ShareBatchItemStatus.FORBIDDEN), report.statuses())
        assertEquals(ShareBatchItem(someoneElses, null, ShareBatchItemStatus.FORBIDDEN, null), report.items[1])
    }

    @Test
    fun `batch sharing is not transitive - a document readable only through a share cannot be batch-shared`() = testApplication {
        val fake = startWithFake()
        val author = person("author")
        val reader = person("share-reader")
        val third = person("third")
        val sharedToReader = fake.add(author.id)
        val ownedByReader = fake.add(reader.id)
        // The author single-shares the first document with the reader: they can open it, but only via the share.
        val response = author.client.post("/api/v1/shares") {
            contentType(ContentType.Application.Json)
            setBody(ShareRequest(review, sharedToReader, reader.id, null))
        }
        assertEquals(HttpStatusCode.Created, response.status)
        // Alone: no shareable document -> the whole request is 403 (and nothing was created).
        val alone = reader.client.batch(listOf(sharedToReader), listOf(third.id))
        assertEquals(HttpStatusCode.Forbidden, alone.status)
        assertEquals(0L, reader.client.byMeTotal())
        // Mixed with a document the reader owns: that item alone is FORBIDDEN.
        val report = reader.client.ok(listOf(sharedToReader, ownedByReader), listOf(third.id))
        assertEquals(listOf(ShareBatchItemStatus.FORBIDDEN, ShareBatchItemStatus.CREATED), report.statuses())
        assertEquals(1, report.created)
        assertEquals(1, report.forbidden)
    }

    @Test
    fun `ALREADY_SHARED leaves the existing share untouched - the batch end date is not applied to it`() = testApplication {
        val fake = startWithFake()
        val author = person("author")
        val sharee = person("sharee")
        val doc = fake.add(author.id)
        val first = author.client.ok(listOf(doc), listOf(sharee.id), "2099-06-30").items.single()
        val replay = author.client.ok(listOf(doc), listOf(sharee.id), "2099-12-31").items.single()
        assertEquals(ShareBatchItemStatus.ALREADY_SHARED, replay.status)
        assertEquals(first.shareId, replay.shareId)
        assertEquals("2099-06-30", author.client.get("/api/v1/shares/${first.shareId}").body<ShareResponse>().expiresOn)
    }

    @Test
    fun `a sharee with the area disabled still gets the rows, hidden from their list like any share`() = testApplication {
        val fake = startWithFake()
        val author = person("author")
        val sharee = person("sharee-off", disabled = setOf(Feature.PERFORMANCE_REVIEWS))
        assertEquals(1, author.client.ok(listOf(fake.add(author.id)), listOf(sharee.id)).created)
        assertEquals(0L, sharee.client.get("/api/v1/shares").body<SharePageResponse>().total)
        assertEquals(1L, author.client.byMeTotal())
    }

    @Test
    fun `the batch route requires authentication`() = testApplication {
        startWithFake()
        assertEquals(HttpStatusCode.Unauthorized, jsonClient().batch(listOf(1u), listOf(2u)).status)
    }
}
