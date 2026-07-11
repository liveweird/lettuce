package ch.nokillswit.oneonones

import kotlinx.serialization.Serializable

/**
 * Pure mapping from a 1:1 meeting create / update / delete to the structured audit events it
 * should record. Side-effect-free (no DB) so it can be unit-tested directly; the acting user is
 * the caller and persistence happens in the route (see OneOnOneRoutes).
 *
 * Events are stored structurally ([OneOnOneEventType] + [OneOnOneEventDescriptor.params]) so the
 * SPA renders each one in the viewer's language. Params carry positions (1-based), ISO dates, and
 * enum names only — NEVER item text: the content columns are encrypted at rest and must not leak
 * into the plaintext `one_on_one_events.params` column.
 */

@Serializable
enum class OneOnOneEventType {
    CREATED,
    DELETED,
    DATE_CHANGED,
    POINT_ADDED,
    POINT_EDITED,
    POINT_REMOVED,
    DECISION_ADDED,
    DECISION_EDITED,
    DECISION_REMOVED,
    ACTION_ITEM_ADDED,
    ACTION_ITEM_EDITED,
    ACTION_ITEM_REMOVED,
    ACTION_ITEM_RESOLVED,
    ACTION_ITEM_UNRESOLVED,
    ACTION_ITEM_DUE_DATE_CHANGED,
    ACTION_ITEM_OWNER_CHANGED,
}

/** A structured audit event: its [type] plus string params for interpolation. */
data class OneOnOneEventDescriptor(
    val type: OneOnOneEventType,
    val params: Map<String, String> = emptyMap(),
)

/** Recorded when a meeting is created; [carriedOver] counts the action items copied in. */
internal fun oneOnOneCreationEvent(meetingDate: String, carriedOver: Int): OneOnOneEventDescriptor =
    OneOnOneEventDescriptor(
        OneOnOneEventType.CREATED,
        mapOf("date" to meetingDate, "carriedOver" to carriedOver.toString()),
    )

/** Recorded when a meeting is soft-deleted by its manager. */
internal fun oneOnOneDeletionEvent(): OneOnOneEventDescriptor =
    OneOnOneEventDescriptor(OneOnOneEventType.DELETED)

/**
 * Per-item diff of the current document against the full-replace payload. Items are matched by
 * id: an id-less payload entry is an addition, a stored row missing from the payload a removal,
 * and a matched pair is compared aspect by aspect (one event per changed aspect). Positions in
 * params are 1-based and refer to the document state at event time — the OLD position for
 * `*_REMOVED`, the NEW (payload) position for everything else.
 *
 * Pure reordering yields NOTHING: order is presentational, and move events would flood the
 * timeline with zero information. A no-op replace therefore returns an empty list.
 *
 * Deterministic order: date change → points → decisions → action items; within each section
 * removed → edited → added.
 */
internal fun oneOnOneUpdateEvents(
    before: OneOnOneResponse,
    after: OneOnOneUpdateRequest,
): List<OneOnOneEventDescriptor> {
    val events = mutableListOf<OneOnOneEventDescriptor>()
    if (before.meetingDate != after.meetingDate) {
        events += OneOnOneEventDescriptor(
            OneOnOneEventType.DATE_CHANGED,
            mapOf("from" to before.meetingDate, "to" to after.meetingDate),
        )
    }
    events += noteEvents(
        before.points, after.points,
        OneOnOneEventType.POINT_ADDED, OneOnOneEventType.POINT_EDITED, OneOnOneEventType.POINT_REMOVED,
    )
    events += noteEvents(
        before.decisions, after.decisions,
        OneOnOneEventType.DECISION_ADDED, OneOnOneEventType.DECISION_EDITED, OneOnOneEventType.DECISION_REMOVED,
    )
    events += actionItemEvents(before.actionItems, after.actionItems)
    return events
}

private fun position(index: Int): Map<String, String> = mapOf("position" to (index + 1).toString())

private fun noteEvents(
    before: List<OneOnOneItemResponse>,
    after: List<OneOnOneItemInput>,
    added: OneOnOneEventType,
    edited: OneOnOneEventType,
    removed: OneOnOneEventType,
): List<OneOnOneEventDescriptor> {
    val afterIds = after.mapNotNull { it.id }.toSet()
    val beforeById = before.associateBy { it.id }
    val events = mutableListOf<OneOnOneEventDescriptor>()
    before.forEachIndexed { index, item ->
        if (item.id !in afterIds) events += OneOnOneEventDescriptor(removed, position(index))
    }
    after.forEachIndexed { index, item ->
        val previous = item.id?.let(beforeById::get) ?: return@forEachIndexed
        if (previous.content != item.content) events += OneOnOneEventDescriptor(edited, position(index))
    }
    after.forEachIndexed { index, item ->
        if (item.id == null) events += OneOnOneEventDescriptor(added, position(index))
    }
    return events
}

private fun actionItemEvents(
    before: List<OneOnOneActionItemResponse>,
    after: List<OneOnOneActionItemInput>,
): List<OneOnOneEventDescriptor> {
    val afterIds = after.mapNotNull { it.id }.toSet()
    val beforeById = before.associateBy { it.id }
    val events = mutableListOf<OneOnOneEventDescriptor>()
    before.forEachIndexed { index, item ->
        if (item.id !in afterIds) {
            events += OneOnOneEventDescriptor(OneOnOneEventType.ACTION_ITEM_REMOVED, position(index))
        }
    }
    after.forEachIndexed { index, item ->
        val previous = item.id?.let(beforeById::get) ?: return@forEachIndexed
        if (previous.content != item.content) {
            events += OneOnOneEventDescriptor(OneOnOneEventType.ACTION_ITEM_EDITED, position(index))
        }
        if (previous.resolved != item.resolved) {
            val type = if (item.resolved) OneOnOneEventType.ACTION_ITEM_RESOLVED else OneOnOneEventType.ACTION_ITEM_UNRESOLVED
            events += OneOnOneEventDescriptor(type, position(index))
        }
        if (previous.dueDate != item.dueDate) {
            events += OneOnOneEventDescriptor(
                OneOnOneEventType.ACTION_ITEM_DUE_DATE_CHANGED,
                // Empty string = no due date on that side; the SPA words the unset side via context.
                position(index) + mapOf("from" to (previous.dueDate ?: ""), "to" to (item.dueDate ?: "")),
            )
        }
        if (previous.owner != item.owner) {
            events += OneOnOneEventDescriptor(
                OneOnOneEventType.ACTION_ITEM_OWNER_CHANGED,
                position(index) + mapOf("from" to previous.owner.name, "to" to item.owner.name),
            )
        }
    }
    after.forEachIndexed { index, item ->
        if (item.id == null) {
            events += OneOnOneEventDescriptor(OneOnOneEventType.ACTION_ITEM_ADDED, position(index))
        }
    }
    return events
}
