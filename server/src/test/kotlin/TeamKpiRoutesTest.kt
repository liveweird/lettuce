package ch.nokillswit

import ch.nokillswit.notifications.NotificationPageResponse
import ch.nokillswit.notifications.NotificationType
import ch.nokillswit.teamkpis.TeamKpiCloseRequest
import ch.nokillswit.teamkpis.TeamKpiCreateRequest
import ch.nokillswit.teamkpis.TeamKpiDefinitionUpdate
import ch.nokillswit.teamkpis.TeamKpiEventListResponse
import ch.nokillswit.teamkpis.TeamKpiEventType
import ch.nokillswit.teamkpis.TeamKpiPageResponse
import ch.nokillswit.teamkpis.TeamKpiProgressUpdate
import ch.nokillswit.teamkpis.TeamKpiResponse
import ch.nokillswit.teamkpis.TeamKpiStatus
import ch.nokillswit.teamkpis.TeamKpiType
import ch.nokillswit.teams.Team
import ch.nokillswit.users.UserRole
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class TeamKpiRoutesTest {

    private data class KpiTeam(
        val managerId: UInt,
        val managerEmail: String,
        val teamId: UInt,
        val memberId: UInt,
        val memberEmail: String,
        val member2Id: UInt,
        val member2Email: String,
    )

    /** A manager with a fresh two-member team per call, so tests never interfere. */
    private suspend fun seedTeam(): KpiTeam {
        val managerEmail = uniqueEmail("kpi-manager")
        val managerId = TestUsers.seed(managerEmail, "pw", name = "Mona Manager", roles = emptySet())
        val memberEmail = uniqueEmail("kpi-member")
        val memberId = TestUsers.seed(memberEmail, "pw", name = "Mel Member", roles = emptySet())
        val member2Email = uniqueEmail("kpi-member2")
        val member2Id = TestUsers.seed(member2Email, "pw", name = "Mia Member", roles = emptySet())
        val teamId = TestServices.teams.create(
            Team(name = "kpi-${UUID.randomUUID()}", managerId = managerId, memberIds = listOf(memberId, member2Id)),
        )
        return KpiTeam(managerId, managerEmail, teamId, memberId, memberEmail, member2Id, member2Email)
    }

    /** Puts [team]'s manager into a team managed by a new grand-manager; returns (email, id). */
    private suspend fun seedGrandManager(team: KpiTeam): Pair<String, UInt> {
        val grandEmail = uniqueEmail("kpi-grand")
        val grandId = TestUsers.seed(grandEmail, "pw", name = "Grand Manager", roles = emptySet())
        TestServices.teams.create(
            Team(name = "kpi-g-${UUID.randomUUID()}", managerId = grandId, memberIds = listOf(team.managerId)),
        )
        return grandEmail to grandId
    }

    private suspend fun HttpClient.createKpi(
        teamId: UInt,
        title: String = "Deploy frequency",
        description: String = "Weekly production deploys",
        type: TeamKpiType = TeamKpiType.NUMBER,
        targetValue: Double? = 10.0,
    ): TeamKpiResponse {
        val response = post("/api/v1/team-kpis") {
            contentType(ContentType.Application.Json)
            setBody(
                TeamKpiCreateRequest(
                    teamId = teamId,
                    title = title,
                    description = description,
                    type = type,
                    targetValue = targetValue,
                ),
            )
        }
        assertEquals(HttpStatusCode.Created, response.status)
        return response.body<TeamKpiResponse>()
    }

    // ---- creation ----

    @Test
    fun `create and read round-trip - always DRAFT, manager resolved from the team`() = testApplication {
        usePostgresTestcontainer()
        val team = seedTeam()
        val manager = authedClient(team.managerEmail, "pw")

        val response = manager.post("/api/v1/team-kpis") {
            contentType(ContentType.Application.Json)
            setBody(
                TeamKpiCreateRequest(
                    teamId = team.teamId,
                    title = "Ship weekly",
                    description = "One production release per week",
                    type = TeamKpiType.NUMBER,
                    targetValue = 52.0,
                ),
            )
        }
        assertEquals(HttpStatusCode.Created, response.status)
        val created = response.body<TeamKpiResponse>()
        assertEquals("/api/v1/team-kpis/${created.id}", response.headers["Location"])
        assertEquals(TeamKpiStatus.DRAFT, created.status)
        assertEquals(team.teamId, created.teamId)
        assertEquals(team.managerId, created.managerId)
        assertEquals("Mona Manager", created.managerName)
        assertFalse(created.teamDeleted)
        assertEquals(52.0, created.targetValue)
        assertEquals(0.0, created.currentValue)
        assertNull(created.summary)
        assertTrue(created.createdAt > 0)

        val fetched = manager.get("/api/v1/team-kpis/${created.id}").body<TeamKpiResponse>()
        assertEquals(created, fetched)
    }

    @Test
    fun `create is current-manager-only - member, unrelated, and ADMIN are 403`() = testApplication {
        usePostgresTestcontainer()
        val team = seedTeam()
        val unrelatedEmail = uniqueEmail("kpi-unrelated")
        TestUsers.seed(unrelatedEmail, "pw", roles = emptySet())
        val adminEmail = uniqueEmail("kpi-admin")
        TestUsers.seed(adminEmail, "pw", roles = setOf(UserRole.ADMIN))

        for (email in listOf(team.memberEmail, unrelatedEmail, adminEmail)) {
            val client = authedClient(email, "pw")
            val response = client.post("/api/v1/team-kpis") {
                contentType(ContentType.Application.Json)
                setBody(
                    TeamKpiCreateRequest(
                        teamId = team.teamId,
                        title = "Not yours",
                        type = TeamKpiType.NUMBER,
                        targetValue = 1.0,
                    ),
                )
            }
            assertEquals(HttpStatusCode.Forbidden, response.status, "expected 403 for $email")
        }
    }

    @Test
    fun `create validates the definition - a missing target is 400 for the manager`() = testApplication {
        usePostgresTestcontainer()
        val team = seedTeam()
        val manager = authedClient(team.managerEmail, "pw")

        val response = manager.post("/api/v1/team-kpis") {
            contentType(ContentType.Application.Json)
            setBody(TeamKpiCreateRequest(teamId = team.teamId, title = "No target", type = TeamKpiType.NUMBER))
        }
        assertEquals(HttpStatusCode.BadRequest, response.status)
        // But an outsider's identically malformed request stays 403 (the guard wins).
        val member = authedClient(team.memberEmail, "pw")
        val memberResponse = member.post("/api/v1/team-kpis") {
            contentType(ContentType.Application.Json)
            setBody(TeamKpiCreateRequest(teamId = team.teamId, title = "No target", type = TeamKpiType.NUMBER))
        }
        assertEquals(HttpStatusCode.Forbidden, memberResponse.status)
    }

    // ---- the read matrix ----

    @Test
    fun `a DRAFT is manager-and-HR-only, once ACTIVE members and the chain read it, outsiders never`() = testApplication {
        usePostgresTestcontainer()
        val team = seedTeam()
        val (grandEmail, _) = seedGrandManager(team)
        val unrelatedEmail = uniqueEmail("kpi-unrelated")
        TestUsers.seed(unrelatedEmail, "pw", roles = emptySet())
        val adminEmail = uniqueEmail("kpi-admin")
        TestUsers.seed(adminEmail, "pw", roles = setOf(UserRole.ADMIN))
        val hrEmail = uniqueEmail("kpi-hr")
        val hrId = TestUsers.seed(hrEmail, "pw", roles = setOf(UserRole.HR))

        val manager = authedClient(team.managerEmail, "pw")
        val created = manager.createKpi(team.teamId)

        val member = authedClient(team.memberEmail, "pw")
        val grand = authedClient(grandEmail, "pw")
        val unrelated = authedClient(unrelatedEmail, "pw")
        val admin = authedClient(adminEmail, "pw")
        val hr = authedClient(hrEmail, "pw")

        // DRAFT: only the manager and HR.
        assertEquals(HttpStatusCode.OK, manager.get("/api/v1/team-kpis/${created.id}").status)
        assertEquals(HttpStatusCode.Forbidden, member.get("/api/v1/team-kpis/${created.id}").status)
        assertEquals(HttpStatusCode.Forbidden, grand.get("/api/v1/team-kpis/${created.id}").status)
        assertEquals(HttpStatusCode.Forbidden, unrelated.get("/api/v1/team-kpis/${created.id}").status)
        assertEquals(HttpStatusCode.Forbidden, admin.get("/api/v1/team-kpis/${created.id}").status)
        val appender = LogCapture("ch.nokillswit.audit")
        try {
            assertEquals(HttpStatusCode.OK, hr.get("/api/v1/team-kpis/${created.id}").status)
            val read = appender.events.find { it.message == "hr.read" }
            assertNotNull(read, "expected an hr.read audit event")
            assertEquals("teamKpi", read.keyValuePairs.first { it.key == "resource" }.value)
            assertEquals(created.id.toLong(), read.keyValuePairs.first { it.key == "resourceId" }.value)
            assertEquals(hrId.toLong(), read.keyValuePairs.first { it.key == "byUserId" }.value)
        } finally {
            appender.detach()
        }

        // ACTIVE: members and the chain above the manager join in; outsiders (ADMIN included) don't.
        manager.post("/api/v1/team-kpis/${created.id}/activate")
        assertEquals(HttpStatusCode.OK, member.get("/api/v1/team-kpis/${created.id}").status)
        assertEquals(HttpStatusCode.OK, grand.get("/api/v1/team-kpis/${created.id}").status)
        assertEquals(HttpStatusCode.Forbidden, unrelated.get("/api/v1/team-kpis/${created.id}").status)
        assertEquals(HttpStatusCode.Forbidden, admin.get("/api/v1/team-kpis/${created.id}").status)

        // The events endpoint is authorized exactly like the single GET.
        assertEquals(HttpStatusCode.OK, member.get("/api/v1/team-kpis/${created.id}/events").status)
        assertEquals(HttpStatusCode.Forbidden, unrelated.get("/api/v1/team-kpis/${created.id}/events").status)
    }

    @Test
    fun `unknown ids are 404 and unauthenticated calls are 401`() = testApplication {
        usePostgresTestcontainer()
        val team = seedTeam()
        val manager = authedClient(team.managerEmail, "pw")
        assertEquals(HttpStatusCode.NotFound, manager.get("/api/v1/team-kpis/999999").status)
        assertEquals(HttpStatusCode.Unauthorized, jsonClient().get("/api/v1/team-kpis").status)
    }

    // ---- lifecycle ----

    @Test
    fun `full lifecycle - activate, progress, close with summary, reopen, deactivate`() = testApplication {
        usePostgresTestcontainer()
        val team = seedTeam()
        val manager = authedClient(team.managerEmail, "pw")
        val created = manager.createKpi(team.teamId)

        assertEquals(HttpStatusCode.NoContent, manager.post("/api/v1/team-kpis/${created.id}/activate").status)
        assertEquals(
            HttpStatusCode.NoContent,
            manager.put("/api/v1/team-kpis/${created.id}/progress") {
                contentType(ContentType.Application.Json)
                setBody(TeamKpiProgressUpdate(currentValue = 6.5, date = "2026-07-01"))
            }.status,
        )
        assertEquals(
            HttpStatusCode.NoContent,
            manager.post("/api/v1/team-kpis/${created.id}/close") {
                contentType(ContentType.Application.Json)
                setBody(TeamKpiCloseRequest(summary = "Solid year"))
            }.status,
        )
        val closed = manager.get("/api/v1/team-kpis/${created.id}").body<TeamKpiResponse>()
        assertEquals(TeamKpiStatus.CLOSED, closed.status)
        assertEquals(6.5, closed.currentValue)
        assertEquals("2026-07-01", closed.currentValueDate)
        assertEquals("Solid year", closed.summary)

        assertEquals(HttpStatusCode.NoContent, manager.post("/api/v1/team-kpis/${created.id}/reopen").status)
        // The summary survives the reopen as a record of the previous closure.
        assertEquals("Solid year", manager.get("/api/v1/team-kpis/${created.id}").body<TeamKpiResponse>().summary)
        assertEquals(HttpStatusCode.NoContent, manager.post("/api/v1/team-kpis/${created.id}/deactivate").status)
        assertEquals(
            TeamKpiStatus.DRAFT,
            manager.get("/api/v1/team-kpis/${created.id}").body<TeamKpiResponse>().status,
        )
    }

    @Test
    fun `illegal edges are 409 and close requires a non-blank summary`() = testApplication {
        usePostgresTestcontainer()
        val team = seedTeam()
        val manager = authedClient(team.managerEmail, "pw")
        val created = manager.createKpi(team.teamId)

        // From DRAFT only activate is valid.
        assertEquals(HttpStatusCode.Conflict, manager.post("/api/v1/team-kpis/${created.id}/deactivate").status)
        assertEquals(HttpStatusCode.Conflict, manager.post("/api/v1/team-kpis/${created.id}/reopen").status)
        assertEquals(
            HttpStatusCode.Conflict,
            manager.post("/api/v1/team-kpis/${created.id}/close") {
                contentType(ContentType.Application.Json)
                setBody(TeamKpiCloseRequest(summary = "nope"))
            }.status,
        )

        manager.post("/api/v1/team-kpis/${created.id}/activate")
        // A second activate is 409; a blank summary on close is 400.
        assertEquals(HttpStatusCode.Conflict, manager.post("/api/v1/team-kpis/${created.id}/activate").status)
        assertEquals(
            HttpStatusCode.BadRequest,
            manager.post("/api/v1/team-kpis/${created.id}/close") {
                contentType(ContentType.Application.Json)
                setBody(TeamKpiCloseRequest(summary = "   "))
            }.status,
        )
    }

    @Test
    fun `transitions are manager-only - a member may not activate`() = testApplication {
        usePostgresTestcontainer()
        val team = seedTeam()
        val manager = authedClient(team.managerEmail, "pw")
        val created = manager.createKpi(team.teamId)
        val member = authedClient(team.memberEmail, "pw")
        assertEquals(HttpStatusCode.Forbidden, member.post("/api/v1/team-kpis/${created.id}/activate").status)
        manager.post("/api/v1/team-kpis/${created.id}/activate")
        assertEquals(
            HttpStatusCode.Forbidden,
            member.put("/api/v1/team-kpis/${created.id}/progress") {
                contentType(ContentType.Application.Json)
                setBody(TeamKpiProgressUpdate(currentValue = 1.0, date = "2026-07-01"))
            }.status,
        )
    }

    @Test
    fun `each transition notifies the members - not the acting manager - with team-named params`() = testApplication {
        usePostgresTestcontainer()
        val team = seedTeam()
        val manager = authedClient(team.managerEmail, "pw")
        val created = manager.createKpi(team.teamId, title = "Notify the team")

        manager.post("/api/v1/team-kpis/${created.id}/activate")
        manager.post("/api/v1/team-kpis/${created.id}/close") {
            contentType(ContentType.Application.Json)
            setBody(TeamKpiCloseRequest(summary = "done"))
        }
        manager.post("/api/v1/team-kpis/${created.id}/reopen")
        manager.post("/api/v1/team-kpis/${created.id}/deactivate")

        for (email in listOf(team.memberEmail, team.member2Email)) {
            val member = authedClient(email, "pw")
            val notifications = member.get("/api/v1/notifications?pageSize=50").body<NotificationPageResponse>()
            val kpiNotes = notifications.items.filter { it.params["title"] == "Notify the team" }
            assertEquals(
                setOf(
                    NotificationType.TEAM_KPI_ACTIVATED_TO_MEMBER,
                    NotificationType.TEAM_KPI_CLOSED_TO_MEMBER,
                    NotificationType.TEAM_KPI_REOPENED_TO_MEMBER,
                    NotificationType.TEAM_KPI_DEACTIVATED_TO_MEMBER,
                ),
                kpiNotes.map { it.type }.toSet(),
            )
            kpiNotes.forEach { note ->
                assertEquals("Mona Manager", note.params["manager"])
                // The deactivation lands the KPI in DRAFT, unreadable for members — no link.
                if (note.type == NotificationType.TEAM_KPI_DEACTIVATED_TO_MEMBER) {
                    assertNull(note.link)
                } else {
                    assertEquals("/team-kpis/${created.id}/view", note.link)
                }
            }
        }
        // The manager (the actor) gets nothing.
        val managerNotes = manager.get("/api/v1/notifications?pageSize=50").body<NotificationPageResponse>()
        assertTrue(managerNotes.items.none { it.params["title"] == "Notify the team" })
    }

    // ---- per-status edit rules ----

    @Test
    fun `the definition PUT is DRAFT-only and mints per-aspect events, a type change resets progress`() = testApplication {
        usePostgresTestcontainer()
        val team = seedTeam()
        val manager = authedClient(team.managerEmail, "pw")
        val created = manager.createKpi(team.teamId)

        val edit = TeamKpiDefinitionUpdate(
            title = "Sharper title",
            description = created.description,
            type = TeamKpiType.PERCENTAGE,
            targetValue = 80.0,
        )
        assertEquals(
            HttpStatusCode.NoContent,
            manager.put("/api/v1/team-kpis/${created.id}") {
                contentType(ContentType.Application.Json)
                setBody(edit)
            }.status,
        )
        val edited = manager.get("/api/v1/team-kpis/${created.id}").body<TeamKpiResponse>()
        assertEquals("Sharper title", edited.title)
        assertEquals(TeamKpiType.PERCENTAGE, edited.type)
        assertEquals(80.0, edited.targetValue)
        assertEquals(0.0, edited.currentValue)

        val events = manager.get("/api/v1/team-kpis/${created.id}/events").body<TeamKpiEventListResponse>()
        assertEquals(
            listOf(
                TeamKpiEventType.CREATED,
                TeamKpiEventType.TITLE_CHANGED,
                TeamKpiEventType.TYPE_CHANGED,
                TeamKpiEventType.TARGET_CHANGED,
            ),
            events.items.map { it.type },
        )

        // Once ACTIVE the definition is immutable.
        manager.post("/api/v1/team-kpis/${created.id}/activate")
        assertEquals(
            HttpStatusCode.Conflict,
            manager.put("/api/v1/team-kpis/${created.id}") {
                contentType(ContentType.Application.Json)
                setBody(edit)
            }.status,
        )

        // A type change back in DRAFT resets the recorded progress, its date included.
        manager.put("/api/v1/team-kpis/${created.id}/progress") {
            contentType(ContentType.Application.Json)
            setBody(TeamKpiProgressUpdate(currentValue = 40.0, date = "2026-07-15"))
        }
        manager.post("/api/v1/team-kpis/${created.id}/deactivate")
        manager.put("/api/v1/team-kpis/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(edit.copy(type = TeamKpiType.NUMBER, targetValue = 10.0))
        }
        val reset = manager.get("/api/v1/team-kpis/${created.id}").body<TeamKpiResponse>()
        assertEquals(0.0, reset.currentValue)
        assertEquals(null, reset.currentValueDate)
    }

    @Test
    fun `the progress PUT is ACTIVE-only and records the dated event series`() = testApplication {
        usePostgresTestcontainer()
        val team = seedTeam()
        val manager = authedClient(team.managerEmail, "pw")
        val created = manager.createKpi(team.teamId)

        // DRAFT: no progress edits.
        assertEquals(
            HttpStatusCode.Conflict,
            manager.put("/api/v1/team-kpis/${created.id}/progress") {
                contentType(ContentType.Application.Json)
                setBody(TeamKpiProgressUpdate(currentValue = 1.0, date = "2026-07-01"))
            }.status,
        )

        manager.post("/api/v1/team-kpis/${created.id}/activate")
        for ((value, date) in listOf(2.0 to "2026-07-01", 5.0 to "2026-07-10")) {
            manager.put("/api/v1/team-kpis/${created.id}/progress") {
                contentType(ContentType.Application.Json)
                setBody(TeamKpiProgressUpdate(currentValue = value, date = date))
            }
        }
        // A missing value is 400, as are a missing, malformed, or future date.
        for (body in listOf(
            TeamKpiProgressUpdate(date = "2026-07-11"),
            TeamKpiProgressUpdate(currentValue = 6.0),
            TeamKpiProgressUpdate(currentValue = 6.0, date = "2026-7-11"),
            TeamKpiProgressUpdate(currentValue = 6.0, date = "2999-01-01"),
        )) {
            assertEquals(
                HttpStatusCode.BadRequest,
                manager.put("/api/v1/team-kpis/${created.id}/progress") {
                    contentType(ContentType.Application.Json)
                    setBody(body)
                }.status,
            )
        }

        // The event trail carries the whole dated value series — the Graph tab's data source.
        val events = manager.get("/api/v1/team-kpis/${created.id}/events").body<TeamKpiEventListResponse>()
        val progress = events.items.filter { it.type == TeamKpiEventType.PROGRESS_UPDATED }
        assertEquals(
            listOf("2.0" to "2026-07-01", "5.0" to "2026-07-10"),
            progress.map { it.params["to"] to it.params["date"] },
        )
        val read = manager.get("/api/v1/team-kpis/${created.id}").body<TeamKpiResponse>()
        assertEquals(5.0, read.currentValue)
        assertEquals("2026-07-10", read.currentValueDate)
    }

    @Test
    fun `latest-dated wins - a backdated value lands in the events but never overwrites Current`() = testApplication {
        usePostgresTestcontainer()
        val team = seedTeam()
        val manager = authedClient(team.managerEmail, "pw")
        val created = manager.createKpi(team.teamId)
        manager.post("/api/v1/team-kpis/${created.id}/activate")

        manager.put("/api/v1/team-kpis/${created.id}/progress") {
            contentType(ContentType.Application.Json)
            setBody(TeamKpiProgressUpdate(currentValue = 50.0, date = "2026-07-20"))
        }
        // Backfill an OLDER measurement: recorded as an event, Current untouched.
        assertEquals(
            HttpStatusCode.NoContent,
            manager.put("/api/v1/team-kpis/${created.id}/progress") {
                contentType(ContentType.Application.Json)
                setBody(TeamKpiProgressUpdate(currentValue = 30.0, date = "2026-07-05"))
            }.status,
        )
        val afterBackfill = manager.get("/api/v1/team-kpis/${created.id}").body<TeamKpiResponse>()
        assertEquals(50.0, afterBackfill.currentValue)
        assertEquals("2026-07-20", afterBackfill.currentValueDate)

        // A same-date re-recording DOES overwrite (>= keeps the newest submission for the day).
        manager.put("/api/v1/team-kpis/${created.id}/progress") {
            contentType(ContentType.Application.Json)
            setBody(TeamKpiProgressUpdate(currentValue = 55.0, date = "2026-07-20"))
        }
        val afterSameDay = manager.get("/api/v1/team-kpis/${created.id}").body<TeamKpiResponse>()
        assertEquals(55.0, afterSameDay.currentValue)

        // All three recordings are on the trail.
        val events = manager.get("/api/v1/team-kpis/${created.id}/events").body<TeamKpiEventListResponse>()
        val progress = events.items.filter { it.type == TeamKpiEventType.PROGRESS_UPDATED }
        assertEquals(
            listOf("50.0" to "2026-07-20", "30.0" to "2026-07-05", "55.0" to "2026-07-20"),
            progress.map { it.params["to"] to it.params["date"] },
        )
    }

    // ---- deletion ----

    @Test
    fun `delete is manager-only and DRAFT-only, and the audit trail outlives it`() = testApplication {
        usePostgresTestcontainer()
        val team = seedTeam()
        val manager = authedClient(team.managerEmail, "pw")
        val member = authedClient(team.memberEmail, "pw")
        val created = manager.createKpi(team.teamId)

        assertEquals(HttpStatusCode.Forbidden, member.delete("/api/v1/team-kpis/${created.id}").status)

        manager.post("/api/v1/team-kpis/${created.id}/activate")
        assertEquals(HttpStatusCode.BadRequest, manager.delete("/api/v1/team-kpis/${created.id}").status)
        manager.post("/api/v1/team-kpis/${created.id}/deactivate")

        assertEquals(HttpStatusCode.NoContent, manager.delete("/api/v1/team-kpis/${created.id}").status)
        assertEquals(HttpStatusCode.NotFound, manager.get("/api/v1/team-kpis/${created.id}").status)
        assertEquals(HttpStatusCode.NotFound, manager.delete("/api/v1/team-kpis/${created.id}").status)

        val surviving = TestTeamKpiEvents.service.listForKpi(created.id)
        assertTrue(surviving.any { it.type == TeamKpiEventType.DELETED })
    }

    // ---- lists ----

    @Test
    fun `own view lists non-DRAFT KPIs of the member's teams, managed view every status`() = testApplication {
        usePostgresTestcontainer()
        val team = seedTeam()
        val manager = authedClient(team.managerEmail, "pw")
        val marker = "kpi-list-${UUID.randomUUID()}"
        val draft = manager.createKpi(team.teamId, title = "$marker draft")
        val active = manager.createKpi(team.teamId, title = "$marker active")
        manager.post("/api/v1/team-kpis/${active.id}/activate")

        val member = authedClient(team.memberEmail, "pw")
        val own = member.get("/api/v1/team-kpis?title=$marker").body<TeamKpiPageResponse>()
        assertEquals(listOf(active.id), own.items.map { it.id })
        assertEquals(team.teamId, own.items.single().teamId)
        assertEquals(team.managerId, own.items.single().managerId)

        val managed = manager.get("/api/v1/team-kpis?view=managed&title=$marker&sort=title")
            .body<TeamKpiPageResponse>()
        assertEquals(setOf(draft.id, active.id), managed.items.map { it.id }.toSet())

        // The member's own view never widens to managed, and the manager's own view is empty
        // (they are not a member of this team).
        assertEquals(0, member.get("/api/v1/team-kpis?view=managed&title=$marker").body<TeamKpiPageResponse>().total)
        assertEquals(0, manager.get("/api/v1/team-kpis?title=$marker").body<TeamKpiPageResponse>().total)
    }

    @Test
    fun `list filters compose - teamId, title, status, type, and the date bounds all narrow`() = testApplication {
        usePostgresTestcontainer()
        val team = seedTeam()
        val otherTeamId = TestServices.teams.create(
            Team(name = "kpi-other-${UUID.randomUUID()}", managerId = team.managerId, memberIds = listOf(team.memberId)),
        )
        val manager = authedClient(team.managerEmail, "pw")
        val marker = "kpi-filter-${UUID.randomUUID()}"
        val one = manager.createKpi(team.teamId, title = "$marker one", type = TeamKpiType.NUMBER)
        val two = manager.createKpi(otherTeamId, title = "$marker two", type = TeamKpiType.PERCENTAGE, targetValue = 90.0)
        manager.post("/api/v1/team-kpis/${two.id}/activate")

        suspend fun ids(query: String): Set<UInt> =
            manager.get("/api/v1/team-kpis?view=managed&title=$marker&$query")
                .body<TeamKpiPageResponse>().items.map { it.id }.toSet()

        assertEquals(setOf(one.id, two.id), ids("sort=id"))
        assertEquals(setOf(one.id), ids("teamId=${team.teamId}"))
        assertEquals(setOf(two.id), ids("status=ACTIVE"))
        assertEquals(setOf(two.id), ids("type=PERCENTAGE"))
        assertEquals(setOf(one.id, two.id), ids("createdAt[gte]=0"))
        assertEquals(emptySet(), ids("createdAt[gte]=${System.currentTimeMillis() + 60_000}"))
        assertEquals(setOf(one.id, two.id), ids("lastModified[gte]=0"))
        // The teamName substring filter matches the seeded unique team name.
        val teamName = "kpi-other"
        assertTrue(ids("teamName=$teamName").contains(two.id))

        // Unknown view and unknown sort field are 400.
        assertEquals(HttpStatusCode.BadRequest, manager.get("/api/v1/team-kpis?view=user").status)
        assertEquals(HttpStatusCode.BadRequest, manager.get("/api/v1/team-kpis?sort=dueDate").status)
    }

    // ---- the current-manager derivation ----

    @Test
    fun `a reassigned team's new manager takes over its KPIs and the old one is locked out`() = testApplication {
        usePostgresTestcontainer()
        val team = seedTeam()
        val newManagerEmail = uniqueEmail("kpi-new-manager")
        val newManagerId = TestUsers.seed(newManagerEmail, "pw", name = "Nina New", roles = emptySet())
        val manager = authedClient(team.managerEmail, "pw")
        val created = manager.createKpi(team.teamId, title = "Handover KPI")
        manager.post("/api/v1/team-kpis/${created.id}/activate")

        // ADMIN-side reassignment (service level — the route path is covered by TeamRoutesTest).
        TestServices.teams.update(
            team.teamId,
            Team(name = "kpi-reassigned-${UUID.randomUUID()}", managerId = newManagerId, memberIds = listOf(team.memberId, team.member2Id)),
        )

        // The response resolves the CURRENT manager.
        val newManager = authedClient(newManagerEmail, "pw")
        val fetched = newManager.get("/api/v1/team-kpis/${created.id}").body<TeamKpiResponse>()
        assertEquals(newManagerId, fetched.managerId)
        assertEquals("Nina New", fetched.managerName)

        // The new manager holds the write rights...
        assertEquals(
            HttpStatusCode.NoContent,
            newManager.put("/api/v1/team-kpis/${created.id}/progress") {
                contentType(ContentType.Application.Json)
                setBody(TeamKpiProgressUpdate(currentValue = 3.0, date = "2026-07-01"))
            }.status,
        )
        assertEquals(
            setOf(created.id),
            newManager.get("/api/v1/team-kpis?view=managed&title=Handover")
                .body<TeamKpiPageResponse>().items.map { it.id }.toSet(),
        )

        // ...and the old manager — no longer a member, not in the chain — has nothing.
        assertEquals(HttpStatusCode.Forbidden, manager.get("/api/v1/team-kpis/${created.id}").status)
        assertEquals(HttpStatusCode.Forbidden, manager.post("/api/v1/team-kpis/${created.id}/deactivate").status)
        assertEquals(
            0,
            manager.get("/api/v1/team-kpis?view=managed&title=Handover").body<TeamKpiPageResponse>().total,
        )
    }

    @Test
    fun `a soft-deleted team's KPIs stay readable history for the manager, members lose access`() = testApplication {
        usePostgresTestcontainer()
        val team = seedTeam()
        val manager = authedClient(team.managerEmail, "pw")
        val created = manager.createKpi(team.teamId, title = "Orphaned KPI")
        manager.post("/api/v1/team-kpis/${created.id}/activate")

        TestServices.teams.delete(team.teamId)

        // The manager keeps the history — read and managed list, flagged teamDeleted.
        val fetched = manager.get("/api/v1/team-kpis/${created.id}").body<TeamKpiResponse>()
        assertTrue(fetched.teamDeleted)
        val managed = manager.get("/api/v1/team-kpis?view=managed&title=Orphaned").body<TeamKpiPageResponse>()
        assertEquals(listOf(created.id), managed.items.map { it.id })
        assertTrue(managed.items.single().teamDeleted)

        // Members lose it — the single GET and the own list both key on non-deleted membership.
        val member = authedClient(team.memberEmail, "pw")
        assertEquals(HttpStatusCode.Forbidden, member.get("/api/v1/team-kpis/${created.id}").status)
        assertEquals(0, member.get("/api/v1/team-kpis?title=Orphaned").body<TeamKpiPageResponse>().total)
    }
}
