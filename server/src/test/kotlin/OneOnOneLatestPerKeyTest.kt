package ch.nokillswit

import ch.nokillswit.infra.paging.PageRequest
import ch.nokillswit.infra.paging.SortField
import ch.nokillswit.oneonones.ActionItemOwner
import ch.nokillswit.oneonones.OneOnOneActionItemInput
import ch.nokillswit.oneonones.OneOnOneCreateRequest
import ch.nokillswit.oneonones.OneOnOneListFilter
import ch.nokillswit.oneonones.OneOnOneListView
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The set-at-a-time "latest meeting per key" statement (v4.14.0, `OneOnOneService.latestPerKey` and
 * the list's per-pair `isLatest` lookup — one DISTINCT ON statement each) against its oracle, the
 * single-pair `read(id).isLatest` / chronology rules: same canonical `(meeting_date DESC, id DESC)`
 * ordering, directional, soft-deleted rows ignored, keys without a meeting absent.
 */
class OneOnOneLatestPerKeyTest {

    private val service get() = TestServices.oneOnOnes

    private suspend fun meeting(
        managerId: UInt,
        subordinateId: UInt,
        date: String,
        openItems: Int = 0,
    ): UInt = service.create(
        managerId,
        OneOnOneCreateRequest(
            subordinateId = subordinateId,
            meetingDate = date,
            actionItems = List(openItems) {
                OneOnOneActionItemInput(content = "item $it", owner = ActionItemOwner.MANAGER)
            },
        ),
    ).id

    private suspend fun user(prefix: String): UInt =
        TestUsers.seed(email = uniqueEmail(prefix), password = "pw", name = prefix, roles = emptySet())

    private val idPaging = PageRequest(page = 1, pageSize = 100, sort = listOf(SortField("id", descending = false)))

    @Test
    fun `latest per subordinate matches the pair's chronology - ties, deletions, gaps and direction`() = testApplication {
        usePostgresTestcontainer()
        val manager = user("lpk-manager")
        val tied = user("lpk-tied")
        val deletedNewest = user("lpk-deleted")
        val none = user("lpk-none")
        val reversedOnly = user("lpk-reversed")
        val plain = user("lpk-plain")

        // Same-date pair: the higher id must win (id DESC tie-break). Unresolved items carry over,
        // so the winner shows 1 (carried) + 2 (own) = 3 open — a loser's count would be 1.
        meeting(manager, tied, "2026-03-01", openItems = 1)
        val tiedLatest = meeting(manager, tied, "2026-03-01", openItems = 2)
        // Newest meeting soft-deleted: falls back to the previous one.
        val older = meeting(manager, deletedNewest, "2026-01-10", openItems = 1)
        val newest = meeting(manager, deletedNewest, "2026-02-10", openItems = 3)
        TestOneOnOneMaintenance.softDeleteMeeting(newest)
        // Reversed direction only: the other person ran a meeting with the manager as THEIR report.
        meeting(reversedOnly, manager, "2026-04-01", openItems = 1)
        // A plain pair with zero open items — 0, never null/absent.
        meeting(manager, plain, "2026-05-01")

        val stats = service.latestMeetingStatsBySubordinate(
            manager,
            setOf(tied, deletedNewest, none, reversedOnly, plain),
        )
        assertEquals(setOf(tied, deletedNewest, plain), stats.keys)
        assertEquals("2026-03-01", stats.getValue(tied).meetingDate)
        assertEquals(3, stats.getValue(tied).openActionItemCount)
        assertEquals("2026-01-10", stats.getValue(deletedNewest).meetingDate)
        assertEquals(1, stats.getValue(deletedNewest).openActionItemCount)
        assertEquals("2026-05-01", stats.getValue(plain).meetingDate)
        assertEquals(0, stats.getValue(plain).openActionItemCount)
        assertNull(stats[none])
        assertNull(stats[reversedOnly])

        // The oracle: the single-pair read flags exactly these meetings as the pair's latest.
        assertTrue(assertNotNull(service.read(tiedLatest)).isLatest)
        assertTrue(assertNotNull(service.read(older)).isLatest)

        // Keys outside the requested set never leak in.
        assertEquals(setOf(tied), service.latestMeetingStatsBySubordinate(manager, setOf(tied)).keys)
        assertEquals(emptyMap(), service.latestMeetingStatsBySubordinate(manager, emptySet()))
    }

    @Test
    fun `latest per manager is the exact mirror and stays directional`() = testApplication {
        usePostgresTestcontainer()
        val subordinate = user("lpk-sub")
        val upper = user("lpk-upper")
        val lower = user("lpk-lower")
        val noMeeting = user("lpk-nomeet")
        val reversed = user("lpk-rev")

        meeting(upper, subordinate, "2026-02-01", openItems = 2)
        // Same date, higher id: wins, with the 2 carried-over items + 1 of its own = 3 open.
        val upperLatest = meeting(upper, subordinate, "2026-02-01", openItems = 1)
        meeting(lower, subordinate, "2026-06-01")
        val lowerLatest = meeting(lower, subordinate, "2026-07-01", openItems = 1)
        // The subordinate as manager of `reversed`: must not count for (managers of subordinate).
        meeting(subordinate, reversed, "2026-08-01", openItems = 1)

        val stats = service.latestMeetingStats(setOf(upper, lower, noMeeting, reversed), subordinate)
        assertEquals(setOf(upper, lower), stats.keys)
        assertEquals("2026-02-01", stats.getValue(upper).meetingDate)
        assertEquals(3, stats.getValue(upper).openActionItemCount)
        assertEquals("2026-07-01", stats.getValue(lower).meetingDate)
        assertEquals(1, stats.getValue(lower).openActionItemCount)
        assertTrue(assertNotNull(service.read(upperLatest)).isLatest)
        assertTrue(assertNotNull(service.read(lowerLatest)).isLatest)
        assertEquals(emptyMap(), service.latestMeetingStats(emptySet(), subordinate))
    }

    @Test
    fun `list flags exactly one latest row per pair`() = testApplication {
        usePostgresTestcontainer()
        val manager = user("lpk-list-mgr")
        val a = user("lpk-list-a")
        val b = user("lpk-list-b")
        val c = user("lpk-list-c")

        val aIds = listOf(
            meeting(manager, a, "2026-01-01"),
            meeting(manager, a, "2026-02-01"),
            meeting(manager, a, "2026-02-01"), // same-date tie: the highest id is the latest
        )
        val bIds = listOf(meeting(manager, b, "2026-01-05"), meeting(manager, b, "2026-03-05"))
        val cKept = meeting(manager, c, "2026-03-01")
        val cDeleted = meeting(manager, c, "2026-04-01")
        TestOneOnOneMaintenance.softDeleteMeeting(cDeleted)

        val page = service.list(OneOnOneListView.MANAGED, manager, OneOnOneListFilter(), idPaging)
        assertEquals(6, page.items.size) // the soft-deleted meeting is not listed
        assertEquals(setOf(aIds[2], bIds[1], cKept), page.items.filter { it.isLatest }.map { it.id }.toSet())
        assertEquals(3, page.items.count { it.isLatest })
        assertFalse(page.items.first { it.id == aIds[1] }.isLatest)

        // A page showing only OLD rows of a pair still flags them correctly (the lookup is
        // pair-wide, not page-wide): narrow the list down to the early dates.
        val old = service.list(
            OneOnOneListView.MANAGED,
            manager,
            OneOnOneListFilter(meetingDateLte = "2026-01-31"),
            idPaging,
        )
        assertEquals(setOf(aIds[0], bIds[0]), old.items.map { it.id }.toSet())
        assertTrue(old.items.none { it.isLatest })
    }
}
