package ch.nokillswit

import ch.nokillswit.notifications.NotificationPageResponse
import ch.nokillswit.notifications.NotificationType
import ch.nokillswit.teamkpis.TeamKpiArchiveRequest
import ch.nokillswit.teamkpis.TeamKpiCreateRequest
import ch.nokillswit.teamkpis.TeamKpiDefinitionUpdate
import ch.nokillswit.teamkpis.TeamKpiEventListResponse
import ch.nokillswit.teamkpis.TeamKpiEventType
import ch.nokillswit.teamkpis.TeamKpiPageResponse
import ch.nokillswit.teamkpis.TeamKpiResponse
import ch.nokillswit.teamkpis.TeamKpiStatus
import ch.nokillswit.teamkpis.TeamKpiType
import ch.nokillswit.teamkpis.TeamKpiValueListResponse
import ch.nokillswit.teamkpis.TeamKpiValueResponse
import ch.nokillswit.teamkpis.TeamKpiValueWrite
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

    private suspend fun HttpClient.addValue(kpiId: UInt, date: String, value: Double): TeamKpiValueResponse {
        val response = post("/api/v1/team-kpis/$kpiId/values") {
            contentType(ContentType.Application.Json)
            setBody(TeamKpiValueWrite(date = date, value = value))
        }
        assertEquals(HttpStatusCode.Created, response.status)
        return response.body<TeamKpiValueResponse>()
    }

    private suspend fun HttpClient.listValues(kpiId: UInt): List<TeamKpiValueResponse> =
        get("/api/v1/team-kpis/$kpiId/values").body<TeamKpiValueListResponse>().items

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
    fun `full lifecycle - activate, record a value, archive with summary, reopen, deactivate`() = testApplication {
        usePostgresTestcontainer()
        val team = seedTeam()
        val manager = authedClient(team.managerEmail, "pw")
        val created = manager.createKpi(team.teamId)

        assertEquals(HttpStatusCode.NoContent, manager.post("/api/v1/team-kpis/${created.id}/activate").status)
        manager.addValue(created.id, "2026-07-01", 6.5)
        assertEquals(
            HttpStatusCode.NoContent,
            manager.post("/api/v1/team-kpis/${created.id}/archive") {
                contentType(ContentType.Application.Json)
                setBody(TeamKpiArchiveRequest(summary = "Solid year"))
            }.status,
        )
        val archived = manager.get("/api/v1/team-kpis/${created.id}").body<TeamKpiResponse>()
        assertEquals(TeamKpiStatus.ARCHIVED, archived.status)
        assertEquals(6.5, archived.currentValue)
        assertEquals("2026-07-01", archived.currentValueDate)
        assertEquals("Solid year", archived.summary)

        assertEquals(HttpStatusCode.NoContent, manager.post("/api/v1/team-kpis/${created.id}/reopen").status)
        // The summary survives the reopen as a record of the previous archiving.
        assertEquals("Solid year", manager.get("/api/v1/team-kpis/${created.id}").body<TeamKpiResponse>().summary)
        assertEquals(HttpStatusCode.NoContent, manager.post("/api/v1/team-kpis/${created.id}/deactivate").status)
        assertEquals(
            TeamKpiStatus.DRAFT,
            manager.get("/api/v1/team-kpis/${created.id}").body<TeamKpiResponse>().status,
        )
    }

    @Test
    fun `illegal edges are 409 and archive requires a non-blank summary`() = testApplication {
        usePostgresTestcontainer()
        val team = seedTeam()
        val manager = authedClient(team.managerEmail, "pw")
        val created = manager.createKpi(team.teamId)

        // From DRAFT only activate is valid.
        assertEquals(HttpStatusCode.Conflict, manager.post("/api/v1/team-kpis/${created.id}/deactivate").status)
        assertEquals(HttpStatusCode.Conflict, manager.post("/api/v1/team-kpis/${created.id}/reopen").status)
        assertEquals(
            HttpStatusCode.Conflict,
            manager.post("/api/v1/team-kpis/${created.id}/archive") {
                contentType(ContentType.Application.Json)
                setBody(TeamKpiArchiveRequest(summary = "nope"))
            }.status,
        )

        // Off-edge, the blank-summary pre-check must not preempt the wrong-status 409.
        assertEquals(
            HttpStatusCode.Conflict,
            manager.post("/api/v1/team-kpis/${created.id}/archive") {
                contentType(ContentType.Application.Json)
                setBody(TeamKpiArchiveRequest(summary = "   "))
            }.status,
        )

        manager.post("/api/v1/team-kpis/${created.id}/activate")
        // A second activate is 409; a blank summary on archive is 400.
        assertEquals(HttpStatusCode.Conflict, manager.post("/api/v1/team-kpis/${created.id}/activate").status)
        assertEquals(
            HttpStatusCode.BadRequest,
            manager.post("/api/v1/team-kpis/${created.id}/archive") {
                contentType(ContentType.Application.Json)
                setBody(TeamKpiArchiveRequest(summary = "   "))
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
            member.post("/api/v1/team-kpis/${created.id}/values") {
                contentType(ContentType.Application.Json)
                setBody(TeamKpiValueWrite(date = "2026-07-01", value = 1.0))
            }.status,
        )
        // The bodied transition too — the guard runs before the body is even received.
        assertEquals(
            HttpStatusCode.Forbidden,
            member.post("/api/v1/team-kpis/${created.id}/archive") {
                contentType(ContentType.Application.Json)
                setBody(TeamKpiArchiveRequest(summary = "not yours"))
            }.status,
        )
        // And an unknown id on a transition is 404, for the manager.
        assertEquals(HttpStatusCode.NotFound, manager.post("/api/v1/team-kpis/999999/reopen").status)
    }

    @Test
    fun `each transition notifies the members - not the acting manager - with team-named params`() = testApplication {
        usePostgresTestcontainer()
        val team = seedTeam()
        val manager = authedClient(team.managerEmail, "pw")
        val created = manager.createKpi(team.teamId, title = "Notify the team")

        manager.post("/api/v1/team-kpis/${created.id}/activate")
        manager.post("/api/v1/team-kpis/${created.id}/archive") {
            contentType(ContentType.Application.Json)
            setBody(TeamKpiArchiveRequest(summary = "done"))
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
                    NotificationType.TEAM_KPI_ARCHIVED_TO_MEMBER,
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
    fun `the definition PUT is DRAFT-only and mints per-aspect events, a type change wipes the data points`() = testApplication {
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
                TeamKpiEventType.TARGET_CHANGED,
                TeamKpiEventType.TYPE_CHANGED,
                TeamKpiEventType.TITLE_CHANGED,
                TeamKpiEventType.CREATED,
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

        // A type change back in DRAFT wipes the collected data points, Current included.
        manager.addValue(created.id, "2026-07-15", 40.0)
        manager.post("/api/v1/team-kpis/${created.id}/deactivate")
        manager.put("/api/v1/team-kpis/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(edit.copy(type = TeamKpiType.NUMBER, targetValue = 10.0))
        }
        val reset = manager.get("/api/v1/team-kpis/${created.id}").body<TeamKpiResponse>()
        assertEquals(0.0, reset.currentValue)
        assertEquals(null, reset.currentValueDate)
        assertTrue(manager.listValues(created.id).isEmpty())

        // A same-type edit back keeps them (deactivate → edit title only → points survive).
        manager.post("/api/v1/team-kpis/${created.id}/activate")
        manager.addValue(created.id, "2026-07-16", 4.0)
        manager.post("/api/v1/team-kpis/${created.id}/deactivate")
        manager.put("/api/v1/team-kpis/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(edit.copy(title = "Same type, new words", type = TeamKpiType.NUMBER, targetValue = 10.0))
        }
        assertEquals(listOf("2026-07-16"), manager.listValues(created.id).map { it.date })
    }

    @Test
    fun `the definition PUT rejects bad payloads, outsiders, and unknown ids distinctly`() = testApplication {
        usePostgresTestcontainer()
        val team = seedTeam()
        val manager = authedClient(team.managerEmail, "pw")
        val created = manager.createKpi(team.teamId)
        val edit = TeamKpiDefinitionUpdate(
            title = "Valid title",
            description = "",
            type = TeamKpiType.NUMBER,
            targetValue = 10.0,
        )

        // 400: a blank title fails validation (for the manager, on a real DRAFT).
        assertEquals(
            HttpStatusCode.BadRequest,
            manager.put("/api/v1/team-kpis/${created.id}") {
                contentType(ContentType.Application.Json)
                setBody(edit.copy(title = "   "))
            }.status,
        )
        // 403: a member holds read rights only — even with a valid payload.
        val member = authedClient(team.memberEmail, "pw")
        assertEquals(
            HttpStatusCode.Forbidden,
            member.put("/api/v1/team-kpis/${created.id}") {
                contentType(ContentType.Application.Json)
                setBody(edit)
            }.status,
        )
        // 404: an unknown id, for the manager.
        assertEquals(
            HttpStatusCode.NotFound,
            manager.put("/api/v1/team-kpis/999999") {
                contentType(ContentType.Application.Json)
                setBody(edit)
            }.status,
        )
    }

    @Test
    fun `every team-KPI operation is 401 without a token`() = testApplication {
        usePostgresTestcontainer()
        val client = jsonClient()
        val gets = listOf(
            "/api/v1/team-kpis", "/api/v1/team-kpis/1", "/api/v1/team-kpis/1/values",
            "/api/v1/team-kpis/1/events",
        )
        gets.forEach { assertEquals(HttpStatusCode.Unauthorized, client.get(it).status, it) }
        val posts = listOf(
            "/api/v1/team-kpis", "/api/v1/team-kpis/1/values", "/api/v1/team-kpis/1/activate",
            "/api/v1/team-kpis/1/deactivate", "/api/v1/team-kpis/1/archive", "/api/v1/team-kpis/1/reopen",
        )
        posts.forEach { assertEquals(HttpStatusCode.Unauthorized, client.post(it).status, it) }
        val puts = listOf("/api/v1/team-kpis/1", "/api/v1/team-kpis/1/values/1")
        puts.forEach { assertEquals(HttpStatusCode.Unauthorized, client.put(it).status, it) }
        val deletes = listOf("/api/v1/team-kpis/1", "/api/v1/team-kpis/1/values/1")
        deletes.forEach { assertEquals(HttpStatusCode.Unauthorized, client.delete(it).status, it) }
    }

    // ---- data points ----

    @Test
    fun `adding values is ACTIVE-only, validates the payload, and recomputes Current from the max date`() = testApplication {
        usePostgresTestcontainer()
        val team = seedTeam()
        val manager = authedClient(team.managerEmail, "pw")
        val created = manager.createKpi(team.teamId)

        // DRAFT: no data-point edits.
        assertEquals(
            HttpStatusCode.Conflict,
            manager.post("/api/v1/team-kpis/${created.id}/values") {
                contentType(ContentType.Application.Json)
                setBody(TeamKpiValueWrite(date = "2026-07-01", value = 1.0))
            }.status,
        )

        manager.post("/api/v1/team-kpis/${created.id}/activate")
        val first = manager.addValue(created.id, "2026-07-10", 5.0)
        assertEquals("2026-07-10", first.date)
        assertEquals(5.0, first.value)
        // A backdated addition lands in the list but Current stays at the max-dated point.
        manager.addValue(created.id, "2026-07-01", 2.0)
        val read = manager.get("/api/v1/team-kpis/${created.id}").body<TeamKpiResponse>()
        assertEquals(5.0, read.currentValue)
        assertEquals("2026-07-10", read.currentValueDate)

        // The list is sorted by date, newest first.
        assertEquals(listOf("2026-07-10", "2026-07-01"), manager.listValues(created.id).map { it.date })

        // A missing value is 400, as are a missing, malformed, or future date.
        for (body in listOf(
            TeamKpiValueWrite(date = "2026-07-11"),
            TeamKpiValueWrite(value = 6.0),
            TeamKpiValueWrite(date = "2026-7-11", value = 6.0),
            TeamKpiValueWrite(date = "2999-01-01", value = 6.0),
        )) {
            assertEquals(
                HttpStatusCode.BadRequest,
                manager.post("/api/v1/team-kpis/${created.id}/values") {
                    contentType(ContentType.Application.Json)
                    setBody(body)
                }.status,
            )
        }
        // A date that already has a value is 409 (one value per date).
        assertEquals(
            HttpStatusCode.Conflict,
            manager.post("/api/v1/team-kpis/${created.id}/values") {
                contentType(ContentType.Application.Json)
                setBody(TeamKpiValueWrite(date = "2026-07-10", value = 6.0))
            }.status,
        )

        // Every addition (and nothing else) is on the audit trail, newest event first.
        val events = manager.get("/api/v1/team-kpis/${created.id}/events").body<TeamKpiEventListResponse>()
        val recorded = events.items.filter { it.type == TeamKpiEventType.VALUE_RECORDED }
        assertEquals(
            listOf("2026-07-01" to "2.0", "2026-07-10" to "5.0"),
            recorded.map { it.params["date"] to it.params["value"] },
        )
    }

    @Test
    fun `correcting a value re-dates or re-values it, recomputes Current, and audits the change`() = testApplication {
        usePostgresTestcontainer()
        val team = seedTeam()
        val manager = authedClient(team.managerEmail, "pw")
        val created = manager.createKpi(team.teamId)
        manager.post("/api/v1/team-kpis/${created.id}/activate")
        val early = manager.addValue(created.id, "2026-07-01", 2.0)
        val late = manager.addValue(created.id, "2026-07-10", 5.0)

        // Correct the latest point's value — Current follows.
        assertEquals(
            HttpStatusCode.NoContent,
            manager.put("/api/v1/team-kpis/${created.id}/values/${late.id}") {
                contentType(ContentType.Application.Json)
                setBody(TeamKpiValueWrite(date = "2026-07-10", value = 7.0))
            }.status,
        )
        assertEquals(7.0, manager.get("/api/v1/team-kpis/${created.id}").body<TeamKpiResponse>().currentValue)

        // Re-date the early point past the late one — Current jumps to it.
        manager.put("/api/v1/team-kpis/${created.id}/values/${early.id}") {
            contentType(ContentType.Application.Json)
            setBody(TeamKpiValueWrite(date = "2026-07-20", value = 2.0))
        }
        val read = manager.get("/api/v1/team-kpis/${created.id}").body<TeamKpiResponse>()
        assertEquals(2.0, read.currentValue)
        assertEquals("2026-07-20", read.currentValueDate)

        // An exact no-op is 204 but mints no event; moving onto an occupied date is 409.
        assertEquals(
            HttpStatusCode.NoContent,
            manager.put("/api/v1/team-kpis/${created.id}/values/${early.id}") {
                contentType(ContentType.Application.Json)
                setBody(TeamKpiValueWrite(date = "2026-07-20", value = 2.0))
            }.status,
        )
        assertEquals(
            HttpStatusCode.Conflict,
            manager.put("/api/v1/team-kpis/${created.id}/values/${early.id}") {
                contentType(ContentType.Application.Json)
                setBody(TeamKpiValueWrite(date = "2026-07-10", value = 2.0))
            }.status,
        )

        val events = manager.get("/api/v1/team-kpis/${created.id}/events").body<TeamKpiEventListResponse>()
        // Newest correction first.
        val corrected = events.items.filter { it.type == TeamKpiEventType.VALUE_CORRECTED }
        assertEquals(
            listOf(
                mapOf("fromDate" to "2026-07-01", "fromValue" to "2.0", "toDate" to "2026-07-20", "toValue" to "2.0"),
                mapOf("fromDate" to "2026-07-10", "fromValue" to "5.0", "toDate" to "2026-07-10", "toValue" to "7.0"),
            ),
            corrected.map { it.params },
        )
    }

    @Test
    fun `removing a value rolls Current back, removing the last resets it to zero`() = testApplication {
        usePostgresTestcontainer()
        val team = seedTeam()
        val manager = authedClient(team.managerEmail, "pw")
        val created = manager.createKpi(team.teamId)
        manager.post("/api/v1/team-kpis/${created.id}/activate")
        val early = manager.addValue(created.id, "2026-07-01", 2.0)
        val late = manager.addValue(created.id, "2026-07-10", 5.0)

        // Removing the latest-dated point rolls Current back to the next-latest.
        assertEquals(
            HttpStatusCode.NoContent,
            manager.delete("/api/v1/team-kpis/${created.id}/values/${late.id}").status,
        )
        val rolled = manager.get("/api/v1/team-kpis/${created.id}").body<TeamKpiResponse>()
        assertEquals(2.0, rolled.currentValue)
        assertEquals("2026-07-01", rolled.currentValueDate)

        // Removing the last point resets Current to 0.0/null; the removals are audited.
        manager.delete("/api/v1/team-kpis/${created.id}/values/${early.id}")
        val emptied = manager.get("/api/v1/team-kpis/${created.id}").body<TeamKpiResponse>()
        assertEquals(0.0, emptied.currentValue)
        assertNull(emptied.currentValueDate)
        assertTrue(manager.listValues(created.id).isEmpty())

        val events = manager.get("/api/v1/team-kpis/${created.id}/events").body<TeamKpiEventListResponse>()
        // Newest removal first.
        val removed = events.items.filter { it.type == TeamKpiEventType.VALUE_REMOVED }
        assertEquals(
            listOf("2026-07-01" to "2.0", "2026-07-10" to "5.0"),
            removed.map { it.params["date"] to it.params["value"] },
        )
        // An already-removed (or foreign) valueId is 404.
        assertEquals(
            HttpStatusCode.NotFound,
            manager.delete("/api/v1/team-kpis/${created.id}/values/${late.id}").status,
        )
    }

    @Test
    fun `every data-point mutation notifies the members with the value params - a no-op stays silent`() = testApplication {
        usePostgresTestcontainer()
        val team = seedTeam()
        val manager = authedClient(team.managerEmail, "pw")
        val created = manager.createKpi(team.teamId, title = "Notify the data", type = TeamKpiType.PERCENTAGE, targetValue = 90.0)
        manager.post("/api/v1/team-kpis/${created.id}/activate")

        val point = manager.addValue(created.id, "2026-07-27", 72.0)
        // A real correction notifies; the exact no-op resubmission stays silent.
        manager.put("/api/v1/team-kpis/${created.id}/values/${point.id}") {
            contentType(ContentType.Application.Json)
            setBody(TeamKpiValueWrite(date = "2026-07-28", value = 75.0))
        }
        manager.put("/api/v1/team-kpis/${created.id}/values/${point.id}") {
            contentType(ContentType.Application.Json)
            setBody(TeamKpiValueWrite(date = "2026-07-28", value = 75.0))
        }
        manager.delete("/api/v1/team-kpis/${created.id}/values/${point.id}")

        for (email in listOf(team.memberEmail, team.member2Email)) {
            val member = authedClient(email, "pw")
            val notes = member.get("/api/v1/notifications?pageSize=50").body<NotificationPageResponse>()
                .items.filter { it.params["title"] == "Notify the data" && it.type.name.contains("VALUE") }
            // Exactly one notification per real mutation — the no-op correction minted nothing
            // (three notes total, one of each kind; order left to the timestamp sort).
            assertEquals(3, notes.size)
            assertEquals(
                setOf(
                    NotificationType.TEAM_KPI_VALUE_RECORDED_TO_MEMBER,
                    NotificationType.TEAM_KPI_VALUE_CORRECTED_TO_MEMBER,
                    NotificationType.TEAM_KPI_VALUE_REMOVED_TO_MEMBER,
                ),
                notes.map { it.type }.toSet(),
            )
            notes.forEach { note ->
                assertEquals("Mona Manager", note.params["manager"])
                assertEquals("PERCENTAGE", note.params["kpiType"])
                assertEquals("/team-kpis/${created.id}/view", note.link)
            }
            val recorded = notes.single { it.type == NotificationType.TEAM_KPI_VALUE_RECORDED_TO_MEMBER }
            assertEquals("2026-07-27", recorded.params["date"])
            assertEquals("72.0", recorded.params["value"])
            val corrected = notes.single { it.type == NotificationType.TEAM_KPI_VALUE_CORRECTED_TO_MEMBER }
            assertEquals(
                mapOf("fromDate" to "2026-07-27", "fromValue" to "72.0", "toDate" to "2026-07-28", "toValue" to "75.0"),
                corrected.params.filterKeys { it.startsWith("from") || it.startsWith("to") },
            )
            val removed = notes.single { it.type == NotificationType.TEAM_KPI_VALUE_REMOVED_TO_MEMBER }
            assertEquals("2026-07-28", removed.params["date"])
            assertEquals("75.0", removed.params["value"])
        }
        // The acting manager (not a member of their own team here) gets nothing.
        val managerNotes = manager.get("/api/v1/notifications?pageSize=50").body<NotificationPageResponse>()
        assertTrue(managerNotes.items.none { it.params["title"] == "Notify the data" })
    }

    @Test
    fun `values are read by whoever reads the KPI and written by nobody else`() = testApplication {
        usePostgresTestcontainer()
        val team = seedTeam()
        val (grandEmail, _) = seedGrandManager(team)
        val unrelatedEmail = uniqueEmail("kpi-unrelated")
        TestUsers.seed(unrelatedEmail, "pw", roles = emptySet())
        val manager = authedClient(team.managerEmail, "pw")
        val created = manager.createKpi(team.teamId)
        manager.post("/api/v1/team-kpis/${created.id}/activate")
        val point = manager.addValue(created.id, "2026-07-01", 3.0)

        // Member and chain read; outsiders don't.
        val member = authedClient(team.memberEmail, "pw")
        val grand = authedClient(grandEmail, "pw")
        val unrelated = authedClient(unrelatedEmail, "pw")
        assertEquals(listOf(3.0), member.listValues(created.id).map { it.value })
        assertEquals(HttpStatusCode.OK, grand.get("/api/v1/team-kpis/${created.id}/values").status)
        assertEquals(HttpStatusCode.Forbidden, unrelated.get("/api/v1/team-kpis/${created.id}/values").status)

        // Mutations are current-manager-only, even for readers.
        assertEquals(
            HttpStatusCode.Forbidden,
            member.put("/api/v1/team-kpis/${created.id}/values/${point.id}") {
                contentType(ContentType.Application.Json)
                setBody(TeamKpiValueWrite(date = "2026-07-01", value = 9.0))
            }.status,
        )
        assertEquals(
            HttpStatusCode.Forbidden,
            member.delete("/api/v1/team-kpis/${created.id}/values/${point.id}").status,
        )

        // A malformed valueId is 400 (the resources plugin rejects it before any handler).
        assertEquals(
            HttpStatusCode.BadRequest,
            manager.delete("/api/v1/team-kpis/${created.id}/values/not-a-number").status,
        )

        // A valueId belonging to another KPI is 404, not a cross-KPI edit.
        val other = manager.createKpi(team.teamId, title = "Other KPI")
        manager.post("/api/v1/team-kpis/${other.id}/activate")
        assertEquals(
            HttpStatusCode.NotFound,
            manager.put("/api/v1/team-kpis/${other.id}/values/${point.id}") {
                contentType(ContentType.Application.Json)
                setBody(TeamKpiValueWrite(date = "2026-07-02", value = 1.0))
            }.status,
        )

        // Once archived the points are frozen — add, correct, and remove are all 409 — but
        // still readable.
        manager.post("/api/v1/team-kpis/${created.id}/archive") {
            contentType(ContentType.Application.Json)
            setBody(TeamKpiArchiveRequest(summary = "frozen"))
        }
        assertEquals(
            HttpStatusCode.Conflict,
            manager.post("/api/v1/team-kpis/${created.id}/values") {
                contentType(ContentType.Application.Json)
                setBody(TeamKpiValueWrite(date = "2026-07-02", value = 4.0))
            }.status,
        )
        assertEquals(
            HttpStatusCode.Conflict,
            manager.delete("/api/v1/team-kpis/${created.id}/values/${point.id}").status,
        )
        assertEquals(1, member.listValues(created.id).size)
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
        newManager.addValue(created.id, "2026-07-01", 3.0)
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
