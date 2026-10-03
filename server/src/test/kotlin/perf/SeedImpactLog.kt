package ch.nokillswit.perf

import ch.nokillswit.impactlog.ImpactEntryEventType
import ch.nokillswit.impactlog.ImpactLogEventService
import ch.nokillswit.impactlog.ImpactLogService
import ch.nokillswit.impactlog.impactEntryCreatedNotifications
import ch.nokillswit.impactlog.impactEntryCreationEvent
import ch.nokillswit.impactlog.impactEntryDeletedNotifications
import ch.nokillswit.impactlog.impactEntryDeletionEvent
import ch.nokillswit.impactlog.impactEntryUpdatedNotifications
import java.time.LocalDate

private class EntryRow(
    val id: UInt,
    val userId: UInt,
    val title: String,
    val start: LocalDate,
    val end: LocalDate,
    val sections: List<String>,
    val createdAt: Long,
    val lastModified: Long,
    val deleted: Boolean,
)

/** The four section field names in the stable order `impactEntryUpdateEvent` lists them (`changed=`). */
private val SECTION_FIELDS = listOf("whatHappened", "contribution", "whyItMattered", "evidence")

/**
 * Impact log (`.claude/docs/features/impact-log.md`): one entry per person per month over the history
 * (≈ 30.7k at scale 1.0), the month as its period, a plaintext title and the four encrypted sections
 * (what happened / contribution / why it mattered / evidence). Events by rule (`ImpactLogEvents.kt`):
 * `CREATED{periodStart,periodEnd}` via `impactEntryCreationEvent`, ~12 % get one `UPDATED{changed}` (a
 * random non-empty subset of the four section fields, in the builder's stable order — `impactEntryUpdateEvent`
 * itself needs two full documents, so only its documented param shape is reproduced) and ~1 % were deleted
 * again (soft, `DELETED{}`). Notifications (the impact-log rows of `notifications.md`): every create, update
 * and delete notifies the owner's DIRECT manager only (`impactEntryCreated/Updated/DeletedNotifications`;
 * the CEO has none), retention-shaped by [NotificationMint].
 */
suspend fun seedImpactLog(ctx: SeedContext, org: Org, mint: NotificationMint) {
    val db = ctx.db
    val rng = ctx.rng("impact-log")
    val t = ImpactLogService.Entries
    val entries = RowSink<EntryRow>(db, t) { e ->
        this[t.id] = e.id
        this[t.userId] = e.userId
        this[t.title] = e.title
        this[t.periodStart] = e.start.toString()
        this[t.periodEnd] = e.end.toString()
        this[t.whatHappened] = e.sections[0]
        this[t.contribution] = e.sections[1]
        this[t.whyItMattered] = e.sections[2]
        this[t.evidence] = e.sections[3]
        this[t.createdAt] = e.createdAt
        this[t.lastModified] = e.lastModified
        this[t.markedAsDeleted] = e.deleted
    }
    val events = EventStream(db, ImpactLogEventService.ImpactLogEvents)
    events.init(db)
    val ids = IdCounter(nextFreeId(db, t))
    val group = SinkGroup(entries, events.sink)
    val firstMonth = ctx.config.anchor.withDayOfMonth(1).minusMonths(ctx.spec.months.toLong())
    for (m in 0 until ctx.spec.months) {
        val start = firstMonth.plusMonths(m.toLong())
        val end = start.withDayOfMonth(start.lengthOfMonth())
        for (person in org.people) {
            val id = ids.take()
            val managers = setOfNotNull(person.managerId)
            val createdAt = ctx.millis(end.plusDays(rng.int(0, 6).toLong()), 8 + rng.int(0, 9), rng.int(0, 59))
            var modified = createdAt
            val created = impactEntryCreationEvent(start.toString(), end.toString())
            events.add(id, person.id, createdAt, created.type.name, created.params)
            mint.emitAll(impactEntryCreatedNotifications(id, managers, person.name, start.toString(), end.toString()), createdAt)
            if (rng.chance(0.12)) {
                modified = minOf(createdAt + rng.int(1, 14) * MILLIS_PER_DAY, ctx.anchorMillis - 1)
                val fields = SECTION_FIELDS.filter { rng.chance(0.5) }.ifEmpty { listOf(SECTION_FIELDS.first()) }
                events.add(id, person.id, modified, ImpactEntryEventType.UPDATED.name, mapOf("changed" to fields.joinToString(",")))
                mint.emitAll(impactEntryUpdatedNotifications(id, managers, person.name, start.toString(), end.toString()), modified)
            }
            val deleted = rng.chance(0.01)
            if (deleted) {
                modified = minOf(modified + MILLIS_PER_DAY, ctx.anchorMillis - 1)
                val d = impactEntryDeletionEvent()
                events.add(id, person.id, modified, d.type.name, d.params)
                mint.emitAll(impactEntryDeletedNotifications(managers, person.name, start.toString(), end.toString()), modified)
            }
            entries.add(
                EntryRow(
                    id, person.id, Text.title(rng, rng.int(3, 7)), start, end,
                    listOf(
                        ctx.cipher.encrypt(Text.paragraph(rng, 120, 600)), ctx.cipher.encrypt(Text.paragraph(rng, 120, 500)),
                        ctx.cipher.encrypt(Text.paragraph(rng, 100, 400)), ctx.cipher.encrypt(Text.paragraph(rng, 60, 300)),
                    ),
                    createdAt, modified, deleted,
                ),
            )
        }
        group.flush()
        mint.sinkGroup.flush()
    }
    advanceSequences(db, listOf(t, ImpactLogEventService.ImpactLogEvents))
}
