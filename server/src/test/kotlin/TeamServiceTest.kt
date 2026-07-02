package ch.nokillswit

import ch.nokillswit.infra.paging.PageRequest
import ch.nokillswit.infra.paging.SortField
import ch.nokillswit.teams.Team
import ch.nokillswit.teams.TeamListFilter
import ch.nokillswit.teams.TeamMemberListFilter
import ch.nokillswit.teams.TeamMemberListView
import io.ktor.server.plugins.BadRequestException
import io.ktor.server.testing.testApplication
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/**
 * Service-level contracts of [ch.nokillswit.teams.TeamService] the routes cannot exercise: the
 * member routes 404 on a missing team before addMember runs, blank filter params are stripped by
 * optionalString, and the member-list route's sort whitelist does not expose teamId (the service
 * supports it and uses it as the stability tiebreaker). testApplication boots so Flyway has run.
 */
class TeamServiceTest {

    private fun uniqueEmail(prefix: String) = "$prefix-${UUID.randomUUID()}@test"

    private val paging = PageRequest(page = 1, pageSize = 100, sort = listOf(SortField("id", descending = false)))

    @Test
    fun `addMember to a missing team is rejected`() = testApplication {
        usePostgresTestcontainer()
        val userId = TestUsers.seed(email = uniqueEmail("member"), password = "pw")
        val failure = assertFailsWith<BadRequestException> {
            TestServices.teams.addMember(999_999_999u, userId)
        }
        assertTrue(failure.message!!.contains("not found"))
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
}
