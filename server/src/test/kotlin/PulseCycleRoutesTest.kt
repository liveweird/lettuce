package ch.nokillswit

import ch.nokillswit.dashboard.DashboardSummary
import ch.nokillswit.notifications.NotificationPageResponse
import ch.nokillswit.notifications.NotificationType
import ch.nokillswit.pulse.PulseCycleCreateRequest
import ch.nokillswit.pulse.PulseCycleList
import ch.nokillswit.pulse.PulseCycleResponse
import ch.nokillswit.pulse.PulseCycleStatus
import ch.nokillswit.pulse.PulseCycleUpdateRequest
import ch.nokillswit.pulse.PulseParticipationCounts
import ch.nokillswit.pulse.PulseResponseSubmitRequest
import ch.nokillswit.pulse.PulseScaleAnswer
import ch.nokillswit.users.Feature
import ch.nokillswit.users.UserFeaturesUpdateRequest
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The pulse-cycle machine over the real routes: schedule/open/close/cancel with their
 * notifications and eligibility snapshot, the one-non-terminal-cycle 409, per-status date
 * edits, the ADMIN-only matrix, rotating-question visibility, the admin counts view, the
 * audit events, and the dashboard tile fields. The registry is GLOBAL shared state — every
 * test sweeps first and leaves it terminal.
 */
class PulseCycleRoutesTest {

    private val cyclesUrl = "/api/v1/pulse-surveys/cycles"

    private suspend fun HttpClient.schedule(open: String = "2099-01-01", close: String = "2099-01-08") =
        post(cyclesUrl) {
            contentType(ContentType.Application.Json)
            setBody(PulseCycleCreateRequest(plannedOpenDate = open, plannedCloseDate = close))
        }

    private fun answers(enps: Int) = PulseResponseSubmitRequest(
        enps = enps,
        q2 = PulseScaleAnswer.AGREE,
        q3 = PulseScaleAnswer.AGREE,
        q4 = PulseScaleAnswer.AGREE,
        q5 = PulseScaleAnswer.AGREE,
        rotating = PulseScaleAnswer.AGREE,
    )

    private suspend fun HttpClient.notificationTypes(): List<NotificationType> =
        get("/api/v1/notifications").body<NotificationPageResponse>().items.map { it.type }

    @Test
    fun `full lifecycle - schedule, open, close with notifications, visibility, and counts`() = testApplication {
        usePostgresTestcontainer()
        TestPulse.sweepNonTerminal()
        val adminEmail = uniqueEmail("pulse-admin")
        TestUsers.seed(adminEmail, "pw")
        val admin = authedClient(adminEmail, "pw")
        val participantEmail = uniqueEmail("pulse-participant")
        TestUsers.seed(participantEmail, "pw", roles = emptySet())
        val participant = authedClient(participantEmail, "pw")

        // Schedule: 201 + Location; the admin sees the picked question immediately.
        val created = admin.schedule()
        assertEquals(HttpStatusCode.Created, created.status)
        assertNotNull(created.headers[HttpHeaders.Location])
        val cycle = created.body<PulseCycleResponse>()
        assertEquals(PulseCycleStatus.SCHEDULED, cycle.status)
        assertNotNull(cycle.rotatingQuestion)
        try {
            // The eligible got a link-less heads-up.
            val scheduled = participant.get("/api/v1/notifications").body<NotificationPageResponse>()
                .items.first { it.type == NotificationType.PULSE_CYCLE_SCHEDULED }
            assertNull(scheduled.link)
            assertEquals("2099-01-01", scheduled.params["openDate"])

            // A non-admin sees no question and no counts while SCHEDULED.
            val listed = participant.get(cyclesUrl).body<PulseCycleList>().items.first { it.id == cycle.id }
            assertNull(listed.rotatingQuestion)
            assertNull(listed.participantCount)

            // Open: snapshot + linked notifications; the question becomes public; reopen is 409.
            assertEquals(HttpStatusCode.NoContent, admin.post("$cyclesUrl/${cycle.id}/open").status)
            assertEquals(HttpStatusCode.Conflict, admin.post("$cyclesUrl/${cycle.id}/open").status)
            val visible = participant.get("$cyclesUrl/${cycle.id}").body<PulseCycleResponse>()
            assertEquals(PulseCycleStatus.OPEN, visible.status)
            assertNotNull(visible.rotatingQuestion)
            val opened = participant.get("/api/v1/notifications").body<NotificationPageResponse>()
                .items.first { it.type == NotificationType.PULSE_CYCLE_OPENED }
            assertEquals("/pulse?tab=survey", opened.link)

            // The participant submits (detail matrix in PulseResponseTest).
            assertEquals(
                HttpStatusCode.NoContent,
                participant.put("$cyclesUrl/${cycle.id}/my-response") {
                    contentType(ContentType.Application.Json)
                    setBody(answers(9))
                }.status,
            )

            // Close: respondents get the deep-linked results notification; re-close is 409.
            assertEquals(HttpStatusCode.NoContent, admin.post("$cyclesUrl/${cycle.id}/close").status)
            assertEquals(HttpStatusCode.Conflict, admin.post("$cyclesUrl/${cycle.id}/close").status)
            val results = participant.get("/api/v1/notifications").body<NotificationPageResponse>()
                .items.first { it.type == NotificationType.PULSE_RESULTS_AVAILABLE }
            assertEquals("/pulse?tab=results&cycle=${cycle.id}", results.link)
            // The non-responding admin gets none.
            assertFalse(NotificationType.PULSE_RESULTS_AVAILABLE in admin.notificationTypes())

            // The admin counts view: snapshot >= the two seeded accounts, exactly one response.
            val counts = admin.get("$cyclesUrl/${cycle.id}/participation").body<PulseParticipationCounts>()
            assertTrue(counts.participantCount >= 2)
            assertEquals(1, counts.responseCount)

            // Cancelling a CLOSED cycle retracts results (allowed); a second cancel is 409.
            assertEquals(HttpStatusCode.NoContent, admin.post("$cyclesUrl/${cycle.id}/cancel").status)
            assertEquals(HttpStatusCode.Conflict, admin.post("$cyclesUrl/${cycle.id}/cancel").status)
            assertEquals(
                PulseCycleStatus.CANCELLED,
                admin.get("$cyclesUrl/${cycle.id}").body<PulseCycleResponse>().status,
            )
        } finally {
            TestPulse.sweepNonTerminal()
        }
    }

    @Test
    fun `at most one non-terminal cycle - the second schedule answers 409`() = testApplication {
        usePostgresTestcontainer()
        TestPulse.sweepNonTerminal()
        val adminEmail = uniqueEmail("pulse-admin")
        TestUsers.seed(adminEmail, "pw")
        val admin = authedClient(adminEmail, "pw")
        val first = admin.schedule().body<PulseCycleResponse>()
        try {
            assertEquals(HttpStatusCode.Conflict, admin.schedule().status)
            // Terminal again -> scheduling reopens.
            assertEquals(HttpStatusCode.NoContent, admin.post("$cyclesUrl/${first.id}/cancel").status)
            val second = admin.schedule()
            assertEquals(HttpStatusCode.Created, second.status)
            assertEquals(
                HttpStatusCode.NoContent,
                admin.post("$cyclesUrl/${second.body<PulseCycleResponse>().id}/cancel").status,
            )
        } finally {
            TestPulse.sweepNonTerminal()
        }
    }

    @Test
    fun `unknown cycle ids answer 404 for every admin operation`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("pulse-admin")
        TestUsers.seed(adminEmail, "pw")
        val admin = authedClient(adminEmail, "pw")
        val missing = 999_999_999u
        assertEquals(HttpStatusCode.NotFound, admin.get("$cyclesUrl/$missing").status)
        assertEquals(HttpStatusCode.NotFound, admin.post("$cyclesUrl/$missing/open").status)
        assertEquals(HttpStatusCode.NotFound, admin.post("$cyclesUrl/$missing/close").status)
        assertEquals(HttpStatusCode.NotFound, admin.post("$cyclesUrl/$missing/cancel").status)
        assertEquals(HttpStatusCode.NotFound, admin.get("$cyclesUrl/$missing/participation").status)
        assertEquals(
            HttpStatusCode.NotFound,
            admin.put("$cyclesUrl/$missing") {
                contentType(ContentType.Application.Json)
                setBody(PulseCycleUpdateRequest("2099-01-01", "2099-01-08"))
            }.status,
        )
    }

    @Test
    fun `every management operation is ADMIN-only`() = testApplication {
        usePostgresTestcontainer()
        val plainEmail = uniqueEmail("pulse-plain")
        TestUsers.seed(plainEmail, "pw", roles = emptySet())
        val plain = authedClient(plainEmail, "pw")
        // requireAdmin runs before any read, so a bogus id still answers a uniform 403.
        assertEquals(HttpStatusCode.Forbidden, plain.schedule().status)
        assertEquals(
            HttpStatusCode.Forbidden,
            plain.put("$cyclesUrl/1") {
                contentType(ContentType.Application.Json)
                setBody(PulseCycleUpdateRequest("2099-01-01", "2099-01-08"))
            }.status,
        )
        assertEquals(HttpStatusCode.Forbidden, plain.post("$cyclesUrl/1/open").status)
        assertEquals(HttpStatusCode.Forbidden, plain.post("$cyclesUrl/1/close").status)
        assertEquals(HttpStatusCode.Forbidden, plain.post("$cyclesUrl/1/cancel").status)
        assertEquals(HttpStatusCode.Forbidden, plain.get("$cyclesUrl/1/participation").status)
        assertEquals(HttpStatusCode.Forbidden, plain.get("/api/v1/pulse-surveys/settings").status)
        assertEquals(
            HttpStatusCode.Forbidden,
            plain.put("/api/v1/pulse-surveys/settings") {
                contentType(ContentType.Application.Json)
                setBody(ch.nokillswit.pulse.PulseSettings(cadenceWeeks = 4, openDays = 7))
            }.status,
        )
    }

    @Test
    fun `date edits follow the status - both while scheduled, close-only while open, none later`() = testApplication {
        usePostgresTestcontainer()
        TestPulse.sweepNonTerminal()
        val adminEmail = uniqueEmail("pulse-admin")
        TestUsers.seed(adminEmail, "pw")
        val admin = authedClient(adminEmail, "pw")

        // Shape validation on schedule: close must be strictly after open, both strict ISO.
        assertEquals(HttpStatusCode.BadRequest, admin.schedule(open = "2099-01-08", close = "2099-01-01").status)
        assertEquals(HttpStatusCode.BadRequest, admin.schedule(open = "2099-1-1", close = "2099-01-08").status)

        val cycle = admin.schedule().body<PulseCycleResponse>()
        try {
            suspend fun edit(open: String, close: String) = admin.put("$cyclesUrl/${cycle.id}") {
                contentType(ContentType.Application.Json)
                setBody(PulseCycleUpdateRequest(plannedOpenDate = open, plannedCloseDate = close))
            }
            // SCHEDULED: both dates move.
            assertEquals(HttpStatusCode.NoContent, edit("2099-02-01", "2099-02-10").status)
            val moved = admin.get("$cyclesUrl/${cycle.id}").body<PulseCycleResponse>()
            assertEquals("2099-02-01", moved.plannedOpenDate)
            assertEquals("2099-02-10", moved.plannedCloseDate)

            // OPEN: the open date is history — only the close date extends.
            assertEquals(HttpStatusCode.NoContent, admin.post("$cyclesUrl/${cycle.id}/open").status)
            assertEquals(HttpStatusCode.BadRequest, edit("2099-02-02", "2099-02-20").status)
            assertEquals(HttpStatusCode.NoContent, edit("2099-02-01", "2099-02-20").status)
            assertEquals(
                "2099-02-20",
                admin.get("$cyclesUrl/${cycle.id}").body<PulseCycleResponse>().plannedCloseDate,
            )

            // CLOSED: read-only.
            assertEquals(HttpStatusCode.NoContent, admin.post("$cyclesUrl/${cycle.id}/close").status)
            assertEquals(HttpStatusCode.Conflict, edit("2099-02-01", "2099-02-25").status)
        } finally {
            TestPulse.sweepNonTerminal()
        }
    }

    @Test
    fun `cancelling notifies participants only from OPEN`() = testApplication {
        usePostgresTestcontainer()
        TestPulse.sweepNonTerminal()
        val adminEmail = uniqueEmail("pulse-admin")
        TestUsers.seed(adminEmail, "pw")
        val admin = authedClient(adminEmail, "pw")
        val userEmail = uniqueEmail("pulse-cancel-watcher")
        TestUsers.seed(userEmail, "pw", roles = emptySet())
        val user = authedClient(userEmail, "pw")
        try {
            // SCHEDULED -> CANCELLED: silent.
            val scheduled = admin.schedule().body<PulseCycleResponse>()
            assertEquals(HttpStatusCode.NoContent, admin.post("$cyclesUrl/${scheduled.id}/cancel").status)
            assertFalse(NotificationType.PULSE_CYCLE_CANCELLED in user.notificationTypes())

            // OPEN -> CANCELLED: participants were mid-survey, they get told.
            val open = admin.schedule().body<PulseCycleResponse>()
            assertEquals(HttpStatusCode.NoContent, admin.post("$cyclesUrl/${open.id}/open").status)
            assertEquals(HttpStatusCode.NoContent, admin.post("$cyclesUrl/${open.id}/cancel").status)
            assertTrue(NotificationType.PULSE_CYCLE_CANCELLED in user.notificationTypes())
        } finally {
            TestPulse.sweepNonTerminal()
        }
    }

    @Test
    fun `the eligibility snapshot excludes deactivated, soft-deleted, and flag-disabled users`() = testApplication {
        usePostgresTestcontainer()
        TestPulse.sweepNonTerminal()
        val adminEmail = uniqueEmail("pulse-admin")
        TestUsers.seed(adminEmail, "pw")
        val admin = authedClient(adminEmail, "pw")
        val normalId = TestUsers.seed(uniqueEmail("pulse-normal"), "pw", roles = emptySet())
        val deactivatedId = TestUsers.seed(uniqueEmail("pulse-deactivated"), "pw", roles = emptySet())
        val deletedId = TestUsers.seed(uniqueEmail("pulse-deleted"), "pw", roles = emptySet())
        val flaggedId = TestUsers.seed(uniqueEmail("pulse-flagged"), "pw", roles = emptySet())
        assertEquals(HttpStatusCode.NoContent, admin.post("/api/v1/users/$deactivatedId/deactivate").status)
        assertEquals(HttpStatusCode.NoContent, admin.delete("/api/v1/users/$deletedId").status)
        assertEquals(
            HttpStatusCode.NoContent,
            admin.put("/api/v1/users/$flaggedId/features") {
                contentType(ContentType.Application.Json)
                setBody(UserFeaturesUpdateRequest(listOf(Feature.PULSE_SURVEYS)))
            }.status,
        )

        val cycle = admin.schedule().body<PulseCycleResponse>()
        try {
            assertEquals(HttpStatusCode.NoContent, admin.post("$cyclesUrl/${cycle.id}/open").status)
            assertTrue(TestPulse.responses.isParticipant(cycle.id, normalId))
            assertFalse(TestPulse.responses.isParticipant(cycle.id, deactivatedId))
            assertFalse(TestPulse.responses.isParticipant(cycle.id, deletedId))
            assertFalse(TestPulse.responses.isParticipant(cycle.id, flaggedId))
        } finally {
            TestPulse.sweepNonTerminal()
        }
    }

    @Test
    fun `the dashboard carries the pulse tile fields for participants of the open cycle`() = testApplication {
        usePostgresTestcontainer()
        TestPulse.sweepNonTerminal()
        val adminEmail = uniqueEmail("pulse-admin")
        TestUsers.seed(adminEmail, "pw")
        val admin = authedClient(adminEmail, "pw")
        val userEmail = uniqueEmail("pulse-tile")
        TestUsers.seed(userEmail, "pw", roles = emptySet())
        val user = authedClient(userEmail, "pw")

        suspend fun summary() = user.get("/api/v1/dashboard/summary").body<DashboardSummary>()
        val cycle = admin.schedule().body<PulseCycleResponse>()
        try {
            // SCHEDULED: no tile.
            assertNull(summary().pulseOpenCloseDate)
            assertEquals(HttpStatusCode.NoContent, admin.post("$cyclesUrl/${cycle.id}/open").status)
            assertEquals(cycle.plannedCloseDate, summary().pulseOpenCloseDate)
            assertEquals(false, summary().pulseSubmitted)
            assertEquals(
                HttpStatusCode.NoContent,
                user.put("$cyclesUrl/${cycle.id}/my-response") {
                    contentType(ContentType.Application.Json)
                    setBody(answers(8))
                }.status,
            )
            assertEquals(true, summary().pulseSubmitted)
            assertEquals(HttpStatusCode.NoContent, admin.post("$cyclesUrl/${cycle.id}/close").status)
            assertNull(summary().pulseOpenCloseDate)
        } finally {
            TestPulse.sweepNonTerminal()
        }
    }

    @Test
    fun `admin cycle actions land in the audit trail`() = testApplication {
        usePostgresTestcontainer()
        TestPulse.sweepNonTerminal()
        val adminEmail = uniqueEmail("pulse-admin")
        TestUsers.seed(adminEmail, "pw")
        val admin = authedClient(adminEmail, "pw")
        val capture = LogCapture("ch.nokillswit.audit")
        try {
            val cycle = admin.schedule().body<PulseCycleResponse>()
            admin.put("$cyclesUrl/${cycle.id}") {
                contentType(ContentType.Application.Json)
                setBody(PulseCycleUpdateRequest("2099-01-02", "2099-01-09"))
            }
            admin.post("$cyclesUrl/${cycle.id}/open")
            admin.post("$cyclesUrl/${cycle.id}/close")
            admin.post("$cyclesUrl/${cycle.id}/cancel")
            // cycleId travels as a Long key/value — compare stringified.
            fun hasCycleId(event: ch.qos.logback.classic.spi.ILoggingEvent) =
                event.keyValuePairs?.any { it.key == "cycleId" && it.value.toString() == cycle.id.toString() } == true
            listOf(
                "pulse_cycle.scheduled", "pulse_cycle.updated", "pulse_cycle.opened",
                "pulse_cycle.closed", "pulse_cycle.cancelled",
            ).forEach { event ->
                assertNotNull(
                    capture.awaitEvent { it.message == event && hasCycleId(it) },
                    "missing audit event $event",
                )
            }
            // The date-edit deltas ride the update event.
            assertNotNull(capture.awaitEvent { it.message == "pulse_cycle.updated" && it.hasKeyValue("plannedOpenTo", "2099-01-02") })
        } finally {
            capture.detach()
            TestPulse.sweepNonTerminal()
        }
    }
}
