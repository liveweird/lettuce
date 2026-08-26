package ch.nokillswit.succession

import ch.nokillswit.authz.ConflictException
import ch.nokillswit.authz.NotFoundException
import ch.nokillswit.goals.GoalService
import ch.nokillswit.goals.GoalStatus
import ch.nokillswit.infra.crypto.EncryptedAtRest
import ch.nokillswit.infra.crypto.FieldCipher
import ch.nokillswit.infra.crypto.reencryptRows
import ch.nokillswit.infra.db.containsNormalized
import ch.nokillswit.infra.paging.PageRequest
import ch.nokillswit.infra.paging.applyPaging
import ch.nokillswit.teams.directSubordinateIds
import ch.nokillswit.teams.isInManagementChain
import ch.nokillswit.teams.transitiveSubordinateIds
import ch.nokillswit.users.UserService
import io.ktor.server.plugins.BadRequestException
import io.ktor.util.AttributeKey
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.toList
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.core.dao.id.UIntIdTable
import org.jetbrains.exposed.v1.r2dbc.*
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction

val SuccessionPlanServiceKey = AttributeKey<SuccessionPlanService>("SuccessionPlanService")

enum class SuccessionListView { OWN, TEAM, USER }

data class SuccessionListFilter(
    val userName: String? = null,
    val managerName: String? = null,
    val status: SuccessionPlanStatus? = null,
)

data class SuccessionListResult(
    val items: List<SuccessionPlanListItem>,
    val total: Long,
)

private val managerUsers = UserService.Users.alias("manager_users")
private val seatUsers = UserService.Users.alias("seat_users")

// The JSON-array shape of the two ordered short-text list columns (the JsonParams.kt idiom).
private val textListSerializer = ListSerializer(String.serializer())

private val SORTABLE_COLUMNS: Map<String, Column<*>> = mapOf(
    "id" to SuccessionPlanService.Plans.id,
    "userName" to seatUsers[UserService.Users.name],
    "managerName" to managerUsers[UserService.Users.name],
    "status" to SuccessionPlanService.Plans.status,
    "createdAt" to SuccessionPlanService.Plans.createdAt,
    "lastReviewedAt" to SuccessionPlanService.Plans.lastReviewedAt,
)

// The two ordered short-text lists (loss impact / competency gaps) are each stored as ONE
// encrypted JSON array (see infra/crypto/FieldCipher.kt): the cipher wraps every write and
// unwraps every read, so nothing above this service ever sees ciphertext. Neither column is
// filtered/sorted/searched in SQL, and neither ever rides list rows.
class SuccessionPlanService(val database: R2dbcDatabase, private val cipher: FieldCipher) : EncryptedAtRest {
    override val encryptedRowLabel = "succession plan"

    object Plans : UIntIdTable("succession_plans") {
        val managerId = reference("manager_id", UserService.Users)
        val userId = reference("user_id", UserService.Users)
        val roleCriticality = enumerationByName("role_criticality", 20, RoleCriticality::class)
        val retentionRisk = enumerationByName("retention_risk", 20, RetentionRisk::class)
        val lossImpact = text("loss_impact")
        val targetBenchDepth = integer("target_bench_depth")
        val status = enumerationByName("status", 20, SuccessionPlanStatus::class)
        val createdAt = long("created_at")
        val lastReviewedAt = long("last_reviewed_at")
        val markedAsDeleted = bool("marked_as_deleted").default(false)
    }

    object Nominations : UIntIdTable("succession_nominations") {
        val planId = reference("plan_id", Plans)
        val candidateId = reference("candidate_id", UserService.Users)
        val readiness = enumerationByName("readiness", 30, SuccessorReadiness::class)
        val nominationType = enumerationByName("nomination_type", 20, NominationType::class)
        val competencyGaps = text("competency_gaps")
        val awareness = enumerationByName("awareness", 20, CandidateAwareness::class)
        val createdAt = long("created_at")
        val lastModified = long("last_modified")
        val markedAsDeleted = bool("marked_as_deleted").default(false)
    }

    // The hard-delete join class (goal_milestones): wholesale-replaced on every nomination save.
    object NominationGoals : Table("succession_nomination_goals") {
        val nominationId = reference("nomination_id", Nominations)
        val goalId = reference("goal_id", GoalService.Goals)
        val position = integer("position")
        override val primaryKey = PrimaryKey(nominationId, goalId)
    }

    private val listJson = Json

    private fun active(): Op<Boolean> = Plans.markedAsDeleted eq false
    private fun activeNomination(): Op<Boolean> = Nominations.markedAsDeleted eq false

    /**
     * Inserts a new plan owned by [managerId] (the caller — the route enforced the chain rule
     * on the seat's person). One OPEN plan per (owner, person): the friendly pre-check throws
     * the 409 here; the V68 partial unique index stays the concurrent-write backstop.
     */
    suspend fun create(managerId: UInt, request: SuccessionPlanCreateRequest): UInt =
        suspendTransaction(database) {
            val duplicate = Plans
                .select(Plans.id)
                .where {
                    (Plans.managerId eq managerId) and (Plans.userId eq request.userId) and
                        (Plans.status eq SuccessionPlanStatus.OPEN) and active()
                }
                .toList()
                .isNotEmpty()
            if (duplicate) {
                throw ConflictException("An open succession plan for this person already exists")
            }
            val now = System.currentTimeMillis()
            Plans.insert {
                it[this.managerId] = managerId
                it[userId] = request.userId
                it[roleCriticality] = request.roleCriticality
                it[retentionRisk] = request.retentionRisk
                it[lossImpact] = cipher.encrypt(encodeTexts(request.lossImpact))
                it[targetBenchDepth] = request.targetBenchDepth
                it[status] = SuccessionPlanStatus.OPEN
                it[createdAt] = now
                it[lastReviewedAt] = now
            }[Plans.id].value
        }

    /** The whole plan document — nominations (with their goal refs) embedded. */
    suspend fun read(id: UInt): SuccessionPlanResponse? = suspendTransaction(database) {
        val base = joined()
            .selectAll()
            .where { (Plans.id eq id) and active() }
            .map { it.toBase() }
            .toList()
            .singleOrNull()
            ?: return@suspendTransaction null
        val nominations = nominationsFor(id)
        SuccessionPlanResponse(
            id = base.id,
            managerId = base.managerId,
            managerName = base.managerName,
            userId = base.userId,
            userName = base.userName,
            roleCriticality = base.roleCriticality,
            retentionRisk = base.retentionRisk,
            lossImpact = decodeTexts(cipher.decrypt(base.lossImpactRaw)),
            targetBenchDepth = base.targetBenchDepth,
            status = base.status,
            benchCount = nominations.size,
            nominations = nominations,
            createdAt = base.createdAt,
            lastReviewedAt = base.lastReviewedAt,
        )
    }

    /**
     * Replaces the plan's definition fields (the person is immutable). Null when the row is
     * missing/deleted (→ 404); a CLOSED plan is read-only (→ 409). Does NOT touch the reviewed
     * stamp — only [completeReview] (and creation) sets it, v2.44.0.
     */
    suspend fun update(id: UInt, request: SuccessionPlanUpdate): Boolean? = suspendTransaction(database) {
        val current = planStatus(id) ?: return@suspendTransaction null
        requireOpen(current)
        Plans.update({ (Plans.id eq id) and (Plans.markedAsDeleted eq false) }) {
            it[roleCriticality] = request.roleCriticality
            it[retentionRisk] = request.retentionRisk
            it[lossImpact] = cipher.encrypt(encodeTexts(request.lossImpact))
            it[targetBenchDepth] = request.targetBenchDepth
        }
        true
    }

    /**
     * The explicit review action (v2.44.0): stamps last_reviewed_at = now — THE only writer of
     * the reviewed stamp besides creation (the v2.42.0 editing-is-reviewing model is retired;
     * mutations no longer bump it). Owner-only route-side; OPEN plans only (→ 409); repeatable
     * (a review is not a transition — re-reviewing just re-stamps). Null for a missing row.
     */
    suspend fun completeReview(id: UInt): Boolean? = suspendTransaction(database) {
        val current = planStatus(id) ?: return@suspendTransaction null
        requireOpen(current)
        touchPlan(id, System.currentTimeMillis())
        true
    }

    /**
     * OPEN → CLOSED, the one lifecycle edge (terminal — there is no reopen; deletion stays
     * available). Null for a missing row (→ 404), 409 when already closed (the transition
     * rule). Deliberately does NOT bump the reviewed stamp — closing is shelving, not review.
     */
    suspend fun close(id: UInt): Boolean? = suspendTransaction(database) {
        val current = planStatus(id) ?: return@suspendTransaction null
        if (current == SuccessionPlanStatus.CLOSED) {
            throw ConflictException("The succession plan is already closed")
        }
        Plans.update({ (Plans.id eq id) and (Plans.markedAsDeleted eq false) }) {
            it[status] = SuccessionPlanStatus.CLOSED
        }
        true
    }

    /** Soft delete, any status (a closed plan may still be discarded). Affected-row count. */
    suspend fun delete(id: UInt): Int = suspendTransaction(database) {
        Plans.update({ (Plans.id eq id) and (Plans.markedAsDeleted eq false) }) {
            it[markedAsDeleted] = true
        }
    }

    /**
     * Adds a nomination to an OPEN plan (owner-only, guarded route-side). The candidate must be
     * an existing active user (soft-deleted/unknown → 400 here; the deactivation rule runs
     * route-side); one active nomination per candidate per plan (→ 409, index backstop); the
     * goal links must pass [validateGoalLinks]. A PRIMARY nomination demotes any existing
     * PRIMARY on the plan ([demoteExistingPrimary]). The reviewed stamp is untouched (v2.44.0
     * — see [completeReview]).
     */
    suspend fun createNomination(
        planId: UInt,
        ownerId: UInt,
        request: SuccessionNominationRequest,
    ): UInt = suspendTransaction(database) {
        // The route just read the plan for its guard; a vanish between is a race → 404.
        val status = planStatus(planId) ?: throw NotFoundException("Succession plan not found")
        requireOpen(status)
        requireCandidateExists(request.candidateId)
        val duplicate = Nominations
            .select(Nominations.id)
            .where {
                (Nominations.planId eq planId) and (Nominations.candidateId eq request.candidateId) and
                    activeNomination()
            }
            .toList()
            .isNotEmpty()
        if (duplicate) {
            throw ConflictException("This candidate is already nominated on this plan")
        }
        validateGoalLinks(ownerId, request.candidateId, request.goalIds)
        val now = System.currentTimeMillis()
        if (request.nominationType == NominationType.PRIMARY) {
            demoteExistingPrimary(planId, excludeNominationId = null, now)
        }
        val id = Nominations.insert {
            it[this.planId] = planId
            it[candidateId] = request.candidateId
            it[readiness] = request.readiness
            it[nominationType] = request.nominationType
            it[competencyGaps] = cipher.encrypt(encodeTexts(request.competencyGaps))
            it[awareness] = request.awareness
            it[createdAt] = now
            it[lastModified] = now
        }[Nominations.id].value
        replaceGoalLinks(id, request.goalIds)
        id
    }

    /**
     * Replaces a nomination's whole document, goal links included (wholesale, payload order =
     * stored order). Null when the nomination is missing/deleted or lives under a different
     * plan (the corrections idiom → 404); the parent must be OPEN (→ 409). A save that sets
     * PRIMARY demotes any other PRIMARY on the plan ([demoteExistingPrimary]). The reviewed
     * stamp is untouched (v2.44.0 — see [completeReview]).
     */
    suspend fun updateNomination(
        planId: UInt,
        nominationId: UInt,
        ownerId: UInt,
        request: SuccessionNominationRequest,
    ): Boolean? = suspendTransaction(database) {
        val status = planStatus(planId) ?: return@suspendTransaction null
        val existing = Nominations
            .select(Nominations.id, Nominations.candidateId)
            .where { (Nominations.id eq nominationId) and (Nominations.planId eq planId) and activeNomination() }
            .map { it[Nominations.candidateId].value }
            .toList()
            .singleOrNull()
            ?: return@suspendTransaction null
        requireOpen(status)
        if (existing != request.candidateId) {
            requireCandidateExists(request.candidateId)
            val duplicate = Nominations
                .select(Nominations.id)
                .where {
                    (Nominations.planId eq planId) and (Nominations.candidateId eq request.candidateId) and
                        (Nominations.id neq nominationId) and activeNomination()
                }
                .toList()
                .isNotEmpty()
            if (duplicate) {
                throw ConflictException("This candidate is already nominated on this plan")
            }
        }
        validateGoalLinks(ownerId, request.candidateId, request.goalIds)
        val now = System.currentTimeMillis()
        if (request.nominationType == NominationType.PRIMARY) {
            demoteExistingPrimary(planId, excludeNominationId = nominationId, now)
        }
        Nominations.update({ (Nominations.id eq nominationId) and (Nominations.markedAsDeleted eq false) }) {
            it[candidateId] = request.candidateId
            it[readiness] = request.readiness
            it[nominationType] = request.nominationType
            it[competencyGaps] = cipher.encrypt(encodeTexts(request.competencyGaps))
            it[awareness] = request.awareness
            it[lastModified] = now
        }
        replaceGoalLinks(nominationId, request.goalIds)
        true
    }

    /**
     * Soft-deletes a nomination (its goal links become unreachable with it; the goals are
     * untouched). Null for a missing row or one under a different plan (→ 404); the parent
     * must be OPEN (→ 409). The reviewed stamp is untouched (v2.44.0 — see [completeReview]).
     */
    suspend fun deleteNomination(planId: UInt, nominationId: UInt): Boolean? = suspendTransaction(database) {
        val status = planStatus(planId) ?: return@suspendTransaction null
        val exists = Nominations
            .select(Nominations.id)
            .where { (Nominations.id eq nominationId) and (Nominations.planId eq planId) and activeNomination() }
            .toList()
            .isNotEmpty()
        if (!exists) return@suspendTransaction null
        requireOpen(status)
        Nominations.update({ (Nominations.id eq nominationId) and (Nominations.markedAsDeleted eq false) }) {
            it[markedAsDeleted] = true
        }
        true
    }

    suspend fun list(
        view: SuccessionListView,
        callerUserId: UInt,
        filter: SuccessionListFilter,
        paging: PageRequest,
        includeIndirect: Boolean = false,
        targetUserId: UInt? = null,
    ): SuccessionListResult = suspendTransaction(database) {
        val scope: Op<Boolean> = when (view) {
            SuccessionListView.OWN -> Plans.managerId eq callerUserId
            SuccessionListView.TEAM -> {
                // Plans owned by the caller's report managers — direct by default, the whole
                // transitive chain with includeIndirect (the goals view=team shape). Every
                // listed row is openable: the single-GET grants any manager above the owner.
                val owners =
                    if (includeIndirect) transitiveSubordinateIds(callerUserId)
                    else directSubordinateIds(callerUserId)
                if (owners.isEmpty()) Op.FALSE else Plans.managerId inList owners
            }
            SuccessionListView.USER -> {
                // Auditor view (HR-only, gated route-side via requireAuditListAccess): every
                // plan the target is a party to — as the seat's person or as the owner (the
                // feedback auditor rule). The route guarantees a non-null userId.
                val target = requireNotNull(targetUserId) { "view=user requires userId" }
                (Plans.userId eq target) or (Plans.managerId eq target)
            }
        }
        val predicate: Op<Boolean> = scope and buildPredicate(filter) and active()
        val join = joined()
        val total = join.selectAll().where { predicate }.count()
        val rows = join
            .select(
                Plans.id,
                Plans.managerId,
                Plans.userId,
                Plans.roleCriticality,
                Plans.retentionRisk,
                Plans.targetBenchDepth,
                Plans.status,
                Plans.createdAt,
                Plans.lastReviewedAt,
                managerUsers[UserService.Users.name],
                seatUsers[UserService.Users.name],
                seatUsers[UserService.Users.markedAsDeleted],
            )
            .where { predicate }
            .applyPaging(paging, SORTABLE_COLUMNS)
            .map { row ->
                SuccessionPlanListItem(
                    id = row[Plans.id].value,
                    managerId = row[Plans.managerId].value,
                    managerName = row[managerUsers[UserService.Users.name]],
                    userId = row[Plans.userId].value,
                    userName = row[seatUsers[UserService.Users.name]],
                    userDeleted = row[seatUsers[UserService.Users.markedAsDeleted]],
                    roleCriticality = row[Plans.roleCriticality],
                    retentionRisk = row[Plans.retentionRisk],
                    targetBenchDepth = row[Plans.targetBenchDepth],
                    benchCount = 0,
                    status = row[Plans.status],
                    createdAt = row[Plans.createdAt],
                    lastReviewedAt = row[Plans.lastReviewedAt],
                )
            }
            .toList()
        SuccessionListResult(items = withBenchCounts(rows), total = total)
    }

    /**
     * True iff [managerId] is in [userId]'s transitive management chain. Backs BOTH the
     * create-time chain rule on the seat's person and
     * [ch.nokillswit.authz.requireSuccessionPlanRead]'s lazy chain-above-the-OWNER check.
     */
    suspend fun managesUser(managerId: UInt, userId: UInt): Boolean =
        suspendTransaction(database) { isInManagementChain(managerId, userId) }

    /**
     * Startup backfill (see infra/db/Bootstrap.kt): both tables' encrypted JSON-array columns
     * in ONE transaction (the GoalService two-table shape). Idempotent; rewritten row count.
     */
    override suspend fun encryptLegacyRows(reencryptAll: Boolean): Int = suspendTransaction(database) {
        cipher.reencryptRows(Plans, listOf(Plans.lossImpact), reencryptAll) +
            cipher.reencryptRows(Nominations, listOf(Nominations.competencyGaps), reencryptAll)
    }

    // ── internals ───────────────────────────────────────────────────────────────────────────

    private data class PlanBase(
        val id: UInt,
        val managerId: UInt,
        val managerName: String,
        val userId: UInt,
        val userName: String,
        val roleCriticality: RoleCriticality,
        val retentionRisk: RetentionRisk,
        val lossImpactRaw: String,
        val targetBenchDepth: Int,
        val status: SuccessionPlanStatus,
        val createdAt: Long,
        val lastReviewedAt: Long,
    )

    private fun ResultRow.toBase() = PlanBase(
        id = this[Plans.id].value,
        managerId = this[Plans.managerId].value,
        managerName = this[managerUsers[UserService.Users.name]],
        userId = this[Plans.userId].value,
        userName = this[seatUsers[UserService.Users.name]],
        roleCriticality = this[Plans.roleCriticality],
        retentionRisk = this[Plans.retentionRisk],
        lossImpactRaw = this[Plans.lossImpact],
        targetBenchDepth = this[Plans.targetBenchDepth],
        status = this[Plans.status],
        createdAt = this[Plans.createdAt],
        lastReviewedAt = this[Plans.lastReviewedAt],
    )

    private fun joined() = Plans
        .join(
            managerUsers,
            JoinType.INNER,
            onColumn = Plans.managerId,
            otherColumn = managerUsers[UserService.Users.id],
        )
        .join(
            seatUsers,
            JoinType.INNER,
            onColumn = Plans.userId,
            otherColumn = seatUsers[UserService.Users.id],
        )

    /** The plan's active nominations in creation order, goal refs attached in stored order. */
    private suspend fun nominationsFor(planId: UInt): List<SuccessionNominationResponse> {
        // Drain each query before the next — an R2DBC query inside an open flow map deadlocks.
        val rows = (Nominations innerJoin UserService.Users)
            .selectAll()
            .where { (Nominations.planId eq planId) and activeNomination() }
            .orderBy(Nominations.id to SortOrder.ASC)
            .map { row ->
                SuccessionNominationResponse(
                    id = row[Nominations.id].value,
                    planId = row[Nominations.planId].value,
                    candidateId = row[Nominations.candidateId].value,
                    candidateName = row[UserService.Users.name],
                    readiness = row[Nominations.readiness],
                    nominationType = row[Nominations.nominationType],
                    competencyGaps = decodeTexts(cipher.decrypt(row[Nominations.competencyGaps])),
                    awareness = row[Nominations.awareness],
                    goals = emptyList(),
                    createdAt = row[Nominations.createdAt],
                    lastModified = row[Nominations.lastModified],
                )
            }
            .toList()
        if (rows.isEmpty()) return rows
        val refs = (NominationGoals innerJoin GoalService.Goals)
            .select(
                NominationGoals.nominationId,
                NominationGoals.position,
                GoalService.Goals.id,
                GoalService.Goals.title,
                GoalService.Goals.status,
                GoalService.Goals.type,
            )
            .where {
                (NominationGoals.nominationId inList rows.map { it.id }) and
                    (GoalService.Goals.markedAsDeleted eq false)
            }
            .orderBy(NominationGoals.nominationId to SortOrder.ASC, NominationGoals.position to SortOrder.ASC)
            .map { row ->
                row[NominationGoals.nominationId].value to SuccessionGoalRef(
                    id = row[GoalService.Goals.id].value,
                    title = row[GoalService.Goals.title],
                    status = row[GoalService.Goals.status],
                    type = row[GoalService.Goals.type],
                )
            }
            .toList()
            .groupBy({ it.first }, { it.second })
        return rows.map { it.copy(goals = refs[it.id] ?: emptyList()) }
    }

    /**
     * Fills the page rows' bench counts with one grouped query (the goals milestone-tally
     * idiom, inside the list transaction) — ALL active nominations count, emergency interims
     * included (user decision).
     */
    private suspend fun withBenchCounts(rows: List<SuccessionPlanListItem>): List<SuccessionPlanListItem> {
        if (rows.isEmpty()) return rows
        val counts = Nominations
            .select(Nominations.planId)
            .where { (Nominations.planId inList rows.map { it.id }) and activeNomination() }
            .map { it[Nominations.planId].value }
            .toList()
            .groupingBy { it }
            .eachCount()
        return rows.map { it.copy(benchCount = counts[it.id] ?: 0) }
    }

    private suspend fun planStatus(id: UInt): SuccessionPlanStatus? = Plans
        .select(Plans.status)
        .where { (Plans.id eq id) and active() }
        .map { it[Plans.status] }
        .toList()
        .singleOrNull()

    private fun requireOpen(status: SuccessionPlanStatus) {
        if (status != SuccessionPlanStatus.OPEN) {
            throw ConflictException("A closed succession plan is read-only")
        }
    }

    /** Unknown or soft-deleted candidate → 400 (deactivation is the route's check). */
    private suspend fun requireCandidateExists(candidateId: UInt) {
        val exists = UserService.Users
            .select(UserService.Users.id)
            .where { (UserService.Users.id eq candidateId) and (UserService.Users.markedAsDeleted eq false) }
            .toList()
            .isNotEmpty()
        if (!exists) throw BadRequestException("Unknown candidate user")
    }

    /**
     * Every linked goal must exist (non-deleted), belong to the CANDIDATE as its subordinate,
     * and be readable by the plan's owner under the goal rules minus HR: the owner authored it,
     * or it has left DRAFT and the candidate is in the owner's transitive chain (a DRAFT stays
     * private to its author pair). Runs inside the mutation transaction (cross-feature table
     * read — the service-layer rule).
     */
    private suspend fun validateGoalLinks(ownerId: UInt, candidateId: UInt, goalIds: List<UInt>) {
        if (goalIds.isEmpty()) return
        data class GoalRow(val id: UInt, val subordinateId: UInt, val managerId: UInt, val status: GoalStatus)
        val rows = GoalService.Goals
            .select(
                GoalService.Goals.id,
                GoalService.Goals.subordinateId,
                GoalService.Goals.managerId,
                GoalService.Goals.status,
            )
            .where {
                (GoalService.Goals.id inList goalIds) and (GoalService.Goals.markedAsDeleted eq false)
            }
            .map {
                GoalRow(
                    id = it[GoalService.Goals.id].value,
                    subordinateId = it[GoalService.Goals.subordinateId].value,
                    managerId = it[GoalService.Goals.managerId].value,
                    status = it[GoalService.Goals.status],
                )
            }
            .toList()
        val found = rows.associateBy { it.id }
        goalIds.forEach { goalId ->
            val goal = found[goalId] ?: throw BadRequestException("Unknown goal id: $goalId")
            if (goal.subordinateId != candidateId) {
                throw BadRequestException("Goal $goalId is not a goal of the nominated candidate")
            }
        }
        val needsChain = rows.any { it.managerId != ownerId }
        val candidateInChain = needsChain && isInManagementChain(ownerId, candidateId)
        rows.forEach { goal ->
            val readable = goal.managerId == ownerId ||
                (goal.status != GoalStatus.DRAFT && candidateInChain)
            if (!readable) {
                throw BadRequestException("Goal ${goal.id} is not readable by the plan's owner")
            }
        }
    }

    /** Wholesale link replace: delete-then-insert, position = payload order. */
    private suspend fun replaceGoalLinks(nominationId: UInt, goalIds: List<UInt>) {
        NominationGoals.deleteWhere { NominationGoals.nominationId eq nominationId }
        goalIds.forEachIndexed { index, goalId ->
            NominationGoals.insert {
                it[this.nominationId] = nominationId
                it[this.goalId] = goalId
                it[position] = index
            }
        }
    }

    /**
     * At most one active PRIMARY nomination per plan (V69): a write that sets PRIMARY demotes
     * any other active PRIMARY to SECONDARY in the same transaction (the SPA confirms with the
     * owner first). Idempotent; the V69 partial unique index is the concurrent-write backstop.
     */
    private suspend fun demoteExistingPrimary(planId: UInt, excludeNominationId: UInt?, now: Long) {
        Nominations.update({
            (Nominations.planId eq planId) and
                (Nominations.nominationType eq NominationType.PRIMARY) and
                activeNomination() and
                (excludeNominationId?.let { Nominations.id neq it } ?: Op.TRUE)
        }) {
            it[nominationType] = NominationType.SECONDARY
            it[lastModified] = now
        }
    }

    /** Stamps the reviewed date — called ONLY by [completeReview] since v2.44.0 (and set at create). */
    private suspend fun touchPlan(planId: UInt, now: Long) {
        Plans.update({ (Plans.id eq planId) and (Plans.markedAsDeleted eq false) }) {
            it[lastReviewedAt] = now
        }
    }

    private fun encodeTexts(items: List<String>): String =
        listJson.encodeToString(textListSerializer, items)

    private fun decodeTexts(value: String): List<String> =
        listJson.decodeFromString(textListSerializer, value)

    private fun buildPredicate(filter: SuccessionListFilter): Op<Boolean> {
        var op: Op<Boolean> = Op.TRUE
        filter.userName?.takeIf { it.isNotBlank() }?.let {
            op = op and (seatUsers[UserService.Users.name].containsNormalized(it))
        }
        filter.managerName?.takeIf { it.isNotBlank() }?.let {
            op = op and (managerUsers[UserService.Users.name].containsNormalized(it))
        }
        filter.status?.let { op = op and (Plans.status eq it) }
        return op
    }
}
