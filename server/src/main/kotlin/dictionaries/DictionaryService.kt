package ch.nokillswit.dictionaries

import ch.nokillswit.infra.db.decodeParams
import ch.nokillswit.infra.db.encodeParams
import io.ktor.server.plugins.BadRequestException
import io.ktor.util.AttributeKey
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.Op
import org.jetbrains.exposed.v1.core.ResultRow
import org.jetbrains.exposed.v1.core.SortOrder
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.dao.id.UIntIdTable
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase
import org.jetbrains.exposed.v1.r2dbc.insert
import org.jetbrains.exposed.v1.r2dbc.select
import org.jetbrains.exposed.v1.r2dbc.selectAll
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import org.jetbrains.exposed.v1.r2dbc.update

val DictionaryServiceKey = AttributeKey<DictionaryService>("DictionaryService")

/** What a whole-document replace actually did — carried into the `dictionary.updated` audit event. */
data class DictionaryReplaceCounts(val added: Int, val renamed: Int, val removed: Int)

class DictionaryService(val database: R2dbcDatabase) {
    object Entries : UIntIdTable("dictionary_entries") {
        // Per-dictionary EN value uniqueness is enforced by the partial unique index
        // uq_dictionary_entries_value_en_active (active rows only; V31, per-language in
        // V53, EN-only since V60 — non-EN uniqueness lives in validateDictionaryUpdate),
        // so a soft-deleted entry frees its values. Exposed table defs are query-only
        // (not DDL), so no `.uniqueIndex()` here.
        val dictionary = varchar("dictionary", length = 30)
        val position = integer("position")
        val valueEn = varchar("value_en", length = 100)

        // JSON {lang -> value} map of the NON-EN translations (V60, the notifications-params
        // idiom); '{}' when none. Never filtered/sorted in SQL.
        val translations = text("translations")
        val markedAsDeleted = bool("marked_as_deleted").default(false)
    }

    private fun active(): Op<Boolean> = Entries.markedAsDeleted eq false

    /** The dictionary's active entries in the admin-curated order (id as deterministic tiebreaker). */
    suspend fun read(dict: Dictionary): List<DictionaryEntry> = suspendTransaction(database) {
        Entries.selectAll()
            .where { (Entries.dictionary eq dict.name) and active() }
            .orderBy(Entries.position to SortOrder.ASC, Entries.id to SortOrder.ASC)
            .map { row -> DictionaryEntry(id = row[Entries.id].value, values = rowValues(row)) }
            .toList()
    }

    /**
     * Whole-document replace (the 1:1 replaceNotes idiom, adapted to soft-delete): an item
     * carrying an `id` updates that active entry in place (rename keeps identity), an id-less
     * item inserts, and an active entry missing from the payload is soft-deleted — never
     * physically removed. Positions are rewritten from payload order.
     */
    suspend fun replace(dict: Dictionary, request: DictionaryUpdateRequest): DictionaryReplaceCounts =
        suspendTransaction(database) {
            validateDictionaryUpdate(request)

            // Snapshot the ACTIVE rows only (id -> stored language map). The load-bearing
            // difference from the 1:1 replaceNotes: a payload id pointing at a soft-deleted
            // entry is a foreign id (400) — deleted entries are never resurrected; re-adding
            // the same value mints a NEW id.
            val existing: Map<UInt, Map<String, String>> =
                Entries.select(Entries.id, Entries.valueEn, Entries.translations)
                    .where { (Entries.dictionary eq dict.name) and active() }
                    .map { it[Entries.id].value to rowValues(it) }
                    .toList()
                    .toMap()

            val payloadIds = request.items.mapNotNull { it.id }
            requirePayloadIds(payloadIds, existing.keys)

            // Soft-delete FIRST: frees those values under the EN partial unique index before
            // the upserts run, so "remove X + add new X" and "rename onto a just-removed
            // value" succeed in one save. The dead rows keep their stale position on purpose.
            val toSoftDelete = existing.keys - payloadIds.toSet()
            if (toSoftDelete.isNotEmpty()) {
                Entries.update({ Entries.id inList toSoftDelete }) { it[markedAsDeleted] = true }
            }

            request.items.forEachIndexed { index, item ->
                val normalized = normalizedValues(item)
                val encodedTranslations = encodeParams(normalized - DEFAULT_LANGUAGE)
                if (item.id != null) {
                    Entries.update({ (Entries.id eq item.id) and active() }) {
                        it[position] = index
                        it[valueEn] = normalized.getValue(DEFAULT_LANGUAGE)
                        it[translations] = encodedTranslations
                    }
                } else {
                    Entries.insert {
                        it[dictionary] = dict.name
                        it[position] = index
                        it[valueEn] = normalized.getValue(DEFAULT_LANGUAGE)
                        it[translations] = encodedTranslations
                    }
                }
            }

            DictionaryReplaceCounts(
                added = request.items.count { it.id == null },
                // Renamed = ANY language's text changed (identity kept via the id) —
                // a translation-only change counts, exactly like the bilingual era.
                renamed = request.items.count {
                    it.id != null && existing[it.id] != normalizedValues(it)
                },
                removed = toSoftDelete.size,
            )
        }

    /** Assemble the wire map from a row: EN (the required column) first, then the JSON rest. */
    private fun rowValues(row: ResultRow): Map<String, String> =
        mapOf(DEFAULT_LANGUAGE to row[Entries.valueEn]) + decodeParams(row[Entries.translations])

    /** The stored form of a payload item's map: every provided value trimmed. */
    private fun normalizedValues(item: DictionaryEntryInput): Map<String, String> =
        item.values.mapValues { (_, value) -> value.trim() }

    private fun requirePayloadIds(payloadIds: List<UInt>, existingIds: Set<UInt>) {
        if (payloadIds.size != payloadIds.toSet().size) {
            throw BadRequestException("Duplicate entry id in payload")
        }
        val foreign = payloadIds.filterNot { it in existingIds }
        if (foreign.isNotEmpty()) {
            throw BadRequestException("Unknown entry id(s) for this dictionary: ${foreign.joinToString()}")
        }
    }
}
