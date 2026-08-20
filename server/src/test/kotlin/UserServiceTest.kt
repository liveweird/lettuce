package ch.nokillswit

import ch.nokillswit.infra.paging.PageRequest
import ch.nokillswit.infra.paging.SortField
import ch.nokillswit.users.UserListFilter
import io.ktor.server.testing.testApplication
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * Service-level contract of [ch.nokillswit.users.UserService] the route cannot exercise:
 * blank filter params are stripped by optionalString before the service sees them, so the
 * service's own blank-guard is only reachable by calling list() directly.
 */
class UserServiceTest {

    @Test
    fun `blank name and email filters are treated as absent`() = testApplication {
        usePostgresTestcontainer()
        val email = "blank-filter-${UUID.randomUUID()}@test"
        TestUsers.seed(email = email, password = "pw", name = "BlankFilterProbe")

        // Neither the name nor the email contains a space, so a literally-applied blank filter
        // (LIKE '% %') would exclude the row — its presence proves blank means "no filter".
        // Sort by id descending so the just-seeded user is on the first page.
        val page = TestServices.users.list(
            UserListFilter(name = " ", email = " "),
            PageRequest(page = 1, pageSize = 100, sort = listOf(SortField("id", descending = true))),
            callerId = 1u,
            callerSeesAllSeniority = true,
        )
        assertTrue(page.items.any { it.email == email })

        // Control: a non-blank, non-matching name does exclude the row.
        val excluded = TestServices.users.list(
            UserListFilter(name = "no-such-user-name", email = " "),
            PageRequest(page = 1, pageSize = 100, sort = listOf(SortField("id", descending = true))),
            callerId = 1u,
            callerSeesAllSeniority = true,
        )
        assertTrue(excluded.items.none { it.email == email })
    }
}
