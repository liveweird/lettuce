package ch.nokillswit.daysoff

/**
 * Pure mapping from a days-off action to the structured event the route records after the service
 * commit (the `FeedbackEvents.kt` shape — side-effect-free so it is unit-testable; persistence is
 * the route's, see [DaysOffEventService]). Events are keyed on the PERSON the action concerns
 * ([DaysOffEvent.ownerId]) with the acting caller in [DaysOffEvent.userId].
 *
 * Params are content-free (ids, dates, enum names, numbers, the pool kind's NAME frozen at mint time
 * beside its id — the registry can rename or archive a kind later, and a log line must keep reading
 * as it did) — NEVER the encrypted correction comment. **Out of scope on purpose:** the ADMIN pool-kinds registry and public-holiday
 * registry actions — org configuration, not a person's leave activity (they stay on the OTel audit
 * stream).
 */
enum class DaysOffEventType {
    /** A days-off entry was created — by its owner (a self-create) or by a chain manager on their behalf. */
    ENTRY_RECORDED,

    /** An entry was deleted (soft) — by its owner or a chain manager. */
    ENTRY_DELETED,
    CORRECTION_CREATED,
    CORRECTION_UPDATED,
    CORRECTION_DELETED,

    /** A chain manager set or changed the owner's paid allowance for one pool kind (a fresh grant has no `from`). */
    ALLOWANCE_CHANGED,

    /** A chain manager archived one of the owner's extra paid pools. */
    POOL_ARCHIVED,
}

/** One days-off event: the person it concerns, the actor, its type and its params. */
data class DaysOffEvent(
    val ownerId: UInt,
    // The acting caller. Null = system-originated — nothing mints one today (kept for table parity, V80).
    val userId: UInt?,
    val type: DaysOffEventType,
    val params: Map<String, String> = emptyMap(),
)

private fun MutableMap<String, String>.putIfPresent(key: String, value: Any?) {
    if (value != null) put(key, value.toString())
}

private fun entryParams(entry: DaysOffResponse, actorId: UInt): Map<String, String> = buildMap {
    put("requestId", entry.id.toString())
    put("type", entry.type.name)
    putIfPresent("poolTypeId", entry.poolTypeId)
    putIfPresent("poolName", entry.poolName)
    put("startDate", entry.startDate)
    put("endDate", entry.endDate)
    put("days", entry.days.toString())
    // Someone other than the owner acted: the chain manager's recording/deletion, not the owner's own.
    put("onBehalf", (actorId != entry.userId).toString())
}

/** Recorded for EVERY create — a self-create too (`onBehalf=false`), not only the manager's on-behalf one. */
internal fun daysOffEntryRecordedEvent(actorId: UInt, entry: DaysOffResponse): DaysOffEvent =
    DaysOffEvent(entry.userId, actorId, DaysOffEventType.ENTRY_RECORDED, entryParams(entry, actorId))

internal fun daysOffEntryDeletedEvent(actorId: UInt, entry: DaysOffResponse): DaysOffEvent =
    DaysOffEvent(entry.userId, actorId, DaysOffEventType.ENTRY_DELETED, entryParams(entry, actorId))

internal fun daysOffCorrectionCreatedEvent(actorId: UInt, created: DaysOffCorrectionResponse): DaysOffEvent =
    DaysOffEvent(created.userId, actorId, DaysOffEventType.CORRECTION_CREATED, correctionParams(created))

internal fun daysOffCorrectionDeletedEvent(actorId: UInt, existing: DaysOffCorrectionResponse): DaysOffEvent =
    DaysOffEvent(existing.userId, actorId, DaysOffEventType.CORRECTION_DELETED, correctionParams(existing))

private fun correctionParams(correction: DaysOffCorrectionResponse): Map<String, String> = mapOf(
    "correctionId" to correction.id.toString(),
    "year" to correction.year.toString(),
    "poolTypeId" to correction.poolTypeId.toString(),
    "poolName" to correction.poolName,
    "operation" to correction.operation.name,
    "days" to correction.days.toString(),
)

/**
 * An update carries from/to deltas like the audit event; the pool is immutable, so one
 * `poolTypeId`/`poolName`. **Change-only, like [daysOffAllowanceChangedEvent]:** a PUT that changes none
 * of year, operation or days (a comment-only edit — the comment is encrypted and never an event
 * param — or an idempotent re-PUT) yields `null`, so the log never lists a no-op.
 */
internal fun daysOffCorrectionUpdatedEvent(
    actorId: UInt,
    before: DaysOffCorrectionResponse,
    write: DaysOffCorrectionWrite,
): DaysOffEvent? {
    if (before.year == write.year && before.operation == write.operation && before.days == write.days) return null
    return DaysOffEvent(
        before.userId,
        actorId,
        DaysOffEventType.CORRECTION_UPDATED,
        mapOf(
            "correctionId" to before.id.toString(),
            "poolTypeId" to before.poolTypeId.toString(),
            "poolName" to before.poolName,
            "yearFrom" to before.year.toString(),
            "yearTo" to write.year.toString(),
            "operationFrom" to before.operation.name,
            "operationTo" to write.operation.name,
            "daysFrom" to before.days.toString(),
            "daysTo" to write.days.toString(),
        ),
    )
}

internal fun daysOffAllowanceChangedEvent(
    actorId: UInt,
    ownerId: UInt,
    poolTypeId: UInt,
    poolName: String,
    from: Int?,
    to: Int,
): DaysOffEvent = DaysOffEvent(
    ownerId,
    actorId,
    DaysOffEventType.ALLOWANCE_CHANGED,
    buildMap {
        put("poolTypeId", poolTypeId.toString())
        put("poolName", poolName)
        putIfPresent("from", from)
        put("to", to.toString())
    },
)

internal fun daysOffPoolArchivedEvent(
    actorId: UInt,
    ownerId: UInt,
    poolId: UInt,
    poolTypeId: UInt,
    poolName: String,
    allowance: Int,
): DaysOffEvent = DaysOffEvent(
    ownerId,
    actorId,
    DaysOffEventType.POOL_ARCHIVED,
    mapOf(
        "poolId" to poolId.toString(),
        "poolTypeId" to poolTypeId.toString(),
        "poolName" to poolName,
        "allowance" to allowance.toString(),
    ),
)
