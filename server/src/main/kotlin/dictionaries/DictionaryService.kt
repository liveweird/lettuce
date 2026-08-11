package ch.nokillswit.dictionaries

import io.ktor.server.plugins.BadRequestException
import io.ktor.util.AttributeKey
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.Op
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
        // Per-dictionary, per-LANGUAGE value uniqueness is enforced by two partial unique
        // indexes (active rows only; V31, split per language in V53), so a soft-deleted entry
        // frees both its values. Exposed table defs are query-only (not DDL), so no
        // `.uniqueIndex()` here.
        val dictionary = varchar("dictionary", length = 30)
        val position = integer("position")
        val valueEn = varchar("value_en", length = 100)
        val valuePl = varchar("value_pl", length = 100)
        val markedAsDeleted = bool("marked_as_deleted").default(false)
    }

    private fun active(): Op<Boolean> = Entries.markedAsDeleted eq false

    /** The dictionary's active entries in the admin-curated order (id as deterministic tiebreaker). */
    suspend fun read(dict: Dictionary): List<DictionaryEntry> = suspendTransaction(database) {
        Entries.selectAll()
            .where { (Entries.dictionary eq dict.name) and active() }
            .orderBy(Entries.position to SortOrder.ASC, Entries.id to SortOrder.ASC)
            .map { row ->
                DictionaryEntry(
                    id = row[Entries.id].value,
                    valueEn = row[Entries.valueEn],
                    valuePl = row[Entries.valuePl],
                )
            }
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

            // Snapshot the ACTIVE rows only (id -> stored value pair). The load-bearing
            // difference from the 1:1 replaceNotes: a payload id pointing at a soft-deleted
            // entry is a foreign id (400) — deleted entries are never resurrected; re-adding
            // the same value mints a NEW id.
            val existing: Map<UInt, Pair<String, String>> =
                Entries.select(Entries.id, Entries.valueEn, Entries.valuePl)
                    .where { (Entries.dictionary eq dict.name) and active() }
                    .map { it[Entries.id].value to (it[Entries.valueEn] to it[Entries.valuePl]) }
                    .toList()
                    .toMap()

            val payloadIds = request.items.mapNotNull { it.id }
            requirePayloadIds(payloadIds, existing.keys)

            // Soft-delete FIRST: frees those values under the partial unique index before the
            // upserts run, so "remove X + add new X" and "rename onto a just-removed value"
            // succeed in one save. The dead rows keep their stale position on purpose.
            val toSoftDelete = existing.keys - payloadIds.toSet()
            if (toSoftDelete.isNotEmpty()) {
                Entries.update({ Entries.id inList toSoftDelete }) { it[markedAsDeleted] = true }
            }

            request.items.forEachIndexed { index, item ->
                val trimmedEn = item.valueEn.trim()
                val trimmedPl = item.valuePl.trim()
                if (item.id != null) {
                    Entries.update({ (Entries.id eq item.id) and active() }) {
                        it[position] = index
                        it[valueEn] = trimmedEn
                        it[valuePl] = trimmedPl
                    }
                } else {
                    Entries.insert {
                        it[dictionary] = dict.name
                        it[position] = index
                        it[valueEn] = trimmedEn
                        it[valuePl] = trimmedPl
                    }
                }
            }

            DictionaryReplaceCounts(
                added = request.items.count { it.id == null },
                // Renamed = either language's text changed (identity kept via the id).
                renamed = request.items.count {
                    it.id != null && existing[it.id] != (it.valueEn.trim() to it.valuePl.trim())
                },
                removed = toSoftDelete.size,
            )
        }

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
