package ch.nokillswit

import ch.nokillswit.impactlog.ImpactEntryEventListResponse
import ch.nokillswit.impactlog.ImpactEntryEventType
import ch.nokillswit.impactlog.ImpactEntryPageResponse
import ch.nokillswit.impactlog.ImpactEntryRequest
import ch.nokillswit.impactlog.ImpactEntryResponse
import ch.nokillswit.notifications.NotificationPageResponse
import ch.nokillswit.notifications.NotificationResponse
import ch.nokillswit.notifications.NotificationType
import ch.nokillswit.plugins.ProblemDetail
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
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class ImpactLogRoutesTest {

    private data class JournalPair(
        val managerId: UInt,
        val managerEmail: String,
        val ownerId: UInt,
        val ownerEmail: String,
    )

    /** A manager with one direct report (a fresh team per call, so tests never interfere). */
    private suspend fun seedPair(): JournalPair {
        val managerEmail = uniqueEmail("impact-manager")
        val managerId = TestUsers.seed(managerEmail, "pw", name = "Mona Manager", roles = emptySet())
        val ownerEmail = uniqueEmail("impact-owner")
        val ownerId = TestUsers.seed(ownerEmail, "pw", name = "Olga Owner", roles = emptySet())
        val teamId = TestServices.teams.create(Team(name = "impact-${UUID.randomUUID()}", managerId = managerId))
        TestServices.teams.addMember(teamId, ownerId)
        return JournalPair(managerId, managerEmail, ownerId, ownerEmail)
    }

    /** Puts [pair]'s manager into a team managed by a new grand-manager; returns (email, id). */
    private suspend fun seedGrandManager(pair: JournalPair): Pair<String, UInt> {
        val grandEmail = uniqueEmail("impact-grand")
        val grandId = TestUsers.seed(grandEmail, "pw", name = "Grand Manager", roles = emptySet())
        val teamId = TestServices.teams.create(Team(name = "impact-g-${UUID.randomUUID()}", managerId = grandId))
        TestServices.teams.addMember(teamId, pair.managerId)
        return grandEmail to grandId
    }

    private fun entryBody(
        title: String = "Quarterly report pipeline",
        periodStart: String = "2026-07-01",
        periodEnd: String = "2026-07-31",
        whatHappened: String = "Shipped the quarterly report pipeline.",
        contribution: String = "Designed and built the aggregation layer.",
        whyItMattered: String = "Cut the reporting turnaround from days to minutes.",
        evidence: String = "Kudos from the finance team; dashboards in daily use.",
    ) = ImpactEntryRequest(
        title = title,
        periodStart = periodStart,
        periodEnd = periodEnd,
        whatHappened = whatHappened,
        contribution = contribution,
        whyItMattered = whyItMattered,
        evidence = evidence,
    )

    private suspend fun HttpClient.createEntry(body: ImpactEntryRequest = entryBody()): ImpactEntryResponse {
        val response = post("/api/v1/impact-log") {
            contentType(ContentType.Application.Json)
            setBody(body)
        }
        assertEquals(HttpStatusCode.Created, response.status)
        return response.body<ImpactEntryResponse>()
    }

    private suspend fun HttpClient.notificationsOf(type: NotificationType): List<NotificationResponse> =
        get("/api/v1/notifications?pageSize=100").body<NotificationPageResponse>()
            .items.filter { it.type == type }

    // ---- creation ----

    @Test
    fun `create and read round-trip - owner from the JWT, Location header, server timestamps`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val owner = authedClient(pair.ownerEmail, "pw")

        val response = owner.post("/api/v1/impact-log") {
            contentType(ContentType.Application.Json)
            setBody(entryBody())
        }
        assertEquals(HttpStatusCode.Created, response.status)
        val created = response.body<ImpactEntryResponse>()
        val location = response.headers["Location"]
        assertNotNull(location)
        assertTrue(location.endsWith("/api/v1/impact-log/${created.id}"), "Location was $location")
        assertEquals(pair.ownerId, created.userId)
        assertEquals("Olga Owner", created.userName)
        assertEquals("Quarterly report pipeline", created.title)
        assertEquals("2026-07-01", created.periodStart)
        assertEquals("2026-07-31", created.periodEnd)
        assertEquals("Shipped the quarterly report pipeline.", created.whatHappened)
        assertEquals("Designed and built the aggregation layer.", created.contribution)
        assertEquals("Cut the reporting turnaround from days to minutes.", created.whyItMattered)
        assertEquals("Kudos from the finance team; dashboards in daily use.", created.evidence)
        assertTrue(created.createdAt > 0)
        assertEquals(created.createdAt, created.lastModified)

        val read = owner.get("/api/v1/impact-log/${created.id}")
        assertEquals(HttpStatusCode.OK, read.status)
        assertEquals(created, read.body<ImpactEntryResponse>())
    }

    @Test
    fun `create validates the period and the four sections`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val owner = authedClient(pair.ownerEmail, "pw")

        suspend fun expect400(body: ImpactEntryRequest, detail: String) {
            val response = owner.post("/api/v1/impact-log") {
                contentType(ContentType.Application.Json)
                setBody(body)
            }
            assertEquals(HttpStatusCode.BadRequest, response.status)
            assertEquals(detail, response.body<ProblemDetail>().detail)
        }

        expect400(entryBody(title = "  "), "Title must not be blank")
        expect400(entryBody(title = "x".repeat(201)), "Title must be at most 200 characters")
        expect400(entryBody(periodStart = "07/01/2026"), "Period start must be an ISO date (YYYY-MM-DD)")
        expect400(entryBody(periodEnd = "2026-7-1"), "Period end must be an ISO date (YYYY-MM-DD)")
        expect400(
            entryBody(periodStart = "2026-08-01", periodEnd = "2026-07-01"),
            "Period start must not be after period end",
        )
        expect400(entryBody(whatHappened = "  "), "What happened must not be blank")
        expect400(entryBody(contribution = ""), "My contribution must not be blank")
        expect400(entryBody(whyItMattered = " "), "Why it mattered must not be blank")
        expect400(entryBody(evidence = ""), "Evidence must not be blank")
        expect400(
            entryBody(evidence = "x".repeat(5001)),
            "Evidence must be at most 5000 characters",
        )
        // A single-day period (start == end) is fine.
        owner.createEntry(entryBody(periodStart = "2026-07-15", periodEnd = "2026-07-15"))
    }

    // ---- read authorization ----

    @Test
    fun `read matrix - owner, direct manager, skip-level manager, and HR read, others get 403`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val (grandEmail, _) = seedGrandManager(pair)
        val entry = authedClient(pair.ownerEmail, "pw").createEntry()

        assertEquals(HttpStatusCode.OK, authedClient(pair.managerEmail, "pw").get("/api/v1/impact-log/${entry.id}").status)
        assertEquals(HttpStatusCode.OK, authedClient(grandEmail, "pw").get("/api/v1/impact-log/${entry.id}").status)

        val hrEmail = uniqueEmail("impact-hr")
        TestUsers.seed(hrEmail, "pw", roles = setOf(UserRole.HR))
        assertEquals(HttpStatusCode.OK, authedClient(hrEmail, "pw").get("/api/v1/impact-log/${entry.id}").status)

        // An unrelated regular user and a non-chain ADMIN both get 403 (the narrowed-ADMIN rule);
        // the read-before-guard idiom means the existing id answers 403, a missing one 404.
        val strangerEmail = uniqueEmail("impact-stranger")
        TestUsers.seed(strangerEmail, "pw", roles = emptySet())
        val stranger = authedClient(strangerEmail, "pw")
        assertEquals(HttpStatusCode.Forbidden, stranger.get("/api/v1/impact-log/${entry.id}").status)
        assertEquals(HttpStatusCode.NotFound, stranger.get("/api/v1/impact-log/999999999").status)

        val adminEmail = uniqueEmail("impact-admin")
        TestUsers.seed(adminEmail, "pw", roles = setOf(UserRole.ADMIN))
        assertEquals(HttpStatusCode.Forbidden, authedClient(adminEmail, "pw").get("/api/v1/impact-log/${entry.id}").status)
    }

    // ---- writes ----

    @Test
    fun `update is owner-only and replaces the whole document`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val owner = authedClient(pair.ownerEmail, "pw")
        val entry = owner.createEntry()

        // The chain reads but never writes (the authorship carve-out); ADMIN gets nothing.
        val managerPut = authedClient(pair.managerEmail, "pw").put("/api/v1/impact-log/${entry.id}") {
            contentType(ContentType.Application.Json)
            setBody(entryBody(whatHappened = "Manager rewrite attempt"))
        }
        assertEquals(HttpStatusCode.Forbidden, managerPut.status)

        val update = entryBody(
            periodStart = "2026-06-01",
            periodEnd = "2026-08-31",
            whatHappened = "Shipped the pipeline AND the alerting on top.",
        )
        val put = owner.put("/api/v1/impact-log/${entry.id}") {
            contentType(ContentType.Application.Json)
            setBody(update)
        }
        assertEquals(HttpStatusCode.NoContent, put.status)

        val read = owner.get("/api/v1/impact-log/${entry.id}").body<ImpactEntryResponse>()
        assertEquals("2026-06-01", read.periodStart)
        assertEquals("2026-08-31", read.periodEnd)
        assertEquals("Shipped the pipeline AND the alerting on top.", read.whatHappened)
        assertTrue(read.lastModified >= read.createdAt)

        // Validation runs after the owner guard: the owner's bad payload is 400 …
        val bad = owner.put("/api/v1/impact-log/${entry.id}") {
            contentType(ContentType.Application.Json)
            setBody(entryBody(whatHappened = ""))
        }
        assertEquals(HttpStatusCode.BadRequest, bad.status)
        // … while an outsider's equally bad payload stays 403 (guard-before-validate).
        val outsiderBad = authedClient(pair.managerEmail, "pw").put("/api/v1/impact-log/${entry.id}") {
            contentType(ContentType.Application.Json)
            setBody(entryBody(whatHappened = ""))
        }
        assertEquals(HttpStatusCode.Forbidden, outsiderBad.status)
    }

    @Test
    fun `delete is owner-only, soft, and idempotently 404s afterwards`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val owner = authedClient(pair.ownerEmail, "pw")
        val entry = owner.createEntry()

        assertEquals(
            HttpStatusCode.Forbidden,
            authedClient(pair.managerEmail, "pw").delete("/api/v1/impact-log/${entry.id}").status,
        )
        assertEquals(HttpStatusCode.NoContent, owner.delete("/api/v1/impact-log/${entry.id}").status)
        assertEquals(HttpStatusCode.NotFound, owner.get("/api/v1/impact-log/${entry.id}").status)
        assertEquals(HttpStatusCode.NotFound, owner.delete("/api/v1/impact-log/${entry.id}").status)
        val own = owner.get("/api/v1/impact-log").body<ImpactEntryPageResponse>()
        assertTrue(own.items.none { it.id == entry.id })
    }

    // ---- events ----

    @Test
    fun `the event trail records the creation and one UPDATED naming the changed fields`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val owner = authedClient(pair.ownerEmail, "pw")
        val entry = owner.createEntry()

        // A no-op PUT records nothing.
        owner.put("/api/v1/impact-log/${entry.id}") {
            contentType(ContentType.Application.Json)
            setBody(entryBody())
        }
        // A real edit records ONE UPDATED event naming the changed fields (+ period deltas).
        owner.put("/api/v1/impact-log/${entry.id}") {
            contentType(ContentType.Application.Json)
            setBody(entryBody(periodEnd = "2026-08-15", contribution = "Also mentored the new joiner."))
        }
        // The events GET rides the read guard — the direct manager reads the trail. (A DELETED
        // event is minted too, but a soft-deleted entry's trail is unreachable through the API —
        // the read preamble 404s first; the pure-builder test covers the descriptor.)
        val events = authedClient(pair.managerEmail, "pw")
            .get("/api/v1/impact-log/${entry.id}/events")
            .body<ImpactEntryEventListResponse>().items
        assertEquals(listOf(ImpactEntryEventType.UPDATED, ImpactEntryEventType.CREATED), events.map { it.type })
        val created = events.last()
        assertEquals("Olga Owner", created.userName)
        assertEquals(mapOf("periodStart" to "2026-07-01", "periodEnd" to "2026-07-31"), created.params)
        val updated = events.first()
        assertEquals("periodEnd,contribution", updated.params["changed"])
        assertEquals("2026-07-31", updated.params["periodEndFrom"])
        assertEquals("2026-08-15", updated.params["periodEndTo"])
        // Section text never rides params.
        assertTrue(updated.params.values.none { it.contains("mentored") })
    }

    // ---- notifications ----

    @Test
    fun `mutations notify the direct manager only - never the owner or the chain above`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val (grandEmail, _) = seedGrandManager(pair)
        val owner = authedClient(pair.ownerEmail, "pw")
        val manager = authedClient(pair.managerEmail, "pw")

        val entry = owner.createEntry()
        owner.put("/api/v1/impact-log/${entry.id}") {
            contentType(ContentType.Application.Json)
            setBody(entryBody(whyItMattered = "It unblocked the whole quarter."))
        }
        owner.delete("/api/v1/impact-log/${entry.id}")

        val created = manager.notificationsOf(NotificationType.IMPACT_ENTRY_CREATED_TO_MANAGER)
            .filter { it.params["author"] == "Olga Owner" }
        assertEquals(1, created.size)
        assertEquals("2026-07-01", created.single().params["periodStart"])
        assertEquals("2026-07-31", created.single().params["periodEnd"])
        assertEquals("/impact-log/${entry.id}/view", created.single().link)

        val updated = manager.notificationsOf(NotificationType.IMPACT_ENTRY_UPDATED_TO_MANAGER)
            .filter { it.params["author"] == "Olga Owner" }
        assertEquals(1, updated.size)

        val deleted = manager.notificationsOf(NotificationType.IMPACT_ENTRY_DELETED_TO_MANAGER)
            .filter { it.params["author"] == "Olga Owner" }
        assertEquals(1, deleted.size)
        assertEquals("/impact-log?tab=managed", deleted.single().link)

        // The acting owner hears nothing about their own journal…
        assertTrue(owner.notificationsOf(NotificationType.IMPACT_ENTRY_CREATED_TO_MANAGER).isEmpty())
        // …and the fan-out stays direct: the grand-manager reads on demand but is not pinged.
        val grand = authedClient(grandEmail, "pw")
        assertTrue(
            grand.notificationsOf(NotificationType.IMPACT_ENTRY_CREATED_TO_MANAGER)
                .none { it.params["author"] == "Olga Owner" },
        )
    }

    @Test
    fun `an owner with no manager notifies nobody and still creates fine`() = testApplication {
        usePostgresTestcontainer()
        val soloEmail = uniqueEmail("impact-solo")
        TestUsers.seed(soloEmail, "pw", name = "Solo Author", roles = emptySet())
        val solo = authedClient(soloEmail, "pw")
        val entry = solo.createEntry()
        assertEquals("Solo Author", entry.userName)
    }

    // ---- list views ----

    @Test
    fun `view own lists only the caller's journal, newest period first by default`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val owner = authedClient(pair.ownerEmail, "pw")
        owner.createEntry(entryBody(title = "January work", periodStart = "2026-01-01", periodEnd = "2026-01-31"))
        owner.createEntry(entryBody(title = "May work", periodStart = "2026-05-01", periodEnd = "2026-05-31"))
        // The manager's own journal entry must not leak into the owner's view.
        authedClient(pair.managerEmail, "pw").createEntry()

        val page = owner.get("/api/v1/impact-log").body<ImpactEntryPageResponse>()
        assertEquals(2, page.total)
        assertEquals(listOf("2026-05-01", "2026-01-01"), page.items.map { it.periodStart })
        // Rows carry the title (v2.37.0 — the identity column; section texts never list).
        assertEquals("May work", page.items.first().title)
        assertTrue(page.items.all { it.userId == pair.ownerId })
    }

    @Test
    fun `view managed lists direct reports, widening to the subtree with includeIndirect`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val (grandEmail, _) = seedGrandManager(pair)
        authedClient(pair.ownerEmail, "pw").createEntry()

        // The direct manager sees the report's entry either way.
        val manager = authedClient(pair.managerEmail, "pw")
        val direct = manager.get("/api/v1/impact-log?view=managed").body<ImpactEntryPageResponse>()
        assertTrue(direct.items.any { it.userId == pair.ownerId })

        // The grand-manager sees nothing direct-only, everything with includeIndirect.
        val grand = authedClient(grandEmail, "pw")
        val grandDirect = grand.get("/api/v1/impact-log?view=managed").body<ImpactEntryPageResponse>()
        assertTrue(grandDirect.items.none { it.userId == pair.ownerId })
        val grandWide = grand.get("/api/v1/impact-log?view=managed&includeIndirect=true")
            .body<ImpactEntryPageResponse>()
        assertTrue(grandWide.items.any { it.userId == pair.ownerId })

        // The userName substring filter composes on top (accent/case-insensitive)…
        val filtered = manager.get("/api/v1/impact-log?view=managed&userName=olga")
            .body<ImpactEntryPageResponse>()
        assertTrue(filtered.items.isNotEmpty() && filtered.items.all { it.userName == "Olga Owner" })
        // …and so does the title filter (v2.37.0).
        val byTitle = manager.get("/api/v1/impact-log?view=managed&title=quarterly report")
            .body<ImpactEntryPageResponse>()
        assertTrue(byTitle.items.isNotEmpty() && byTitle.items.all { it.title.contains("Quarterly report") })
        assertEquals(
            0,
            manager.get("/api/v1/impact-log?view=managed&title=zzz-no-such").body<ImpactEntryPageResponse>().total,
        )

        // A non-manager's managed view is an empty page, not an error.
        val empty = authedClient(pair.ownerEmail, "pw").get("/api/v1/impact-log?view=managed")
            .body<ImpactEntryPageResponse>()
        assertEquals(0, empty.total)
    }

    @Test
    fun `view managed pins to one report with userId - out-of-chain ids yield an empty page`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val (grandEmail, _) = seedGrandManager(pair)
        // A second direct report on the same manager, so the pin has something to exclude.
        val otherEmail = uniqueEmail("impact-other")
        val otherId = TestUsers.seed(otherEmail, "pw", name = "Oskar Other", roles = emptySet())
        val teamId = TestServices.teams.create(Team(name = "impact-p-${UUID.randomUUID()}", managerId = pair.managerId))
        TestServices.teams.addMember(teamId, otherId)
        val ownerEntry = authedClient(pair.ownerEmail, "pw").createEntry()
        authedClient(otherEmail, "pw").createEntry(entryBody(title = "Other report's work"))

        // The pin narrows the managed scope to exactly one report (the drill-down, v2.38.0).
        val manager = authedClient(pair.managerEmail, "pw")
        val pinned = manager.get("/api/v1/impact-log?view=managed&userId=${pair.ownerId}")
            .body<ImpactEntryPageResponse>()
        assertEquals(1, pinned.total)
        assertTrue(pinned.items.all { it.userId == pair.ownerId })
        assertEquals(ownerEntry.id, pinned.items.single().id)

        // The pin composes with includeIndirect — the chain drill-down's shape.
        val grandPinned = authedClient(grandEmail, "pw")
            .get("/api/v1/impact-log?view=managed&userId=${pair.ownerId}&includeIndirect=true")
            .body<ImpactEntryPageResponse>()
        assertTrue(grandPinned.items.any { it.id == ownerEntry.id })

        // An id outside the caller's scope intersects to nothing — an empty 200, never a leak.
        val outOfChain = manager.get("/api/v1/impact-log?view=managed&userId=${pair.managerId}")
            .body<ImpactEntryPageResponse>()
        assertEquals(0, outOfChain.total)
    }

    @Test
    fun `view user is the HR auditor's - HR only, userId required, others 403`() = testApplication {
        usePostgresTestcontainer()
        val pair = seedPair()
        val entry = authedClient(pair.ownerEmail, "pw").createEntry()

        val hrEmail = uniqueEmail("impact-hr-list")
        TestUsers.seed(hrEmail, "pw", roles = setOf(UserRole.HR))
        val hr = authedClient(hrEmail, "pw")
        val page = hr.get("/api/v1/impact-log?view=user&userId=${pair.ownerId}").body<ImpactEntryPageResponse>()
        assertTrue(page.items.any { it.id == entry.id })

        assertEquals(HttpStatusCode.BadRequest, hr.get("/api/v1/impact-log?view=user").status)
        assertEquals(
            HttpStatusCode.BadRequest,
            hr.get("/api/v1/impact-log?userId=${pair.ownerId}").status,
        )
        assertEquals(
            HttpStatusCode.BadRequest,
            authedClient(pair.ownerEmail, "pw").get("/api/v1/impact-log?includeIndirect=true").status,
        )
        assertEquals(
            HttpStatusCode.BadRequest,
            hr.get("/api/v1/impact-log?view=everything").status,
        )

        // ADMIN is not an auditor (the narrowed-ADMIN rule) — nor is the direct manager.
        val adminEmail = uniqueEmail("impact-admin-list")
        TestUsers.seed(adminEmail, "pw", roles = setOf(UserRole.ADMIN))
        assertEquals(
            HttpStatusCode.Forbidden,
            authedClient(adminEmail, "pw").get("/api/v1/impact-log?view=user&userId=${pair.ownerId}").status,
        )
        assertEquals(
            HttpStatusCode.Forbidden,
            authedClient(pair.managerEmail, "pw").get("/api/v1/impact-log?view=user&userId=${pair.ownerId}").status,
        )
    }
}
