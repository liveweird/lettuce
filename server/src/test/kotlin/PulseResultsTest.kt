package ch.nokillswit

import ch.nokillswit.pulse.PulseAggregationMode
import ch.nokillswit.pulse.PulseCommentsResponse
import ch.nokillswit.pulse.PulseCycleStatus
import ch.nokillswit.pulse.PulseDriverQuestion
import ch.nokillswit.pulse.PulseParticipationStatusResponse
import ch.nokillswit.pulse.PulseResponseSubmitRequest
import ch.nokillswit.pulse.PulseScaleAnswer
import ch.nokillswit.pulse.PulseTeamResults
import ch.nokillswit.pulse.PulseTrendAvailability
import ch.nokillswit.pulse.PulseTrendResponse
import ch.nokillswit.pulse.PulseVisibleTeams
import ch.nokillswit.teams.Team
import ch.nokillswit.users.UserRole
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.client.request.parameter
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The pulse read views end to end: the per-cycle fill gate (roles exempt: HR only), the
 * team-tree visibility scopes, k-anonymity at the 2/3 boundary, the closed-only status gate
 * (uniform, HR included), previous-cycle deltas, anonymized comments, the manager
 * participation-status view, the trend availability markers, and visible-teams. Fixtures are
 * built with TestPulse.closedCycleWith (forced statuses over a handful of test users — no
 * whole-container snapshots), so every aggregate is deterministic.
 */
class PulseResultsTest {

    private val cyclesUrl = "/api/v1/pulse-surveys/cycles"

    private fun answers(
        enps: Int,
        driver: PulseScaleAnswer = PulseScaleAnswer.AGREE,
        comment: String? = null,
    ) = PulseResponseSubmitRequest(
        enps = enps, q2 = driver, q3 = driver, q4 = driver, q5 = driver, rotating = driver, comment = comment,
    )

    private class Org(
        val managerEmail: String, val managerId: UInt,
        val xEmail: String, val xId: UInt,
        val yId: UInt,
        val zId: UInt,
        val teamId: UInt,
    )

    /** Team of three (X, Y, Z) under a manager — the smallest k-passing scope. */
    private suspend fun org(): Org {
        val managerEmail = uniqueEmail("pulse-mgr")
        val managerId = TestUsers.seed(managerEmail, "pw", roles = emptySet())
        val xEmail = uniqueEmail("pulse-x")
        val xId = TestUsers.seed(xEmail, "pw", roles = emptySet())
        val yId = TestUsers.seed(uniqueEmail("pulse-y"), "pw", roles = emptySet())
        val zId = TestUsers.seed(uniqueEmail("pulse-z"), "pw", roles = emptySet())
        val teamId = TestServices.teams.create(
            Team(name = "pulse-team-${UUID.randomUUID()}", managerId = managerId, memberIds = listOf(xId, yId, zId)),
        )
        return Org(managerEmail, managerId, xEmail, xId, yId, zId, teamId)
    }

    private suspend fun HttpClient.results(cycleId: UInt, teamId: UInt, mode: String? = null) =
        get("$cyclesUrl/$cycleId/results") {
            parameter("teamId", teamId)
            if (mode != null) parameter("mode", mode)
        }

    @Test
    fun `access matrix - respondent yes, non-respondent no (ADMIN included), HR exempt and audited`() =
        testApplication {
            usePostgresTestcontainer()
            TestPulse.sweepNonTerminal()
            val fx = org()
            val outsiderEmail = uniqueEmail("pulse-outsider")
            val outsiderId = TestUsers.seed(outsiderEmail, "pw", roles = emptySet())
            val adminEmail = uniqueEmail("pulse-admin")
            TestUsers.seed(adminEmail, "pw")
            val hrEmail = uniqueEmail("pulse-hr")
            TestUsers.seed(hrEmail, "pw", roles = setOf(UserRole.HR))

            val cycle = TestPulse.closedCycleWith(
                respondents = mapOf(
                    fx.xId to answers(10),
                    fx.yId to answers(9),
                    fx.zId to answers(2),
                    // The outsider responded too — so their 403 below is the TEAM gate, not the fill gate.
                    outsiderId to answers(5),
                ),
                silentParticipants = listOf(fx.managerId),
            )

            // A responding member reads their team's numbers.
            val x = authedClient(fx.xEmail, "pw")
            val block = x.results(cycle.id, fx.teamId).body<PulseTeamResults>()
            assertFalse(block.insufficientResponses)
            // 2 promoters, 1 detractor of 3: 66.667 - 33.333 -> 33.
            assertEquals(33, block.enps!!.score)
            assertEquals(3, block.responseCount)
            // Scope participants: X, Y, Z (the manager and outsider are outside the team scope).
            assertEquals(3, block.participantCount)
            assertEquals(100.0, block.responseRate)

            // The manager did NOT respond: aggregates stay shut (participation/comments are their views).
            val manager = authedClient(fx.managerEmail, "pw")
            assertEquals(HttpStatusCode.Forbidden, manager.results(cycle.id, fx.teamId).status)
            // A respondent outside the tree: the team scope 403.
            val outsider = authedClient(outsiderEmail, "pw")
            assertEquals(HttpStatusCode.Forbidden, outsider.results(cycle.id, fx.teamId).status)
            // ADMIN gets no exemption (counts only, via /participation).
            val admin = authedClient(adminEmail, "pw")
            assertEquals(HttpStatusCode.Forbidden, admin.results(cycle.id, fx.teamId).status)

            // HR reads without responding — audit-logged.
            val capture = LogCapture("ch.nokillswit.audit")
            try {
                val hr = authedClient(hrEmail, "pw")
                assertEquals(HttpStatusCode.OK, hr.results(cycle.id, fx.teamId).status)
                assertNotNull(
                    capture.awaitEvent {
                        it.message == "hr.read" && it.hasKeyValue("resource", "pulseResults")
                    },
                )
            } finally {
                capture.detach()
            }

            // Unknown team -> 404; junk mode -> 400; missing teamId -> 400.
            assertEquals(HttpStatusCode.NotFound, x.results(cycle.id, 999_999_999u).status)
            assertEquals(HttpStatusCode.BadRequest, x.results(cycle.id, fx.teamId, mode = "sideways").status)
            assertEquals(HttpStatusCode.BadRequest, x.get("$cyclesUrl/${cycle.id}/results").status)
        }

    @Test
    fun `results and comments exist only for CLOSED cycles - uniformly, HR included`() = testApplication {
        usePostgresTestcontainer()
        TestPulse.sweepNonTerminal()
        val fx = org()
        val hrEmail = uniqueEmail("pulse-hr")
        TestUsers.seed(hrEmail, "pw", roles = setOf(UserRole.HR))
        val hr = authedClient(hrEmail, "pw")

        val id = TestPulse.cycles.schedule(
            ch.nokillswit.pulse.PulseCycleCreateRequest("2099-01-01", "2099-01-08"),
        )
        try {
            TestPulse.addParticipants(id, listOf(fx.xId, fx.yId, fx.zId))
            TestPulse.forceStatus(id, PulseCycleStatus.OPEN, openedAt = System.currentTimeMillis())
            TestPulse.responses.upsert(id, fx.xId, answers(10))
            TestPulse.responses.upsert(id, fx.yId, answers(9))
            TestPulse.responses.upsert(id, fx.zId, answers(8))

            // OPEN: nobody reads anything, not even HR.
            assertEquals(HttpStatusCode.Conflict, hr.results(id, fx.teamId).status)
            assertEquals(
                HttpStatusCode.Conflict,
                hr.get("$cyclesUrl/$id/comments") { parameter("teamId", fx.teamId) }.status,
            )

            // CANCELLED: results never exist.
            TestPulse.forceStatus(id, PulseCycleStatus.CANCELLED)
            assertEquals(HttpStatusCode.Conflict, hr.results(id, fx.teamId).status)
        } finally {
            TestPulse.sweepNonTerminal()
        }
    }

    @Test
    fun `k-anonymity - two responses withhold, three reveal`() = testApplication {
        usePostgresTestcontainer()
        TestPulse.sweepNonTerminal()
        val fx = org()
        val cycle = TestPulse.closedCycleWith(
            respondents = mapOf(fx.xId to answers(10), fx.yId to answers(0)),
            silentParticipants = listOf(fx.zId),
        )
        val x = authedClient(fx.xEmail, "pw")
        val withheld = x.results(cycle.id, fx.teamId).body<PulseTeamResults>()
        assertTrue(withheld.insufficientResponses)
        assertEquals(2, withheld.responseCount)
        assertEquals(3, withheld.participantCount)
        assertNull(withheld.enps)
        assertNull(withheld.drivers)
        assertNull(withheld.previous)
    }

    @Test
    fun `previous-cycle deltas - fixed drivers always compare, rotating only on the same entry`() =
        testApplication {
            usePostgresTestcontainer()
            TestPulse.sweepNonTerminal()
            val fx = org()
            val base = TestPulse.closedAtAfterAll()
            val c1 = TestPulse.closedCycleWith(
                respondents = mapOf(
                    fx.xId to answers(2, driver = PulseScaleAnswer.NEITHER),
                    fx.yId to answers(3, driver = PulseScaleAnswer.NEITHER),
                    fx.zId to answers(7, driver = PulseScaleAnswer.DISAGREE),
                ),
                closedAt = base,
            )
            val c2 = TestPulse.closedCycleWith(
                respondents = mapOf(
                    fx.xId to answers(10, driver = PulseScaleAnswer.STRONGLY_AGREE),
                    fx.yId to answers(9, driver = PulseScaleAnswer.STRONGLY_AGREE),
                    fx.zId to answers(8, driver = PulseScaleAnswer.AGREE),
                ),
                closedAt = base + 10_000,
            )
            val x = authedClient(fx.xEmail, "pw")
            val block = x.results(c2.id, fx.teamId).body<PulseTeamResults>()
            assertEquals(c1.id, block.previous!!.cycleId)
            // c2: 2 promoters + 1 passive -> 67; c1: 2 detractors + 1 passive -> -67; delta 134.
            assertEquals(134, block.previous!!.enpsDelta)
            val q2 = block.drivers!!.first { it.question == PulseDriverQuestion.Q2 }
            // Means are 1dp-rounded before differencing: 4.7 vs 2.7 -> +2.0; favorable 100% vs 0% -> +100pp.
            assertEquals(2.0, q2.meanDelta)
            assertEquals(100.0, q2.favorableDeltaPp)
            // The rotating comparison follows the entry identity (the pool pick may or may
            // not repeat — assert consistency with the snapshotted entries).
            val rotating = block.drivers!!.first { it.question == PulseDriverQuestion.ROTATING }
            assertEquals(c2.rotatingQuestionTextEn, rotating.rotatingTextEn)
            if (c1.rotatingQuestionEntryId == c2.rotatingQuestionEntryId) {
                assertNotNull(rotating.meanDelta)
            } else {
                assertNull(rotating.meanDelta)
                assertNull(rotating.favorableDeltaPp)
            }
        }

    @Test
    fun `a previous cycle under the k-floor yields no deltas`() = testApplication {
        usePostgresTestcontainer()
        TestPulse.sweepNonTerminal()
        val fx = org()
        val base = TestPulse.closedAtAfterAll()
        TestPulse.closedCycleWith(
            respondents = mapOf(fx.xId to answers(0), fx.yId to answers(1)),
            closedAt = base,
        )
        val c2 = TestPulse.closedCycleWith(
            respondents = mapOf(fx.xId to answers(10), fx.yId to answers(9), fx.zId to answers(8)),
            closedAt = base + 10_000,
        )
        val x = authedClient(fx.xEmail, "pw")
        val block = x.results(c2.id, fx.teamId).body<PulseTeamResults>()
        assertFalse(block.insufficientResponses)
        assertNull(block.previous)
        assertTrue(block.drivers!!.all { it.meanDelta == null && it.favorableDeltaPp == null })
    }

    @Test
    fun `subtree mode widens the scope to members' report trees`() = testApplication {
        usePostgresTestcontainer()
        TestPulse.sweepNonTerminal()
        val fx = org()
        // X manages a sub-team of three below fx.team.
        val p = TestUsers.seed(uniqueEmail("pulse-p"), "pw", roles = emptySet())
        val q = TestUsers.seed(uniqueEmail("pulse-q"), "pw", roles = emptySet())
        val r = TestUsers.seed(uniqueEmail("pulse-r"), "pw", roles = emptySet())
        TestServices.teams.create(
            Team(name = "pulse-sub-${UUID.randomUUID()}", managerId = fx.xId, memberIds = listOf(p, q, r)),
        )
        val cycle = TestPulse.closedCycleWith(
            respondents = mapOf(
                fx.xId to answers(10), fx.yId to answers(10), fx.zId to answers(10),
                p to answers(0), q to answers(0), r to answers(0),
            ),
        )
        val x = authedClient(fx.xEmail, "pw")
        // Direct: the three members only -> +100.
        val direct = x.results(cycle.id, fx.teamId, mode = "direct").body<PulseTeamResults>()
        assertEquals(3, direct.responseCount)
        assertEquals(100, direct.enps!!.score)
        // Subtree: + the sub-team's three detractors -> 50% - 50% = 0.
        val subtree = x.results(cycle.id, fx.teamId, mode = "subtree").body<PulseTeamResults>()
        assertEquals(6, subtree.responseCount)
        assertEquals(0, subtree.enps!!.score)
        assertEquals(PulseAggregationMode.SUBTREE, subtree.mode)
    }

    @Test
    fun `comments - monitored managers and HR only, k-gated, author-free`() = testApplication {
        usePostgresTestcontainer()
        TestPulse.sweepNonTerminal()
        val fx = org()
        // An upper manager above fx's manager.
        val upperEmail = uniqueEmail("pulse-upper")
        val upperId = TestUsers.seed(upperEmail, "pw", roles = emptySet())
        TestServices.teams.create(
            Team(name = "pulse-top-${UUID.randomUUID()}", managerId = upperId, memberIds = listOf(fx.managerId)),
        )
        val hrEmail = uniqueEmail("pulse-hr")
        TestUsers.seed(hrEmail, "pw", roles = setOf(UserRole.HR))

        val cycle = TestPulse.closedCycleWith(
            respondents = mapOf(
                fx.xId to answers(10, comment = "alpha comment"),
                fx.yId to answers(5, comment = "beta comment"),
                fx.zId to answers(2),
            ),
        )
        suspend fun HttpClient.comments(teamId: UInt) =
            get("$cyclesUrl/${cycle.id}/comments") { parameter("teamId", teamId) }

        // The direct manager reads them — WITHOUT having responded (a monitoring right).
        val manager = authedClient(fx.managerEmail, "pw")
        val block = manager.comments(fx.teamId).body<PulseCommentsResponse>()
        assertEquals(setOf("alpha comment", "beta comment"), block.items.toSet())
        assertEquals(3, block.responseCount)
        assertFalse(block.insufficientResponses)
        // An upper manager monitors the whole tree below.
        val upper = authedClient(upperEmail, "pw")
        assertEquals(HttpStatusCode.OK, upper.comments(fx.teamId).status)
        // A plain member never reads comments — even a respondent.
        val x = authedClient(fx.xEmail, "pw")
        assertEquals(HttpStatusCode.Forbidden, x.comments(fx.teamId).status)
        // HR reads org-wide, audited.
        val capture = LogCapture("ch.nokillswit.audit")
        try {
            val hr = authedClient(hrEmail, "pw")
            assertEquals(HttpStatusCode.OK, hr.comments(fx.teamId).status)
            assertNotNull(capture.awaitEvent { it.message == "hr.read" && it.hasKeyValue("resource", "pulseComments") })
        } finally {
            capture.detach()
        }

        // k-gate: a two-response cycle withholds the comments entirely.
        val small = TestPulse.closedCycleWith(
            respondents = mapOf(
                fx.xId to answers(10, comment = "would identify me"),
                fx.yId to answers(5, comment = "and me"),
            ),
            silentParticipants = listOf(fx.zId),
        )
        val withheld = manager.get("$cyclesUrl/${small.id}/comments") { parameter("teamId", fx.teamId) }
            .body<PulseCommentsResponse>()
        assertTrue(withheld.insufficientResponses)
        assertTrue(withheld.items.isEmpty())
    }

    @Test
    fun `participation status - per-person yes-no for the monitored tree, live while open`() = testApplication {
        usePostgresTestcontainer()
        TestPulse.sweepNonTerminal()
        val fx = org()
        val hrEmail = uniqueEmail("pulse-hr")
        TestUsers.seed(hrEmail, "pw", roles = setOf(UserRole.HR))
        val id = TestPulse.cycles.schedule(
            ch.nokillswit.pulse.PulseCycleCreateRequest("2099-01-01", "2099-01-08"),
        )
        try {
            // SCHEDULED -> 409 (nothing to monitor yet).
            val manager = authedClient(fx.managerEmail, "pw")
            assertEquals(HttpStatusCode.Conflict, manager.get("$cyclesUrl/$id/participation-status").status)

            // X and Y are participants (Z sat out the snapshot, e.g. flag-disabled); X responded.
            TestPulse.addParticipants(id, listOf(fx.xId, fx.yId))
            TestPulse.forceStatus(id, PulseCycleStatus.OPEN, openedAt = System.currentTimeMillis())
            TestPulse.responses.upsert(id, fx.xId, answers(7))

            val status = manager.get("$cyclesUrl/$id/participation-status").body<PulseParticipationStatusResponse>()
            val team = status.teams.first { it.teamId == fx.teamId }
            assertEquals(
                mapOf(fx.xId to true, fx.yId to false),
                team.members.associate { it.userId to it.responded },
            )
            // A plain member monitors nothing.
            val x = authedClient(fx.xEmail, "pw")
            val own = x.get("$cyclesUrl/$id/participation-status").body<PulseParticipationStatusResponse>()
            assertTrue(own.teams.none { it.teamId == fx.teamId })
            // HR sees the whole org, audited.
            val capture = LogCapture("ch.nokillswit.audit")
            try {
                val hr = authedClient(hrEmail, "pw")
                val all = hr.get("$cyclesUrl/$id/participation-status").body<PulseParticipationStatusResponse>()
                assertTrue(all.teams.any { it.teamId == fx.teamId })
                assertNotNull(
                    capture.awaitEvent { it.message == "hr.read" && it.hasKeyValue("resource", "pulseParticipation") },
                )
            } finally {
                capture.detach()
            }
        } finally {
            TestPulse.sweepNonTerminal()
        }
    }

    @Test
    fun `trend - OK, NOT_ENOUGH_RESPONSES, and NOT_A_RESPONDENT point-wise`() = testApplication {
        usePostgresTestcontainer()
        TestPulse.sweepNonTerminal()
        val fx = org()
        // W: a fourth member who never responds anywhere.
        val wEmail = uniqueEmail("pulse-w")
        val wId = TestUsers.seed(wEmail, "pw", roles = emptySet())
        TestServices.teams.addMember(fx.teamId, wId)
        val hrEmail = uniqueEmail("pulse-hr")
        TestUsers.seed(hrEmail, "pw", roles = setOf(UserRole.HR))

        val base = TestPulse.closedAtAfterAll()
        // All three are promoters (9-10) — an 8 would be a passive and dent the +100.
        val c1 = TestPulse.closedCycleWith(
            respondents = mapOf(fx.xId to answers(10), fx.yId to answers(9), fx.zId to answers(10)),
            silentParticipants = listOf(wId),
            closedAt = base,
        )
        val c2 = TestPulse.closedCycleWith(
            respondents = mapOf(fx.xId to answers(2), fx.yId to answers(3)),
            silentParticipants = listOf(fx.zId, wId),
            closedAt = base + 10_000,
        )
        val mine = setOf(c1.id, c2.id)
        suspend fun HttpClient.trendPoints() =
            get("/api/v1/pulse-surveys/trend") { parameter("teamId", fx.teamId) }
                .body<PulseTrendResponse>().points.filter { it.cycleId in mine }

        // X responded in both: c1 OK (+100), c2 under the floor.
        val x = authedClient(fx.xEmail, "pw")
        val xPoints = x.trendPoints()
        assertEquals(listOf(c1.id, c2.id), xPoints.map { it.cycleId })
        assertEquals(PulseTrendAvailability.OK, xPoints[0].availability)
        assertEquals(100, xPoints[0].enps)
        // v2.11.0: OK points carry the fixed drivers' favorable% (all AGREE here -> 100.0);
        // withheld points carry none.
        assertEquals(100.0, xPoints[0].favorableQ2)
        assertEquals(100.0, xPoints[0].favorableQ5)
        assertEquals(PulseTrendAvailability.NOT_ENOUGH_RESPONSES, xPoints[1].availability)
        assertNull(xPoints[1].enps)
        assertNull(xPoints[1].favorableQ2)
        assertEquals(2, xPoints[1].responseCount)

        // W never responded: every point is a gap without numbers.
        val w = authedClient(wEmail, "pw")
        w.trendPoints().forEach {
            assertEquals(PulseTrendAvailability.NOT_A_RESPONDENT, it.availability)
            assertNull(it.enps)
            assertNull(it.responseCount)
        }

        // HR skips the fill gate but stays k-gated.
        val hr = authedClient(hrEmail, "pw")
        val hrPoints = hr.trendPoints()
        assertEquals(PulseTrendAvailability.OK, hrPoints[0].availability)
        assertEquals(PulseTrendAvailability.NOT_ENOUGH_RESPONSES, hrPoints[1].availability)
    }

    @Test
    fun `visible teams - the two scopes per role`() = testApplication {
        usePostgresTestcontainer()
        TestPulse.sweepNonTerminal()
        val fx = org()
        val hrEmail = uniqueEmail("pulse-hr")
        TestUsers.seed(hrEmail, "pw", roles = setOf(UserRole.HR))
        suspend fun HttpClient.visible() = get("/api/v1/pulse-surveys/visible-teams").body<PulseVisibleTeams>()

        // A member: results yes, membership yes, monitoring no.
        val x = authedClient(fx.xEmail, "pw")
        val xTeams = x.visible()
        assertTrue(xTeams.resultsTeams.any { it.id == fx.teamId })
        assertTrue(xTeams.memberTeams.any { it.id == fx.teamId })
        assertTrue(xTeams.monitoredTeams.none { it.id == fx.teamId })
        // The manager: results + monitoring, but NOT membership (v2.12.0 — managing a team
        // never makes you a member of it).
        val manager = authedClient(fx.managerEmail, "pw")
        val mTeams = manager.visible()
        assertTrue(mTeams.resultsTeams.any { it.id == fx.teamId })
        assertTrue(mTeams.monitoredTeams.any { it.id == fx.teamId })
        assertTrue(mTeams.memberTeams.none { it.id == fx.teamId })
        // HR: everything, all three scopes (the auditor posture).
        val hr = authedClient(hrEmail, "pw")
        val hrTeams = hr.visible()
        assertTrue(hrTeams.resultsTeams.any { it.id == fx.teamId })
        assertTrue(hrTeams.monitoredTeams.any { it.id == fx.teamId })
        assertTrue(hrTeams.memberTeams.any { it.id == fx.teamId })
    }

    @Test
    fun `a perfectly split scope reads eNPS zero with even thirds - route level`() = testApplication {
        usePostgresTestcontainer()
        TestPulse.sweepNonTerminal()
        val fx = org()
        // 1 promoter, 1 passive, 1 detractor — the same shape the e2e fixture produces.
        val cycle = TestPulse.closedCycleWith(
            respondents = mapOf(fx.xId to answers(10), fx.yId to answers(8), fx.zId to answers(2)),
        )
        val x = authedClient(fx.xEmail, "pw")
        val block = x.results(cycle.id, fx.teamId).body<PulseTeamResults>()
        assertEquals(0, block.enps!!.score)
        assertEquals(33.3, block.enps!!.promoterPct)
        assertEquals(33.3, block.enps!!.passivePct)
        assertEquals(33.3, block.enps!!.detractorPct)
        assertEquals(100.0, block.responseRate)
    }

    @Test
    fun `a previous cycle sharing the exact closedAt is not a previous cycle - the strict ordering`() =
        testApplication {
            usePostgresTestcontainer()
            TestPulse.sweepNonTerminal()
            val fx = org()
            val base = TestPulse.closedAtAfterAll()
            // Two cycles closed at the SAME millisecond: the route's strict `<` on closedAt
            // picks neither as the other's baseline, so no deltas ship — pinned as the
            // documented tie behavior (real cycles close via distinct admin actions).
            TestPulse.closedCycleWith(
                respondents = mapOf(fx.xId to answers(2), fx.yId to answers(3), fx.zId to answers(7)),
                closedAt = base,
            )
            val c2 = TestPulse.closedCycleWith(
                respondents = mapOf(fx.xId to answers(10), fx.yId to answers(9), fx.zId to answers(8)),
                closedAt = base,
            )
            val x = authedClient(fx.xEmail, "pw")
            val block = x.results(c2.id, fx.teamId).body<PulseTeamResults>()
            assertFalse(block.insufficientResponses)
            assertNull(block.previous)
            assertTrue(block.drivers!!.all { it.meanDelta == null && it.favorableDeltaPp == null })
        }
}
