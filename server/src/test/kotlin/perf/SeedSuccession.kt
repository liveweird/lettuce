package ch.nokillswit.perf

import ch.nokillswit.goals.GoalService
import ch.nokillswit.succession.CandidateAwareness
import ch.nokillswit.succession.NominationType
import ch.nokillswit.succession.RetentionRisk
import ch.nokillswit.succession.RoleCriticality
import ch.nokillswit.succession.SuccessionCompetencyGap
import ch.nokillswit.succession.SuccessionEventService
import ch.nokillswit.succession.SuccessionNominationResponse
import ch.nokillswit.succession.SuccessionPlanCreateRequest
import ch.nokillswit.succession.SuccessionPlanService
import ch.nokillswit.succession.SuccessionPlanStatus
import ch.nokillswit.succession.SuccessorReadiness
import ch.nokillswit.succession.nominationAddedEvent
import ch.nokillswit.succession.successionPlanClosedEvent
import ch.nokillswit.succession.successionPlanCreationEvent
import ch.nokillswit.succession.successionReviewCompletedEvent
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.toList
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.r2dbc.select
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import java.time.LocalDate

private const val PLANS_PER_HALF_YEAR = 2
private const val MAX_LINKED_GOALS = 2

private class PlanRow(
    val id: UInt,
    val managerId: UInt,
    val seat: Person,
    val criticality: RoleCriticality,
    val risk: RetentionRisk,
    val lossImpact: List<String>,
    val benchDepth: Int,
    val status: SuccessionPlanStatus,
    val createdAt: Long,
    val reviewedAt: Long,
)

private class NominationRow(
    val id: UInt,
    val planId: UInt,
    val candidate: Person,
    val readiness: SuccessorReadiness,
    val type: NominationType,
    val gaps: List<SuccessionCompetencyGap>,
    val awareness: CandidateAwareness,
    val createdAt: Long,
    val goalIds: List<UInt>,
)

private val json = Json { encodeDefaults = true }

private suspend fun goalsByPerson(ctx: SeedContext): Map<UInt, List<UInt>> = suspendTransaction(ctx.db) {
    val g = GoalService.Goals
    g.select(g.id, g.subordinateId).where { g.markedAsDeleted eq false }.orderBy(g.id)
        .map { it[g.subordinateId].value to it[g.id].value }.toList().groupBy({ it.first }, { it.second })
}

private fun subtree(org: Org, managerId: UInt): List<Person> =
    org.reports[managerId].orEmpty().flatMap { listOf(it) + subtree(org, it.id) }

/** Writes plans, nominations, goal links and events; holds the sinks so the loops stay readable. */
private class SuccessionWriter(private val ctx: SeedContext, private val org: Org, private val goals: Map<UInt, List<UInt>>) {
    val rng = ctx.rng("succession")
    private val db = ctx.db
    private val p = SuccessionPlanService.Plans
    private val n = SuccessionPlanService.Nominations
    val plans = RowSink<PlanRow>(db, p) { r ->
        this[p.id] = r.id
        this[p.managerId] = r.managerId
        this[p.userId] = r.seat.id
        this[p.roleCriticality] = r.criticality
        this[p.retentionRisk] = r.risk
        this[p.lossImpact] = ctx.cipher.encrypt(json.encodeToString(ListSerializer(String.serializer()), r.lossImpact))
        this[p.targetBenchDepth] = r.benchDepth
        this[p.status] = r.status
        this[p.createdAt] = r.createdAt
        this[p.lastReviewedAt] = r.reviewedAt
    }
    val nominations = RowSink<NominationRow>(db, n) { r ->
        this[n.id] = r.id
        this[n.planId] = r.planId
        this[n.candidateId] = r.candidate.id
        this[n.readiness] = r.readiness
        this[n.nominationType] = r.type
        this[n.competencyGaps] =
            ctx.cipher.encrypt(json.encodeToString(ListSerializer(SuccessionCompetencyGap.serializer()), r.gaps))
        this[n.awareness] = r.awareness
        this[n.createdAt] = r.createdAt
        this[n.lastModified] = r.createdAt
    }
    val links = RowSink<Triple<UInt, UInt, Int>>(db, SuccessionPlanService.NominationGoals) { (nominationId, goalId, position) ->
        this[SuccessionPlanService.NominationGoals.nominationId] = nominationId
        this[SuccessionPlanService.NominationGoals.goalId] = goalId
        this[SuccessionPlanService.NominationGoals.position] = position
    }
    val events = EventStream(db, SuccessionEventService.SuccessionPlanEvents)
    val group = SinkGroup(plans, nominations, links, events.sink)
    val planIds = IdCounter(0u)
    val nominationIds = IdCounter(0u)

    suspend fun init() {
        planIds.reset(nextFreeId(db, p))
        nominationIds.reset(nextFreeId(db, n))
        events.init(db)
    }

    private fun pickNominations(seat: Person, reach: List<Person>): List<Pair<Person, NominationType>> {
        // A successor is a peer or a more junior person: never the seat's person, the plan's owner or anyone above
        // the seat — every manager up the seat's chain (the owner included) sits at a strictly higher level.
        fun eligible(c: Person) = c.id != seat.id && c.level >= seat.level
        val inside = reach.filter(::eligible)
        val outside = org.managed.filter { eligible(it) && it !in inside }
        val count = rng.int(1, 3)
        val chosen = mutableListOf<Pair<Person, NominationType>>()
        repeat(count) { i ->
            val source = if (i == 0 || outside.isEmpty() || rng.chance(0.7)) inside else outside
            val pool = source.filter { c -> chosen.none { it.first === c } }
            val candidate = pool.ifEmpty { org.managed.filter { c -> eligible(c) && chosen.none { it.first === c } } }
                .takeIf { it.isNotEmpty() }?.let(rng::pick) ?: return@repeat
            val type = when {
                i == 0 && candidate in inside -> NominationType.PRIMARY
                candidate in inside -> NominationType.SECONDARY
                else -> NominationType.CROSS_TEAM
            }
            chosen += candidate to type
        }
        return chosen
    }

    fun write(manager: Person, seat: Person, reach: List<Person>, created: LocalDate, open: Boolean, closeBy: LocalDate) {
        val id = planIds.take()
        val createdAt = ctx.millis(created, 9, rng.int(0, 59))
        val request = SuccessionPlanCreateRequest(
            seat.id, rng.pick(RoleCriticality.entries), rng.pick(RetentionRisk.entries),
            List(rng.int(2, 5)) { Text.paragraph(rng, 20, 100) }, rng.int(1, 4),
        )
        val creation = successionPlanCreationEvent(request)
        events.add(id, manager.id, createdAt, creation.type.name, creation.params)
        var reviewed = createdAt
        val picks = pickNominations(seat, reach)
        picks.forEachIndexed { i, (candidate, type) ->
            val at = createdAt + (i + 1) * 60_000L
            val gaps = List(rng.int(0, 3)) { SuccessionCompetencyGap(Text.paragraph(rng, 15, 80), rng.chance(0.3)) }
            val readiness = rng.pick(SuccessorReadiness.entries)
            val awareness = rng.pick(CandidateAwareness.entries)
            val own = goals[candidate.id].orEmpty()
            val goalIds = if (i == 0 || rng.chance(0.5)) rng.shuffled(own).take(MAX_LINKED_GOALS) else emptyList()
            val nominationId = nominationIds.take()
            nominations.add(NominationRow(nominationId, id, candidate, readiness, type, gaps, awareness, at, goalIds))
            goalIds.forEachIndexed { position, goalId -> links.add(Triple(nominationId, goalId, position)) }
            val added = nominationAddedEvent(
                SuccessionNominationResponse(
                    nominationId, id, candidate.id, candidate.name, readiness, type, gaps, awareness, emptyList(), at, at,
                ),
            )
            events.add(id, manager.id, at, added.type.name, added.params)
        }
        repeat(rng.int(if (open) 0 else 1, 2)) {
            reviewed = ctx.spreadMillis(rng, created.plusDays(rng.int(5, 120).toLong()), 10, floor = reviewed).coerceAtLeast(reviewed)
            val review = successionReviewCompletedEvent()
            events.add(id, manager.id, reviewed, review.type.name, review.params)
        }
        if (!open) {
            val closedAt = ctx.spreadMillis(rng, closeBy.minusDays(rng.int(0, 20).toLong()), 15, floor = reviewed).coerceAtLeast(reviewed)
            val closed = successionPlanClosedEvent()
            events.add(id, manager.id, closedAt, closed.type.name, closed.params)
        }
        plans.add(
            PlanRow(
                id, manager.id, seat, request.roleCriticality, request.retentionRisk, request.lossImpact, request.targetBenchDepth,
                if (open) SuccessionPlanStatus.OPEN else SuccessionPlanStatus.CLOSED, createdAt, reviewed,
            ),
        )
    }
}

/**
 * Succession plans (`.claude/docs/features/succession-plans.md`): two plans per manager per half-year over
 * the history (81 managers × 20 ≈ 1.6k at scale 1.0) — the seat's person is drawn from the manager's
 * TRANSITIVE subtree (distinct within a half-year, so the "one OPEN plan per (owner, person)" index
 * holds), every plan of the newest half-year is OPEN and every older one CLOSED. Each plan carries an
 * encrypted loss-impact list (2–5 texts) and 1–3 nominations — candidate (never the owner nor anyone above
 * the seat) from the manager's subtree
 * (`PRIMARY` for the first, ONE primary at most, then `SECONDARY`) or any other person (`CROSS_TEAM`) —
 * with an encrypted competency-gap list of `{text, filled}` objects, and up to two links to the
 * candidate's own goals (the first nomination always links when the candidate has goals). Events by rule
 * (`SuccessionEvents.kt` builders): `CREATED{roleCriticality,retentionRisk,targetBenchDepth}`, one
 * `NOMINATION_ADDED` per nomination, `REVIEW_COMPLETED` (the explicit stamp — closed plans have at least
 * one), `CLOSED`. No notifications: succession mints none except the content-free share notices
 * ([seedShares]). Seat person ≠ candidate; the manager is the actor of every event.
 */
suspend fun seedSuccession(ctx: SeedContext, org: Org) {
    val writer = SuccessionWriter(ctx, org, goalsByPerson(ctx))
    writer.init()
    val rng = writer.rng
    val halves = maxOf(1, ctx.spec.months / 6)
    org.reports.keys.map { org.byId.getValue(it) }.forEach { manager ->
        val reach = subtree(org, manager.id)
        for (h in 0 until halves) {
            val halfStart = ctx.config.anchor.minusMonths(6L * (halves - h))
            val open = h == halves - 1
            val seats = rng.shuffled(reach).take(PLANS_PER_HALF_YEAR)
            seats.forEach { seat ->
                writer.write(manager, seat, reach, halfStart.plusDays(rng.int(0, 150).toLong()), open, halfStart.plusMonths(6))
            }
        }
        writer.group.flush()
    }
    advanceSequences(
        ctx.db,
        listOf(SuccessionPlanService.Plans, SuccessionPlanService.Nominations, SuccessionEventService.SuccessionPlanEvents),
    )
}
