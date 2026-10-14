package ch.nokillswit

import ch.nokillswit.infra.db.decodeParams
import ch.nokillswit.teams.Team
import ch.nokillswit.teams.TeamManagerPeriodResponse
import ch.nokillswit.teams.TeamManagerPeriodWrite
import ch.nokillswit.teams.TeamMembershipCreate
import ch.nokillswit.teams.TeamMembershipResponse
import ch.nokillswit.teams.TeamMembershipWrite
import ch.nokillswit.teams.TeamResponse
import ch.nokillswit.teams.TeamService.TeamRecords
import ch.nokillswit.teams.TeamStructureEventService.TeamStructureEvents
import ch.nokillswit.users.UserRole
import ch.nokillswit.users.UserService.Users
import io.ktor.client.call.body
import io.ktor.client.request.delete
import io.ktor.client.request.put
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.SortOrder
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.r2dbc.selectAll
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import org.jetbrains.exposed.v1.r2dbc.update
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The route side of the team-structure action trail (V94): every team and team-history write appends ONE
 * event after its commit and audit line — keyed on the team, the ADMIN as actor, ids/dates and NAME
 * SNAPSHOTS as params — while reads, refused writes and no-op PUTs mint nothing. The pure descriptors are
 * in `TeamStructureEventMintingTest`; the log on top is in `ActivityLogTest`.
 */
class TeamStructureEventsTest {

    private class Event(val actor: UInt?, val type: String, val params: Map<String, String>)

    private suspend fun eventsOf(teamId: UInt): List<Event> = suspendTransaction(TestServices.database) {
        TeamStructureEvents.selectAll()
            .where { TeamStructureEvents.ownerId eq teamId }
            .orderBy(TeamStructureEvents.id to SortOrder.ASC)
            .map {
                Event(
                    it[TeamStructureEvents.userId]?.value,
                    it[TeamStructureEvents.eventType],
                    decodeParams(it[TeamStructureEvents.params]),
                )
            }
            .toList()
    }

    private suspend fun rename(userId: UInt, name: String) = suspendTransaction(TestServices.database) {
        Users.update({ Users.id eq userId }) { it[Users.name] = name }
    }

    @Test
    fun `team create, update, member add and remove, and delete each mint one event - no-ops mint nothing, names are frozen`() =
        testApplication {
            usePostgresTestcontainer()
            val (adminId, adminEmail) = seedPerson("tse-admin", setOf(UserRole.ADMIN), "Adm")
            val (_, plainEmail) = seedPerson("tse-plain")
            val (manager, _) = seedPerson("tse-mgr", name = "Manager")
            val (nora, _) = seedPerson("tse-nora", name = "Nora")
            val (alice, _) = seedPerson("tse-alice", name = "Alice")
            val (bob, _) = seedPerson("tse-bob", name = "Bob")
            val admin = authedClient(adminEmail, "pw")
            val plain = authedClient(plainEmail, "pw")
            val original = "Orig-${UUID.randomUUID().toString().take(8)}"
            val renamed = "$original-2"

            // A non-admin's write is refused and mints nothing (the team does not even exist yet).
            assertEquals(HttpStatusCode.Forbidden, plain.postJson("/api/v1/teams", Team(original, manager, listOf(alice))).status)

            val created = admin.postJson("/api/v1/teams", Team(original, manager, listOf(alice)))
            assertEquals(HttpStatusCode.Created, created.status)
            val teamId = created.body<TeamResponse>().id
            val teamPath = "/api/v1/teams/$teamId"
            val first = eventsOf(teamId).single()
            assertEquals(adminId, first.actor)
            assertEquals("TEAM_CREATED", first.type)
            assertEquals(
                mapOf("team" to original, "managerId" to manager.toString(), "manager" to "Manager", "memberCount" to "1"),
                first.params,
            )

            // A non-admin PUT/DELETE is refused; a PUT that changes nothing mints nothing.
            assertEquals(HttpStatusCode.Forbidden, plain.putJson(teamPath, Team(renamed, manager, listOf(alice))).status)
            assertEquals(HttpStatusCode.NoContent, admin.putJson(teamPath, Team(original, manager, listOf(alice))).status)
            assertEquals(1, eventsOf(teamId).size)

            // Rename + handover + a new member in ONE PUT: one TEAM_UPDATED with every delta, names frozen.
            assertEquals(HttpStatusCode.NoContent, admin.putJson(teamPath, Team(renamed, nora, listOf(alice, bob))).status)
            val updated = eventsOf(teamId).last()
            assertEquals("TEAM_UPDATED", updated.type)
            assertEquals(adminId, updated.actor)
            assertEquals(renamed, updated.params["team"])
            assertEquals(original, updated.params["nameFrom"])
            assertEquals(renamed, updated.params["nameTo"])
            assertEquals(manager.toString(), updated.params["managerFrom"])
            assertEquals("Manager", updated.params["managerFromName"])
            assertEquals(nora.toString(), updated.params["managerTo"])
            assertEquals("Nora", updated.params["managerToName"])
            assertNotNull(updated.params["managerPeriodId"])
            assertEquals(bob.toString(), updated.params["membersAdded"])
            assertEquals("Bob", updated.params["membersAddedNames"])
            assertNull(updated.params["membersRemoved"])

            // A roster-only PUT removes a member; a rename-only PUT still gets an event.
            assertEquals(HttpStatusCode.NoContent, admin.putJson(teamPath, Team(renamed, nora, listOf(bob))).status)
            val removedByPut = eventsOf(teamId).last()
            assertEquals(alice.toString(), removedByPut.params["membersRemoved"])
            assertEquals("Alice", removedByPut.params["membersRemovedNames"])
            assertNull(removedByPut.params["nameFrom"])
            assertNull(removedByPut.params["managerFrom"])
            assertEquals(HttpStatusCode.NoContent, admin.putJson(teamPath, Team("$renamed!", nora, listOf(bob))).status)
            assertEquals(renamed, eventsOf(teamId).last().params["nameFrom"])
            assertEquals(HttpStatusCode.NoContent, admin.putJson(teamPath, Team(renamed, nora, listOf(bob))).status)
            assertEquals(5, eventsOf(teamId).size)

            // Add / remove one member: one event each; a repeat (the idempotent no-op) and a non-admin mint nothing.
            assertEquals(HttpStatusCode.Forbidden, plain.put("$teamPath/members/$alice").status)
            assertEquals(HttpStatusCode.NoContent, admin.put("$teamPath/members/$alice").status)
            val added = eventsOf(teamId).last()
            assertEquals("MEMBER_ADDED", added.type)
            assertEquals(adminId, added.actor)
            assertEquals(renamed, added.params["team"])
            assertEquals(alice.toString(), added.params["memberUserId"])
            assertEquals("Alice", added.params["member"])
            assertNotNull(added.params["membershipId"])
            assertEquals(java.time.LocalDate.now().toString(), added.params["startDate"])
            assertEquals(HttpStatusCode.NoContent, admin.put("$teamPath/members/$alice").status)
            assertEquals(6, eventsOf(teamId).size)
            assertEquals(HttpStatusCode.Forbidden, plain.delete("$teamPath/members/$alice").status)
            // Added today, removed today: the period is hard-deleted, and the event says so.
            assertEquals(HttpStatusCode.NoContent, admin.delete("$teamPath/members/$alice").status)
            val removed = eventsOf(teamId).last()
            assertEquals("MEMBER_REMOVED", removed.type)
            assertEquals("true", removed.params["hardDeleted"])
            assertEquals("Alice", removed.params["member"])
            assertNull(removed.params["endDate"])
            assertEquals(HttpStatusCode.NoContent, admin.delete("$teamPath/members/$alice").status)
            assertEquals(7, eventsOf(teamId).size)

            // Name snapshots survive a later rename of the person and of the team.
            rename(alice, "Alice Renamed")
            rename(manager, "Manager Renamed")
            val frozen = eventsOf(teamId)
            assertEquals("Manager", frozen.first().params["manager"])
            assertEquals("Manager", frozen[1].params["managerFromName"])
            assertEquals("Alice", frozen[6].params["member"])
            assertEquals(original, frozen.first().params["team"])

            assertEquals(HttpStatusCode.NoContent, admin.delete(teamPath).status)
            val deleted = eventsOf(teamId).last()
            assertEquals("TEAM_DELETED", deleted.type)
            assertEquals(adminId, deleted.actor)
            assertEquals(renamed, deleted.params["team"])
            assertEquals("1", deleted.params["membershipsEnded"])
            assertEquals("0", deleted.params["futureRowsRemoved"])
            // A repeated delete is 404 and mints nothing.
            assertEquals(HttpStatusCode.NotFound, admin.delete(teamPath).status)
            assertEquals(8, eventsOf(teamId).size)
        }

    @Test
    fun `membership and manager-period writes each mint one event - no-ops and refused writes mint nothing`() = testApplication {
        usePostgresTestcontainer()
        val (adminId, adminEmail) = seedPerson("tsh-admin", setOf(UserRole.ADMIN), "Adm")
        val (_, plainEmail) = seedPerson("tsh-plain")
        val (manager, _) = seedPerson("tsh-mgr", name = "Manager")
        val (carol, _) = seedPerson("tsh-carol", name = "Carol")
        val (dave, _) = seedPerson("tsh-dave", name = "Dave")
        val (bob, _) = seedPerson("tsh-bob", name = "Bob")
        val admin = authedClient(adminEmail, "pw")
        val plain = authedClient(plainEmail, "pw")
        val teamName = "Hist-${UUID.randomUUID().toString().take(8)}"
        val teamId = backdatedTeam(10, manager, emptyList(), teamName)
        val team = "/api/v1/teams/$teamId"
        // Fixture rows go in through the service, which mints no events.
        assertTrue(eventsOf(teamId).isEmpty())

        // ---- memberships ----
        val start = dayIso(-5)
        assertEquals(HttpStatusCode.Forbidden, plain.postJson("$team/memberships", TeamMembershipCreate(bob, start)).status)
        val created = admin.postJson("$team/memberships", TeamMembershipCreate(bob, start))
        assertEquals(HttpStatusCode.Created, created.status)
        val membership = created.body<TeamMembershipResponse>()
        val membershipEvent = eventsOf(teamId).single()
        assertEquals("MEMBERSHIP_CREATED", membershipEvent.type)
        assertEquals(adminId, membershipEvent.actor)
        assertEquals(
            mapOf(
                "team" to teamName, "membershipId" to membership.id.toString(), "memberUserId" to bob.toString(),
                "member" to "Bob", "startDate" to start,
            ),
            membershipEvent.params,
        )
        // A malformed write (400) and a conflicting one (409: overlapping periods of one person) mint nothing.
        assertEquals(HttpStatusCode.BadRequest, admin.postJson("$team/memberships", TeamMembershipCreate(bob, "garbage")).status)
        assertEquals(HttpStatusCode.Conflict, admin.postJson("$team/memberships", TeamMembershipCreate(bob, dayIso(-4))).status)
        assertEquals(1, eventsOf(teamId).size)

        // An unchanged PUT is a quiet 204 without an event; closing the period mints one with the end delta only.
        val row = "$team/memberships/${membership.id}"
        assertEquals(HttpStatusCode.Forbidden, plain.putJson(row, TeamMembershipWrite(start, dayIso(-1))).status)
        assertEquals(HttpStatusCode.NoContent, admin.putJson(row, TeamMembershipWrite(start, null)).status)
        assertEquals(1, eventsOf(teamId).size)
        assertEquals(HttpStatusCode.NoContent, admin.putJson(row, TeamMembershipWrite(start, dayIso(-1))).status)
        val closed = eventsOf(teamId).last()
        assertEquals("MEMBERSHIP_UPDATED", closed.type)
        assertEquals(dayIso(-1), closed.params["endDate"])
        assertEquals(dayIso(-1), closed.params["endDateTo"])
        assertNull(closed.params["endDateFrom"], "the period was open: no From")
        assertNull(closed.params["startDateFrom"], "the start did not change")
        assertEquals("Bob", closed.params["member"])
        // Moving the start earlier shows both sides of that delta.
        assertEquals(HttpStatusCode.NoContent, admin.putJson(row, TeamMembershipWrite(dayIso(-6), dayIso(-1))).status)
        val moved = eventsOf(teamId).last()
        assertEquals(start, moved.params["startDateFrom"])
        assertEquals(dayIso(-6), moved.params["startDateTo"])

        assertEquals(HttpStatusCode.Forbidden, plain.delete(row).status)
        assertEquals(HttpStatusCode.NoContent, admin.delete(row).status)
        val dropped = eventsOf(teamId).last()
        assertEquals("MEMBERSHIP_DELETED", dropped.type)
        assertEquals(membership.id.toString(), dropped.params["membershipId"])
        assertEquals(dayIso(-6), dropped.params["startDate"])
        assertEquals(dayIso(-1), dropped.params["endDate"])
        assertEquals(HttpStatusCode.NotFound, admin.delete(row).status)
        assertEquals(4, eventsOf(teamId).size)

        // ---- the manager line ----
        val before = eventsOf(teamId).size
        assertEquals(HttpStatusCode.Forbidden, plain.postJson("$team/managers", TeamManagerPeriodWrite(carol, dayIso(-2))).status)
        val periodCreated = admin.postJson("$team/managers", TeamManagerPeriodWrite(carol, dayIso(-2)))
        assertEquals(HttpStatusCode.Created, periodCreated.status)
        val period = periodCreated.body<TeamManagerPeriodResponse>()
        assertEquals(before + 1, eventsOf(teamId).size)
        val createdEvent = eventsOf(teamId).last()
        assertEquals("MANAGER_PERIOD_CREATED", createdEvent.type)
        assertEquals(adminId, createdEvent.actor)
        assertEquals(
            mapOf(
                "team" to teamName, "periodId" to period.id.toString(), "managerId" to carol.toString(),
                "manager" to "Carol", "startDate" to dayIso(-2),
            ),
            createdEvent.params,
        )
        // The same manager as the period it would split is a 409 and mints nothing.
        assertEquals(HttpStatusCode.Conflict, admin.postJson("$team/managers", TeamManagerPeriodWrite(carol, dayIso(-1))).status)
        assertEquals(before + 1, eventsOf(teamId).size)

        val periodPath = "$team/managers/${period.id}"
        // An unchanged PUT mints nothing; a start correction mints one with the start delta only.
        assertEquals(HttpStatusCode.NoContent, admin.putJson(periodPath, TeamManagerPeriodWrite(carol, dayIso(-2))).status)
        assertEquals(before + 1, eventsOf(teamId).size)
        assertEquals(HttpStatusCode.NoContent, admin.putJson(periodPath, TeamManagerPeriodWrite(carol, dayIso(-3))).status)
        val startMoved = eventsOf(teamId).last()
        assertEquals("MANAGER_PERIOD_UPDATED", startMoved.type)
        assertEquals(dayIso(-2), startMoved.params["startDateFrom"])
        assertEquals(dayIso(-3), startMoved.params["startDateTo"])
        assertEquals("Carol", startMoved.params["manager"])
        assertNull(startMoved.params["managerFrom"])
        // A manager swap mints the id and name deltas.
        assertEquals(HttpStatusCode.NoContent, admin.putJson(periodPath, TeamManagerPeriodWrite(dave, dayIso(-3))).status)
        val swapped = eventsOf(teamId).last()
        assertEquals(carol.toString(), swapped.params["managerFrom"])
        assertEquals("Carol", swapped.params["managerFromName"])
        assertEquals(dave.toString(), swapped.params["managerTo"])
        assertEquals("Dave", swapped.params["managerToName"])
        assertNull(swapped.params["startDateFrom"])

        assertEquals(HttpStatusCode.Forbidden, plain.delete(periodPath).status)
        assertEquals(HttpStatusCode.NoContent, admin.delete(periodPath).status)
        val removed = eventsOf(teamId).last()
        assertEquals("MANAGER_PERIOD_DELETED", removed.type)
        assertEquals(dave.toString(), removed.params["managerId"])
        assertEquals("Dave", removed.params["manager"])
        assertNotNull(removed.params["absorbedByPeriodId"])
        assertEquals(dayIso(-3), removed.params["startDate"])
        // The whole trail sits on the team and in the admin's name; a person's rename never touches it.
        assertTrue(eventsOf(teamId).all { it.actor == adminId && it.params["team"] == teamName })
        rename(dave, "Dave Renamed")
        assertEquals("Dave", eventsOf(teamId).last().params["manager"])
        // The team itself is still readable under its stored name.
        val stored = suspendTransaction(TestServices.database) {
            TeamRecords.selectAll().where { TeamRecords.id eq teamId }.map { it[TeamRecords.name] }.toList().single()
        }
        assertEquals(teamName, stored)
    }
}
