package ch.nokillswit.perf

import ch.nokillswit.goals.GoalEventService
import ch.nokillswit.goals.GoalEventType
import ch.nokillswit.goals.GoalService
import ch.nokillswit.goals.GoalStatus
import ch.nokillswit.goals.GoalType
import ch.nokillswit.goals.TargetDirection
import ch.nokillswit.goals.goalCreationEvent
import ch.nokillswit.goals.goalProgressUpdateNotification
import ch.nokillswit.goals.goalTransitionEvent
import ch.nokillswit.goals.goalTransitionNotifications
import org.jetbrains.exposed.v1.core.statements.BatchInsertStatement
import java.time.LocalDate
import kotlin.math.roundToLong

private class GoalRow(
    val id: UInt,
    val managerId: UInt,
    val subordinateId: UInt,
    val createdAt: Long,
    val dueDate: String,
    val title: String,
    val description: String,
    val type: GoalType,
    val target: Double?,
    val direction: TargetDirection?,
    val current: Double?,
    val status: GoalStatus,
    val summary: String?,
    val lastModified: Long,
)

private class MilestoneRow(val id: UInt, val goalId: UInt, val position: Int, val description: String, val done: Boolean)

/** What one goal looks like at the anchor — decided up front, then narrated as rows and events. */
private class GoalPlan(
    val type: GoalType,
    val status: GoalStatus,
    val target: Double?,
    val direction: TargetDirection?,
    /** Numeric goals: the recorded values in order; empty for PLAN and for a DRAFT. */
    val values: List<Double>,
    val milestoneCount: Int,
    val milestonesDone: Int,
)

private fun BatchInsertStatement.bindGoal(g: GoalRow) {
    val goals = GoalService.Goals
    this[goals.id] = g.id
    this[goals.managerId] = g.managerId
    this[goals.subordinateId] = g.subordinateId
    this[goals.createdAt] = g.createdAt
    this[goals.dueDate] = g.dueDate
    this[goals.title] = g.title
    this[goals.description] = g.description
    this[goals.type] = g.type
    this[goals.targetValue] = g.target
    this[goals.targetDirection] = g.direction
    this[goals.currentValue] = g.current
    this[goals.status] = g.status
    this[goals.summary] = g.summary
    this[goals.lastModified] = g.lastModified
}

private val GOAL_TYPES = listOf(GoalType.PLAN, GoalType.PLAN, GoalType.NUMBER, GoalType.NUMBER, GoalType.PERCENTAGE, GoalType.PERCENTAGE)

/**
 * Goals: one per person with a manager per month (≈ 30.6k at scale 1.0), set by the direct manager.
 * Types PLAN/NUMBER/PERCENTAGE 33/33/33 %, PLAN with 3–6 encrypted milestones; status by age — recent
 * goals mostly ACTIVE (some still DRAFT), older ones mostly ARCHIVED with an encrypted summary.
 * Events by rule (`goals/GoalEvents.kt`, "Goals" in `.claude/docs/features/goals.md`): CREATED{type};
 * STATUS_CHANGED for each edge taken (DRAFT → ACTIVE, ACTIVE → ARCHIVED); PROGRESS_UPDATED{from,to}
 * per numeric save (half carry an encrypted `comment` on the event) or MILESTONE_COMPLETED{position}
 * per ticked milestone — params are enum names, numbers and positions only. Notifications: the
 * builders `goalTransitionNotifications` (subordinate, per edge) and `goalProgressUpdateNotification`
 * (the counterparty of whichever party saved), retention-shaped by [NotificationMint].
 */
suspend fun seedGoals(ctx: SeedContext, org: Org, mint: NotificationMint) {
    val writer = GoalWriter(ctx, org, mint)
    val firstMonth = ctx.config.anchor.withDayOfMonth(1).minusMonths(ctx.spec.months.toLong())
    for (m in 0 until ctx.spec.months) {
        val monthStart = firstMonth.plusMonths(m.toLong())
        val ageMonths = ctx.spec.months - 1 - m
        for (person in org.managed) writer.write(person, monthStart.plusDays(writer.rng.int(0, 26).toLong()), ageMonths)
        writer.flush()
    }
    advanceSequences(ctx.db, listOf(GoalService.Goals, GoalService.Milestones, GoalEventService.GoalEvents))
}

private class GoalWriter(private val ctx: SeedContext, private val org: Org, private val mint: NotificationMint) {
    val rng = ctx.rng("goals")
    private val db = ctx.db
    private val goals = RowSink<GoalRow>(db, GoalService.Goals) { bindGoal(it) }
    private val milestones = RowSink<MilestoneRow>(db, GoalService.Milestones) { m ->
        this[GoalService.Milestones.id] = m.id
        this[GoalService.Milestones.goalId] = m.goalId
        this[GoalService.Milestones.position] = m.position
        this[GoalService.Milestones.description] = m.description
        this[GoalService.Milestones.done] = m.done
    }
    private val events = eventSink(db, GoalEventService.GoalEvents)
    private val group = SinkGroup(goals, milestones, events)
    private val goalIds = IdCounter(0u)
    private val milestoneIds = IdCounter(0u)
    private val eventIds = IdCounter(0u)
    private var initialised = false

    suspend fun flush() {
        group.flush()
        mint.sinkGroup.flush()
    }

    private suspend fun ensureIds() {
        if (initialised) return
        goalIds.reset(nextFreeId(db, GoalService.Goals))
        milestoneIds.reset(nextFreeId(db, GoalService.Milestones))
        eventIds.reset(nextFreeId(db, GoalEventService.GoalEvents))
        initialised = true
    }

    suspend fun write(person: Person, created: LocalDate, ageMonths: Int) {
        ensureIds()
        val plan = planGoal(rng, ageMonths)
        val story = GoalStory(ctx, org, mint, events, eventIds, rng, person, goalIds.take(), Text.title(rng, rng.int(3, 6)), created)
        story.tell(rng, plan)
        goals.add(
            GoalRow(
                story.goalId, story.managerId, person.id, ctx.millis(created, 9),
                created.plusDays(rng.int(60, 300).toLong()).toString(), story.title,
                ctx.cipher.encrypt(Text.paragraph(rng, 100, 400)), plan.type, plan.target, plan.direction,
                plan.values.lastOrNull(), plan.status,
                if (plan.status == GoalStatus.ARCHIVED) ctx.cipher.encrypt(Text.paragraph(rng, 80, 300)) else null,
                story.lastModified,
            ),
        )
        repeat(plan.milestoneCount) { position ->
            milestones.add(
                MilestoneRow(
                    milestoneIds.take(), story.goalId, position,
                    ctx.cipher.encrypt(Text.paragraph(rng, 30, 120)), position < plan.milestonesDone,
                ),
            )
        }
    }
}

/** Narrates one goal as events and notifications; tracks the time of the last thing that happened to it. */
private class GoalStory(
    private val ctx: SeedContext,
    private val org: Org,
    private val mint: NotificationMint,
    private val events: RowSink<EventRow>,
    private val eventIds: IdCounter,
    private val rng: Rng,
    private val person: Person,
    val goalId: UInt,
    val title: String,
    created: LocalDate,
) {
    val managerId: UInt = person.managerId!!
    private val managerName = org.names.getValue(managerId)
    private var day: LocalDate = created
    private var minute = 0
    var lastModified: Long = ctx.millis(created, 9)
        private set

    private fun event(type: String, params: Map<String, String>, actor: UInt, comment: String? = null) {
        // Past the anchor, scatter the remaining steps over the last 30 days (never before the previous step).
        val at = ctx.spreadMillis(rng, ctx.rawMillis(day, 9, minute++), floor = lastModified)
        lastModified = at
        events.add(EventRow(eventIds.take(), goalId, actor, at, type, params, comment))
    }

    private fun transition(from: GoalStatus, to: GoalStatus) {
        val descriptor = goalTransitionEvent(from, to)
        event(descriptor.type.name, descriptor.params, managerId)
        mint.emitAll(goalTransitionNotifications(goalId, from, to, person.id, managerName, title), lastModified)
    }

    private fun progressSaved(rng: Rng, type: GoalEventType, params: Map<String, String>) {
        val actorIsSubordinate = rng.chance(0.6)
        val actor = if (actorIsSubordinate) person.id else managerId
        val comment = if (type == GoalEventType.PROGRESS_UPDATED && rng.chance(0.5)) {
            ctx.cipher.encrypt(Text.paragraph(rng, 40, 200))
        } else {
            null
        }
        event(type.name, params, actor, comment)
        mint.emit(
            goalProgressUpdateNotification(
                goalId, actor, managerId, person.id, if (actorIsSubordinate) person.name else managerName, title,
            ),
            lastModified,
        )
    }

    fun tell(rng: Rng, plan: GoalPlan) {
        val creation = goalCreationEvent(plan.type)
        event(creation.type.name, creation.params, managerId)
        if (plan.status == GoalStatus.DRAFT) return
        day = day.plusDays(rng.int(1, 3).toLong())
        transition(GoalStatus.DRAFT, GoalStatus.ACTIVE)
        var previous = ""
        plan.values.forEach { value ->
            day = day.plusDays(rng.int(5, 30).toLong())
            progressSaved(rng, GoalEventType.PROGRESS_UPDATED, mapOf("from" to previous, "to" to value.toString()))
            previous = value.toString()
        }
        repeat(plan.milestonesDone) { position ->
            day = day.plusDays(rng.int(3, 20).toLong())
            progressSaved(rng, GoalEventType.MILESTONE_COMPLETED, mapOf("position" to (position + 1).toString()))
        }
        if (plan.status == GoalStatus.ARCHIVED) {
            day = day.plusDays(rng.int(5, 30).toLong())
            transition(GoalStatus.ACTIVE, GoalStatus.ARCHIVED)
        }
    }
}

/** Status by age: recent goals mostly ACTIVE (some still DRAFT), older ones mostly ARCHIVED. */
private fun pickStatus(rng: Rng, ageMonths: Int): GoalStatus = when {
    ageMonths <= 1 -> if (rng.chance(0.15)) GoalStatus.DRAFT else GoalStatus.ACTIVE
    ageMonths <= 5 -> when {
        rng.chance(0.05) -> GoalStatus.DRAFT
        rng.chance(0.25 / 0.95) -> GoalStatus.ARCHIVED
        else -> GoalStatus.ACTIVE
    }
    else -> when {
        rng.chance(0.02) -> GoalStatus.DRAFT
        rng.chance(0.85) -> GoalStatus.ARCHIVED
        else -> GoalStatus.ACTIVE
    }
}

/** The recorded values of a numeric goal: [updates] ascending steps toward a final fraction of the target. */
private fun progressValues(rng: Rng, type: GoalType, target: Double?, status: GoalStatus): List<Double> {
    val archived = status == GoalStatus.ARCHIVED
    val updates = when {
        type == GoalType.PLAN || status == GoalStatus.DRAFT -> 0
        archived -> rng.int(2, 4)
        else -> rng.int(1, 3)
    }
    val finalFraction = if (archived) 0.7 + rng.double() * 0.5 else 0.1 + rng.double() * 0.8
    return (1..updates).map { step ->
        val raw = target!! * finalFraction * step / updates
        val capped = if (type == GoalType.PERCENTAGE) raw.coerceAtMost(100.0) else raw
        (capped * 10).roundToLong() / 10.0
    }
}

private fun planGoal(rng: Rng, ageMonths: Int): GoalPlan {
    val type = rng.pick(GOAL_TYPES)
    val status = pickStatus(rng, ageMonths)
    val direction = when {
        type == GoalType.PLAN -> null
        rng.chance(0.85) -> TargetDirection.AT_LEAST
        else -> TargetDirection.AT_MOST
    }
    val target = when (type) {
        GoalType.NUMBER -> rng.int(10, 500).toDouble()
        GoalType.PERCENTAGE -> rng.int(50, 100).toDouble()
        GoalType.PLAN -> null
    }
    val values = progressValues(rng, type, target, status)
    val milestones = if (type == GoalType.PLAN) rng.int(3, 6) else 0
    val done = when {
        milestones == 0 || status == GoalStatus.DRAFT -> 0
        status == GoalStatus.ARCHIVED -> (milestones * (0.6 + rng.double() * 0.4)).toInt()
        else -> rng.int(0, milestones - 1)
    }
    return GoalPlan(type, status, target, direction, values, milestones, done)
}
