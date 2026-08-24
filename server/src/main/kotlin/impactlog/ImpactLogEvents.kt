package ch.nokillswit.impactlog

import kotlinx.serialization.Serializable

/**
 * Pure mapping from an impact log entry create / update / delete to the structured audit events
 * it should record. Side-effect-free (no DB) so it can be unit-tested directly; the acting user
 * is always the entry's owner and persistence happens in the route (see ImpactLogRoutes).
 *
 * Events are stored structurally ([ImpactEntryEventType] + params) so the SPA renders each one
 * in the viewer's language. Params carry ISO dates and field-name lists only — NEVER section
 * text (the four sections are encrypted at rest; impact_log_events.params is plaintext).
 */

@Serializable
enum class ImpactEntryEventType {
    CREATED,
    UPDATED,
    DELETED,
}

/** A structured audit event: its [type] plus string params for interpolation. */
data class ImpactEntryEventDescriptor(
    val type: ImpactEntryEventType,
    val params: Map<String, String> = emptyMap(),
)

// The stable field-name vocabulary of the UPDATED event's `changed` list (SPA-localized).
private const val FIELD_TITLE = "title"
private const val FIELD_PERIOD_START = "periodStart"
private const val FIELD_PERIOD_END = "periodEnd"
private const val FIELD_WHAT_HAPPENED = "whatHappened"
private const val FIELD_CONTRIBUTION = "contribution"
private const val FIELD_WHY_IT_MATTERED = "whyItMattered"
private const val FIELD_EVIDENCE = "evidence"

/** Structured event recorded when an entry is created, carrying its (content-free) period. */
internal fun impactEntryCreationEvent(periodStart: String, periodEnd: String): ImpactEntryEventDescriptor =
    ImpactEntryEventDescriptor(
        ImpactEntryEventType.CREATED,
        mapOf("periodStart" to periodStart, "periodEnd" to periodEnd),
    )

/**
 * Structured event recorded on an edit: ONE UPDATED event whose `changed` param comma-joins the
 * touched field names (stable title → period → sections order); period changes additionally carry their
 * from/to ISO dates (content-free like the goal due-date deltas — section texts never ride
 * along, changed or not). A no-op PUT returns null (no empty events).
 */
internal fun impactEntryUpdateEvent(
    before: ImpactEntryResponse,
    after: ImpactEntryRequest,
): ImpactEntryEventDescriptor? {
    val changed = mutableListOf<String>()
    val params = mutableMapOf<String, String>()
    if (before.title != after.title) changed += FIELD_TITLE
    if (before.periodStart != after.periodStart) {
        changed += FIELD_PERIOD_START
        params["periodStartFrom"] = before.periodStart
        params["periodStartTo"] = after.periodStart
    }
    if (before.periodEnd != after.periodEnd) {
        changed += FIELD_PERIOD_END
        params["periodEndFrom"] = before.periodEnd
        params["periodEndTo"] = after.periodEnd
    }
    if (before.whatHappened != after.whatHappened) changed += FIELD_WHAT_HAPPENED
    if (before.contribution != after.contribution) changed += FIELD_CONTRIBUTION
    if (before.whyItMattered != after.whyItMattered) changed += FIELD_WHY_IT_MATTERED
    if (before.evidence != after.evidence) changed += FIELD_EVIDENCE
    if (changed.isEmpty()) return null
    params["changed"] = changed.joinToString(",")
    return ImpactEntryEventDescriptor(ImpactEntryEventType.UPDATED, params)
}

/** Structured event recorded when the owner deletes (soft-deletes) an entry. */
internal fun impactEntryDeletionEvent(): ImpactEntryEventDescriptor =
    ImpactEntryEventDescriptor(ImpactEntryEventType.DELETED)
