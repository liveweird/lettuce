package ch.nokillswit

import ch.nokillswit.dictionaries.Dictionary
import ch.nokillswit.dictionaries.DictionaryEntry
import ch.nokillswit.teams.Team
import ch.nokillswit.users.CareerPositionWrite
import ch.nokillswit.users.CareerPyramidList
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import java.time.LocalDate
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The caller-relative team-pyramid read (v2.16.0; full-history payload since v2.17.0):
 * chain scoping (direct vs includeIndirect, dedupe, cycle safety, caller exclusion), the
 * per-position intervals (derived ends, the stored deactivation end on the final row), the
 * deactivated flag, empty position lists for subordinates without positions, the org-wide
 * earliestStartDate slider anchor, soft-deleted exclusion, the strict-boolean 400, and the
 * name sort. Non-managers get an empty list, not a 403.
 */
class CareerPyramidTest {

    private suspend fun io.ktor.client.HttpClient.pyramid(query: String = ""): CareerPyramidList =
        get("/api/v1/career/pyramid$query").body()

    @Test
    fun `scope - direct vs transitive chain, dedupe, cycle safety, name sort`() = testApplication {
        usePostgresTestcontainer()
        // G manages {M}; M manages {S, T}; S also sits on a SECOND team G manages (dedupe).
        val gEmail = uniqueEmail("pyr-g")
        val mEmail = uniqueEmail("pyr-m")
        val gId = TestUsers.seed(gEmail, "pw", name = "Pyr Grand", roles = emptySet())
        val mId = TestUsers.seed(mEmail, "pw", name = "Pyr Bravo", roles = emptySet())
        val sId = TestUsers.seed(uniqueEmail("pyr-s"), "pw", name = "Pyr alpha", roles = emptySet())
        val tId = TestUsers.seed(uniqueEmail("pyr-t"), "pw", name = "Pyr Charlie", roles = emptySet())
        val teamY = TestServices.teams.create(Team(name = "pyrY-${UUID.randomUUID()}", managerId = gId))
        TestServices.teams.addMember(teamY, mId)
        val teamX = TestServices.teams.create(Team(name = "pyrX-${UUID.randomUUID()}", managerId = mId))
        TestServices.teams.addMember(teamX, sId)
        TestServices.teams.addMember(teamX, tId)
        val teamZ = TestServices.teams.create(Team(name = "pyrZ-${UUID.randomUUID()}", managerId = gId))
        TestServices.teams.addMember(teamZ, sId)

        val g = authedClient(gEmail, "pw")
        // Direct: M (team Y) + S (team Z) — S appears ONCE despite the future indirect route.
        assertEquals(listOf(mId, sId), g.pyramid().items.map { it.userId }.sorted())
        // Transitive: M, S, T — deduped, caller never listed, case-insensitive name order.
        val all = g.pyramid("?includeIndirect=true").items
        assertEquals(listOf("Pyr alpha", "Pyr Bravo", "Pyr Charlie"), all.map { it.name })
        assertEquals(setOf(mId, sId, tId), all.map { it.userId }.toSet())

        // A management cycle terminates: make G a member of the team M manages.
        TestServices.teams.addMember(teamX, gId)
        assertEquals(setOf(mId, sId, tId), g.pyramid("?includeIndirect=true").items.map { it.userId }.toSet())

        // Strict boolean: garbage → 400.
        assertEquals(HttpStatusCode.BadRequest, g.get("/api/v1/career/pyramid?includeIndirect=banana").status)
    }

    @Test
    fun `rows - position history with derived ends, empty without positions, soft-delete exclusion`() =
        testApplication {
            usePostgresTestcontainer()
            val mgrEmail = uniqueEmail("pyt-m")
            val mgrId = TestUsers.seed(mgrEmail, "pw", roles = emptySet())
            val richId = TestUsers.seed(uniqueEmail("pyt-r"), "pw", name = "Pyt Rich", roles = emptySet())
            val bareId = TestUsers.seed(uniqueEmail("pyt-b"), "pw", name = "Pyt Bare", roles = emptySet())
            val goneId = TestUsers.seed(uniqueEmail("pyt-g"), "pw", name = "Pyt Gone", roles = emptySet())
            val teamId = TestServices.teams.create(Team(name = "pyt-${UUID.randomUUID()}", managerId = mgrId))
            for (id in listOf(richId, bareId, goneId)) TestServices.teams.addMember(teamId, id)

            val marker = UUID.randomUUID().toString().take(8)
            val (pathA, pathB) = TestDictionaries.append(Dictionary.CAREER_PATH, "PyT A $marker", "PyT B $marker")
            val (specId) = TestDictionaries.append(Dictionary.CAREER_SPECIALIZATION, "PyT S $marker")
            val (levelId) = TestDictionaries.append(Dictionary.SENIORITY_LEVEL, "PyT L $marker")
            TestServices.careerPositions.create(
                mgrId, richId, CareerPositionWrite("2018-04-01", pathA, specId, levelId),
            )
            TestServices.careerPositions.create(
                mgrId, richId, CareerPositionWrite("2022-09-15", pathB, specId, levelId),
            )
            TestServices.users.delete(goneId)

            val list = authedClient(mgrEmail, "pw").pyramid()
            val items = list.items
            assertEquals(listOf(richId, bareId), items.map { it.userId }.sortedBy { it })
            val rich = items.single { it.userId == richId }
            assertEquals(false, rich.deactivated)
            // FULL history, chronological, ends derived from the next start (v2.17.0).
            assertEquals(2, rich.positions.size)
            val (first, current) = rich.positions
            assertEquals("2018-04-01", first.startDate)
            assertEquals("2022-09-14", first.endDate)
            assertEquals(DictionaryEntry(pathA, "PyT A $marker", "PyT A $marker"), first.careerPath)
            assertEquals("2022-09-15", current.startDate)
            assertNull(current.endDate)
            assertEquals(DictionaryEntry(pathB, "PyT B $marker", "PyT B $marker"), current.careerPath)
            assertEquals(DictionaryEntry(levelId, "PyT L $marker", "PyT L $marker"), current.seniorityLevel)
            val bare = items.single { it.userId == bareId }
            assertEquals(emptyList(), bare.positions)
            // The slider anchor is ORG-WIDE over the shared test DB — other tests' rows may
            // predate ours, so pin only the upper bound.
            val earliest = list.earliestStartDate
            assertTrue(earliest != null && earliest <= "2018-04-01", "earliest=$earliest")
        }

    @Test
    fun `deactivation closes the final position in the payload and flags the item`() = testApplication {
        usePostgresTestcontainer()
        val mgrEmail = uniqueEmail("pyd-m")
        val mgrId = TestUsers.seed(mgrEmail, "pw", roles = emptySet())
        val subId = TestUsers.seed(uniqueEmail("pyd-s"), "pw", name = "Pyd Sub", roles = emptySet())
        val teamId = TestServices.teams.create(Team(name = "pyd-${UUID.randomUUID()}", managerId = mgrId))
        TestServices.teams.addMember(teamId, subId)
        val marker = UUID.randomUUID().toString().take(8)
        val (pathId) = TestDictionaries.append(Dictionary.CAREER_PATH, "PyD $marker")
        val (specId) = TestDictionaries.append(Dictionary.CAREER_SPECIALIZATION, "PyD S $marker")
        val (levelId) = TestDictionaries.append(Dictionary.SENIORITY_LEVEL, "PyD L $marker")
        TestServices.careerPositions.create(
            mgrId, subId, CareerPositionWrite("2021-05-01", pathId, specId, levelId),
        )

        val adminEmail = uniqueEmail("pyd-a")
        TestUsers.seed(adminEmail, "pw")
        val admin = authedClient(adminEmail, "pw")
        assertEquals(
            HttpStatusCode.NoContent,
            admin.post("/api/v1/users/$subId/deactivate").status,
        )
        val mgr = authedClient(mgrEmail, "pw")
        val closed = mgr.pyramid().items.single { it.userId == subId }
        assertEquals(true, closed.deactivated)
        assertEquals(LocalDate.now().toString(), closed.positions.single().endDate)

        // Reactivation reopens the position — the timeline resumes as before.
        assertEquals(HttpStatusCode.NoContent, admin.post("/api/v1/users/$subId/activate").status)
        val reopened = mgr.pyramid().items.single { it.userId == subId }
        assertEquals(false, reopened.deactivated)
        assertNull(reopened.positions.single().endDate)
    }

    @Test
    fun `a non-manager gets an empty list and an anonymous caller 401`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("pyn")
        TestUsers.seed(email, "pw", roles = emptySet())
        assertEquals(0, authedClient(email, "pw").pyramid().items.size)
        assertEquals(HttpStatusCode.Unauthorized, jsonClient().get("/api/v1/career/pyramid").status)
    }
}
