package ch.nokillswit.teamkpis

import kotlinx.serialization.Serializable

/**
 * Pure mapping from a team-KPI create / update / transition / delete to the structured audit
 * events it should record. Side-effect-free (no DB) so it can be unit-tested directly; the acting
 * user is the caller and persistence happens in the route (see TeamKpiRoutes).
 *
 * Events are stored structurally ([TeamKpiEventType] + [TeamKpiEventDescriptor.params]) so the
 * SPA renders each one in the viewer's language. Params carry enum names, numeric values, and ISO
 * dates only — NEVER title/description/summary text (description and summary are encrypted at
 * rest; team_kpi_events.params is plaintext).
 */

@Serializable
enum class TeamKpiEventType {
    CREATED,
    TITLE_CHANGED,
    DESCRIPTION_CHANGED,
    TYPE_CHANGED,
    TARGET_CHANGED,
    PROGRESS_UPDATED,
    STATUS_CHANGED,
    DELETED,
}

/** A structured audit event: its [type] plus string params for interpolation. */
data class TeamKpiEventDescriptor(
    val type: TeamKpiEventType,
    val params: Map<String, String> = emptyMap(),
)

// Doubles render as e.g. "5.0"/"12.5"; the SPA formats them per locale.
private fun valueParam(value: Double): String = value.toString()

/** Structured event recorded when a KPI is created (always as DRAFT), keyed on its type. */
internal fun teamKpiCreationEvent(type: TeamKpiType): TeamKpiEventDescriptor =
    TeamKpiEventDescriptor(TeamKpiEventType.CREATED, mapOf("type" to type.name))

/**
 * Structured events recorded on a DRAFT definition edit: one per changed aspect, in a stable
 * title → description → type → target order. A no-op PUT returns an empty list (no empty events).
 */
internal fun teamKpiDefinitionUpdateEvents(
    before: TeamKpiResponse,
    after: TeamKpiDefinitionUpdate,
): List<TeamKpiEventDescriptor> {
    val events = mutableListOf<TeamKpiEventDescriptor>()
    if (before.title != after.title) {
        events += TeamKpiEventDescriptor(TeamKpiEventType.TITLE_CHANGED)
    }
    if (before.description != after.description) {
        events += TeamKpiEventDescriptor(TeamKpiEventType.DESCRIPTION_CHANGED)
    }
    if (before.type != after.type) {
        events += TeamKpiEventDescriptor(
            TeamKpiEventType.TYPE_CHANGED,
            mapOf("from" to before.type.name, "to" to after.type.name),
        )
    }
    if (after.targetValue != null && before.targetValue != after.targetValue) {
        events += TeamKpiEventDescriptor(
            TeamKpiEventType.TARGET_CHANGED,
            mapOf("from" to valueParam(before.targetValue), "to" to valueParam(after.targetValue)),
        )
    }
    return events
}

/**
 * Structured event recorded on an ACTIVE progress update, with the recorded value and its
 * user-supplied date — the KPI view's Graph tab derives its value-over-time series from exactly
 * these events (params `{to, date}`; pre-v1.28 events carried `{from, to}` with no date and the
 * SPA still renders them). There is no `from`: with backdating, the row's currentValue may not
 * change at all, so a from→to wording would mislead. Returns null only for an exact no-op — the
 * same value on the same date as the row's latest-dated record; the same value on a NEW date is
 * a real data point and mints an event.
 */
internal fun teamKpiProgressUpdateEvent(
    before: TeamKpiResponse,
    after: TeamKpiProgressUpdate,
): TeamKpiEventDescriptor? = when {
    after.currentValue != null && after.date != null &&
        !(after.currentValue == before.currentValue && after.date == before.currentValueDate) ->
        TeamKpiEventDescriptor(
            TeamKpiEventType.PROGRESS_UPDATED,
            mapOf("to" to valueParam(after.currentValue), "date" to after.date),
        )
    else -> null
}

/** Structured event recorded on every status transition (activate/deactivate/close/reopen). */
internal fun teamKpiTransitionEvent(from: TeamKpiStatus, to: TeamKpiStatus): TeamKpiEventDescriptor =
    TeamKpiEventDescriptor(
        TeamKpiEventType.STATUS_CHANGED,
        mapOf("from" to from.name, "to" to to.name),
    )

/** Structured event recorded when a draft KPI is deleted (soft-deleted) by the team's manager. */
internal fun teamKpiDeletionEvent(): TeamKpiEventDescriptor =
    TeamKpiEventDescriptor(TeamKpiEventType.DELETED)
