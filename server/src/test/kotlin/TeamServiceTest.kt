package ch.nokillswit

import ch.nokillswit.infra.paging.PageRequest
import ch.nokillswit.infra.paging.SortField
import ch.nokillswit.authz.ConflictException
import ch.nokillswit.teams.Team
import ch.nokillswit.teams.TeamListFilter
import ch.nokillswit.teams.TeamMemberListFilter
import ch.nokillswit.teams.TeamMemberListView
import ch.nokillswit.teams.TeamService
import io.ktor.server.plugins.BadRequestException
import io.ktor.server.testing.testApplication
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Service-level contracts of [ch.nokillswit.teams.TeamService] the routes cannot exercise: the
 * member routes 404 on a missing team before addMember runs, blank filter params are stripped by
 * optionalString, and the member-list route's sort whitelist does not expose teamId (the service
 * supports it and uses it as the stability tiebreaker). testApplication boots so Flyway has run.
 */
class TeamServiceTest {


    private val paging = PageRequest(page = 1, pageSize = 100, sort = listOf(SortField("id", descending = false)))

    @Test
    fun `addMember and removeMember signal a missing team with null`() = testApplication {
        usePostgresTestcontainer()
        val userId = TestUsers.seed(email = uniqueEmail("member"), password = "pw")
        assertNull(TestServices.teams.addMember(999_999_999u, userId))
        assertNull(TestServices.teams.removeMember(999_999_999u, userId))

        // A soft-deleted team is indistinguishable from a missing one.
        val managerId = TestUsers.seed(email = uniqueEmail("manager"), password = "pw")
        val teamId = TestServices.teams.create(Team(name = "gone-${UUID.randomUUID()}", managerId = managerId))
        TestServices.teams.delete(teamId)
        assertNull(TestServices.teams.addMember(teamId, userId))
        assertNull(TestServices.teams.removeMember(teamId, userId))
    }

    @Test
    fun `addMember and removeMember report whether membership actually changed`() = testApplication {
        usePostgresTestcontainer()
        val managerId = TestUsers.seed(email = uniqueEmail("manager"), password = "pw")
        val userId = TestUsers.seed(email = uniqueEmail("member"), password = "pw")
        val teamId = TestServices.teams.create(Team(name = "delta-${UUID.randomUUID()}", managerId = managerId))

        assertEquals(true, TestServices.teams.addMember(teamId, userId))
        assertEquals(false, TestServices.teams.addMember(teamId, userId)) // already a member
        assertEquals(true, TestServices.teams.removeMember(teamId, userId))
        assertEquals(false, TestServices.teams.removeMember(teamId, userId)) // was not a member

        // The manager-as-member rule is a genuine 400 and stays an exception.
        val failure = assertFailsWith<BadRequestException> {
            TestServices.teams.addMember(teamId, managerId)
        }
        assertTrue(failure.message!!.contains("Manager"))
    }

    @Test
    fun `blank team name filter is treated as absent`() = testApplication {
        usePostgresTestcontainer()
        val managerId = TestUsers.seed(email = uniqueEmail("manager"), password = "pw")
        val teamId = TestServices.teams.create(Team(name = "blankprobe-${UUID.randomUUID()}", managerId = managerId))

        // The team name contains no space, so a literally-applied blank filter (LIKE '% %')
        // would exclude it — its presence proves blank means "no filter".
        val page = TestServices.teams.list(TeamListFilter(name = " ", managerId = managerId), paging)
        assertEquals(listOf(teamId), page.items.map { it.id })
    }

    @Test
    fun `blank member name and email filters are treated as absent`() = testApplication {
        usePostgresTestcontainer()
        val managerId = TestUsers.seed(email = uniqueEmail("manager"), password = "pw")
        val memberId = TestUsers.seed(email = uniqueEmail("member"), password = "pw")
        TestServices.teams.create(
            Team(name = "team-${UUID.randomUUID()}", managerId = managerId, memberIds = listOf(memberId)),
        )

        val page = TestServices.teams.listMembers(
            view = TeamMemberListView.MANAGED,
            callerUserId = managerId,
            filter = TeamMemberListFilter(name = " ", email = " "),
            paging = paging,
        )
        assertEquals(listOf(memberId), page.items.map { it.userId })

        // Control: a non-blank, non-matching name does exclude the member.
        val excluded = TestServices.teams.listMembers(
            view = TeamMemberListView.MANAGED,
            callerUserId = managerId,
            filter = TeamMemberListFilter(name = "no-such-member-name"),
            paging = paging,
        )
        assertTrue(excluded.items.isEmpty())
    }

    @Test
    fun `listMembers honours an explicit teamId sort`() = testApplication {
        usePostgresTestcontainer()
        val managerId = TestUsers.seed(email = uniqueEmail("manager"), password = "pw")
        val memberA = TestUsers.seed(email = uniqueEmail("member-a"), password = "pw")
        val memberB = TestUsers.seed(email = uniqueEmail("member-b"), password = "pw")
        val teamOne = TestServices.teams.create(
            Team(name = "one-${UUID.randomUUID()}", managerId = managerId, memberIds = listOf(memberA)),
        )
        val teamTwo = TestServices.teams.create(
            Team(name = "two-${UUID.randomUUID()}", managerId = managerId, memberIds = listOf(memberB)),
        )

        // When the caller already sorts by teamId the service must not append its duplicate
        // tiebreaker — the requested (descending) order wins.
        val page = TestServices.teams.listMembers(
            view = TeamMemberListView.MANAGED,
            callerUserId = managerId,
            filter = TeamMemberListFilter(),
            paging = paging.copy(sort = listOf(SortField("teamId", descending = true), SortField("id", descending = false))),
        )
        assertEquals(listOf(teamTwo, teamOne), page.items.map { it.teamId })
        assertTrue(teamTwo > teamOne, "sanity: ids are assigned in creation order")
    }

    // ——— V93: today semantics of the dated structure ———

    /** "Today" of this test, read ONCE: every service below and every expectation share it, so a run
     *  crossing midnight cannot disagree with itself. */
    private val today: java.time.LocalDate = java.time.LocalDate.now()

    private fun iso(days: Long) = today.plusDays(days).toString()

    /** A service whose "today" is [daysAgo] days before the test's fixed today — rows it writes start then. */
    private fun serviceFrom(daysAgo: Long) =
        TeamService(TestServices.database, clock = { today.minusDays(daysAgo) })

    private suspend fun seedUser(prefix: String) = TestUsers.seed(email = uniqueEmail(prefix), password = "pw", roles = emptySet())

    @Test
    fun `a rename keeps the membership history, the roster delta touches only the changed people`() = testApplication {
        usePostgresTestcontainer()
        val manager = seedUser("m")
        val stays = seedUser("stays")
        val leaves = seedUser("leaves")
        val joins = seedUser("joins")
        val teamId = serviceFrom(5).create(Team("hist-${UUID.randomUUID()}", manager, listOf(stays, leaves)))
        val before = membershipRecords(teamId)
        assertTrue(before.all { it.start == iso(-5) && it.end == null })

        assertEquals(1, serviceFrom(0).update(teamId, Team("renamed-${UUID.randomUUID()}", manager, listOf(stays, joins))))

        val after = membershipRecords(teamId)
        val stayRow = after.single { it.userId == stays }
        assertEquals(before.single { it.userId == stays }, stayRow, "an unchanged member's row is untouched, not re-inserted")
        assertEquals(iso(-1), after.single { it.userId == leaves }.end, "a removed member's period ends yesterday")
        assertEquals(iso(0), after.single { it.userId == joins }.start)
        assertNull(after.single { it.userId == joins }.end)
        assertEquals(listOf(stays, joins).sorted(), assertNotNull(serviceFrom(0).read(teamId)).memberIds.sorted())
        assertEquals(1, periodRecords(teamId).size, "an unchanged manager adds no period")
    }

    @Test
    fun `removing today ends yesterday, a same-day add and remove leaves no trace, adding twice is idempotent`() = testApplication {
        usePostgresTestcontainer()
        val manager = seedUser("m")
        val old = seedUser("old")
        val fresh = seedUser("fresh")
        val teamId = serviceFrom(3).create(Team("rm-${UUID.randomUUID()}", manager, listOf(old)))

        val left = assertNotNull(serviceFrom(0).leaveTeam(teamId, old))
        assertTrue(left.changed && !left.hardDeleted)
        assertEquals(iso(-1), left.endDate)
        assertEquals(iso(-1), membershipRecords(teamId).single { it.userId == old }.end)

        val joined = assertNotNull(serviceFrom(0).joinTeam(teamId, fresh))
        assertTrue(joined.changed)
        assertEquals(iso(0), joined.startDate)
        assertFalse(assertNotNull(serviceFrom(0).joinTeam(teamId, fresh)).changed, "already current")
        assertEquals(1, membershipRecords(teamId).count { it.userId == fresh })

        val gone = assertNotNull(serviceFrom(0).leaveTeam(teamId, fresh))
        assertTrue(gone.changed && gone.hardDeleted)
        assertNull(gone.endDate)
        assertTrue(membershipRecords(teamId).none { it.userId == fresh }, "a period that started today is hard-deleted")
        assertFalse(assertNotNull(serviceFrom(0).leaveTeam(teamId, fresh)).changed)

        // The same-day undo of a removal reopens the period that ended yesterday — no second row.
        val oldRow = membershipRecords(teamId).single { it.userId == old }
        val undo = assertNotNull(serviceFrom(0).joinTeam(teamId, old))
        assertTrue(undo.changed && undo.reopened)
        assertEquals(oldRow.id.toLong(), undo.membershipId?.toLong())
        assertEquals(listOf(MembershipRecord(oldRow.id, old, iso(-3), null)), membershipRecords(teamId).filter { it.userId == old })

        // Rejoining after a period that ended EARLIER is a NEW period next to the closed one.
        val earlier = seedUser("earlier")
        insertMembershipRow(teamId, earlier, iso(-9), iso(-5))
        val rejoin = assertNotNull(serviceFrom(0).joinTeam(teamId, earlier))
        assertTrue(rejoin.changed && !rejoin.reopened)
        assertEquals(listOf(iso(-9), iso(0)), membershipRecords(teamId).filter { it.userId == earlier }.map { it.start })
    }

    @Test
    fun `the PUT roster path also reopens a period removed earlier the same day`() = testApplication {
        usePostgresTestcontainer()
        val manager = seedUser("m")
        val member = seedUser("member")
        val teamId = serviceFrom(4).create(Team("undo-${UUID.randomUUID()}", manager, listOf(member)))
        val original = membershipRecords(teamId).single()

        assertEquals(1, serviceFrom(0).update(teamId, Team("undo", manager, emptyList())))
        assertEquals(iso(-1), membershipRecords(teamId).single().end)
        assertEquals(1, serviceFrom(0).update(teamId, Team("undo", manager, listOf(member))))

        assertEquals(listOf(original), membershipRecords(teamId), "reopened in place: same row, end back to NULL")
    }

    @Test
    fun `a future period of the same pair blocks joining today with a 409`() = testApplication {
        usePostgresTestcontainer()
        val manager = seedUser("m")
        val futureMember = seedUser("future")
        val teamId = serviceFrom(0).create(Team("fut-${UUID.randomUUID()}", manager))
        insertMembershipRow(teamId, futureMember, iso(7), null)

        assertFailsWith<ConflictException> { serviceFrom(0).addMember(teamId, futureMember) }
        assertFailsWith<ConflictException> {
            serviceFrom(0).update(teamId, Team("fut2-${UUID.randomUUID()}", manager, listOf(futureMember)))
        }
        // A failed write rolls back: nothing was renamed, nothing joined.
        assertEquals(1, membershipRecords(teamId).size)
        assertTrue(assertNotNull(serviceFrom(0).read(teamId)).memberIds.isEmpty())
    }

    @Test
    fun `a manager handover splits the line, corrects in place on the same day and merges equal neighbours`() = testApplication {
        usePostgresTestcontainer()
        val first = seedUser("first")
        val second = seedUser("second")
        val third = seedUser("third")
        val teamId = serviceFrom(5).create(Team("line-${UUID.randomUUID()}", first))
        assertEquals(listOf(PeriodRecord(periodRecords(teamId).single().id, first, iso(-5), null)), periodRecords(teamId))

        val handover = assertNotNull(serviceFrom(0).updateTeam(teamId, Team("line", second)))
        val line = periodRecords(teamId)
        assertEquals(listOf(first to iso(-5), second to iso(0)), line.map { it.managerId to it.start })
        assertEquals(iso(-1), line[0].end)
        assertNull(line[1].end)
        assertEquals(line[1].id, handover.managerPeriodId)

        // Same day again: today's period started today, so it is corrected in place (no third row).
        val corrected = assertNotNull(serviceFrom(0).updateTeam(teamId, Team("line", third)))
        assertEquals(2, periodRecords(teamId).size)
        assertEquals(third, periodRecords(teamId)[1].managerId)
        assertEquals(line[1].id, corrected.managerPeriodId)

        // Handing back to the previous manager folds today's row into the earlier period.
        val back = assertNotNull(serviceFrom(0).updateTeam(teamId, Team("line", first)))
        val merged = periodRecords(teamId).single()
        assertEquals(first, merged.managerId)
        assertEquals(iso(-5), merged.start)
        assertNull(merged.end)
        assertEquals(merged.id, back.managerPeriodId)

        // An unchanged manager reports no handover.
        assertNull(assertNotNull(serviceFrom(0).updateTeam(teamId, Team("line", first))).managerPeriodId)
    }

    @Test
    fun `a swap of manager and member in one update is accepted - the rule holds on the final state`() = testApplication {
        usePostgresTestcontainer()
        val boss = seedUser("boss")
        val report = seedUser("report")
        val teamId = serviceFrom(2).create(Team("swap-${UUID.randomUUID()}", boss, listOf(report)))

        assertEquals(1, serviceFrom(0).update(teamId, Team("swap", report, listOf(boss))))

        val team = assertNotNull(serviceFrom(0).read(teamId))
        assertEquals(report, team.managerId)
        assertEquals(listOf(boss), team.memberIds)
    }

    @Test
    fun `deleting a team closes its structure today and drops rows that start later`() = testApplication {
        usePostgresTestcontainer()
        val manager = seedUser("m")
        val member = seedUser("member")
        val later = seedUser("later")
        val successor = seedUser("successor")
        val teamId = serviceFrom(4).create(Team("del-${UUID.randomUUID()}", manager, listOf(member)))
        insertMembershipRow(teamId, later, iso(3), null)
        val managerPeriod = periodRecords(teamId).single()
        setPeriodEnd(managerPeriod.id, iso(2))
        insertPeriodRow(teamId, successor, iso(3), null)

        val outcome = assertNotNull(serviceFrom(0).deleteTeam(teamId))

        assertEquals(1, outcome.membershipsEnded)
        assertEquals(2, outcome.futureRowsRemoved, "the future membership and the future manager period")
        assertEquals(listOf(member to iso(0)), membershipRecords(teamId).map { it.userId to it.end })
        assertEquals(listOf(manager to iso(0)), periodRecords(teamId).map { it.managerId to it.end })
        assertNull(serviceFrom(0).read(teamId))
        assertNull(serviceFrom(0).deleteTeam(teamId), "an already deleted team is a miss")
    }

    @Test
    fun `a membership of the manager's own team cannot be created for a future manager period either`() = testApplication {
        usePostgresTestcontainer()
        val manager = seedUser("m")
        val nextManager = seedUser("next")
        val teamId = serviceFrom(2).create(Team("fm-${UUID.randomUUID()}", manager))
        setPeriodEnd(periodRecords(teamId).single().id, iso(5))
        insertPeriodRow(teamId, nextManager, iso(6), null)

        // nextManager joining open-ended today would be a member while they manage from day 6 on.
        assertFailsWith<ConflictException> { serviceFrom(0).addMember(teamId, nextManager) }
        assertTrue(membershipRecords(teamId).isEmpty())
    }
}
