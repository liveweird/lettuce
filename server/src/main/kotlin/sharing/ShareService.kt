package ch.nokillswit.sharing

import ch.nokillswit.infra.db.decodeParams
import ch.nokillswit.infra.db.encodeParams
import ch.nokillswit.infra.paging.PageRequest
import ch.nokillswit.infra.paging.applyPaging
import ch.nokillswit.users.Feature
import ch.nokillswit.users.UserService
import java.time.LocalDate
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.core.dao.id.UIntIdTable
import org.jetbrains.exposed.v1.r2dbc.*
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction

/** A share row with both parties' (and the withdrawer's) names resolved — what the routes enrich. */
data class ShareRecord(
    val id: UInt,
    val resourceType: ShareableResourceType,
    val resourceId: UInt,
    val sharerId: UInt,
    val sharerName: String,
    val shareeId: UInt,
    val shareeName: String,
    val expiresOn: String?,
    val createdAt: Long,
    val status: ShareStatus,
    val withdrawnAt: Long?,
    val withdrawnById: UInt?,
    val withdrawnByName: String?,
    /** The creation-time label snapshot; null = none stored. */
    val details: Map<String, String>?,
)

/** The list's scope. [userId] is the caller; [view] decides which column pins it. */
data class ShareListFilter(
    val view: ShareListView,
    val userId: UInt,
    val resourceType: ShareableResourceType? = null,
    /** Required with [ShareListView.DOCUMENT], rejected elsewhere (the route validates the shape). */
    val resourceId: UInt? = null,
    val status: ShareStatus? = null,
    /** The caller's disabled features: `withMe` hides types of those areas, in SQL, so `total` stays honest. */
    val disabledFeatures: Set<Feature> = emptySet(),
    /** `document` view only: null = every row (the author), an id = only that sharer's rows. */
    val documentSharerScope: UInt? = null,
)

data class ShareListResult(val items: List<ShareRecord>, val total: Long)

sealed interface ShareCreateOutcome {
    data class Created(val id: UInt) : ShareCreateOutcome

    /** An ACTIVE share of the same document by the same sharer to the same sharee exists. */
    data class Duplicate(val existingId: UInt) : ShareCreateOutcome
}

sealed interface ShareWithdrawOutcome {
    /** [wasActive] false = the share had already expired (the route then mints no notification). */
    data class Withdrawn(val record: ShareRecord, val wasActive: Boolean) : ShareWithdrawOutcome

    data object NotFound : ShareWithdrawOutcome

    data object AlreadyWithdrawn : ShareWithdrawOutcome
}

private val sharerUsers = UserService.Users.alias("sharer_users")
private val shareeUsers = UserService.Users.alias("sharee_users")
private val withdrawerUsers = UserService.Users.alias("withdrawer_users")

/** The first key of the two-key advisory lock — a namespace, so it cannot collide with
 *  `MfaChallenges`' one-key lock on a bare user id (the key spaces are disjoint by arity). */
private const val SHARE_LOCK_NAMESPACE = 86

/**
 * Document shares (v4.8.0, V86): who shared which document with whom, until when. Status is
 * DERIVED, never stored — WITHDRAWN (`withdrawn_at` set, terminal), EXPIRED (`expires_on` before
 * today, silent — no sweep, no notification), else ACTIVE; `expires_on` is inclusive through its
 * day. "Today" comes through the injectable [today] seam (the `validateGoalDueDate` pattern), so
 * the expiry boundary is testable without sleeping.
 *
 * Rows are never deleted (the terminal-stamp exception to the soft-delete convention, the
 * `integration_clients.revoked_at` precedent): a withdrawn or expired share simply stops
 * granting, and a re-share is a NEW row. The routes compose this with the feature adapters
 * ([ShareableResource]) — this service knows nothing about the documents themselves.
 */
class ShareService(
    val database: R2dbcDatabase,
    private val clock: () -> LocalDate = { LocalDate.now() },
) {
    /** The ONE clock for everything date-sensitive about shares — status derivation, the active
     *  predicates AND the create-time expiry validation (so the route and the store agree). */
    fun today(): LocalDate = clock()

    object DocumentShares : UIntIdTable("document_shares") {
        val resourceType = varchar("resource_type", length = 30)
        val resourceId = uinteger("resource_id")
        val sharerId = reference("sharer_id", UserService.Users)
        val shareeId = reference("sharee_id", UserService.Users)
        val expiresOn = varchar("expires_on", length = 10).nullable()
        val createdAt = long("created_at")
        val withdrawnAt = long("withdrawn_at").nullable()
        val withdrawnBy = reference("withdrawn_by", UserService.Users).nullable()
        val details = text("details").nullable()
    }

    /**
     * A row whose stored type this build no longer knows is INVISIBLE, never fatal (the open-set
     * rule, `NotificationService.knownType`): the column holds the enum's NAME and rows outlive
     * the release that wrote them. Applied in SQL so `total` and the rows agree.
     */
    private fun knownType(): Op<Boolean> =
        DocumentShares.resourceType inList ShareableResourceType.entries.map { it.name }

    private fun activeOp(todayIso: String): Op<Boolean> =
        DocumentShares.withdrawnAt.isNull() and
            (DocumentShares.expiresOn.isNull() or (DocumentShares.expiresOn greaterEq todayIso))

    private fun statusOp(status: ShareStatus, todayIso: String): Op<Boolean> = when (status) {
        ShareStatus.WITHDRAWN -> DocumentShares.withdrawnAt.isNotNull()
        ShareStatus.EXPIRED -> DocumentShares.withdrawnAt.isNull() and
            DocumentShares.expiresOn.isNotNull() and (DocumentShares.expiresOn less todayIso)
        ShareStatus.ACTIVE -> activeOp(todayIso)
    }

    /**
     * Inserts a share unless an ACTIVE one of the same (document, sharer, sharee) already exists.
     * "Active" depends on today's date, so no unique index can express the rule — the pre-check
     * runs inside this transaction behind `pg_advisory_xact_lock(<namespace>, sharerId)` (the
     * two-key form, per sharer: concurrent creates by different sharers never wait on each other,
     * and the key space is disjoint from `MfaChallenges`' one-key lock), so a concurrent burst of
     * identical requests yields exactly one [ShareCreateOutcome.Created]. Expired and withdrawn
     * rows never block a fresh share.
     */
    suspend fun create(
        type: ShareableResourceType,
        resourceId: UInt,
        sharerId: UInt,
        shareeId: UInt,
        expiresOn: String?,
        details: Map<String, String>? = null,
    ): ShareCreateOutcome {
        val todayIso = today().toString()
        return suspendTransaction(database) {
            exec(
                "SELECT pg_advisory_xact_lock(?, ?)",
                listOf(IntegerColumnType() to SHARE_LOCK_NAMESPACE, IntegerColumnType() to sharerId.toInt()),
            )
            val existing = DocumentShares.select(DocumentShares.id)
                .where {
                    (DocumentShares.resourceType eq type.name) and
                        (DocumentShares.resourceId eq resourceId) and
                        (DocumentShares.sharerId eq sharerId) and
                        (DocumentShares.shareeId eq shareeId) and
                        activeOp(todayIso)
                }
                .map { it[DocumentShares.id].value }
                .toList()
                .firstOrNull()
            if (existing != null) return@suspendTransaction ShareCreateOutcome.Duplicate(existing)
            val id = DocumentShares.insert {
                it[DocumentShares.resourceType] = type.name
                it[DocumentShares.resourceId] = resourceId
                it[DocumentShares.sharerId] = sharerId
                it[DocumentShares.shareeId] = shareeId
                it[DocumentShares.expiresOn] = expiresOn
                it[DocumentShares.createdAt] = System.currentTimeMillis()
                it[DocumentShares.details] = details?.let(::encodeParams)
            }[DocumentShares.id].value
            ShareCreateOutcome.Created(id)
        }
    }

    suspend fun read(id: UInt): ShareRecord? {
        val todayIso = today().toString()
        return suspendTransaction(database) { readInTransaction(id, todayIso) }
    }

    private suspend fun readInTransaction(id: UInt, todayIso: String): ShareRecord? =
        joined().selectAll()
            .where { (DocumentShares.id eq id) and knownType() }
            .map { it.toRecord(todayIso) }
            .toList()
            .singleOrNull()

    /**
     * Stamps the share withdrawn by [byUserId] — terminal, conditional on it not being withdrawn
     * yet so two concurrent withdrawals lose cleanly ([ShareWithdrawOutcome.AlreadyWithdrawn] →
     * 409, the `IntegrationClientService.revoke` shape). An already-EXPIRED share is stamped
     * too (so it reads WITHDRAWN thereafter) but reports `wasActive = false`.
     */
    suspend fun withdraw(id: UInt, byUserId: UInt): ShareWithdrawOutcome {
        val todayIso = today().toString()
        return suspendTransaction(database) {
            val before = readInTransaction(id, todayIso) ?: return@suspendTransaction ShareWithdrawOutcome.NotFound
            if (before.status == ShareStatus.WITHDRAWN) return@suspendTransaction ShareWithdrawOutcome.AlreadyWithdrawn
            val updated = DocumentShares.update({ (DocumentShares.id eq id) and DocumentShares.withdrawnAt.isNull() }) {
                it[withdrawnAt] = System.currentTimeMillis()
                it[withdrawnBy] = byUserId
            }
            if (updated == 0) return@suspendTransaction ShareWithdrawOutcome.AlreadyWithdrawn
            val after = checkNotNull(readInTransaction(id, todayIso)) { "just-withdrawn share $id must exist" }
            ShareWithdrawOutcome.Withdrawn(after, wasActive = before.status == ShareStatus.ACTIVE)
        }
    }

    /**
     * The sharers whose ACTIVE (non-withdrawn, unexpired) share of this document [shareeId]
     * holds, oldest share first — what [ShareAccess] re-evaluates at every read.
     */
    suspend fun activeSharersFor(type: ShareableResourceType, resourceId: UInt, shareeId: UInt): List<UInt> {
        val todayIso = today().toString()
        return suspendTransaction(database) {
            DocumentShares.select(DocumentShares.sharerId)
                .where {
                    (DocumentShares.resourceType eq type.name) and
                        (DocumentShares.resourceId eq resourceId) and
                        (DocumentShares.shareeId eq shareeId) and
                        activeOp(todayIso)
                }
                .orderBy(DocumentShares.id to SortOrder.ASC)
                .map { it[DocumentShares.sharerId].value }
                .toList()
                .distinct()
        }
    }

    suspend fun list(filter: ShareListFilter, paging: PageRequest): ShareListResult {
        val todayIso = today().toString()
        return suspendTransaction(database) {
            val predicate = buildPredicate(filter, todayIso)
            val total = DocumentShares.selectAll().where { predicate }.count()
            val items = joined().selectAll()
                .where { predicate }
                .applyPaging(paging, SORTABLE_COLUMNS)
                .map { it.toRecord(todayIso) }
                .toList()
            ShareListResult(items, total)
        }
    }

    private fun buildPredicate(filter: ShareListFilter, todayIso: String): Op<Boolean> {
        var op: Op<Boolean> = knownType()
        op = op and when (filter.view) {
            ShareListView.WITH_ME -> {
                // `withMe` never shows WITHDRAWN rows, nor the types of areas the caller has
                // disabled (the notifications-list exclusion precedent) — both in SQL.
                val hidden = ShareableResourceType.entries.filter { it.feature in filter.disabledFeatures }.map { it.name }
                var scoped: Op<Boolean> = (DocumentShares.shareeId eq filter.userId) and DocumentShares.withdrawnAt.isNull()
                if (hidden.isNotEmpty()) scoped = scoped and (DocumentShares.resourceType notInList hidden)
                scoped
            }
            ShareListView.BY_ME -> DocumentShares.sharerId eq filter.userId
            ShareListView.DOCUMENT -> {
                var scoped: Op<Boolean> = Op.TRUE
                filter.documentSharerScope?.let { scoped = scoped and (DocumentShares.sharerId eq it) }
                scoped
            }
        }
        filter.resourceType?.let { op = op and (DocumentShares.resourceType eq it.name) }
        filter.resourceId?.let { op = op and (DocumentShares.resourceId eq it) }
        filter.status?.let { op = op and statusOp(it, todayIso) }
        return op
    }

    private fun joined() = DocumentShares
        .join(sharerUsers, JoinType.INNER, onColumn = DocumentShares.sharerId, otherColumn = sharerUsers[UserService.Users.id])
        .join(shareeUsers, JoinType.INNER, onColumn = DocumentShares.shareeId, otherColumn = shareeUsers[UserService.Users.id])
        .join(
            withdrawerUsers,
            JoinType.LEFT,
            onColumn = DocumentShares.withdrawnBy,
            otherColumn = withdrawerUsers[UserService.Users.id],
        )

    private fun ResultRow.toRecord(todayIso: String): ShareRecord {
        val withdrawnAt = this[DocumentShares.withdrawnAt]
        val expiresOn = this[DocumentShares.expiresOn]
        return ShareRecord(
            id = this[DocumentShares.id].value,
            resourceType = ShareableResourceType.valueOf(this[DocumentShares.resourceType]),
            resourceId = this[DocumentShares.resourceId],
            sharerId = this[DocumentShares.sharerId].value,
            sharerName = this[sharerUsers[UserService.Users.name]],
            shareeId = this[DocumentShares.shareeId].value,
            shareeName = this[shareeUsers[UserService.Users.name]],
            expiresOn = expiresOn,
            createdAt = this[DocumentShares.createdAt],
            status = when {
                withdrawnAt != null -> ShareStatus.WITHDRAWN
                expiresOn != null && expiresOn < todayIso -> ShareStatus.EXPIRED
                else -> ShareStatus.ACTIVE
            },
            withdrawnAt = withdrawnAt,
            withdrawnById = this[DocumentShares.withdrawnBy]?.value,
            withdrawnByName = this[withdrawerUsers[UserService.Users.name]],
            details = this[DocumentShares.details]?.let(::decodeParams),
        )
    }
}

private val SORTABLE_COLUMNS: Map<String, Column<*>> = mapOf(
    "id" to ShareService.DocumentShares.id,
    "createdAt" to ShareService.DocumentShares.createdAt,
    "expiresOn" to ShareService.DocumentShares.expiresOn,
)
