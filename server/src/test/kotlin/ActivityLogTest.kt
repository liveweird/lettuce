package ch.nokillswit

import ch.nokillswit.activity.ActivityArea
import ch.nokillswit.activity.ActivityEntry
import ch.nokillswit.activity.ActivityPage
import ch.nokillswit.feedbacks.FeedbackCreateRequest
import ch.nokillswit.feedbacks.FeedbackEventService.FeedbackEvents
import ch.nokillswit.feedbacks.FeedbackResponse
import ch.nokillswit.feedbacks.FeedbackStatus
import ch.nokillswit.feedbacks.FeedbackVisibility
import ch.nokillswit.goals.GoalCreateRequest
import ch.nokillswit.goals.GoalEventService.GoalEvents
import ch.nokillswit.goals.GoalResponse
import ch.nokillswit.goals.GoalType
import ch.nokillswit.impactlog.ImpactEntryRequest
import ch.nokillswit.impactlog.ImpactEntryResponse
import ch.nokillswit.infra.db.EventLogTable
import ch.nokillswit.oneonones.OneOnOneCreateRequest
import ch.nokillswit.oneonones.OneOnOneResponse
import ch.nokillswit.plugins.ProblemDetail
import ch.nokillswit.reviews.CategoryAssessment
import ch.nokillswit.reviews.PerformanceReviewCreateRequest
import ch.nokillswit.reviews.PerformanceReviewResponse
import ch.nokillswit.succession.RetentionRisk
import ch.nokillswit.succession.RoleCriticality
import ch.nokillswit.succession.SuccessionPlanCreateRequest
import ch.nokillswit.succession.SuccessionPlanResponse
import ch.nokillswit.teamkpis.TeamKpiCreateRequest
import ch.nokillswit.teamkpis.TeamKpiResponse
import ch.nokillswit.teamkpis.TeamKpiType
import ch.nokillswit.teams.Team
import ch.nokillswit.users.Feature
import ch.nokillswit.users.OPT_IN_FEATURES
import ch.nokillswit.users.UserRole
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import org.jetbrains.exposed.v1.r2dbc.insert
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import java.time.LocalDate
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * `GET /api/v1/users/{id}/activity` (v4.9.0, step 1: the seven document event trails; self + HR).
 * Everything here goes through the real routes — the log is a read model over the events the
 * feature routes mint, so seeding via the routes is also the proof that the union sees them.
 * Chain-viewer visibility is step 2 (a chain manager is 403 until then).
 */
class ActivityLogTest {

    private val password = "pw-123456789"

    private class Person(val id: UInt, val name: String, val email: String, val client: HttpClient)

    private suspend fun ApplicationTestBuilder.person(
        prefix: String,
        roles: Set<UserRole> = emptySet(),
        disabled: Set<Feature> = emptySet(),
    ): Person {
        val email = uniqueEmail(prefix)
        val name = "$prefix-${email.substringAfter('-').take(8)}"
        val id = TestUsers.seed(email = email, password = password, name = name, roles = roles)
        // setDisabledFeatures replaces wholesale — keep the inverted-default MFA/Teams rows.
        if (disabled.isNotEmpty()) TestServices.users.setDisabledFeatures(id, disabled + OPT_IN_FEATURES)
        return Person(id, name, email, authedClient(email, password))
    }

    private suspend fun HttpClient.activity(userId: UInt, query: String = ""): HttpResponse =
        get("/api/v1/users/$userId/activity${if (query.isEmpty()) "" else "?$query"}")

    private suspend fun HttpClient.page(userId: UInt, query: String = ""): ActivityPage {
        val response = activity(userId, query)
        assertEquals(HttpStatusCode.OK, response.status)
        return response.body<ActivityPage>()
    }

    /** M manages E; M authored one document of every area (a journal entry is M's own). */
    private class World(
        val manager: Person,
        val employee: Person,
        val teamId: UInt,
        val goalId: UInt,
        val feedbackId: UInt,
        val meetingId: UInt,
        val kpiId: UInt,
        val reviewId: UInt,
        val planId: UInt,
        val entryId: UInt,
    )

    private suspend fun ApplicationTestBuilder.world(): World {
        val manager = person("manager")
        val employee = person("employee")
        val teamId = TestServices.teams.create(Team("Squad-${manager.id}", manager.id, listOf(employee.id)))
        val goal = manager.client.post("/api/v1/goals") {
            contentType(ContentType.Application.Json)
            setBody(
                GoalCreateRequest(
                    subordinateId = employee.id,
                    title = "Activity goal ${manager.id}",
                    description = "private description",
                    type = GoalType.NUMBER,
                    targetValue = 10.0,
                    dueDate = LocalDate.now().plusDays(30).toString(),
                ),
            )
        }
        assertEquals(HttpStatusCode.Created, goal.status)
        val feedback = manager.client.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                FeedbackCreateRequest(
                    subjectId = employee.id,
                    providerId = manager.id,
                    visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                    status = FeedbackStatus.DRAFT,
                    content = "private feedback text",
                ),
            )
        }
        assertEquals(HttpStatusCode.Created, feedback.status)
        val meeting = manager.client.post("/api/v1/one-on-ones") {
            contentType(ContentType.Application.Json)
            setBody(OneOnOneCreateRequest(subordinateId = employee.id, meetingDate = "2026-07-01"))
        }
        assertEquals(HttpStatusCode.Created, meeting.status)
        val kpi = manager.client.post("/api/v1/team-kpis") {
            contentType(ContentType.Application.Json)
            setBody(
                TeamKpiCreateRequest(
                    teamId = teamId,
                    title = "Activity KPI ${manager.id}",
                    description = "private description",
                    type = TeamKpiType.NUMBER,
                    targetValue = 10.0,
                ),
            )
        }
        assertEquals(HttpStatusCode.Created, kpi.status)
        val period = TestReviewPeriods.append()
        val review = manager.client.post("/api/v1/performance-reviews") {
            contentType(ContentType.Application.Json)
            setBody(
                PerformanceReviewCreateRequest(
                    subordinateId = employee.id,
                    periodId = period.id,
                    attitude = CategoryAssessment(3, "private attitude summary"),
                ),
            )
        }
        assertEquals(HttpStatusCode.Created, review.status)
        val plan = manager.client.post("/api/v1/succession-plans") {
            contentType(ContentType.Application.Json)
            setBody(
                SuccessionPlanCreateRequest(
                    userId = employee.id,
                    roleCriticality = RoleCriticality.CRITICAL,
                    retentionRisk = RetentionRisk.HIGH,
                    lossImpact = listOf("private loss impact"),
                    targetBenchDepth = 2,
                ),
            )
        }
        assertEquals(HttpStatusCode.Created, plan.status)
        val entry = manager.client.post("/api/v1/impact-log") {
            contentType(ContentType.Application.Json)
            setBody(
                ImpactEntryRequest(
                    title = "Activity entry ${manager.id}",
                    periodStart = "2026-07-01",
                    periodEnd = "2026-07-31",
                    whatHappened = "private what",
                    contribution = "private contribution",
                    whyItMattered = "private why",
                    evidence = "private evidence",
                ),
            )
        }
        assertEquals(HttpStatusCode.Created, entry.status)
        return World(
            manager, employee, teamId,
            goalId = goal.body<GoalResponse>().id,
            feedbackId = feedback.body<FeedbackResponse>().id,
            meetingId = meeting.body<OneOnOneResponse>().id,
            kpiId = kpi.body<TeamKpiResponse>().id,
            reviewId = review.body<PerformanceReviewResponse>().id,
            planId = plan.body<SuccessionPlanResponse>().id,
            entryId = entry.body<ImpactEntryResponse>().id,
        )
    }

    /** The documented total order: `createdAt DESC, area, source, eventId DESC` (the synthetic id's parts). */
    private fun assertTotalOrder(items: List<ActivityEntry>) {
        val expected = items.sortedWith(
            compareByDescending<ActivityEntry> { it.createdAt }
                .thenBy { it.area.name }
                .thenBy { it.id.split(':')[1] }
                .thenByDescending { it.id.split(':')[2].toLong() },
        )
        assertEquals(expected.map { it.id }, items.map { it.id }, "rows must follow the documented total order")
    }

    // ——— the access matrix ———

    @Test
    fun `self sees own rows across the seven areas with labels and links`() = testApplication {
        usePostgresTestcontainer()
        val w = world()
        val page = w.manager.client.page(w.manager.id, "pageSize=100")

        assertEquals(page.items.size.toLong(), page.total)
        assertEquals(
            setOf(
                ActivityArea.FEEDBACK, ActivityArea.ONE_ON_ONE, ActivityArea.GOAL, ActivityArea.TEAM_KPI,
                ActivityArea.PERFORMANCE_REVIEW, ActivityArea.IMPACT_LOG_ENTRY, ActivityArea.SUCCESSION_PLAN,
            ),
            page.items.map { it.area }.toSet(),
        )
        assertTotalOrder(page.items)
        assertTrue(page.items.all { it.id.matches(Regex("[A-Z_]+:EVENT:\\d+")) }, "synthetic ids: ${page.items.map { it.id }}")
        assertEquals(page.items.size, page.items.map { it.id }.toSet().size)

        fun row(area: ActivityArea) = page.items.first { it.area == area && it.eventType == "CREATED" }
        val goal = row(ActivityArea.GOAL)
        assertEquals(w.goalId, goal.documentId)
        assertEquals("/goals/${w.goalId}/view", goal.link)
        assertEquals("Activity goal ${w.manager.id}", goal.details?.get("title"))
        assertEquals(w.employee.name, goal.details?.get("subordinate"))
        assertEquals(
            mapOf("title" to "Activity KPI ${w.manager.id}", "team" to "Squad-${w.manager.id}", "type" to "NUMBER"),
            row(ActivityArea.TEAM_KPI).details,
        )
        assertEquals(
            mapOf("provider" to w.manager.name, "subjects" to w.employee.name),
            row(ActivityArea.FEEDBACK).details,
        )
        assertEquals(
            mapOf("manager" to w.manager.name, "subordinate" to w.employee.name, "meetingDate" to "2026-07-01"),
            row(ActivityArea.ONE_ON_ONE).details,
        )
        assertEquals(w.employee.name, row(ActivityArea.PERFORMANCE_REVIEW).details?.get("subordinate"))
        assertEquals(setOf("subordinate", "startMonth", "endMonth"), row(ActivityArea.PERFORMANCE_REVIEW).details?.keys)
        assertEquals(
            mapOf("person" to w.employee.name, "owner" to w.manager.name),
            row(ActivityArea.SUCCESSION_PLAN).details,
        )
        assertEquals(
            mapOf(
                "title" to "Activity entry ${w.manager.id}", "author" to w.manager.name,
                "periodStart" to "2026-07-01", "periodEnd" to "2026-07-31",
            ),
            row(ActivityArea.IMPACT_LOG_ENTRY).details,
        )
        // Nothing of the documents' private content rides the log.
        val everything = page.items.joinToString { it.params.toString() + it.details.toString() }
        assertFalse("private" in everything, "content must never appear: $everything")
        // The employee authored nothing: an empty (not forbidden) log of their own.
        assertEquals(0L, w.employee.client.page(w.employee.id).total)
    }

    @Test
    fun `a deleted document keeps the self row but loses its details and link`() = testApplication {
        usePostgresTestcontainer()
        val w = world()
        assertEquals(HttpStatusCode.NoContent, w.manager.client.delete("/api/v1/goals/${w.goalId}").status)

        val rows = w.manager.client.page(w.manager.id, "area=GOAL&pageSize=100").items
        assertTrue(rows.any { it.eventType == "CREATED" } && rows.any { it.eventType == "DELETED" }, "$rows")
        rows.forEach {
            assertEquals(w.goalId, it.documentId)
            assertNull(it.details, "the viewer cannot read the deleted goal in their own right")
            assertNull(it.link)
        }

        // The HR auditor still gets the label and the (404ing) link.
        val hr = person("hr", roles = setOf(UserRole.HR))
        val hrRows = hr.client.page(w.manager.id, "area=GOAL&pageSize=100").items
        assertEquals(rows.map { it.id }, hrRows.map { it.id })
        hrRows.forEach {
            assertEquals("Activity goal ${w.manager.id}", it.details?.get("title"))
            assertEquals("/goals/${w.goalId}/view", it.link)
        }
    }

    @Test
    fun `a document that stops being readable in the viewer's own right loses details and link, others keep them`() =
        testApplication {
            usePostgresTestcontainer()
            val w = world()
            // A KPI member (E) reads the KPI only once it has left DRAFT: E records a value while ACTIVE…
            assertEquals(HttpStatusCode.NoContent, w.manager.client.post("/api/v1/team-kpis/${w.kpiId}/activate").status)
            val recorded = w.employee.client.post("/api/v1/team-kpis/${w.kpiId}/values") {
                contentType(ContentType.Application.Json)
                setBody(ch.nokillswit.teamkpis.TeamKpiValueWrite(date = LocalDate.now().toString(), value = 3.0))
            }
            assertEquals(HttpStatusCode.Created, recorded.status)
            val readable = w.employee.client.page(w.employee.id, "area=TEAM_KPI").items
            assertTrue(readable.isNotEmpty())
            assertTrue(readable.all { it.details != null && it.link == "/team-kpis/${w.kpiId}/view" }, "$readable")

            // …then the manager sends it back to DRAFT: the member's rows stay (they acted), the label goes.
            assertEquals(HttpStatusCode.NoContent, w.manager.client.post("/api/v1/team-kpis/${w.kpiId}/deactivate").status)
            val hidden = w.employee.client.page(w.employee.id, "area=TEAM_KPI").items
            assertEquals(readable.size, hidden.size)
            assertTrue(hidden.all { it.details == null && it.link == null }, "$hidden")
            // The manager's own rows on the same KPI keep their labels (the current manager reads every status).
            assertTrue(w.manager.client.page(w.manager.id, "area=TEAM_KPI").items.all { it.details != null })
        }

    @Test
    fun `HR reads anyone's log with labels, audited as hr_list, and its own log as plain self access`() = testApplication {
        usePostgresTestcontainer()
        val w = world()
        val hr = person("hr", roles = setOf(UserRole.HR))
        val appender = LogCapture("ch.nokillswit.audit")
        try {
            val page = hr.client.page(w.manager.id, "pageSize=100")
            assertTrue(page.items.isNotEmpty())
            assertTrue(page.items.all { it.details != null && it.link != null })
            val event = appender.events.last {
                it.message == "hr.list" && it.hasKeyValue("resource", "activity")
            }
            assertEquals(hr.id.toLong(), event.keyValuePairs.first { it.key == "byUserId" }.value)
            assertEquals(w.manager.id.toLong(), event.keyValuePairs.first { it.key == "targetUserId" }.value)
            assertTrue(event.keyValuePairs.none { it.key == "area" })

            // A pinned area rides the event.
            hr.client.page(w.manager.id, "area=GOAL")
            val pinned = appender.events.last { it.message == "hr.list" && it.hasKeyValue("resource", "activity") }
            assertTrue(pinned.hasKeyValue("area", "GOAL"))

            // HR's OWN log: self access, no audit event, and nothing is readable-projected away.
            val before = appender.events.count { it.message == "hr.list" && it.hasKeyValue("resource", "activity") }
            assertEquals(HttpStatusCode.OK, hr.client.activity(hr.id).status)
            assertEquals(before, appender.events.count { it.message == "hr.list" && it.hasKeyValue("resource", "activity") })
        } finally {
            appender.detach()
        }
    }

    @Test
    fun `peers, ADMIN and (until step 2) chain managers are forbidden`() = testApplication {
        usePostgresTestcontainer()
        val w = world()
        val peer = person("peer")
        val admin = person("admin", roles = setOf(UserRole.ADMIN))
        assertEquals(HttpStatusCode.Forbidden, peer.client.activity(w.manager.id).status)
        assertEquals(HttpStatusCode.Forbidden, admin.client.activity(w.manager.id).status)
        // The employee is a SUBORDINATE of the author, never a viewer of the manager's log; and the
        // manager (the employee's chain) does not yet read the employee's log — step 2 adds that branch.
        assertEquals(HttpStatusCode.Forbidden, w.employee.client.activity(w.manager.id).status)
        assertEquals(HttpStatusCode.Forbidden, w.manager.client.activity(w.employee.id).status)
        val problem = peer.client.activity(w.manager.id).body<ProblemDetail>()
        assertEquals(403, problem.status)
    }

    @Test
    fun `unknown and soft-deleted targets are 404, a deactivated target is readable`() = testApplication {
        usePostgresTestcontainer()
        val hr = person("hr", roles = setOf(UserRole.HR))
        val target = person("target")
        assertEquals(HttpStatusCode.NotFound, hr.client.activity(2_000_000_000u).status)

        TestServices.users.setDeactivated(target.id, true)
        assertEquals(HttpStatusCode.OK, hr.client.activity(target.id).status)

        TestServices.users.delete(target.id)
        assertEquals(HttpStatusCode.NotFound, hr.client.activity(target.id).status)
        // 404 before 403: a peer probing a missing user learns nothing more than HR does.
        val peer = person("peer")
        assertEquals(HttpStatusCode.NotFound, peer.client.activity(target.id).status)
    }

    // ——— paging, order, filters ———

    @Test
    fun `two pages share one total, never repeat a row and follow the documented order`() = testApplication {
        usePostgresTestcontainer()
        val w = world()
        val all = w.manager.client.page(w.manager.id, "pageSize=100")
        assertTrue(all.total >= 7)
        val first = w.manager.client.page(w.manager.id, "pageSize=4&page=1")
        val second = w.manager.client.page(w.manager.id, "pageSize=4&page=2")
        assertEquals(all.total, first.total)
        assertEquals(all.total, second.total)
        assertEquals(4, first.items.size)
        val paged = first.items + second.items
        assertEquals(paged.size, paged.map { it.id }.toSet().size, "no duplicates across pages")
        assertEquals(all.items.take(8).map { it.id }, paged.map { it.id })
        assertTotalOrder(all.items)
        // Ascending sort is the exact reverse of the default order.
        val ascending = w.manager.client.page(w.manager.id, "pageSize=100&sort=createdAt")
        assertEquals(all.items.map { it.id }.reversed(), ascending.items.map { it.id }, "ascending reverses the whole order")
        // Past the last page: empty items, the same total.
        val beyond = w.manager.client.page(w.manager.id, "pageSize=100&page=2")
        assertTrue(beyond.items.isEmpty())
        assertEquals(all.total, beyond.total)
    }

    /** Raw event rows with chosen timestamps, authored by [actor] on documents that already exist. */
    private suspend fun insertEvent(table: EventLogTable, ownerId: UInt, actor: UInt, at: Long, type: String = "CREATED") =
        suspendTransaction(TestServices.database) {
            table.insert {
                it[table.ownerId] = ownerId
                it[table.userId] = actor
                it[table.timestamp] = at
                it[table.eventType] = type
                it[table.params] = "{}"
            }[table.id].value
        }

    @Test
    fun `identical timestamps order by area, source, then event id descending, and the time bounds are inclusive`() =
        testApplication {
            usePostgresTestcontainer()
            val w = world()
            val actor = person("ghost")
            val t = 4_100_000_000_000L
            val g1 = insertEvent(GoalEvents, w.goalId, actor.id, t)
            val g2 = insertEvent(GoalEvents, w.goalId, actor.id, t)
            val f1 = insertEvent(FeedbackEvents, w.feedbackId, actor.id, t)
            val earlier = insertEvent(GoalEvents, w.goalId, actor.id, t - 1000)
            val hr = person("hr", roles = setOf(UserRole.HR))

            val page = hr.client.page(actor.id, "pageSize=100")
            assertEquals(
                listOf("FEEDBACK:EVENT:$f1", "GOAL:EVENT:$g2", "GOAL:EVENT:$g1", "GOAL:EVENT:$earlier"),
                page.items.map { it.id },
            )

            // Inclusive bounds on both sides.
            assertEquals(3L, hr.client.page(actor.id, "createdAt[gte]=$t").total)
            assertEquals(1L, hr.client.page(actor.id, "createdAt[lte]=${t - 1000}").total)
            assertEquals(4L, hr.client.page(actor.id, "createdAt[gte]=${t - 1000}&createdAt[lte]=$t").total)
            assertEquals(0L, hr.client.page(actor.id, "createdAt[gte]=${t + 1}").total)
            // area filter: only that branch.
            assertEquals(listOf("FEEDBACK:EVENT:$f1"), hr.client.page(actor.id, "area=FEEDBACK").items.map { it.id })
            // An area that produces no rows yet is an empty page, not an error.
            assertEquals(0L, hr.client.page(actor.id, "area=DAYS_OFF").total)
        }

    @Test
    fun `the viewer's disabled areas are left out of rows and total, and a pinned disabled area is an empty page`() =
        testApplication {
            usePostgresTestcontainer()
            val w = world()
            val withGoals = w.manager.client.page(w.manager.id, "pageSize=100")
            assertTrue(withGoals.items.any { it.area == ActivityArea.GOAL })
            val noGoals = person("viewer", roles = setOf(UserRole.HR), disabled = setOf(Feature.GOALS))
            // The HR viewer has GOALS disabled: the same target's log loses every goal row.
            val page = noGoals.client.page(w.manager.id, "pageSize=100")
            assertTrue(page.items.none { it.area == ActivityArea.GOAL })
            assertEquals(withGoals.items.count { it.area != ActivityArea.GOAL }.toLong(), page.total)
            val pinned = noGoals.client.page(w.manager.id, "area=GOAL")
            assertEquals(0L, pinned.total)
            assertTrue(pinned.items.isEmpty())
        }

    @Test
    fun `malformed parameters are 400, and shape errors precede the 404 and the role gate`() = testApplication {
        usePostgresTestcontainer()
        val w = world()
        val peer = person("peer")
        val hr = person("hr", roles = setOf(UserRole.HR))
        for (bad in listOf(
            "area=NOPE", "sort=title", "sort=-id", "page=0", "pageSize=101",
            "createdAt[gte]=abc", "createdAt[lte]=x",
            "createdAt[gte]=200&createdAt[lte]=100",
            "area=GOAL&area=FEEDBACK",
        )) {
            assertEquals(HttpStatusCode.BadRequest, hr.client.activity(w.manager.id, bad).status, bad)
            // A peer would be 403 — but a malformed request is a 400 for everyone (no role oracle)…
            assertEquals(HttpStatusCode.BadRequest, peer.client.activity(w.manager.id, bad).status, bad)
            // …and before the existence lookup too.
            assertEquals(HttpStatusCode.BadRequest, peer.client.activity(2_000_000_000u, bad).status, bad)
        }
        assertNotNull(hr.client.page(w.manager.id, "createdAt[gte]=100&createdAt[lte]=100"))
    }
}
