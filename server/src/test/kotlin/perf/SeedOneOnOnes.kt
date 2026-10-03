package ch.nokillswit.perf

import ch.nokillswit.oneonones.ActionItemOwner
import ch.nokillswit.oneonones.NoteKind
import ch.nokillswit.oneonones.OneOnOneEventService
import ch.nokillswit.oneonones.OneOnOneEventType
import ch.nokillswit.oneonones.OneOnOneService
import ch.nokillswit.oneonones.oneOnOneCreationEvent
import ch.nokillswit.oneonones.oneOnOneCreationNotifications
import java.time.LocalDate

/** An unresolved action item waiting to be carried into the pair's next meeting. */
private class Carry(val sourceId: UInt, val content: String, val owner: ActionItemOwner, val dueDate: String?)

private class PairState(val manager: Person, val subordinate: Person, val weekdayOffset: Int) {
    var carry: List<Carry> = emptyList()
}

private class MeetingRow(val id: UInt, val managerId: UInt, val subordinateId: UInt, val date: String, val lastModified: Long)

private class NoteRow(val id: UInt, val meetingId: UInt, val kind: NoteKind, val position: Int, val content: String)

private class ItemRow(
    val id: UInt,
    val meetingId: UInt,
    val position: Int,
    val content: String,
    val owner: ActionItemOwner,
    val dueDate: String?,
    val resolved: Boolean,
    val copiedFromId: UInt?,
)

private const val NEW_NOTES_PER_MEETING = 3
private const val NEW_ITEMS_PER_MEETING = 3

/**
 * 1:1 meetings: one per manager–report pair per week over the history window (≈ 132k at scale 1.0),
 * each with three POINT/DECISION notes and three new action items plus the carry-over of the pair's
 * previous meeting's UNRESOLVED items — content re-encrypted with a fresh nonce, `owner`/`dueDate`
 * kept, `resolved = false` on the copy, `copied_from_id` → the source row (`create()` in
 * `OneOnOneService`, "Carry-over" in `.claude/docs/features/one-on-ones.md`). An item is left
 * unresolved with probability `SeedSpec.actionItemUnresolvedRate`; the rest were ticked in a later
 * PUT, which minted an `ACTION_ITEM_RESOLVED{position}` event by the diff rule
 * (`OneOnOneEvents.kt` — 1-based positions, never item text). Every meeting has its `CREATED
 * {date, carriedOver}` event and the creation notification pair (built by
 * `oneOnOneCreationNotifications`, retention-shaped by [NotificationMint]); the manager is the
 * actor of every event (the pair's latest meeting is manager-write only).
 */
suspend fun seedOneOnOnes(ctx: SeedContext, org: Org, mint: NotificationMint) {
    val rng = ctx.rng("one-on-ones")
    val db = ctx.db
    val meetings = RowSink<MeetingRow>(db, OneOnOneService.Meetings) { m ->
        this[OneOnOneService.Meetings.id] = m.id
        this[OneOnOneService.Meetings.managerId] = m.managerId
        this[OneOnOneService.Meetings.subordinateId] = m.subordinateId
        this[OneOnOneService.Meetings.meetingDate] = m.date
        this[OneOnOneService.Meetings.lastModified] = m.lastModified
    }
    val notes = RowSink<NoteRow>(db, OneOnOneService.Notes) { n ->
        this[OneOnOneService.Notes.id] = n.id
        this[OneOnOneService.Notes.meetingId] = n.meetingId
        this[OneOnOneService.Notes.kind] = n.kind
        this[OneOnOneService.Notes.position] = n.position
        this[OneOnOneService.Notes.content] = n.content
    }
    val items = RowSink<ItemRow>(db, OneOnOneService.ActionItems) { i ->
        this[OneOnOneService.ActionItems.id] = i.id
        this[OneOnOneService.ActionItems.meetingId] = i.meetingId
        this[OneOnOneService.ActionItems.position] = i.position
        this[OneOnOneService.ActionItems.content] = i.content
        this[OneOnOneService.ActionItems.owner] = i.owner
        this[OneOnOneService.ActionItems.dueDate] = i.dueDate
        this[OneOnOneService.ActionItems.resolved] = i.resolved
        this[OneOnOneService.ActionItems.copiedFromId] = i.copiedFromId
    }
    val events = eventSink(db, OneOnOneEventService.OneOnOneEvents)
    val group = SinkGroup(meetings, notes, items, events)
    val meetingIds = IdCounter(nextFreeId(db, OneOnOneService.Meetings))
    val noteIds = IdCounter(nextFreeId(db, OneOnOneService.Notes))
    val itemIds = IdCounter(nextFreeId(db, OneOnOneService.ActionItems))
    val eventIds = IdCounter(nextFreeId(db, OneOnOneEventService.OneOnOneEvents))

    val pairs = org.managed.map { PairState(org.byId.getValue(it.managerId!!), it, rng.int(0, 4)) }
    val firstWeek = ctx.config.anchor.minusWeeks(ctx.spec.weeks.toLong())

    for (week in 0 until ctx.spec.weeks) {
        for (pair in pairs) {
            val date = firstWeek.plusWeeks(week.toLong()).plusDays(pair.weekdayOffset.toLong())
            val meetingId = meetingIds.take()
            val at = ctx.millis(date, hour = 9, minuteOffset = week % 50)
            meetings.add(MeetingRow(meetingId, pair.manager.id, pair.subordinate.id, date.toString(), at + 3_600_000))
            addNotes(ctx, rng, notes, noteIds, meetingId)
            val unresolved = addItems(ctx, rng, items, itemIds, pair, meetingId, date)
            events.add(
                oneOnOneCreationEvent(date.toString(), pair.carry.size).let {
                    EventRow(eventIds.take(), meetingId, pair.manager.id, at, it.type.name, it.params)
                },
            )
            unresolved.resolvedPositions.forEachIndexed { k, position ->
                events.add(
                    EventRow(
                        eventIds.take(), meetingId, pair.manager.id, at + 60_000L * (k + 1),
                        OneOnOneEventType.ACTION_ITEM_RESOLVED.name, mapOf("position" to position.toString()),
                    ),
                )
            }
            pair.carry = unresolved.carry
            mint.emitAll(
                oneOnOneCreationNotifications(
                    meetingId, pair.manager.id, pair.subordinate.id,
                    pair.manager.name, pair.subordinate.name, date.toString(),
                ),
                at,
            )
        }
        group.flush()
        mint.sinkGroup.flush()
    }
    advanceSequences(
        db,
        listOf(OneOnOneService.Meetings, OneOnOneService.Notes, OneOnOneService.ActionItems, OneOnOneEventService.OneOnOneEvents),
    )
}

private fun addNotes(ctx: SeedContext, rng: Rng, notes: RowSink<NoteRow>, ids: IdCounter, meetingId: UInt) {
    val positions = mutableMapOf(NoteKind.POINT to 0, NoteKind.DECISION to 0)
    repeat(NEW_NOTES_PER_MEETING) {
        val kind = if (rng.chance(0.65)) NoteKind.POINT else NoteKind.DECISION
        val position = positions.getValue(kind)
        positions[kind] = position + 1
        notes.add(NoteRow(ids.take(), meetingId, kind, position, ctx.cipher.encrypt(Text.paragraph(rng, 60, 220))))
    }
}

private class ItemOutcome(val carry: List<Carry>, val resolvedPositions: List<Int>)

/** Writes the carried-over items first, then the new ones; returns what carries on and what was ticked. */
private fun addItems(
    ctx: SeedContext,
    rng: Rng,
    items: RowSink<ItemRow>,
    ids: IdCounter,
    pair: PairState,
    meetingId: UInt,
    date: LocalDate,
): ItemOutcome {
    val unresolved = mutableListOf<Carry>()
    val resolvedPositions = mutableListOf<Int>()
    var position = 0
    fun add(content: String, owner: ActionItemOwner, due: String?, copiedFrom: UInt?) {
        val resolved = !rng.chance(ctx.spec.actionItemUnresolvedRate)
        val id = ids.take()
        items.add(ItemRow(id, meetingId, position, ctx.cipher.encrypt(content), owner, due, resolved, copiedFrom))
        position++
        if (resolved) resolvedPositions.add(position) else unresolved.add(Carry(id, content, owner, due))
    }
    pair.carry.forEach { add(it.content, it.owner, it.dueDate, it.sourceId) }
    repeat(NEW_ITEMS_PER_MEETING) {
        val owner = if (rng.chance(0.5)) ActionItemOwner.MANAGER else ActionItemOwner.SUBORDINATE
        val due = if (rng.chance(0.7)) date.plusDays(rng.int(7, 28).toLong()).toString() else null
        add(Text.paragraph(rng, 40, 160), owner, due, null)
    }
    return ItemOutcome(unresolved, resolvedPositions)
}
