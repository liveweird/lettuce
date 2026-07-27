package ch.nokillswit

import ch.nokillswit.goals.GoalCloseRequest
import ch.nokillswit.goals.GoalCreateRequest
import ch.nokillswit.goals.GoalDefinitionUpdate
import ch.nokillswit.goals.GoalEventListResponse
import ch.nokillswit.goals.GoalEventType
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
        val managerId = TestUsers.seed(managerEmail, "pw", name = "Mona Manager", role = UserRole.USER)
        val subordinateEmail = uniqueEmail("goal-subordinate")
        val subordinateId = TestUsers.seed(subordinateEmail, "pw", name = "Sub Ordinate", role = UserRole.USER)
        val teamId = TestServices.teams.create(Team(name = "goal-${UUID.randomUUID()}", managerId = managerId))
        TestServices.teams.addMember(teamId, subordinateId)
        return GoalPair(managerId, managerEmail, subordinateId, subordinateEmail)
    }

    /** Puts [pair]'s manager into a team managed by a new grand-manager; returns (email, id). */
    private suspend fun seedGrandManager(pair: GoalPair): Pair<String, UInt> {
        val grandEmail = uniqueEmail("goal-grand")
        val grandId = TestUsers.seed(grandEmail, "pw", name = "Grand Manager", role = UserRole.USER)
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
        assertEquals(0.0, created.currentValue)
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
    fun `a BINARY goal initializes achieved=false and carries no numeric values`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val manager = authedClient(pair.managerEmail, "pw")

        val created = manager.createGoal(pair.subordinateId, type = GoalType.BINARY, targetValue = null)
        assertEquals(GoalType.BINARY, created.type)
        assertEquals(false, created.achieved)
        assertNull(created.targetValue)
        assertNull(created.currentValue)
    }

    @Test
    fun `create rejects non-direct-reports, nonexistent users, and create-on-behalf`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val outsiderEmail = uniqueEmail("goal-outsider")
        TestUsers.seed(outsiderEmail, "pw", role = UserRole.USER)
        val adminEmail = uniqueEmail("goal-admin")
        TestUsers.seed(adminEmail, "pw", role = UserRole.ADMIN)

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
    fun `read matrix - parties and ADMIN always, chain managers only once out of DRAFT`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val (grandEmail, _) = seedGrandManager(pair)
        val strangerEmail = uniqueEmail("goal-stranger")
        TestUsers.seed(strangerEmail, "pw", role = UserRole.USER)
        val adminEmail = uniqueEmail("goal-admin")
        TestUsers.seed(adminEmail, "pw", role = UserRole.ADMIN)

        val manager = authedClient(pair.managerEmail, "pw")
        val created = manager.createGoal(pair.subordinateId)

        // DRAFT: the pair and ADMIN read it; the wider chain and strangers do not.
        assertEquals(HttpStatusCode.OK, manager.get("/api/v1/goals/${created.id}").status)
        assertEquals(
            HttpStatusCode.OK,
            authedClient(pair.subordinateEmail, "pw").get("/api/v1/goals/${created.id}").status,
        )
        assertEquals(HttpStatusCode.OK, authedClient(adminEmail, "pw").get("/api/v1/goals/${created.id}").status)
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
        TestUsers.seed(email, "pw", role = UserRole.USER)
        val client = authedClient(email, "pw")

        assertEquals(HttpStatusCode.NotFound, client.get("/api/v1/goals/999999").status)
        assertEquals(HttpStatusCode.NotFound, client.get("/api/v1/goals/999999/events").status)
        assertEquals(HttpStatusCode.NotFound, client.post("/api/v1/goals/999999/activate").status)
        assertEquals(HttpStatusCode.NotFound, client.delete("/api/v1/goals/999999").status)
        // The remaining mutations read (→404) before receiving any body, so none is needed.
        assertEquals(HttpStatusCode.NotFound, client.put("/api/v1/goals/999999").status)
        assertEquals(HttpStatusCode.NotFound, client.put("/api/v1/goals/999999/progress").status)
        assertEquals(HttpStatusCode.NotFound, client.post("/api/v1/goals/999999/deactivate").status)
        assertEquals(HttpStatusCode.NotFound, client.post("/api/v1/goals/999999/close").status)
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
            HttpMethod.Post to "/api/v1/goals/1/close",
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
            manager.post("/api/v1/goals/${created.id}/close") {
                contentType(ContentType.Application.Json)
                setBody(GoalCloseRequest(summary = "Delivered on time"))
            }.status,
        )
        val closed = manager.get("/api/v1/goals/${created.id}").body<GoalResponse>()
        assertEquals(GoalStatus.CLOSED, closed.status)
        assertEquals("Delivered on time", closed.summary)

        // Reopening keeps the summary as a record of the previous closure.
        assertEquals(HttpStatusCode.NoContent, manager.post("/api/v1/goals/${created.id}/reopen").status)
        val reopened = manager.get("/api/v1/goals/${created.id}").body<GoalResponse>()
        assertEquals(GoalStatus.ACTIVE, reopened.status)
        assertEquals("Delivered on time", reopened.summary)

        assertEquals(HttpStatusCode.NoContent, manager.post("/api/v1/goals/${created.id}/deactivate").status)
        assertEquals(GoalStatus.DRAFT, manager.get("/api/v1/goals/${created.id}").body<GoalResponse>().status)

        // Every hop is in the audit trail.
        val events = manager.get("/api/v1/goals/${created.id}/events").body<GoalEventListResponse>()
        assertEquals(
            listOf("DRAFT>ACTIVE", "ACTIVE>CLOSED", "CLOSED>ACTIVE", "ACTIVE>DRAFT"),
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

        suspend fun close() = manager.post("/api/v1/goals/${created.id}/close") {
            contentType(ContentType.Application.Json)
            setBody(GoalCloseRequest(summary = "s"))
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
        // From CLOSED: only reopen is valid.
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

        suspend fun close(summary: String) = manager.post("/api/v1/goals/${created.id}/close") {
            contentType(ContentType.Application.Json)
            setBody(GoalCloseRequest(summary = summary))
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
        TestUsers.seed(adminEmail, "pw", role = UserRole.ADMIN)
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
            subordinate.post("/api/v1/goals/${created.id}/close").status,
        )
        manager.post("/api/v1/goals/${created.id}/close") {
            contentType(ContentType.Application.Json)
            setBody(GoalCloseRequest(summary = "closed for the reopen probe"))
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
        manager.post("/api/v1/goals/${created.id}/close") {
            contentType(ContentType.Application.Json)
            setBody(GoalCloseRequest(summary = "done"))
        }
        manager.post("/api/v1/goals/${created.id}/reopen")
        manager.post("/api/v1/goals/${created.id}/deactivate")

        val subordinate = authedClient(pair.subordinateEmail, "pw")
        val notifications = subordinate.get("/api/v1/notifications?pageSize=50").body<NotificationPageResponse>()
        val goalNotes = notifications.items.filter { it.params["title"] == "Notify me" }
        assertEquals(
            setOf(
                NotificationType.GOAL_ACTIVATED_TO_SUBORDINATE,
                NotificationType.GOAL_CLOSED_TO_SUBORDINATE,
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

        // Once ACTIVE (and CLOSED) the definition is immutable.
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
            listOf(GoalEventType.CREATED, GoalEventType.TITLE_CHANGED, GoalEventType.TARGET_CHANGED),
            afterEdit.items.map { it.type },
        )
        assertEquals(mapOf("from" to "10.0", "to" to "20.0"), afterEdit.items.last().params)

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
        assertEquals(false, flipped.achieved)
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
        // The subordinate never edits.
        assertEquals(
            HttpStatusCode.Forbidden,
            authedClient(pair.subordinateEmail, "pw").progress(GoalProgressUpdate(currentValue = 10.0)),
        )

        assertEquals(HttpStatusCode.NoContent, manager.progress(GoalProgressUpdate(currentValue = 40.0)))
        assertEquals(40.0, manager.get("/api/v1/goals/${created.id}").body<GoalResponse>().currentValue)

        // The change is audited with its from/to values.
        val events = manager.get("/api/v1/goals/${created.id}/events").body<GoalEventListResponse>()
        val progressEvent = events.items.single { it.type == GoalEventType.PROGRESS_UPDATED }
        assertEquals(mapOf("from" to "0.0", "to" to "40.0"), progressEvent.params)

        // Not editable once CLOSED either.
        manager.post("/api/v1/goals/${created.id}/close") {
            contentType(ContentType.Application.Json)
            setBody(GoalCloseRequest(summary = "done"))
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

        // Events outlive the soft-deleted row, ending with the deletion.
        val events = TestGoalEvents.service.listForGoal(created.id)
        assertEquals(GoalEventType.DELETED, events.last().type)
        assertEquals(pair.managerId, events.last().userId)
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
        val greatId = TestUsers.seed(greatEmail, "pw", role = UserRole.USER)
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

        // includeIndirect is team-only.
        assertEquals(
            HttpStatusCode.BadRequest,
            great.get("/api/v1/goals?view=own&includeIndirect=true").status,
        )
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
        // The list never carries description/summary; it does carry the value fields.
        val row = page("title=$marker&type=BINARY").items.single()
        assertEquals(false, row.achieved)
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
        // currentValue is accepted too (both rows are 0.0 — id tiebreaker keeps it deterministic).
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

        // A closed goal whose due date has passed can still be reopened (CLOSED -> ACTIVE is not
        // gated — the due date is only editable in DRAFT, so gating reopen would deadlock it).
        val closed = manager.createGoal(pair.subordinateId, title = "overdue closed")
        manager.post("/api/v1/goals/${closed.id}/activate")
        manager.post("/api/v1/goals/${closed.id}/close") {
            contentType(ContentType.Application.Json)
            setBody(GoalCloseRequest(summary = "wrapped before the deadline check existed"))
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
        TestUsers.seed(strangerEmail, "pw", role = UserRole.USER)
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
