package ch.nokillswit

import ch.nokillswit.plugins.ProblemDetail
import ch.nokillswit.pulse.PulseCommentsResponse
import ch.nokillswit.pulse.PulseCycleStatus
import ch.nokillswit.pulse.PulseParticipationStatusResponse
import ch.nokillswit.pulse.PulseResponseSubmitRequest
import ch.nokillswit.pulse.PulseScaleAnswer
import ch.nokillswit.pulse.PulseTeamResults
import ch.nokillswit.pulse.PulseTrendAvailability
import ch.nokillswit.pulse.PulseTrendResponse
import ch.nokillswit.sharing.ShareCreateOutcome
import ch.nokillswit.sharing.ShareServiceKey
import ch.nokillswit.sharing.ShareableResourceType
import ch.nokillswit.teams.Team
import ch.nokillswit.users.Feature
import ch.nokillswit.users.OPT_IN_FEATURES
import ch.nokillswit.users.UserRole
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.client.request.parameter
import io.ktor.client.statement.HttpResponse
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The share-aware pulse reads (v4.12.0, step 2): `…/results`, `…/comments` and `…/trend` accept an
 * active share of the TEAM's results (`PULSE_TEAM_RESULTS`) as an alternative to the caller's own
 * right. The headline property is PARITY — what a sharee sees is exactly what the SHARER sees: the
 * sharer's fill gate (per cycle), visible tree, comments-monitoring right and responded set decide,
 * never the sharee's. Share creation itself is covered in `SharingTest`; shares are created here
 * through the service so the cases stay about the read side.
 */
class PulseResultsSharingTest {

    private val cyclesUrl = "/api/v1/pulse-surveys/cycles"
    private val lapse = "The person who shared this no longer has access to it"

    private fun answers(enps: Int, comment: String? = null) = PulseResponseSubmitRequest(
        enps = enps,
        q2 = PulseScaleAnswer.AGREE,
        q3 = PulseScaleAnswer.AGREE,
        q4 = PulseScaleAnswer.AGREE,
        q5 = PulseScaleAnswer.AGREE,
        rotating = PulseScaleAnswer.AGREE,
        comment = comment,
    )

    private class Member(val id: UInt, val email: String, val name: String, val client: HttpClient)

    private suspend fun ApplicationTestBuilder.member(
        prefix: String,
        roles: Set<UserRole> = emptySet(),
        disabled: Set<Feature> = emptySet(),
    ): Member {
        val email = uniqueEmail(prefix)
        val name = "$prefix-${UUID.randomUUID().toString().take(8)}"
        val id = TestUsers.seed(email, "pw", name = name, roles = roles)
        if (disabled.isNotEmpty()) TestServices.users.setDisabledFeatures(id, disabled + OPT_IN_FEATURES)
        return Member(id, email, name, authedClient(email, "pw"))
    }

    /**
     * Team T = {X, Y, Z, W} under manager M; U manages the top team whose only member is M; S is an
     * outsider (never a participant, not in the tree). C1: X, Y, Z answer (W silent, M silent but
     * participating) → X and U filled it, M did not. C2 (later): Y, Z, W, M, U answer (X silent) → M
     * and U filled it, X did not.
     */
    private inner class World(
        val m: Member, val u: Member, val x: Member, val y: Member, val z: Member, val w: Member,
        val teamId: UInt, val c1: UInt, val c2: UInt,
    )

    private suspend fun ApplicationTestBuilder.world(): World {
        TestPulse.sweepNonTerminal()
        val m = member("ps-manager")
        val u = member("ps-upper")
        val x = member("ps-x")
        val y = member("ps-y")
        val z = member("ps-z")
        val w = member("ps-w")
        val suffix = UUID.randomUUID().toString().take(8)
        val teamId = TestServices.teams.create(Team("PS-Team-$suffix", m.id, listOf(x.id, y.id, z.id, w.id)))
        TestServices.teams.create(Team("PS-Top-$suffix", u.id, listOf(m.id)))
        val base = TestPulse.closedAtAfterAll()
        val c1 = TestPulse.closedCycleWith(
            respondents = mapOf(
                x.id to answers(10, "x says hi"), y.id to answers(9, "y says hi"), z.id to answers(2),
                u.id to answers(8),
            ),
            silentParticipants = listOf(w.id, m.id),
            closedAt = base,
        )
        val c2 = TestPulse.closedCycleWith(
            respondents = mapOf(
                y.id to answers(10, "y again"), z.id to answers(7), w.id to answers(1, "w says hi"),
                m.id to answers(9), u.id to answers(9),
            ),
            silentParticipants = listOf(x.id),
            closedAt = base + 10_000,
        )
        return World(m, u, x, y, z, w, teamId, c1.id, c2.id)
    }

    private suspend fun ApplicationTestBuilder.share(w: World, sharer: Member, sharee: Member, expiresOn: String? = null): UInt {
        val outcome = application.attributes[ShareServiceKey].create(
            ShareableResourceType.PULSE_TEAM_RESULTS, w.teamId, sharer.id, sharee.id, expiresOn,
        )
        return (outcome as ShareCreateOutcome.Created).id
    }

    private suspend fun HttpClient.results(cycleId: UInt, teamId: UInt, mode: String? = null) =
        get("$cyclesUrl/$cycleId/results") {
            parameter("teamId", teamId)
            if (mode != null) parameter("mode", mode)
        }

    private suspend fun HttpClient.comments(cycleId: UInt, teamId: UInt) =
        get("$cyclesUrl/$cycleId/comments") { parameter("teamId", teamId) }

    private suspend fun HttpClient.trend(teamId: UInt, mode: String? = null) =
        get("/api/v1/pulse-surveys/trend") {
            parameter("teamId", teamId)
            if (mode != null) parameter("mode", mode)
        }

    private suspend fun HttpResponse.detail() = body<ProblemDetail>().detail

    private fun PulseTeamResults.neutral() = copy(canShare = false, sharedBy = null, canReadComments = false)

    /** The sharee's results read equals the sharer's own read: same status; same body when 200, else the lapse. */
    private suspend fun assertResultsParity(sharer: Member, sharee: Member, cycle: UInt, teamId: UInt, mode: String? = null) {
        val own = sharer.client.results(cycle, teamId, mode)
        val shared = sharee.client.results(cycle, teamId, mode)
        assertEquals(own.status, shared.status, "results ${sharer.name} cycle $cycle")
        if (own.status == HttpStatusCode.OK) {
            val sharedBody = shared.body<PulseTeamResults>()
            assertEquals(own.body<PulseTeamResults>().neutral(), sharedBody.neutral())
            assertEquals(sharer.name, sharedBody.sharedBy)
            assertFalse(sharedBody.canShare)
        } else {
            assertEquals(lapse, shared.detail())
        }
    }

    private suspend fun assertCommentsParity(sharer: Member, sharee: Member, cycle: UInt, teamId: UInt) {
        val own = sharer.client.comments(cycle, teamId)
        val shared = sharee.client.comments(cycle, teamId)
        assertEquals(own.status, shared.status, "comments ${sharer.name} cycle $cycle")
        if (own.status == HttpStatusCode.OK) {
            val ownBody = own.body<PulseCommentsResponse>()
            val sharedBody = shared.body<PulseCommentsResponse>()
            assertEquals(ownBody.items.toSet(), sharedBody.items.toSet())
            assertEquals(ownBody.responseCount, sharedBody.responseCount)
            assertEquals(ownBody.insufficientResponses, sharedBody.insufficientResponses)
        } else {
            assertEquals(lapse, shared.detail())
        }
    }

    private suspend fun assertTrendParity(sharer: Member, sharee: Member, teamId: UInt, mode: String? = null) {
        val own = sharer.client.trend(teamId, mode)
        val shared = sharee.client.trend(teamId, mode)
        assertEquals(HttpStatusCode.OK, own.status)
        assertEquals(HttpStatusCode.OK, shared.status)
        assertEquals(own.body<PulseTrendResponse>(), shared.body<PulseTrendResponse>())
    }

    @Test
    fun `parity - a sharee sees exactly what the sharer sees, cycle by cycle, for results, comments and trend`() =
        testApplication {
            usePostgresTestcontainer()
            val w = world()
            // X: a member who filled C1 only. M: a manager who filled C2 only. U: a chain manager who filled both.
            for (sharer in listOf(w.x, w.m, w.u)) {
                val sharee = member("ps-sharee")
                share(w, sharer, sharee)
                for (cycle in listOf(w.c1, w.c2)) {
                    assertResultsParity(sharer, sharee, cycle, w.teamId)
                    assertResultsParity(sharer, sharee, cycle, w.teamId, mode = "subtree")
                    assertCommentsParity(sharer, sharee, cycle, w.teamId)
                }
                assertTrendParity(sharer, sharee, w.teamId)
            }
            // The matrix is non-vacuous: both outcomes occur on the results side.
            assertEquals(HttpStatusCode.OK, w.x.client.results(w.c1, w.teamId).status)
            assertEquals(HttpStatusCode.Forbidden, w.x.client.results(w.c2, w.teamId).status)
            assertEquals(HttpStatusCode.Forbidden, w.m.client.results(w.c1, w.teamId).status)
            assertEquals(HttpStatusCode.OK, w.m.client.results(w.c2, w.teamId).status)
        }

    @Test
    fun `the trend through a share is point-wise on the SHARER's responded set`() = testApplication {
        usePostgresTestcontainer()
        val w = world()
        val viaX = member("ps-sharee")
        val viaM = member("ps-sharee")
        share(w, w.x, viaX)
        share(w, w.m, viaM)
        fun PulseTrendResponse.availability(cycle: UInt) = points.single { it.cycleId == cycle }.availability
        val xTrend = viaX.client.trend(w.teamId).body<PulseTrendResponse>()
        assertEquals(PulseTrendAvailability.OK, xTrend.availability(w.c1))
        assertEquals(PulseTrendAvailability.NOT_A_RESPONDENT, xTrend.availability(w.c2))
        val mTrend = viaM.client.trend(w.teamId).body<PulseTrendResponse>()
        assertEquals(PulseTrendAvailability.NOT_A_RESPONDENT, mTrend.availability(w.c1))
        assertEquals(PulseTrendAvailability.OK, mTrend.availability(w.c2))
    }

    @Test
    fun `the trend is the UNION of what the caller and each passing sharer see - a sat-out cycle is filled by a sharer who took part`() =
        testApplication {
            usePostgresTestcontainer()
            val w = world()
            fun PulseTrendResponse.availability(cycle: UInt) = points.single { it.cycleId == cycle }.availability
            // X sat out C2 but is a member (own right to the team): M's share fills C2 in; C1 stays X's own.
            share(w, w.m, w.x)
            val own = w.x.client.trend(w.teamId).body<PulseTrendResponse>()
            assertEquals(PulseTrendAvailability.OK, own.availability(w.c1))
            assertEquals(PulseTrendAvailability.OK, own.availability(w.c2))
            // Two sharers with DIFFERENT responded sets (X: C1, M: C2) → both points have numbers for the sharee.
            val sharee = member("ps-sharee")
            share(w, w.x, sharee)
            share(w, w.m, sharee)
            val both = sharee.client.trend(w.teamId).body<PulseTrendResponse>()
            assertEquals(PulseTrendAvailability.OK, both.availability(w.c1))
            assertEquals(PulseTrendAvailability.OK, both.availability(w.c2))
            // …and every point is exactly one principal's: the union equals the two single-sharer series merged.
            val viaX = member("ps-sharee")
            share(w, w.x, viaX)
            val xOnly = viaX.client.trend(w.teamId).body<PulseTrendResponse>()
            assertEquals(PulseTrendAvailability.NOT_A_RESPONDENT, xOnly.availability(w.c2))
            assertEquals(xOnly.points.single { it.cycleId == w.c1 }, both.points.single { it.cycleId == w.c1 })
            // A share by a sharer who no longer passes drops out of the union (X leaves the tree).
            TestServices.teams.removeMember(w.teamId, w.x.id)
            val afterLeave = sharee.client.trend(w.teamId).body<PulseTrendResponse>()
            assertEquals(PulseTrendAvailability.NOT_A_RESPONDENT, afterLeave.availability(w.c1))
            assertEquals(PulseTrendAvailability.OK, afterLeave.availability(w.c2))
        }

    @Test
    fun `canReadComments runs the comments guard - two sharers where only the newer one monitors`() =
        testApplication {
            usePostgresTestcontainer()
            val w = world()
            // Case B: the sharee holds an OLDER member share (X) and a NEWER manager share (M). The results of C1
            // come through X (first passing), yet comments are readable through M.
            val sharee = member("ps-sharee")
            share(w, w.x, sharee)
            share(w, w.m, sharee)
            val b = sharee.client.results(w.c1, w.teamId).body<PulseTeamResults>()
            assertEquals(w.x.name, b.sharedBy)
            assertTrue(b.canReadComments)
            assertFalse(b.canShare)
            assertEquals(HttpStatusCode.OK, sharee.client.comments(w.c1, w.teamId).status)
            // A sharee holding only the member share cannot, and the flag agrees.
            val onlyX = member("ps-sharee")
            share(w, w.x, onlyX)
            assertFalse(onlyX.client.results(w.c1, w.teamId).body<PulseTeamResults>().canReadComments)
            assertEquals(HttpStatusCode.Forbidden, onlyX.client.comments(w.c1, w.teamId).status)
        }

    private val insiderDetail = "Comments aren't shared with people who answered this survey for the team"

    @Test
    fun `the insider rule - a share never hands the comments to someone who answered in the scope, the probe agrees`() =
        testApplication {
            usePostgresTestcontainer()
            val w = world()
            // U (answered both cycles, monitors T through M) is the sharer: every cycle passes his gates.
            share(w, w.u, w.x)
            share(w, w.u, w.w)
            // The audit's scenario: X answered C1 inside T. U's share still yields the results, never the comments.
            val capture = LogCapture("ch.nokillswit.audit")
            val a = try {
                w.x.client.results(w.c1, w.teamId).body<PulseTeamResults>().also {
                    // The probe that said "no" wrote neither an hr.* nor an authz.denied event.
                    assertTrue(capture.events.none { e -> e.message == "authz.denied" || e.message.startsWith("hr.") })
                }
            } finally {
                capture.detach()
            }
            assertNull(a.sharedBy, "X reads C1 in his own right")
            assertFalse(a.canReadComments)
            val denied = w.x.client.comments(w.c1, w.teamId)
            assertEquals(HttpStatusCode.Forbidden, denied.status)
            assertEquals(insiderDetail, denied.detail())
            // W did NOT answer C1 (a silent participant, still a member of T): results through the share, comments 200.
            val wResults = w.w.client.results(w.c1, w.teamId)
            assertEquals(HttpStatusCode.OK, wResults.status)
            assertEquals(w.u.name, wResults.body<PulseTeamResults>().sharedBy)
            assertTrue(w.w.client.results(w.c1, w.teamId).body<PulseTeamResults>().canReadComments)
            val wComments = w.w.client.comments(w.c1, w.teamId)
            assertEquals(HttpStatusCode.OK, wComments.status)
            assertEquals(setOf("x says hi", "y says hi"), wComments.body<PulseCommentsResponse>().items.toSet())
            // …but in C2 W answered: refused there in the same shape, and the probe agrees (results stay 200).
            val c2 = w.w.client.results(w.c2, w.teamId)
            assertEquals(HttpStatusCode.OK, c2.status)
            assertFalse(c2.body<PulseTeamResults>().canReadComments)
            assertEquals(insiderDetail, w.w.client.comments(w.c2, w.teamId).detail())
            // X sat out C2: results and comments both flow through U's share.
            val xC2 = w.x.client.results(w.c2, w.teamId).body<PulseTeamResults>()
            assertEquals(w.u.name, xC2.sharedBy)
            assertTrue(xC2.canReadComments)
            // …and a member reading through a share can still SHARE the team (POST /shares would accept it).
            assertTrue(xC2.canShare)
            assertEquals(HttpStatusCode.OK, w.x.client.comments(w.c2, w.teamId).status)
            // An outsider sharee (never in the scope) still gets the comments when the sharer could.
            val outsider = member("ps-sharee")
            share(w, w.u, outsider)
            assertTrue(outsider.client.results(w.c1, w.teamId).body<PulseTeamResults>().canReadComments)
            assertEquals(HttpStatusCode.OK, outsider.client.comments(w.c1, w.teamId).status)
            // Own-right monitors are unchanged (even holding a share): M reads C2's comments, U reads both.
            share(w, w.u, w.m)
            assertEquals(HttpStatusCode.OK, w.m.client.comments(w.c2, w.teamId).status)
            assertTrue(w.m.client.results(w.c2, w.teamId).body<PulseTeamResults>().canReadComments)
            assertEquals(HttpStatusCode.OK, w.u.client.comments(w.c1, w.teamId).status)
        }

    @Test
    fun `the insider rule follows the requested scope - direct versus subtree membership`() = testApplication {
        usePostgresTestcontainer()
        TestPulse.sweepNonTerminal()
        val m = member("ps-s-manager")
        val a = member("ps-s-a")
        val b = member("ps-s-b")
        val c = member("ps-s-c")
        // D = {A, B, C} under M; A manages sub-team S = {P, Q, R}, so P, Q, R are in D's SUBTREE only.
        val d = TestServices.teams.create(Team("PS-D-${UUID.randomUUID()}", m.id, listOf(a.id, b.id, c.id)))
        val p = member("ps-s-p")
        val q = member("ps-s-q")
        val r = member("ps-s-r")
        TestServices.teams.create(Team("PS-S-${UUID.randomUUID()}", a.id, listOf(p.id, q.id, r.id)))
        val cycle = TestPulse.closedCycleWith(
            respondents = mapOf(
                a.id to answers(10, "a"), b.id to answers(9, "b"), c.id to answers(8, "c"),
                p.id to answers(7, "p"), q.id to answers(6), r.id to answers(5),
                m.id to answers(4),
            ),
            closedAt = TestPulse.closedAtAfterAll(),
        )
        val shares = application.attributes[ShareServiceKey]
        // P answered, sits in the sub-team only. M shares D with P.
        shares.create(ShareableResourceType.PULSE_TEAM_RESULTS, d, m.id, p.id, null)
        suspend fun comments(mode: String) = p.client.get("$cyclesUrl/${cycle.id}/comments") {
            parameter("teamId", d)
            parameter("mode", mode)
        }
        // P is in the scope only in subtree mode; P cannot read D's RESULTS own-right either way except as a sharee,
        // so the share yields the results in both modes — the comments follow the scope.
        assertEquals(HttpStatusCode.OK, p.client.results(cycle.id, d, "direct").status)
        assertEquals(HttpStatusCode.OK, comments("direct").status)
        assertTrue(p.client.results(cycle.id, d, "direct").body<PulseTeamResults>().canReadComments)
        assertEquals(HttpStatusCode.Forbidden, comments("subtree").status)
        assertFalse(p.client.results(cycle.id, d, "subtree").body<PulseTeamResults>().canReadComments)
    }

    @Test
    fun `the capability probe writes no audit noise - no hr read and no denial event`() = testApplication {
        usePostgresTestcontainer()
        val w = world()
        val onlyX = member("ps-sharee")
        share(w, w.x, onlyX)
        val hr = member("ps-hr", roles = setOf(UserRole.HR))
        val capture = LogCapture("ch.nokillswit.audit")
        try {
            // A member-sharer's sharee: the probe fails internally (Forbidden) — it must not surface as authz.denied.
            assertEquals(HttpStatusCode.OK, onlyX.client.results(w.c1, w.teamId).status)
            assertFalse(onlyX.client.results(w.c1, w.teamId).body<PulseTeamResults>().canReadComments)
            // A plain member's own read: the probe finds no share and says false, silently.
            assertFalse(w.x.client.results(w.c1, w.teamId).body<PulseTeamResults>().canReadComments)
            assertTrue(capture.events.none { it.message == "authz.denied" || it.message.startsWith("hr.") })
            // The HR caller's own read emits hr.read for the READ only (resource pulseResults), never pulseComments.
            assertEquals(HttpStatusCode.OK, hr.client.results(w.c1, w.teamId).status)
            assertNotNull(capture.awaitEvent { it.message == "hr.read" && it.hasKeyValue("resource", "pulseResults") })
            assertTrue(capture.events.none { it.hasKeyValue("resource", "pulseComments") })
        } finally {
            capture.detach()
        }
    }

    @Test
    fun `comments - a manager-sharer passes them on, a member-sharer has none to pass on`() = testApplication {
        usePostgresTestcontainer()
        val w = world()
        val viaM = member("ps-sharee")
        val viaX = member("ps-sharee")
        share(w, w.m, viaM)
        share(w, w.x, viaX)
        val fromManager = viaM.client.comments(w.c2, w.teamId)
        assertEquals(HttpStatusCode.OK, fromManager.status)
        assertEquals(setOf("y again", "w says hi"), fromManager.body<PulseCommentsResponse>().items.toSet())
        val denied = viaX.client.comments(w.c1, w.teamId)
        assertEquals(HttpStatusCode.Forbidden, denied.status)
        assertEquals(lapse, denied.detail())
        // The DTO flag tells the card in advance (no routine 403): the sharee through M may ask, through X may not.
        assertTrue(viaM.client.results(w.c2, w.teamId).body<PulseTeamResults>().canReadComments)
        assertFalse(viaX.client.results(w.c1, w.teamId).body<PulseTeamResults>().canReadComments)
    }

    @Test
    fun `k-anonymity stays - a scope under 3 responses is withheld for the sharee as for the sharer`() = testApplication {
        usePostgresTestcontainer()
        TestPulse.sweepNonTerminal()
        val m = member("ps-k-manager")
        val a = member("ps-k-a")
        val b = member("ps-k-b")
        val c = member("ps-k-c")
        val teamId = TestServices.teams.create(Team("PS-K-${UUID.randomUUID()}", m.id, listOf(a.id, b.id, c.id)))
        val cycle = TestPulse.closedCycleWith(
            respondents = mapOf(a.id to answers(10, "secret"), b.id to answers(0)),
            silentParticipants = listOf(c.id),
            closedAt = TestPulse.closedAtAfterAll(),
        )
        val sharee = member("ps-sharee")
        application.attributes[ShareServiceKey].create(ShareableResourceType.PULSE_TEAM_RESULTS, teamId, a.id, sharee.id, null)
        val block = sharee.client.results(cycle.id, teamId).body<PulseTeamResults>()
        assertTrue(block.insufficientResponses)
        assertNull(block.enps)
        assertNull(block.drivers)
        assertEquals(2, block.responseCount)
        assertEquals(a.name, block.sharedBy)
    }

    @Test
    fun `the DTO flags on own reads - canShare for a non-HR own reader, canReadComments for a monitor, HR alone cannot share`() =
        testApplication {
            usePostgresTestcontainer()
            val w = world()
            val hr = member("ps-hr", roles = setOf(UserRole.HR))
            val x = w.x.client.results(w.c1, w.teamId).body<PulseTeamResults>()
            assertTrue(x.canShare)
            assertNull(x.sharedBy)
            assertFalse(x.canReadComments)
            val m = w.m.client.results(w.c2, w.teamId).body<PulseTeamResults>()
            assertTrue(m.canShare)
            assertTrue(m.canReadComments)
            assertTrue(w.u.client.results(w.c1, w.teamId).body<PulseTeamResults>().canReadComments)
            // The HR auditor reads (org-wide) and may open comments, but holds no own right to share.
            val auditor = hr.client.results(w.c1, w.teamId).body<PulseTeamResults>()
            assertFalse(auditor.canShare)
            assertNull(auditor.sharedBy)
            assertTrue(auditor.canReadComments)
            // An HR user who is also a member of the team reads in their own right → canShare.
            val hrMember = member("ps-hr-member", roles = setOf(UserRole.HR))
            TestServices.teams.addMember(w.teamId, hrMember.id)
            assertTrue(hrMember.client.results(w.c1, w.teamId).body<PulseTeamResults>().canShare)
        }

    @Test
    fun `no hr audit event for a sharee read, the auditor's own read is still audited`() = testApplication {
        usePostgresTestcontainer()
        val w = world()
        val viaX = member("ps-sharee")
        val viaM = member("ps-sharee")
        share(w, w.x, viaX)
        share(w, w.m, viaM)
        val hr = member("ps-hr", roles = setOf(UserRole.HR))
        // A sharee who is ALSO an HR user is read on their OWN path first (audited as without a share).
        val hrSharee = member("ps-hr-sharee", roles = setOf(UserRole.HR))
        share(w, w.m, hrSharee)
        val capture = LogCapture("ch.nokillswit.audit")
        try {
            assertEquals(HttpStatusCode.OK, viaX.client.results(w.c1, w.teamId).status)
            assertEquals(HttpStatusCode.OK, viaM.client.results(w.c2, w.teamId).status)
            assertEquals(HttpStatusCode.OK, viaM.client.comments(w.c2, w.teamId).status)
            assertEquals(HttpStatusCode.OK, viaX.client.trend(w.teamId).status)
            assertEquals(HttpStatusCode.OK, viaM.client.trend(w.teamId).status)
            assertTrue(capture.events.none { it.message.startsWith("hr.") }, "a share read must never emit hr.*")
            assertEquals(HttpStatusCode.OK, hr.client.results(w.c1, w.teamId).status)
            assertNotNull(
                capture.awaitEvent { it.message == "hr.read" && it.hasKeyValue("resource", "pulseResults") },
            )
            // The HR sharee reads on the HR path (no share involved): hr.read emitted, no sharer named.
            val before = capture.events.count { it.message == "hr.read" }
            val hrBlock = hrSharee.client.results(w.c1, w.teamId).body<PulseTeamResults>()
            assertNull(hrBlock.sharedBy)
            assertEquals(before + 1, capture.events.count { it.message == "hr.read" })
        } finally {
            capture.detach()
        }
    }

    @Test
    fun `order stays 404, 409-state, 403-identity - the share lookup comes last, no share keeps the original denial`() =
        testApplication {
            usePostgresTestcontainer()
            val w = world()
            val sharee = member("ps-sharee")
            val stranger = member("ps-stranger")
            share(w, w.m, sharee)
            // 404: unknown cycle / unknown team (even for a sharee).
            assertEquals(HttpStatusCode.NotFound, sharee.client.results(999_999_999u, w.teamId).status)
            assertEquals(HttpStatusCode.NotFound, sharee.client.results(w.c2, 999_999_999u).status)
            assertEquals(HttpStatusCode.NotFound, sharee.client.trend(999_999_999u).status)
            // 409: an OPEN and a CANCELLED cycle are uniform — a share never reaches them.
            val open = TestPulse.cycles.schedule(ch.nokillswit.pulse.PulseCycleCreateRequest("2099-01-01", "2099-01-08"))
            try {
                TestPulse.addParticipants(open, listOf(w.x.id, w.y.id, w.z.id))
                TestPulse.forceStatus(open, PulseCycleStatus.OPEN, openedAt = System.currentTimeMillis())
                assertEquals(HttpStatusCode.Conflict, sharee.client.results(open, w.teamId).status)
                assertEquals(HttpStatusCode.Conflict, sharee.client.comments(open, w.teamId).status)
                TestPulse.forceStatus(open, PulseCycleStatus.CANCELLED)
                assertEquals(HttpStatusCode.Conflict, sharee.client.results(open, w.teamId).status)
            } finally {
                TestPulse.sweepNonTerminal()
            }
            // 403: no active share → the ORIGINAL denial (not the lapse wording).
            val noShare = stranger.client.results(w.c2, w.teamId)
            assertEquals(HttpStatusCode.Forbidden, noShare.status)
            assertEquals("Results are available only for cycles you took part in", noShare.detail())
            assertEquals(HttpStatusCode.Forbidden, stranger.client.comments(w.c2, w.teamId).status)
            assertEquals(HttpStatusCode.Forbidden, stranger.client.trend(w.teamId).status)
            // The cancelled cycle drops out of the trend; results stay 409 for sharer and sharee alike.
            assertTrue(sharee.client.trend(w.teamId).body<PulseTrendResponse>().points.none { it.cycleId == open })
            assertEquals(HttpStatusCode.Conflict, w.m.client.results(open, w.teamId).status)
        }

    @Test
    fun `a withdrawn or expired share grants nothing and the denial is the original one`() = testApplication {
        usePostgresTestcontainer()
        val w = world()
        val withdrawn = member("ps-sharee")
        val expired = member("ps-sharee")
        val shares = application.attributes[ShareServiceKey]
        val id = share(w, w.m, withdrawn)
        assertEquals(HttpStatusCode.OK, withdrawn.client.results(w.c2, w.teamId).status)
        shares.withdraw(id, w.m.id)
        val afterWithdraw = withdrawn.client.results(w.c2, w.teamId)
        assertEquals(HttpStatusCode.Forbidden, afterWithdraw.status)
        assertEquals("Results are available only for cycles you took part in", afterWithdraw.detail())
        assertEquals(HttpStatusCode.Forbidden, withdrawn.client.trend(w.teamId).status)
        // An already-expired row is unreachable through the API; the service accepts it directly.
        shares.create(
            ShareableResourceType.PULSE_TEAM_RESULTS, w.teamId, w.m.id, expired.id, shares.today().minusDays(1).toString(),
        )
        assertEquals("Results are available only for cycles you took part in", expired.client.results(w.c2, w.teamId).detail())
    }

    @Test
    fun `the lapse - the sharer leaving the tree, deactivated or flag-off ends the share, restoring brings it back`() =
        testApplication {
            usePostgresTestcontainer()
            val w = world()
            val sharee = member("ps-sharee")
            share(w, w.x, sharee)
            assertEquals(HttpStatusCode.OK, sharee.client.results(w.c1, w.teamId).status)

            TestServices.teams.removeMember(w.teamId, w.x.id)
            val left = sharee.client.results(w.c1, w.teamId)
            assertEquals(HttpStatusCode.Forbidden, left.status)
            assertEquals(lapse, left.detail())
            assertEquals(lapse, sharee.client.trend(w.teamId).detail())
            TestServices.teams.addMember(w.teamId, w.x.id)
            assertEquals(HttpStatusCode.OK, sharee.client.results(w.c1, w.teamId).status)

            assertEquals(1, TestServices.users.setDeactivated(w.x.id, true))
            assertEquals(lapse, sharee.client.results(w.c1, w.teamId).detail())
            assertEquals(1, TestServices.users.setDeactivated(w.x.id, false))
            assertEquals(HttpStatusCode.OK, sharee.client.results(w.c1, w.teamId).status)

            TestServices.users.setDisabledFeatures(w.x.id, setOf(Feature.PULSE_SURVEYS) + OPT_IN_FEATURES)
            assertEquals(lapse, sharee.client.results(w.c1, w.teamId).detail())
            TestServices.users.setDisabledFeatures(w.x.id, OPT_IN_FEATURES)
            assertEquals(HttpStatusCode.OK, sharee.client.results(w.c1, w.teamId).status)

            // A soft-deleted team is 404 before any share is consulted.
            assertEquals(1, TestServices.teams.delete(w.teamId))
            assertEquals(HttpStatusCode.NotFound, sharee.client.results(w.c1, w.teamId).status)
        }

    @Test
    fun `the sharee's own PULSE_SURVEYS flag is the first gate - an active healthy share does not help`() = testApplication {
        usePostgresTestcontainer()
        val w = world()
        val off = member("ps-flag-off", disabled = setOf(Feature.PULSE_SURVEYS))
        share(w, w.m, off)
        assertEquals(HttpStatusCode.Forbidden, off.client.results(w.c2, w.teamId).status)
        assertEquals(HttpStatusCode.Forbidden, off.client.comments(w.c2, w.teamId).status)
        assertEquals(HttpStatusCode.Forbidden, off.client.trend(w.teamId).status)
    }

    @Test
    fun `an ADMIN sharee reads aggregates through the share - accepted, the narrowed-ADMIN rule governs the role's own rights`() =
        testApplication {
            usePostgresTestcontainer()
            val w = world()
            val admin = member("ps-admin", roles = setOf(UserRole.ADMIN))
            assertEquals(HttpStatusCode.Forbidden, admin.client.results(w.c2, w.teamId).status)
            share(w, w.m, admin)
            val block = admin.client.results(w.c2, w.teamId).body<PulseTeamResults>()
            assertEquals(w.m.name, block.sharedBy)
            assertFalse(block.canShare)
        }

    @Test
    fun `participation-status and my-response stay own-right - a share grants neither`() = testApplication {
        usePostgresTestcontainer()
        val w = world()
        val sharee = member("ps-sharee")
        share(w, w.m, sharee)
        // participation-status lists the caller's OWN monitored teams (empty for a non-manager): no row for the shared team.
        val status = sharee.client.get("$cyclesUrl/${w.c2}/participation-status")
        assertEquals(HttpStatusCode.OK, status.status)
        assertTrue(status.body<PulseParticipationStatusResponse>().teams.isEmpty())
        assertEquals(HttpStatusCode.Forbidden, sharee.client.get("$cyclesUrl/${w.c2}/my-response").status)
    }
}
