package ch.nokillswit.perf

import ch.nokillswit.dictionaries.Dictionary
import ch.nokillswit.dictionaries.DictionaryEntry
import ch.nokillswit.dictionaries.DictionaryService
import ch.nokillswit.users.CareerPositionEventService
import ch.nokillswit.users.CareerPositionService
import ch.nokillswit.users.CareerPositionWrite
import ch.nokillswit.users.careerPositionCreatedEvent
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.r2dbc.insert
import org.jetbrains.exposed.v1.r2dbc.selectAll
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import java.time.LocalDate

/** The career dictionaries are topped up to at least this many active entries (the V32 seeds are 4/5/8). */
private val DICTIONARY_FLOORS = mapOf(
    Dictionary.CAREER_PATH to listOf("Data Engineer", "DevOps Engineer"),
    Dictionary.CAREER_SPECIALIZATION to listOf("Kotlin", "Go", "Rust", "DevOps", "Data", "Mobile", "Cloud"),
)

/** Appends missing entries (EN value only, no translations — the table's `{}` default shape) and returns the active ids per dictionary. */
private suspend fun topUpDictionaries(ctx: SeedContext): Map<Dictionary, List<UInt>> = suspendTransaction(ctx.db) {
    val entries = DictionaryService.Entries
    DICTIONARY_FLOORS.forEach { (dictionary, extras) ->
        val existing = entries.selectAll()
            .where { (entries.dictionary eq dictionary.name) and (entries.markedAsDeleted eq false) }
            .map { it[entries.valueEn] }.toList()
        extras.filter { it !in existing }.forEachIndexed { i, value ->
            entries.insert {
                it[entries.dictionary] = dictionary.name
                it[entries.position] = existing.size + i
                it[entries.valueEn] = value
                it[entries.translations] = "{}"
            }
        }
    }
    listOf(Dictionary.CAREER_PATH, Dictionary.CAREER_SPECIALIZATION, Dictionary.SENIORITY_LEVEL).associateWith { dictionary ->
        entries.selectAll()
            .where { (entries.dictionary eq dictionary.name) and (entries.markedAsDeleted eq false) }
            .map { it[entries.id].value to it[entries.position] }.toList()
            .sortedBy { it.second }.map { it.first }
    }
}

/** The three career dictionaries' active entries as the event builders want them (frozen EN names). */
private suspend fun entryNames(ctx: SeedContext): Map<UInt, DictionaryEntry> = suspendTransaction(ctx.db) {
    val entries = DictionaryService.Entries
    val names = listOf(Dictionary.CAREER_PATH, Dictionary.CAREER_SPECIALIZATION, Dictionary.SENIORITY_LEVEL).map { it.name }
    entries.selectAll().where { entries.dictionary inList names }
        .map { DictionaryEntry(it[entries.id].value, mapOf("en" to it[entries.valueEn])) }.toList().associateBy { it.id }
}

private class CareerRow(
    val id: UInt,
    val userId: UInt,
    val start: LocalDate,
    val path: UInt,
    val specialization: UInt,
    val seniority: UInt,
    val startMillis: Long,
)

/**
 * One or two `user_career_positions` per person over the history: a first position near the start
 * of the window and, for half of the people, a promotion 18–40 months later (the triple always
 * differs from its predecessor — the service's adjacent-sameness rule; `(user, start)` is unique).
 * The latest row derives the person's current career profile (`.claude/docs/features/dictionaries.md`).
 * Every position of a person with a manager also has its `POSITION_CREATED` event in the person-keyed
 * `career_position_events` trail (V89, `careerPositionCreatedEvent`; actor = the direct manager — the
 * chain manager who writes a timeline; the CEO has none, so no event).
 */
suspend fun seedCareers(ctx: SeedContext, org: Org) {
    val dictionaries = topUpDictionaries(ctx)
    val paths = dictionaries.getValue(Dictionary.CAREER_PATH)
    val specializations = dictionaries.getValue(Dictionary.CAREER_SPECIALIZATION)
    val seniorities = dictionaries.getValue(Dictionary.SENIORITY_LEVEL)
    val rng = ctx.rng("careers")
    val positions = CareerPositionService.CareerPositions
    val ids = IdCounter(nextFreeId(ctx.db, positions))
    val sink = RowSink<CareerRow>(ctx.db, positions) { r ->
        this[positions.id] = r.id
        this[positions.userId] = r.userId
        this[positions.startDate] = r.start.toString()
        this[positions.careerPathId] = r.path
        this[positions.careerSpecializationId] = r.specialization
        this[positions.seniorityLevelId] = r.seniority
        this[positions.createdAt] = r.startMillis
        this[positions.lastModified] = r.startMillis
    }
    val events = EventStream(ctx.db, CareerPositionEventService.CareerPositionEvents)
    events.init(ctx.db)
    val names = entryNames(ctx)
    fun add(row: CareerRow, person: Person) {
        sink.add(row)
        val manager = person.managerId ?: return
        val created = careerPositionCreatedEvent(
            manager, person.id, row.id, CareerPositionWrite(row.start.toString(), row.path, row.specialization, row.seniority), names,
        )
        events.add(person.id, manager, row.startMillis, created.type.name, created.params)
    }
    val historyStart = ctx.config.anchor.minusMonths(ctx.spec.months.toLong())
    org.people.forEach { person ->
        // Leaders sit higher on the seniority ladder than the people they lead.
        val base = (seniorities.size - 1 - (person.level - 1) * 2).coerceIn(0, seniorities.size - 1)
        val seniority = (base + rng.int(-1, 1)).coerceIn(0, seniorities.size - 1)
        val path = rng.pick(paths)
        val specialization = rng.pick(specializations)
        val firstStart = historyStart.plusDays(rng.int(0, 120).toLong())
        add(CareerRow(ids.take(), person.id, firstStart, path, specialization, seniorities[seniority], ctx.millis(firstStart)), person)
        val secondStart = firstStart.plusMonths(rng.int(18, 40).toLong())
        if (rng.chance(0.5) && secondStart < ctx.config.anchor) {
            val promoted = seniorities[(seniority + 1).coerceAtMost(seniorities.size - 1)]
            val moved = if (promoted == seniorities[seniority]) {
                rng.pick(specializations.filter { it != specialization })
            } else {
                specialization
            }
            add(CareerRow(ids.take(), person.id, secondStart, path, moved, promoted, ctx.millis(secondStart)), person)
        }
    }
    SinkGroup(sink, events.sink).flush()
    advanceSequences(ctx.db, listOf(positions, CareerPositionEventService.CareerPositionEvents))
}
