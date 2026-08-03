package ch.nokillswit.reviews

import ch.nokillswit.authz.ConflictException
import io.ktor.server.plugins.BadRequestException
import ch.nokillswit.infra.crypto.FieldCipher
import ch.nokillswit.infra.db.containsPattern
import ch.nokillswit.infra.paging.PageRequest
import ch.nokillswit.infra.paging.applyPaging
import ch.nokillswit.notifications.Notification
import ch.nokillswit.teams.directSubordinateIds
import ch.nokillswit.teams.isInManagementChain
import ch.nokillswit.teams.transitiveSubordinateIds
import ch.nokillswit.users.UserService
import io.ktor.util.AttributeKey
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.singleOrNull
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.core.dao.id.UIntIdTable
import org.jetbrains.exposed.v1.r2dbc.*
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction

val PerformanceReviewServiceKey = AttributeKey<PerformanceReviewService>("PerformanceReviewService")

enum class PerformanceReviewListView { OWN, MANAGED, TEAM, USER }

data class PerformanceReviewListFilter(
    val managerName: String? = null,
    val subordinateName: String? = null,
    val managerId: UInt? = null,
    val subordinateId: UInt? = null,
    val periodId: UInt? = null,
    val status: PerformanceReviewStatus? = null,
    val createdAtGte: Long? = null,
    val lastModifiedGte: Long? = null,
)

data class PerformanceReviewListResult(
    val items: List<PerformanceReviewListItem>,
    val total: Long,
)

/** A manager's latest authored review for one subordinate — see [PerformanceReviewService.latestReviewsBySubordinate]. */
data class LatestReviewStats(
    val reviewId: UInt,
    val periodStartMonth: String,
    val periodEndMonth: String,
    val status: PerformanceReviewStatus,
)

private val managerUsers = UserService.Users.alias("manager_users")
private val subordinateUsers = UserService.Users.alias("subordinate_users")

private val SORTABLE_COLUMNS: Map<String, Column<*>> = mapOf(
    "id" to PerformanceReviewService.Reviews.id,
    "managerName" to managerUsers[UserService.Users.name],
    "subordinateName" to subordinateUsers[UserService.Users.name],
    // ISO YYYY-MM in a VARCHAR: lexicographic == chronological, so a plain column sort works.
    "periodStart" to ReviewPeriodService.ReviewPeriods.startMonth,
    "status" to PerformanceReviewService.Reviews.status,
    "createdAt" to PerformanceReviewService.Reviews.createdAt,
    "lastModified" to PerformanceReviewService.Reviews.lastModified,
)

// The four summary columns are encrypted at rest (see infra/crypto/FieldCipher.kt): the cipher
// wraps every write and unwraps every read, so nothing above this service ever sees ciphertext.
// No summary column is filtered/sorted/searched in SQL, so queries are unaffected; the numeric
// ratings stay plaintext on purpose — list rows carry them and calculations run on them.
class PerformanceReviewService(val database: R2dbcDatabase, private val cipher: FieldCipher) {
    object Reviews : UIntIdTable("performance_reviews") {
        val managerId = reference("manager_id", UserService.Users)
        val subordinateId = reference("subordinate_id", UserService.Users)
        val periodId = reference("period_id", ReviewPeriodService.ReviewPeriods)
        val createdAt = long("created_at")
        val status = enumerationByName("status", 20, PerformanceReviewStatus::class)
        val attitudeRating = short("attitude_rating").nullable()
        val attitudeSummary = text("attitude_summary").nullable()
        val deliveryRating = short("delivery_rating").nullable()
        val deliverySummary = text("delivery_summary").nullable()
        val skillsRating = short("skills_rating").nullable()
        val skillsSummary = text("skills_summary").nullable()
        val overallRating = short("overall_rating").nullable()
        val overallSummary = text("overall_summary").nullable()
        val lastModified = long("last_modified")
        val markedAsDeleted = bool("marked_as_deleted").default(false)
    }

    private fun active(): Op<Boolean> = Reviews.markedAsDeleted eq false

    /**
     * Inserts a new review, always in DRAFT status, possibly with partial assessments. The route
     * has already verified the manager→subordinate relationship; the assessment field rules are
     * validated here, the chosen period must have **started** ([currentMonth] defaults to the
     * server-local month and is injectable for tests, the goals `today` idiom — a fully-future
     * period is not assessable yet, 400), and the one-review-per-(subordinate, period) invariant
     * is pre-checked in the same transaction — a hit throws [ConflictException] whose instance
     * points at the existing review (the partial unique index backstops a racing create via
     * 23505 → 409). Returns the new id.
     */
    suspend fun create(
        managerId: UInt,
        request: PerformanceReviewCreateRequest,
        currentMonth: String = java.time.YearMonth.now().toString(),
    ): UInt =
        suspendTransaction(database) {
            validateAssessments(assessmentsOf(request))
            // ISO YYYY-MM in a VARCHAR: lexicographic > is a chronological compare. An unknown
            // periodId is caught by the route's requireValidReferences (FK) — the singleOrNull
            // here only guards the race between that check and this transaction.
            val periodStart = ReviewPeriodService.ReviewPeriods
                .select(ReviewPeriodService.ReviewPeriods.startMonth)
                .where { ReviewPeriodService.ReviewPeriods.id eq request.periodId }
                .map { it[ReviewPeriodService.ReviewPeriods.startMonth] }
                .singleOrNull()
                ?: throw BadRequestException("Referenced period does not exist")
            if (periodStart > currentMonth) {
                throw BadRequestException(
                    "A review cannot be created for a period that has not started yet",
                )
            }
            val existingId = Reviews.select(Reviews.id)
                .where {
                    (Reviews.subordinateId eq request.subordinateId) and
                        (Reviews.periodId eq request.periodId) and active()
                }
                .map { it[Reviews.id].value }
                .singleOrNull()
            if (existingId != null) {
                throw ConflictException(
                    "A performance review for this subordinate and period already exists",
                    instance = "/api/v1/performance-reviews/$existingId",
                )
            }
            val now = System.currentTimeMillis()
            Reviews.insert {
                it[this.managerId] = managerId
                it[subordinateId] = request.subordinateId
                it[periodId] = request.periodId
                it[createdAt] = now
                it[status] = PerformanceReviewStatus.DRAFT
                writeAssessments(it, assessmentsOf(request))
                it[lastModified] = now
            }[Reviews.id].value
        }

    suspend fun read(id: UInt): PerformanceReviewResponse? = suspendTransaction(database) {
        joined()
            .selectAll()
            .where { (Reviews.id eq id) and active() }
            .map { it.toResponse() }
            .singleOrNull()
    }

    /**
     * Replaces the eight assessment values (never parties, period, or status). Accepted while
     * DRAFT or CALIBRATION; in CALIBRATION the payload must additionally be complete — a value
     * may change but never blank out. PUBLISHED (read-only) throws [ConflictException] (→ 409).
     * All checks run atomically with the update. Returns the affected-row count (0 →
     * missing/deleted, mapped to 404 by the route).
     */
    suspend fun update(id: UInt, request: PerformanceReviewUpdateRequest): Int =
        suspendTransaction(database) {
            val currentStatus = Reviews.select(Reviews.status)
                .where { (Reviews.id eq id) and active() }
                .map { it[Reviews.status] }
                .singleOrNull()
                ?: return@suspendTransaction 0
            if (currentStatus == PerformanceReviewStatus.PUBLISHED) {
                throw ConflictException("A published review is read-only")
            }
            val assessments = assessmentsOf(request)
            validateAssessments(assessments)
            if (currentStatus == PerformanceReviewStatus.CALIBRATION) {
                requireCompleteAssessments(assessments)
            }
            Reviews.update({ (Reviews.id eq id) and (Reviews.markedAsDeleted eq false) }) {
                writeAssessments(it, assessments)
                it[lastModified] = System.currentTimeMillis()
            }
        }

    /**
     * Moves a review [from] one status to [target] via the status state machine (DRAFT <->
     * CALIBRATION <-> PUBLISHED, never skipping CALIBRATION) and returns the notifications the
     * transition should produce (the caller persists them). Each action endpoint names its whole
     * edge — [from] as well as [target] — because submit and unpublish share the CALIBRATION
     * target and would otherwise be interchangeable. The DRAFT→CALIBRATION completeness gate is
     * checked by the route against its pre-read (the goals activate idiom). Returns null when
     * the row is missing (→ 404); throws [ConflictException] (→ 409) when the review is not at
     * [from].
     */
    suspend fun transition(
        id: UInt,
        from: PerformanceReviewStatus,
        target: PerformanceReviewStatus,
    ): List<Notification>? = suspendTransaction(database) {
        val current = (Reviews innerJoin ReviewPeriodService.ReviewPeriods)
            .selectAll()
            .where { (Reviews.id eq id) and active() }
            .map { it.toTransitionRow() }
            .singleOrNull()
            ?: return@suspendTransaction null
        if (current.status != from) {
            throw ConflictException("Invalid status transition: ${current.status} -> $target")
        }
        Reviews.update({ (Reviews.id eq id) and (Reviews.markedAsDeleted eq false) }) {
            it[status] = target
            it[lastModified] = System.currentTimeMillis()
        }
        reviewTransitionNotifications(
            reviewId = id,
            from = current.status,
            to = target,
            subordinateId = current.subordinateId,
            managerName = userName(current.managerId),
            periodStartMonth = current.periodStartMonth,
            periodEndMonth = current.periodEndMonth,
        )
    }

    suspend fun delete(id: UInt): Int = suspendTransaction(database) {
        Reviews.update({ (Reviews.id eq id) and (Reviews.markedAsDeleted eq false) }) {
            it[markedAsDeleted] = true
        }
    }

    suspend fun list(
        view: PerformanceReviewListView,
        callerUserId: UInt,
        filter: PerformanceReviewListFilter,
        paging: PageRequest,
        includeIndirect: Boolean = false,
        targetUserId: UInt? = null,
    ): PerformanceReviewListResult = suspendTransaction(database) {
        val scope: Op<Boolean> = when (view) {
            // The subordinate's own list: PUBLISHED only — mirroring the single-GET rule, so
            // every listed row is also openable (a review in progress is invisible to them).
            PerformanceReviewListView.OWN ->
                (Reviews.subordinateId eq callerUserId) and
                    (Reviews.status eq PerformanceReviewStatus.PUBLISHED)
            PerformanceReviewListView.USER -> {
                // Auditor view (HR-only, gated route-side via requireAuditListAccess): every
                // review the target is a party to, at every status — DRAFTs included, unlike
                // the chain views below. The route guarantees a non-null userId.
                val target = requireNotNull(targetUserId) { "view=user requires userId" }
                (Reviews.managerId eq target) or (Reviews.subordinateId eq target)
            }
            PerformanceReviewListView.MANAGED ->
                if (!includeIndirect) {
                    Reviews.managerId eq callerUserId
                } else {
                    // The widened scope: the caller's own reviews at any status, plus reviews
                    // authored by managers in their transitive chain — whose DRAFTs stay hidden
                    // (the single-GET's chain rule), so every listed row is openable.
                    val chain = transitiveSubordinateIds(callerUserId)
                    if (chain.isEmpty()) {
                        Reviews.managerId eq callerUserId
                    } else {
                        (Reviews.managerId eq callerUserId) or
                            (
                                (Reviews.managerId inList chain) and
                                    (Reviews.status neq PerformanceReviewStatus.DRAFT)
                            )
                    }
                }
            PerformanceReviewListView.TEAM -> {
                // Reviews authored by the caller's direct reports (as managers), widened by
                // includeIndirect to the transitive chain. DRAFTs are excluded — they stay
                // private to the author, mirroring requirePerformanceReviewReadAllowingManager's
                // chain rule (the subordinate of such a review is always in the caller's
                // transitive chain, so every listed row is also openable).
                val subordinateIds =
                    if (includeIndirect) transitiveSubordinateIds(callerUserId)
                    else directSubordinateIds(callerUserId)
                if (subordinateIds.isEmpty()) {
                    Op.FALSE
                } else {
                    (Reviews.managerId inList subordinateIds) and
                        (Reviews.status neq PerformanceReviewStatus.DRAFT)
                }
            }
        }
        val predicate: Op<Boolean> = scope and buildPredicate(filter) and active()
        val join = joined()
        val total = join.selectAll().where { predicate }.count()
        val rows = join
            .select(
                Reviews.id,
                Reviews.managerId,
                Reviews.subordinateId,
                Reviews.periodId,
                Reviews.status,
                Reviews.attitudeRating,
                Reviews.deliveryRating,
                Reviews.skillsRating,
                Reviews.overallRating,
                Reviews.createdAt,
                Reviews.lastModified,
                managerUsers[UserService.Users.name],
                managerUsers[UserService.Users.markedAsDeleted],
                subordinateUsers[UserService.Users.name],
                subordinateUsers[UserService.Users.markedAsDeleted],
                ReviewPeriodService.ReviewPeriods.startMonth,
                ReviewPeriodService.ReviewPeriods.endMonth,
            )
            .where { predicate }
            .applyPaging(paging, SORTABLE_COLUMNS)
            .map { row ->
                PerformanceReviewListItem(
                    id = row[Reviews.id].value,
                    managerId = row[Reviews.managerId].value,
                    managerName = row[managerUsers[UserService.Users.name]],
                    managerDeleted = row[managerUsers[UserService.Users.markedAsDeleted]],
                    subordinateId = row[Reviews.subordinateId].value,
                    subordinateName = row[subordinateUsers[UserService.Users.name]],
                    subordinateDeleted = row[subordinateUsers[UserService.Users.markedAsDeleted]],
                    periodId = row[Reviews.periodId].value,
                    periodStartMonth = row[ReviewPeriodService.ReviewPeriods.startMonth],
                    periodEndMonth = row[ReviewPeriodService.ReviewPeriods.endMonth],
                    status = row[Reviews.status],
                    attitudeRating = row[Reviews.attitudeRating]?.toInt(),
                    deliveryRating = row[Reviews.deliveryRating]?.toInt(),
                    skillsRating = row[Reviews.skillsRating]?.toInt(),
                    overallRating = row[Reviews.overallRating]?.toInt(),
                    createdAt = row[Reviews.createdAt],
                    lastModified = row[Reviews.lastModified],
                )
            }
            .toList()
        PerformanceReviewListResult(items = rows, total = total)
    }

    /**
     * For each subordinate in [subordinateIds], the latest (by period, newest first) non-deleted
     * review [managerId] authored about them — at ANY status: the caller wrote it, so DRAFTs
     * count, matching the card's other author-side stats (last feedback, active goals) and the
     * card's `view=managed` drill-down. Subordinates with no such review are absent from the
     * map. Only the id/period/status travel — nothing is decrypted.
     */
    suspend fun latestReviewsBySubordinate(
        managerId: UInt,
        subordinateIds: Set<UInt>,
    ): Map<UInt, LatestReviewStats> =
        if (subordinateIds.isEmpty()) emptyMap()
        else suspendTransaction(database) {
            // One indexed limit-1 lookup per key (the 1:1 stats idiom in OneOnOneService): the
            // set is one page of dashboard cards — a handful — so no multi-group SQL.
            val periods = ReviewPeriodService.ReviewPeriods
            val stats = mutableMapOf<UInt, LatestReviewStats>()
            subordinateIds.forEach { subordinateId ->
                Reviews
                    .join(periods, JoinType.INNER, onColumn = Reviews.periodId, otherColumn = periods.id)
                    .select(Reviews.id, periods.startMonth, periods.endMonth, Reviews.status)
                    .where {
                        (Reviews.managerId eq managerId) and
                            (Reviews.subordinateId eq subordinateId) and active()
                    }
                    // ISO YYYY-MM sorts lexicographically == chronologically; id breaks the
                    // (impossible-by-uniqueness, but cheap) tie.
                    .orderBy(periods.startMonth to SortOrder.DESC, Reviews.id to SortOrder.DESC)
                    .limit(1)
                    .map {
                        LatestReviewStats(
                            reviewId = it[Reviews.id].value,
                            periodStartMonth = it[periods.startMonth],
                            periodEndMonth = it[periods.endMonth],
                            status = it[Reviews.status],
                        )
                    }
                    .singleOrNull()
                    ?.let { stats[subordinateId] = it }
            }
            stats
        }

    /** True iff [subordinateId] is currently a member of a non-deleted team [managerId] manages. */
    suspend fun isDirectReport(managerId: UInt, subordinateId: UInt): Boolean =
        suspendTransaction(database) { subordinateId in directSubordinateIds(managerId) }

    /**
     * True iff [managerId] is in [subordinateId]'s management chain — backs
     * [ch.nokillswit.authz.requirePerformanceReviewReadAllowingManager]'s lazy chain check; the
     * walk itself lives in teams/ManagementChain.kt and is shared with the sibling features.
     */
    suspend fun managesSubordinate(managerId: UInt, subordinateId: UInt): Boolean =
        suspendTransaction(database) { isInManagementChain(managerId, subordinateId) }

    /**
     * Startup backfill (see infra/db/Bootstrap.kt): encrypts summary values still holding legacy
     * plaintext — including soft-deleted rows. With [reencryptAll] (set during key rotation)
     * every row is decrypted (current or previous key) and rewritten under the current key.
     * Idempotent; returns the rewritten count.
     */
    suspend fun encryptLegacyRows(reencryptAll: Boolean = false): Int = suspendTransaction(database) {
        val enveloped = "${FieldCipher.PREFIX}%"
        val summaryColumns = listOf(
            Reviews.attitudeSummary, Reviews.deliverySummary,
            Reviews.skillsSummary, Reviews.overallSummary,
        )
        val legacyOnly = summaryColumns
            .map { column -> column.isNotNull() and (column notLike enveloped) }
            .reduce<Op<Boolean>, Op<Boolean>> { acc, op -> acc or op }
        val rows = Reviews
            .select(listOf(Reviews.id) + summaryColumns)
            .where { if (reencryptAll) Op.TRUE else legacyOnly }
            .toList()
        rows.forEach { row ->
            Reviews.update({ Reviews.id eq row[Reviews.id] }) { statement ->
                summaryColumns.forEach { column ->
                    statement[column] = row[column]?.let { s -> cipher.encrypt(cipher.decrypt(s)) }
                }
            }
        }
        rows.size
    }

    private fun joined() = Reviews
        .join(
            managerUsers,
            JoinType.INNER,
            onColumn = Reviews.managerId,
            otherColumn = managerUsers[UserService.Users.id],
        )
        .join(
            subordinateUsers,
            JoinType.INNER,
            onColumn = Reviews.subordinateId,
            otherColumn = subordinateUsers[UserService.Users.id],
        )
        .join(
            ReviewPeriodService.ReviewPeriods,
            JoinType.INNER,
            onColumn = Reviews.periodId,
            otherColumn = ReviewPeriodService.ReviewPeriods.id,
        )

    // Writes the eight assessment fields into an insert/update statement. Summaries are stored
    // NULL when null or empty (both mean "no summary") and encrypted otherwise.
    private fun writeAssessments(
        statement: org.jetbrains.exposed.v1.core.statements.UpdateBuilder<*>,
        assessments: Map<ReviewCategory, CategoryAssessment>,
    ) {
        val columns = mapOf(
            ReviewCategory.ATTITUDE to (Reviews.attitudeRating to Reviews.attitudeSummary),
            ReviewCategory.DELIVERY to (Reviews.deliveryRating to Reviews.deliverySummary),
            ReviewCategory.SKILLS to (Reviews.skillsRating to Reviews.skillsSummary),
            ReviewCategory.OVERALL to (Reviews.overallRating to Reviews.overallSummary),
        )
        assessments.forEach { (category, assessment) ->
            val (ratingColumn, summaryColumn) = columns.getValue(category)
            statement[ratingColumn] = assessment.rating?.toShort()
            statement[summaryColumn] = assessment.summary
                ?.takeIf { it.isNotEmpty() }
                ?.let(cipher::encrypt)
        }
    }

    // Row → full document, from the joined() select (party names come from the aliases, the
    // period months from the joined registry row).
    private fun ResultRow.toResponse(): PerformanceReviewResponse = PerformanceReviewResponse(
        id = this[Reviews.id].value,
        managerId = this[Reviews.managerId].value,
        subordinateId = this[Reviews.subordinateId].value,
        periodId = this[Reviews.periodId].value,
        periodStartMonth = this[ReviewPeriodService.ReviewPeriods.startMonth],
        periodEndMonth = this[ReviewPeriodService.ReviewPeriods.endMonth],
        status = this[Reviews.status],
        attitude = assessmentAt(Reviews.attitudeRating, Reviews.attitudeSummary),
        delivery = assessmentAt(Reviews.deliveryRating, Reviews.deliverySummary),
        skills = assessmentAt(Reviews.skillsRating, Reviews.skillsSummary),
        overall = assessmentAt(Reviews.overallRating, Reviews.overallSummary),
        createdAt = this[Reviews.createdAt],
        lastModified = this[Reviews.lastModified],
        managerName = this[managerUsers[UserService.Users.name]],
        subordinateName = this[subordinateUsers[UserService.Users.name]],
    )

    private fun ResultRow.assessmentAt(
        ratingColumn: Column<Short?>,
        summaryColumn: Column<String?>,
    ) = CategoryAssessment(
        rating = this[ratingColumn]?.toInt(),
        summary = this[summaryColumn]?.let(cipher::decrypt),
    )

    // The transition path's row view (party ids + the period months for the notification params;
    // no name aliases, no decryption).
    private data class TransitionRow(
        val managerId: UInt,
        val subordinateId: UInt,
        val status: PerformanceReviewStatus,
        val periodStartMonth: String,
        val periodEndMonth: String,
    )

    private fun ResultRow.toTransitionRow() = TransitionRow(
        managerId = this[Reviews.managerId].value,
        subordinateId = this[Reviews.subordinateId].value,
        status = this[Reviews.status],
        periodStartMonth = this[ReviewPeriodService.ReviewPeriods.startMonth],
        periodEndMonth = this[ReviewPeriodService.ReviewPeriods.endMonth],
    )

    private suspend fun userName(id: UInt): String =
        UserService.Users
            .select(UserService.Users.name)
            .where { UserService.Users.id eq id }
            .map { it[UserService.Users.name] }
            .singleOrNull() ?: "#$id"

    private fun buildPredicate(filter: PerformanceReviewListFilter): Op<Boolean> {
        var op: Op<Boolean> = Op.TRUE
        filter.managerName?.takeIf { it.isNotBlank() }?.let {
            op = op and (managerUsers[UserService.Users.name].lowerCase() like containsPattern(it))
        }
        filter.subordinateName?.takeIf { it.isNotBlank() }?.let {
            op = op and (subordinateUsers[UserService.Users.name].lowerCase() like containsPattern(it))
        }
        filter.managerId?.let { op = op and (Reviews.managerId eq it) }
        filter.subordinateId?.let { op = op and (Reviews.subordinateId eq it) }
        filter.periodId?.let { op = op and (Reviews.periodId eq it) }
        filter.status?.let { op = op and (Reviews.status eq it) }
        filter.createdAtGte?.let { op = op and (Reviews.createdAt greaterEq it) }
        filter.lastModifiedGte?.let { op = op and (Reviews.lastModified greaterEq it) }
        return op
    }
}
