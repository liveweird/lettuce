package ch.nokillswit.users

import ch.nokillswit.dictionaries.DEFAULT_LANGUAGE
import ch.nokillswit.dictionaries.DictionaryEntry

/**
 * Pure mapping from a career-position write to the structured event the route records after the
 * service commit (the `DaysOffEvents.kt` shape — side-effect-free, unit-testable; persistence is
 * the route's, see [CareerPositionEventService]). Keyed on the PERSON whose timeline was touched
 * ([CareerPositionEvent.ownerId]) with the acting chain manager in [CareerPositionEvent.userId].
 *
 * Params are content-free: dates, dictionary entry ids and the entries' display names FROZEN at
 * mint time in the default language (`careerPath`/`careerSpecialization`/`seniorityLevel` carry the
 * ids, `…Name` the frozen text) — entries are soft-deleted and renamable and the public dictionary
 * read lists only active ones, so the log line keeps its own fallback; the SPA prefers the live
 * localized label of the id when it still resolves. **Out of scope on purpose:** account
 * deactivation's `closeFinalPosition`/`reopenFinalPosition` stamps — an ADMIN account action, not a
 * manager's career write.
 */
enum class CareerPositionEventType { POSITION_CREATED, POSITION_UPDATED, POSITION_DELETED }

/** One career-position event: the person it concerns, the actor, its type and its params. */
data class CareerPositionEvent(
    val ownerId: UInt,
    val userId: UInt?,
    val type: CareerPositionEventType,
    val params: Map<String, String> = emptyMap(),
)

/** The three dictionary-backed refs of a position, in their stable order. */
private val REF_FIELDS = listOf("careerPath", "careerSpecialization", "seniorityLevel")

private fun refsOf(careerPathId: UInt?, careerSpecializationId: UInt?, seniorityLevelId: UInt?) =
    listOf(careerPathId, careerSpecializationId, seniorityLevelId)

private fun frozenName(entries: Map<UInt, DictionaryEntry>, id: UInt): String? = entries[id]?.values?.get(DEFAULT_LANGUAGE)

/** `key` → the entry id and `keyName` → its frozen default-language text; nothing when the ref is unset. */
private fun MutableMap<String, String>.putRef(key: String, id: UInt?, entries: Map<UInt, DictionaryEntry>) {
    if (id == null) return
    put(key, id.toString())
    frozenName(entries, id)?.let { put("${key}Name", it) }
}

private fun MutableMap<String, String>.putRefs(refs: List<UInt?>, entries: Map<UInt, DictionaryEntry>) =
    REF_FIELDS.zip(refs).forEach { (field, id) -> putRef(field, id, entries) }

internal fun careerPositionCreatedEvent(
    actorId: UInt,
    ownerId: UInt,
    positionId: UInt,
    write: CareerPositionWrite,
    entries: Map<UInt, DictionaryEntry>,
): CareerPositionEvent = CareerPositionEvent(
    ownerId,
    actorId,
    CareerPositionEventType.POSITION_CREATED,
    buildMap {
        put("positionId", positionId.toString())
        put("startDate", write.startDate)
        putRefs(refsOf(write.careerPathId, write.careerSpecializationId, write.seniorityLevelId), entries)
    },
)

internal fun careerPositionDeletedEvent(
    actorId: UInt,
    existing: CareerPositionService.PositionRow,
    entries: Map<UInt, DictionaryEntry>,
): CareerPositionEvent = CareerPositionEvent(
    existing.userId,
    actorId,
    CareerPositionEventType.POSITION_DELETED,
    buildMap {
        put("positionId", existing.id.toString())
        put("startDate", existing.startDate)
        putRefs(refsOf(existing.careerPathId, existing.careerSpecializationId, existing.seniorityLevelId), entries)
    },
)

/**
 * An update carries from/to deltas for what CHANGED (start date, and per ref the id plus its frozen
 * name, `From` omitted when it was unset and `To` when it is cleared) next to the position's resulting
 * `startDate`. **Change-only:** a PUT that changes neither the start date nor any ref yields `null`.
 * [entries] must resolve every id on both sides (soft-deleted entries included).
 */
internal fun careerPositionUpdatedEvent(
    actorId: UInt,
    existing: CareerPositionService.PositionRow,
    write: CareerPositionWrite,
    entries: Map<UInt, DictionaryEntry>,
): CareerPositionEvent? {
    val before = refsOf(existing.careerPathId, existing.careerSpecializationId, existing.seniorityLevelId)
    val after = refsOf(write.careerPathId, write.careerSpecializationId, write.seniorityLevelId)
    if (write.startDate == existing.startDate && before == after) return null
    return CareerPositionEvent(
        existing.userId,
        actorId,
        CareerPositionEventType.POSITION_UPDATED,
        buildMap {
            put("positionId", existing.id.toString())
            put("startDate", write.startDate)
            if (write.startDate != existing.startDate) {
                put("startDateFrom", existing.startDate)
                put("startDateTo", write.startDate)
            }
            REF_FIELDS.forEachIndexed { i, field ->
                if (before[i] == after[i]) return@forEachIndexed
                putRef("${field}From", before[i], entries)
                putRef("${field}To", after[i], entries)
            }
        },
    )
}
