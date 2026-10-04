package ch.nokillswit.perf

import ch.nokillswit.daysoff.DaysOffCorrectionOperation
import ch.nokillswit.daysoff.DaysOffCorrectionResponse
import ch.nokillswit.daysoff.DaysOffEvent
import ch.nokillswit.daysoff.DaysOffEventService
import ch.nokillswit.daysoff.DaysOffResponse
import ch.nokillswit.daysoff.DaysOffService
import ch.nokillswit.daysoff.DaysOffType
import ch.nokillswit.daysoff.daysOffAllowanceChangedEvent
import ch.nokillswit.daysoff.daysOffAllowanceChangedNotification
import ch.nokillswit.daysoff.daysOffCorrectionCreatedEvent
import ch.nokillswit.daysoff.daysOffCorrectionNotification
import ch.nokillswit.daysoff.daysOffCostHalfDays
import ch.nokillswit.daysoff.daysOffEntryDeletedEvent
import ch.nokillswit.daysoff.daysOffEntryRecordedEvent
import ch.nokillswit.daysoff.daysOffFanoutNotifications
import ch.nokillswit.daysoff.formatHalfDaysParam
import ch.nokillswit.notifications.NotificationType
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.r2dbc.selectAll
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import java.time.LocalDate
import kotlin.math.abs

private const val DEFAULT_ALLOWANCE = 26
private const val REDUCED_ALLOWANCE = 20
private const val EXTRA_ALLOWANCE = 5
private const val ENTRIES_PER_YEAR = 5
private const val EXTRA_POOL_SLOT = 2
private const val PERSONS_PER_FLUSH = 25
private const val FUTURE_BOOKING_DAYS = 150L
private const val EXTRA_POOL_NAME = "Training days"

private class PoolKind(val id: UInt, val name: String)

private class PoolRow(val id: UInt, val userId: UInt, val kindId: UInt, val allowance: Int, val createdAt: Long)

private class RequestRow(
    val id: UInt,
    val userId: UInt,
    val kind: PoolKind,
    val start: LocalDate,
    val end: LocalDate,
    val startHalf: Boolean,
    val endHalf: Boolean,
    val cost: Int,
    val createdAt: Long,
    val lastModified: Long,
    val deleted: Boolean,
)

private class CorrectionRow(
    val id: UInt,
    val userId: UInt,
    val authorId: UInt,
    val kindId: UInt,
    val year: Int,
    val halfDays: Int,
    val comment: String,
    val createdAt: Long,
)

private class Slot(val start: LocalDate, val end: LocalDate, val startHalf: Boolean, val endHalf: Boolean, val cost: Int)

/** Everything the per-person writers share. */
private class DaysOffWriter(val ctx: SeedContext, val org: Org, val mint: NotificationMint, val holidays: Set<LocalDate>) {
    val rng = ctx.rng("days-off")
    private val db = ctx.db
    val events = EventStream(db, DaysOffEventService.DaysOffEvents)
    val pools = RowSink<PoolRow>(db, DaysOffService.Pools) { p ->
        val t = DaysOffService.Pools
        this[t.id] = p.id
        this[t.userId] = p.userId
        this[t.poolTypeId] = p.kindId
        this[t.allowance] = p.allowance
        this[t.createdAt] = p.createdAt
        this[t.lastModified] = p.createdAt
    }
    val requests = RowSink<RequestRow>(db, DaysOffService.Requests) { r ->
        val t = DaysOffService.Requests
        this[t.id] = r.id
        this[t.userId] = r.userId
        this[t.type] = DaysOffType.PAID
        this[t.poolTypeId] = r.kind.id
        this[t.startDate] = r.start.toString()
        this[t.endDate] = r.end.toString()
        this[t.startHalf] = r.startHalf
        this[t.endHalf] = r.endHalf
        this[t.costHalfDays] = r.cost
        this[t.createdAt] = r.createdAt
        this[t.lastModified] = r.lastModified
        this[t.markedAsDeleted] = r.deleted
    }
    val corrections = RowSink<CorrectionRow>(db, DaysOffService.Corrections) { c ->
        val t = DaysOffService.Corrections
        this[t.id] = c.id
        this[t.userId] = c.userId
        this[t.authorId] = c.authorId
        this[t.poolTypeId] = c.kindId
        this[t.year] = c.year
        this[t.amountHalfDays] = c.halfDays
        this[t.comment] = ctx.cipher.encrypt(c.comment)
        this[t.createdAt] = c.createdAt
        this[t.lastModified] = c.createdAt
    }
    val group = SinkGroup(pools, requests, corrections, events.sink)
    val poolIds = IdCounter(0u)
    val requestIds = IdCounter(0u)
    val correctionIds = IdCounter(0u)

    suspend fun init() {
        poolIds.reset(nextFreeId(db, DaysOffService.Pools))
        requestIds.reset(nextFreeId(db, DaysOffService.Requests))
        correctionIds.reset(nextFreeId(db, DaysOffService.Corrections))
        events.init(db)
    }

    suspend fun flush() {
        group.flush()
        mint.sinkGroup.flush()
    }

    fun emit(event: DaysOffEvent, at: Long) = events.add(event.ownerId, event.userId, at, event.type.name, event.params)

    /** The create/delete fan-out audience of [person]'s entry: their team's members + manager, minus the actor. */
    fun audience(person: Person, actorId: UInt): Set<UInt> =
        person.teamId?.let { org.teamById.getValue(it) }?.let { (it.memberIds + it.managerId).toSet() - actorId }.orEmpty()

    /** An entry [lengthDays] long from [start], clipped to its calendar year and shortened until it fits [budget] half-days. */
    fun fit(start: LocalDate, lengthDays: Long, budget: Int): Slot? {
        val startHalf = rng.chance(0.1)
        val endHalfDrawn = rng.chance(0.1)
        var end = minOf(start.plusDays(lengthDays - 1), LocalDate.of(start.year, 12, 31))
        // A single-day entry has no separate end day: `DaysOff.kt` rejects `start == end && endHalf`.
        fun endHalf() = endHalfDrawn && end > start
        // The REAL cost function (DaysOff.kt) — weekends and the registry's holidays cost nothing.
        var cost = daysOffCostHalfDays(start, end, startHalf, endHalf(), holidays)
        while (cost > budget && end > start) {
            end = end.minusDays(1)
            cost = daysOffCostHalfDays(start, end, startHalf, endHalf(), holidays)
        }
        return if (cost in 1..budget) Slot(start, end, startHalf, endHalf(), cost) else null
    }

    fun grant(person: Person, kind: PoolKind, allowance: Int, at: LocalDate) {
        val createdAt = ctx.millis(at, 9)
        pools.add(PoolRow(poolIds.take(), person.id, kind.id, allowance, createdAt))
        val manager = person.managerId ?: return // the CEO's grant has no chain manager to act
        emit(daysOffAllowanceChangedEvent(manager, person.id, kind.id, kind.name, null, allowance), createdAt)
        mint.emit(daysOffAllowanceChangedNotification(person.id, org.names.getValue(manager), kind.name, null, allowance), createdAt)
    }
}

private suspend fun poolKinds(ctx: SeedContext): Pair<PoolKind, PoolKind> {
    val t = DaysOffService.PoolTypes
    val default = suspendTransaction(ctx.db) {
        t.selectAll().where { t.isDefault eq true }.map { PoolKind(it[t.id].value, it[t.name]) }.toList().single()
    }
    val id = nextFreeId(ctx.db, t)
    val at = ctx.millis(ctx.config.anchor.minusMonths(ctx.spec.months.toLong()), 8)
    val sink = RowSink<Unit>(ctx.db, t) {
        this[t.id] = id
        this[t.name] = EXTRA_POOL_NAME
        this[t.carriesOver] = false
        this[t.isDefault] = false
        this[t.createdAt] = at
        this[t.lastModified] = at
    }
    sink.add(Unit)
    sink.flush()
    advanceSequences(ctx.db, listOf(t))
    return default to PoolKind(id, EXTRA_POOL_NAME)
}

/** One person's yearly entries in the window starting [windowStart]: five PAID entries (one from the extra pool, when granted). */
private fun DaysOffWriter.writeYear(
    person: Person, windowStart: LocalDate, default: PoolKind, extra: PoolKind?, allowance: Int, used: MutableMap<Pair<UInt, Int>, Int>,
) {
    repeat(ENTRIES_PER_YEAR) { slot ->
        val start = windowStart.plusDays(slot * 73L + rng.int(0, 40))
        if (start >= ctx.config.anchor.plusDays(FUTURE_BOOKING_DAYS)) return@repeat
        val kind = if (slot == EXTRA_POOL_SLOT && extra != null) extra else default
        val cap = if (kind === extra) 2 * EXTRA_ALLOWANCE else 2 * allowance - 2
        val key = kind.id to start.year
        val length = if (kind === extra) rng.int(2, 3) else rng.int(2, 9)
        val planned = fit(start, length.toLong(), cap - (used[key] ?: 0)) ?: return@repeat
        val actor = person.managerId?.takeIf { rng.chance(0.1) } ?: person.id
        val createdAt = ctx.spreadMillis(rng, start.minusDays(rng.int(7, 45).toLong()), 9 + rng.int(0, 7), rng.int(0, 59))
        val deletedAt = if (rng.chance(0.03)) {
            ctx.spreadMillis(rng, planned.start.minusDays(rng.int(1, 6).toLong()), 14, floor = createdAt)
        } else {
            null
        }
        if (deletedAt == null) used[key] = (used[key] ?: 0) + planned.cost
        val row = RequestRow(
            requestIds.take(), person.id, kind, planned.start, planned.end, planned.startHalf, planned.endHalf, planned.cost,
            createdAt, deletedAt?.coerceAtLeast(createdAt) ?: createdAt, deletedAt != null,
        )
        requests.add(row)
        recordEntry(person, row, actor)
    }
}

private fun DaysOffWriter.recordEntry(person: Person, row: RequestRow, actor: UInt) {
    val response = DaysOffResponse(
        row.id, person.id, person.name, DaysOffType.PAID, row.kind.id, row.kind.name, row.start.toString(), row.end.toString(),
        row.startHalf, row.endHalf, row.cost / 2.0, row.createdAt, row.lastModified,
    )
    emit(daysOffEntryRecordedEvent(actor, response), row.createdAt)
    fun fanout(type: NotificationType, who: UInt, at: Long) = mint.emitAll(
        daysOffFanoutNotifications(type, audience(person, who), person.name, response.startDate, response.endDate), at,
    )
    fanout(NotificationType.DAYS_OFF_CREATED, actor, row.createdAt)
    if (row.deleted) {
        emit(daysOffEntryDeletedEvent(person.id, response), row.lastModified)
        fanout(NotificationType.DAYS_OFF_DELETED, person.id, row.lastModified)
    }
}

/** A handful of manager corrections (an encrypted comment each): `ADD` mostly, a half-day `SUBTRACT` now and then. */
private fun DaysOffWriter.writeCorrections(default: PoolKind) {
    val managed = org.managed
    val count = maxOf(1, managed.size / 10)
    repeat(count) {
        val person = rng.pick(managed)
        val manager = person.managerId!!
        val year = rng.int(ctx.config.anchor.minusMonths(ctx.spec.months.toLong()).year, ctx.config.anchor.year)
        val date = LocalDate.of(year, rng.int(1, 12), rng.int(1, 28))
        val at = ctx.spreadMillis(rng, date, 11)
        val subtract = rng.chance(0.1)
        val halfDays = if (subtract) -1 else rng.int(1, 6)
        val id = correctionIds.take()
        corrections.add(CorrectionRow(id, person.id, manager, default.id, year, halfDays, Text.paragraph(rng, 30, 160), at))
        val operation = if (subtract) DaysOffCorrectionOperation.SUBTRACT else DaysOffCorrectionOperation.ADD
        val days = abs(halfDays) / 2.0
        val response = DaysOffCorrectionResponse(
            id, person.id, manager, org.names.getValue(manager), false, default.id, default.name, year, operation, days, "", at, at,
        )
        emit(daysOffCorrectionCreatedEvent(manager, response), at)
        mint.emit(
            daysOffCorrectionNotification(
                person.id, org.names.getValue(manager), default.name, year, operation, formatHalfDaysParam(abs(halfDays)),
            ),
            at,
        )
    }
}

/**
 * Days off (`.claude/docs/features/days-off.md`): the public-holiday registry over the five years
 * ([seedPublicHolidays]); the V74 default pool kind plus one extra, non-carry-over kind ("Training days",
 * a 5-day grant for ~30 % of the people); one default-pool grant per person (26 days, 20 for a fifth of them —
 * `days_off_pools` is one row per (user, kind), not per year); and **five PAID entries per person per year**
 * (≈ 12.8k), spread across the year, 2–9 calendar days each, never overlapping, one calendar year each, kept
 * inside the pool's yearly budget (the app's create-time 409 would otherwise refuse them) — the last year's
 * window reaches ~4 months past the anchor, so some entries are booked ahead (`createdAt` is always before
 * the anchor — a booking-ahead timestamp is scattered over the last 30 days, never stacked on one millisecond).
 * `cost_half_days` comes from the REAL `daysOffCostHalfDays` over the seeded holidays. ~3 % of the
 * entries were deleted again (soft), ~10 % recorded by the direct manager on the person's behalf, and one
 * encrypted correction per ten managed people. Events by rule (`DaysOffEvents.kt` builders, person-keyed —
 * V88): `ENTRY_RECORDED{…, onBehalf}`, `ENTRY_DELETED`, `CORRECTION_CREATED`, `ALLOWANCE_CHANGED` (the grants,
 * actor = the direct manager; the CEO has none). Notifications (`DaysOffNotifications.kt`): the create/delete
 * fan-out to the person's team + its manager minus the actor, the correction and allowance notices to the owner.
 */
suspend fun seedDaysOff(ctx: SeedContext, org: Org, mint: NotificationMint) {
    val holidays = seedPublicHolidays(ctx)
    val (default, extra) = poolKinds(ctx)
    val writer = DaysOffWriter(ctx, org, mint, holidays)
    writer.init()
    val rng = writer.rng
    val windows = maxOf(1, ctx.spec.months / 12)
    val historyStart = ctx.config.anchor.minusMonths(ctx.spec.months.toLong())
    org.people.forEachIndexed { index, person ->
        val allowance = if (rng.chance(0.8)) DEFAULT_ALLOWANCE else REDUCED_ALLOWANCE
        val hasExtra = rng.chance(0.3)
        writer.grant(person, default, allowance, historyStart.plusDays(rng.int(0, 20).toLong()))
        if (hasExtra) writer.grant(person, extra, EXTRA_ALLOWANCE, historyStart.plusDays(rng.int(21, 40).toLong()))
        val used = mutableMapOf<Pair<UInt, Int>, Int>()
        for (k in 0 until windows) {
            val windowStart = ctx.config.anchor.minusMonths(8L + 12L * (windows - 1 - k))
            writer.writeYear(person, windowStart, default, extra.takeIf { hasExtra }, allowance, used)
        }
        if (index % PERSONS_PER_FLUSH == PERSONS_PER_FLUSH - 1) writer.flush()
    }
    writer.writeCorrections(default)
    writer.flush()
    advanceSequences(
        ctx.db,
        listOf(
            DaysOffService.Pools, DaysOffService.Requests, DaysOffService.Corrections, DaysOffEventService.DaysOffEvents,
        ),
    )
}
