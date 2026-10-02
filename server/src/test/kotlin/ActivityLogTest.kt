package ch.nokillswit

import ch.nokillswit.activity.ActivityArea
import ch.nokillswit.activity.ActivityEntry
import ch.nokillswit.activity.ActivityPage
import ch.nokillswit.daysoff.DaysOffCreateRequest
import ch.nokillswit.daysoff.DaysOffResponse
import ch.nokillswit.daysoff.DaysOffType
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
import ch.nokillswit.sharing.ShareRequest
import ch.nokillswit.sharing.ShareResponse
import ch.nokillswit.sharing.ShareableResourceType
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
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.r2dbc.insert
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import org.jetbrains.exposed.v1.r2dbc.update
import java.time.LocalDate
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * `GET /api/v1/users/{id}/activity` (v4.9.0: the seven document event trails; self, HR and chain
 * viewers). Everything here goes through the real routes — the log is a read model over the events
 * the feature routes mint, so seeding via the routes is also the proof that the union sees them.
 * The SQL-vs-guard agreement per area lives in `ActivityVisibilityParityTest`.
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

    /** GM manages M, M manages E; M authored one document of every area (a journal entry is M's own). */
    private class World(
        val grand: Person,
        val manager: Person,
        val employee: Person,
        val teamId: UInt,
        val leadsTeamId: UInt,
        val goalId: UInt,
        val feedbackId: UInt,
        val meetingId: UInt,
        val kpiId: UInt,
        val reviewId: UInt,
        val planId: UInt,
        val entryId: UInt,
    )

    private suspend fun ApplicationTestBuilder.world(grandRoles: Set<UserRole> = emptySet()): World {
        val manager = person("manager")
        val employee = person("employee")
        val grand = person("grand", roles = grandRoles)
        val teamId = TestServices.teams.create(Team("Squad-${manager.id}", manager.id, listOf(employee.id)))
        val leadsTeamId = TestServices.teams.create(Team("Leads-${grand.id}", grand.id, listOf(manager.id)))
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
        val period = TestReviewPeriods.append(months = 1)
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
            grand, manager, employee, teamId, leadsTeamId,
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
            page.items.docAreas(),
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
        // The employee authored nothing but signed in once (the setup login): a log of exactly that row.
        val employeeLog = w.employee.client.page(w.employee.id)
        assertEquals(1L, employeeLog.total)
        assertTrue(employeeLog.items.all { it.area == ActivityArea.ACCOUNT && it.eventType == "SIGNED_IN" })
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

    // ——— chain viewers: only documents they can read in their own right ———

    private fun List<ActivityEntry>.areas() = map { it.area }.toSet()

    /** The areas minus ACCOUNT: every test person's setup login mints a SIGNED_IN row (V90). */
    private fun List<ActivityEntry>.docAreas() = areas() - ActivityArea.ACCOUNT

    private fun List<ActivityEntry>.withoutAccount() = filter { it.area != ActivityArea.ACCOUNT }

    private val documentAreas = setOf(
        ActivityArea.FEEDBACK, ActivityArea.ONE_ON_ONE, ActivityArea.GOAL, ActivityArea.TEAM_KPI,
        ActivityArea.PERFORMANCE_REVIEW, ActivityArea.IMPACT_LOG_ENTRY, ActivityArea.SUCCESSION_PLAN,
    )

    @Test
    fun `a skip-level manager sees only readable documents, and a hidden row is neither listed nor counted`() =
        testApplication {
            usePostgresTestcontainer()
            val w = world()
            // M's log as GM sees it: the 1:1 (chain of its subordinate), the KPI (chain above the team's
            // manager, any status), the journal entry and the succession plan (owner's chain) — but NOT the
            // DRAFT goal, DRAFT review or DRAFT feedback, which stay private to their author pair.
            val before = w.grand.client.page(w.manager.id, "pageSize=100")
            assertEquals(
                setOf(
                    ActivityArea.ONE_ON_ONE, ActivityArea.TEAM_KPI, ActivityArea.IMPACT_LOG_ENTRY,
                    ActivityArea.SUCCESSION_PLAN,
                ),
                before.items.docAreas(),
            )
            assertEquals(before.items.size.toLong(), before.total, "hidden rows must not be counted")
            assertTrue(before.items.withoutAccount().all { it.details != null && it.link != null })
            // The direct report is not above M: M's own log is hers alone, and E cannot read it.
            assertEquals(HttpStatusCode.Forbidden, w.employee.client.activity(w.manager.id).status)

            // Out of DRAFT, the same documents appear — every earlier event of the document with them.
            assertEquals(HttpStatusCode.NoContent, w.manager.client.post("/api/v1/goals/${w.goalId}/activate").status)
            assertEquals(HttpStatusCode.NoContent, w.manager.client.post("/api/v1/feedbacks/${w.feedbackId}/send").status)
            setReviewStatus(w.reviewId, ch.nokillswit.reviews.PerformanceReviewStatus.CALIBRATION)
            val after = w.grand.client.page(w.manager.id, "pageSize=100")
            assertEquals(documentAreas, after.items.docAreas())
            assertEquals(after.items.size.toLong(), after.total)
            assertTrue(after.total > before.total)
            assertTrue(after.items.any { it.area == ActivityArea.GOAL && it.eventType == "CREATED" })
            assertTotalOrder(after.items)

            // Paging over the filtered union: one total, no duplicates, no gaps.
            val p1 = w.grand.client.page(w.manager.id, "pageSize=3&page=1")
            val p2 = w.grand.client.page(w.manager.id, "pageSize=3&page=2")
            assertEquals(after.total, p1.total)
            assertEquals(after.items.take(6).map { it.id }, (p1.items + p2.items).map { it.id })

            // The author pair keeps seeing their own drafts (M is the stored manager): M's own log is complete.
            assertEquals(after.total, w.manager.client.page(w.manager.id, "pageSize=100").total)
            // HR is not narrowed by any of this.
            val hr = person("hr", roles = setOf(UserRole.HR))
            assertEquals(after.total, hr.client.page(w.manager.id, "pageSize=100").total)
        }

    private suspend fun setReviewStatus(id: UInt, status: ch.nokillswit.reviews.PerformanceReviewStatus) =
        suspendTransaction(TestServices.database) {
            ch.nokillswit.reviews.PerformanceReviewService.Reviews.update(
                { ch.nokillswit.reviews.PerformanceReviewService.Reviews.id eq id },
            ) { it[ch.nokillswit.reviews.PerformanceReviewService.Reviews.status] = status }
        }

    @Test
    fun `a report's goal rows show to the chain only while the goal is out of DRAFT, and always to the author`() =
        testApplication {
            usePostgresTestcontainer()
            val w = world()
            assertEquals(HttpStatusCode.NoContent, w.manager.client.post("/api/v1/goals/${w.goalId}/activate").status)
            val progress = w.employee.client.put("/api/v1/goals/${w.goalId}/progress") {
                contentType(ContentType.Application.Json)
                setBody(ch.nokillswit.goals.GoalProgressUpdate(currentValue = 4.0))
            }
            assertEquals(HttpStatusCode.NoContent, progress.status)

            suspend fun goalRows(viewer: Person) = viewer.client.page(w.employee.id, "area=GOAL&pageSize=100").items
            assertTrue(goalRows(w.manager).isNotEmpty())
            val whileActive = goalRows(w.grand)
            assertEquals(goalRows(w.manager).map { it.id }, whileActive.map { it.id })
            assertTrue(whileActive.all { it.details?.get("title") == "Activity goal ${w.manager.id}" })

            // Back to DRAFT: the skip-level chain loses the goal (and its rows), the author pair does not.
            assertEquals(HttpStatusCode.NoContent, w.manager.client.post("/api/v1/goals/${w.goalId}/deactivate").status)
            assertTrue(goalRows(w.grand).isEmpty())
            assertEquals(0L, w.grand.client.page(w.employee.id, "area=GOAL").total)
            assertTrue(goalRows(w.manager).isNotEmpty())
        }

    @Test
    fun `feedback a report wrote about someone is hidden from the chain unless delivered into it or PUBLIC`() =
        testApplication {
            usePostgresTestcontainer()
            val w = world()
            val mate = person("mate")
            TestServices.teams.create(Team("Mates-${w.manager.id}", w.manager.id, listOf(mate.id)))
            val outsider = person("outsider")
            val otherOutsider = person("other-outsider")

            suspend fun write(subject: Person, visibility: FeedbackVisibility): UInt {
                val created = w.employee.client.post("/api/v1/feedbacks") {
                    contentType(ContentType.Application.Json)
                    setBody(
                        FeedbackCreateRequest(
                            subjectId = subject.id, providerId = w.employee.id,
                            visibility = visibility, status = FeedbackStatus.DRAFT, content = "text",
                        ),
                    )
                }
                assertEquals(HttpStatusCode.Created, created.status)
                return created.body<FeedbackResponse>().id
            }

            suspend fun send(id: UInt) =
                assertEquals(HttpStatusCode.NoContent, w.employee.client.post("/api/v1/feedbacks/$id/send").status)

            suspend fun visibleDocs() = w.manager.client.page(w.employee.id, "area=FEEDBACK&pageSize=100")
                .items.mapNotNull { it.documentId }.toSet()

            val toMate = write(mate, FeedbackVisibility.PROVIDER_SUBJECT)
            val toOutsider = write(outsider, FeedbackVisibility.PROVIDER_SUBJECT)
            val publicToOutsider = write(otherOutsider, FeedbackVisibility.PUBLIC)
            // Drafts are the provider's private work: nothing for the chain.
            assertEquals(emptySet(), visibleDocs())

            send(toMate)
            send(toOutsider)
            send(publicToOutsider)
            // Delivered to a recipient in M's chain → M may read it; delivered to someone outside it → no,
            // unless it is PUBLIC (everyone reads PUBLIC + SENT).
            assertEquals(setOf(toMate, publicToOutsider), visibleDocs())
            val total = w.manager.client.page(w.employee.id, "area=FEEDBACK").total
            assertEquals(visibleDocs().size.toLong() * 2, total, "CREATED + SENT per visible document")
        }

    @Test
    fun `impact entries, team KPIs and succession plans follow the owner-chain and manager-chain rules`() =
        testApplication {
            usePostgresTestcontainer()
            val w = world()
            // The journal entry is M's own: M's skip-level manager reads it, E (below) and a peer do not.
            val peer = person("peer")
            assertEquals(HttpStatusCode.Forbidden, peer.client.activity(w.manager.id).status)
            val gm = w.grand.client.page(w.manager.id, "area=IMPACT_LOG_ENTRY").items
            assertEquals(listOf(w.entryId), gm.map { it.documentId }.distinct())
            assertEquals(
                listOf(w.planId),
                w.grand.client.page(w.manager.id, "area=SUCCESSION_PLAN").items.map { it.documentId }.distinct(),
            )
            // KPI of M's team: the chain above the team's manager reads every status — DRAFT included.
            assertEquals(
                listOf(w.kpiId),
                w.grand.client.page(w.manager.id, "area=TEAM_KPI").items.map { it.documentId }.distinct(),
            )
        }

    @Test
    fun `an HR user who is also in the target's chain gets the HR grant - drafts visible and hr_list emitted`() =
        testApplication {
            usePostgresTestcontainer()
            // GM manages M AND holds the HR role: self → HR → chain, so HR wins (before the chain walk).
            val w = world(grandRoles = setOf(UserRole.HR))
            val hrGrand = w.grand.client
            val appender = LogCapture("ch.nokillswit.audit")
            try {
                val page = hrGrand.page(w.manager.id, "pageSize=100")
                // A pure chain viewer would not see the DRAFT goal/review/feedback; the HR grant does.
                assertEquals(documentAreas, page.items.docAreas())
                val event = appender.events.last { it.message == "hr.list" && it.hasKeyValue("resource", "activity") }
                assertEquals(w.grand.id.toLong(), event.keyValuePairs.first { it.key == "byUserId" }.value)
                assertEquals(w.manager.id.toLong(), event.keyValuePairs.first { it.key == "targetUserId" }.value)
            } finally {
                appender.detach()
            }
        }

    // ——— share rows ———

    private suspend fun HttpClient.shareDocument(type: ShareableResourceType, id: UInt, sharee: UInt, expiresOn: String? = null) =
        post("/api/v1/shares") {
            contentType(ContentType.Application.Json)
            setBody(ShareRequest(type, id, sharee, expiresOn))
        }.also { assertEquals(HttpStatusCode.Created, it.status) }.body<ShareResponse>()

    private suspend fun HttpClient.withdrawShare(id: UInt) =
        assertEquals(HttpStatusCode.NoContent, post("/api/v1/shares/$id/withdraw").status)

    private fun List<ActivityEntry>.shareRows() = filter { it.eventType.startsWith("SHARE_") }

    @Test
    fun `a sharer's own created and withdrawn shares are rows of their log with the stored snapshot`() = testApplication {
        usePostgresTestcontainer()
        val w = world()
        val sharee = person("sharee")
        val expires = LocalDate.now().plusDays(10).toString()
        val share = w.manager.client.shareDocument(ShareableResourceType.GOAL, w.goalId, sharee.id, expires)
        kotlinx.coroutines.delay(5) // the withdrawal must be dated strictly after the creation
        w.manager.client.withdrawShare(share.id)

        val rows = w.manager.client.page(w.manager.id, "area=GOAL&pageSize=100").items.shareRows()
        assertEquals(setOf("SHARE_CREATED", "SHARE_WITHDRAWN"), rows.map { it.eventType }.toSet())
        val created = rows.first { it.eventType == "SHARE_CREATED" }
        val withdrawn = rows.first { it.eventType == "SHARE_WITHDRAWN" }
        assertEquals("GOAL:SHARE:${share.id}", created.id)
        assertEquals("GOAL:SHARE_WITHDRAWAL:${share.id}", withdrawn.id)
        assertEquals(mapOf("sharee" to sharee.name, "expiresOn" to expires), created.params)
        assertEquals(mapOf("sharee" to sharee.name, "expiresOn" to expires), withdrawn.params, "withdrawn by the sharer: no byAuthor")
        assertEquals(w.goalId, created.documentId)
        assertEquals("/goals/${w.goalId}/view", created.link)
        assertEquals(share.details, created.details, "the stored creation-time snapshot, never a live lookup")
        assertEquals(share.createdAt, created.createdAt)
        // Newest first: the withdrawal row precedes the creation row.
        val order = w.manager.client.page(w.manager.id, "area=GOAL&pageSize=100").items.map { it.id }
        assertTrue(order.indexOf(withdrawn.id) < order.indexOf(created.id))
        assertTotalOrder(w.manager.client.page(w.manager.id, "pageSize=100").items)
        // The sharee's own log has nothing (actor-only).
        val shareeLog = sharee.client.page(sharee.id)
        assertEquals(1L, shareeLog.total)
        assertTrue(shareeLog.items.all { it.area == ActivityArea.ACCOUNT })

        // A lower bound between the creation and the withdrawal keeps the withdrawal row only, which is
        // dated the share's withdrawal moment (not its creation).
        val stored = w.manager.client.get("/api/v1/shares/${share.id}").body<ShareResponse>()
        val withdrawnAt = checkNotNull(stored.withdrawnAt)
        assertTrue(withdrawnAt > share.createdAt, "the withdrawal must postdate the creation for this bound")
        val bounded = w.manager.client.page(w.manager.id, "area=GOAL&createdAt[gte]=$withdrawnAt&pageSize=100")
            .items.shareRows()
        assertEquals(listOf("GOAL:SHARE_WITHDRAWAL:${share.id}"), bounded.map { it.id })
        assertEquals(withdrawnAt, bounded.single().createdAt)
        val upTo = w.manager.client.page(w.manager.id, "area=GOAL&createdAt[lte]=${withdrawnAt - 1}&pageSize=100")
            .items.shareRows()
        assertEquals(listOf("GOAL:SHARE:${share.id}"), upTo.map { it.id })
    }

    @Test
    fun `an author withdrawing a report's share has the row in their own log, with byAuthor and the sharer`() =
        testApplication {
            usePostgresTestcontainer()
            val w = world()
            val sharee = person("sharee")
            // E reads the goal as its subordinate, so may share it; M is its author and may withdraw any share.
            val share = w.employee.client.shareDocument(ShareableResourceType.GOAL, w.goalId, sharee.id)
            w.manager.client.withdrawShare(share.id)

            val managerRows = w.manager.client.page(w.manager.id, "area=GOAL&pageSize=100").items.shareRows()
            val withdrawal = managerRows.single()
            assertEquals("SHARE_WITHDRAWN", withdrawal.eventType)
            assertEquals(
                mapOf("sharee" to sharee.name, "byAuthor" to "true", "sharer" to w.employee.name),
                withdrawal.params,
            )
            // E's log holds only the creation: the withdrawal is the AUTHOR's act.
            val employeeRows = w.employee.client.page(w.employee.id, "area=GOAL&pageSize=100").items.shareRows()
            assertEquals(listOf("SHARE_CREATED"), employeeRows.map { it.eventType })
            // M authors the goal and is E's manager: M reads E's creation row; GM (chain, NOT the author) does not.
            assertEquals(
                listOf("SHARE_CREATED"),
                w.manager.client.page(w.employee.id, "area=GOAL&pageSize=100").items.shareRows().map { it.eventType },
            )
            assertTrue(w.grand.client.page(w.employee.id, "area=GOAL&pageSize=100").items.shareRows().isEmpty())
            // HR sees every share row of both logs (decision 2).
            val hr = person("hr", roles = setOf(UserRole.HR))
            assertEquals(1, hr.client.page(w.employee.id, "area=GOAL&pageSize=100").items.shareRows().size)
            assertEquals(1, hr.client.page(w.manager.id, "area=GOAL&pageSize=100").items.shareRows().size)
        }

    @Test
    fun `a chain manager who does not author the document never sees the report's share rows`() = testApplication {
        usePostgresTestcontainer()
        val w = world()
        val sharee = person("sharee")
        // E owns an impact entry: only E authors it, so M (E's manager) reads its events but not its shares.
        val entry = w.employee.client.post("/api/v1/impact-log") {
            contentType(ContentType.Application.Json)
            setBody(
                ImpactEntryRequest(
                    title = "E journal", periodStart = "2026-07-01", periodEnd = "2026-07-31",
                    whatHappened = "a", contribution = "b", whyItMattered = "c", evidence = "d",
                ),
            )
        }
        assertEquals(HttpStatusCode.Created, entry.status)
        val entryId = entry.body<ImpactEntryResponse>().id
        w.employee.client.shareDocument(ShareableResourceType.IMPACT_LOG_ENTRY, entryId, sharee.id)

        val viaManager = w.manager.client.page(w.employee.id, "area=IMPACT_LOG_ENTRY&pageSize=100").items
        assertTrue(viaManager.isNotEmpty() && viaManager.any { it.eventType == "CREATED" }, "the entry's events are readable by the chain")
        assertTrue(viaManager.shareRows().isEmpty())
        val own = w.employee.client.page(w.employee.id, "area=IMPACT_LOG_ENTRY&pageSize=100").items
        assertEquals(1, own.shareRows().size)
        assertEquals("E journal", own.shareRows().single().details?.get("title"))
    }

    @Test
    fun `the viewer's disabled area hides that type's share rows, totals stay consistent over pages`() = testApplication {
        usePostgresTestcontainer()
        val w = world()
        val sharee = person("sharee")
        val goalShare = w.manager.client.shareDocument(ShareableResourceType.GOAL, w.goalId, sharee.id)
        w.manager.client.withdrawShare(goalShare.id)
        w.manager.client.shareDocument(ShareableResourceType.IMPACT_LOG_ENTRY, w.entryId, sharee.id)

        val all = w.manager.client.page(w.manager.id, "pageSize=100")
        assertEquals(3, all.items.shareRows().size)
        assertEquals(all.items.size.toLong(), all.total)
        val p1 = w.manager.client.page(w.manager.id, "pageSize=4&page=1")
        val p2 = w.manager.client.page(w.manager.id, "pageSize=4&page=2")
        assertEquals(all.total, p1.total)
        assertEquals(all.items.take(8).map { it.id }, (p1.items + p2.items).map { it.id })

        val noGoals = person("viewer", roles = setOf(UserRole.HR), disabled = setOf(Feature.GOALS))
        val hrRows = noGoals.client.page(w.manager.id, "pageSize=100")
        assertTrue(hrRows.items.none { it.area == ActivityArea.GOAL })
        assertEquals(1, hrRows.items.shareRows().size, "only the impact-log share remains")
        assertEquals(0L, noGoals.client.page(w.manager.id, "area=GOAL").total)
    }

    // ——— days-off rows (person-scoped, V88) ———

    private suspend fun HttpClient.recordLeave(date: String, forUser: UInt? = null): DaysOffResponse =
        post("/api/v1/days-off") {
            contentType(ContentType.Application.Json)
            setBody(DaysOffCreateRequest(DaysOffType.UNPAID, date, date, userId = forUser))
        }.also { assertEquals(HttpStatusCode.Created, it.status) }.body()

    /** A Monday of 2085 (weekends cost nothing — a zero-cost entry is a 400). */
    private fun monday(month: Int): String =
        LocalDate.of(2085, month, 1)
            .with(java.time.temporal.TemporalAdjusters.firstInMonth(java.time.DayOfWeek.MONDAY))
            .toString()

    private fun List<ActivityEntry>.leaveRows() = filter { it.area == ActivityArea.DAYS_OFF }

    @Test
    fun `a manager recording leave for a report has the row in the MANAGER's log, naming the report`() = testApplication {
        usePostgresTestcontainer()
        val w = world()
        val entry = w.manager.client.recordLeave(monday(3), forUser = w.employee.id)
        val own = w.employee.client.recordLeave(monday(4))

        val managerRows = w.manager.client.page(w.manager.id, "area=DAYS_OFF&pageSize=100").items
        val row = managerRows.single()
        assertEquals("ENTRY_RECORDED", row.eventType)
        assertEquals(w.employee.id, row.subjectUserId)
        assertEquals(w.employee.name, row.subjectUserName)
        assertEquals("true", row.params["onBehalf"])
        assertEquals(entry.id.toString(), row.params["requestId"])
        assertEquals(monday(3), row.params["startDate"])
        // Person-scoped: no document, link or label — the params are self-describing.
        assertNull(row.documentId)
        assertNull(row.link)
        assertNull(row.details)
        // The employee's own log holds only their self-create (the actor's record), flagged not on behalf.
        val employeeRow = w.employee.client.page(w.employee.id, "area=DAYS_OFF").items.single()
        assertEquals("false", employeeRow.params["onBehalf"])
        assertEquals(own.id.toString(), employeeRow.params["requestId"])
        assertEquals(w.employee.id, employeeRow.subjectUserId)
        // The skip-level manager sees the manager's recording: its owner is in GM's chain.
        assertEquals(1, w.grand.client.page(w.manager.id, "area=DAYS_OFF").items.size)
        assertTotalOrder(w.manager.client.page(w.manager.id, "pageSize=100").items)
        // HR sees it too (and the pager totals agree).
        val hr = person("hr", roles = setOf(UserRole.HR))
        assertEquals(1L, hr.client.page(w.manager.id, "area=DAYS_OFF").total)
    }

    @Test
    fun `a chain viewer sees leave rows only for owners in their chain, soft-deleted entries included`() = testApplication {
        usePostgresTestcontainer()
        val w = world()
        val gone = person("moved")
        val squad2 = TestServices.teams.create(Team("Squad2-${w.manager.id}", w.manager.id, listOf(gone.id)))
        val goneEntry = w.manager.client.recordLeave(monday(5), forUser = gone.id)
        val kept = w.manager.client.recordLeave(monday(6), forUser = w.employee.id)
        // A deleted entry's events stay listed — the deletion is the point.
        assertEquals(HttpStatusCode.NoContent, w.manager.client.delete("/api/v1/days-off/${goneEntry.id}").status)
        assertEquals(HttpStatusCode.NoContent, w.manager.client.delete("/api/v1/days-off/${kept.id}").status)
        val afterDelete = w.grand.client.page(w.manager.id, "area=DAYS_OFF&pageSize=100").items
        assertEquals(4, afterDelete.size)
        assertEquals(setOf("ENTRY_RECORDED", "ENTRY_DELETED"), afterDelete.map { it.eventType }.toSet())
        assertTotalOrder(afterDelete)

        // The first entry's owner leaves M's team (and so GM's subtree): GM no longer sees that person's
        // rows; M (self mode) still sees every one.
        TestServices.teams.delete(squad2)
        val viaGrand = w.grand.client.page(w.manager.id, "area=DAYS_OFF&pageSize=100")
        assertEquals(2L, viaGrand.total)
        assertEquals(setOf(w.employee.id), viaGrand.items.map { it.subjectUserId }.toSet())
        assertEquals(4L, w.manager.client.page(w.manager.id, "area=DAYS_OFF").total)
    }

    @Test
    fun `a viewer with DAYS_OFF disabled sees no leave rows and a pinned DAYS_OFF area is an empty page`() = testApplication {
        usePostgresTestcontainer()
        val w = world()
        w.manager.client.recordLeave(monday(8), forUser = w.employee.id)
        val hr = person("hr", roles = setOf(UserRole.HR), disabled = setOf(Feature.DAYS_OFF))
        val page = hr.client.page(w.manager.id, "pageSize=100")
        assertTrue(page.items.leaveRows().isEmpty())
        assertEquals(0L, hr.client.page(w.manager.id, "area=DAYS_OFF").total)
        assertTrue(hr.client.page(w.manager.id, "area=DAYS_OFF").items.isEmpty())
    }

    // ——— career-position rows (person-scoped, V89) ———

    private suspend fun HttpClient.recordPosition(userId: UInt, start: String, path: UInt, spec: UInt, level: UInt) =
        post("/api/v1/users/$userId/career-positions") {
            contentType(ContentType.Application.Json)
            setBody(ch.nokillswit.users.CareerPositionWrite(start, path, spec, level))
        }.also { assertEquals(HttpStatusCode.Created, it.status) }
            .body<ch.nokillswit.users.CareerPositionResponse>()

    private suspend fun careerRefs(marker: String): Triple<UInt, UInt, UInt> {
        val (path) = TestDictionaries.append(ch.nokillswit.dictionaries.Dictionary.CAREER_PATH, "ActPath $marker")
        val (spec) = TestDictionaries.append(ch.nokillswit.dictionaries.Dictionary.CAREER_SPECIALIZATION, "ActSpec $marker")
        val (level) = TestDictionaries.append(ch.nokillswit.dictionaries.Dictionary.SENIORITY_LEVEL, "ActLevel $marker")
        return Triple(path, spec, level)
    }

    @Test
    fun `a manager recording a career position has the row in the MANAGER's log, naming the report, ungated`() =
        testApplication {
            usePostgresTestcontainer()
            val w = world()
            val (path, spec, level) = careerRefs(UUID.randomUUID().toString().take(8))
            val position = w.manager.client.recordPosition(w.employee.id, "2019-02-01", path, spec, level)

            val row = w.manager.client.page(w.manager.id, "area=CAREER_POSITION&pageSize=100").items.single()
            assertEquals("POSITION_CREATED", row.eventType)
            assertEquals(w.employee.id, row.subjectUserId)
            assertEquals(w.employee.name, row.subjectUserName)
            assertEquals(position.id.toString(), row.params["positionId"])
            assertTrue(row.params["seniorityLevelName"]!!.startsWith("ActLevel"))
            assertNull(row.documentId)
            assertNull(row.link)
            assertNull(row.details)
            // The report did not act: nothing in their own log. The skip-level manager and HR see the row.
            assertEquals(0L, w.employee.client.page(w.employee.id, "area=CAREER_POSITION").total)
            assertEquals(1L, w.grand.client.page(w.manager.id, "area=CAREER_POSITION").total)
            val hr = person("hr", roles = setOf(UserRole.HR))
            assertEquals(1L, hr.client.page(w.manager.id, "area=CAREER_POSITION").total)
            // A peer is forbidden outright, an outsider-to-the-owner chain viewer loses the row once the owner leaves.
            assertEquals(HttpStatusCode.Forbidden, person("peer").client.activity(w.manager.id).status)
            TestServices.teams.delete(w.teamId)
            assertEquals(0L, w.grand.client.page(w.manager.id, "area=CAREER_POSITION").total)
            assertEquals(1L, w.manager.client.page(w.manager.id, "area=CAREER_POSITION").total)
            // CAREER_POSITION is ungated: a viewer with every feature disabled still lists it.
            val gated = person(
                "gated", roles = setOf(UserRole.HR),
                disabled = Feature.entries.filter { it !in OPT_IN_FEATURES }.toSet(),
            )
            assertEquals(1L, gated.client.page(w.manager.id, "area=CAREER_POSITION").total)
            assertTrue(
                gated.client.page(w.manager.id, "pageSize=100").items
                    .all { it.area == ActivityArea.CAREER_POSITION || it.area == ActivityArea.ACCOUNT },
            )
        }

    // ——— sign-in rows (ACCOUNT, V90) ———

    @Test
    fun `sign-ins and sign-outs are rows of the account's own log, visible to self, chain and HR, ungated`() =
        testApplication {
            usePostgresTestcontainer()
            val w = world() // every person's setup login minted a SIGNED_IN row
            val tokens = jsonClient().post("/api/v1/login") {
                contentType(ContentType.Application.Json)
                setBody(ch.nokillswit.auth.LoginRequest(w.employee.email, password))
            }.body<ch.nokillswit.auth.LoginResponse>()
            // Log out THIS session only (its own bearer) — the person's setup client stays valid for reading.
            assertEquals(
                HttpStatusCode.NoContent,
                jsonClient().post("/api/v1/logout") {
                    header(io.ktor.http.HttpHeaders.Authorization, "Bearer ${tokens.token}")
                }.status,
            )

            val own = w.employee.client.page(w.employee.id, "area=ACCOUNT&pageSize=100").items
            assertEquals(listOf("SIGNED_OUT", "SIGNED_IN", "SIGNED_IN"), own.map { it.eventType })
            own.forEach {
                assertEquals(ActivityArea.ACCOUNT, it.area)
                assertNull(it.documentId)
                assertNull(it.link)
                assertNull(it.details)
                assertNull(it.subjectUserId)
                assertTrue(it.id.matches(Regex("ACCOUNT:EVENT:\\d+")))
            }
            assertEquals(mapOf("mfa" to "false"), own.first { it.eventType == "SIGNED_IN" }.params)
            assertTrue(own.first { it.eventType == "SIGNED_OUT" }.params.isEmpty())
            // The manager and the skip-level manager (chain) and HR see the report's sign-ins; a peer is 403.
            assertEquals(3L, w.manager.client.page(w.employee.id, "area=ACCOUNT").total)
            assertEquals(3L, w.grand.client.page(w.employee.id, "area=ACCOUNT").total)
            val hr = person("hr", roles = setOf(UserRole.HR))
            assertEquals(3L, hr.client.page(w.employee.id, "area=ACCOUNT").total)
            assertEquals(HttpStatusCode.Forbidden, person("peer").client.activity(w.employee.id).status)
            // Ungated: a viewer with every feature disabled still lists them.
            val gated = person(
                "gated", roles = setOf(UserRole.HR),
                disabled = Feature.entries.filter { it !in OPT_IN_FEATURES }.toSet(),
            )
            assertEquals(3L, gated.client.page(w.employee.id, "area=ACCOUNT").total)
        }

    @Test
    fun `a manager who left the chain is forbidden`() = testApplication {
        usePostgresTestcontainer()
        val w = world()
        assertEquals(HttpStatusCode.OK, w.grand.client.activity(w.manager.id).status)
        TestServices.teams.delete(w.leadsTeamId)
        assertEquals(HttpStatusCode.Forbidden, w.grand.client.activity(w.manager.id).status)
        // The direct chain is untouched.
        assertEquals(HttpStatusCode.OK, w.manager.client.activity(w.employee.id).status)
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
            assertTrue(page.items.withoutAccount().all { it.details != null && it.link != null })
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
    fun `peers, ADMIN and a subordinate are forbidden, a chain manager is not`() = testApplication {
        usePostgresTestcontainer()
        val w = world()
        val peer = person("peer")
        val admin = person("admin", roles = setOf(UserRole.ADMIN))
        assertEquals(HttpStatusCode.Forbidden, peer.client.activity(w.manager.id).status)
        assertEquals(HttpStatusCode.Forbidden, admin.client.activity(w.manager.id).status)
        // A subordinate never reads the log of someone above them.
        assertEquals(HttpStatusCode.Forbidden, w.employee.client.activity(w.manager.id).status)
        // Managers read downwards: direct, and skip-level (transitive chain).
        assertEquals(HttpStatusCode.OK, w.manager.client.activity(w.employee.id).status)
        assertEquals(HttpStatusCode.OK, w.grand.client.activity(w.employee.id).status)
        assertEquals(HttpStatusCode.OK, w.grand.client.activity(w.manager.id).status)
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
                page.items.withoutAccount().map { it.id },
            )

            // Inclusive bounds on both sides.
            assertEquals(3L, hr.client.page(actor.id, "createdAt[gte]=$t").total)
            // (the actor's setup login — a sign-in row stamped "now" — also precedes t - 1000)
            assertEquals(2L, hr.client.page(actor.id, "createdAt[lte]=${t - 1000}").total)
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
