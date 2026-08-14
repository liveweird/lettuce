package ch.nokillswit.goals

import kotlinx.serialization.Serializable

/**
 * Pure mapping from a goal create / update / transition / delete to the structured audit events
 * it should record. Side-effect-free (no DB) so it can be unit-tested directly; the acting user
 * is the caller and persistence happens in the route (see GoalRoutes).
 *
 * Events are stored structurally ([GoalEventType] + [GoalEventDescriptor.params]) so the SPA
 * renders each one in the viewer's language. Params carry enum names and numeric values only —
 * NEVER title/description/summary/comment text (description and summary are encrypted at rest;
 * goal_events.params is plaintext). The optional progress-update comment (v2.8.0) rides its own
 * encrypted goal_events.comment column, passed to GoalEventService.create alongside the
 * descriptor — never through params.
 */

@Serializable
enum class GoalEventType {
    CREATED,
    TITLE_CHANGED,
    DESCRIPTION_CHANGED,
    TYPE_CHANGED,
    TARGET_CHANGED,
    DUE_DATE_CHANGED,
    PROGRESS_UPDATED,
    // Historical only (the pre-v2.9.0 BINARY type's flag flip): nothing mints it anymore, but
    // stored rows carry it and the SPA still renders it.
    ACHIEVED_CHANGED,
    // PLAN milestones (v2.9.0): definition-edit diff (removed/edited/added, the 1:1 items
    // order) and the progress ticks — params carry the 1-based position only, never the text.
    MILESTONE_ADDED,
    MILESTONE_EDITED,
    MILESTONE_REMOVED,
    MILESTONE_COMPLETED,
    MILESTONE_REOPENED,
    // A comment-only progress update (v2.8.0): the value stayed put, the context is the
    // (encrypted, column-borne) comment.
    PROGRESS_COMMENTED,
    STATUS_CHANGED,
    DELETED,
}

/** A structured audit event: its [type] plus string params for interpolation. */
data class GoalEventDescriptor(
    val type: GoalEventType,
    val params: Map<String, String> = emptyMap(),
)

// Doubles render as e.g. "5.0"/"12.5"; the SPA formats them per locale. "" = no value (a PLAN
// goal's side of a target change).
private fun valueParam(value: Double?): String = value?.toString() ?: ""

// Milestones are identified in params by 1-based position (the 1:1 items convention), never by
// their (encrypted) description.
private fun position(index: Int): Map<String, String> = mapOf("position" to (index + 1).toString())

/** Structured event recorded when a goal is created (always as DRAFT), keyed on its type. */
internal fun goalCreationEvent(type: GoalType): GoalEventDescriptor =
    GoalEventDescriptor(GoalEventType.CREATED, mapOf("type" to type.name))

/**
 * Structured events recorded on a DRAFT definition edit: one per changed aspect, in a stable
 * title → description → type → target → due date → milestones order (within milestones the 1:1
 * items order: removed → edited → added; pure reordering yields nothing — order is
 * presentational). A no-op PUT returns an empty list (no empty events).
 */
internal fun goalDefinitionUpdateEvents(
    before: GoalResponse,
    after: GoalDefinitionUpdate,
): List<GoalEventDescriptor> {
    val events = mutableListOf<GoalEventDescriptor>()
    if (before.title != after.title) {
        events += GoalEventDescriptor(GoalEventType.TITLE_CHANGED)
    }
    if (before.description != after.description) {
        events += GoalEventDescriptor(GoalEventType.DESCRIPTION_CHANGED)
    }
    if (before.type != after.type) {
        events += GoalEventDescriptor(
            GoalEventType.TYPE_CHANGED,
            mapOf("from" to before.type.name, "to" to after.type.name),
        )
    }
    if (before.targetValue != after.targetValue) {
        events += GoalEventDescriptor(
            GoalEventType.TARGET_CHANGED,
            mapOf("from" to valueParam(before.targetValue), "to" to valueParam(after.targetValue)),
        )
    }
    if (before.dueDate != after.dueDate) {
        // ISO dates are content-free (like enum names/numbers) — safe in the plaintext params.
        events += GoalEventDescriptor(
            GoalEventType.DUE_DATE_CHANGED,
            mapOf("from" to before.dueDate, "to" to after.dueDate),
        )
    }
    events += milestoneDefinitionEvents(before.milestones, after.milestones)
    return events
}

// The 1:1 noteEvents diff: removed (before-ids missing from the payload, at their old
// positions), then edited (id-matched, description differs, at their new positions), then
// added (id-less, at their new positions). A type change away from PLAN sends an empty list
// against a non-empty before, so the removals narrate the reset.
private fun milestoneDefinitionEvents(
    before: List<GoalMilestoneResponse>,
    after: List<GoalMilestoneInput>,
): List<GoalEventDescriptor> {
    val afterIds = after.mapNotNull { it.id }.toSet()
    val beforeById = before.associateBy { it.id }
    val events = mutableListOf<GoalEventDescriptor>()
    before.forEachIndexed { index, milestone ->
        if (milestone.id !in afterIds) {
            events += GoalEventDescriptor(GoalEventType.MILESTONE_REMOVED, position(index))
        }
    }
    after.forEachIndexed { index, milestone ->
        val previous = milestone.id?.let(beforeById::get) ?: return@forEachIndexed
        if (previous.description != milestone.description) {
            events += GoalEventDescriptor(GoalEventType.MILESTONE_EDITED, position(index))
        }
    }
    after.forEachIndexed { index, milestone ->
        if (milestone.id == null) {
            events += GoalEventDescriptor(GoalEventType.MILESTONE_ADDED, position(index))
        }
    }
    return events
}

/**
 * Structured events recorded on an ACTIVE progress update: one
 * [GoalEventType.MILESTONE_COMPLETED]/[GoalEventType.MILESTONE_REOPENED] per toggled milestone
 * (1-based positions over the goal's stored order) for a PLAN goal, one
 * [GoalEventType.PROGRESS_UPDATED] (with the from/to values) for the numeric types; an update
 * that changed no state but carries a non-blank comment records
 * [GoalEventType.PROGRESS_COMMENTED]. Empty for a true no-op. The comment itself never enters
 * params — the caller hands it to GoalEventService separately (the encrypted column, attached
 * to the LAST descriptor so it tops the newest-first timeline).
 */
internal fun goalProgressUpdateEvents(
    before: GoalResponse,
    after: GoalProgressUpdate,
): List<GoalEventDescriptor> {
    val events = mutableListOf<GoalEventDescriptor>()
    after.milestones?.let { sent ->
        val sentById = sent.associateBy { it.id }
        before.milestones.forEachIndexed { index, stored ->
            val sentDone = sentById[stored.id]?.done ?: return@forEachIndexed
            if (sentDone != stored.done) {
                val type = if (sentDone) GoalEventType.MILESTONE_COMPLETED else GoalEventType.MILESTONE_REOPENED
                events += GoalEventDescriptor(type, position(index))
            }
        }
    }
    if (after.currentValue != null && after.currentValue != before.currentValue) {
        events += GoalEventDescriptor(
            GoalEventType.PROGRESS_UPDATED,
            mapOf("from" to valueParam(before.currentValue), "to" to valueParam(after.currentValue)),
        )
    }
    if (events.isEmpty() && !after.comment.isNullOrBlank()) {
        events += GoalEventDescriptor(GoalEventType.PROGRESS_COMMENTED)
    }
    return events
}

/** Structured event recorded on every status transition (activate/deactivate/archive/reopen). */
internal fun goalTransitionEvent(from: GoalStatus, to: GoalStatus): GoalEventDescriptor =
    GoalEventDescriptor(
        GoalEventType.STATUS_CHANGED,
        mapOf("from" to from.name, "to" to to.name),
    )

/** Structured event recorded when a draft goal is deleted (soft-deleted) by its manager. */
internal fun goalDeletionEvent(): GoalEventDescriptor =
    GoalEventDescriptor(GoalEventType.DELETED)
