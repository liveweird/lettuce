package ch.nokillswit

import ch.nokillswit.authz.CallerPrincipal
import ch.nokillswit.daysoff.DaysOffCalendarShareable
import ch.nokillswit.daysoff.DaysOffShareCandidate
import ch.nokillswit.daysoff.DaysOffShareCandidateList
import ch.nokillswit.dictionaries.Dictionary
import ch.nokillswit.dictionaries.DictionaryEntry
import ch.nokillswit.sharing.ShareAccessKey
import ch.nokillswit.sharing.ShareRegistryKey
import ch.nokillswit.sharing.ShareableResourceType
import ch.nokillswit.teams.Team
import ch.nokillswit.teams.TeamRef
import ch.nokillswit.users.CareerPositionWrite
import ch.nokillswit.users.Feature
import ch.nokillswit.users.OPT_IN_FEATURES
import ch.nokillswit.users.UserRef
import ch.nokillswit.users.UserRole
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * `GET /api/v1/days-off/share-candidates` (v4.11.0) — the calendar mass-share picker's dataset:
 * the review endpoint's chain roster without the review join. Strictly caller-relative over the
 * TRANSITIVE chain (no HR/ADMIN widening, not audited, unpaged), teams / direct managers / career
 * triple per person, and — the parity case — every listed person passes the REAL calendar adapter
 * guard through `ShareAccess.holdsOwnRight` while strangers do not.
 */
class DaysOffShareCandidatesTest {

    private suspend fun person(prefix: String, roles: Set<UserRole> = emptySet(), name: String = prefix): UInt =
        TestUsers.seed(uniqueEmail(prefix), "pw", name = name, roles = roles)

    private suspend fun team(manager: UInt, members: List<UInt>, name: String = "dsc-${UUID.randomUUID()}"): UInt =
        TestServices.teams.create(Team(name = name, managerId = manager, memberIds = members))

    private suspend fun HttpClient.candidates(): DaysOffShareCandidateList =
        get("/api/v1/days-off/share-candidates").body()

    private fun DaysOffShareCandidateList.byId(id: UInt): DaysOffShareCandidate = items.single { it.userId == id }

    @Test
    fun `rows are the caller's transitive chain only - deactivated kept, deleted and strangers absent, name order`() =
        testApplication {
            usePostgresTestcontainer()
            val gm = person("dsc-gm", name = "Dsc Grand")
            val m = person("dsc-m", name = "Dsc mid")
            val sA = person("dsc-sa", name = "Dsc Alpha")
            val sB = person("dsc-sb", name = "Dsc Bravo")
            val deactivated = person("dsc-sd", name = "Dsc Dormant")
            val deleted = person("dsc-sx", name = "Dsc Deleted")
            val stranger = person("dsc-st", name = "Dsc Stranger")
            team(gm, listOf(m))
            team(m, listOf(sB, sA, deactivated, deleted))
            team(stranger, listOf(person("dsc-so")))
            TestServices.users.setDeactivated(deactivated, true)
            TestServices.users.delete(deleted)

            val list = authedClient(TestServices.users.read(gm)!!.email, "pw").candidates()
            // Name order is case-insensitive then id: Alpha, Bravo, Dormant, mid.
            assertEquals(listOf(sA, sB, deactivated, m), list.items.map { it.userId })
            assertEquals(listOf(false, false, true, false), list.items.map { it.deactivated })
            assertTrue(list.items.none { it.userId in setOf(gm, deleted, stranger) })
            assertEquals(TestServices.users.read(sA)!!.email, list.byId(sA).email)
            assertEquals("Dsc Alpha", list.byId(sA).name)

            // The mid manager sees only their own reports; a non-manager gets [] (no 403).
            val mid = authedClient(TestServices.users.read(m)!!.email, "pw").candidates()
            assertEquals(listOf(sA, sB, deactivated), mid.items.map { it.userId })
            assertEquals(emptyList(), authedClient(TestServices.users.read(sA)!!.email, "pw").candidates().items)
        }

    @Test
    fun `teams, direct managers and the career triple ride along - the caller listed as a manager of their own team`() =
        testApplication {
            usePostgresTestcontainer()
            val gm = person("dscp-gm", name = "Dscp Grand")
            val m = person("dscp-m", name = "Dscp Middle")
            val outsider = person("dscp-o", name = "Dscp Dotted")
            val s = person("dscp-s", name = "Dscp Sub")
            val d = person("dscp-d", name = "Dscp Direct")
            val lead = team(gm, listOf(m, d), name = "Dscp Lead")
            val squad = team(m, listOf(s), name = "Dscp Squad")
            val dotted = team(outsider, listOf(s), name = "Dscp Dotted line")
            val marker = UUID.randomUUID().toString().take(8)
            val (pathId) = TestDictionaries.append(Dictionary.CAREER_PATH, "Dscp P $marker")
            val (specId) = TestDictionaries.append(Dictionary.CAREER_SPECIALIZATION, "Dscp S $marker")
            val (levelId) = TestDictionaries.append(Dictionary.SENIORITY_LEVEL, "Dscp L $marker")
            TestServices.careerPositions.create(m, s, CareerPositionWrite("2020-01-01", pathId, specId, levelId))

            val list = authedClient(TestServices.users.read(gm)!!.email, "pw").candidates()
            assertEquals(listOf(TeamRef(lead, "Dscp Lead")), list.byId(d).teams)
            // Direct report of the caller: the caller appears as themselves.
            assertEquals(listOf(UserRef(gm, "Dscp Grand")), list.byId(d).directManagers)
            assertEquals(listOf(UserRef(gm, "Dscp Grand")), list.byId(m).directManagers)
            // Grand-manager's row lists the middle manager - and an outsider manager outside the chain.
            val sub = list.byId(s)
            assertEquals(listOf(TeamRef(dotted, "Dscp Dotted line"), TeamRef(squad, "Dscp Squad")), sub.teams)
            assertEquals(listOf(UserRef(outsider, "Dscp Dotted"), UserRef(m, "Dscp Middle")), sub.directManagers)
            // Career triple with seniority ALWAYS attached (chain rows); no positions = nulls.
            assertEquals(DictionaryEntry(pathId, mapOf("en" to "Dscp P $marker")), sub.careerPath)
            assertEquals(DictionaryEntry(specId, mapOf("en" to "Dscp S $marker")), sub.careerSpecialization)
            assertEquals(DictionaryEntry(levelId, mapOf("en" to "Dscp L $marker")), sub.seniorityLevel)
            assertNull(list.byId(d).careerPath)
            assertNull(list.byId(d).seniorityLevel)
        }

    @Test
    fun `an HR or ADMIN caller gets no widening and no audit event - only their own chain`() = testApplication {
        usePostgresTestcontainer()
        val m = person("dsch-m", name = "Dsch Middle")
        val s = person("dsch-s", name = "Dsch Sub")
        team(m, listOf(s))
        val hr = person("dsch-hr", roles = setOf(UserRole.HR))
        val admin = person("dsch-ad", roles = setOf(UserRole.ADMIN))
        val hrManager = person("dsch-hm", roles = setOf(UserRole.HR))
        team(hrManager, listOf(m))
        val capture = LogCapture("ch.nokillswit.audit")
        try {
            for (id in listOf(hr, admin)) {
                assertEquals(emptyList(), authedClient(TestServices.users.read(id)!!.email, "pw").candidates().items)
            }
            // An HR user who manages m sees m and s - and nothing else.
            val list = authedClient(TestServices.users.read(hrManager)!!.email, "pw").candidates()
            assertEquals(setOf(m, s), list.items.map { it.userId }.toSet())
            assertEquals(0, capture.events.count { it.message.startsWith("hr.") })
        } finally {
            capture.detach()
        }
    }

    @Test
    fun `401 without a token and 403 with the DAYS_OFF feature off`() = testApplication {
        usePostgresTestcontainer()
        assertEquals(HttpStatusCode.Unauthorized, jsonClient().get("/api/v1/days-off/share-candidates").status)
        val blocked = person("dscv-b")
        TestServices.users.setDisabledFeatures(blocked, setOf(Feature.DAYS_OFF) + OPT_IN_FEATURES)
        val disabled = authedClient(TestServices.users.read(blocked)!!.email, "pw")
        assertEquals(HttpStatusCode.Forbidden, disabled.get("/api/v1/days-off/share-candidates").status)
        val ok = authedClient(TestServices.users.read(person("dscv-ok"))!!.email, "pw")
        assertEquals(HttpStatusCode.OK, ok.get("/api/v1/days-off/share-candidates").status)
    }

    /**
     * "Every chain person is shareable" against the REAL adapter guard: each listed person passes
     * `holdsOwnRight` for the caller (HR-holding or not — HR changes nothing), and a stranger and
     * a teammate (not in the chain) do not.
     */
    @Test
    fun `every listed person passes the real calendar guard in own right - strangers and teammates do not`() =
        testApplication {
            usePostgresTestcontainer()
            val adapter = application.attributes[ShareRegistryKey].forType(ShareableResourceType.DAYS_OFF_CALENDAR)
                as DaysOffCalendarShareable
            val access = application.attributes[ShareAccessKey]
            for (topRoles in listOf(emptySet(), setOf(UserRole.HR))) {
                val gm = person("dscx-gm", topRoles)
                val m = person("dscx-m")
                val chain = (0 until 3).map { person("dscx-c") }
                val deep = (0 until 3).map { person("dscx-d") }
                val teammate = person("dscx-t")
                val stranger = person("dscx-s")
                team(gm, listOf(m) + chain)
                // A teammate (shares a team with the caller) is a calendar-parity reader, not a chain person.
                team(person("dscx-b"), listOf(gm, teammate))
                team(m, deep)
                team(stranger, listOf(person("dscx-so")))
                val principal = CallerPrincipal(gm, "caller-$gm@test", topRoles)
                val rows = authedClient(TestServices.users.read(gm)!!.email, "pw").candidates().items
                assertEquals((listOf(m) + chain + deep).toSet(), rows.map { it.userId }.toSet())
                for (target in rows.map { it.userId } + stranger + teammate) {
                    val doc = checkNotNull(adapter.read(target))
                    val own = access.holdsOwnRight(principal, ShareableResourceType.DAYS_OFF_CALENDAR) {
                        adapter.guard(it, doc)
                    }
                    assertEquals(target != stranger && target != teammate, own, "target=$target")
                }
            }
        }
}
