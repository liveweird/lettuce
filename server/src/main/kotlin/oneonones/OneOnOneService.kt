package ch.nokillswit.oneonones

import ch.nokillswit.infra.crypto.FieldCipher
import ch.nokillswit.infra.db.containsPattern
import ch.nokillswit.infra.paging.PageRequest
import ch.nokillswit.infra.paging.applyPaging
import ch.nokillswit.notifications.Notification
import ch.nokillswit.teams.directSubordinateIds
import ch.nokillswit.teams.isInManagementChain
import ch.nokillswit.teams.transitiveSubordinateIds
import ch.nokillswit.users.UserService
import io.ktor.server.plugins.BadRequestException
import io.ktor.util.AttributeKey
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.singleOrNull
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.core.dao.id.UIntIdTable
import org.jetbrains.exposed.v1.r2dbc.*
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction

val OneOnOneServiceKey = AttributeKey<OneOnOneService>("OneOnOneService")

enum class OneOnOneListView { OWN, MANAGED, TEAM, WITH }

/** Storage discriminator for the shared points/decisions table. */
enum class NoteKind { POINT, DECISION }

data class OneOnOneListFilter(
    val managerName: String? = null,
    val subordinateName: String? = null,
    val meetingDateGte: String? = null,
    val meetingDateLte: String? = null,
)

data class OneOnOneListResult(
    val items: List<OneOnOneListItem>,
    val total: Long,
)

data class OneOnOneCreateResult(
    val id: UInt,
    val carriedOver: Int,
    val notifications: List<Notification>,
)

/** The latest directional 1:1 of a (manager, subordinate) pair — see [OneOnOneService.latestMeetingStats]. */
data class OneOnOneLatestStats(
    val meetingDate: String,
    val openActionItemCount: Int,
)

/** An action item's history plus the meeting the queried item belongs to (the authz anchor). */
data class ActionItemHistoryResult(
    val meetingId: UInt,
    val entries: List<ActionItemHistoryEntry>,
)

private val managerUsers = UserService.Users.alias("manager_users")
private val subordinateUsers = UserService.Users.alias("subordinate_users")

private val SORTABLE_COLUMNS: Map<String, Column<*>> = mapOf(
    "id" to OneOnOneService.Meetings.id,
    "meetingDate" to OneOnOneService.Meetings.meetingDate,
    "managerName" to managerUsers[UserService.Users.name],
    "subordinateName" to subordinateUsers[UserService.Users.name],
    "lastModified" to OneOnOneService.Meetings.lastModified,
)

// The note/action-item content columns are encrypted at rest (see infra/crypto/FieldCipher.kt):
// the cipher wraps every write and unwraps every read, so nothing above this service ever sees
// ciphertext. Neither column is filtered/sorted/searched in SQL (lists carry counts, not
// previews), so queries are unaffected — never add a SQL-level filter/sort on them.
class OneOnOneService(val database: R2dbcDatabase, private val cipher: FieldCipher) {
    object Meetings : UIntIdTable("one_on_one_meetings") {
        val managerId = reference("manager_id", UserService.Users)
        val subordinateId = reference("subordinate_id", UserService.Users)
        // ISO YYYY-MM-DD; lexicographic order == chronological, so SQL sort/range filters work.
        val meetingDate = varchar("meeting_date", 10)
        val lastModified = long("last_modified")
        val markedAsDeleted = bool("marked_as_deleted").default(false)
    }

    object Notes : UIntIdTable("one_on_one_notes") {
        val meetingId = reference("meeting_id", Meetings)
        val kind = enumerationByName("kind", 10, NoteKind::class)
        val position = integer("position")
        val content = text("content")
    }

    object ActionItems : UIntIdTable("one_on_one_action_items") {
        val meetingId = reference("meeting_id", Meetings)
        val position = integer("position")
        val content = text("content")
        val owner = enumerationByName("owner", 20, ActionItemOwner::class)
        val dueDate = varchar("due_date", 10).nullable()
        val resolved = bool("resolved").default(false)
        val copiedFromId = reference("copied_from_id", ActionItems).nullable()
    }

    private fun active(): Op<Boolean> = Meetings.markedAsDeleted eq false

    /** Whether [subordinateId] is currently a direct report of [managerId] (the create-time rule). */
    suspend fun isDirectReport(managerId: UInt, subordinateId: UInt): Boolean =
        suspendTransaction(database) { subordinateId in directSubordinateIds(managerId) }

    /** Whether [managerId] is anywhere in [subordinateId]'s transitive management chain (read rule). */
    suspend fun managesSubordinate(managerId: UInt, subordinateId: UInt): Boolean =
        suspendTransaction(database) { isInManagementChain(managerId, subordinateId) }

    /**
     * For each manager in [managerIds], the latest non-deleted 1:1 they ran with [subordinateId]
     * (directional: the manager is the meeting's manager) plus its unresolved action-item count.
     * Managers with no such meeting are absent from the map. Counts only — nothing is decrypted.
     */
    suspend fun latestMeetingStats(
        managerIds: Set<UInt>,
        subordinateId: UInt,
    ): Map<UInt, OneOnOneLatestStats> = suspendTransaction(database) {
        // One indexed limit-1 lookup per manager (the carry-over query shape in create()); the
        // set is the caller's managers — a handful — so no multi-group "latest per key" SQL.
        val latest = mutableMapOf<UInt, Pair<UInt, String>>()
        managerIds.forEach { managerId ->
            Meetings.select(Meetings.id, Meetings.meetingDate)
                .where {
                    (Meetings.managerId eq managerId) and
                        (Meetings.subordinateId eq subordinateId) and active()
                }
                .orderBy(Meetings.meetingDate to SortOrder.DESC, Meetings.id to SortOrder.DESC)
                .limit(1)
                .map { it[Meetings.id].value to it[Meetings.meetingDate] }
                .singleOrNull()
                ?.let { latest[managerId] = it }
        }
        val meetingIds = latest.values.map { it.first }
        val openCounts: Map<UInt, Int> = if (meetingIds.isEmpty()) emptyMap() else {
            val count = ActionItems.id.count()
            ActionItems.select(ActionItems.meetingId, count)
                .where { (ActionItems.meetingId inList meetingIds) and (ActionItems.resolved eq false) }
                .groupBy(ActionItems.meetingId)
                .map { it[ActionItems.meetingId].value to it[count].toInt() }
                .toList()
                .toMap()
        }
        latest.mapValues { (_, meeting) ->
            OneOnOneLatestStats(meeting.second, openCounts[meeting.first] ?: 0)
        }
    }

    /**
     * Inserts the meeting, copies the unresolved action items of the pair's previous meeting
     * (latest non-deleted one by meeting date, id as tiebreaker) ahead of any items supplied in
     * the request, and returns the id, the carried-over count, and the subordinate's creation
     * notification (the caller persists it).
     */
    suspend fun create(managerId: UInt, request: OneOnOneCreateRequest): OneOnOneCreateResult =
        suspendTransaction(database) {
            val meetingId = Meetings.insert {
                it[this.managerId] = managerId
                it[subordinateId] = request.subordinateId
                it[meetingDate] = request.meetingDate
                it[lastModified] = System.currentTimeMillis()
            }[Meetings.id].value

            val previousId = Meetings.select(Meetings.id)
                .where {
                    (Meetings.managerId eq managerId) and
                        (Meetings.subordinateId eq request.subordinateId) and
                        (Meetings.id neq meetingId) and active()
                }
                .orderBy(Meetings.meetingDate to SortOrder.DESC, Meetings.id to SortOrder.DESC)
                .limit(1)
                .map { it[Meetings.id].value }
                .singleOrNull()

            var carried = 0
            if (previousId != null) {
                val open = ActionItems.selectAll()
                    .where { (ActionItems.meetingId eq previousId) and (ActionItems.resolved eq false) }
                    .orderBy(ActionItems.position to SortOrder.ASC, ActionItems.id to SortOrder.ASC)
                    .toList()
                open.forEach { source ->
                    ActionItems.insert {
                        it[this.meetingId] = meetingId
                        it[position] = carried
                        // Re-encrypt through the normal write path (fresh nonce per copy).
                        it[content] = cipher.encrypt(cipher.decrypt(source[ActionItems.content]))
                        it[owner] = source[ActionItems.owner]
                        it[dueDate] = source[ActionItems.dueDate]
                        it[resolved] = false
                        it[copiedFromId] = source[ActionItems.id].value
                    }
                    carried++
                }
            }

            insertNotes(meetingId, NoteKind.POINT, request.points)
            insertNotes(meetingId, NoteKind.DECISION, request.decisions)
            request.actionItems.forEachIndexed { index, item ->
                ActionItems.insert {
                    it[this.meetingId] = meetingId
                    it[position] = carried + index
                    it[content] = cipher.encrypt(item.content)
                    it[owner] = item.owner
                    it[dueDate] = item.dueDate
                    it[resolved] = item.resolved
                }
            }

            val managerName = userName(managerId) ?: "#$managerId"
            OneOnOneCreateResult(
                id = meetingId,
                carriedOver = carried,
                notifications = oneOnOneCreationNotifications(
                    meetingId = meetingId,
                    subordinateId = request.subordinateId,
                    managerName = managerName,
                    meetingDate = request.meetingDate,
                ),
            )
        }

    /** The full meeting document (party names resolved, children in position order), or null. */
    suspend fun read(id: UInt): OneOnOneResponse? = suspendTransaction(database) {
        val row = Meetings
            .join(
                managerUsers,
                JoinType.INNER,
                onColumn = Meetings.managerId,
                otherColumn = managerUsers[UserService.Users.id],
            )
            .join(
                subordinateUsers,
                JoinType.INNER,
                onColumn = Meetings.subordinateId,
                otherColumn = subordinateUsers[UserService.Users.id],
            )
            .select(
                Meetings.id,
                Meetings.managerId,
                Meetings.subordinateId,
                Meetings.meetingDate,
                Meetings.lastModified,
                managerUsers[UserService.Users.name],
                subordinateUsers[UserService.Users.name],
            )
            .where { (Meetings.id eq id) and active() }
            .map { it }
            .singleOrNull()
            ?: return@suspendTransaction null

        val notes = Notes.selectAll()
            .where { Notes.meetingId eq id }
            .orderBy(Notes.position to SortOrder.ASC, Notes.id to SortOrder.ASC)
            .toList()
        val items = ActionItems.selectAll()
            .where { ActionItems.meetingId eq id }
            .orderBy(ActionItems.position to SortOrder.ASC, ActionItems.id to SortOrder.ASC)
            .toList()

        OneOnOneResponse(
            id = id,
            managerId = row[Meetings.managerId].value,
            managerName = row[managerUsers[UserService.Users.name]],
            subordinateId = row[Meetings.subordinateId].value,
            subordinateName = row[subordinateUsers[UserService.Users.name]],
            meetingDate = row[Meetings.meetingDate],
            lastModified = row[Meetings.lastModified],
            points = notes.filter { it[Notes.kind] == NoteKind.POINT }.map { it.toItemResponse() },
            decisions = notes.filter { it[Notes.kind] == NoteKind.DECISION }.map { it.toItemResponse() },
            actionItems = items.map { it.toActionItemResponse() },
        )
    }

    /**
     * Full-document replace: updates the meeting date, reconciles each list against the payload
     * (id present → update in place, id absent → insert, row missing → hard-delete), and rewrites
     * positions from payload order. Ids that don't belong to this meeting (or duplicates) → 400.
     * Returns the affected meeting count (0 → missing/deleted, mapped to 404 by the route).
     */
    suspend fun replace(id: UInt, request: OneOnOneUpdateRequest): Int = suspendTransaction(database) {
        val updated = Meetings.update({ (Meetings.id eq id) and (Meetings.markedAsDeleted eq false) }) {
            it[meetingDate] = request.meetingDate
            it[lastModified] = System.currentTimeMillis()
        }
        if (updated == 0) return@suspendTransaction 0
        replaceNotes(id, NoteKind.POINT, request.points)
        replaceNotes(id, NoteKind.DECISION, request.decisions)
        replaceActionItems(id, request.actionItems)
        1
    }

    suspend fun delete(id: UInt): Int = suspendTransaction(database) {
        Meetings.update({ (Meetings.id eq id) and (Meetings.markedAsDeleted eq false) }) {
            it[markedAsDeleted] = true
        }
    }

    suspend fun list(
        view: OneOnOneListView,
        callerUserId: UInt,
        filter: OneOnOneListFilter,
        paging: PageRequest,
        includeIndirect: Boolean = false,
        counterpartId: UInt? = null,
    ): OneOnOneListResult = suspendTransaction(database) {
        val scope: Op<Boolean> = when (view) {
            OneOnOneListView.OWN -> Meetings.subordinateId eq callerUserId
            OneOnOneListView.MANAGED -> Meetings.managerId eq callerUserId
            OneOnOneListView.WITH -> {
                // Every 1:1 between the caller and one counterpart, either role direction (the
                // pair may have switched manager/subordinate roles over time). The caller is a
                // party to every row, so this adds no new read surface. The route guarantees a
                // non-null counterpartId.
                val other = requireNotNull(counterpartId) { "view=with requires counterpartId" }
                ((Meetings.managerId eq callerUserId) and (Meetings.subordinateId eq other)) or
                    ((Meetings.managerId eq other) and (Meetings.subordinateId eq callerUserId))
            }
            OneOnOneListView.TEAM -> {
                // Meetings run BY the caller's subordinates as managers — direct reports by
                // default, the whole transitive chain with includeIndirect. A narrower slice of
                // the single-GET's transitive manager read right (the subordinate of such a
                // meeting is always in the caller's chain too) — not a separate authorization.
                val managerIds =
                    if (includeIndirect) transitiveSubordinateIds(callerUserId)
                    else directSubordinateIds(callerUserId)
                if (managerIds.isEmpty()) Op.FALSE else Meetings.managerId inList managerIds
            }
        }
        val predicate: Op<Boolean> = scope and buildPredicate(filter) and active()
        val join = Meetings
            .join(
                managerUsers,
                JoinType.INNER,
                onColumn = Meetings.managerId,
                otherColumn = managerUsers[UserService.Users.id],
            )
            .join(
                subordinateUsers,
                JoinType.INNER,
                onColumn = Meetings.subordinateId,
                otherColumn = subordinateUsers[UserService.Users.id],
            )
        val total = join.selectAll().where { predicate }.count()
        val rows = join
            .select(
                Meetings.id,
                Meetings.managerId,
                Meetings.subordinateId,
                Meetings.meetingDate,
                Meetings.lastModified,
                managerUsers[UserService.Users.name],
                managerUsers[UserService.Users.markedAsDeleted],
                subordinateUsers[UserService.Users.name],
                subordinateUsers[UserService.Users.markedAsDeleted],
            )
            .where { predicate }
            .applyPaging(paging, SORTABLE_COLUMNS)
            .map { it }
            .toList()

        // Child counts for the page's meetings only — grouped queries, no per-row subselects and
        // no decryption (lists never carry content).
        val meetingIds = rows.map { it[Meetings.id].value }
        val noteCounts: Map<Pair<UInt, NoteKind>, Int> = if (meetingIds.isEmpty()) emptyMap() else {
            val count = Notes.id.count()
            Notes.select(Notes.meetingId, Notes.kind, count)
                .where { Notes.meetingId inList meetingIds }
                .groupBy(Notes.meetingId, Notes.kind)
                .map { (it[Notes.meetingId].value to it[Notes.kind]) to it[count].toInt() }
                .toList()
                .toMap()
        }
        val actionItemCounts: Map<Pair<UInt, Boolean>, Int> = if (meetingIds.isEmpty()) emptyMap() else {
            val count = ActionItems.id.count()
            ActionItems.select(ActionItems.meetingId, ActionItems.resolved, count)
                .where { ActionItems.meetingId inList meetingIds }
                .groupBy(ActionItems.meetingId, ActionItems.resolved)
                .map { (it[ActionItems.meetingId].value to it[ActionItems.resolved]) to it[count].toInt() }
                .toList()
                .toMap()
        }

        val items = rows.map { row ->
            val meetingId = row[Meetings.id].value
            val open = actionItemCounts[meetingId to false] ?: 0
            val closed = actionItemCounts[meetingId to true] ?: 0
            OneOnOneListItem(
                id = meetingId,
                managerId = row[Meetings.managerId].value,
                managerName = row[managerUsers[UserService.Users.name]],
                managerDeleted = row[managerUsers[UserService.Users.markedAsDeleted]],
                subordinateId = row[Meetings.subordinateId].value,
                subordinateName = row[subordinateUsers[UserService.Users.name]],
                subordinateDeleted = row[subordinateUsers[UserService.Users.markedAsDeleted]],
                meetingDate = row[Meetings.meetingDate],
                lastModified = row[Meetings.lastModified],
                pointCount = noteCounts[meetingId to NoteKind.POINT] ?: 0,
                decisionCount = noteCounts[meetingId to NoteKind.DECISION] ?: 0,
                actionItemCount = open + closed,
                openActionItemCount = open,
            )
        }
        OneOnOneListResult(items = items, total = total)
    }

    /**
     * The full history of an action item: every appearance across the chain of carried-over
     * copies — ancestors via `copied_from_id`, descendants (including branches off ancestors) via
     * a frontier walk — ordered by meeting date. Entries whose meeting is soft-deleted are
     * skipped but walked *through*, so history survives a deleted intermediate meeting. Returns
     * null when the item is missing or its own meeting is soft-deleted (route → 404).
     */
    suspend fun actionItemHistory(itemId: UInt): ActionItemHistoryResult? = suspendTransaction(database) {
        val origin = ActionItems.selectAll()
            .where { ActionItems.id eq itemId }
            .map { it }
            .singleOrNull()
            ?: return@suspendTransaction null
        val originMeetingId = origin[ActionItems.meetingId].value

        // id → row, insertion-ordered for the cycle-safe walk (a well-formed chain has no cycles,
        // but the visited set makes malformed data terminate rather than loop).
        val collected = linkedMapOf(itemId to origin)

        var ancestorId = origin[ActionItems.copiedFromId]?.value
        while (ancestorId != null && ancestorId !in collected) {
            val row = ActionItems.selectAll()
                .where { ActionItems.id eq ancestorId!! }
                .map { it }
                .singleOrNull()
                ?: break
            collected[ancestorId!!] = row
            ancestorId = row[ActionItems.copiedFromId]?.value
        }

        var frontier = collected.keys.toSet()
        while (frontier.isNotEmpty()) {
            val children = ActionItems.selectAll()
                .where { ActionItems.copiedFromId inList frontier }
                .toList()
            val fresh = children.filter { it[ActionItems.id].value !in collected }
            fresh.forEach { collected[it[ActionItems.id].value] = it }
            frontier = fresh.map { it[ActionItems.id].value }.toSet()
        }

        val meetingIds = collected.values.map { it[ActionItems.meetingId].value }.toSet()
        val meetings = Meetings
            .select(Meetings.id, Meetings.meetingDate, Meetings.markedAsDeleted)
            .where { Meetings.id inList meetingIds }
            .map { it[Meetings.id].value to (it[Meetings.meetingDate] to it[Meetings.markedAsDeleted]) }
            .toList()
            .toMap()

        if (meetings[originMeetingId]?.second != false) return@suspendTransaction null

        val entries = collected.values
            .mapNotNull { row ->
                val meetingId = row[ActionItems.meetingId].value
                val (meetingDate, meetingDeleted) = meetings[meetingId] ?: return@mapNotNull null
                if (meetingDeleted) return@mapNotNull null
                ActionItemHistoryEntry(
                    actionItemId = row[ActionItems.id].value,
                    meetingId = meetingId,
                    meetingDate = meetingDate,
                    content = cipher.decrypt(row[ActionItems.content]),
                    owner = row[ActionItems.owner],
                    dueDate = row[ActionItems.dueDate],
                    resolved = row[ActionItems.resolved],
                )
            }
            .sortedWith(compareBy({ it.meetingDate }, { it.meetingId }))
        ActionItemHistoryResult(meetingId = originMeetingId, entries = entries)
    }

    /**
     * Startup backfill mirroring FeedbackService.encryptLegacyRows: encrypts any rows still
     * holding plaintext, and with [reencryptAll] (set while a rotation previousKey is configured)
     * rewrites every note/action-item content under the current key. Idempotent; returns the
     * rewritten count. New rows are always written encrypted, so the legacy branch is defensive.
     */
    suspend fun encryptLegacyRows(reencryptAll: Boolean = false): Int = suspendTransaction(database) {
        val enveloped = "${FieldCipher.PREFIX}%"
        val noteRows = Notes.select(Notes.id, Notes.content)
            .where { if (reencryptAll) Op.TRUE else Notes.content notLike enveloped }
            .toList()
        noteRows.forEach { row ->
            Notes.update({ Notes.id eq row[Notes.id] }) {
                it[content] = cipher.encrypt(cipher.decrypt(row[Notes.content]))
            }
        }
        val itemRows = ActionItems.select(ActionItems.id, ActionItems.content)
            .where { if (reencryptAll) Op.TRUE else ActionItems.content notLike enveloped }
            .toList()
        itemRows.forEach { row ->
            ActionItems.update({ ActionItems.id eq row[ActionItems.id] }) {
                it[content] = cipher.encrypt(cipher.decrypt(row[ActionItems.content]))
            }
        }
        noteRows.size + itemRows.size
    }

    private fun ResultRow.toItemResponse() = OneOnOneItemResponse(
        id = this[Notes.id].value,
        content = cipher.decrypt(this[Notes.content]),
    )

    private fun ResultRow.toActionItemResponse() = OneOnOneActionItemResponse(
        id = this[ActionItems.id].value,
        content = cipher.decrypt(this[ActionItems.content]),
        owner = this[ActionItems.owner],
        dueDate = this[ActionItems.dueDate],
        resolved = this[ActionItems.resolved],
        copiedFromId = this[ActionItems.copiedFromId]?.value,
    )

    private suspend fun insertNotes(meetingId: UInt, kind: NoteKind, items: List<OneOnOneItemInput>) {
        items.forEachIndexed { index, item ->
            Notes.insert {
                it[this.meetingId] = meetingId
                it[this.kind] = kind
                it[position] = index
                it[content] = cipher.encrypt(item.content)
            }
        }
    }

    private suspend fun replaceNotes(meetingId: UInt, kind: NoteKind, items: List<OneOnOneItemInput>) {
        val existingIds = Notes.select(Notes.id)
            .where { (Notes.meetingId eq meetingId) and (Notes.kind eq kind) }
            .map { it[Notes.id].value }
            .toList()
            .toSet()
        requirePayloadIds(items.mapNotNull { it.id }, existingIds)
        val toDelete = existingIds - items.mapNotNull { it.id }.toSet()
        if (toDelete.isNotEmpty()) Notes.deleteWhere { Notes.id inList toDelete }
        items.forEachIndexed { index, item ->
            if (item.id != null) {
                Notes.update({ Notes.id eq item.id }) {
                    it[position] = index
                    it[content] = cipher.encrypt(item.content)
                }
            } else {
                Notes.insert {
                    it[this.meetingId] = meetingId
                    it[this.kind] = kind
                    it[position] = index
                    it[content] = cipher.encrypt(item.content)
                }
            }
        }
    }

    private suspend fun replaceActionItems(meetingId: UInt, items: List<OneOnOneActionItemInput>) {
        val existingIds = ActionItems.select(ActionItems.id)
            .where { ActionItems.meetingId eq meetingId }
            .map { it[ActionItems.id].value }
            .toList()
            .toSet()
        requirePayloadIds(items.mapNotNull { it.id }, existingIds)
        val toDelete = existingIds - items.mapNotNull { it.id }.toSet()
        if (toDelete.isNotEmpty()) ActionItems.deleteWhere { ActionItems.id inList toDelete }
        items.forEachIndexed { index, item ->
            if (item.id != null) {
                // copiedFromId is deliberately untouched: the carry-over link is server-managed.
                ActionItems.update({ ActionItems.id eq item.id }) {
                    it[position] = index
                    it[content] = cipher.encrypt(item.content)
                    it[owner] = item.owner
                    it[dueDate] = item.dueDate
                    it[resolved] = item.resolved
                }
            } else {
                ActionItems.insert {
                    it[this.meetingId] = meetingId
                    it[position] = index
                    it[content] = cipher.encrypt(item.content)
                    it[owner] = item.owner
                    it[dueDate] = item.dueDate
                    it[resolved] = item.resolved
                }
            }
        }
    }

    private fun requirePayloadIds(payloadIds: List<UInt>, existingIds: Set<UInt>) {
        if (payloadIds.size != payloadIds.toSet().size) {
            throw BadRequestException("Duplicate item id in payload")
        }
        val foreign = payloadIds.filterNot { it in existingIds }
        if (foreign.isNotEmpty()) {
            throw BadRequestException("Unknown item id(s) for this meeting: ${foreign.joinToString()}")
        }
    }

    private suspend fun userName(id: UInt): String? =
        UserService.Users.select(UserService.Users.name)
            .where { UserService.Users.id eq id }
            .map { it[UserService.Users.name] }
            .singleOrNull()

    private fun buildPredicate(filter: OneOnOneListFilter): Op<Boolean> {
        var op: Op<Boolean> = Op.TRUE
        filter.managerName?.takeIf { it.isNotBlank() }?.let {
            op = op and (managerUsers[UserService.Users.name].lowerCase() like containsPattern(it))
        }
        filter.subordinateName?.takeIf { it.isNotBlank() }?.let {
            op = op and (subordinateUsers[UserService.Users.name].lowerCase() like containsPattern(it))
        }
        filter.meetingDateGte?.let { op = op and (Meetings.meetingDate greaterEq it) }
        filter.meetingDateLte?.let { op = op and (Meetings.meetingDate lessEq it) }
        return op
    }
}
