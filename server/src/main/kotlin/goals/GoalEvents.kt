package ch.nokillswit.goals

import kotlinx.serialization.Serializable

/**
 * Pure mapping from a goal create / update / transition / delete to the structured audit events
 * it should record. Side-effect-free (no DB) so it can be unit-tested directly; the acting user
 * is the caller and persistence happens in the route (see GoalRoutes).
 *
 * Events are stored structurally ([GoalEventType] + [GoalEventDescriptor.params]) so the SPA
 * renders each one in the viewer's language. Params carry enum names and numeric values only —
 * NEVER title/description/summary text (description and summary are encrypted at rest;
 * goal_events.params is plaintext).
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
    ACHIEVED_CHANGED,
    STATUS_CHANGED,
    DELETED,
}

/** A structured audit event: its [type] plus string params for interpolation. */
data class GoalEventDescriptor(
    val type: GoalEventType,
    val params: Map<String, String> = emptyMap(),
)

// Doubles render as e.g. "5.0"/"12.5"; the SPA formats them per locale. "" = no value (a BINARY
// goal's side of a target change).
private fun valueParam(value: Double?): String = value?.toString() ?: ""

/** Structured event recorded when a goal is created (always as DRAFT), keyed on its type. */
internal fun goalCreationEvent(type: GoalType): GoalEventDescriptor =
    GoalEventDescriptor(GoalEventType.CREATED, mapOf("type" to type.name))

/**
 * Structured events recorded on a DRAFT definition edit: one per changed aspect, in a stable
 * title → description → type → target → due date order. A no-op PUT returns an empty list (no
 * empty events).
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
    return events
}

/**
 * Structured event recorded on an ACTIVE progress update: [GoalEventType.ACHIEVED_CHANGED] for a
 * BINARY goal, [GoalEventType.PROGRESS_UPDATED] (with the from/to values) otherwise. Returns null
 * when the value did not actually change (no event for a no-op).
 */
internal fun goalProgressUpdateEvent(
    before: GoalResponse,
    after: GoalProgressUpdate,
): GoalEventDescriptor? = when {
    after.achieved != null && after.achieved != before.achieved ->
        GoalEventDescriptor(GoalEventType.ACHIEVED_CHANGED, mapOf("to" to after.achieved.toString()))
    after.currentValue != null && after.currentValue != before.currentValue ->
        GoalEventDescriptor(
            GoalEventType.PROGRESS_UPDATED,
            mapOf("from" to valueParam(before.currentValue), "to" to valueParam(after.currentValue)),
        )
    else -> null
}

/** Structured event recorded on every status transition (activate/deactivate/close/reopen). */
internal fun goalTransitionEvent(from: GoalStatus, to: GoalStatus): GoalEventDescriptor =
    GoalEventDescriptor(
        GoalEventType.STATUS_CHANGED,
        mapOf("from" to from.name, "to" to to.name),
    )

/** Structured event recorded when a draft goal is deleted (soft-deleted) by its manager. */
internal fun goalDeletionEvent(): GoalEventDescriptor =
    GoalEventDescriptor(GoalEventType.DELETED)
