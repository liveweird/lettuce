package ch.nokillswit

import ch.nokillswit.infra.paging.PageRequest
import ch.nokillswit.infra.paging.SortField
import ch.nokillswit.sharing.ShareBatchOutcome
import ch.nokillswit.sharing.ShareCreateOutcome
import ch.nokillswit.sharing.ShareListFilter
import ch.nokillswit.sharing.ShareListView
import ch.nokillswit.sharing.ShareService
import ch.nokillswit.sharing.ShareStatus
import ch.nokillswit.sharing.ShareWithdrawOutcome
import ch.nokillswit.sharing.ShareableResourceType
import ch.nokillswit.users.Feature
import java.time.LocalDate
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.r2dbc.insert
import org.jetbrains.exposed.v1.r2dbc.selectAll
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertIs
import kotlin.test.assertNotEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The document-share store (V86, `document_shares` over the shared Testcontainers Postgres;
 * "today" is an injected clock so the expiry boundary needs no sleeping). Every test seeds its
 * own users — the table is shared, container-wide state — so assertions scope by user id.
 */
class ShareServiceTest {

    private var today: LocalDate = LocalDate.of(2026, 10, 1)

    // One fresh synthetic document pair per test (JUnit builds an instance per test method).
    private val doc = TestShareDocuments.nextId()
    private val otherDoc = TestShareDocuments.nextId()

    private fun service() = ShareService(TestServices.database) { today }

    private suspend fun user(prefix: String = "share-svc"): UInt =
        TestUsers.seed(email = uniqueEmail(prefix), password = "pw-123456789", name = prefix, roles = emptySet())

    private fun page(vararg sort: SortField) =
        PageRequest(page = 1, pageSize = 50, sort = sort.toList().ifEmpty { listOf(SortField("id", false)) })

    private suspend fun ShareService.createdId(
        sharer: UInt,
        sharee: UInt,
        expiresOn: String? = null,
        type: ShareableResourceType = ShareableResourceType.GOAL,
        resourceId: UInt = doc,
    ): UInt = (create(type, resourceId, sharer, sharee, expiresOn) as ShareCreateOutcome.Created).id

    @Test
    fun `a created share reads back with both names and an ACTIVE status`(): Unit = runBlocking {
        val s = service()
        val sharer = user("sharer")
        val sharee = user("sharee")
        val id = s.createdId(sharer, sharee, expiresOn = "2026-12-31")
        val record = checkNotNull(s.read(id))
        assertEquals(ShareableResourceType.GOAL, record.resourceType)
        assertEquals(doc, record.resourceId)
        assertEquals(sharer, record.sharerId)
        assertEquals("sharer", record.sharerName)
        assertEquals(sharee, record.shareeId)
        assertEquals("sharee", record.shareeName)
        assertEquals("2026-12-31", record.expiresOn)
        assertEquals(ShareStatus.ACTIVE, record.status)
        assertNull(record.withdrawnAt)
        assertNull(record.withdrawnById)
        assertNull(record.withdrawnByName)
        assertNull(s.read(4_000_000_000u))
    }

    @Test
    fun `the creation-time details snapshot round-trips through read and list, and is optional`(): Unit = runBlocking {
        val s = service()
        val sharer = user()
        val sharee = user()
        val snapshot = mapOf("title" to "Ünïcode \"title\"", "subordinate" to "Sam")
        val withDetails = (s.create(ShareableResourceType.GOAL, doc, sharer, sharee, null, snapshot)
            as ShareCreateOutcome.Created).id
        val without = s.createdId(sharer, sharee, resourceId = otherDoc)
        assertEquals(snapshot, s.read(withDetails)!!.details)
        assertNull(s.read(without)!!.details)
        val listed = s.list(ShareListFilter(ShareListView.BY_ME, sharer), page()).items.associateBy { it.id }
        assertEquals(snapshot, listed.getValue(withDetails).details)
        assertNull(listed.getValue(without).details)
        assertEquals(today, s.today())
    }

    @Test
    fun `the end date is inclusive - active through that day, expired from the next`(): Unit = runBlocking {
        val s = service()
        val sharer = user()
        val sharee = user()
        val id = s.createdId(sharer, sharee, expiresOn = today.toString())
        assertEquals(ShareStatus.ACTIVE, s.read(id)!!.status)
        assertEquals(listOf(sharer), s.activeSharersFor(ShareableResourceType.GOAL, doc, sharee))

        today = today.plusDays(1)
        assertEquals(ShareStatus.EXPIRED, s.read(id)!!.status)
        assertEquals(emptyList(), s.activeSharersFor(ShareableResourceType.GOAL, doc, sharee))

        // The SQL status predicates agree with the derived status on both sides of the boundary.
        fun filter(status: ShareStatus) =
            ShareListFilter(view = ShareListView.BY_ME, userId = sharer, status = status)
        assertEquals(1L, s.list(filter(ShareStatus.EXPIRED), page()).total)
        assertEquals(0L, s.list(filter(ShareStatus.ACTIVE), page()).total)
        today = today.minusDays(1)
        assertEquals(1L, s.list(filter(ShareStatus.ACTIVE), page()).total)
        assertEquals(0L, s.list(filter(ShareStatus.EXPIRED), page()).total)
    }

    @Test
    fun `an open-ended share never expires`(): Unit = runBlocking {
        val s = service()
        val sharer = user()
        val sharee = user()
        val id = s.createdId(sharer, sharee, expiresOn = null)
        today = today.plusYears(50)
        assertEquals(ShareStatus.ACTIVE, s.read(id)!!.status)
    }

    @Test
    fun `an active duplicate answers Duplicate with the existing id, other keys do not clash`(): Unit = runBlocking {
        val s = service()
        val sharer = user()
        val sharee = user()
        val first = s.createdId(sharer, sharee)
        val dup = s.create(ShareableResourceType.GOAL, doc, sharer, sharee, "2027-01-01")
        assertIs<ShareCreateOutcome.Duplicate>(dup)
        assertEquals(first, dup.existingId)

        // Another document, another type, another sharee, another sharer — all distinct keys.
        assertIs<ShareCreateOutcome.Created>(s.create(ShareableResourceType.GOAL, otherDoc, sharer, sharee, null))
        assertIs<ShareCreateOutcome.Created>(s.create(ShareableResourceType.FEEDBACK, doc, sharer, sharee, null))
        assertIs<ShareCreateOutcome.Created>(s.create(ShareableResourceType.GOAL, doc, sharer, user(), null))
        assertIs<ShareCreateOutcome.Created>(s.create(ShareableResourceType.GOAL, doc, user(), sharee, null))
    }

    @Test
    fun `an expired or withdrawn share never blocks a fresh one`(): Unit = runBlocking {
        val s = service()
        val sharer = user()
        val sharee = user()
        val expiring = s.createdId(sharer, sharee, expiresOn = today.toString())
        today = today.plusDays(1)
        val afterExpiry = s.createdId(sharer, sharee)
        assertNotEquals(expiring, afterExpiry)

        assertIs<ShareWithdrawOutcome.Withdrawn>(s.withdraw(afterExpiry, sharer))
        val afterWithdraw = s.createdId(sharer, sharee)
        assertNotEquals(afterExpiry, afterWithdraw)
        assertEquals(ShareStatus.ACTIVE, s.read(afterWithdraw)!!.status)
    }

    @Test
    fun `N concurrent identical creates yield exactly one share`(): Unit = runBlocking {
        val s = service()
        val sharer = user()
        val sharee = user()
        val outcomes = coroutineScope {
            List(8) { async(Dispatchers.IO) { s.create(ShareableResourceType.GOAL, doc, sharer, sharee, null) } }.awaitAll()
        }
        assertEquals(1, outcomes.count { it is ShareCreateOutcome.Created })
        val created = outcomes.filterIsInstance<ShareCreateOutcome.Created>().single()
        val duplicates = outcomes.filterIsInstance<ShareCreateOutcome.Duplicate>()
        assertEquals(7, duplicates.size)
        assertTrue(duplicates.all { it.existingId == created.id })
        assertEquals(1L, s.list(ShareListFilter(ShareListView.BY_ME, sharer), page()).total)
    }

    @Test
    fun `withdraw is a terminal stamp - repeat is AlreadyWithdrawn, unknown is NotFound`(): Unit = runBlocking {
        val s = service()
        val sharer = user("sharer")
        val author = user("author")
        val sharee = user()
        val id = s.createdId(sharer, sharee)

        val outcome = s.withdraw(id, author)
        assertIs<ShareWithdrawOutcome.Withdrawn>(outcome)
        assertTrue(outcome.wasActive)
        assertEquals(ShareStatus.WITHDRAWN, outcome.record.status)
        assertEquals(author, outcome.record.withdrawnById)
        assertEquals("author", outcome.record.withdrawnByName)
        assertTrue(outcome.record.withdrawnAt != null)

        assertEquals(ShareWithdrawOutcome.AlreadyWithdrawn, s.withdraw(id, sharer))
        assertEquals(author, s.read(id)!!.withdrawnById, "the first stamp survives a repeat")
        assertEquals(ShareWithdrawOutcome.NotFound, s.withdraw(4_000_000_000u, sharer))
        assertEquals(emptyList(), s.activeSharersFor(ShareableResourceType.GOAL, doc, sharee))
    }

    @Test
    fun `withdrawing an expired share stamps it but reports it was not active`(): Unit = runBlocking {
        val s = service()
        val sharer = user()
        val id = s.createdId(sharer, user(), expiresOn = today.toString())
        today = today.plusDays(3)
        val outcome = s.withdraw(id, sharer)
        assertIs<ShareWithdrawOutcome.Withdrawn>(outcome)
        assertEquals(false, outcome.wasActive)
        // WITHDRAWN beats EXPIRED in the derived status.
        assertEquals(ShareStatus.WITHDRAWN, s.read(id)!!.status)
    }

    @Test
    fun `activeSharersFor lists only active sharers of that document for that sharee, oldest first`(): Unit = runBlocking {
        val s = service()
        val sharee = user()
        val first = user()
        val second = user()
        val withdrawn = user()
        val expired = user()
        val elsewhere = user()
        s.createdId(first, sharee)
        s.createdId(second, sharee, expiresOn = "2027-01-01")
        val gone = s.createdId(withdrawn, sharee)
        s.withdraw(gone, withdrawn)
        s.createdId(expired, sharee, expiresOn = today.minusDays(1).toString())
        s.createdId(elsewhere, sharee, resourceId = otherDoc)
        assertEquals(listOf(first, second), s.activeSharersFor(ShareableResourceType.GOAL, doc, sharee))
        assertEquals(listOf(elsewhere), s.activeSharersFor(ShareableResourceType.GOAL, otherDoc, sharee))
        assertEquals(emptyList(), s.activeSharersFor(ShareableResourceType.FEEDBACK, doc, sharee))
    }

    @Test
    fun `withMe hides withdrawn rows and the types of disabled features, in rows and total`(): Unit = runBlocking {
        val s = service()
        val sharee = user()
        val sharer = user()
        val goal = s.createdId(sharer, sharee, type = ShareableResourceType.GOAL)
        val feedback = s.createdId(sharer, sharee, type = ShareableResourceType.FEEDBACK)
        val withdrawn = s.createdId(sharer, sharee, type = ShareableResourceType.TEAM_KPI)
        s.withdraw(withdrawn, sharer)
        // Expired rows still show on withMe (only WITHDRAWN is hidden).
        val expired = s.createdId(sharer, sharee, type = ShareableResourceType.IMPACT_LOG_ENTRY, expiresOn = "2026-09-01")

        fun withMe(disabled: Set<Feature> = emptySet()) =
            ShareListFilter(ShareListView.WITH_ME, sharee, disabledFeatures = disabled)
        val all = s.list(withMe(), page())
        assertEquals(setOf(goal, feedback, expired), all.items.map { it.id }.toSet())
        assertEquals(3L, all.total)

        val noGoals = s.list(withMe(setOf(Feature.GOALS)), page())
        assertEquals(setOf(feedback, expired), noGoals.items.map { it.id }.toSet())
        assertEquals(2L, noGoals.total)

        // byMe, from the sharer's side, shows everything including the withdrawn row.
        val byMe = s.list(ShareListFilter(ShareListView.BY_ME, sharer), page())
        assertEquals(4L, byMe.total)
        assertEquals(setOf(ShareStatus.ACTIVE, ShareStatus.WITHDRAWN, ShareStatus.EXPIRED), byMe.items.map { it.status }.toSet())
    }

    @Test
    fun `the document view pins the document and optionally one sharer, filters compose, paging reports the total`(): Unit = runBlocking {
        val s = service()
        val sharee = user()
        val a = user()
        val b = user()
        s.createdId(a, sharee, resourceId = doc, expiresOn = "2027-02-01")
        s.createdId(b, sharee, resourceId = doc)
        s.createdId(a, sharee, resourceId = otherDoc)
        s.createdId(a, sharee, type = ShareableResourceType.FEEDBACK, resourceId = doc)

        fun doc(scope: UInt? = null, status: ShareStatus? = null) = ShareListFilter(
            view = ShareListView.DOCUMENT,
            userId = a,
            resourceType = ShareableResourceType.GOAL,
            resourceId = doc,
            status = status,
            documentSharerScope = scope,
        )
        assertEquals(2L, s.list(doc(), page()).total)
        assertEquals(listOf(a), s.list(doc(scope = a), page()).items.map { it.sharerId })
        assertEquals(0L, s.list(doc(status = ShareStatus.WITHDRAWN), page()).total)

        // Paging: total is the pre-pagination count; sorting by expiresOn is accepted.
        val one = s.list(doc(), PageRequest(page = 2, pageSize = 1, sort = listOf(SortField("expiresOn", true), SortField("id", false))))
        assertEquals(2L, one.total)
        assertEquals(1, one.items.size)
    }

    @Test
    fun `a stored type this build does not know is invisible rather than fatal`(): Unit = runBlocking {
        val s = service()
        val sharer = user()
        val sharee = user()
        val id = s.createdId(sharer, sharee)
        val orphan = suspendTransaction(TestServices.database) {
            ShareService.DocumentShares.insert {
                it[resourceType] = "RETIRED_TYPE"
                it[resourceId] = doc
                it[sharerId] = sharer
                it[shareeId] = sharee
                it[createdAt] = System.currentTimeMillis()
            }[ShareService.DocumentShares.id].value
        }
        assertNull(s.read(orphan))
        val rows = s.list(ShareListFilter(ShareListView.BY_ME, sharer), page())
        assertEquals(listOf(id), rows.items.map { it.id })
        assertEquals(1L, rows.total)
    }

    @Test
    fun `the schema itself refuses a self-share and a half-stamped withdrawal`(): Unit = runBlocking {
        val sharer = user()
        val sharee = user()
        assertFailsWith<Exception> {
            suspendTransaction(TestServices.database) {
                ShareService.DocumentShares.insert {
                    it[resourceType] = ShareableResourceType.GOAL.name
                    it[resourceId] = doc
                    it[sharerId] = sharer
                    it[shareeId] = sharer
                    it[createdAt] = 1L
                }
            }
        }
        assertFailsWith<Exception> {
            suspendTransaction(TestServices.database) {
                ShareService.DocumentShares.insert {
                    it[resourceType] = ShareableResourceType.GOAL.name
                    it[resourceId] = doc
                    it[sharerId] = sharer
                    it[shareeId] = sharee
                    it[createdAt] = 1L
                    it[withdrawnAt] = 2L
                }
            }
        }
    }

    // ---- Mass share (v4.10.0, V91 batch_id) ----

    private suspend fun batchIdsOf(sharer: UInt): Map<UInt, String?> =
        suspendTransaction(TestServices.database) {
            ShareService.DocumentShares.selectAll()
                .where { ShareService.DocumentShares.sharerId eq sharer }
                .map { it[ShareService.DocumentShares.id].value to it[ShareService.DocumentShares.batchId] }
                .toList()
                .toMap()
        }

    private suspend fun ShareService.batch(
        sharer: UInt,
        docs: List<UInt>,
        sharees: List<UInt>,
        cap: Int = Int.MAX_VALUE,
        expiresOn: String? = null,
        details: Map<UInt, Map<String, String>> = emptyMap(),
    ): ShareBatchOutcome =
        createBatch(ShareableResourceType.PERFORMANCE_REVIEW, docs, sharer, sharees, expiresOn, details, cap)

    private fun docs(n: Int): List<UInt> = List(n) { TestShareDocuments.nextId() }

    @Test
    fun `a mixed batch creates new pairs under one batch id and reports active pairs as duplicates`(): Unit = runBlocking {
        val s = service()
        val sharer = user("sharer")
        val a = user("a")
        val b = user("b")
        val (d1, d2, d3) = docs(3)
        val type = ShareableResourceType.PERFORMANCE_REVIEW
        // Pre-existing: d1->a ACTIVE (the duplicate), d2->a EXPIRED, d2->b WITHDRAWN: neither may block.
        val active = (s.create(type, d1, sharer, a, null) as ShareCreateOutcome.Created).id
        val expired = (s.create(type, d2, sharer, a, today.toString()) as ShareCreateOutcome.Created).id
        val withdrawn = (s.create(type, d2, sharer, b, null) as ShareCreateOutcome.Created).id
        s.withdraw(withdrawn, sharer)
        today = today.plusDays(1)

        val outcome = s.batch(sharer, listOf(d1, d2, d3), listOf(a, b), expiresOn = "2027-03-01")

        assertEquals(listOf(d1 to a), outcome.duplicates.map { it.resourceId to it.shareeId })
        assertEquals(active, outcome.duplicates.single().existingId)
        assertEquals(
            listOf(d1 to b, d2 to a, d2 to b, d3 to a, d3 to b),
            outcome.created.map { it.resourceId to it.shareeId },
        )
        val ids = outcome.created.map { it.id }
        assertEquals(5, ids.toSet().size)
        assertTrue(ids.none { it == active || it == expired || it == withdrawn })

        // Every created row carries the batch's id (and the ONE end date); the pre-existing singles stay NULL.
        val stored = batchIdsOf(sharer)
        assertTrue(ids.all { stored[it] == outcome.batchId })
        assertEquals(listOf(null, null, null), listOf(active, expired, withdrawn).map { stored[it] })
        assertEquals(36, outcome.batchId.length)
        ids.forEach {
            val row = s.read(it)!!
            assertEquals(ShareStatus.ACTIVE, row.status)
            assertEquals("2027-03-01", row.expiresOn)
        }
        assertEquals(setOf(a, b), outcome.notifiedSharees)

        // A replay is idempotent in effect: every pair is a duplicate pointing at the first run's rows.
        val replay = s.batch(sharer, listOf(d1, d2, d3), listOf(a, b))
        assertEquals(emptyList(), replay.created)
        assertEquals(6, replay.duplicates.size)
        assertEquals(emptySet(), replay.notifiedSharees)
        assertEquals(
            ids.toSet() + active,
            replay.duplicates.map { it.existingId }.toSet(),
        )
        assertEquals(1 + 2 + 5, batchIdsOf(sharer).size, "the replay inserted nothing")
    }

    @Test
    fun `the details snapshot is stored per document, absent documents store none`(): Unit = runBlocking {
        val s = service()
        val sharer = user()
        val sharee = user()
        val (d1, d2) = docs(2)
        val snap = mapOf("subordinate" to "Sam", "startMonth" to "2026-01")
        val outcome = s.batch(sharer, listOf(d1, d2), listOf(sharee), details = mapOf(d1 to snap))
        val byDoc = outcome.created.associate { it.resourceId to s.read(it.id)!! }
        assertEquals(snap, byDoc.getValue(d1).details)
        assertNull(byDoc.getValue(d2).details)
    }

    @Test
    fun `an empty batch does nothing`(): Unit = runBlocking {
        val s = service()
        val sharer = user()
        val outcome = s.batch(sharer, emptyList(), listOf(user()))
        assertEquals(emptyList(), outcome.created)
        assertEquals(emptyList(), outcome.duplicates)
        assertEquals(emptySet(), outcome.notifiedSharees)
        assertEquals(emptyMap(), batchIdsOf(sharer))
    }

    @Test
    fun `the daily notice cap counts a whole batch as ONE notice`(): Unit = runBlocking {
        val s = service()
        val sharer = user()
        val sharee = user()
        // 25 rows to one person is still a single summary notice, so a single share afterwards is
        // within a cap of 20 (with row counting it would already be at 25 and silent).
        val big = s.batch(sharer, docs(25), listOf(sharee), cap = 20)
        assertEquals(25, big.created.size)
        assertEquals(setOf(sharee), big.notifiedSharees)
        val single = s.create(ShareableResourceType.GOAL, doc, sharer, sharee, null, null, notificationCap = 20)
        assertTrue((single as ShareCreateOutcome.Created).notify)

        // Notices so far: the batch + the single = 2. A SECOND batch still notifies under cap 3
        // (it adds one notice, not 25), and the next one is then silent (3 notices = the cap).
        assertEquals(setOf(sharee), s.batch(sharer, docs(25), listOf(sharee), cap = 3).notifiedSharees)
        assertEquals(emptySet(), s.batch(sharer, docs(25), listOf(sharee), cap = 3).notifiedSharees)
    }

    @Test
    fun `cap 2 - batch then single then single, the third notice is silent`(): Unit = runBlocking {
        val s = service()
        val sharer = user()
        val sharee = user()
        val other = user()
        assertEquals(setOf(sharee, other), s.batch(sharer, docs(10), listOf(sharee, other), cap = 2).notifiedSharees)
        val first = s.create(ShareableResourceType.GOAL, doc, sharer, sharee, null, null, notificationCap = 2)
        val second = s.create(ShareableResourceType.GOAL, otherDoc, sharer, sharee, null, null, notificationCap = 2)
        assertTrue((first as ShareCreateOutcome.Created).notify)
        assertEquals(false, (second as ShareCreateOutcome.Created).notify)
    }

    @Test
    fun `the cap is per sharee - a batch to two people decides each independently`(): Unit = runBlocking {
        val s = service()
        val sharer = user()
        val saturated = user()
        val fresh = user()
        val type = ShareableResourceType.GOAL
        repeat(2) { s.create(type, TestShareDocuments.nextId(), sharer, saturated, null, null, 2) }
        val outcome = s.batch(sharer, docs(3), listOf(saturated, fresh), cap = 2)
        assertEquals(6, outcome.created.size, "the cap never blocks a share, only its notice")
        assertEquals(setOf(fresh), outcome.notifiedSharees)
    }

    @Test
    fun `withdrawals still count per row, so a batch of three then three withdrawals exhausts cap 3 at the third`(): Unit = runBlocking {
        val s = service()
        val sharer = user()
        val sharee = user()
        val batch = s.batch(sharer, docs(3), listOf(sharee), cap = 3)
        assertEquals(setOf(sharee), batch.notifiedSharees)
        val outcomes = batch.created.map { s.withdraw(it.id, sharer, notificationCap = 3) as ShareWithdrawOutcome.Withdrawn }
        // counts before each withdrawal: 1 (the batch), 2, 3 -> the third is at the cap.
        assertEquals(listOf(true, true, false), outcomes.map { it.notify })
    }

    @Test
    fun `N concurrent identical batches yield exactly one set of rows`(): Unit = runBlocking {
        val s = service()
        val sharer = user()
        val sharees = listOf(user(), user())
        val documents = docs(4)
        val outcomes = coroutineScope {
            List(6) { async(Dispatchers.IO) { s.batch(sharer, documents, sharees) } }.awaitAll()
        }
        assertEquals(8, outcomes.sumOf { it.created.size })
        assertEquals(1, outcomes.count { it.created.isNotEmpty() })
        val winner = outcomes.single { it.created.isNotEmpty() }
        val losers = outcomes.filter { it.created.isEmpty() }
        assertTrue(losers.all { it.duplicates.size == 8 && it.notifiedSharees.isEmpty() })
        assertTrue(losers.all { l -> l.duplicates.map { it.existingId }.toSet() == winner.created.map { it.id }.toSet() })
        assertEquals(8, batchIdsOf(sharer).size)
        assertEquals(setOf(winner.batchId), batchIdsOf(sharer).values.toSet())
        assertEquals(sharees.toSet(), winner.notifiedSharees)
    }
}
