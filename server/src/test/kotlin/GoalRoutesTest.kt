package ch.nokillswit

import ch.nokillswit.goals.GoalArchiveRequest
import ch.nokillswit.goals.GoalCreateRequest
import ch.nokillswit.goals.GoalDefinitionUpdate
import ch.nokillswit.goals.GoalEventListResponse
import ch.nokillswit.goals.GoalEventType
import ch.nokillswit.goals.GoalListFilter
import ch.nokillswit.goals.GoalListView
import ch.nokillswit.goals.GoalPageResponse
import ch.nokillswit.goals.GoalProgressUpdate
import ch.nokillswit.goals.GoalResponse
import ch.nokillswit.goals.GoalStatus
import ch.nokillswit.goals.GoalType
import ch.nokillswit.notifications.NotificationPageResponse
import ch.nokillswit.notifications.NotificationType
import ch.nokillswit.teams.Team
import ch.nokillswit.users.UserRole
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.request
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import java.time.LocalDate
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class GoalRoutesTest {

    private data class GoalPair(
        val managerId: UInt,
        val managerEmail: String,
        val subordinateId: UInt,
        val subordinateEmail: String,
    )

    /** A manager with one direct report (a fresh team per call, so tests never interfere). */
    private suspend fun seedPair(): GoalPair {
        val managerEmail = uniqueEmail("goal-manager")
        val managerId = TestUsers.seed(managerEmail, "pw", name = "Mona Manager", roles = emptySet())
        val subordinateEmail = uniqueEmail("goal-subordinate")
        val subordinateId = TestUsers.seed(subordinateEmail, "pw", name = "Sub Ordinate", roles = emptySet())
        val teamId = TestServices.teams.create(Team(name = "goal-${UUID.randomUUID()}", managerId = managerId))
        TestServices.teams.addMember(teamId, subordinateId)
        return GoalPair(managerId, managerEmail, subordinateId, subordinateEmail)
    }

    /** Puts [pair]'s manager into a team managed by a new grand-manager; returns (email, id). */
    private suspend fun seedGrandManager(pair: GoalPair): Pair<String, UInt> {
        val grandEmail = uniqueEmail("goal-grand")
        val grandId = TestUsers.seed(grandEmail, "pw", name = "Grand Manager", roles = emptySet())
        val teamId = TestServices.teams.create(Team(name = "goal-g-${UUID.randomUUID()}", managerId = grandId))
        TestServices.teams.addMember(teamId, pair.managerId)
        return grandEmail to grandId
    }

    private suspend fun HttpClient.createGoal(
        subordinateId: UInt,
        title: String = "Improve test coverage",
        description: String = "Get the suite green and keep it there",
        type: GoalType = GoalType.NUMBER,
        targetValue: Double? = 10.0,
        dueDate: String = LocalDate.now().toString(),
    ): GoalResponse {
        val response = post("/api/v1/goals") {
            contentType(ContentType.Application.Json)
            setBody(
                GoalCreateRequest(
                    subordinateId = subordinateId,
                    title = title,
                    description = description,
                    type = type,
                    targetValue = targetValue,
                    dueDate = dueDate,
                ),
            )
        }
        assertEquals(HttpStatusCode.Created, response.status)
        return response.body<GoalResponse>()
    }

    // ---- creation ----

    @Test
    fun `create and read round-trip - always DRAFT, manager from the JWT, values initialized`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val manager = authedClient(pair.managerEmail, "pw")

        val response = manager.post("/api/v1/goals") {
            contentType(ContentType.Application.Json)
            setBody(
                GoalCreateRequest(
                    subordinateId = pair.subordinateId,
                    title = "Ship the reporting module",
                    description = "All four report types, tested",
                    type = GoalType.NUMBER,
                    targetValue = 4.0,
                    dueDate = LocalDate.now().plusDays(30).toString(),
                ),
            )
        }
        assertEquals(HttpStatusCode.Created, response.status)
        val created = response.body<GoalResponse>()
        assertEquals("/api/v1/goals/${created.id}", response.headers["Location"])
        assertEquals(GoalStatus.DRAFT, created.status)
        assertEquals(pair.managerId, created.managerId)
        assertEquals("Mona Manager", created.managerName)
        assertEquals("Sub Ordinate", created.subordinateName)
        assertEquals(4.0, created.targetValue)
        assertEquals(LocalDate.now().plusDays(30).toString(), created.dueDate)
        // No recorded value yet (v2.8.1) — both value fields start unset.
        assertNull(created.currentValue)
        assertNull(created.achieved)
        assertNull(created.summary)
        assertTrue(created.createdAt > 0)

        val fetched = manager.get("/api/v1/goals/${created.id}").body<GoalResponse>()
        assertEquals(created, fetched)

        // Creation is audited but notifies nobody (a draft is private).
        val events = manager.get("/api/v1/goals/${created.id}/events").body<GoalEventListResponse>()
        assertEquals(listOf(GoalEventType.CREATED), events.items.map { it.type })
        assertEquals(mapOf("type" to "NUMBER"), events.items.single().params)
        val subordinate = authedClient(pair.subordinateEmail, "pw")
        val notifications = subordinate.get("/api/v1/notifications").body<NotificationPageResponse>()
        assertTrue(notifications.items.none { it.type.name.startsWith("GOAL_") })
    }

    @Test
    fun `a BINARY goal starts with no achieved flag and carries no numeric values`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val manager = authedClient(pair.managerEmail, "pw")

        val created = manager.createGoal(pair.subordinateId, type = GoalType.BINARY, targetValue = null)
        assertEquals(GoalType.BINARY, created.type)
        // v2.8.1: no recorded value until the first progress update — never an auto "false".
        assertNull(created.achieved)
        assertNull(created.targetValue)
        assertNull(created.currentValue)
    }

    @Test
    fun `create rejects non-direct-reports, nonexistent users, and create-on-behalf`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val outsiderEmail = uniqueEmail("goal-outsider")
        TestUsers.seed(outsiderEmail, "pw", roles = emptySet())
        val adminEmail = uniqueEmail("goal-admin")
        TestUsers.seed(adminEmail, "pw", roles = setOf(UserRole.ADMIN))

        suspend fun HttpClient.tryCreate(subordinateId: UInt) = post("/api/v1/goals") {
            contentType(ContentType.Application.Json)
            setBody(
                GoalCreateRequest(
                    subordinateId = subordinateId, title = "T", type = GoalType.NUMBER, targetValue = 1.0,
                    dueDate = LocalDate.now().toString(),
                ),
            )
        }.status

        // An outsider is not the subordinate's manager.
        assertEquals(HttpStatusCode.Forbidden, authedClient(outsiderEmail, "pw").tryCreate(pair.subordinateId))
        // ADMIN gets no create-on-behalf — the manager is always the author.
        assertEquals(HttpStatusCode.Forbidden, authedClient(adminEmail, "pw").tryCreate(pair.subordinateId))
        // A nonexistent subordinate is indistinguishable from a non-report (403, not 404).
        assertEquals(HttpStatusCode.Forbidden, authedClient(pair.managerEmail, "pw").tryCreate(999999u))
    }

    @Test
    fun `create validates the type-specific value rules and the title`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val manager = authedClient(pair.managerEmail, "pw")

        suspend fun tryCreate(
            title: String = "T",
            type: GoalType = GoalType.NUMBER,
            targetValue: Double? = 1.0,
            dueDate: String = LocalDate.now().toString(),
        ) = manager.post("/api/v1/goals") {
            contentType(ContentType.Application.Json)
            setBody(
                GoalCreateRequest(
                    subordinateId = pair.subordinateId, title = title, type = type, targetValue = targetValue,
                    dueDate = dueDate,
                ),
            )
        }.status

        assertEquals(HttpStatusCode.BadRequest, tryCreate(type = GoalType.BINARY, targetValue = 1.0))
        assertEquals(HttpStatusCode.BadRequest, tryCreate(type = GoalType.NUMBER, targetValue = null))
        assertEquals(HttpStatusCode.BadRequest, tryCreate(type = GoalType.PERCENTAGE, targetValue = null))
        assertEquals(HttpStatusCode.BadRequest, tryCreate(type = GoalType.PERCENTAGE, targetValue = 150.0))
        assertEquals(HttpStatusCode.BadRequest, tryCreate(type = GoalType.PERCENTAGE, targetValue = -1.0))
        assertEquals(HttpStatusCode.BadRequest, tryCreate(title = "   "))
        assertEquals(HttpStatusCode.BadRequest, tryCreate(title = "x".repeat(201)))
        // Due date: required well-formed ISO, never in the past ("today" is fine — see createGoal).
        assertEquals(HttpStatusCode.BadRequest, tryCreate(dueDate = LocalDate.now().minusDays(1).toString()))
        assertEquals(HttpStatusCode.BadRequest, tryCreate(dueDate = "2026-1-1"))
        assertEquals(HttpStatusCode.BadRequest, tryCreate(dueDate = "garbage"))
        // A missing dueDate can only be probed with raw JSON (the DTO field is non-optional).
        assertEquals(
            HttpStatusCode.BadRequest,
            manager.post("/api/v1/goals") {
                contentType(ContentType.Application.Json)
                setBody("""{"subordinateId":${pair.subordinateId},"title":"T","type":"NUMBER","targetValue":1.0}""")
            }.status,
        )
    }

    // ---- read authorization ----

    @Test
    fun `read matrix - parties always, chain managers only once out of DRAFT, admin never specially`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val (grandEmail, _) = seedGrandManager(pair)
        val strangerEmail = uniqueEmail("goal-stranger")
        TestUsers.seed(strangerEmail, "pw", roles = emptySet())
        val adminEmail = uniqueEmail("goal-admin")
        TestUsers.seed(adminEmail, "pw", roles = setOf(UserRole.ADMIN))

        val manager = authedClient(pair.managerEmail, "pw")
        val created = manager.createGoal(pair.subordinateId)

        // DRAFT: only the pair reads it; ADMIN (a management role), the wider chain, and
        // strangers do not.
        assertEquals(HttpStatusCode.OK, manager.get("/api/v1/goals/${created.id}").status)
        assertEquals(
            HttpStatusCode.OK,
            authedClient(pair.subordinateEmail, "pw").get("/api/v1/goals/${created.id}").status,
        )
        assertEquals(HttpStatusCode.Forbidden, authedClient(adminEmail, "pw").get("/api/v1/goals/${created.id}").status)
        assertEquals(
            HttpStatusCode.Forbidden,
            authedClient(grandEmail, "pw").get("/api/v1/goals/${created.id}").status,
        )
        assertEquals(
            HttpStatusCode.Forbidden,
            authedClient(strangerEmail, "pw").get("/api/v1/goals/${created.id}").status,
        )

        // ACTIVE: the chain manager now reads it (and its events); strangers still don't.
        assertEquals(HttpStatusCode.NoContent, manager.post("/api/v1/goals/${created.id}/activate").status)
        val grand = authedClient(grandEmail, "pw")
        assertEquals(HttpStatusCode.OK, grand.get("/api/v1/goals/${created.id}").status)
        assertEquals(HttpStatusCode.OK, grand.get("/api/v1/goals/${created.id}/events").status)
        assertEquals(
            HttpStatusCode.Forbidden,
            authedClient(strangerEmail, "pw").get("/api/v1/goals/${created.id}").status,
        )
    }

    @Test
    fun `missing goals are 404 - id probes learn existence, never content`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("goal-user")
        TestUsers.seed(email, "pw", roles = emptySet())
        val client = authedClient(email, "pw")

        assertEquals(HttpStatusCode.NotFound, client.get("/api/v1/goals/999999").status)
        assertEquals(HttpStatusCode.NotFound, client.get("/api/v1/goals/999999/events").status)
        assertEquals(HttpStatusCode.NotFound, client.post("/api/v1/goals/999999/activate").status)
        assertEquals(HttpStatusCode.NotFound, client.delete("/api/v1/goals/999999").status)
        // The remaining mutations read (→404) before receiving any body, so none is needed.
        assertEquals(HttpStatusCode.NotFound, client.put("/api/v1/goals/999999").status)
        assertEquals(HttpStatusCode.NotFound, client.put("/api/v1/goals/999999/progress").status)
        assertEquals(HttpStatusCode.NotFound, client.post("/api/v1/goals/999999/deactivate").status)
        assertEquals(HttpStatusCode.NotFound, client.post("/api/v1/goals/999999/archive").status)
        assertEquals(HttpStatusCode.NotFound, client.post("/api/v1/goals/999999/reopen").status)
    }

    @Test
    fun `goal endpoints require authentication`() = testApplication {
        usePostgresTestcontainer()
        val client = jsonClient()
        val endpoints = listOf(
            HttpMethod.Get to "/api/v1/goals",
            HttpMethod.Post to "/api/v1/goals",
            HttpMethod.Get to "/api/v1/goals/1",
            HttpMethod.Put to "/api/v1/goals/1",
            HttpMethod.Put to "/api/v1/goals/1/progress",
            HttpMethod.Post to "/api/v1/goals/1/activate",
            HttpMethod.Post to "/api/v1/goals/1/deactivate",
            HttpMethod.Post to "/api/v1/goals/1/archive",
            HttpMethod.Post to "/api/v1/goals/1/reopen",
            HttpMethod.Get to "/api/v1/goals/1/events",
            HttpMethod.Delete to "/api/v1/goals/1",
        )
        for ((verb, path) in endpoints) {
            val response = client.request(path) { method = verb }
            assertEquals(
                HttpStatusCode.Unauthorized,
                response.status,
                "$verb $path expected 401, got ${response.status}",
            )
        }
    }

    // ---- transitions ----

    @Test
    fun `the full cycle - activate, close with summary, reopen, deactivate`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val manager = authedClient(pair.managerEmail, "pw")
        val created = manager.createGoal(pair.subordinateId)

        assertEquals(HttpStatusCode.NoContent, manager.post("/api/v1/goals/${created.id}/activate").status)
        assertEquals(GoalStatus.ACTIVE, manager.get("/api/v1/goals/${created.id}").body<GoalResponse>().status)

        assertEquals(
            HttpStatusCode.NoContent,
            manager.post("/api/v1/goals/${created.id}/archive") {
                contentType(ContentType.Application.Json)
                setBody(GoalArchiveRequest(summary = "Delivered on time"))
            }.status,
        )
        val closed = manager.get("/api/v1/goals/${created.id}").body<GoalResponse>()
        assertEquals(GoalStatus.ARCHIVED, closed.status)
        assertEquals("Delivered on time", closed.summary)

        // Reopening keeps the summary as a record of the previous closure.
        assertEquals(HttpStatusCode.NoContent, manager.post("/api/v1/goals/${created.id}/reopen").status)
        val reopened = manager.get("/api/v1/goals/${created.id}").body<GoalResponse>()
        assertEquals(GoalStatus.ACTIVE, reopened.status)
        assertEquals("Delivered on time", reopened.summary)

        assertEquals(HttpStatusCode.NoContent, manager.post("/api/v1/goals/${created.id}/deactivate").status)
        assertEquals(GoalStatus.DRAFT, manager.get("/api/v1/goals/${created.id}").body<GoalResponse>().status)

        // Every hop is in the audit trail, newest first.
        val events = manager.get("/api/v1/goals/${created.id}/events").body<GoalEventListResponse>()
        assertEquals(
            listOf("ACTIVE>DRAFT", "ARCHIVED>ACTIVE", "ACTIVE>ARCHIVED", "DRAFT>ACTIVE"),
            events.items.filter { it.type == GoalEventType.STATUS_CHANGED }
                .map { "${it.params["from"]}>${it.params["to"]}" },
        )
    }

    @Test
    fun `illegal edges are 409 - ACTIVE is never skipped and terminal states hold`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val manager = authedClient(pair.managerEmail, "pw")
        val created = manager.createGoal(pair.subordinateId)

        suspend fun close() = manager.post("/api/v1/goals/${created.id}/archive") {
            contentType(ContentType.Application.Json)
            setBody(GoalArchiveRequest(summary = "s"))
        }.status

        // From DRAFT: close and reopen are invalid, and deactivate is a no-edge.
        assertEquals(HttpStatusCode.Conflict, close())
        assertEquals(HttpStatusCode.Conflict, manager.post("/api/v1/goals/${created.id}/reopen").status)
        assertEquals(HttpStatusCode.Conflict, manager.post("/api/v1/goals/${created.id}/deactivate").status)

        manager.post("/api/v1/goals/${created.id}/activate")
        // From ACTIVE: activate and reopen are invalid.
        assertEquals(HttpStatusCode.Conflict, manager.post("/api/v1/goals/${created.id}/activate").status)
        assertEquals(HttpStatusCode.Conflict, manager.post("/api/v1/goals/${created.id}/reopen").status)

        assertEquals(HttpStatusCode.NoContent, close())
        // From ARCHIVED: only reopen is valid.
        assertEquals(HttpStatusCode.Conflict, manager.post("/api/v1/goals/${created.id}/activate").status)
        assertEquals(HttpStatusCode.Conflict, manager.post("/api/v1/goals/${created.id}/deactivate").status)
        assertEquals(HttpStatusCode.Conflict, close())
    }

    @Test
    fun `closing requires a non-blank summary`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val manager = authedClient(pair.managerEmail, "pw")
        val created = manager.createGoal(pair.subordinateId)
        manager.post("/api/v1/goals/${created.id}/activate")

        suspend fun close(summary: String) = manager.post("/api/v1/goals/${created.id}/archive") {
            contentType(ContentType.Application.Json)
            setBody(GoalArchiveRequest(summary = summary))
        }.status

        assertEquals(HttpStatusCode.BadRequest, close(""))
        assertEquals(HttpStatusCode.BadRequest, close("   "))
        assertEquals(HttpStatusCode.BadRequest, close("x".repeat(4001)))
        assertEquals(HttpStatusCode.NoContent, close("Wrapped up"))
    }

    @Test
    fun `only the manager may transition - not the subordinate, not ADMIN`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val adminEmail = uniqueEmail("goal-admin")
        TestUsers.seed(adminEmail, "pw", roles = setOf(UserRole.ADMIN))
        val manager = authedClient(pair.managerEmail, "pw")
        val created = manager.createGoal(pair.subordinateId)

        val subordinate = authedClient(pair.subordinateEmail, "pw")
        assertEquals(
            HttpStatusCode.Forbidden,
            subordinate.post("/api/v1/goals/${created.id}/activate").status,
        )
        assertEquals(
            HttpStatusCode.Forbidden,
            authedClient(adminEmail, "pw").post("/api/v1/goals/${created.id}/activate").status,
        )

        // The other three edges are equally manager-only — probed at their valid source status,
        // so the 403 (guard) is what fires, not a 409. Close is checked with NO body: since the
        // guard runs before the body is received, a foreign caller learns nothing — not even
        // that their payload was malformed.
        manager.post("/api/v1/goals/${created.id}/activate")
        assertEquals(
            HttpStatusCode.Forbidden,
            subordinate.post("/api/v1/goals/${created.id}/deactivate").status,
        )
        assertEquals(
            HttpStatusCode.Forbidden,
            subordinate.post("/api/v1/goals/${created.id}/archive").status,
        )
        manager.post("/api/v1/goals/${created.id}/archive") {
            contentType(ContentType.Application.Json)
            setBody(GoalArchiveRequest(summary = "closed for the reopen probe"))
        }
        assertEquals(
            HttpStatusCode.Forbidden,
            subordinate.post("/api/v1/goals/${created.id}/reopen").status,
        )
    }

    @Test
    fun `each transition notifies the subordinate with the manager's name and the title`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val manager = authedClient(pair.managerEmail, "pw")
        val created = manager.createGoal(pair.subordinateId, title = "Notify me")

        manager.post("/api/v1/goals/${created.id}/activate")
        manager.post("/api/v1/goals/${created.id}/archive") {
            contentType(ContentType.Application.Json)
            setBody(GoalArchiveRequest(summary = "done"))
        }
        manager.post("/api/v1/goals/${created.id}/reopen")
        manager.post("/api/v1/goals/${created.id}/deactivate")

        val subordinate = authedClient(pair.subordinateEmail, "pw")
        val notifications = subordinate.get("/api/v1/notifications?pageSize=50").body<NotificationPageResponse>()
        val goalNotes = notifications.items.filter { it.params["title"] == "Notify me" }
        assertEquals(
            setOf(
                NotificationType.GOAL_ACTIVATED_TO_SUBORDINATE,
                NotificationType.GOAL_ARCHIVED_TO_SUBORDINATE,
                NotificationType.GOAL_REOPENED_TO_SUBORDINATE,
                NotificationType.GOAL_DEACTIVATED_TO_SUBORDINATE,
            ),
            goalNotes.map { it.type }.toSet(),
        )
        goalNotes.forEach { note ->
            assertEquals("Mona Manager", note.params["manager"])
            assertEquals("/goals/${created.id}/view", note.link)
        }
        // The manager (the actor) gets nothing.
        val managerNotes = manager.get("/api/v1/notifications?pageSize=50").body<NotificationPageResponse>()
        assertTrue(managerNotes.items.none { it.params["title"] == "Notify me" })
    }

    // ---- per-status edit rules ----

    @Test
    fun `the definition PUT is DRAFT-only and manager-only`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val manager = authedClient(pair.managerEmail, "pw")
        val created = manager.createGoal(pair.subordinateId)

        val edit = GoalDefinitionUpdate(
            title = "Sharper title",
            description = "Sharper description",
            type = GoalType.NUMBER,
            targetValue = 12.0,
            dueDate = created.dueDate,
        )

        // The subordinate never edits.
        assertEquals(
            HttpStatusCode.Forbidden,
            authedClient(pair.subordinateEmail, "pw").put("/api/v1/goals/${created.id}") {
                contentType(ContentType.Application.Json)
                setBody(edit)
            }.status,
        )

        // In DRAFT the manager edits the definition.
        assertEquals(
            HttpStatusCode.NoContent,
            manager.put("/api/v1/goals/${created.id}") {
                contentType(ContentType.Application.Json)
                setBody(edit)
            }.status,
        )
        val updated = manager.get("/api/v1/goals/${created.id}").body<GoalResponse>()
        assertEquals("Sharper title", updated.title)
        assertEquals("Sharper description", updated.description)
        assertEquals(12.0, updated.targetValue)
        assertTrue(updated.lastModified >= created.lastModified)

        // Once ACTIVE (and ARCHIVED) the definition is immutable.
        manager.post("/api/v1/goals/${created.id}/activate")
        assertEquals(
            HttpStatusCode.Conflict,
            manager.put("/api/v1/goals/${created.id}") {
                contentType(ContentType.Application.Json)
                setBody(edit)
            }.status,
        )
    }

    @Test
    fun `a definition edit records one event per changed aspect and a no-op records nothing`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val manager = authedClient(pair.managerEmail, "pw")
        val created = manager.createGoal(pair.subordinateId)

        manager.put("/api/v1/goals/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(
                GoalDefinitionUpdate(
                    title = "New title",
                    description = created.description,
                    type = GoalType.NUMBER,
                    targetValue = 20.0,
                    dueDate = created.dueDate,
                ),
            )
        }
        val afterEdit = manager.get("/api/v1/goals/${created.id}/events").body<GoalEventListResponse>()
        assertEquals(
            listOf(GoalEventType.TARGET_CHANGED, GoalEventType.TITLE_CHANGED, GoalEventType.CREATED),
            afterEdit.items.map { it.type },
        )
        assertEquals(mapOf("from" to "10.0", "to" to "20.0"), afterEdit.items.first().params)

        // Re-sending the same document records nothing new.
        manager.put("/api/v1/goals/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(
                GoalDefinitionUpdate(
                    title = "New title",
                    description = created.description,
                    type = GoalType.NUMBER,
                    targetValue = 20.0,
                    dueDate = created.dueDate,
                ),
            )
        }
        val afterNoop = manager.get("/api/v1/goals/${created.id}/events").body<GoalEventListResponse>()
        assertEquals(afterEdit.items.size, afterNoop.items.size)
    }

    @Test
    fun `changing the type in DRAFT re-initializes the value fields`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val manager = authedClient(pair.managerEmail, "pw")
        val created = manager.createGoal(pair.subordinateId, type = GoalType.NUMBER, targetValue = 10.0)

        // Record some progress, then pull the goal back to DRAFT and flip it to BINARY.
        manager.post("/api/v1/goals/${created.id}/activate")
        manager.put("/api/v1/goals/${created.id}/progress") {
            contentType(ContentType.Application.Json)
            setBody(GoalProgressUpdate(currentValue = 7.0))
        }
        manager.post("/api/v1/goals/${created.id}/deactivate")
        // Deactivating alone keeps the recorded progress.
        assertEquals(7.0, manager.get("/api/v1/goals/${created.id}").body<GoalResponse>().currentValue)

        assertEquals(
            HttpStatusCode.NoContent,
            manager.put("/api/v1/goals/${created.id}") {
                contentType(ContentType.Application.Json)
                setBody(
                    GoalDefinitionUpdate(
                        title = created.title,
                        description = created.description,
                        type = GoalType.BINARY,
                        targetValue = null,
                        dueDate = created.dueDate,
                    ),
                )
            }.status,
        )
        val flipped = manager.get("/api/v1/goals/${created.id}").body<GoalResponse>()
        assertEquals(GoalType.BINARY, flipped.type)
        assertNull(flipped.targetValue)
        assertNull(flipped.currentValue)
        // The reset lands back at "no recorded value" (v2.8.1), not the new type's zero.
        assertNull(flipped.achieved)
    }

    @Test
    fun `the progress PUT is ACTIVE-only and type-checked`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val manager = authedClient(pair.managerEmail, "pw")
        val created = manager.createGoal(pair.subordinateId, type = GoalType.PERCENTAGE, targetValue = 100.0)

        suspend fun HttpClient.progress(body: GoalProgressUpdate) =
            put("/api/v1/goals/${created.id}/progress") {
                contentType(ContentType.Application.Json)
                setBody(body)
            }.status

        // Not editable in DRAFT.
        assertEquals(HttpStatusCode.Conflict, manager.progress(GoalProgressUpdate(currentValue = 10.0)))

        manager.post("/api/v1/goals/${created.id}/activate")
        // The wrong field for the type, a missing field, and out-of-range percentages are 400.
        assertEquals(HttpStatusCode.BadRequest, manager.progress(GoalProgressUpdate(achieved = true)))
        assertEquals(HttpStatusCode.BadRequest, manager.progress(GoalProgressUpdate()))
        assertEquals(HttpStatusCode.BadRequest, manager.progress(GoalProgressUpdate(currentValue = 101.0)))
        // A non-party never updates progress (the pair's shared write is manager + subordinate
        // only — see the dedicated shared-write test below).
        val outsiderEmail = uniqueEmail("goal-outsider")
        TestUsers.seed(outsiderEmail, "pw", roles = emptySet())
        assertEquals(
            HttpStatusCode.Forbidden,
            authedClient(outsiderEmail, "pw").progress(GoalProgressUpdate(currentValue = 10.0)),
        )

        assertEquals(HttpStatusCode.NoContent, manager.progress(GoalProgressUpdate(currentValue = 40.0)))
        assertEquals(40.0, manager.get("/api/v1/goals/${created.id}").body<GoalResponse>().currentValue)

        // The change is audited with its from/to values ("" = no previous value, v2.8.1).
        val events = manager.get("/api/v1/goals/${created.id}/events").body<GoalEventListResponse>()
        val progressEvent = events.items.single { it.type == GoalEventType.PROGRESS_UPDATED }
        assertEquals(mapOf("from" to "", "to" to "40.0"), progressEvent.params)

        // Not editable once ARCHIVED either.
        manager.post("/api/v1/goals/${created.id}/archive") {
            contentType(ContentType.Application.Json)
            setBody(GoalArchiveRequest(summary = "done"))
        }
        assertEquals(HttpStatusCode.Conflict, manager.progress(GoalProgressUpdate(currentValue = 50.0)))
    }

    @Test
    fun `a BINARY goal's progress is the achieved flag`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val manager = authedClient(pair.managerEmail, "pw")
        val created = manager.createGoal(pair.subordinateId, type = GoalType.BINARY, targetValue = null)
        manager.post("/api/v1/goals/${created.id}/activate")

        // currentValue is the wrong field for BINARY.
        assertEquals(
            HttpStatusCode.BadRequest,
            manager.put("/api/v1/goals/${created.id}/progress") {
                contentType(ContentType.Application.Json)
                setBody(GoalProgressUpdate(currentValue = 1.0))
            }.status,
        )
        assertEquals(
            HttpStatusCode.NoContent,
            manager.put("/api/v1/goals/${created.id}/progress") {
                contentType(ContentType.Application.Json)
                setBody(GoalProgressUpdate(achieved = true))
            }.status,
        )
        assertEquals(true, manager.get("/api/v1/goals/${created.id}").body<GoalResponse>().achieved)
        val events = manager.get("/api/v1/goals/${created.id}/events").body<GoalEventListResponse>()
        assertEquals(
            mapOf("to" to "true"),
            events.items.single { it.type == GoalEventType.ACHIEVED_CHANGED }.params,
        )
    }

    @Test
    fun `progress is the pair's shared write - each party's update notifies the counterparty`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val manager = authedClient(pair.managerEmail, "pw")
        val created = manager.createGoal(pair.subordinateId, title = "Shared progress")
        manager.post("/api/v1/goals/${created.id}/activate")

        val subordinate = authedClient(pair.subordinateEmail, "pw")

        // The subordinate updates (v2.8.0) — the manager is notified.
        assertEquals(
            HttpStatusCode.NoContent,
            subordinate.put("/api/v1/goals/${created.id}/progress") {
                contentType(ContentType.Application.Json)
                setBody(GoalProgressUpdate(currentValue = 3.0))
            }.status,
        )
        assertEquals(3.0, subordinate.get("/api/v1/goals/${created.id}").body<GoalResponse>().currentValue)
        val managerNotes = manager.get("/api/v1/notifications?pageSize=50").body<NotificationPageResponse>()
        val toManager = managerNotes.items.single { it.params["title"] == "Shared progress" }
        assertEquals(NotificationType.GOAL_PROGRESS_UPDATED_TO_MANAGER, toManager.type)
        assertEquals("Sub Ordinate", toManager.params["subordinate"])
        assertEquals("/goals/${created.id}/view", toManager.link)

        // The manager updates — the subordinate is notified.
        assertEquals(
            HttpStatusCode.NoContent,
            manager.put("/api/v1/goals/${created.id}/progress") {
                contentType(ContentType.Application.Json)
                setBody(GoalProgressUpdate(currentValue = 5.0))
            }.status,
        )
        val subNotes = subordinate.get("/api/v1/notifications?pageSize=50").body<NotificationPageResponse>()
        val toSubordinate = subNotes.items
            .single { it.params["title"] == "Shared progress" && it.type == NotificationType.GOAL_PROGRESS_UPDATED_TO_SUBORDINATE }
        assertEquals("Mona Manager", toSubordinate.params["manager"])

        // Only the STATUS stays manager-only: the subordinate still cannot transition, edit the
        // definition, or delete.
        assertEquals(
            HttpStatusCode.Forbidden,
            subordinate.post("/api/v1/goals/${created.id}/deactivate").status,
        )

        // A true no-op (same value, no comment) mints neither a notification nor an event.
        val eventsBefore = manager.get("/api/v1/goals/${created.id}/events").body<GoalEventListResponse>()
        assertEquals(
            HttpStatusCode.NoContent,
            manager.put("/api/v1/goals/${created.id}/progress") {
                contentType(ContentType.Application.Json)
                setBody(GoalProgressUpdate(currentValue = 5.0))
            }.status,
        )
        val eventsAfter = manager.get("/api/v1/goals/${created.id}/events").body<GoalEventListResponse>()
        assertEquals(eventsBefore.items.size, eventsAfter.items.size)
        val subNotesAfter = subordinate.get("/api/v1/notifications?pageSize=50").body<NotificationPageResponse>()
        assertEquals(
            1,
            subNotesAfter.items.count {
                it.params["title"] == "Shared progress" && it.type == NotificationType.GOAL_PROGRESS_UPDATED_TO_SUBORDINATE
            },
        )

        // HR reads everything but writes nothing — progress included.
        val hrEmail = uniqueEmail("goal-hr")
        TestUsers.seed(hrEmail, "pw", roles = setOf(UserRole.HR))
        assertEquals(
            HttpStatusCode.Forbidden,
            authedClient(hrEmail, "pw").put("/api/v1/goals/${created.id}/progress") {
                contentType(ContentType.Application.Json)
                setBody(GoalProgressUpdate(currentValue = 9.0))
            }.status,
        )
    }

    @Test
    fun `a progress comment lands on the history event and comment-only updates record PROGRESS_COMMENTED`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val manager = authedClient(pair.managerEmail, "pw")
        val created = manager.createGoal(pair.subordinateId, title = "Commented progress")
        manager.post("/api/v1/goals/${created.id}/activate")
        val subordinate = authedClient(pair.subordinateEmail, "pw")

        // A value change with a comment: the comment rides the PROGRESS_UPDATED event.
        assertEquals(
            HttpStatusCode.NoContent,
            subordinate.put("/api/v1/goals/${created.id}/progress") {
                contentType(ContentType.Application.Json)
                setBody(GoalProgressUpdate(currentValue = 4.0, comment = "Landed the first two modules"))
            }.status,
        )
        var events = subordinate.get("/api/v1/goals/${created.id}/events").body<GoalEventListResponse>()
        val updated = events.items.single { it.type == GoalEventType.PROGRESS_UPDATED }
        assertEquals(mapOf("from" to "", "to" to "4.0"), updated.params)
        assertEquals("Landed the first two modules", updated.comment)
        // The comment never leaks into the plaintext params.
        assertFalse(updated.params.values.any { it.contains("modules") })

        // A comment-only update (value unchanged) still records — and notifies.
        assertEquals(
            HttpStatusCode.NoContent,
            subordinate.put("/api/v1/goals/${created.id}/progress") {
                contentType(ContentType.Application.Json)
                setBody(GoalProgressUpdate(currentValue = 4.0, comment = "No movement — blocked by the API review"))
            }.status,
        )
        events = subordinate.get("/api/v1/goals/${created.id}/events").body<GoalEventListResponse>()
        val commented = events.items.single { it.type == GoalEventType.PROGRESS_COMMENTED }
        assertEquals(emptyMap<String, String>(), commented.params)
        assertEquals("No movement — blocked by the API review", commented.comment)
        val managerNotes = manager.get("/api/v1/notifications?pageSize=50").body<NotificationPageResponse>()
        assertEquals(
            2,
            managerNotes.items.count {
                it.params["title"] == "Commented progress" && it.type == NotificationType.GOAL_PROGRESS_UPDATED_TO_MANAGER
            },
        )

        // A blank comment counts as absent: same value + blank comment = true no-op.
        assertEquals(
            HttpStatusCode.NoContent,
            subordinate.put("/api/v1/goals/${created.id}/progress") {
                contentType(ContentType.Application.Json)
                setBody(GoalProgressUpdate(currentValue = 4.0, comment = "   "))
            }.status,
        )
        val afterBlank = subordinate.get("/api/v1/goals/${created.id}/events").body<GoalEventListResponse>()
        assertEquals(events.items.size, afterBlank.items.size)

        // Other event kinds carry no comment.
        assertTrue(afterBlank.items.filter { it.type == GoalEventType.CREATED }.all { it.comment == null })

        // An oversized comment is 400.
        assertEquals(
            HttpStatusCode.BadRequest,
            subordinate.put("/api/v1/goals/${created.id}/progress") {
                contentType(ContentType.Application.Json)
                setBody(GoalProgressUpdate(currentValue = 5.0, comment = "x".repeat(4001)))
            }.status,
        )
    }

    @Test
    fun `the value field is optional - a value-less update needs a comment and leaves the value unset`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val manager = authedClient(pair.managerEmail, "pw")
        val created = manager.createGoal(pair.subordinateId, title = "Valueless progress")
        manager.post("/api/v1/goals/${created.id}/activate")
        val subordinate = authedClient(pair.subordinateEmail, "pw")

        // Neither a value nor a comment → 400 (nothing to record).
        assertEquals(
            HttpStatusCode.BadRequest,
            subordinate.put("/api/v1/goals/${created.id}/progress") {
                contentType(ContentType.Application.Json)
                setBody(GoalProgressUpdate())
            }.status,
        )

        // A comment alone works even while the goal has no recorded value (v2.8.1): the value
        // stays unset, PROGRESS_COMMENTED is minted, the counterparty is notified.
        assertEquals(
            HttpStatusCode.NoContent,
            subordinate.put("/api/v1/goals/${created.id}/progress") {
                contentType(ContentType.Application.Json)
                setBody(GoalProgressUpdate(comment = "Kickoff scheduled for Monday"))
            }.status,
        )
        val afterComment = subordinate.get("/api/v1/goals/${created.id}").body<GoalResponse>()
        assertNull(afterComment.currentValue)
        val events = subordinate.get("/api/v1/goals/${created.id}/events").body<GoalEventListResponse>()
        assertEquals("Kickoff scheduled for Monday", events.items.single { it.type == GoalEventType.PROGRESS_COMMENTED }.comment)
        val managerNotes = manager.get("/api/v1/notifications?pageSize=50").body<NotificationPageResponse>()
        assertEquals(
            1,
            managerNotes.items.count {
                it.params["title"] == "Valueless progress" && it.type == NotificationType.GOAL_PROGRESS_UPDATED_TO_MANAGER
            },
        )
    }

    @Test
    fun `an explicit achieved=false on a fresh BINARY goal is a recorded change`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val manager = authedClient(pair.managerEmail, "pw")
        val created = manager.createGoal(pair.subordinateId, type = GoalType.BINARY, targetValue = null)
        manager.post("/api/v1/goals/${created.id}/activate")

        // null → false IS a change (a deliberately recorded "not achieved", v2.8.1).
        assertEquals(
            HttpStatusCode.NoContent,
            manager.put("/api/v1/goals/${created.id}/progress") {
                contentType(ContentType.Application.Json)
                setBody(GoalProgressUpdate(achieved = false))
            }.status,
        )
        assertEquals(false, manager.get("/api/v1/goals/${created.id}").body<GoalResponse>().achieved)
        val events = manager.get("/api/v1/goals/${created.id}/events").body<GoalEventListResponse>()
        assertEquals(
            mapOf("to" to "false"),
            events.items.single { it.type == GoalEventType.ACHIEVED_CHANGED }.params,
        )
    }

    // ---- delete ----

    @Test
    fun `delete is manager-only and DRAFT-only, and the audit trail survives`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val manager = authedClient(pair.managerEmail, "pw")
        val created = manager.createGoal(pair.subordinateId)

        assertEquals(
            HttpStatusCode.Forbidden,
            authedClient(pair.subordinateEmail, "pw").delete("/api/v1/goals/${created.id}").status,
        )

        // An ACTIVE goal may not be deleted — it is a record.
        manager.post("/api/v1/goals/${created.id}/activate")
        assertEquals(HttpStatusCode.BadRequest, manager.delete("/api/v1/goals/${created.id}").status)
        manager.post("/api/v1/goals/${created.id}/deactivate")

        assertEquals(HttpStatusCode.NoContent, manager.delete("/api/v1/goals/${created.id}").status)
        assertEquals(HttpStatusCode.NotFound, manager.get("/api/v1/goals/${created.id}").status)
        // Idempotent in effect: a second delete is 404.
        assertEquals(HttpStatusCode.NotFound, manager.delete("/api/v1/goals/${created.id}").status)

        // Events outlive the soft-deleted row; the deletion tops the newest-first list.
        val events = TestGoalEvents.service.listForGoal(created.id)
        assertEquals(GoalEventType.DELETED, events.first().type)
        assertEquals(pair.managerId, events.first().userId)
    }

    // ---- list views ----

    @Test
    fun `list views scope by role and the team view hides drafts`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val (grandEmail, _) = seedGrandManager(pair)
        val manager = authedClient(pair.managerEmail, "pw")

        val draft = manager.createGoal(pair.subordinateId, title = "list-draft-${pair.managerId}")
        val active = manager.createGoal(pair.subordinateId, title = "list-active-${pair.managerId}")
        manager.post("/api/v1/goals/${active.id}/activate")

        // own: the subordinate sees both of their goals (drafts included — they are a party).
        val subordinate = authedClient(pair.subordinateEmail, "pw")
        val own = subordinate.get("/api/v1/goals").body<GoalPageResponse>()
        assertEquals(setOf(draft.id, active.id), own.items.map { it.id }.toSet())

        // managed: the manager sees both.
        val managed = manager.get("/api/v1/goals?view=managed").body<GoalPageResponse>()
        assertEquals(setOf(draft.id, active.id), managed.items.map { it.id }.toSet())

        // team: the grand-manager sees only the non-draft goal of their report's report.
        val grand = authedClient(grandEmail, "pw")
        val team = grand.get("/api/v1/goals?view=team").body<GoalPageResponse>()
        assertEquals(listOf(active.id), team.items.map { it.id })
        // ...and every listed row is openable (the scope mirrors the read guard).
        assertEquals(HttpStatusCode.OK, grand.get("/api/v1/goals/${active.id}").status)

        // A manager with no team gets an empty team view.
        val teamOfSubordinate = subordinate.get("/api/v1/goals?view=team").body<GoalPageResponse>()
        assertEquals(0, teamOfSubordinate.total)
    }

    @Test
    fun `includeIndirect widens the team view to the transitive chain`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val (_, grandId) = seedGrandManager(pair)
        // A great-grand-manager above the grand-manager.
        val greatEmail = uniqueEmail("goal-great")
        val greatId = TestUsers.seed(greatEmail, "pw", roles = emptySet())
        val teamId = TestServices.teams.create(Team(name = "goal-gg-${UUID.randomUUID()}", managerId = greatId))
        TestServices.teams.addMember(teamId, grandId)

        val manager = authedClient(pair.managerEmail, "pw")
        val active = manager.createGoal(pair.subordinateId, title = "indirect-${pair.managerId}")
        manager.post("/api/v1/goals/${active.id}/activate")

        val great = authedClient(greatEmail, "pw")
        // Direct-only: the goal's manager is two levels down, so the default team view is empty.
        val direct = great.get("/api/v1/goals?view=team&title=indirect-${pair.managerId}").body<GoalPageResponse>()
        assertEquals(0, direct.total)
        val indirect = great.get("/api/v1/goals?view=team&includeIndirect=true&title=indirect-${pair.managerId}")
            .body<GoalPageResponse>()
        assertEquals(listOf(active.id), indirect.items.map { it.id })

        // includeIndirect is manager-side only — the own view rejects it.
        assertEquals(
            HttpStatusCode.BadRequest,
            great.get("/api/v1/goals?view=own&includeIndirect=true").status,
        )
    }

    @Test
    fun `includeIndirect widens the managed view to goals set within the chain`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val (grandEmail, _) = seedGrandManager(pair)

        // The mid manager's goals for their report: one DRAFT (private to the pair), one ACTIVE.
        val manager = authedClient(pair.managerEmail, "pw")
        val midDraft = manager.createGoal(pair.subordinateId, title = "mgd-draft-${pair.managerId}")
        val midActive = manager.createGoal(pair.subordinateId, title = "mgd-active-${pair.managerId}")
        manager.post("/api/v1/goals/${midActive.id}/activate")

        // The grand-manager's own goal — a DRAFT for the mid manager (their direct report).
        val grand = authedClient(grandEmail, "pw")
        val ownDraft = grand.createGoal(pair.managerId, title = "mgd-own-${pair.managerId}")

        // Direct-only managed: exactly the caller's own goals, drafts included.
        val direct = grand.get("/api/v1/goals?view=managed").body<GoalPageResponse>()
        assertEquals(listOf(ownDraft.id), direct.items.map { it.id })

        // Widened: own goals (still drafts included) plus the chain manager's non-DRAFT goals —
        // the chain's drafts stay hidden, mirroring the single-GET's chain rule.
        val widened = grand.get("/api/v1/goals?view=managed&includeIndirect=true").body<GoalPageResponse>()
        assertEquals(setOf(ownDraft.id, midActive.id), widened.items.map { it.id }.toSet())
        assertFalse(widened.items.any { it.id == midDraft.id })
        // ...and every listed row is openable.
        assertEquals(HttpStatusCode.OK, grand.get("/api/v1/goals/${midActive.id}").status)

        // A manager whose chain sets no goals gets exactly their own managed view.
        val mid = manager.get("/api/v1/goals?view=managed&includeIndirect=true").body<GoalPageResponse>()
        assertEquals(setOf(midDraft.id, midActive.id), mid.items.map { it.id }.toSet())
    }

    @Test
    fun `list filters, sorting, and validation`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val manager = authedClient(pair.managerEmail, "pw")
        val marker = "flt-${UUID.randomUUID().toString().take(8)}"

        val binary = manager.createGoal(
            pair.subordinateId, title = "$marker binary", type = GoalType.BINARY, targetValue = null,
        )
        val number = manager.createGoal(pair.subordinateId, title = "$marker number")
        manager.post("/api/v1/goals/${number.id}/activate")

        suspend fun page(query: String) =
            manager.get("/api/v1/goals?view=managed&$query").body<GoalPageResponse>()

        // Substring title filter (case-insensitive) + type/status equality filters.
        assertEquals(2, page("title=${marker.uppercase()}").total)
        assertEquals(listOf(binary.id), page("title=$marker&type=BINARY").items.map { it.id })
        assertEquals(listOf(number.id), page("title=$marker&status=ACTIVE").items.map { it.id })
        // The list never carries description/summary; it does carry the value fields
        // (unset here — a fresh goal has no recorded value, v2.8.1).
        val row = page("title=$marker&type=BINARY").items.single()
        assertNull(row.achieved)
        assertEquals("Mona Manager", row.managerName)
        assertFalse(row.managerDeleted)

        // Sorting: title ascending puts "binary" before "number"; unknown sort fields are 400.
        assertEquals(
            listOf(binary.id, number.id),
            page("title=$marker&sort=title").items.map { it.id },
        )
        assertEquals(
            listOf(number.id, binary.id),
            page("title=$marker&sort=-title").items.map { it.id },
        )
        assertEquals(
            HttpStatusCode.BadRequest,
            manager.get("/api/v1/goals?view=managed&sort=description").status,
        )
        assertEquals(HttpStatusCode.BadRequest, manager.get("/api/v1/goals?view=nope").status)
        assertEquals(HttpStatusCode.BadRequest, manager.get("/api/v1/goals?status=SHINY").status)
    }

    @Test
    fun `exact party-id filters and the createdAt window scope the list`() = testApplication {
        usePostgresTestcontainer()
        // Two managers over the same subordinate cohort keeps the own view ambiguous without
        // the managerId filter — exactly the per-manager drill-down's situation.
        val pairA = seedPair()
        val pairB = seedPair()
        val sharedSubordinateEmail = pairA.subordinateEmail
        val teamB = TestServices.teams.create(Team(name = "goal-b-${UUID.randomUUID()}", managerId = pairB.managerId))
        TestServices.teams.addMember(teamB, pairA.subordinateId)

        val before = System.currentTimeMillis()
        val fromA = authedClient(pairA.managerEmail, "pw").createGoal(pairA.subordinateId, title = "from A")
        val fromB = authedClient(pairB.managerEmail, "pw").createGoal(pairA.subordinateId, title = "from B")

        val subordinate = authedClient(sharedSubordinateEmail, "pw")
        // Unfiltered own view sees both; managerId narrows to one.
        assertEquals(
            setOf(fromA.id, fromB.id),
            subordinate.get("/api/v1/goals").body<GoalPageResponse>().items.map { it.id }.toSet(),
        )
        assertEquals(
            listOf(fromA.id),
            subordinate.get("/api/v1/goals?managerId=${pairA.managerId}").body<GoalPageResponse>()
                .items.map { it.id },
        )
        // subordinateId narrows the manager's view symmetrically.
        assertEquals(
            listOf(fromB.id),
            authedClient(pairB.managerEmail, "pw")
                .get("/api/v1/goals?view=managed&subordinateId=${pairA.subordinateId}")
                .body<GoalPageResponse>().items.map { it.id },
        )
        // createdAt[gte]: everything here was created after `before`; a future bound excludes all.
        assertEquals(
            2,
            subordinate.get("/api/v1/goals?createdAt[gte]=$before").body<GoalPageResponse>().total,
        )
        assertEquals(
            0,
            subordinate.get("/api/v1/goals?createdAt[gte]=${before + 3_600_000}")
                .body<GoalPageResponse>().total,
        )
        assertEquals(HttpStatusCode.BadRequest, subordinate.get("/api/v1/goals?managerId=abc").status)
    }

    @Test
    fun `list filters compose - names, title, type, status and lastModified all narrow the rows`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair() // manager "Mona Manager", subordinate "Sub Ordinate"
        val manager = authedClient(pair.managerEmail, "pw")
        val marker = "flt-${UUID.randomUUID().toString().take(8)}"

        val binary = manager.createGoal(
            pair.subordinateId,
            title = "$marker-binary",
            type = GoalType.BINARY,
            targetValue = null,
        )
        val number = manager.createGoal(pair.subordinateId, title = "$marker-number")
        assertEquals(
            HttpStatusCode.NoContent,
            manager.post("/api/v1/goals/${number.id}/activate").status,
        )

        suspend fun total(query: String): Long =
            manager.get("/api/v1/goals?view=managed&title=$marker&$query").body<GoalPageResponse>().total

        // title substring alone (both rows carry the marker; the narrower substring picks one)
        assertEquals(2, total(""))
        assertEquals(
            1,
            manager.get("/api/v1/goals?view=managed&title=$marker-binary").body<GoalPageResponse>().total,
        )
        // type + status equality
        assertEquals(1, total("type=BINARY"))
        assertEquals(1, total("status=ACTIVE"))
        assertEquals(setOf(binary.id), manager.get("/api/v1/goals?view=managed&title=$marker&status=DRAFT")
            .body<GoalPageResponse>().items.map { it.id }.toSet())
        // party-name substrings, case-insensitive; a non-matching one excludes everything
        assertEquals(2, total("managerName=mona"))
        assertEquals(0, total("managerName=zzz-nobody"))
        assertEquals(2, total("subordinateName=ordinate"))
        assertEquals(0, total("subordinateName=zzz-nobody"))
        // lastModified[gte]: everything here is newer than epoch 0; a far-future bound excludes all
        assertEquals(2, total("lastModified[gte]=0"))
        assertEquals(0, total("lastModified[gte]=${System.currentTimeMillis() + 3_600_000}"))

        // Blank filter strings are no-ops. The route's optionalString never forwards blanks, so
        // this is service-level only — pinned so the guards stay.
        val paging = ch.nokillswit.infra.paging.PageRequest(
            page = 1,
            pageSize = 100,
            sort = listOf(ch.nokillswit.infra.paging.SortField("id", descending = false)),
        )
        val unfiltered = TestServices.goals.list(GoalListView.MANAGED, pair.managerId, GoalListFilter(), paging)
        val blankFiltered = TestServices.goals.list(
            GoalListView.MANAGED,
            pair.managerId,
            GoalListFilter(managerName = " ", subordinateName = "", title = "  "),
            paging,
        )
        assertEquals(unfiltered.total, blankFiltered.total)
        assertEquals(2, unfiltered.total)
    }

    @Test
    fun `the value columns are sortable`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val manager = authedClient(pair.managerEmail, "pw")
        val marker = "vals-${UUID.randomUUID().toString().take(8)}"
        val small = manager.createGoal(pair.subordinateId, title = "$marker small", targetValue = 1.0)
        val large = manager.createGoal(pair.subordinateId, title = "$marker large", targetValue = 9.0)

        suspend fun ids(sort: String) = manager
            .get("/api/v1/goals?view=managed&title=$marker&sort=$sort")
            .body<GoalPageResponse>().items.map { it.id }

        assertEquals(listOf(small.id, large.id), ids("targetValue"))
        assertEquals(listOf(large.id, small.id), ids("-targetValue"))
        // currentValue is accepted too (both rows are NULL, no value recorded yet — the id
        // tiebreaker keeps it deterministic).
        assertEquals(listOf(small.id, large.id), ids("currentValue"))
    }

    // ---- due date ----

    @Test
    fun `a definition edit may not move the due date into the past, and a change is audited`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val manager = authedClient(pair.managerEmail, "pw")
        val created = manager.createGoal(pair.subordinateId)

        suspend fun edit(dueDate: String) = manager.put("/api/v1/goals/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(
                GoalDefinitionUpdate(
                    title = created.title,
                    description = created.description,
                    type = GoalType.NUMBER,
                    targetValue = created.targetValue,
                    dueDate = dueDate,
                ),
            )
        }.status

        assertEquals(HttpStatusCode.BadRequest, edit(LocalDate.now().minusDays(1).toString()))
        assertEquals(HttpStatusCode.BadRequest, edit("2026-1-1"))

        val tomorrow = LocalDate.now().plusDays(1).toString()
        assertEquals(HttpStatusCode.NoContent, edit(tomorrow))
        assertEquals(tomorrow, manager.get("/api/v1/goals/${created.id}").body<GoalResponse>().dueDate)

        val events = manager.get("/api/v1/goals/${created.id}/events").body<GoalEventListResponse>()
        val dueDateEvent = events.items.single { it.type == GoalEventType.DUE_DATE_CHANGED }
        assertEquals(mapOf("from" to created.dueDate, "to" to tomorrow), dueDateEvent.params)
    }

    @Test
    fun `activate rejects a stale due date - but reopening an overdue goal stays possible`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val manager = authedClient(pair.managerEmail, "pw")
        val yesterday = LocalDate.now().minusDays(1).toString()

        // A draft goes stale: activation is refused until the manager picks a fresh due date.
        val draft = manager.createGoal(pair.subordinateId, title = "stale draft")
        TestGoalMaintenance.setDueDate(draft.id, yesterday)
        assertEquals(HttpStatusCode.BadRequest, manager.post("/api/v1/goals/${draft.id}/activate").status)
        assertEquals(GoalStatus.DRAFT, manager.get("/api/v1/goals/${draft.id}").body<GoalResponse>().status)

        // A closed goal whose due date has passed can still be reopened (ARCHIVED -> ACTIVE is not
        // gated — the due date is only editable in DRAFT, so gating reopen would deadlock it).
        val closed = manager.createGoal(pair.subordinateId, title = "overdue closed")
        manager.post("/api/v1/goals/${closed.id}/activate")
        manager.post("/api/v1/goals/${closed.id}/archive") {
            contentType(ContentType.Application.Json)
            setBody(GoalArchiveRequest(summary = "wrapped before the deadline check existed"))
        }
        TestGoalMaintenance.setDueDate(closed.id, yesterday)
        assertEquals(HttpStatusCode.NoContent, manager.post("/api/v1/goals/${closed.id}/reopen").status)
        assertEquals(GoalStatus.ACTIVE, manager.get("/api/v1/goals/${closed.id}").body<GoalResponse>().status)
    }

    @Test
    fun `dueDate is sortable and round-trips in list rows`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val manager = authedClient(pair.managerEmail, "pw")
        val marker = "due-${UUID.randomUUID().toString().take(8)}"
        val soon = LocalDate.now().plusDays(2).toString()
        val later = LocalDate.now().plusDays(40).toString()
        val nearGoal = manager.createGoal(pair.subordinateId, title = "$marker near", dueDate = soon)
        val farGoal = manager.createGoal(pair.subordinateId, title = "$marker far", dueDate = later)

        suspend fun page(sort: String) = manager
            .get("/api/v1/goals?view=managed&title=$marker&sort=$sort")
            .body<GoalPageResponse>()

        assertEquals(listOf(nearGoal.id, farGoal.id), page("dueDate").items.map { it.id })
        assertEquals(listOf(farGoal.id, nearGoal.id), page("-dueDate").items.map { it.id })
        assertEquals(soon, page("dueDate").items.first().dueDate)
    }

    // ---- events endpoint ----

    @Test
    fun `events are readable exactly by those who may read the goal`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val strangerEmail = uniqueEmail("goal-stranger")
        TestUsers.seed(strangerEmail, "pw", roles = emptySet())
        val manager = authedClient(pair.managerEmail, "pw")
        val created = manager.createGoal(pair.subordinateId)

        assertEquals(
            HttpStatusCode.OK,
            authedClient(pair.subordinateEmail, "pw").get("/api/v1/goals/${created.id}/events").status,
        )
        assertEquals(
            HttpStatusCode.Forbidden,
            authedClient(strangerEmail, "pw").get("/api/v1/goals/${created.id}/events").status,
        )

        // Events carry the acting user's resolved name.
        val events = manager.get("/api/v1/goals/${created.id}/events").body<GoalEventListResponse>()
        val creation = events.items.single()
        assertEquals(pair.managerId, creation.userId)
        assertEquals("Mona Manager", creation.userName)
        assertNotNull(creation.timestamp)
    }
}
