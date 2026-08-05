package ch.nokillswit.daysoff

import ch.nokillswit.authz.ConflictException
import ch.nokillswit.infra.db.containsPattern
import ch.nokillswit.infra.paging.PageRequest
import ch.nokillswit.infra.paging.applyPaging
import ch.nokillswit.notifications.Notification
import ch.nokillswit.teams.TeamService
import ch.nokillswit.teams.directManagerIds
import ch.nokillswit.teams.directSubordinateIds
import ch.nokillswit.teams.isInManagementChain
import ch.nokillswit.users.UserService
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
    val status: DaysOffStatus? = null,
    val startDateGte: String? = null,
    val startDateLte: String? = null,
)

data class DaysOffListResult(
    val items: List<DaysOffListItem>,
    val total: Long,
)

private val ownerUsers = UserService.Users.alias("owner_users")

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
 * Days-off requests (see V40) and their budget corrections (V42). Request rows carry no free
 * text and stay plaintext; the correction COMMENT is encrypted at rest (the 1:1-notes pattern —
 * the cipher wraps every write and unwraps every read; never filter/sort on it in SQL). Request
 * dates and costs are immutable after create; only the status (and its resolution/cancellation
 * stamps) ever changes.
 */
class DaysOffService(val database: R2dbcDatabase, private val cipher: ch.nokillswit.infra.crypto.FieldCipher) {
    object Requests : org.jetbrains.exposed.v1.core.dao.id.UIntIdTable("days_off_requests") {
        val userId = reference("user_id", UserService.Users)
        val type = enumerationByName("type", 10, DaysOffType::class)
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
        val lastModified = long("last_modified")
        val markedAsDeleted = bool("marked_as_deleted").default(false)
    }

    object Corrections : org.jetbrains.exposed.v1.core.dao.id.UIntIdTable("days_off_corrections") {
        val userId = reference("user_id", UserService.Users)
        val authorId = reference("author_id", UserService.Users)
        val year = integer("year")
        val amountHalfDays = integer("amount_half_days")
        val comment = text("comment")
        val createdAt = long("created_at")
        val lastModified = long("last_modified")
        val markedAsDeleted = bool("marked_as_deleted").default(false)
    }

    private fun active(): Op<Boolean> = Requests.markedAsDeleted eq false

    private fun correctionActive(): Op<Boolean> = Corrections.markedAsDeleted eq false

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
     */
    suspend fun create(userId: UInt, request: DaysOffCreateRequest): Pair<UInt, List<Notification>> =
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
            if (request.type == DaysOffType.PAID) {
                val allowance = allowanceOf(userId)
                val corrections = correctionsByYear(userId)
                val usedByYear = countingPaidCostsByYear(userId).toMutableMap()
                usedByYear[year] = (usedByYear[year] ?: 0) + cost
                val lastYear = maxOf(usedByYear.keys.max(), year)
                for (y in year..lastYear) {
                    if (remainingHalfDays(allowance, y, usedByYear, corrections) < 0) {
                        throw ConflictException("Insufficient paid days-off budget for year $y")
                    }
                }
            }
            val now = System.currentTimeMillis()
            val id = Requests.insert {
                it[this.userId] = userId
                it[type] = request.type
                it[status] = DaysOffStatus.REQUESTED
                it[startDate] = request.startDate
                it[endDate] = request.endDate
                it[startHalf] = request.startHalf
                it[endHalf] = request.endHalf
                it[costHalfDays] = cost
                it[createdAt] = now
                it[lastModified] = now
            }[Requests.id].value
            val notifications = daysOffRequestedNotifications(
                managerIds = directManagerIds(userId),
                requesterName = userName(userId),
                type = request.type,
                days = formatHalfDaysParam(cost),
                startDate = request.startDate,
                endDate = request.endDate,
            )
            id to notifications
        }

    suspend fun read(id: UInt): DaysOffResponse? = suspendTransaction(database) {
        val row = joined()
            .selectAll()
            .where { (Requests.id eq id) and active() }
            .map { it }
            .singleOrNull()
            ?: return@suspendTransaction null
        val resolvedById = row[Requests.resolvedBy]?.value
        DaysOffResponse(
            id = row[Requests.id].value,
            userId = row[Requests.userId].value,
            userName = row[ownerUsers[UserService.Users.name]],
            type = row[Requests.type],
            status = row[Requests.status],
            startDate = row[Requests.startDate],
            endDate = row[Requests.endDate],
            startHalf = row[Requests.startHalf],
            endHalf = row[Requests.endHalf],
            days = row[Requests.costHalfDays] / 2.0,
            createdAt = row[Requests.createdAt],
            resolvedById = resolvedById,
            // One extra lookup only when resolved — spares the read path a second user join.
            resolvedByName = resolvedById?.let { userName(it) },
            resolvedAt = row[Requests.resolvedAt],
            cancelledAt = row[Requests.cancelledAt],
            lastModified = row[Requests.lastModified],
        )
    }

    /**
     * Moves a request to [target], atomically with its state checks; the route has already
     * authorized the actor (direct manager for ACCEPTED/REJECTED, the owner for CANCELLED).
     * Accept/reject require REQUESTED and stamp the resolver; cancel is valid from REQUESTED
     * anytime and from ACCEPTED only while [today] is strictly before the start date (the goals
     * injectable-today idiom). Anything else is [ConflictException] (→ 409). Returns the
     * notifications to persist, or null when the row is missing (→ 404).
     */
    suspend fun transition(
        id: UInt,
        actorId: UInt,
        target: DaysOffStatus,
        today: LocalDate = LocalDate.now(),
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
            DaysOffStatus.CANCELLED -> {
                val recipients: Set<UInt> = when (status) {
                    // Still pending: everyone who was asked to review it hears it's off the table.
                    DaysOffStatus.REQUESTED -> directManagerIds(ownerId)
                    DaysOffStatus.ACCEPTED -> {
                        if (LocalDate.parse(startDate) <= today) {
                            throw ConflictException(
                                "An accepted days-off request may only be cancelled before its start date",
                            )
                        }
                        setOfNotNull(row[Requests.resolvedBy]?.value)
                    }
                    else -> throw ConflictException("Invalid status transition: $status -> CANCELLED")
                }
                Requests.update({ (Requests.id eq id) and (Requests.markedAsDeleted eq false) }) {
                    it[this.status] = DaysOffStatus.CANCELLED
                    it[cancelledAt] = now
                    it[lastModified] = now
                }
                daysOffCancelledNotifications(recipients, userName(ownerId), startDate, endDate)
            }
            else -> error("Not a transition target: $target")
        }
    }

    suspend fun list(
        view: DaysOffListView,
        callerUserId: UInt,
        filter: DaysOffListFilter,
        paging: PageRequest,
        targetUserId: UInt? = null,
    ): DaysOffListResult = suspendTransaction(database) {
        val scope: Op<Boolean> = when (view) {
            DaysOffListView.OWN -> Requests.userId eq callerUserId
            // Direct reports only — matching the resolve right, so every row's action buttons
            // are valid; chain managers still read singles via the guard (a list scope, not an
            // authorization boundary).
            DaysOffListView.MANAGED -> {
                val reports = directSubordinateIds(callerUserId)
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
                Requests.status,
                Requests.startDate,
                Requests.endDate,
                Requests.startHalf,
                Requests.endHalf,
                Requests.costHalfDays,
                Requests.createdAt,
                Requests.lastModified,
                ownerUsers[UserService.Users.name],
                ownerUsers[UserService.Users.markedAsDeleted],
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
                    status = row[Requests.status],
                    startDate = row[Requests.startDate],
                    endDate = row[Requests.endDate],
                    startHalf = row[Requests.startHalf],
                    endHalf = row[Requests.endHalf],
                    days = row[Requests.costHalfDays] / 2.0,
                    createdAt = row[Requests.createdAt],
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
                .select(
                    Requests.id, Requests.userId, Requests.type, Requests.status,
                    Requests.startDate, Requests.endDate, Requests.startHalf, Requests.endHalf,
                )
                .where {
                    (Requests.userId inList userIds) and active() and counting() and
                        (Requests.startDate lessEq monthEnd) and (Requests.endDate greaterEq monthStart)
                }
                .map { it }
                .toList()
                .groupBy({ it[Requests.userId].value }) { row ->
                    expandEntries(row, monthStart, monthEnd)
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
     * One budget row per user in [userIds] for [year] (see [DaysOffBudget]): the closed-form
     * carry-over over the user's counting PAID requests up to [year] (one fetch, grouped in
     * Kotlin — no SQL arithmetic on R2DBC), split into the year's reserved (REQUESTED) and used
     * (ACCEPTED) days. Users without any requests still get a row. Sorted by name.
     */
    suspend fun budgets(userIds: Set<UInt>, year: Int): List<DaysOffBudget> = suspendTransaction(database) {
        if (userIds.isEmpty()) return@suspendTransaction emptyList()
        data class CountingRow(val year: Int, val status: DaysOffStatus, val costH: Int)
        val rowsByUser: Map<UInt, List<CountingRow>> = Requests
            .select(Requests.userId, Requests.startDate, Requests.status, Requests.costHalfDays)
            .where {
                (Requests.userId inList userIds) and active() and counting() and
                    (Requests.type eq DaysOffType.PAID) and
                    (Requests.startDate lessEq "$year-12-31")
            }
            .map { it }
            .toList()
            .groupBy({ it[Requests.userId].value }) { row ->
                CountingRow(
                    // Same-year requests (app-enforced), so the start date names the budget year.
                    year = row[Requests.startDate].substring(0, 4).toInt(),
                    status = row[Requests.status],
                    costH = row[Requests.costHalfDays],
                )
            }
        // One grouped fetch of the whole set's active corrections (no year cap — the anchor
        // may sit before [year], and later ones never enter the filtered sums anyway).
        val correctionsByUser: Map<UInt, Map<Int, Int>> = Corrections
            .select(Corrections.userId, Corrections.year, Corrections.amountHalfDays)
            .where { (Corrections.userId inList userIds) and correctionActive() }
            .map { it }
            .toList()
            .groupBy { it[Corrections.userId].value }
            .mapValues { (_, rows) ->
                rows.groupBy({ it[Corrections.year] }) { it[Corrections.amountHalfDays] }
                    .mapValues { (_, amounts) -> amounts.sum() }
            }
        UserService.Users
            .select(
                UserService.Users.id,
                UserService.Users.name,
                UserService.Users.markedAsDeleted,
                UserService.Users.paidDaysOffAllowance,
            )
            .where { UserService.Users.id inList userIds }
            .orderBy(UserService.Users.name to SortOrder.ASC, UserService.Users.id to SortOrder.ASC)
            .map { row ->
                val userId = row[UserService.Users.id].value
                val allowance = row[UserService.Users.paidDaysOffAllowance]
                val countingRows = rowsByUser[userId] ?: emptyList()
                val usedByYear = countingRows.groupBy { it.year }.mapValues { (_, r) -> r.sumOf { it.costH } }
                val corrections = correctionsByUser[userId] ?: emptyMap()
                val reservedH = countingRows.filter { it.year == year && it.status == DaysOffStatus.REQUESTED }
                    .sumOf { it.costH }
                val usedH = countingRows.filter { it.year == year && it.status == DaysOffStatus.ACCEPTED }
                    .sumOf { it.costH }
                DaysOffBudget(
                    userId = userId,
                    userName = row[UserService.Users.name],
                    userDeleted = row[UserService.Users.markedAsDeleted],
                    year = year,
                    allowance = allowance,
                    carriedOver = carriedOverHalfDays(allowance, year, usedByYear, corrections) / 2.0,
                    corrected = (corrections[year] ?: 0) / 2.0,
                    reserved = reservedH / 2.0,
                    used = usedH / 2.0,
                    remaining = remainingHalfDays(allowance, year, usedByYear, corrections) / 2.0,
                )
            }
            .toList()
    }

    // ── Budget corrections (v1.43.0) ────────────────────────────────────────────────────────

    /** The user's active corrections, newest year (then newest row) first, author joined. */
    suspend fun listCorrections(userId: UInt, year: Int? = null): List<DaysOffCorrectionResponse> =
        suspendTransaction(database) {
            var predicate: Op<Boolean> = (Corrections.userId eq userId) and correctionActive()
            year?.let { predicate = predicate and (Corrections.year eq it) }
            Corrections
                .join(
                    ownerUsers,
                    JoinType.INNER,
                    onColumn = Corrections.authorId,
                    otherColumn = ownerUsers[UserService.Users.id],
                )
                .selectAll()
                .where { predicate }
                .orderBy(Corrections.year to SortOrder.DESC, Corrections.id to SortOrder.DESC)
                .map { it.toCorrection() }
                .toList()
        }

    suspend fun readCorrection(id: UInt): DaysOffCorrectionResponse? = suspendTransaction(database) {
        Corrections
            .join(
                ownerUsers,
                JoinType.INNER,
                onColumn = Corrections.authorId,
                otherColumn = ownerUsers[UserService.Users.id],
            )
            .selectAll()
            .where { (Corrections.id eq id) and correctionActive() }
            .map { it.toCorrection() }
            .singleOrNull()
    }

    /** Inserts a correction (shape pre-validated by the route; no budget gate — a SUBTRACT may
     * push a year negative, the allowance-cut precedent) and returns the id plus the owner's
     * notification. */
    suspend fun createCorrection(authorId: UInt, write: DaysOffCorrectionWrite): Pair<UInt, Notification> =
        suspendTransaction(database) {
            val now = System.currentTimeMillis()
            val id = Corrections.insert {
                it[userId] = write.userId
                it[this.authorId] = authorId
                it[year] = write.year
                it[amountHalfDays] = correctionHalfDays(write)
                it[comment] = cipher.encrypt(write.comment)
                it[createdAt] = now
                it[lastModified] = now
            }[Corrections.id].value
            id to daysOffCorrectionNotification(
                ownerId = write.userId,
                managerName = userName(authorId),
                year = write.year,
                operation = write.operation,
                days = formatHalfDaysParam((write.days * 2).toInt()),
            )
        }

    /** Updates a correction's year/amount/comment (the target user is immutable — [write]'s
     * userId is ignored here; the route guards against the ROW's user). 0 → missing → 404. */
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

    /** Year → summed SIGNED half-day corrections of [userId]. Runs in the caller's transaction. */
    private suspend fun correctionsByYear(userId: UInt): Map<Int, Int> =
        Corrections
            .select(Corrections.year, Corrections.amountHalfDays)
            .where { (Corrections.userId eq userId) and correctionActive() }
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
    suspend fun encryptLegacyRows(reencryptAll: Boolean = false): Int = suspendTransaction(database) {
        val enveloped = "${ch.nokillswit.infra.crypto.FieldCipher.PREFIX}%"
        val rows = Corrections
            .select(Corrections.id, Corrections.comment)
            .where { if (reencryptAll) Op.TRUE else Corrections.comment notLike enveloped }
            .map { it[Corrections.id] to it[Corrections.comment] }
            .toList()
        rows.forEach { (id, comment) ->
            Corrections.update({ Corrections.id eq id }) {
                it[this.comment] = cipher.encrypt(cipher.decrypt(comment))
            }
        }
        rows.size
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

    /** Per user, the current remaining paid-days budget for [year] — the budgets math, keyed.
     * Backs the managed-card stat only (budgets stay manager/self-scoped). */
    suspend fun remainingByUserIds(userIds: Set<UInt>, year: Int): Map<UInt, Double> =
        budgets(userIds, year).associate { it.userId to it.remaining }

    /** True iff [callerId] is currently a direct manager of [ownerId] — the resolve right. */
    suspend fun isDirectManagerOf(callerId: UInt, ownerId: UInt): Boolean =
        suspendTransaction(database) { callerId in directManagerIds(ownerId) }

    /** True iff [callerId] is anywhere in [ownerId]'s transitive management chain — the read right. */
    suspend fun managesOwner(callerId: UInt, ownerId: UInt): Boolean =
        suspendTransaction(database) { isInManagementChain(callerId, ownerId) }

    /** True iff the two users share a non-deleted team — the team-calendar read right. */
    suspend fun sharesTeam(callerId: UInt, ownerId: UInt): Boolean =
        suspendTransaction(database) { ownerId in teamMemberPeers(callerId) }

    /** The caller's direct reports, for the budgets/calendar managed scopes (own transaction). */
    suspend fun directReports(callerId: UInt): Set<UInt> =
        suspendTransaction(database) { directSubordinateIds(callerId) }

    // ── in-transaction helpers ──────────────────────────────────────────────────────────────

    /** Members of the non-deleted teams [userId] belongs to (the caller themselves included when
     * they are a member anywhere; empty for a team-less user). Runs in the caller's transaction. */
    private suspend fun teamMemberPeers(userId: UInt): Set<UInt> {
        val myTeams = TeamService.TeamMembers
            .join(
                TeamService.Teams,
                JoinType.INNER,
                onColumn = TeamService.TeamMembers.teamId,
                otherColumn = TeamService.Teams.id,
            )
            .select(TeamService.TeamMembers.teamId)
            .where {
                (TeamService.TeamMembers.userId eq userId) and
                    (TeamService.Teams.markedAsDeleted eq false)
            }
            .map { it[TeamService.TeamMembers.teamId].value }
            .toList()
            .toSet()
        if (myTeams.isEmpty()) return emptySet()
        return TeamService.TeamMembers
            .select(TeamService.TeamMembers.userId)
            .where { TeamService.TeamMembers.teamId inList myTeams }
            .map { it[TeamService.TeamMembers.userId].value }
            .toList()
            .toSet()
    }

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

    private suspend fun allowanceOf(userId: UInt): Int? =
        UserService.Users
            .select(UserService.Users.paidDaysOffAllowance)
            .where { UserService.Users.id eq userId }
            .map { it[UserService.Users.paidDaysOffAllowance] }
            .singleOrNull()

    /** Year → summed half-day cost of [userId]'s counting PAID requests (every year). */
    private suspend fun countingPaidCostsByYear(userId: UInt): Map<Int, Int> =
        Requests
            .select(Requests.startDate, Requests.costHalfDays)
            .where {
                (Requests.userId eq userId) and active() and counting() and
                    (Requests.type eq DaysOffType.PAID)
            }
            .map { it[Requests.startDate].substring(0, 4).toInt() to it[Requests.costHalfDays] }
            .toList()
            .groupBy({ it.first }) { it.second }
            .mapValues { (_, costs) -> costs.sum() }

    private fun expandEntries(row: ResultRow, monthStart: String, monthEnd: String): List<DaysOffCalendarEntry> {
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
                status = row[Requests.status],
                half = (date == start && row[Requests.startHalf]) || (date == end && row[Requests.endHalf]),
            )
            day = day.plusDays(1)
        }
        return entries
    }

    private suspend fun userName(id: UInt): String =
        UserService.Users
            .select(UserService.Users.name)
            .where { UserService.Users.id eq id }
            .map { it[UserService.Users.name] }
            .singleOrNull() ?: "#$id"

    private fun joined() = Requests
        .join(
            ownerUsers,
            JoinType.INNER,
            onColumn = Requests.userId,
            otherColumn = ownerUsers[UserService.Users.id],
        )

    private fun buildPredicate(filter: DaysOffListFilter): Op<Boolean> {
        var op: Op<Boolean> = Op.TRUE
        filter.userName?.takeIf { it.isNotBlank() }?.let {
            op = op and (ownerUsers[UserService.Users.name].lowerCase() like containsPattern(it))
        }
        filter.userId?.let { op = op and (Requests.userId eq it) }
        filter.type?.let { op = op and (Requests.type eq it) }
        filter.status?.let { op = op and (Requests.status eq it) }
        filter.startDateGte?.let { op = op and (Requests.startDate greaterEq it) }
        filter.startDateLte?.let { op = op and (Requests.startDate lessEq it) }
        return op
    }
}
