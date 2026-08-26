package ch.nokillswit

import ch.nokillswit.goals.GoalCreateRequest
import ch.nokillswit.goals.GoalStatus
import ch.nokillswit.goals.GoalType
import ch.nokillswit.notifications.NotificationPageResponse
import ch.nokillswit.succession.CandidateAwareness
import ch.nokillswit.succession.NominationType
import ch.nokillswit.succession.RetentionRisk
import ch.nokillswit.succession.RoleCriticality
import ch.nokillswit.succession.SuccessionNominationRequest
import ch.nokillswit.succession.SuccessionNominationResponse
import ch.nokillswit.succession.SuccessionPlanCreateRequest
import ch.nokillswit.succession.SuccessionPlanPageResponse
import ch.nokillswit.succession.SuccessionPlanResponse
import ch.nokillswit.succession.SuccessionPlanStatus
import ch.nokillswit.succession.SuccessionPlanUpdate
import ch.nokillswit.succession.SuccessorReadiness
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
import kotlinx.coroutines.delay
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class SuccessionRoutesTest {

    private data class Chain(
        val grandId: UInt,
        val grandEmail: String,
        val managerId: UInt,
        val managerEmail: String,
        val seatId: UInt,
        val seatEmail: String,
        val candidateId: UInt,
        val candidateEmail: String,
    )

    /**
     * grand → manager → {seat person, candidate}: the manager owns the plans, the grand
     * manager is the chain above the owner, the seat person and the candidate are the
     * feature's invisible subjects. Fresh users/teams per call, so tests never interfere.
     */
    private suspend fun seedChain(): Chain {
        val grandEmail = uniqueEmail("succ-grand")
        val grandId = TestUsers.seed(grandEmail, "pw", name = "Grand Manager", roles = emptySet())
        val managerEmail = uniqueEmail("succ-manager")
        val managerId = TestUsers.seed(managerEmail, "pw", name = "Mona Manager", roles = emptySet())
        val seatEmail = uniqueEmail("succ-seat")
        val seatId = TestUsers.seed(seatEmail, "pw", name = "Sam Seat", roles = emptySet())
        val candidateEmail = uniqueEmail("succ-candidate")
        val candidateId = TestUsers.seed(candidateEmail, "pw", name = "Cleo Candidate", roles = emptySet())
        val grandTeam = TestServices.teams.create(Team(name = "succ-g-${UUID.randomUUID()}", managerId = grandId))
        TestServices.teams.addMember(grandTeam, managerId)
        val team = TestServices.teams.create(Team(name = "succ-${UUID.randomUUID()}", managerId = managerId))
        TestServices.teams.addMember(team, seatId)
        TestServices.teams.addMember(team, candidateId)
        return Chain(grandId, grandEmail, managerId, managerEmail, seatId, seatEmail, candidateId, candidateEmail)
    }

    private fun planBody(
        userId: UInt,
        roleCriticality: RoleCriticality = RoleCriticality.CRITICAL,
        retentionRisk: RetentionRisk = RetentionRisk.HIGH,
        lossImpact: List<String> = listOf("Key client relationships", "Payments domain knowledge"),
        targetBenchDepth: Int = 2,
    ) = SuccessionPlanCreateRequest(
        userId = userId,
        roleCriticality = roleCriticality,
        retentionRisk = retentionRisk,
        lossImpact = lossImpact,
        targetBenchDepth = targetBenchDepth,
    )

    private fun nominationBody(
        candidateId: UInt,
        readiness: SuccessorReadiness = SuccessorReadiness.READY_SOON,
        nominationType: NominationType = NominationType.PRIMARY,
        competencyGaps: List<String> = listOf("Stakeholder management"),
        awareness: CandidateAwareness = CandidateAwareness.IMPLICIT,
        goalIds: List<UInt> = emptyList(),
    ) = SuccessionNominationRequest(
        candidateId = candidateId,
        readiness = readiness,
        nominationType = nominationType,
        competencyGaps = competencyGaps,
        awareness = awareness,
        goalIds = goalIds,
    )

    private suspend fun HttpClient.createPlan(body: SuccessionPlanCreateRequest): SuccessionPlanResponse {
        val response = post("/api/v1/succession-plans") {
            contentType(ContentType.Application.Json)
            setBody(body)
        }
        assertEquals(HttpStatusCode.Created, response.status)
        return response.body<SuccessionPlanResponse>()
    }

    private suspend fun HttpClient.nominate(
        planId: UInt,
        body: SuccessionNominationRequest,
    ): SuccessionNominationResponse {
        val response = post("/api/v1/succession-plans/$planId/nominations") {
            contentType(ContentType.Application.Json)
            setBody(body)
        }
        assertEquals(HttpStatusCode.Created, response.status)
        return response.body<SuccessionNominationResponse>()
    }

    private suspend fun HttpClient.readPlan(planId: UInt): SuccessionPlanResponse {
        val response = get("/api/v1/succession-plans/$planId")
        assertEquals(HttpStatusCode.OK, response.status)
        return response.body<SuccessionPlanResponse>()
    }

    // ---- creation ----

    @Test
    fun `create and read round-trip - owner from the JWT, Location header, empty bench, no notifications`() =
        testApplication {
            usePostgresTestcontainer()
            val chain = seedChain()
            val manager = authedClient(chain.managerEmail, "pw")

            val response = manager.post("/api/v1/succession-plans") {
                contentType(ContentType.Application.Json)
                setBody(planBody(chain.seatId))
            }
            assertEquals(HttpStatusCode.Created, response.status)
            val created = response.body<SuccessionPlanResponse>()
            val location = response.headers["Location"]
            assertNotNull(location)
            assertTrue(location.endsWith("/api/v1/succession-plans/${created.id}"), "Location was $location")
            assertEquals(chain.managerId, created.managerId)
            assertEquals("Mona Manager", created.managerName)
            assertEquals(chain.seatId, created.userId)
            assertEquals("Sam Seat", created.userName)
            assertEquals(RoleCriticality.CRITICAL, created.roleCriticality)
            assertEquals(RetentionRisk.HIGH, created.retentionRisk)
            assertEquals(listOf("Key client relationships", "Payments domain knowledge"), created.lossImpact)
            assertEquals(2, created.targetBenchDepth)
            assertEquals(SuccessionPlanStatus.OPEN, created.status)
            assertEquals(0, created.benchCount)
            assertEquals(emptyList(), created.nominations)
            assertTrue(created.createdAt > 0)
            assertEquals(created.createdAt, created.lastReviewedAt)
            assertEquals(created, manager.readPlan(created.id))

            // Confidentiality pin: neither the seat's person nor a nominated candidate is ever
            // notified — succession planning mints NO notifications at all.
            manager.nominate(created.id, nominationBody(chain.candidateId))
            val seat = authedClient(chain.seatEmail, "pw")
            val candidate = authedClient(chain.candidateEmail, "pw")
            assertEquals(0, seat.get("/api/v1/notifications").body<NotificationPageResponse>().total)
            assertEquals(0, candidate.get("/api/v1/notifications").body<NotificationPageResponse>().total)
        }

    @Test
    fun `create enforces the transitive chain rule and blocks deactivated seat persons`() = testApplication {
        usePostgresTestcontainer()
        val chain = seedChain()
        val admin = authedClient(uniqueEmail("succ-admin").also { TestUsers.seed(it, "pw") }, "pw")

        // The seat person manages nobody — planning for their own manager is 403.
        val seat = authedClient(chain.seatEmail, "pw")
        val up = seat.post("/api/v1/succession-plans") {
            contentType(ContentType.Application.Json)
            setBody(planBody(chain.managerId))
        }
        assertEquals(HttpStatusCode.Forbidden, up.status)

        // An outsider is not in the manager's chain either.
        val outsiderId = TestUsers.seed(uniqueEmail("succ-outsider"), "pw", roles = emptySet())
        val manager = authedClient(chain.managerEmail, "pw")
        val sideways = manager.post("/api/v1/succession-plans") {
            contentType(ContentType.Application.Json)
            setBody(planBody(outsiderId))
        }
        assertEquals(HttpStatusCode.Forbidden, sideways.status)

        // The GRAND manager holds the right transitively (the chain rule).
        val grand = authedClient(chain.grandEmail, "pw")
        val skipLevel = grand.post("/api/v1/succession-plans") {
            contentType(ContentType.Application.Json)
            setBody(planBody(chain.seatId))
        }
        assertEquals(HttpStatusCode.Created, skipLevel.status)

        // A deactivated seat person cannot get a NEW plan (403 wins over 400 was covered above;
        // here the chain check passes, so the deactivation rule fires).
        assertEquals(
            HttpStatusCode.NoContent,
            admin.post("/api/v1/users/${chain.seatId}/deactivate").status,
        )
        val deactivated = manager.post("/api/v1/succession-plans") {
            contentType(ContentType.Application.Json)
            setBody(planBody(chain.seatId))
        }
        assertEquals(HttpStatusCode.BadRequest, deactivated.status)
    }

    @Test
    fun `one OPEN plan per owner and person - closed or deleted plans never block, another manager keeps their own`() =
        testApplication {
            usePostgresTestcontainer()
            val chain = seedChain()
            val manager = authedClient(chain.managerEmail, "pw")

            val first = manager.createPlan(planBody(chain.seatId))
            val duplicate = manager.post("/api/v1/succession-plans") {
                contentType(ContentType.Application.Json)
                setBody(planBody(chain.seatId))
            }
            assertEquals(HttpStatusCode.Conflict, duplicate.status)

            // The GRAND manager's own plan for the same person is independent — uniqueness is
            // per (owner, person).
            val grand = authedClient(chain.grandEmail, "pw")
            grand.createPlan(planBody(chain.seatId))

            // Closing frees the slot…
            assertEquals(HttpStatusCode.NoContent, manager.post("/api/v1/succession-plans/${first.id}/close").status)
            val second = manager.createPlan(planBody(chain.seatId))
            // …and so does deleting.
            assertEquals(HttpStatusCode.NoContent, manager.delete("/api/v1/succession-plans/${second.id}").status)
            manager.createPlan(planBody(chain.seatId))
        }

    @Test
    fun `create validates the loss-impact list and the bench depth`() = testApplication {
        usePostgresTestcontainer()
        val chain = seedChain()
        val manager = authedClient(chain.managerEmail, "pw")

        suspend fun expect400(body: SuccessionPlanCreateRequest) {
            val response = manager.post("/api/v1/succession-plans") {
                contentType(ContentType.Application.Json)
                setBody(body)
            }
            assertEquals(HttpStatusCode.BadRequest, response.status)
        }
        expect400(planBody(chain.seatId, lossImpact = listOf("  ")))
        expect400(planBody(chain.seatId, lossImpact = listOf("x".repeat(201))))
        expect400(planBody(chain.seatId, lossImpact = List(21) { "item $it" }))
        expect400(planBody(chain.seatId, targetBenchDepth = 0))
        expect400(planBody(chain.seatId, targetBenchDepth = 11))
    }

    // ---- reads ----

    @Test
    fun `read matrix - owner, chain above the owner, and HR read - the seat person, the candidate, and ADMIN get 403`() =
        testApplication {
            usePostgresTestcontainer()
            val chain = seedChain()
            val manager = authedClient(chain.managerEmail, "pw")
            val plan = manager.createPlan(planBody(chain.seatId))
            manager.nominate(plan.id, nominationBody(chain.candidateId))

            val grand = authedClient(chain.grandEmail, "pw")
            assertEquals(HttpStatusCode.OK, grand.get("/api/v1/succession-plans/${plan.id}").status)

            val hrEmail = uniqueEmail("succ-hr")
            TestUsers.seed(hrEmail, "pw", roles = setOf(UserRole.HR))
            val hr = authedClient(hrEmail, "pw")
            assertEquals(HttpStatusCode.OK, hr.get("/api/v1/succession-plans/${plan.id}").status)

            // The feature is invisible to its subjects: the seat's person and the nominated
            // candidate get 403 whatever the awareness value says.
            val seat = authedClient(chain.seatEmail, "pw")
            assertEquals(HttpStatusCode.Forbidden, seat.get("/api/v1/succession-plans/${plan.id}").status)
            val candidate = authedClient(chain.candidateEmail, "pw")
            assertEquals(HttpStatusCode.Forbidden, candidate.get("/api/v1/succession-plans/${plan.id}").status)

            // ADMIN-as-such gets nothing (the narrowed-ADMIN rule), nor does a stranger.
            val adminEmail = uniqueEmail("succ-admin")
            TestUsers.seed(adminEmail, "pw")
            val admin = authedClient(adminEmail, "pw")
            assertEquals(HttpStatusCode.Forbidden, admin.get("/api/v1/succession-plans/${plan.id}").status)

            // Missing id is 404 (read-before-guard) for a legitimate caller.
            assertEquals(HttpStatusCode.NotFound, manager.get("/api/v1/succession-plans/999999999").status)
        }

    // ---- writes & lifecycle ----

    @Test
    fun `update is owner-only, leaves the reviewed stamp alone, and a closed plan is read-only`() = testApplication {
        usePostgresTestcontainer()
        val chain = seedChain()
        val manager = authedClient(chain.managerEmail, "pw")
        val plan = manager.createPlan(planBody(chain.seatId))

        // The chain above READS but never writes (the authorship carve-out).
        val grand = authedClient(chain.grandEmail, "pw")
        val update = SuccessionPlanUpdate(
            roleCriticality = RoleCriticality.CORE,
            retentionRisk = RetentionRisk.MEDIUM,
            lossImpact = listOf("Institutional memory"),
            targetBenchDepth = 3,
        )
        val denied = grand.put("/api/v1/succession-plans/${plan.id}") {
            contentType(ContentType.Application.Json)
            setBody(update)
        }
        assertEquals(HttpStatusCode.Forbidden, denied.status)

        val ok = manager.put("/api/v1/succession-plans/${plan.id}") {
            contentType(ContentType.Application.Json)
            setBody(update)
        }
        assertEquals(HttpStatusCode.NoContent, ok.status)
        val edited = manager.readPlan(plan.id)
        assertEquals(RoleCriticality.CORE, edited.roleCriticality)
        assertEquals(RetentionRisk.MEDIUM, edited.retentionRisk)
        assertEquals(listOf("Institutional memory"), edited.lossImpact)
        assertEquals(3, edited.targetBenchDepth)
        // v2.44.0: editing is NOT reviewing — only the explicit complete-review stamps.
        assertEquals(plan.lastReviewedAt, edited.lastReviewedAt)
        assertEquals(plan.createdAt, edited.createdAt)

        assertEquals(HttpStatusCode.NoContent, manager.post("/api/v1/succession-plans/${plan.id}/close").status)
        val afterClose = manager.put("/api/v1/succession-plans/${plan.id}") {
            contentType(ContentType.Application.Json)
            setBody(update)
        }
        assertEquals(HttpStatusCode.Conflict, afterClose.status)
    }

    @Test
    fun `close is terminal - repeat close 409, nominations frozen, browsing stays, delete still works`() =
        testApplication {
            usePostgresTestcontainer()
            val chain = seedChain()
            val manager = authedClient(chain.managerEmail, "pw")
            val plan = manager.createPlan(planBody(chain.seatId))
            val nomination = manager.nominate(plan.id, nominationBody(chain.candidateId))

            assertEquals(HttpStatusCode.NoContent, manager.post("/api/v1/succession-plans/${plan.id}/close").status)
            assertEquals(HttpStatusCode.Conflict, manager.post("/api/v1/succession-plans/${plan.id}/close").status)

            // A closed plan stays browsable — nominations included — but every mutation is 409.
            val closed = manager.readPlan(plan.id)
            assertEquals(SuccessionPlanStatus.CLOSED, closed.status)
            assertEquals(1, closed.benchCount)
            val addNomination = manager.post("/api/v1/succession-plans/${plan.id}/nominations") {
                contentType(ContentType.Application.Json)
                setBody(nominationBody(chain.seatId + 1000u))
            }
            assertEquals(HttpStatusCode.Conflict, addNomination.status)
            val editNomination = manager.put("/api/v1/succession-plans/${plan.id}/nominations/${nomination.id}") {
                contentType(ContentType.Application.Json)
                setBody(nominationBody(chain.candidateId, readiness = SuccessorReadiness.READY_NOW))
            }
            assertEquals(HttpStatusCode.Conflict, editNomination.status)
            assertEquals(
                HttpStatusCode.Conflict,
                manager.delete("/api/v1/succession-plans/${plan.id}/nominations/${nomination.id}").status,
            )

            // Deleting a closed plan is fine — and the row then 404s.
            assertEquals(HttpStatusCode.NoContent, manager.delete("/api/v1/succession-plans/${plan.id}").status)
            assertEquals(HttpStatusCode.NotFound, manager.get("/api/v1/succession-plans/${plan.id}").status)
            assertEquals(HttpStatusCode.NotFound, manager.delete("/api/v1/succession-plans/${plan.id}").status)
        }

    @Test
    fun `complete review - the sole reviewed-stamp writer, owner-only, OPEN-only`() = testApplication {
        usePostgresTestcontainer()
        val chain = seedChain()
        val manager = authedClient(chain.managerEmail, "pw")
        val plan = manager.createPlan(planBody(chain.seatId))
        val stampAtCreate = plan.lastReviewedAt

        // Mutations leave the stamp alone (v2.44.0)…
        manager.nominate(plan.id, nominationBody(chain.candidateId))
        assertEquals(stampAtCreate, manager.readPlan(plan.id).lastReviewedAt)

        // …and only the owner may complete a review (the chain reads, the seat sees nothing).
        val grand = authedClient(chain.grandEmail, "pw")
        assertEquals(
            HttpStatusCode.Forbidden,
            grand.post("/api/v1/succession-plans/${plan.id}/complete-review").status,
        )
        val seat = authedClient(chain.seatEmail, "pw")
        assertEquals(
            HttpStatusCode.Forbidden,
            seat.post("/api/v1/succession-plans/${plan.id}/complete-review").status,
        )

        delay(5) // epoch-millis stamp — guarantee a strictly later review moment
        assertEquals(
            HttpStatusCode.NoContent,
            manager.post("/api/v1/succession-plans/${plan.id}/complete-review").status,
        )
        val reviewed = manager.readPlan(plan.id)
        assertTrue(reviewed.lastReviewedAt > stampAtCreate)
        assertEquals(stampAtCreate, reviewed.createdAt)

        // Repeatable (not a transition), but a CLOSED plan is read-only; unknown id 404s.
        assertEquals(
            HttpStatusCode.NoContent,
            manager.post("/api/v1/succession-plans/${plan.id}/complete-review").status,
        )
        assertEquals(HttpStatusCode.NoContent, manager.post("/api/v1/succession-plans/${plan.id}/close").status)
        assertEquals(
            HttpStatusCode.Conflict,
            manager.post("/api/v1/succession-plans/${plan.id}/complete-review").status,
        )
        assertEquals(
            HttpStatusCode.NotFound,
            manager.post("/api/v1/succession-plans/999999999/complete-review").status,
        )
    }

    // ---- nominations ----

    @Test
    fun `nomination round-trip with goal links - payload order kept, reviewed stamp untouched, wholesale replace`() =
        testApplication {
            usePostgresTestcontainer()
            val chain = seedChain()
            val manager = authedClient(chain.managerEmail, "pw")
            val plan = manager.createPlan(planBody(chain.seatId))

            // Two development goals of the CANDIDATE, authored by the plan's owner.
            val goalA = TestServices.goals.create(
                chain.managerId,
                GoalCreateRequest(
                    subordinateId = chain.candidateId,
                    title = "Lead the payments on-call rotation",
                    type = GoalType.NUMBER,
                    targetValue = 4.0,
                    dueDate = "2027-12-31",
                ),
            )
            val goalB = TestServices.goals.create(
                chain.managerId,
                GoalCreateRequest(
                    subordinateId = chain.candidateId,
                    title = "Present the roadmap to the board",
                    type = GoalType.NUMBER,
                    targetValue = 1.0,
                    dueDate = "2027-12-31",
                ),
            )

            val created = manager.nominate(
                plan.id,
                nominationBody(chain.candidateId, goalIds = listOf(goalB, goalA)),
            )
            assertEquals(chain.candidateId, created.candidateId)
            assertEquals("Cleo Candidate", created.candidateName)
            assertEquals(SuccessorReadiness.READY_SOON, created.readiness)
            assertEquals(NominationType.PRIMARY, created.nominationType)
            assertEquals(listOf("Stakeholder management"), created.competencyGaps)
            assertEquals(CandidateAwareness.IMPLICIT, created.awareness)
            // Payload order IS the order.
            assertEquals(listOf(goalB, goalA), created.goals.map { it.id })
            assertEquals("Present the roadmap to the board", created.goals[0].title)
            assertEquals(GoalStatus.DRAFT, created.goals[0].status)

            val afterCreate = manager.readPlan(plan.id)
            assertEquals(1, afterCreate.benchCount)
            // v2.44.0: nomination mutations never touch the reviewed stamp.
            assertEquals(plan.lastReviewedAt, afterCreate.lastReviewedAt)

            // The PUT replaces the whole document — links included (goalA alone now).
            val edit = manager.put("/api/v1/succession-plans/${plan.id}/nominations/${created.id}") {
                contentType(ContentType.Application.Json)
                setBody(
                    nominationBody(
                        chain.candidateId,
                        readiness = SuccessorReadiness.READY_NOW,
                        nominationType = NominationType.SECONDARY,
                        competencyGaps = listOf("Budget ownership", "Hiring"),
                        awareness = CandidateAwareness.TRANSPARENT,
                        goalIds = listOf(goalA),
                    ),
                )
            }
            assertEquals(HttpStatusCode.NoContent, edit.status)
            val edited = manager.readPlan(plan.id).nominations.single()
            assertEquals(SuccessorReadiness.READY_NOW, edited.readiness)
            assertEquals(NominationType.SECONDARY, edited.nominationType)
            assertEquals(listOf("Budget ownership", "Hiring"), edited.competencyGaps)
            assertEquals(CandidateAwareness.TRANSPARENT, edited.awareness)
            assertEquals(listOf(goalA), edited.goals.map { it.id })

            assertEquals(
                HttpStatusCode.NoContent,
                manager.delete("/api/v1/succession-plans/${plan.id}/nominations/${created.id}").status,
            )
            assertEquals(0, manager.readPlan(plan.id).benchCount)
            assertEquals(
                HttpStatusCode.NotFound,
                manager.delete("/api/v1/succession-plans/${plan.id}/nominations/${created.id}").status,
            )
        }

    @Test
    fun `one primary per plan - a write that sets PRIMARY demotes the standing one, on create and on edit`() =
        testApplication {
            usePostgresTestcontainer()
            val chain = seedChain()
            val secondId = TestUsers.seed(uniqueEmail("succ-candidate2"), "pw", name = "Nina Nominee", roles = emptySet())
            val thirdId = TestUsers.seed(uniqueEmail("succ-candidate3"), "pw", name = "Theo Third", roles = emptySet())
            val manager = authedClient(chain.managerEmail, "pw")
            val plan = manager.createPlan(planBody(chain.seatId))

            val first = manager.nominate(plan.id, nominationBody(chain.candidateId))
            // A SECONDARY create never touches the standing PRIMARY.
            val second = manager.nominate(
                plan.id,
                nominationBody(secondId, nominationType = NominationType.SECONDARY),
            )
            var byId = manager.readPlan(plan.id).nominations.associateBy { it.id }
            assertEquals(NominationType.PRIMARY, byId.getValue(first.id).nominationType)
            assertEquals(NominationType.SECONDARY, byId.getValue(second.id).nominationType)

            // Editing the second to PRIMARY demotes the first in the same write.
            val promote = manager.put("/api/v1/succession-plans/${plan.id}/nominations/${second.id}") {
                contentType(ContentType.Application.Json)
                setBody(nominationBody(secondId, nominationType = NominationType.PRIMARY))
            }
            assertEquals(HttpStatusCode.NoContent, promote.status)
            byId = manager.readPlan(plan.id).nominations.associateBy { it.id }
            assertEquals(NominationType.SECONDARY, byId.getValue(first.id).nominationType)
            assertEquals(NominationType.PRIMARY, byId.getValue(second.id).nominationType)

            // Re-saving the standing PRIMARY as PRIMARY is a no-op for the others (self-excluded).
            val keep = manager.put("/api/v1/succession-plans/${plan.id}/nominations/${second.id}") {
                contentType(ContentType.Application.Json)
                setBody(
                    nominationBody(
                        secondId,
                        readiness = SuccessorReadiness.READY_NOW,
                        nominationType = NominationType.PRIMARY,
                    ),
                )
            }
            assertEquals(HttpStatusCode.NoContent, keep.status)
            byId = manager.readPlan(plan.id).nominations.associateBy { it.id }
            assertEquals(NominationType.SECONDARY, byId.getValue(first.id).nominationType)
            assertEquals(NominationType.PRIMARY, byId.getValue(second.id).nominationType)

            // A CREATE that sets PRIMARY demotes the standing one too.
            val third = manager.nominate(plan.id, nominationBody(thirdId))
            byId = manager.readPlan(plan.id).nominations.associateBy { it.id }
            assertEquals(NominationType.SECONDARY, byId.getValue(second.id).nominationType)
            assertEquals(NominationType.PRIMARY, byId.getValue(third.id).nominationType)
            assertEquals(1, byId.values.count { it.nominationType == NominationType.PRIMARY })
        }

    @Test
    fun `nomination validation - the seat person, duplicates, unknown or deactivated candidates`() = testApplication {
        usePostgresTestcontainer()
        val chain = seedChain()
        val manager = authedClient(chain.managerEmail, "pw")
        val plan = manager.createPlan(planBody(chain.seatId))

        suspend fun nominateStatus(body: SuccessionNominationRequest): HttpStatusCode =
            manager.post("/api/v1/succession-plans/${plan.id}/nominations") {
                contentType(ContentType.Application.Json)
                setBody(body)
            }.status

        // The seat's own person can never be their own successor.
        assertEquals(HttpStatusCode.BadRequest, nominateStatus(nominationBody(chain.seatId)))
        // Unknown candidate → 400 (not a 500 via the FK).
        assertEquals(HttpStatusCode.BadRequest, nominateStatus(nominationBody(999999999u)))
        // A deactivated candidate cannot be NEWLY nominated…
        val adminEmail = uniqueEmail("succ-admin")
        TestUsers.seed(adminEmail, "pw")
        val admin = authedClient(adminEmail, "pw")
        val dormantId = TestUsers.seed(uniqueEmail("succ-dormant"), "pw", roles = emptySet())
        assertEquals(HttpStatusCode.NoContent, admin.post("/api/v1/users/$dormantId/deactivate").status)
        assertEquals(HttpStatusCode.BadRequest, nominateStatus(nominationBody(dormantId)))

        // One nomination per candidate per plan.
        val kept = manager.nominate(plan.id, nominationBody(chain.candidateId))
        assertEquals(HttpStatusCode.Conflict, nominateStatus(nominationBody(chain.candidateId)))

        // …but keeping a since-deactivated candidate on an EDIT stays allowed (delta rule).
        assertEquals(HttpStatusCode.NoContent, admin.post("/api/v1/users/${chain.candidateId}/deactivate").status)
        val keepEdit = manager.put("/api/v1/succession-plans/${plan.id}/nominations/${kept.id}") {
            contentType(ContentType.Application.Json)
            setBody(nominationBody(chain.candidateId, readiness = SuccessorReadiness.EMERGENCY_INTERIM))
        }
        assertEquals(HttpStatusCode.NoContent, keepEdit.status)
        // A CHANGED candidate is a fresh assignment — the deactivated target is 400.
        val swapToDormant = manager.put("/api/v1/succession-plans/${plan.id}/nominations/${kept.id}") {
            contentType(ContentType.Application.Json)
            setBody(nominationBody(dormantId))
        }
        assertEquals(HttpStatusCode.BadRequest, swapToDormant.status)

        // Gap-list validation matches the plan's (shared bounds).
        assertEquals(
            HttpStatusCode.BadRequest,
            nominateStatus(nominationBody(chain.grandId, competencyGaps = listOf(" "))),
        )
        // Duplicate goal ids are rejected up-front.
        assertEquals(
            HttpStatusCode.BadRequest,
            nominateStatus(nominationBody(chain.grandId, goalIds = listOf(1u, 1u))),
        )
    }

    @Test
    fun `goal links - only the candidate's goals the owner may read qualify`() = testApplication {
        usePostgresTestcontainer()
        val chain = seedChain()
        val manager = authedClient(chain.managerEmail, "pw")
        val plan = manager.createPlan(planBody(chain.seatId))

        suspend fun nominateStatus(goalIds: List<UInt>): HttpStatusCode =
            manager.post("/api/v1/succession-plans/${plan.id}/nominations") {
                contentType(ContentType.Application.Json)
                setBody(nominationBody(chain.candidateId, goalIds = goalIds))
            }.status

        // A goal of somebody ELSE is not a development item for this candidate.
        val seatGoal = TestServices.goals.create(
            chain.managerId,
            GoalCreateRequest(
                subordinateId = chain.seatId,
                title = "Not the candidate's goal",
                type = GoalType.NUMBER,
                targetValue = 1.0,
                dueDate = "2027-12-31",
            ),
        )
        assertEquals(HttpStatusCode.BadRequest, nominateStatus(listOf(seatGoal)))
        // An unknown goal id is 400, not a 500 via the FK.
        assertEquals(HttpStatusCode.BadRequest, nominateStatus(listOf(999999999u)))

        // Another manager's DRAFT goal for the candidate stays private to its author pair —
        // unlinkable — but becomes linkable once it leaves DRAFT (the chain read rule).
        val grandGoal = TestServices.goals.create(
            chain.grandId,
            GoalCreateRequest(
                subordinateId = chain.candidateId,
                title = "Grand's development goal",
                type = GoalType.NUMBER,
                targetValue = 2.0,
                dueDate = "2027-12-31",
            ),
        )
        assertEquals(HttpStatusCode.BadRequest, nominateStatus(listOf(grandGoal)))
        TestServices.goals.transition(grandGoal, GoalStatus.DRAFT, GoalStatus.ACTIVE)
        val ok = manager.nominate(plan.id, nominationBody(chain.candidateId, goalIds = listOf(grandGoal)))
        assertEquals(listOf(grandGoal), ok.goals.map { it.id })
        assertEquals(GoalStatus.ACTIVE, ok.goals.single().status)
    }

    // ---- lists ----

    @Test
    fun `list views - own with filters, team widens with includeIndirect, user is HR-only`() = testApplication {
        usePostgresTestcontainer()
        val chain = seedChain()
        val manager = authedClient(chain.managerEmail, "pw")
        val grand = authedClient(chain.grandEmail, "pw")

        val seatPlan = manager.createPlan(planBody(chain.seatId))
        manager.nominate(seatPlan.id, nominationBody(chain.candidateId))
        val candidatePlan = manager.createPlan(planBody(chain.candidateId, retentionRisk = RetentionRisk.LOW))
        assertEquals(
            HttpStatusCode.NoContent,
            manager.post("/api/v1/succession-plans/${candidatePlan.id}/close").status,
        )
        val grandPlan = grand.createPlan(planBody(chain.managerId))

        // view=own (the default): the caller's plans only, bench tallies attached.
        val own = manager.get("/api/v1/succession-plans").body<SuccessionPlanPageResponse>()
        assertEquals(2, own.total)
        assertEquals(1, own.items.single { it.id == seatPlan.id }.benchCount)
        assertEquals(0, own.items.single { it.id == candidatePlan.id }.benchCount)

        // Status and userName filters compose.
        val openOnly = manager.get("/api/v1/succession-plans?status=OPEN").body<SuccessionPlanPageResponse>()
        assertEquals(listOf(seatPlan.id), openOnly.items.map { it.id })
        val byName = manager.get("/api/v1/succession-plans?userName=cleo").body<SuccessionPlanPageResponse>()
        assertEquals(listOf(candidatePlan.id), byName.items.map { it.id })

        // The grand manager's own view holds only their plan; view=team reaches the manager's.
        val grandOwn = grand.get("/api/v1/succession-plans").body<SuccessionPlanPageResponse>()
        assertEquals(listOf(grandPlan.id), grandOwn.items.map { it.id })
        val team = grand.get("/api/v1/succession-plans?view=team").body<SuccessionPlanPageResponse>()
        assertEquals(2, team.total)
        assertTrue(team.items.all { it.managerId == chain.managerId })
        // The manager (a leaf owner with no report managers) sees an empty team view; the seat
        // person (no reports at all) too.
        assertEquals(0, manager.get("/api/v1/succession-plans?view=team").body<SuccessionPlanPageResponse>().total)

        // includeIndirect is team-only.
        assertEquals(
            HttpStatusCode.BadRequest,
            manager.get("/api/v1/succession-plans?includeIndirect=true").status,
        )
        val indirect = grand
            .get("/api/v1/succession-plans?view=team&includeIndirect=true")
            .body<SuccessionPlanPageResponse>()
        assertEquals(2, indirect.total)

        // view=user is the HR auditor's: userId required, HR-only (ADMIN included gets 403),
        // party = the seat's person OR the owner.
        val adminEmail = uniqueEmail("succ-admin")
        TestUsers.seed(adminEmail, "pw")
        val admin = authedClient(adminEmail, "pw")
        assertEquals(
            HttpStatusCode.Forbidden,
            admin.get("/api/v1/succession-plans?view=user&userId=${chain.seatId}").status,
        )
        val hrEmail = uniqueEmail("succ-hr")
        TestUsers.seed(hrEmail, "pw", roles = setOf(UserRole.HR))
        val hr = authedClient(hrEmail, "pw")
        assertEquals(
            HttpStatusCode.BadRequest,
            hr.get("/api/v1/succession-plans?view=user").status,
        )
        val asSeat = hr.get("/api/v1/succession-plans?view=user&userId=${chain.seatId}")
            .body<SuccessionPlanPageResponse>()
        assertEquals(listOf(seatPlan.id), asSeat.items.map { it.id })
        val asOwner = hr.get("/api/v1/succession-plans?view=user&userId=${chain.managerId}")
            .body<SuccessionPlanPageResponse>()
        assertEquals(3, asOwner.total) // owner of two + seat of the grand's plan

        // userId never doubles as a pin elsewhere, and junk views/statuses are 400.
        assertEquals(
            HttpStatusCode.BadRequest,
            manager.get("/api/v1/succession-plans?userId=${chain.seatId}").status,
        )
        assertEquals(HttpStatusCode.BadRequest, manager.get("/api/v1/succession-plans?view=bench").status)
        assertEquals(HttpStatusCode.BadRequest, manager.get("/api/v1/succession-plans?status=STALE").status)
    }
}
