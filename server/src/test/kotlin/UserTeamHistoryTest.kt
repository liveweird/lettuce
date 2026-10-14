package ch.nokillswit

import ch.nokillswit.teams.TeamManagerPeriodWrite
import ch.nokillswit.teams.TeamMembershipCreate
import ch.nokillswit.teams.TeamMembershipList
import ch.nokillswit.teams.TeamMembershipWrite
import ch.nokillswit.teams.UserTeamHistory
import ch.nokillswit.users.UserRole
import io.ktor.client.call.body
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** `GET /api/v1/users/{id}/team-history` — a person's membership and managed-team periods. */
class UserTeamHistoryTest {

    @Test
    fun `lists a person's memberships and manager periods chronologically and hides pre-history residue`() = testApplication {
        usePostgresTestcontainer()
        val tag = "uth" + UUID.randomUUID().toString().take(8)
        val (_, adminEmail) = seedPerson("uth-admin", setOf(UserRole.ADMIN))
        val (_, plainEmail) = seedPerson("uth-plain")
        val (m, _) = seedPerson("uth-m")
        val (v, _) = seedPerson("uth-v")
        val (u, _) = seedPerson("uth-u", name = "Una")
        val admin = authedClient(adminEmail, "pw")
        val plain = authedClient(plainEmail, "pw")

        // T1: left 10 days ago. T2: current. T6: starts in three days.
        val t1 = backdatedTeam(20, m, listOf(u), name = "$tag-1")
        val t1Row = admin.get("/api/v1/teams/$t1/memberships").body<TeamMembershipList>().items.single()
        admin.putJson("/api/v1/teams/$t1/memberships/${t1Row.id}", TeamMembershipWrite(dayIso(-20), dayIso(-10)))
        val t2 = backdatedTeam(3, m, listOf(u), name = "$tag-2")
        val t6 = backdatedTeam(3, m, name = "$tag-6")
        admin.postJson("/api/v1/teams/$t6/memberships", TeamMembershipCreate(u, dayIso(3), dayIso(9)))
        // T3: U managed it from 8 days ago until V took over three days ago.
        val t3 = backdatedTeam(8, u, name = "$tag-3")
        admin.postJson("/api/v1/teams/$t3/managers", TeamManagerPeriodWrite(v, dayIso(-2)))
        // T4: deleted today (U was a member). T7: managed by U, deleted today. T5: pre-history deleted residue.
        val t4 = backdatedTeam(10, m, listOf(u), name = "$tag-4")
        val t7 = backdatedTeam(5, u, name = "$tag-7")
        val t5 = backdatedTeam(10, m, listOf(u), name = "$tag-5")
        softDeleteTeamRow(t5)
        assertEquals(HttpStatusCode.NoContent, admin.delete("/api/v1/teams/$t4").status)
        assertEquals(HttpStatusCode.NoContent, admin.delete("/api/v1/teams/$t7").status)

        // Any authenticated caller may read another person's history.
        val history = plain.get("/api/v1/users/$u/team-history").body<UserTeamHistory>()

        assertEquals(
            listOf(t1, t4, t2, t6),
            history.memberships.map { it.team.id },
            "chronological by start; the residue team $t5 is hidden",
        )
        val byTeam = history.memberships.associateBy { it.team.id }
        assertEquals(dayIso(-10), byTeam.getValue(t1).endDate)
        assertFalse(byTeam.getValue(t1).current)
        assertTrue(byTeam.getValue(t2).current)
        assertEquals(null, byTeam.getValue(t2).endDate)
        assertEquals(dayIso(3), byTeam.getValue(t6).startDate)
        assertFalse(byTeam.getValue(t6).current)
        val deleted = byTeam.getValue(t4)
        assertTrue(deleted.team.deleted)
        assertEquals("$tag-4", deleted.team.name)
        assertEquals(dayIso(0), deleted.endDate)
        assertFalse(deleted.current, "a period of a deleted team is not current, even on the deletion day")

        // Manager periods: T3 (handed over) and T7 (deleted); each row names its team.
        assertEquals(listOf(t3, t7), history.managerPeriods.map { it.team.id })
        val handedOver = history.managerPeriods.single { it.team.id == t3 }
        assertEquals(dayIso(-8), handedOver.startDate)
        assertEquals(dayIso(-3), handedOver.endDate)
        assertFalse(handedOver.current)
        val managedAndDeleted = history.managerPeriods.single { it.team.id == t7 }
        assertTrue(managedAndDeleted.team.deleted)
        assertEquals(dayIso(0), managedAndDeleted.endDate)

        // The new manager's side of the same handover.
        val vHistory = plain.get("/api/v1/users/$v/team-history").body<UserTeamHistory>()
        assertEquals(emptyList(), vHistory.memberships)
        assertEquals(listOf(t3), vHistory.managerPeriods.map { it.team.id })
        assertTrue(vHistory.managerPeriods.single().current)
    }

    @Test
    fun `a missing or soft-deleted user is a 404 and a person without history gets empty lists`() = testApplication {
        usePostgresTestcontainer()
        val (_, adminEmail) = seedPerson("uth404-admin", setOf(UserRole.ADMIN))
        val (nobody, _) = seedPerson("uth404-nobody")
        val (gone, _) = seedPerson("uth404-gone")
        val admin = authedClient(adminEmail, "pw")
        assertEquals(HttpStatusCode.NotFound, admin.get("/api/v1/users/999999/team-history").status)
        assertEquals(HttpStatusCode.NoContent, admin.delete("/api/v1/users/$gone").status)
        assertEquals(HttpStatusCode.NotFound, admin.get("/api/v1/users/$gone/team-history").status)
        val empty = admin.get("/api/v1/users/$nobody/team-history").body<UserTeamHistory>()
        assertEquals(emptyList(), empty.memberships)
        assertEquals(emptyList(), empty.managerPeriods)
    }
}
