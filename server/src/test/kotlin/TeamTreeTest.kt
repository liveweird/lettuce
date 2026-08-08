package ch.nokillswit

import ch.nokillswit.teams.Team
import io.ktor.server.testing.testApplication
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The team-tree walks behind the pulse scopes (teams/TeamTree.kt via the TeamService wrappers):
 * "below" = teams managed by members, recursively; the two visibility scopes; the direct vs
 * subtree user sets. Fixture: root (M) ⊇ {A, B, C}; A manages "mid" ⊇ {D, E}; D manages
 * "leaf" ⊇ {F}. B is ALSO a member of "mid" (multi-team membership).
 */
class TeamTreeTest {

    private class Fixture(
        val m: UInt, val a: UInt, val b: UInt, val c: UInt, val d: UInt, val e: UInt, val f: UInt,
        val rootId: UInt, val midId: UInt, val leafId: UInt,
    )

    private suspend fun fixture(): Fixture {
        suspend fun user(tag: String) = TestUsers.seed(uniqueEmail(tag), "pw", roles = emptySet())
        val m = user("tree-m"); val a = user("tree-a"); val b = user("tree-b"); val c = user("tree-c")
        val d = user("tree-d"); val e = user("tree-e"); val f = user("tree-f")
        val stamp = UUID.randomUUID().toString().take(8)
        val rootId = TestServices.teams.create(Team(name = "tree-root-$stamp", managerId = m, memberIds = listOf(a, b, c)))
        val midId = TestServices.teams.create(Team(name = "tree-mid-$stamp", managerId = a, memberIds = listOf(d, e, b)))
        val leafId = TestServices.teams.create(Team(name = "tree-leaf-$stamp", managerId = d, memberIds = listOf(f)))
        return Fixture(m, a, b, c, d, e, f, rootId, midId, leafId)
    }

    @Test
    fun `teams below follow manager-membership edges recursively`() = testApplication {
        usePostgresTestcontainer()
        val fx = fixture()
        // M manages root; below root: mid (A ∈ root manages it), below mid: leaf (D ∈ mid).
        assertEquals(setOf(fx.rootId, fx.midId, fx.leafId), TestServices.teams.managedTeamTreeIds(fx.m))
        // A manages mid; below it: leaf. Root is ABOVE — never monitored.
        assertEquals(setOf(fx.midId, fx.leafId), TestServices.teams.managedTeamTreeIds(fx.a))
        // A plain member with no managed team monitors nothing.
        assertEquals(emptySet(), TestServices.teams.managedTeamTreeIds(fx.c))
    }

    @Test
    fun `visible results scope is member-teams plus managed plus everything below`() = testApplication {
        usePostgresTestcontainer()
        val fx = fixture()
        // C: member of root only -> root + below (mid via A, leaf via D).
        assertEquals(setOf(fx.rootId, fx.midId, fx.leafId), TestServices.teams.visibleTeamTreeIds(fx.c))
        // F: member of leaf only, manages nothing, nothing below leaf.
        assertEquals(setOf(fx.leafId), TestServices.teams.visibleTeamTreeIds(fx.f))
        // B: member of root AND mid (multi-team) -> both + leaf.
        assertEquals(setOf(fx.rootId, fx.midId, fx.leafId), TestServices.teams.visibleTeamTreeIds(fx.b))
        // A: member of root, manages mid -> all three.
        assertEquals(setOf(fx.rootId, fx.midId, fx.leafId), TestServices.teams.visibleTeamTreeIds(fx.a))
        // M: manages root, member of nothing -> all three (manager's own tree).
        assertEquals(setOf(fx.rootId, fx.midId, fx.leafId), TestServices.teams.visibleTeamTreeIds(fx.m))
    }

    @Test
    fun `direct scope is current members only - the manager aggregates under their own member team`() =
        testApplication {
            usePostgresTestcontainer()
            val fx = fixture()
            // A manages mid but is a MEMBER of root: root's scope contains A, mid's does not.
            assertEquals(setOf(fx.a, fx.b, fx.c), TestServices.teams.teamScopeMembers(fx.rootId, subtree = false))
            assertEquals(setOf(fx.d, fx.e, fx.b), TestServices.teams.teamScopeMembers(fx.midId, subtree = false))
        }

    @Test
    fun `subtree scope adds every transitive subordinate of a member`() = testApplication {
        usePostgresTestcontainer()
        val fx = fixture()
        // root subtree: members {A,B,C} + A's mid members {D,E,B} + D's leaf member {F}.
        assertEquals(
            setOf(fx.a, fx.b, fx.c, fx.d, fx.e, fx.f),
            TestServices.teams.teamScopeMembers(fx.rootId, subtree = true),
        )
        // mid subtree: {D,E,B} + {F}.
        assertEquals(setOf(fx.d, fx.e, fx.b, fx.f), TestServices.teams.teamScopeMembers(fx.midId, subtree = true))
        // leaf subtree: no member manages anything.
        assertEquals(setOf(fx.f), TestServices.teams.teamScopeMembers(fx.leafId, subtree = true))
    }

    @Test
    fun `a management cycle terminates the walks instead of looping`() = testApplication {
        usePostgresTestcontainer()
        // X manages teamX ∋ Y; Y manages teamY ∋ X — a cycle in the derived tree.
        val x = TestUsers.seed(uniqueEmail("cycle-x"), "pw", roles = emptySet())
        val y = TestUsers.seed(uniqueEmail("cycle-y"), "pw", roles = emptySet())
        val stamp = UUID.randomUUID().toString().take(8)
        val teamX = TestServices.teams.create(Team(name = "cycle-tx-$stamp", managerId = x, memberIds = listOf(y)))
        val teamY = TestServices.teams.create(Team(name = "cycle-ty-$stamp", managerId = y, memberIds = listOf(x)))
        assertEquals(setOf(teamX, teamY), TestServices.teams.managedTeamTreeIds(x))
        assertEquals(setOf(x, y), TestServices.teams.teamScopeMembers(teamX, subtree = true))
    }

    @Test
    fun `deleted teams vanish from every walk`() = testApplication {
        usePostgresTestcontainer()
        val fx = fixture()
        assertTrue(TestServices.teams.delete(fx.midId) > 0)
        // mid gone: leaf is no longer reachable below root (the edge ran through mid's membership).
        assertEquals(setOf(fx.rootId), TestServices.teams.managedTeamTreeIds(fx.m))
        assertEquals(setOf(fx.a, fx.b, fx.c), TestServices.teams.teamScopeMembers(fx.rootId, subtree = true))
    }
}
