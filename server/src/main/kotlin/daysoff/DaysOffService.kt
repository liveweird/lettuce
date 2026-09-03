package ch.nokillswit.daysoff

import ch.nokillswit.infra.crypto.EncryptedAtRest
import ch.nokillswit.infra.crypto.reencryptRows
import ch.nokillswit.authz.ConflictException
import ch.nokillswit.infra.db.containsNormalized
import ch.nokillswit.infra.paging.PageRequest
import ch.nokillswit.infra.paging.applyPaging
import ch.nokillswit.notifications.Notification
import ch.nokillswit.teams.directManagerIds
import ch.nokillswit.teams.directSubordinateIds
import ch.nokillswit.teams.isInManagementChain
import ch.nokillswit.teams.transitiveSubordinateIds
import ch.nokillswit.teams.memberTeamIds
import ch.nokillswit.teams.membersOf
import ch.nokillswit.users.UserService
import ch.nokillswit.users.userNameOf
import io.ktor.server.plugins.BadRequestException
import io.ktor.util.AttributeKey
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.singleOrNull
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.r2dbc.*
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import java.time.LocalDate
import java.time.YearMonth

val DaysOffServiceKey = AttributeKey<DaysOffService>("DaysOffService")

enum class DaysOffListView { OWN, MANAGED, USER }

enum class DaysOffCalendarScope { MEMBER, MANAGED }

data class DaysOffListFilter(
    val userName: String? = null,
    val userId: UInt? = null,
    val type: DaysOffType? = null,
    // The paid pool kind (v3.2.0) — an equality filter; composes with type=PAID trivially.
    val poolTypeId: UInt? = null,
    val status: DaysOffStatus? = null,
    val startDateGte: String? = null,
    val startDateLte: String? = null,
)

data class DaysOffListResult(
    val items: List<DaysOffListItem>,
    val total: Long,
)

/** The integration API's full-document page (v3.0.0) — see [DaysOffService.listAllFull]. */
data class DaysOffFullListResult(
    val items: List<DaysOffResponse>,
    val total: Long,
)

/** A pool kind as resolved in-transaction (v3.2.0) — see [DaysOffService.resolvePoolKind];
 * [archived] rides along for the budgets rows (a grant whose kind was archived under it —
 * the archive × upsert race — renders as history, v3.2.1). */
data class PoolKind(val id: UInt, val name: String, val carriesOver: Boolean, val isDefault: Boolean, val archived: Boolean = false)

/** One active per-user grant row (v3.2.0) — the `DELETE /days-off/pools/{id}` read preamble. */
data class DaysOffPoolRow(val id: UInt, val userId: UInt, val kind: PoolKind, val allowance: Int)

/** The [DaysOffService.upsertPool] result: the allowance before the write (null = the user
 * held no active pool of that kind — a fresh grant) plus the resolved kind, so the route can
 * detect a no-op re-PUT and name the pool in the audit/notification. */
data class PoolUpsert(val previous: Int?, val kind: PoolKind)

private val ownerUsers = UserService.Users.alias("owner_users")
private val cancelUsers = UserService.Users.alias("cancel_users")

private val SORTABLE_COLUMNS: Map<String, Column<*>> = mapOf(
    "id" to DaysOffService.Requests.id,
    "userName" to ownerUsers[UserService.Users.name],
    // ISO YYYY-MM-DD in a VARCHAR: lexicographic == chronological, so plain column sorts work.
    "startDate" to DaysOffService.Requests.startDate,
    "endDate" to DaysOffService.Requests.endDate,
    "type" to DaysOffService.Requests.type,
    "status" to DaysOffService.Requests.status,
    // The API's `days` is costHalfDays / 2 — same order, so the raw column sorts it.
    "days" to DaysOffService.Requests.costHalfDays,
    "createdAt" to DaysOffService.Requests.createdAt,
)

/**
 * Days-off requests (see V40), their budget corrections (V42), and — since v3.2.0/V74 — the
 * paid pools: the ORG-WIDE kinds registry ([PoolTypes], ADMIN-managed) and the PER-USER grants
 * ([Pools], a chain manager's right). Two encrypted-at-rest columns (the 1:1-notes pattern —
 * the cipher wraps every write and unwraps every read; never filter/sort on them in SQL): the
 * correction COMMENT and, since V63, the request's CANCEL_REASON (the mandatory cancellation
 * reasoning). Request dates, costs, and pool are immutable after create; only the status (and
 * its resolution/cancellation stamps) ever changes. Every PAID request and every correction
 * references its pool KIND (never the grant row), so a pool's history is keyed on
 * (user, kind) and survives archive/re-grant cycles of the grant.
 */
class DaysOffService(val database: R2dbcDatabase, private val cipher: ch.nokillswit.infra.crypto.FieldCipher) : EncryptedAtRest {
    override val encryptedRowLabel = "days-off"

    /** The org-wide pool kinds registry (V74). Soft-deleting = "archived": name lookups for
     * history never filter on the flag; grants/requests/corrections require an ACTIVE kind. */
    object PoolTypes : org.jetbrains.exposed.v1.core.dao.id.UIntIdTable("days_off_pool_types") {
        val name = varchar("name", MAX_POOL_TYPE_NAME_LENGTH)
        val carriesOver = bool("carries_over")
        val isDefault = bool("is_default").default(false)
        val createdAt = long("created_at")
        val lastModified = long("last_modified")
        val markedAsDeleted = bool("marked_as_deleted").default(false)
    }

    /** The per-user grants (V74): (user, kind) → allowance; soft-deleting = "archived" (an
     * archived grant is invisible everywhere — a re-grant inserts a fresh row). */
    object Pools : org.jetbrains.exposed.v1.core.dao.id.UIntIdTable("days_off_pools") {
        val userId = reference("user_id", UserService.Users)
        val poolTypeId = reference("pool_type_id", PoolTypes)
        val allowance = integer("allowance")
        val createdAt = long("created_at")
        val lastModified = long("last_modified")
        val markedAsDeleted = bool("marked_as_deleted").default(false)
    }

    object Requests : org.jetbrains.exposed.v1.core.dao.id.UIntIdTable("days_off_requests") {
        val userId = reference("user_id", UserService.Users)
        val type = enumerationByName("type", 10, DaysOffType::class)
        // V74: the paid pool kind — NOT NULL iff PAID (the DB CHECK pins the pairing).
        val poolTypeId = reference("pool_type_id", PoolTypes).nullable()
        val status = enumerationByName("status", 20, DaysOffStatus::class)
        val startDate = varchar("start_date", 10)
        val endDate = varchar("end_date", 10)
        val startHalf = bool("start_half").default(false)
        val endHalf = bool("end_half").default(false)
        val costHalfDays = integer("cost_half_days")
        val createdAt = long("created_at")
        val resolvedBy = reference("resolved_by", UserService.Users).nullable()
        val resolvedAt = long("resolved_at").nullable()
        val cancelledAt = long("cancelled_at").nullable()
        // V63: the cancelling actor (owner or chain manager) + the encrypted mandatory reason;
        // both null on pre-rework cancellations.
        val cancelledBy = reference("cancelled_by", UserService.Users).nullable()
        val cancelReason = text("cancel_reason").nullable()
        val lastModified = long("last_modified")
        val markedAsDeleted = bool("marked_as_deleted").default(false)
    }

    object Corrections : org.jetbrains.exposed.v1.core.dao.id.UIntIdTable("days_off_corrections") {
        val userId = reference("user_id", UserService.Users)
        val authorId = reference("author_id", UserService.Users)
        // V74: the adjusted pool kind (backfilled to the default kind).
        val poolTypeId = reference("pool_type_id", PoolTypes)
        val year = integer("year")
        val amountHalfDays = integer("amount_half_days")
        val comment = text("comment")
        val createdAt = long("created_at")
        val lastModified = long("last_modified")
        val markedAsDeleted = bool("marked_as_deleted").default(false)
    }

    private fun active(): Op<Boolean> = Requests.markedAsDeleted eq false

    private fun correctionActive(): Op<Boolean> = Corrections.markedAsDeleted eq false

    private fun poolActive(): Op<Boolean> = Pools.markedAsDeleted eq false

    private fun poolTypeActive(): Op<Boolean> = PoolTypes.markedAsDeleted eq false

    private fun counting(): Op<Boolean> = Requests.status inList COUNTING_STATUSES

    /**
     * Validates state rules and inserts a new request as REQUESTED, atomically: the overlap
     * invariant (the owner's REQUESTED/ACCEPTED periods must not intersect — [ConflictException]
     * with `instance` pointing at the existing request, the feedback-duplicate precedent), the
     * working-day cost against the CURRENT holiday registry (frozen on the row; a zero-cost
     * period — weekends/holidays only — is 400), and for PAID the budget sweep: with the new
     * cost added, [remainingHalfDays] must stay >= 0 for every year from the request's through
     * the last year holding a counting PAID request (a retroactive create must not push a later,
     * carry-over-funded year negative) — else 409. Returns the new id plus the direct-manager
     * notifications to persist.
     *
     * With [recordedBy] (v2.29.0, the on-behalf flow — the route has already verified the actor
     * is a current direct manager of [userId]) the row is born ACCEPTED with the actor stamped
     * as the resolver, and the notifications are the recorded pair (owner + acting manager)
     * instead of the review fan-out. Every state rule above applies unchanged.
     */
    suspend fun create(
        userId: UInt,
        request: DaysOffCreateRequest,
        recordedBy: UInt? = null,
    ): Pair<UInt, List<Notification>> =
        suspendTransaction(database) {
            val overlapping = Requests
                .select(Requests.id)
                .where {
                    (Requests.userId eq userId) and active() and counting() and
                        (Requests.startDate lessEq request.endDate) and
                        (Requests.endDate greaterEq request.startDate)
                }
                .limit(1)
                .map { it[Requests.id].value }
                .firstOrNull()
            if (overlapping != null) {
                throw ConflictException(
                    "The period overlaps an existing days-off request",
                    instance = "/api/v1/days-off/$overlapping",
                )
            }
            val start = LocalDate.parse(request.startDate)
            val end = LocalDate.parse(request.endDate)
            val year = start.year
            val cost = daysOffCostHalfDays(start, end, request.startHalf, request.endHalf, holidaysOfYear(year))
            if (cost == 0) {
                throw BadRequestException("The period contains no working days")
            }
            // PAID (v3.2.0): resolve the pool kind + the owner's grant (400s for an unknown/
            // archived kind or an extra kind without an active grant), then sweep THAT pool's
            // history only; a non-carry-over pool resets every January, so only the request's
            // own year can go negative.
            val pool = if (request.type == DaysOffType.PAID) resolvePoolKind(userId, request.poolTypeId) else null
            if (pool != null) {
                val (kind, allowance) = pool
                val corrections = correctionsByYear(userId, kind.id)
                val usedByYear = countingPaidCostsByYear(userId, kind.id).toMutableMap()
                usedByYear[year] = (usedByYear[year] ?: 0) + cost
                val lastYear = if (kind.carriesOver) maxOf(usedByYear.keys.max(), year) else year
                for (y in year..lastYear) {
                    if (remainingHalfDays(allowance, y, usedByYear, corrections, kind.carriesOver) < 0) {
                        throw ConflictException("Insufficient paid days-off budget for year $y")
                    }
                }
            }
            val now = System.currentTimeMillis()
            val id = Requests.insert {
                it[this.userId] = userId
                it[type] = request.type
                it[poolTypeId] = pool?.first?.id
                it[status] = if (recordedBy != null) DaysOffStatus.ACCEPTED else DaysOffStatus.REQUESTED
                it[startDate] = request.startDate
                it[endDate] = request.endDate
                it[startHalf] = request.startHalf
                it[endHalf] = request.endHalf
                it[costHalfDays] = cost
                it[createdAt] = now
                if (recordedBy != null) {
                    it[resolvedBy] = recordedBy
                    it[resolvedAt] = now
                }
                it[lastModified] = now
            }[Requests.id].value
            val notifications = if (recordedBy != null) {
                daysOffRecordedNotifications(
                    ownerId = userId,
                    ownerName = userName(userId),
                    managerId = recordedBy,
                    managerName = userName(recordedBy),
                    type = request.type,
                    poolName = pool?.first?.name,
                    days = formatHalfDaysParam(cost),
                    startDate = request.startDate,
                    endDate = request.endDate,
                )
            } else {
                daysOffRequestedNotifications(
                    managerIds = directManagerIds(userId),
                    requesterName = userName(userId),
                    type = request.type,
                    poolName = pool?.first?.name,
                    days = formatHalfDaysParam(cost),
                    startDate = request.startDate,
                    endDate = request.endDate,
                )
            }
            id to notifications
        }

    suspend fun read(id: UInt): DaysOffResponse? = suspendTransaction(database) {
        val row = joined()
            .selectAll()
            .where { (Requests.id eq id) and active() }
            .map { it }
            .singleOrNull()
            ?: return@suspendTransaction null
        // One extra lookup only when resolved — spares the read path a second user join.
        toFullResponse(row, resolvedByName = row[Requests.resolvedBy]?.value?.let { userName(it) })
    }

    /** A joined() row → the full response, with the resolver name supplied by the caller. */
    private fun toFullResponse(row: ResultRow, resolvedByName: String?): DaysOffResponse =
        DaysOffResponse(
            id = row[Requests.id].value,
            userId = row[Requests.userId].value,
            userName = row[ownerUsers[UserService.Users.name]],
            type = row[Requests.type],
            poolTypeId = row[Requests.poolTypeId]?.value,
            poolName = row.getOrNull(PoolTypes.name),
            status = row[Requests.status],
            startDate = row[Requests.startDate],
            endDate = row[Requests.endDate],
            startHalf = row[Requests.startHalf],
            endHalf = row[Requests.endHalf],
            days = row[Requests.costHalfDays] / 2.0,
            createdAt = row[Requests.createdAt],
            resolvedById = row[Requests.resolvedBy]?.value,
            resolvedByName = resolvedByName,
            resolvedAt = row[Requests.resolvedAt],
            cancelledAt = row[Requests.cancelledAt],
            cancelledById = row[Requests.cancelledBy]?.value,
            cancelledByName = row.getOrNull(cancelUsers[UserService.Users.name]),
            cancelReason = row[Requests.cancelReason]?.let { cipher.decrypt(it) },
            lastModified = row[Requests.lastModified],
        )

    /**
     * Unscoped full-document page for the integration API (v3.0.0 — no caller, no view
     * scoping, no capability stamping; see integration/). Reuses [DaysOffListFilter]'s
     * userId/type/status/startDate-bound predicate; resolver names come from ONE batch query.
     */
    suspend fun listAllFull(filter: DaysOffListFilter, paging: PageRequest): DaysOffFullListResult =
        suspendTransaction(database) {
            val predicate = buildPredicate(filter) and active()
            val total = joined().selectAll().where { predicate }.count()
            val rows = joined().selectAll()
                .where { predicate }
                .applyPaging(paging, SORTABLE_COLUMNS)
                .map { it }
                .toList()
            DaysOffFullListResult(items = withResolverNames(rows), total = total)
        }

    /**
     * Batch for the integration API (v3.0.0): owner id → their requests (every status),
     * optionally bounded to startDates of one calendar year; owners without requests are
     * absent from the map.
     */
    suspend fun listByUserIds(userIds: Set<UInt>, year: Int?): Map<UInt, List<DaysOffResponse>> =
        if (userIds.isEmpty()) emptyMap()
        else suspendTransaction(database) {
            var predicate: Op<Boolean> = (Requests.userId inList userIds) and active()
            year?.let {
                predicate = predicate and
                    (Requests.startDate greaterEq "$it-01-01") and (Requests.startDate lessEq "$it-12-31")
            }
            val rows = joined().selectAll()
                .where { predicate }
                .orderBy(Requests.id to SortOrder.ASC)
                .map { it }
                .toList()
            withResolverNames(rows).groupBy { it.userId }
        }

    /** Rows → responses with resolver names filled from ONE batch name query (in-transaction). */
    private suspend fun withResolverNames(rows: List<ResultRow>): List<DaysOffResponse> {
        val resolverIds = rows.mapNotNull { it[Requests.resolvedBy]?.value }.toSet()
        val names =
            if (resolverIds.isEmpty()) {
                emptyMap()
            } else {
                UserService.Users
                    .select(UserService.Users.id, UserService.Users.name)
                    .where { UserService.Users.id inList resolverIds }
                    .map { it[UserService.Users.id].value to it[UserService.Users.name] }
                    .toList()
                    .toMap()
            }
        return rows.map { row -> toFullResponse(row, resolvedByName = row[Requests.resolvedBy]?.value?.let { names[it] }) }
    }

    /**
     * Moves a request to [target] (ACCEPTED/REJECTED only — cancellation is [cancel]),
     * atomically with its state checks; the route has already authorized the actor (a direct
     * manager). Accept/reject require REQUESTED and stamp the resolver; anything else is
     * [ConflictException] (→ 409). Returns the notifications to persist, or null when the row
     * is missing (→ 404).
     */
    suspend fun transition(
        id: UInt,
        actorId: UInt,
        target: DaysOffStatus,
    ): List<Notification>? = suspendTransaction(database) {
        val row = Requests.selectAll()
            .where { (Requests.id eq id) and active() }
            .map { it }
            .singleOrNull()
            ?: return@suspendTransaction null
        val ownerId = row[Requests.userId].value
        val status = row[Requests.status]
        val startDate = row[Requests.startDate]
        val endDate = row[Requests.endDate]
        val now = System.currentTimeMillis()
        when (target) {
            DaysOffStatus.ACCEPTED, DaysOffStatus.REJECTED -> {
                if (status != DaysOffStatus.REQUESTED) {
                    throw ConflictException("Invalid status transition: $status -> $target")
                }
                Requests.update({ (Requests.id eq id) and (Requests.markedAsDeleted eq false) }) {
                    it[this.status] = target
                    it[resolvedBy] = actorId
                    it[resolvedAt] = now
                    it[lastModified] = now
                }
                listOf(daysOffResolvedNotification(ownerId, target, userName(actorId), startDate, endDate))
            }
            else -> error("Not a transition target: $target")
        }
    }

    /**
     * Cancels a request (v2.31.0): valid from REQUESTED or ACCEPTED regardless of date —
     * cancelling frees the frozen cost automatically (the row leaves the counting statuses;
     * note a retroactive PAID cancel can move the budget anchor forward, reducing a later
     * year's accumulated allowance — accepted). The route has already authorized [actorId]
     * (the owner or a manager in their transitive chain) and validated [reason], which lands
     * encrypted on the row; [actorId] is stamped as cancelled_by. Both sides are notified:
     * the owner always, plus — owner-cancel — every current direct manager, or — manager-cancel
     * — the acting manager's durable receipt (the v2.29.0 recorded-pair precedent). Returns
     * the notifications to persist, or null when the row is missing (→ 404).
     */
    suspend fun cancel(
        id: UInt,
        actorId: UInt,
        reason: String,
    ): List<Notification>? = suspendTransaction(database) {
        val row = Requests.selectAll()
            .where { (Requests.id eq id) and active() }
            .map { it }
            .singleOrNull()
            ?: return@suspendTransaction null
        val ownerId = row[Requests.userId].value
        val status = row[Requests.status]
        if (status !in COUNTING_STATUSES) {
            throw ConflictException("Invalid status transition: $status -> CANCELLED")
        }
        val now = System.currentTimeMillis()
        Requests.update({ (Requests.id eq id) and (Requests.markedAsDeleted eq false) }) {
            it[this.status] = DaysOffStatus.CANCELLED
            it[cancelledAt] = now
            it[cancelledBy] = actorId
            it[cancelReason] = cipher.encrypt(reason)
            it[lastModified] = now
        }
        val byManager = actorId != ownerId
        daysOffCancelledNotifications(
            ownerId = ownerId,
            ownerName = userName(ownerId),
            actorName = userName(actorId),
            managerRecipientIds = if (byManager) setOf(actorId) else directManagerIds(ownerId),
            byManager = byManager,
            startDate = row[Requests.startDate],
            endDate = row[Requests.endDate],
        )
    }

    suspend fun list(
        view: DaysOffListView,
        callerUserId: UInt,
        filter: DaysOffListFilter,
        paging: PageRequest,
        targetUserId: UInt? = null,
        includeIndirect: Boolean = false,
    ): DaysOffListResult = suspendTransaction(database) {
        // One chain walk per request (the TeamKpiService.list idiom) — backs every row's
        // canCancel AND canResolve capability flags (both rights are chain-wide since v2.33.0);
        // a caller managing nobody pays a single empty-frontier query.
        val subtree = transitiveSubordinateIds(callerUserId)
        val scope: Op<Boolean> = when (view) {
            DaysOffListView.OWN -> Requests.userId eq callerUserId
            // Direct reports by default — the day-to-day slice; includeIndirect (v2.32.0,
            // the drill-down's chain mode) widens to the whole subtree. Chain managers could
            // always read singles via the guard (a list scope, not an authorization boundary).
            DaysOffListView.MANAGED -> {
                val reports = if (includeIndirect) subtree else directSubordinateIds(callerUserId)
                if (reports.isEmpty()) Op.FALSE else Requests.userId inList reports
            }
            // Auditor view (HR-only, gated route-side via requireAuditListAccess): every request
            // of the target, at every status. The route guarantees a non-null userId.
            DaysOffListView.USER -> Requests.userId eq requireNotNull(targetUserId) { "view=user requires userId" }
        }
        val predicate: Op<Boolean> = scope and buildPredicate(filter) and active()
        val join = joined()
        val total = join.selectAll().where { predicate }.count()
        val rows = join
            .select(
                Requests.id,
                Requests.userId,
                Requests.type,
                Requests.poolTypeId,
                Requests.status,
                Requests.startDate,
                Requests.endDate,
                Requests.startHalf,
                Requests.endHalf,
                Requests.costHalfDays,
                Requests.createdAt,
                Requests.cancelledAt,
                Requests.cancelReason,
                Requests.lastModified,
                ownerUsers[UserService.Users.name],
                ownerUsers[UserService.Users.markedAsDeleted],
                cancelUsers[UserService.Users.name],
                PoolTypes.name,
            )
            .where { predicate }
            .applyPaging(paging, SORTABLE_COLUMNS)
            .map { row ->
                DaysOffListItem(
                    id = row[Requests.id].value,
                    userId = row[Requests.userId].value,
                    userName = row[ownerUsers[UserService.Users.name]],
                    userDeleted = row[ownerUsers[UserService.Users.markedAsDeleted]],
                    type = row[Requests.type],
                    poolTypeId = row[Requests.poolTypeId]?.value,
                    poolName = row.getOrNull(PoolTypes.name),
                    status = row[Requests.status],
                    startDate = row[Requests.startDate],
                    endDate = row[Requests.endDate],
                    startHalf = row[Requests.startHalf],
                    endHalf = row[Requests.endHalf],
                    days = row[Requests.costHalfDays] / 2.0,
                    createdAt = row[Requests.createdAt],
                    cancelledAt = row[Requests.cancelledAt],
                    cancelledByName = row.getOrNull(cancelUsers[UserService.Users.name]),
                    cancelReason = row[Requests.cancelReason]?.let { cipher.decrypt(it) },
                    canCancel = row[Requests.status] in COUNTING_STATUSES &&
                        (row[Requests.userId].value == callerUserId || row[Requests.userId].value in subtree),
                    canResolve = row[Requests.status] == DaysOffStatus.REQUESTED &&
                        row[Requests.userId].value in subtree,
                    lastModified = row[Requests.lastModified],
                )
            }
            .toList()
        DaysOffListResult(items = rows, total = total)
    }

    /**
     * The month calendar payload. MEMBER scope = everyone sharing a non-deleted team with the
     * caller, the caller included (a team-less caller sees just themselves); MANAGED = the
     * caller's direct reports. Every scoped user appears (rows must render), carrying their
     * REQUESTED/ACCEPTED (counting) days clipped to [month] — the whole period is expanded,
     * weekends included, so the bar renders continuously (the grid dims those columns anyway) —
     * plus the month's public holidays.
     */
    suspend fun calendar(
        scope: DaysOffCalendarScope,
        callerUserId: UInt,
        month: String,
    ): DaysOffCalendarResponse = suspendTransaction(database) {
        val userIds: Set<UInt> = when (scope) {
            DaysOffCalendarScope.MEMBER -> teamMemberPeers(callerUserId) + callerUserId
            DaysOffCalendarScope.MANAGED -> directSubordinateIds(callerUserId)
        }
        val monthStart = "$month-01"
        val monthEnd = YearMonth.parse(month).atEndOfMonth().toString()
        val users = if (userIds.isEmpty()) {
            emptyList()
        } else {
            UserService.Users
                .select(UserService.Users.id, UserService.Users.name, UserService.Users.markedAsDeleted)
                .where { UserService.Users.id inList userIds }
                .orderBy(UserService.Users.name to SortOrder.ASC, UserService.Users.id to SortOrder.ASC)
                .map {
                    Triple(
                        it[UserService.Users.id].value,
                        it[UserService.Users.name],
                        it[UserService.Users.markedAsDeleted],
                    )
                }
                .toList()
        }
        val entriesByUser: Map<UInt, List<DaysOffCalendarEntry>> = if (userIds.isEmpty()) {
            emptyMap()
        } else {
            Requests
                .join(PoolTypes, JoinType.LEFT, onColumn = Requests.poolTypeId, otherColumn = PoolTypes.id)
                .select(
                    Requests.id, Requests.userId, Requests.type, Requests.status,
                    Requests.startDate, Requests.endDate, Requests.startHalf, Requests.endHalf,
                    PoolTypes.name,
                )
                .where {
                    (Requests.userId inList userIds) and active() and counting() and
                        (Requests.startDate lessEq monthEnd) and (Requests.endDate greaterEq monthStart)
                }
                .map { it }
                .toList()
                .groupBy({ it[Requests.userId].value }) { row ->
                    // Calendar parity (v3.2.1): the member scope shows teammates THAT someone
                    // is off, never which paid pool; the caller's own bars keep the name.
                    val redact = scope == DaysOffCalendarScope.MEMBER && row[Requests.userId].value != callerUserId
                    expandEntries(row, monthStart, monthEnd, redactPool = redact)
                }
                .mapValues { (_, lists) -> lists.flatten().sortedBy { it.date } }
        }
        val holidays = PublicHolidayService.PublicHolidays
            .selectAll()
            .where {
                (PublicHolidayService.PublicHolidays.holidayDate greaterEq monthStart) and
                    (PublicHolidayService.PublicHolidays.holidayDate lessEq monthEnd)
            }
            .orderBy(PublicHolidayService.PublicHolidays.holidayDate to SortOrder.ASC)
            .map {
                PublicHolidayItem(
                    id = it[PublicHolidayService.PublicHolidays.id].value,
                    date = it[PublicHolidayService.PublicHolidays.holidayDate],
                    name = it[PublicHolidayService.PublicHolidays.name],
                )
            }
            .toList()
        DaysOffCalendarResponse(
            month = month,
            holidays = holidays,
            users = users.map { (id, name, deleted) ->
                DaysOffCalendarUser(
                    userId = id,
                    userName = name,
                    userDeleted = deleted,
                    entries = entriesByUser[id] ?: emptyList(),
                )
            },
        )
    }

    /**
     * The budget rows of [userIds] for [year] (see [DaysOffBudget]) — since v3.2.0 ONE ROW PER
     * (user, pool kind): the closed-form carry-over over that pool's counting PAID requests up
     * to [year] (one grouped fetch per table, joined in Kotlin on (user, kind) — no SQL
     * arithmetic on R2DBC), split into the year's reserved (REQUESTED) and used (ACCEPTED)
     * days. Per user: the default kind's row ALWAYS (allowance null when ungranted — today's
     * "not configured = zero budget"), then one row per active extra grant, then history-only
     * rows (`poolArchived`) for extra kinds with a counting request or correction IN [year]
     * but no active grant; extras sort by kind name. Users without any requests still get
     * their default row. Sorted by user name.
     * PINNED CONTRACT (checkup #30, B-M3): the result is driven off the `users` table with
     * NO deleted/deactivated filter — EVERY id in [userIds] that names an existing user row
     * yields (at least) its default-kind budget. The integration API's non-null
     * `User.daysOffBudget` GraphQL field depends on this (through [defaultBudgets]); adding
     * an `active()` filter here would turn it into a hard error for soft-deleted users
     * reachable through that graph.
     * [correctable] stamps every row's `canCorrect` capability flag: since v2.33.0 the
     * corrections write is chain-wide, so every managed-view row (the caller's subtree by
     * construction) is correctable and view=own rows never are — decided route-side.
     */
    suspend fun budgets(
        userIds: Set<UInt>,
        year: Int,
        correctable: Boolean = false,
    ): List<DaysOffBudget> = suspendTransaction(database) {
        if (userIds.isEmpty()) return@suspendTransaction emptyList()
        data class CountingRow(val year: Int, val status: DaysOffStatus, val costH: Int)
        val rowsByUserPool: Map<Pair<UInt, UInt>, List<CountingRow>> = Requests
            .select(Requests.userId, Requests.poolTypeId, Requests.startDate, Requests.status, Requests.costHalfDays)
            .where {
                (Requests.userId inList userIds) and active() and counting() and
                    (Requests.type eq DaysOffType.PAID) and
                    (Requests.startDate lessEq "$year-12-31")
            }
            .map { it }
            .toList()
            .groupBy({ it[Requests.userId].value to requireNotNull(it[Requests.poolTypeId]).value }) { row ->
                CountingRow(
                    // Same-year requests (app-enforced), so the start date names the budget year.
                    year = row[Requests.startDate].substring(0, 4).toInt(),
                    status = row[Requests.status],
                    costH = row[Requests.costHalfDays],
                )
            }
        // One grouped fetch of the whole set's active corrections (no year cap — the anchor
        // may sit before [year], and later ones never enter the filtered sums anyway).
        val correctionsByUserPool: Map<Pair<UInt, UInt>, Map<Int, Int>> = Corrections
            .select(Corrections.userId, Corrections.poolTypeId, Corrections.year, Corrections.amountHalfDays)
            .where { (Corrections.userId inList userIds) and correctionActive() }
            .map { it }
            .toList()
            .groupBy { it[Corrections.userId].value to it[Corrections.poolTypeId].value }
            .mapValues { (_, rows) ->
                rows.groupBy({ it[Corrections.year] }) { it[Corrections.amountHalfDays] }
                    .mapValues { (_, amounts) -> amounts.sum() }
            }
        // The active grants: (user, kind) → (grant id, allowance).
        val grants: Map<Pair<UInt, UInt>, Pair<UInt, Int>> = Pools
            .select(Pools.id, Pools.userId, Pools.poolTypeId, Pools.allowance)
            .where { (Pools.userId inList userIds) and poolActive() }
            .map { (it[Pools.userId].value to it[Pools.poolTypeId].value) to (it[Pools.id].value to it[Pools.allowance]) }
            .toList()
            .toMap()
        // Every kind, archived ones included — they still label their history.
        val kinds: Map<UInt, PoolKind> = PoolTypes
            .selectAll()
            .map { it.toPoolKind() }
            .toList()
            .associateBy { it.id }
        val defaultKind = defaultKind()
        // Pre-grouped per user once (v3.2.1 — the per-user re-scan of every (user, kind) key was
        // O(users × keys) on the includeIndirect managed view).
        val activeKindsByUser = grants.keys.groupBy({ it.first }, { it.second })
        val historyKindsByUser = (rowsByUserPool.keys + correctionsByUserPool.keys)
            .filter { (userId, kindId) ->
                rowsByUserPool[userId to kindId].orEmpty().any { it.year == year } ||
                    correctionsByUserPool[userId to kindId].orEmpty().containsKey(year)
            }
            .groupBy({ it.first }, { it.second })
        UserService.Users
            .select(UserService.Users.id, UserService.Users.name, UserService.Users.markedAsDeleted)
            .where { UserService.Users.id inList userIds }
            .orderBy(UserService.Users.name to SortOrder.ASC, UserService.Users.id to SortOrder.ASC)
            .map { row ->
                val userId = row[UserService.Users.id].value
                val userName = row[UserService.Users.name]
                val userDeleted = row[UserService.Users.markedAsDeleted]
                val activeKindIds = activeKindsByUser[userId].orEmpty()
                val historyKindIds = historyKindsByUser[userId].orEmpty()
                val extraKindIds = (activeKindIds + historyKindIds).toSet() - defaultKind.id
                val orderedKinds = listOf(defaultKind) +
                    extraKindIds.map { kinds.getValue(it) }.sortedWith(compareBy({ it.name }, { it.id }))
                orderedKinds.map { kind ->
                    val grant = grants[userId to kind.id]
                    val allowance = grant?.second
                    val countingRows = rowsByUserPool[userId to kind.id].orEmpty()
                    val usedByYear = countingRows.groupBy { it.year }.mapValues { (_, r) -> r.sumOf { it.costH } }
                    val corrections = correctionsByUserPool[userId to kind.id].orEmpty()
                    val reservedH = countingRows.filter { it.year == year && it.status == DaysOffStatus.REQUESTED }
                        .sumOf { it.costH }
                    val usedH = countingRows.filter { it.year == year && it.status == DaysOffStatus.ACCEPTED }
                        .sumOf { it.costH }
                    DaysOffBudget(
                        userId = userId,
                        userName = userName,
                        userDeleted = userDeleted,
                        year = year,
                        poolId = grant?.first,
                        poolTypeId = kind.id,
                        poolName = kind.name,
                        carriesOver = kind.carriesOver,
                        isDefault = kind.isDefault,
                        // History-only (no active grant) — or a grant whose kind was archived
                        // under it (the archive × upsert race, v3.2.1): both render as archived.
                        poolArchived = !kind.isDefault && (grant == null || kind.archived),
                        allowance = allowance,
                        carriedOver = carriedOverHalfDays(allowance, year, usedByYear, corrections, kind.carriesOver) / 2.0,
                        corrected = (corrections[year] ?: 0) / 2.0,
                        reserved = reservedH / 2.0,
                        used = usedH / 2.0,
                        remaining = remainingHalfDays(allowance, year, usedByYear, corrections, kind.carriesOver) / 2.0,
                        canCorrect = correctable,
                    )
                }
            }
            .toList()
            .flatten()
    }

    /** The default kind's row per user (v3.2.0) — the one-row-per-user slice behind the
     * `/teams/members` card stat and the GraphQL `User.daysOffBudget` field (whose non-null
     * pin rides [budgets]' per-user default row). */
    suspend fun defaultBudgets(userIds: Set<UInt>, year: Int): List<DaysOffBudget> =
        budgets(userIds, year).filter { it.isDefault }

    // ── Paid pools (v3.2.0) ─────────────────────────────────────────────────────────────────

    /** The active kinds registry, default first then name (the unpaged registry read). */
    suspend fun listPoolTypes(): List<DaysOffPoolType> = suspendTransaction(database) {
        PoolTypes.selectAll()
            .where { poolTypeActive() }
            .orderBy(PoolTypes.isDefault to SortOrder.DESC, PoolTypes.name to SortOrder.ASC, PoolTypes.id to SortOrder.ASC)
            .map { it.toPoolKind().toResponse() }
            .toList()
    }

    suspend fun readPoolType(id: UInt): DaysOffPoolType? = suspendTransaction(database) {
        PoolTypes.selectAll()
            .where { (PoolTypes.id eq id) and poolTypeActive() }
            .map { it.toPoolKind().toResponse() }
            .singleOrNull()
    }

    /** Inserts a kind (name pre-validated by the route). A duplicate active name raises 23505 →
     * the central 409 mapping. Never the default — the seed row is the only one. */
    suspend fun createPoolType(write: DaysOffPoolTypeWrite): UInt = suspendTransaction(database) {
        val now = System.currentTimeMillis()
        PoolTypes.insert {
            it[name] = write.name
            it[carriesOver] = write.carriesOver
            it[createdAt] = now
            it[lastModified] = now
        }[PoolTypes.id].value
    }

    /** Renames / re-flags a kind (the default included — `isDefault` itself never moves).
     * Returns the number of ACTIVE grants of the kind (the budgets a carry-over flip
     * recomputes — the audit's `grantsAffected`), or null when missing/archived (→ 404). */
    suspend fun updatePoolType(id: UInt, write: DaysOffPoolTypeWrite): Long? = suspendTransaction(database) {
        val updated = PoolTypes.update({ (PoolTypes.id eq id) and poolTypeActive() }) {
            it[name] = write.name
            it[carriesOver] = write.carriesOver
            it[lastModified] = System.currentTimeMillis()
        }
        if (updated == 0) return@suspendTransaction null
        Pools.selectAll().where { (Pools.poolTypeId eq id) and poolActive() }.count()
    }

    /**
     * Archives a kind (soft delete) AND every active grant of it in the same transaction —
     * no user keeps a pool of a retired kind; their history stays labelled (name lookups
     * never filter on the flag). The route has already refused the default kind (409).
     * Returns the archived-grant count, or null when the kind is missing/archived (→ 404).
     */
    suspend fun archivePoolType(id: UInt): Int? = suspendTransaction(database) {
        val archived = PoolTypes.update({ (PoolTypes.id eq id) and poolTypeActive() }) {
            it[markedAsDeleted] = true
            it[lastModified] = System.currentTimeMillis()
        }
        if (archived == 0) return@suspendTransaction null
        Pools.update({ (Pools.poolTypeId eq id) and poolActive() }) {
            it[markedAsDeleted] = true
            it[lastModified] = System.currentTimeMillis()
        }
    }

    /**
     * The `PUT /days-off/allowance` write (v3.2.0 shape): upserts [userId]'s grant of the
     * [poolTypeId] kind (null = the default kind) — overwriting the active grant's allowance,
     * or inserting a fresh grant when the user holds none (a re-grant after an archive
     * included: the partial unique index only guards ACTIVE rows). 400 for an unknown or
     * archived kind. Returns the previous allowance (null = fresh grant) plus the kind.
     */
    suspend fun upsertPool(userId: UInt, poolTypeId: UInt?, allowance: Int): PoolUpsert =
        suspendTransaction(database) {
            val kind = activeKind(poolTypeId ?: defaultKind().id)
                ?: throw BadRequestException("Unknown or archived days-off pool type")
            val now = System.currentTimeMillis()
            val existing = Pools
                .select(Pools.id, Pools.allowance)
                .where { (Pools.userId eq userId) and (Pools.poolTypeId eq kind.id) and poolActive() }
                .map { it[Pools.id].value to it[Pools.allowance] }
                .singleOrNull()
            if (existing == null) {
                Pools.insert {
                    it[this.userId] = userId
                    it[this.poolTypeId] = kind.id
                    it[this.allowance] = allowance
                    it[createdAt] = now
                    it[lastModified] = now
                }
            } else if (existing.second != allowance) {
                Pools.update({ Pools.id eq existing.first }) {
                    it[this.allowance] = allowance
                    it[lastModified] = now
                }
            }
            PoolUpsert(previous = existing?.second, kind = kind)
        }

    /** The active grant row (the `DELETE /days-off/pools/{id}` read preamble — 404 when
     * missing or archived). */
    suspend fun readPool(id: UInt): DaysOffPoolRow? = suspendTransaction(database) {
        Pools
            .join(PoolTypes, JoinType.INNER, onColumn = Pools.poolTypeId, otherColumn = PoolTypes.id)
            .selectAll()
            .where { (Pools.id eq id) and poolActive() }
            .map {
                DaysOffPoolRow(
                    id = it[Pools.id].value,
                    userId = it[Pools.userId].value,
                    kind = it.toPoolKind(),
                    allowance = it[Pools.allowance],
                )
            }
            .singleOrNull()
    }

    /** Archives a grant (soft delete): no new requests/corrections in that pool; its history
     * keeps counting and its label. The route has already refused the default kind (409).
     * 0 → missing/archived → 404. */
    suspend fun archivePool(id: UInt): Int = suspendTransaction(database) {
        Pools.update({ (Pools.id eq id) and poolActive() }) {
            it[markedAsDeleted] = true
            it[lastModified] = System.currentTimeMillis()
        }
    }

    /**
     * Resolves the pool kind a PAID request or a correction targets (in-transaction):
     * [poolTypeId] or the default kind; 400 when unknown/archived; the user's ACTIVE grant
     * supplies the allowance (null = ungranted). An extra kind without an active grant is 400
     * ("no such pool for this user") — the default kind needs none (ungranted = zero budget,
     * the pre-v3.2.0 rule, so the create sweep answers 409 there).
     */
    private suspend fun resolvePoolKind(userId: UInt, poolTypeId: UInt?): Pair<PoolKind, Int?> {
        val kind = activeKind(poolTypeId ?: defaultKind().id)
            ?: throw BadRequestException("Unknown or archived days-off pool type")
        val allowance = Pools
            .select(Pools.allowance)
            .where { (Pools.userId eq userId) and (Pools.poolTypeId eq kind.id) and poolActive() }
            .map { it[Pools.allowance] }
            .singleOrNull()
        if (!kind.isDefault && allowance == null) {
            throw BadRequestException("The user holds no active \"${kind.name}\" days-off pool")
        }
        return kind to allowance
    }

    private suspend fun activeKind(id: UInt): PoolKind? =
        PoolTypes.selectAll()
            .where { (PoolTypes.id eq id) and poolTypeActive() }
            .map { it.toPoolKind() }
            .singleOrNull()

    /** The seeded default kind (V74 guarantees exactly one active). Runs in the caller's transaction. */
    private suspend fun defaultKind(): PoolKind =
        PoolTypes.selectAll()
            .where { (PoolTypes.isDefault eq true) and poolTypeActive() }
            .map { it.toPoolKind() }
            .singleOrNull()
            ?: error("The default days-off pool type is missing")

    private fun ResultRow.toPoolKind() = PoolKind(
        id = this[PoolTypes.id].value,
        name = this[PoolTypes.name],
        carriesOver = this[PoolTypes.carriesOver],
        isDefault = this[PoolTypes.isDefault],
        archived = this[PoolTypes.markedAsDeleted],
    )

    private fun PoolKind.toResponse() = DaysOffPoolType(id = id, name = name, carriesOver = carriesOver, isDefault = isDefault)

    // ── Budget corrections (v1.43.0) ────────────────────────────────────────────────────────

    /** The user's active corrections, newest year (then newest row) first, author joined. */
    suspend fun listCorrections(userId: UInt, year: Int? = null): List<DaysOffCorrectionResponse> =
        suspendTransaction(database) {
            var predicate: Op<Boolean> = (Corrections.userId eq userId) and correctionActive()
            year?.let { predicate = predicate and (Corrections.year eq it) }
            correctionsJoined()
                .selectAll()
                .where { predicate }
                .orderBy(Corrections.year to SortOrder.DESC, Corrections.id to SortOrder.DESC)
                .map { it.toCorrection() }
                .toList()
        }

    /** Author name + the pool kind's current name (archived kinds keep labelling history). */
    private fun correctionsJoined() = Corrections
        .join(
            ownerUsers,
            JoinType.INNER,
            onColumn = Corrections.authorId,
            otherColumn = ownerUsers[UserService.Users.id],
        )
        .join(PoolTypes, JoinType.INNER, onColumn = Corrections.poolTypeId, otherColumn = PoolTypes.id)

    /**
     * Batch for the integration API (v3.0.0): user id → their active corrections (newest year,
     * then newest row, first — the [listCorrections] order), optionally bounded to one year;
     * users without corrections are absent from the map.
     */
    suspend fun listCorrectionsByUserIds(
        userIds: Set<UInt>,
        year: Int?,
    ): Map<UInt, List<DaysOffCorrectionResponse>> =
        if (userIds.isEmpty()) emptyMap()
        else suspendTransaction(database) {
            var predicate: Op<Boolean> = (Corrections.userId inList userIds) and correctionActive()
            year?.let { predicate = predicate and (Corrections.year eq it) }
            correctionsJoined()
                .selectAll()
                .where { predicate }
                .orderBy(Corrections.year to SortOrder.DESC, Corrections.id to SortOrder.DESC)
                .map { it.toCorrection() }
                .toList()
                .groupBy { it.userId }
        }

    suspend fun readCorrection(id: UInt): DaysOffCorrectionResponse? = suspendTransaction(database) {
        correctionsJoined()
            .selectAll()
            .where { (Corrections.id eq id) and correctionActive() }
            .map { it.toCorrection() }
            .singleOrNull()
    }

    /** Inserts a correction (shape pre-validated by the route; no budget gate — a SUBTRACT may
     * push a year negative, the allowance-cut precedent) against the resolved pool kind
     * (v3.2.0 — 400 for an unknown/archived kind or an extra kind the user holds no active
     * grant of) and returns the id plus the owner's notification. */
    suspend fun createCorrection(authorId: UInt, write: DaysOffCorrectionWrite): Pair<UInt, Notification> =
        suspendTransaction(database) {
            val (kind, _) = resolvePoolKind(write.userId, write.poolTypeId)
            val now = System.currentTimeMillis()
            val id = Corrections.insert {
                it[userId] = write.userId
                it[this.authorId] = authorId
                it[poolTypeId] = kind.id
                it[year] = write.year
                it[amountHalfDays] = correctionHalfDays(write)
                it[comment] = cipher.encrypt(write.comment)
                it[createdAt] = now
                it[lastModified] = now
            }[Corrections.id].value
            id to daysOffCorrectionNotification(
                ownerId = write.userId,
                managerName = userName(authorId),
                poolName = kind.name,
                year = write.year,
                operation = write.operation,
                days = formatHalfDaysParam((write.days * 2).toInt()),
            )
        }

    /** Updates a correction's year/amount/comment (the target user AND the pool are immutable —
     * [write]'s userId/poolTypeId are ignored here; the route guards against the ROW's user;
     * re-homing a correction is delete + create). 0 → missing → 404. */
    suspend fun updateCorrection(id: UInt, write: DaysOffCorrectionWrite): Int = suspendTransaction(database) {
        Corrections.update({ (Corrections.id eq id) and (Corrections.markedAsDeleted eq false) }) {
            it[year] = write.year
            it[amountHalfDays] = correctionHalfDays(write)
            it[comment] = cipher.encrypt(write.comment)
            it[lastModified] = System.currentTimeMillis()
        }
    }

    suspend fun deleteCorrection(id: UInt): Int = suspendTransaction(database) {
        Corrections.update({ (Corrections.id eq id) and (Corrections.markedAsDeleted eq false) }) {
            it[markedAsDeleted] = true
        }
    }

    /** Year → summed SIGNED half-day corrections of [userId] in ONE pool kind. Runs in the
     * caller's transaction. */
    private suspend fun correctionsByYear(userId: UInt, poolTypeId: UInt): Map<Int, Int> =
        Corrections
            .select(Corrections.year, Corrections.amountHalfDays)
            .where { (Corrections.userId eq userId) and (Corrections.poolTypeId eq poolTypeId) and correctionActive() }
            .map { it[Corrections.year] to it[Corrections.amountHalfDays] }
            .toList()
            .groupBy({ it.first }) { it.second }
            .mapValues { (_, amounts) -> amounts.sum() }

    private fun ResultRow.toCorrection(): DaysOffCorrectionResponse {
        val halfDays = this[Corrections.amountHalfDays]
        return DaysOffCorrectionResponse(
            id = this[Corrections.id].value,
            userId = this[Corrections.userId].value,
            authorId = this[Corrections.authorId].value,
            authorName = this[ownerUsers[UserService.Users.name]],
            authorDeleted = this[ownerUsers[UserService.Users.markedAsDeleted]],
            poolTypeId = this[Corrections.poolTypeId].value,
            poolName = this[PoolTypes.name],
            year = this[Corrections.year],
            operation = if (halfDays >= 0) DaysOffCorrectionOperation.ADD else DaysOffCorrectionOperation.SUBTRACT,
            days = kotlin.math.abs(halfDays) / 2.0,
            comment = cipher.decrypt(this[Corrections.comment]),
            createdAt = this[Corrections.createdAt],
            lastModified = this[Corrections.lastModified],
        )
    }

    /**
     * Startup backfill (see infra/db/Bootstrap.kt): encrypts correction comments still holding
     * legacy plaintext — including soft-deleted rows. With [reencryptAll] (key rotation) every
     * row is rewritten under the current key. Idempotent; returns the rewritten count.
     */
    override suspend fun encryptLegacyRows(reencryptAll: Boolean): Int = suspendTransaction(database) {
        // Two encrypted tables, both re-swept in ONE transaction (the documented two-table case
        // in infra/crypto/Reencrypt.kt).
        cipher.reencryptRows(Corrections, listOf(Corrections.comment), reencryptAll) +
            cipher.reencryptRows(Requests, listOf(Requests.cancelReason), reencryptAll)
    }

    // ── Card-stat batch helpers (v1.44.0 — the activeGoalCountsBy* shape, page-scoped) ─────

    /**
     * Per user, the start date of their next ACCEPTED vacation that hasn't ended yet — an
     * ongoing one counts (its start still answers "when"); pending requests deliberately
     * don't (they may be rejected). Users with none are absent from the map. Backs the
     * /teams/members card enrichment (managed + member views — teammate-visible by calendar
     * parity, ACCEPTED is on the calendar).
     */
    suspend fun nextAcceptedVacationsByUserIds(
        userIds: Set<UInt>,
        todayIso: String = LocalDate.now().toString(),
    ): Map<UInt, String> =
        if (userIds.isEmpty()) emptyMap()
        else suspendTransaction(database) {
            Requests
                .select(Requests.userId, Requests.startDate)
                .where {
                    (Requests.userId inList userIds) and active() and
                        (Requests.status eq DaysOffStatus.ACCEPTED) and
                        (Requests.endDate greaterEq todayIso)
                }
                .map { it[Requests.userId].value to it[Requests.startDate] }
                .toList()
                .groupBy({ it.first }) { it.second }
                .mapValues { (_, starts) -> starts.min() }
        }

    /** Per user, the current remaining budget of the DEFAULT paid pool for [year] (v3.2.0 —
     * the card stat is a one-number summary, so it stays the default kind's; extra pools
     * surface on the drill-down) — the budgets math, keyed. Backs the managed-card stat only
     * (budgets stay manager/self-scoped). */
    suspend fun remainingByUserIds(userIds: Set<UInt>, year: Int): Map<UInt, Double> =
        defaultBudgets(userIds, year).associate { it.userId to it.remaining }

    /** True iff [callerId] is anywhere in [ownerId]'s transitive management chain — the read
     * right, and since v2.33.0 (the chain rule) also the resolve/record/correction/allowance
     * write rights. */
    suspend fun managesOwner(callerId: UInt, ownerId: UInt): Boolean =
        suspendTransaction(database) { isInManagementChain(callerId, ownerId) }

    /** True iff the two users share a non-deleted team — the team-calendar read right. */
    suspend fun sharesTeam(callerId: UInt, ownerId: UInt): Boolean =
        suspendTransaction(database) { ownerId in teamMemberPeers(callerId) }

    /** The caller's direct reports, for the budgets/calendar managed scopes (own transaction). */
    suspend fun directReports(callerId: UInt): Set<UInt> =
        suspendTransaction(database) { directSubordinateIds(callerId) }

    /** The caller's whole transitive subtree — the budgets managed scope under includeIndirect
     * (v2.32.0, own transaction). */
    suspend fun transitiveReports(callerId: UInt): Set<UInt> =
        suspendTransaction(database) { transitiveSubordinateIds(callerId) }

    // ── in-transaction helpers ──────────────────────────────────────────────────────────────

    /** Members of the non-deleted teams [userId] belongs to (the caller themselves included when
     * they are a member anywhere; empty for a team-less user). Runs in the caller's transaction. */
    private suspend fun teamMemberPeers(userId: UInt): Set<UInt> =
        membersOf(memberTeamIds(userId))

    private suspend fun holidaysOfYear(year: Int): Set<LocalDate> =
        PublicHolidayService.PublicHolidays
            .select(PublicHolidayService.PublicHolidays.holidayDate)
            .where {
                (PublicHolidayService.PublicHolidays.holidayDate greaterEq "$year-01-01") and
                    (PublicHolidayService.PublicHolidays.holidayDate lessEq "$year-12-31")
            }
            .map { LocalDate.parse(it[PublicHolidayService.PublicHolidays.holidayDate]) }
            .toList()
            .toSet()

    /** Year → summed half-day cost of [userId]'s counting PAID requests in ONE pool kind
     * (every year). */
    private suspend fun countingPaidCostsByYear(userId: UInt, poolTypeId: UInt): Map<Int, Int> =
        Requests
            .select(Requests.startDate, Requests.costHalfDays)
            .where {
                (Requests.userId eq userId) and active() and counting() and
                    (Requests.poolTypeId eq poolTypeId)
            }
            .map { it[Requests.startDate].substring(0, 4).toInt() to it[Requests.costHalfDays] }
            .toList()
            .groupBy({ it.first }) { it.second }
            .mapValues { (_, costs) -> costs.sum() }

    private fun expandEntries(
        row: ResultRow,
        monthStart: String,
        monthEnd: String,
        redactPool: Boolean = false,
    ): List<DaysOffCalendarEntry> {
        val start = row[Requests.startDate]
        val end = row[Requests.endDate]
        val from = LocalDate.parse(maxOf(start, monthStart))
        val to = LocalDate.parse(minOf(end, monthEnd))
        val entries = mutableListOf<DaysOffCalendarEntry>()
        var day = from
        while (day <= to) {
            val date = day.toString()
            entries += DaysOffCalendarEntry(
                requestId = row[Requests.id].value,
                date = date,
                type = row[Requests.type],
                poolName = if (redactPool) null else row.getOrNull(PoolTypes.name),
                status = row[Requests.status],
                half = (date == start && row[Requests.startHalf]) || (date == end && row[Requests.endHalf]),
            )
            day = day.plusDays(1)
        }
        return entries
    }

    private suspend fun userName(id: UInt): String = userNameOf(id) ?: "#$id"

    private fun joined() = Requests
        .join(
            ownerUsers,
            JoinType.INNER,
            onColumn = Requests.userId,
            otherColumn = ownerUsers[UserService.Users.id],
        )
        .join(
            cancelUsers,
            JoinType.LEFT,
            onColumn = Requests.cancelledBy,
            otherColumn = cancelUsers[UserService.Users.id],
        )
        // The pool kind's current name (v3.2.0) — LEFT: UNPAID rows have none; archived kinds
        // still label their history (no active filter on purpose).
        .join(PoolTypes, JoinType.LEFT, onColumn = Requests.poolTypeId, otherColumn = PoolTypes.id)

    private fun buildPredicate(filter: DaysOffListFilter): Op<Boolean> {
        var op: Op<Boolean> = Op.TRUE
        filter.userName?.takeIf { it.isNotBlank() }?.let {
            op = op and (ownerUsers[UserService.Users.name].containsNormalized(it))
        }
        filter.userId?.let { op = op and (Requests.userId eq it) }
        filter.type?.let { op = op and (Requests.type eq it) }
        filter.poolTypeId?.let { op = op and (Requests.poolTypeId eq it) }
        filter.status?.let { op = op and (Requests.status eq it) }
        filter.startDateGte?.let { op = op and (Requests.startDate greaterEq it) }
        filter.startDateLte?.let { op = op and (Requests.startDate lessEq it) }
        return op
    }
}
