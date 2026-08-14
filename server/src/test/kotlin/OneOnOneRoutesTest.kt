package ch.nokillswit

import ch.nokillswit.notifications.NotificationPageResponse
import ch.nokillswit.notifications.NotificationType
import ch.nokillswit.oneonones.ActionItemHistoryResponse
import ch.nokillswit.plugins.ProblemDetail
import ch.nokillswit.oneonones.ActionItemOwner
import ch.nokillswit.oneonones.OneOnOneActionItemInput
import ch.nokillswit.oneonones.OneOnOneCreateRequest
import ch.nokillswit.oneonones.OneOnOneEventListResponse
import ch.nokillswit.oneonones.OneOnOneEventType
import ch.nokillswit.oneonones.OneOnOneItemInput
import ch.nokillswit.oneonones.OneOnOnePageResponse
import ch.nokillswit.oneonones.OneOnOneResponse
import ch.nokillswit.oneonones.OneOnOneUpdateRequest
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
import kotlin.test.assertNull
import kotlin.test.assertTrue

class OneOnOneRoutesTest {

    @Test
    fun `service delete returns 0 for a missing meeting`() = testApplication {
        usePostgresTestcontainer()
        // The route maps 0 to 404 and skips the DELETED event (race window: the row vanished
        // between the route's read and the delete).
        assertEquals(0, TestServices.oneOnOnes.delete(999_999_999u))
    }

    private data class Pair(
        val managerId: UInt,
        val managerEmail: String,
        val subordinateId: UInt,
        val subordinateEmail: String,
        val teamId: UInt,
    )

    /** A manager with one direct report (a fresh team), both role USER. */
    private suspend fun seedPair(
        managerName: String = "Mia Manager",
        subordinateName: String = "Sam Subordinate",
    ): Pair {
        val managerEmail = uniqueEmail("manager")
        val managerId = TestUsers.seed(managerEmail, "pw", name = managerName, roles = emptySet())
        val subordinateEmail = uniqueEmail("subordinate")
        val subordinateId = TestUsers.seed(subordinateEmail, "pw", name = subordinateName, roles = emptySet())
        val teamId = TestServices.teams.create(Team(name = "oo-${UUID.randomUUID()}", managerId = managerId))
        TestServices.teams.addMember(teamId, subordinateId)
        return Pair(managerId, managerEmail, subordinateId, subordinateEmail, teamId)
    }

    private suspend fun HttpClient.createMeeting(
        subordinateId: UInt,
        meetingDate: String = "2026-07-01",
        points: List<OneOnOneItemInput> = emptyList(),
        decisions: List<OneOnOneItemInput> = emptyList(),
        actionItems: List<OneOnOneActionItemInput> = emptyList(),
    ): OneOnOneResponse {
        val response = post("/api/v1/one-on-ones") {
            contentType(ContentType.Application.Json)
            setBody(OneOnOneCreateRequest(subordinateId, meetingDate, points, decisions, actionItems))
        }
        assertEquals(HttpStatusCode.Created, response.status, "create failed")
        return response.body<OneOnOneResponse>()
    }

    private fun OneOnOneResponse.toUpdate() = OneOnOneUpdateRequest(
        meetingDate = meetingDate,
        points = points.map { OneOnOneItemInput(it.id, it.content) },
        decisions = decisions.map { OneOnOneItemInput(it.id, it.content) },
        actionItems = actionItems.map {
            OneOnOneActionItemInput(it.id, it.content, it.owner, it.dueDate, it.resolved)
        },
    )

    // ---- create + read ----

    @Test
    fun `create and read round-trip preserves list order and fields`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val manager = authedClient(pair.managerEmail, "pw")

        val response = manager.post("/api/v1/one-on-ones") {
            contentType(ContentType.Application.Json)
            setBody(
                OneOnOneCreateRequest(
                    subordinateId = pair.subordinateId,
                    meetingDate = "2026-07-01",
                    points = listOf(OneOnOneItemInput(content = "roadmap"), OneOnOneItemInput(content = "vacation")),
                    decisions = listOf(OneOnOneItemInput(content = "ship v2 in August")),
                    actionItems = listOf(
                        OneOnOneActionItemInput(
                            content = "prepare demo", owner = ActionItemOwner.SUBORDINATE,
                            dueDate = "2026-07-15",
                        ),
                    ),
                ),
            )
        }
        assertEquals(HttpStatusCode.Created, response.status)
        val created = response.body<OneOnOneResponse>()
        assertEquals("/api/v1/one-on-ones/${created.id}", response.headers["Location"])
        assertEquals(pair.managerId, created.managerId)
        assertEquals("Mia Manager", created.managerName)
        assertEquals(pair.subordinateId, created.subordinateId)
        assertEquals("Sam Subordinate", created.subordinateName)
        assertEquals("2026-07-01", created.meetingDate)
        assertEquals(listOf("roadmap", "vacation"), created.points.map { it.content })
        assertEquals(listOf("ship v2 in August"), created.decisions.map { it.content })
        val actionItem = created.actionItems.single()
        assertEquals("prepare demo", actionItem.content)
        assertEquals(ActionItemOwner.SUBORDINATE, actionItem.owner)
        assertEquals("2026-07-15", actionItem.dueDate)
        assertEquals(false, actionItem.resolved)
        assertNull(actionItem.copiedFromId)

        val fetched = manager.get("/api/v1/one-on-ones/${created.id}").body<OneOnOneResponse>()
        assertEquals(created, fetched)
    }

    @Test
    fun `only the direct manager may create - no admin on-behalf, no self-service`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val otherPair = seedPair()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(adminEmail, "pw", roles = setOf(UserRole.ADMIN))

        suspend fun createAs(email: String, subordinateId: UInt): HttpStatusCode =
            authedClient(email, "pw").post("/api/v1/one-on-ones") {
                contentType(ContentType.Application.Json)
                setBody(OneOnOneCreateRequest(subordinateId, "2026-07-01"))
            }.status

        // A manager of a DIFFERENT team may not document someone else's report.
        assertEquals(HttpStatusCode.Forbidden, createAs(otherPair.managerEmail, pair.subordinateId))
        // The manager is always the author: even an ADMIN cannot create on behalf.
        assertEquals(HttpStatusCode.Forbidden, createAs(adminEmail, pair.subordinateId))
        // The subordinate cannot document a 1:1 with themselves (they are nobody's direct report here).
        assertEquals(HttpStatusCode.Forbidden, createAs(pair.subordinateEmail, pair.subordinateId))
        // A manager cannot hold a 1:1 with themselves (never their own direct report).
        assertEquals(HttpStatusCode.Forbidden, createAs(pair.managerEmail, pair.managerId))
        // And the real manager may.
        assertEquals(HttpStatusCode.Created, createAs(pair.managerEmail, pair.subordinateId))
    }

    @Test
    fun `create validates dates, blanks, caps, and forbids item ids`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val manager = authedClient(pair.managerEmail, "pw")

        suspend fun status(request: OneOnOneCreateRequest): HttpStatusCode =
            manager.post("/api/v1/one-on-ones") {
                contentType(ContentType.Application.Json)
                setBody(request)
            }.status

        val base = OneOnOneCreateRequest(pair.subordinateId, "2026-07-01")
        assertEquals(HttpStatusCode.BadRequest, status(base.copy(meetingDate = "07/01/2026")))
        assertEquals(HttpStatusCode.BadRequest, status(base.copy(meetingDate = "2026-7-1")))
        assertEquals(
            HttpStatusCode.BadRequest,
            status(base.copy(points = listOf(OneOnOneItemInput(content = "   ")))),
        )
        assertEquals(
            HttpStatusCode.BadRequest,
            status(base.copy(decisions = listOf(OneOnOneItemInput(content = "x".repeat(4001))))),
        )
        assertEquals(
            HttpStatusCode.BadRequest,
            status(
                base.copy(
                    actionItems = listOf(
                        OneOnOneActionItemInput(content = "ok", owner = ActionItemOwner.MANAGER, dueDate = "soon"),
                    ),
                ),
            ),
        )
        assertEquals(
            HttpStatusCode.BadRequest,
            status(base.copy(points = List(101) { OneOnOneItemInput(content = "p$it") })),
        )
        // Ids identify existing rows on PUT only.
        assertEquals(
            HttpStatusCode.BadRequest,
            status(base.copy(points = listOf(OneOnOneItemInput(id = 1u, content = "smuggled")))),
        )
    }

    // ---- carry-over ----

    @Test
    fun `unresolved action items are carried over with a reference, resolved ones are not`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val manager = authedClient(pair.managerEmail, "pw")

        val first = manager.createMeeting(
            pair.subordinateId, "2026-07-01",
            actionItems = listOf(
                OneOnOneActionItemInput(content = "draft OKRs", owner = ActionItemOwner.MANAGER, dueDate = "2026-07-10"),
                OneOnOneActionItemInput(content = "prepare demo", owner = ActionItemOwner.SUBORDINATE),
            ),
        )
        // Resolve the first item.
        val resolveUpdate = first.toUpdate().let { update ->
            update.copy(
                actionItems = update.actionItems.map {
                    if (it.content == "draft OKRs") it.copy(resolved = true) else it
                },
            )
        }
        assertEquals(
            HttpStatusCode.NoContent,
            manager.put("/api/v1/one-on-ones/${first.id}") {
                contentType(ContentType.Application.Json)
                setBody(resolveUpdate)
            }.status,
        )

        val second = manager.createMeeting(
            pair.subordinateId, "2026-07-08",
            actionItems = listOf(
                OneOnOneActionItemInput(content = "fresh item", owner = ActionItemOwner.MANAGER),
            ),
        )
        // Carried copy comes FIRST, then the request's own items.
        assertEquals(listOf("prepare demo", "fresh item"), second.actionItems.map { it.content })
        val carried = second.actionItems.first()
        val source = first.actionItems.single { it.content == "prepare demo" }
        assertEquals(source.id, carried.copiedFromId)
        assertEquals(ActionItemOwner.SUBORDINATE, carried.owner)
        assertEquals(false, carried.resolved)
        assertNull(second.actionItems.last().copiedFromId)
        // The carried copy reports where the item first appeared; the fresh one doesn't.
        assertEquals("2026-07-01", carried.firstAppearedOn)
        assertNull(second.actionItems.last().firstAppearedOn)

        // The creation event records the carry-over count.
        val events = manager.get("/api/v1/one-on-ones/${second.id}/events").body<OneOnOneEventListResponse>()
        val creation = events.items.single()
        assertEquals(OneOnOneEventType.CREATED, creation.type)
        assertEquals(mapOf("date" to "2026-07-08", "carriedOver" to "1"), creation.params)
    }

    @Test
    fun `carry-over pulls from the LATEST meeting of the pair and chains copy-of-copy`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val manager = authedClient(pair.managerEmail, "pw")

        val first = manager.createMeeting(
            pair.subordinateId, "2026-07-01",
            actionItems = listOf(OneOnOneActionItemInput(content = "long runner", owner = ActionItemOwner.MANAGER)),
        )
        val second = manager.createMeeting(pair.subordinateId, "2026-07-08")
        val secondCopy = second.actionItems.single()
        assertEquals(first.actionItems.single().id, secondCopy.copiedFromId)
        assertEquals("2026-07-01", secondCopy.firstAppearedOn)

        // The third meeting pulls from the latest (2026-07-08) meeting, so its copy chains off
        // the SECOND meeting's copy — a copy-of-copy.
        val third = manager.createMeeting(pair.subordinateId, "2026-07-15")
        val thirdCopy = third.actionItems.single()
        assertEquals(secondCopy.id, thirdCopy.copiedFromId)
        // The origin date is the chain ROOT's meeting, not the immediate parent's.
        assertEquals("2026-07-01", thirdCopy.firstAppearedOn)

        // Carry-over ignores other pairs entirely.
        val otherPair = seedPair()
        val otherMeeting = authedClient(otherPair.managerEmail, "pw").createMeeting(otherPair.subordinateId, "2026-07-09")
        assertTrue(otherMeeting.actionItems.isEmpty())
    }

    // ---- read matrix ----

    @Test
    fun `read is granted to parties and the transitive chain - denied to admin and others`() = testApplication {
        usePostgresTestcontainer()
        // Grand-manager → manager → subordinate.
        val pair = seedPair()
        val grandEmail = uniqueEmail("grand")
        val grandId = TestUsers.seed(grandEmail, "pw", roles = emptySet())
        val upperTeam = TestServices.teams.create(Team(name = "oo-upper-${UUID.randomUUID()}", managerId = grandId))
        TestServices.teams.addMember(upperTeam, pair.managerId)
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(adminEmail, "pw", roles = setOf(UserRole.ADMIN))
        val siblingPair = seedPair() // an unrelated manager
        val strangerEmail = uniqueEmail("stranger")
        TestUsers.seed(strangerEmail, "pw", roles = emptySet())

        val meeting = authedClient(pair.managerEmail, "pw").createMeeting(pair.subordinateId)
        val url = "/api/v1/one-on-ones/${meeting.id}"

        assertEquals(HttpStatusCode.OK, authedClient(pair.managerEmail, "pw").get(url).status)
        assertEquals(HttpStatusCode.OK, authedClient(pair.subordinateEmail, "pw").get(url).status)
        // ADMIN is a management role: no special 1:1 read.
        assertEquals(HttpStatusCode.Forbidden, authedClient(adminEmail, "pw").get(url).status)
        // The manager's own manager is in the subordinate's transitive chain.
        assertEquals(HttpStatusCode.OK, authedClient(grandEmail, "pw").get(url).status)
        assertEquals(HttpStatusCode.Forbidden, authedClient(siblingPair.managerEmail, "pw").get(url).status)
        assertEquals(HttpStatusCode.Forbidden, authedClient(strangerEmail, "pw").get(url).status)
        // Missing id → 404 (read-before-guard idiom).
        assertEquals(HttpStatusCode.NotFound, authedClient(pair.managerEmail, "pw").get("/api/v1/one-on-ones/999999").status)
    }

    // ---- update ----

    @Test
    fun `PUT is a full replace that preserves ids, rewrites positions, and records per-item events`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val manager = authedClient(pair.managerEmail, "pw")

        val created = manager.createMeeting(
            pair.subordinateId, "2026-07-01",
            points = listOf(OneOnOneItemInput(content = "keep"), OneOnOneItemInput(content = "drop")),
            decisions = listOf(OneOnOneItemInput(content = "decision")),
            actionItems = listOf(OneOnOneActionItemInput(content = "task", owner = ActionItemOwner.MANAGER)),
        )
        val keepId = created.points.first { it.content == "keep" }.id
        val actionId = created.actionItems.single().id

        val update = OneOnOneUpdateRequest(
            meetingDate = "2026-07-02",
            points = listOf(
                OneOnOneItemInput(content = "brand new first"),
                OneOnOneItemInput(id = keepId, content = "keep (edited)"),
            ),
            decisions = created.decisions.map { OneOnOneItemInput(it.id, it.content) },
            actionItems = listOf(
                OneOnOneActionItemInput(
                    id = actionId, content = "task", owner = ActionItemOwner.SUBORDINATE,
                    dueDate = "2026-07-20", resolved = true,
                ),
            ),
        )
        assertEquals(
            HttpStatusCode.NoContent,
            manager.put("/api/v1/one-on-ones/${created.id}") {
                contentType(ContentType.Application.Json)
                setBody(update)
            }.status,
        )

        val after = manager.get("/api/v1/one-on-ones/${created.id}").body<OneOnOneResponse>()
        assertEquals("2026-07-02", after.meetingDate)
        assertEquals(listOf("brand new first", "keep (edited)"), after.points.map { it.content })
        // The surviving row kept its id (identity is stable across edits and reorders).
        assertEquals(keepId, after.points[1].id)
        val item = after.actionItems.single()
        assertEquals(actionId, item.id)
        assertEquals(ActionItemOwner.SUBORDINATE, item.owner)
        assertEquals("2026-07-20", item.dueDate)
        assertEquals(true, item.resolved)
        assertTrue(after.lastModified >= created.lastModified)

        val events = manager.get("/api/v1/one-on-ones/${created.id}/events").body<OneOnOneEventListResponse>()
        assertEquals(
            listOf(
                OneOnOneEventType.ACTION_ITEM_OWNER_CHANGED,
                OneOnOneEventType.ACTION_ITEM_DUE_DATE_CHANGED,
                OneOnOneEventType.ACTION_ITEM_RESOLVED,
                OneOnOneEventType.POINT_ADDED,
                OneOnOneEventType.POINT_EDITED,
                OneOnOneEventType.POINT_REMOVED,
                OneOnOneEventType.DATE_CHANGED,
                OneOnOneEventType.CREATED,
            ),
            events.items.map { it.type },
        )
        // Every event is attributed to the acting manager with their resolved name.
        assertTrue(events.items.all { it.userId == pair.managerId && it.userName == "Mia Manager" })
    }

    @Test
    fun `a no-op PUT mints no events and a foreign item id is a 400`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val manager = authedClient(pair.managerEmail, "pw")
        val created = manager.createMeeting(
            pair.subordinateId,
            points = listOf(OneOnOneItemInput(content = "stable")),
        )
        // A DIFFERENT pair's meeting supplies the foreign item id — a second meeting of the
        // same pair would make `created` non-latest and the PUTs below 409 instead.
        val otherPair = seedPair()
        val otherMeeting = authedClient(otherPair.managerEmail, "pw")
            .createMeeting(otherPair.subordinateId, "2026-07-02", points = listOf(OneOnOneItemInput(content = "other")))

        assertEquals(
            HttpStatusCode.NoContent,
            manager.put("/api/v1/one-on-ones/${created.id}") {
                contentType(ContentType.Application.Json)
                setBody(created.toUpdate())
            }.status,
        )
        val events = manager.get("/api/v1/one-on-ones/${created.id}/events").body<OneOnOneEventListResponse>()
        assertEquals(listOf(OneOnOneEventType.CREATED), events.items.map { it.type })

        // Another meeting's item id in the payload → 400 (never silently reparented).
        val foreign = created.toUpdate().copy(
            points = listOf(OneOnOneItemInput(id = otherMeeting.points.single().id, content = "hijack")),
        )
        assertEquals(
            HttpStatusCode.BadRequest,
            manager.put("/api/v1/one-on-ones/${created.id}") {
                contentType(ContentType.Application.Json)
                setBody(foreign)
            }.status,
        )
    }

    @Test
    fun `only the latest meeting of the pair may be edited or deleted`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val manager = authedClient(pair.managerEmail, "pw")

        val m1 = manager.createMeeting(pair.subordinateId, "2026-07-01")
        val m2 = manager.createMeeting(pair.subordinateId, "2026-07-08")

        // The older meeting is an immutable record now: PUT and DELETE both 409.
        assertEquals(
            HttpStatusCode.Conflict,
            manager.put("/api/v1/one-on-ones/${m1.id}") {
                contentType(ContentType.Application.Json)
                setBody(m1.toUpdate().copy(meetingDate = "2026-07-02"))
            }.status,
        )
        assertEquals(HttpStatusCode.Conflict, manager.delete("/api/v1/one-on-ones/${m1.id}").status)

        // The read/list responses expose the flag the SPA keys its affordances on.
        assertEquals(false, manager.get("/api/v1/one-on-ones/${m1.id}").body<OneOnOneResponse>().isLatest)
        assertEquals(true, manager.get("/api/v1/one-on-ones/${m2.id}").body<OneOnOneResponse>().isLatest)
        val listed = manager.get("/api/v1/one-on-ones?view=managed&pageSize=100").body<OneOnOnePageResponse>()
        assertEquals(false, listed.items.single { it.id == m1.id }.isLatest)
        assertEquals(true, listed.items.single { it.id == m2.id }.isLatest)

        // The latest stays editable.
        assertEquals(
            HttpStatusCode.NoContent,
            manager.put("/api/v1/one-on-ones/${m2.id}") {
                contentType(ContentType.Application.Json)
                setBody(m2.toUpdate())
            }.status,
        )

        // The rule is dynamic: deleting the latest promotes the previous one back to editable.
        assertEquals(HttpStatusCode.NoContent, manager.delete("/api/v1/one-on-ones/${m2.id}").status)
        assertEquals(
            HttpStatusCode.NoContent,
            manager.put("/api/v1/one-on-ones/${m1.id}") {
                contentType(ContentType.Application.Json)
                setBody(m1.toUpdate().copy(meetingDate = "2026-07-02"))
            }.status,
        )
    }

    @Test
    fun `meetings are documented chronologically - a back-dated create or edit is rejected`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val manager = authedClient(pair.managerEmail, "pw")

        val m1 = manager.createMeeting(pair.subordinateId, "2026-07-01")
        val m2 = manager.createMeeting(pair.subordinateId, "2026-07-08")

        // A create dated before the pair's latest meeting is rejected; the detail names the
        // conflicting date.
        val backdated = manager.post("/api/v1/one-on-ones") {
            contentType(ContentType.Application.Json)
            setBody(OneOnOneCreateRequest(pair.subordinateId, "2026-07-05", emptyList(), emptyList(), emptyList()))
        }
        assertEquals(HttpStatusCode.Conflict, backdated.status)
        assertTrue(backdated.body<ProblemDetail>().detail!!.contains("2026-07-08"))

        // The SAME date is a legitimate same-day follow-up.
        val sameDay = manager.createMeeting(pair.subordinateId, "2026-07-08")
        assertEquals(HttpStatusCode.NoContent, manager.delete("/api/v1/one-on-ones/${sameDay.id}").status)

        // Editing the (latest) meeting's date below the previous meeting's is rejected too …
        assertEquals(
            HttpStatusCode.Conflict,
            manager.put("/api/v1/one-on-ones/${m2.id}") {
                contentType(ContentType.Application.Json)
                setBody(m2.toUpdate().copy(meetingDate = "2026-06-30"))
            }.status,
        )
        // … while equal to the previous is allowed.
        assertEquals(
            HttpStatusCode.NoContent,
            manager.put("/api/v1/one-on-ones/${m2.id}") {
                contentType(ContentType.Application.Json)
                setBody(m2.toUpdate().copy(meetingDate = "2026-07-01"))
            }.status,
        )

        // The read response exposes the floor the edit form uses as the date input's min.
        assertEquals(
            "2026-07-01",
            manager.get("/api/v1/one-on-ones/${m2.id}").body<OneOnOneResponse>().minMeetingDate,
        )
        assertEquals(
            "2026-07-01",
            manager.get("/api/v1/one-on-ones/${m1.id}").body<OneOnOneResponse>().minMeetingDate,
        )

        // A fresh pair's FIRST meeting accepts any date — there is nothing to be ordered against.
        val freshPair = seedPair()
        val old = authedClient(freshPair.managerEmail, "pw").createMeeting(freshPair.subordinateId, "2020-01-01")
        assertNull(
            authedClient(freshPair.managerEmail, "pw")
                .get("/api/v1/one-on-ones/${old.id}").body<OneOnOneResponse>().minMeetingDate,
        )
    }

    @Test
    fun `only the manager may update or delete - subordinate and admin get 403`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(adminEmail, "pw", roles = setOf(UserRole.ADMIN))
        val manager = authedClient(pair.managerEmail, "pw")
        val created = manager.createMeeting(pair.subordinateId)
        val body = created.toUpdate()

        for (email in listOf(pair.subordinateEmail, adminEmail)) {
            val client = authedClient(email, "pw")
            assertEquals(
                HttpStatusCode.Forbidden,
                client.put("/api/v1/one-on-ones/${created.id}") {
                    contentType(ContentType.Application.Json)
                    setBody(body)
                }.status,
                "PUT as $email",
            )
            assertEquals(HttpStatusCode.Forbidden, client.delete("/api/v1/one-on-ones/${created.id}").status, "DELETE as $email")
        }
    }

    // ---- delete ----

    @Test
    fun `delete is a soft delete that hides the meeting but preserves its events`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val manager = authedClient(pair.managerEmail, "pw")
        val created = manager.createMeeting(pair.subordinateId)

        assertEquals(HttpStatusCode.NoContent, manager.delete("/api/v1/one-on-ones/${created.id}").status)
        assertEquals(HttpStatusCode.NotFound, manager.get("/api/v1/one-on-ones/${created.id}").status)
        // Idempotent in effect: a second delete is 404, not 204.
        assertEquals(HttpStatusCode.NotFound, manager.delete("/api/v1/one-on-ones/${created.id}").status)

        val list = manager.get("/api/v1/one-on-ones?view=managed").body<OneOnOnePageResponse>()
        assertTrue(list.items.none { it.id == created.id })

        // The audit trail outlives the soft-deleted row (read below the routes).
        val events = TestOneOnOneEvents.service.listForMeeting(created.id)
        assertEquals(listOf(OneOnOneEventType.DELETED, OneOnOneEventType.CREATED), events.map { it.type })
        assertEquals(pair.managerId, events.first().userId)
    }

    // ---- list views ----

    @Test
    fun `list views scope by caller - own, managed, and team with includeIndirect`() = testApplication {
        usePostgresTestcontainer()
        // Chain: grand → pair.manager → pair.subordinate → subSub.
        val pair = seedPair()
        val grandEmail = uniqueEmail("grand")
        val grandId = TestUsers.seed(grandEmail, "pw", roles = emptySet())
        val upperTeam = TestServices.teams.create(Team(name = "oo-upper-${UUID.randomUUID()}", managerId = grandId))
        TestServices.teams.addMember(upperTeam, pair.managerId)
        val subSubId = TestUsers.seed(uniqueEmail("subsub"), "pw", roles = emptySet())
        val lowerTeam = TestServices.teams.create(Team(name = "oo-lower-${UUID.randomUUID()}", managerId = pair.subordinateId))
        TestServices.teams.addMember(lowerTeam, subSubId)

        val manager = authedClient(pair.managerEmail, "pw")
        val meeting = manager.createMeeting(pair.subordinateId, "2026-07-01")
        // Run by grand's INDIRECT report (pair.subordinate) as manager.
        val deepMeeting = authedClient(pair.subordinateEmail, "pw").createMeeting(subSubId, "2026-07-02")

        // own (the default view): the subordinate's meetings as subordinate, exactly once.
        val own = authedClient(pair.subordinateEmail, "pw").get("/api/v1/one-on-ones").body<OneOnOnePageResponse>()
        assertEquals(1, own.items.count { it.id == meeting.id })

        // managed: the manager's meetings as manager (their own view=own is empty).
        val managed = manager.get("/api/v1/one-on-ones?view=managed").body<OneOnOnePageResponse>()
        assertTrue(managed.items.any { it.id == meeting.id })
        val managerOwn = manager.get("/api/v1/one-on-ones?view=own").body<OneOnOnePageResponse>()
        assertTrue(managerOwn.items.none { it.id == meeting.id })

        // team scopes by the MEETING'S MANAGER being the caller's report: the default sees
        // meetings run by DIRECT reports (pair.manager), includeIndirect adds those run by
        // INDIRECT ones (pair.subordinate).
        val grand = authedClient(grandEmail, "pw")
        val direct = grand.get("/api/v1/one-on-ones?view=team").body<OneOnOnePageResponse>()
        assertTrue(direct.items.any { it.id == meeting.id })
        assertTrue(direct.items.none { it.id == deepMeeting.id })
        val indirect = grand.get("/api/v1/one-on-ones?view=team&includeIndirect=true").body<OneOnOnePageResponse>()
        assertTrue(indirect.items.any { it.id == meeting.id })
        assertTrue(indirect.items.any { it.id == deepMeeting.id })

        // The caller's OWN meetings are never in their team view (grand is nobody's report here).
        val grandsOwnMeeting = grand.createMeeting(pair.managerId, "2026-07-03")
        val teamAfter = grand.get("/api/v1/one-on-ones?view=team&includeIndirect=true").body<OneOnOnePageResponse>()
        assertTrue(teamAfter.items.none { it.id == grandsOwnMeeting.id })

        // A PEER manager's meeting with grand's direct report is excluded too — the scope keys
        // on the meeting's manager, not its subordinate.
        val peerEmail = uniqueEmail("peer")
        val peerId = TestUsers.seed(peerEmail, "pw", roles = emptySet())
        val peerTeam = TestServices.teams.create(Team(name = "oo-peer-${UUID.randomUUID()}", managerId = peerId))
        TestServices.teams.addMember(peerTeam, pair.managerId)
        val peerMeeting = authedClient(peerEmail, "pw").createMeeting(pair.managerId, "2026-07-04")
        val teamFinal = grand.get("/api/v1/one-on-ones?view=team&includeIndirect=true").body<OneOnOnePageResponse>()
        assertTrue(teamFinal.items.none { it.id == peerMeeting.id })

        // includeIndirect is a team-view-only parameter.
        assertEquals(
            HttpStatusCode.BadRequest,
            grand.get("/api/v1/one-on-ones?view=own&includeIndirect=true").status,
        )
        assertEquals(HttpStatusCode.BadRequest, grand.get("/api/v1/one-on-ones?view=nope").status)
    }

    @Test
    fun `view=with lists every meeting between the caller and one counterpart in both role directions`() = testApplication {
        usePostgresTestcontainer()
        // The pair swapped roles over time: alice manages bob today, bob managed alice before.
        val pair = seedPair() // alice = pair.manager, bob = pair.subordinate
        val reverseTeam = TestServices.teams.create(Team(name = "oo-rev-${UUID.randomUUID()}", managerId = pair.subordinateId))
        TestServices.teams.addMember(reverseTeam, pair.managerId)
        val alice = authedClient(pair.managerEmail, "pw")
        val bob = authedClient(pair.subordinateEmail, "pw")
        val current = alice.createMeeting(pair.subordinateId, "2026-07-05")
        val historic = bob.createMeeting(pair.managerId, "2026-01-10")
        // Noise: alice with a different report, and bob with a report of his own.
        val otherId = TestUsers.seed(uniqueEmail("other"), "pw", roles = emptySet())
        TestServices.teams.addMember(pair.teamId, otherId)
        alice.createMeeting(otherId, "2026-07-06")
        val bobsOtherId = TestUsers.seed(uniqueEmail("bobs-other"), "pw", roles = emptySet())
        TestServices.teams.addMember(reverseTeam, bobsOtherId)
        bob.createMeeting(bobsOtherId, "2026-07-07")

        val withBob = alice.get("/api/v1/one-on-ones?view=with&counterpartId=${pair.subordinateId}")
            .body<OneOnOnePageResponse>()
        assertEquals(setOf(current.id, historic.id), withBob.items.map { it.id }.toSet())
        assertEquals(2, withBob.total)
        // Symmetric from bob's side.
        val withAlice = bob.get("/api/v1/one-on-ones?view=with&counterpartId=${pair.managerId}")
            .body<OneOnOnePageResponse>()
        assertEquals(setOf(current.id, historic.id), withAlice.items.map { it.id }.toSet())

        // counterpartId is required for view=with, rejected elsewhere, and must be a UInt.
        assertEquals(HttpStatusCode.BadRequest, alice.get("/api/v1/one-on-ones?view=with").status)
        assertEquals(
            HttpStatusCode.BadRequest,
            alice.get("/api/v1/one-on-ones?view=own&counterpartId=${pair.subordinateId}").status,
        )
        assertEquals(HttpStatusCode.BadRequest, alice.get("/api/v1/one-on-ones?view=with&counterpartId=abc").status)
    }

    @Test
    fun `list carries child counts, sorts by meetingDate desc by default, and filters by date range`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair(subordinateName = "Zofia Unikat-${UUID.randomUUID().toString().take(8)}")
        val manager = authedClient(pair.managerEmail, "pw")

        val early = manager.createMeeting(
            pair.subordinateId, "2026-06-01",
            points = listOf(OneOnOneItemInput(content = "p1"), OneOnOneItemInput(content = "p2")),
            decisions = listOf(OneOnOneItemInput(content = "d1")),
            actionItems = listOf(
                OneOnOneActionItemInput(content = "open", owner = ActionItemOwner.MANAGER),
                OneOnOneActionItemInput(content = "done", owner = ActionItemOwner.MANAGER, resolved = true),
            ),
        )
        val late = manager.createMeeting(pair.subordinateId, "2026-07-01")

        val page = manager.get("/api/v1/one-on-ones?view=managed").body<OneOnOnePageResponse>()
        val ids = page.items.filter { it.id == early.id || it.id == late.id }.map { it.id }
        assertEquals(listOf(late.id, early.id), ids) // -meetingDate default

        val earlyRow = page.items.single { it.id == early.id }
        assertEquals(2, earlyRow.pointCount)
        assertEquals(1, earlyRow.decisionCount)
        assertEquals(2, earlyRow.actionItemCount)
        assertEquals(1, earlyRow.openActionItemCount)
        assertTrue(earlyRow.subordinateName.startsWith("Zofia"))
        assertEquals(pair.managerId, earlyRow.managerId)

        // Date-range filter (string compare over ISO dates).
        val filtered = manager.get("/api/v1/one-on-ones?view=managed&meetingDate[gte]=2026-06-15")
            .body<OneOnOnePageResponse>()
        assertTrue(filtered.items.any { it.id == late.id })
        assertTrue(filtered.items.none { it.id == early.id })
        // Malformed range value → 400.
        assertEquals(
            HttpStatusCode.BadRequest,
            manager.get("/api/v1/one-on-ones?view=managed&meetingDate[gte]=June").status,
        )

        // The late meeting carried over the "open" action item: counts reflect it.
        val lateRow = page.items.single { it.id == late.id }
        assertEquals(1, lateRow.actionItemCount)
        assertEquals(1, lateRow.openActionItemCount)
    }

    @Test
    fun `list filters compose - party names and both date bounds narrow the rows`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair() // "Mia Manager" / "Sam Subordinate", fresh team per call
        val manager = authedClient(pair.managerEmail, "pw")
        val june = manager.createMeeting(pair.subordinateId, "2026-06-01")
        val july = manager.createMeeting(pair.subordinateId, "2026-07-01")

        suspend fun ids(query: String): Set<UInt> =
            manager.get("/api/v1/one-on-ones?view=managed&$query").body<OneOnOnePageResponse>()
                .items.map { it.id }.toSet()

        // Party-name substrings, case-insensitive; a non-matching one excludes everything.
        assertEquals(setOf(june.id, july.id), ids("managerName=mia"))
        assertEquals(emptySet(), ids("managerName=zzz-nobody"))
        assertEquals(setOf(june.id, july.id), ids("subordinateName=sam"))
        assertEquals(emptySet(), ids("subordinateName=zzz-nobody"))
        // meetingDate[lte] alone, and both bounds as a window.
        assertEquals(setOf(june.id), ids("meetingDate[lte]=2026-06-30"))
        assertEquals(setOf(july.id), ids("meetingDate[gte]=2026-06-15&meetingDate[lte]=2026-07-15"))

        // Blank filter strings are no-ops. The route's optionalString never forwards blanks, so
        // this is service-level only — pinned so the guards stay.
        val paging = ch.nokillswit.infra.paging.PageRequest(
            page = 1,
            pageSize = 100,
            sort = listOf(ch.nokillswit.infra.paging.SortField("id", descending = false)),
        )
        val unfiltered = TestServices.oneOnOnes.list(
            ch.nokillswit.oneonones.OneOnOneListView.MANAGED,
            pair.managerId,
            ch.nokillswit.oneonones.OneOnOneListFilter(),
            paging,
        )
        val blankFiltered = TestServices.oneOnOnes.list(
            ch.nokillswit.oneonones.OneOnOneListView.MANAGED,
            pair.managerId,
            ch.nokillswit.oneonones.OneOnOneListFilter(managerName = " ", subordinateName = ""),
            paging,
        )
        assertEquals(unfiltered.total, blankFiltered.total)
        assertEquals(2, unfiltered.total)
    }

    // ---- action-item history ----

    @Test
    fun `action item history spans the copy chain and skips soft-deleted meetings`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val manager = authedClient(pair.managerEmail, "pw")

        val first = manager.createMeeting(
            pair.subordinateId, "2026-07-01",
            actionItems = listOf(OneOnOneActionItemInput(content = "long runner", owner = ActionItemOwner.MANAGER)),
        )
        val second = manager.createMeeting(pair.subordinateId, "2026-07-08")
        val third = manager.createMeeting(pair.subordinateId, "2026-07-15")
        val thirdItem = third.actionItems.single()

        // Full chain from the newest copy: three meetings, newest meeting first.
        val history = manager.get("/api/v1/one-on-ones/action-items/${thirdItem.id}/history")
            .body<ActionItemHistoryResponse>()
        assertEquals(listOf(third.id, second.id, first.id), history.items.map { it.meetingId })
        assertEquals(listOf("2026-07-15", "2026-07-08", "2026-07-01"), history.items.map { it.meetingDate })
        assertTrue(history.items.all { it.content == "long runner" })

        // Soft-delete the MIDDLE meeting: its entry disappears but the chain is walked through.
        // Done at the data layer, not via the API: the latest-only-delete rule (v1.14) forbids deleting
        // a non-tail meeting, so a soft-deleted meeting inside a surviving chain is only reachable this way.
        TestOneOnOneMaintenance.softDeleteMeeting(second.id)
        val afterDelete = manager.get("/api/v1/one-on-ones/action-items/${thirdItem.id}/history")
            .body<ActionItemHistoryResponse>()
        assertEquals(listOf(third.id, first.id), afterDelete.items.map { it.meetingId })

        // Walking from the FIRST meeting's item reaches the same chain (descendants direction).
        val fromRoot = manager.get("/api/v1/one-on-ones/action-items/${first.actionItems.single().id}/history")
            .body<ActionItemHistoryResponse>()
        assertEquals(listOf(third.id, first.id), fromRoot.items.map { it.meetingId })

        // firstAppearedOn survives the deleted middle hop (the root is intact) …
        val thirdReread = manager.get("/api/v1/one-on-ones/${third.id}").body<OneOnOneResponse>()
        assertEquals("2026-07-01", thirdReread.actionItems.single().firstAppearedOn)

        // … and falls forward to the earliest SURVIVING appearance once the root is deleted —
        // consistent with the first row the history endpoint reports (data-layer soft-delete, as above).
        TestOneOnOneMaintenance.softDeleteMeeting(first.id)
        val afterRootDelete = manager.get("/api/v1/one-on-ones/${third.id}").body<OneOnOneResponse>()
        assertNull(
            afterRootDelete.actionItems.single().firstAppearedOn,
            "both ancestor meetings deleted → no surviving appearance",
        )
    }

    @Test
    fun `action item history is authorized like the meeting and 404s on unknown items`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val strangerEmail = uniqueEmail("stranger")
        TestUsers.seed(strangerEmail, "pw", roles = emptySet())
        val manager = authedClient(pair.managerEmail, "pw")
        val meeting = manager.createMeeting(
            pair.subordinateId,
            actionItems = listOf(OneOnOneActionItemInput(content = "task", owner = ActionItemOwner.MANAGER)),
        )
        val itemId = meeting.actionItems.single().id

        assertEquals(
            HttpStatusCode.OK,
            authedClient(pair.subordinateEmail, "pw").get("/api/v1/one-on-ones/action-items/$itemId/history").status,
        )
        assertEquals(
            HttpStatusCode.Forbidden,
            authedClient(strangerEmail, "pw").get("/api/v1/one-on-ones/action-items/$itemId/history").status,
        )
        assertEquals(
            HttpStatusCode.NotFound,
            manager.get("/api/v1/one-on-ones/action-items/999999/history").status,
        )
    }

    // ---- events endpoint authz ----

    @Test
    fun `events are readable exactly like the meeting`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val strangerEmail = uniqueEmail("stranger")
        TestUsers.seed(strangerEmail, "pw", roles = emptySet())
        val manager = authedClient(pair.managerEmail, "pw")
        val meeting = manager.createMeeting(pair.subordinateId)

        assertEquals(
            HttpStatusCode.OK,
            authedClient(pair.subordinateEmail, "pw").get("/api/v1/one-on-ones/${meeting.id}/events").status,
        )
        assertEquals(
            HttpStatusCode.Forbidden,
            authedClient(strangerEmail, "pw").get("/api/v1/one-on-ones/${meeting.id}/events").status,
        )
        assertEquals(HttpStatusCode.NotFound, manager.get("/api/v1/one-on-ones/999999/events").status)
    }

    // ---- notification ----

    @Test
    fun `creating a meeting notifies both parties with view links - once, on creation only`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair(managerName = "Nadia Notifier", subordinateName = "Sub Sam")
        val manager = authedClient(pair.managerEmail, "pw")
        val meeting = manager.createMeeting(pair.subordinateId, "2026-07-01")

        val subordinate = authedClient(pair.subordinateEmail, "pw")
        val notifications = subordinate.get("/api/v1/notifications").body<NotificationPageResponse>()
        val note = notifications.items.single { it.type == NotificationType.ONE_ON_ONE_CREATED_TO_SUBORDINATE }
        assertEquals("/one-on-ones/${meeting.id}/view", note.link)
        assertEquals("Nadia Notifier", note.params["manager"])
        assertEquals("2026-07-01", note.params["date"])

        // The manager (author) gets a confirmation with the subordinate's name.
        val managerNote = manager.get("/api/v1/notifications").body<NotificationPageResponse>()
            .items.single { it.type == NotificationType.ONE_ON_ONE_CREATED_TO_MANAGER }
        assertEquals("/one-on-ones/${meeting.id}/view", managerNote.link)
        assertEquals("Sub Sam", managerNote.params["subordinate"])
        assertEquals("2026-07-01", managerNote.params["date"])

        // Edits and deletions notify nobody.
        manager.put("/api/v1/one-on-ones/${meeting.id}") {
            contentType(ContentType.Application.Json)
            setBody(meeting.toUpdate().copy(meetingDate = "2026-07-02"))
        }
        manager.delete("/api/v1/one-on-ones/${meeting.id}")
        val after = subordinate.get("/api/v1/notifications").body<NotificationPageResponse>()
        assertEquals(
            1,
            after.items.count { it.type == NotificationType.ONE_ON_ONE_CREATED_TO_SUBORDINATE },
        )
        val managerAfter = manager.get("/api/v1/notifications").body<NotificationPageResponse>()
        assertEquals(
            1,
            managerAfter.items.count { it.type == NotificationType.ONE_ON_ONE_CREATED_TO_MANAGER },
        )
    }
}
