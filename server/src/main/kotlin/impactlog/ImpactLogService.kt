package ch.nokillswit.impactlog

import ch.nokillswit.infra.crypto.EncryptedAtRest
import ch.nokillswit.infra.crypto.FieldCipher
import ch.nokillswit.infra.crypto.reencryptRows
import ch.nokillswit.infra.db.containsNormalized
import ch.nokillswit.infra.paging.PageRequest
import ch.nokillswit.infra.paging.applyPaging
import ch.nokillswit.notifications.Notification
import ch.nokillswit.teams.directManagerIds
import ch.nokillswit.teams.directSubordinateIds
import ch.nokillswit.teams.isInManagementChain
import ch.nokillswit.teams.transitiveSubordinateIds
import ch.nokillswit.users.UserService
import ch.nokillswit.users.userNameOf
import io.ktor.util.AttributeKey
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.core.dao.id.UIntIdTable
import org.jetbrains.exposed.v1.r2dbc.*
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction

val ImpactLogServiceKey = AttributeKey<ImpactLogService>("ImpactLogService")

enum class ImpactLogListView { OWN, MANAGED, USER }

data class ImpactLogListFilter(
    val userName: String? = null,
    val title: String? = null,
)

data class ImpactLogListResult(
    val items: List<ImpactEntryListItem>,
    val total: Long,
)

data class ImpactEntryCreateResult(
    val id: UInt,
    val notifications: List<Notification>,
)

private val SORTABLE_COLUMNS: Map<String, Column<*>> = mapOf(
    "id" to ImpactLogService.Entries.id,
    "userName" to UserService.Users.name,
    "title" to ImpactLogService.Entries.title,
    // ISO YYYY-MM-DD in a VARCHAR: lexicographic == chronological, so a plain column sort works.
    "periodStart" to ImpactLogService.Entries.periodStart,
    "periodEnd" to ImpactLogService.Entries.periodEnd,
    "createdAt" to ImpactLogService.Entries.createdAt,
    "lastModified" to ImpactLogService.Entries.lastModified,
)

// The four section columns are encrypted at rest (see infra/crypto/FieldCipher.kt): the cipher
// wraps every write and unwraps every read, so nothing above this service ever sees ciphertext.
// None of them is filtered/sorted/searched in SQL, and section texts never ride list rows; the
// title (V66) and the period dates stay plaintext on purpose — lists sort/filter on them.
class ImpactLogService(val database: R2dbcDatabase, private val cipher: FieldCipher) : EncryptedAtRest {
    override val encryptedRowLabel = "impact log entry"

    object Entries : UIntIdTable("impact_log_entries") {
        val userId = reference("user_id", UserService.Users)
        // Plaintext on purpose (V66) — lists sort/substring-filter on it (the goals.title rule).
        val title = varchar("title", MAX_IMPACT_TITLE_LENGTH)
        val periodStart = varchar("period_start", 10)
        val periodEnd = varchar("period_end", 10)
        val whatHappened = text("what_happened")
        val contribution = text("contribution")
        val whyItMattered = text("why_it_mattered")
        val evidence = text("evidence")
        val createdAt = long("created_at")
        val lastModified = long("last_modified")
        val markedAsDeleted = bool("marked_as_deleted").default(false)
    }

    private fun active(): Op<Boolean> = Entries.markedAsDeleted eq false

    /**
     * Inserts a new entry for [ownerId] (always the caller — a journal has one author) and
     * returns its id together with the direct managers' notifications (the caller persists
     * them, mirroring the feedback create). The payload was validated by the route.
     */
    suspend fun create(ownerId: UInt, request: ImpactEntryRequest): ImpactEntryCreateResult =
        suspendTransaction(database) {
            val now = System.currentTimeMillis()
            val id = Entries.insert {
                it[userId] = ownerId
                it[title] = request.title
                it[periodStart] = request.periodStart
                it[periodEnd] = request.periodEnd
                it[whatHappened] = cipher.encrypt(request.whatHappened)
                it[contribution] = cipher.encrypt(request.contribution)
                it[whyItMattered] = cipher.encrypt(request.whyItMattered)
                it[evidence] = cipher.encrypt(request.evidence)
                it[createdAt] = now
                it[lastModified] = now
            }[Entries.id].value
            ImpactEntryCreateResult(
                id = id,
                notifications = impactEntryCreatedNotifications(
                    entryId = id,
                    managerIds = directManagerIds(ownerId),
                    authorName = userName(ownerId),
                    periodStart = request.periodStart,
                    periodEnd = request.periodEnd,
                ),
            )
        }

    suspend fun read(id: UInt): ImpactEntryResponse? = suspendTransaction(database) {
        (Entries innerJoin UserService.Users)
            .selectAll()
            .where { (Entries.id eq id) and active() }
            .map { it.toResponse() }
            .toList()
            .singleOrNull()
    }

    /**
     * Replaces an entry's whole document (the payload was validated by the route; the owner-only
     * guard ran there too). Returns the direct managers' notifications to persist — null when
     * the row is missing/deleted (→ 404), empty when nothing actually changed (a no-op PUT
     * notifies nobody, mirroring the no-empty-events rule).
     */
    suspend fun update(id: UInt, request: ImpactEntryRequest): List<Notification>? =
        suspendTransaction(database) {
            val current = (Entries innerJoin UserService.Users)
                .selectAll()
                .where { (Entries.id eq id) and active() }
                .map { it.toResponse() }
                .toList()
                .singleOrNull()
                ?: return@suspendTransaction null
            val changed = current.title != request.title ||
                current.periodStart != request.periodStart ||
                current.periodEnd != request.periodEnd ||
                current.whatHappened != request.whatHappened ||
                current.contribution != request.contribution ||
                current.whyItMattered != request.whyItMattered ||
                current.evidence != request.evidence
            if (!changed) return@suspendTransaction emptyList()
            Entries.update({ (Entries.id eq id) and (Entries.markedAsDeleted eq false) }) {
                it[title] = request.title
                it[periodStart] = request.periodStart
                it[periodEnd] = request.periodEnd
                it[whatHappened] = cipher.encrypt(request.whatHappened)
                it[contribution] = cipher.encrypt(request.contribution)
                it[whyItMattered] = cipher.encrypt(request.whyItMattered)
                it[evidence] = cipher.encrypt(request.evidence)
                it[lastModified] = System.currentTimeMillis()
            }
            impactEntryUpdatedNotifications(
                entryId = id,
                managerIds = directManagerIds(current.userId),
                authorName = current.userName,
                periodStart = request.periodStart,
                periodEnd = request.periodEnd,
            )
        }

    /**
     * Soft-deletes an entry and returns the direct managers' notifications to persist — null
     * when the row is already missing/deleted (→ 404). The period rides the notification (the
     * deleted document itself is gone from every read).
     */
    suspend fun delete(id: UInt): List<Notification>? = suspendTransaction(database) {
        val current = (Entries innerJoin UserService.Users)
            .selectAll()
            .where { (Entries.id eq id) and active() }
            .map { it.toResponse() }
            .toList()
            .singleOrNull()
            ?: return@suspendTransaction null
        Entries.update({ (Entries.id eq id) and (Entries.markedAsDeleted eq false) }) {
            it[markedAsDeleted] = true
        }
        impactEntryDeletedNotifications(
            managerIds = directManagerIds(current.userId),
            authorName = current.userName,
            periodStart = current.periodStart,
            periodEnd = current.periodEnd,
        )
    }

    suspend fun list(
        view: ImpactLogListView,
        callerUserId: UInt,
        filter: ImpactLogListFilter,
        paging: PageRequest,
        includeIndirect: Boolean = false,
        targetUserId: UInt? = null,
    ): ImpactLogListResult = suspendTransaction(database) {
        val scope: Op<Boolean> = when (view) {
            ImpactLogListView.OWN -> Entries.userId eq callerUserId
            ImpactLogListView.MANAGED -> {
                // The caller's reports' journals — direct by default, the transitive chain with
                // includeIndirect (the days-off managed shape). Every listed row is openable:
                // the single-GET grants any chain manager the read.
                val reports =
                    if (includeIndirect) transitiveSubordinateIds(callerUserId)
                    else directSubordinateIds(callerUserId)
                if (reports.isEmpty()) Op.FALSE else Entries.userId inList reports
            }
            ImpactLogListView.USER -> {
                // Auditor view (HR-only, gated route-side via requireAuditListAccess): the
                // target's whole journal. The route guarantees a non-null userId.
                val target = requireNotNull(targetUserId) { "view=user requires userId" }
                Entries.userId eq target
            }
        }
        val predicate: Op<Boolean> = scope and buildPredicate(filter) and active()
        val join = Entries innerJoin UserService.Users
        val total = join.selectAll().where { predicate }.count()
        val items = join
            .select(
                Entries.id,
                Entries.userId,
                Entries.title,
                Entries.periodStart,
                Entries.periodEnd,
                Entries.createdAt,
                Entries.lastModified,
                UserService.Users.name,
                UserService.Users.markedAsDeleted,
            )
            .where { predicate }
            .applyPaging(paging, SORTABLE_COLUMNS)
            .map { row ->
                ImpactEntryListItem(
                    id = row[Entries.id].value,
                    userId = row[Entries.userId].value,
                    userName = row[UserService.Users.name],
                    userDeleted = row[UserService.Users.markedAsDeleted],
                    title = row[Entries.title],
                    periodStart = row[Entries.periodStart],
                    periodEnd = row[Entries.periodEnd],
                    createdAt = row[Entries.createdAt],
                    lastModified = row[Entries.lastModified],
                )
            }
            .toList()
        ImpactLogListResult(items = items, total = total)
    }

    /**
     * True iff [managerId] is in [ownerId]'s transitive management chain. Backs
     * [ch.nokillswit.authz.requireImpactEntryRead]'s lazy chain check; the walk itself lives in
     * teams/ManagementChain.kt and is shared with the other chain-read features.
     */
    suspend fun managesOwner(managerId: UInt, ownerId: UInt): Boolean =
        suspendTransaction(database) { isInManagementChain(managerId, ownerId) }

    /**
     * Startup backfill (see infra/db/Bootstrap.kt): encrypts rows still holding legacy plaintext
     * — including soft-deleted ones. With [reencryptAll] (set during key rotation) every row is
     * rewritten under the current key. Idempotent; returns the rewritten count.
     */
    override suspend fun encryptLegacyRows(reencryptAll: Boolean): Int = suspendTransaction(database) {
        cipher.reencryptRows(
            Entries,
            listOf(Entries.whatHappened, Entries.contribution, Entries.whyItMattered, Entries.evidence),
            reencryptAll,
        )
    }

    private fun ResultRow.toResponse(): ImpactEntryResponse = ImpactEntryResponse(
        id = this[Entries.id].value,
        userId = this[Entries.userId].value,
        userName = this[UserService.Users.name],
        title = this[Entries.title],
        periodStart = this[Entries.periodStart],
        periodEnd = this[Entries.periodEnd],
        whatHappened = cipher.decrypt(this[Entries.whatHappened]),
        contribution = cipher.decrypt(this[Entries.contribution]),
        whyItMattered = cipher.decrypt(this[Entries.whyItMattered]),
        evidence = cipher.decrypt(this[Entries.evidence]),
        createdAt = this[Entries.createdAt],
        lastModified = this[Entries.lastModified],
    )

    private suspend fun userName(id: UInt): String = userNameOf(id) ?: "#$id"

    private fun buildPredicate(filter: ImpactLogListFilter): Op<Boolean> {
        var op: Op<Boolean> = Op.TRUE
        filter.userName?.takeIf { it.isNotBlank() }?.let {
            op = op and (UserService.Users.name.containsNormalized(it))
        }
        filter.title?.takeIf { it.isNotBlank() }?.let {
            op = op and (Entries.title.containsNormalized(it))
        }
        return op
    }
}
