package ch.nokillswit.users

import ch.nokillswit.dictionaries.Dictionary
import ch.nokillswit.dictionaries.DictionaryEntry
import ch.nokillswit.dictionaries.DictionaryService
import ch.nokillswit.infra.db.containsNormalized
import ch.nokillswit.infra.paging.PageRequest
import ch.nokillswit.infra.paging.applyPaging
import ch.nokillswit.teams.TeamRef
import ch.nokillswit.teams.TeamService
import io.ktor.server.plugins.BadRequestException
import io.ktor.util.AttributeKey
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.flow.toSet
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.core.dao.id.UIntIdTable
import org.jetbrains.exposed.v1.r2dbc.*
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase

val UserServiceKey = AttributeKey<UserService>("UserService")

/** One user's resolved career profile — the /teams/members list enrichment payload. */
data class CareerProfile(
    val careerPath: DictionaryEntry?,
    val careerSpecialization: DictionaryEntry?,
    val seniorityLevel: DictionaryEntry?,
)

data class UserListFilter(
    val name: String? = null,
    val email: String? = null,
    /** Has-role filter: only users holding this additional role. */
    val role: UserRole? = null,
    val teamId: UInt? = null,
    /** Strict-boolean status filter: only deactivated (true) or only active (false) accounts. */
    val deactivated: Boolean? = null,
    /**
     * Feature-flag state filter — the pair travels together (the route 400s a lone half):
     * [feature] names the flag, [featureEnabled] picks users who have it enabled (true,
     * no disabled row) or disabled (false, a disabled row exists).
     */
    val feature: Feature? = null,
    val featureEnabled: Boolean? = null,
)

data class UserListResult(
    val items: List<UserResponse>,
    val total: Long,
)

private val SORTABLE_COLUMNS: Map<String, Column<*>> = mapOf(
    "id" to UserService.Users.id,
    "name" to UserService.Users.name,
    "email" to UserService.Users.email,
)

class UserService(val database: R2dbcDatabase) {
    object Users : UIntIdTable() {
        val name = varchar("name", length = 50)
        // Uniqueness is enforced by a partial unique index (active rows only) in migration V18,
        // so a soft-deleted user frees its email. Exposed table defs are query-only (not DDL),
        // so this column carries no `.uniqueIndex()`.
        val email = varchar("email", length = 254)
        val passwordHash = varchar("password_hash", length = 255)
        val markedAsDeleted = bool("marked_as_deleted").default(false)
        // Reversible admin disable (V44) — orthogonal to the soft-delete: blocks login/refresh
        // and NEW assignments, but the user stays fully readable and keeps their email reserved.
        val deactivated = bool("deactivated").default(false)
        val passwordChangedAt = long("password_changed_at").default(0)

        // Career profile refs into dictionary_entries (V33). Plain nullable id columns —
        // the FK lives in the migration; Exposed defs are query-only.
        val careerPathId = uinteger("career_path_id").nullable()
        val careerSpecializationId = uinteger("career_specialization_id").nullable()
        val seniorityLevelId = uinteger("seniority_level_id").nullable()

        // Annual paid days-off allowance in whole days (V38); null = not configured.
        val paidDaysOffAllowance = integer("paid_days_off_allowance").nullable()

        // Email-notification opt-out (V51): true = in-app notifications are mirrored by email.
        val emailNotificationsEnabled = bool("email_notifications_enabled").default(true)
    }

    object UserRoles : Table("user_roles") {
        val userId = reference("user_id", Users)
        val role = varchar("role", length = 30)
        override val primaryKey = PrimaryKey(userId, role)
    }

    // Per-user feature flags (V46) — the DISABLED set; no row = enabled.
    object UserDisabledFeatures : Table("user_disabled_features") {
        val userId = reference("user_id", Users)
        val feature = varchar("feature", length = 30)
        override val primaryKey = PrimaryKey(userId, feature)
    }

    suspend fun create(user: User): UInt = suspendTransaction(database) {
        val newRecord = Users.insert {
            it[name] = user.name
            it[email] = user.email
            it[passwordHash] = user.passwordHash
            it[careerPathId] = user.careerPathId
            it[careerSpecializationId] = user.careerSpecializationId
            it[seniorityLevelId] = user.seniorityLevelId
            it[paidDaysOffAllowance] = user.paidDaysOffAllowance
        }
        val id = newRecord[Users.id].value
        insertRoles(id, user.roles)
        // MFA is the one inverted-default flag (opt-in): every new user starts with the
        // disabled row present, mirroring the V52 seed for pre-existing users. All creation
        // paths (admin create, CSV import, test seeds) funnel through here.
        UserDisabledFeatures.insert {
            it[UserDisabledFeatures.userId] = id
            it[UserDisabledFeatures.feature] = Feature.MFA.name
        }
        id
    }

    suspend fun read(id: UInt): User? {
        return suspendTransaction(database) {
            // Materialize the row before the roles query — no nested statement
            // while the row flow is still being consumed.
            Users.selectAll()
                .where { (Users.id eq id) and active() }
                .toList()
                .singleOrNull()
                ?.toUser(rolesOf(id), featuresOf(id))
        }
    }

    suspend fun findWithIdByEmail(email: String): Pair<UInt, User>? {
        return suspendTransaction(database) {
            Users.selectAll()
                .where { (Users.email eq email) and active() }
                .toList()
                .singleOrNull()
                ?.let {
                    val id = it[Users.id].value
                    id to it.toUser(rolesOf(id), featuresOf(id))
                }
        }
    }

    suspend fun update(id: UInt, user: User): Int = suspendTransaction(database) {
        val affected = Users.update({ (Users.id eq id) and (Users.markedAsDeleted eq false) }) {
            it[name] = user.name
            it[email] = user.email
            it[passwordHash] = user.passwordHash
            it[careerPathId] = user.careerPathId
            it[careerSpecializationId] = user.careerSpecializationId
            it[seniorityLevelId] = user.seniorityLevelId
            it[paidDaysOffAllowance] = user.paidDaysOffAllowance
        }
        if (affected > 0) {
            // Wholesale replace — the set is tiny and this is idempotent and diff-free.
            UserRoles.deleteWhere { UserRoles.userId eq id }
            insertRoles(id, user.roles)
        }
        affected
    }

    suspend fun updatePassword(id: UInt, passwordHash: String): Int = suspendTransaction(database) {
        Users.update({ (Users.id eq id) and (Users.markedAsDeleted eq false) }) {
            it[this.passwordHash] = passwordHash
            // Invalidates outstanding refresh tokens: /refresh rejects iat < passwordChangedAt.
            it[passwordChangedAt] = System.currentTimeMillis()
        }
    }

    /** Bootstrap: rotate a user's password only while they still carry [expectedHash]. */
    suspend fun rotatePasswordIfHashMatches(email: String, expectedHash: String, newHash: String): Int =
        suspendTransaction(database) {
            Users.update({ (Users.email eq email) and (Users.passwordHash eq expectedHash) and active() }) {
                it[passwordHash] = newHash
                it[passwordChangedAt] = System.currentTimeMillis()
            }
        }

    /** Bootstrap: soft-delete every active user whose email is in [emails]. */
    suspend fun softDeleteByEmails(emails: List<String>): Int = suspendTransaction(database) {
        Users.update({ (Users.email inList emails) and active() }) {
            it[markedAsDeleted] = true
        }
    }

    /** Bootstrap: how many active accounts still carry [hash] (the well-known seed password). */
    suspend fun countActiveWithPasswordHash(hash: String): Long = suspendTransaction(database) {
        Users.selectAll().where { (Users.passwordHash eq hash) and active() }.count()
    }

    suspend fun delete(id: UInt): Int = suspendTransaction(database) {
        // Roles rows are left in place: users never hard-delete, and a restored
        // account keeps what it had.
        Users.update({ (Users.id eq id) and (Users.markedAsDeleted eq false) }) {
            it[markedAsDeleted] = true
        }
    }

    /**
     * Flip the reversible deactivation flag. Returns the affected-row count — 0 = missing or
     * soft-deleted (the route 404s); the route pre-reads to turn a same-state repeat into 409.
     */
    suspend fun setDeactivated(id: UInt, deactivated: Boolean): Int = suspendTransaction(database) {
        Users.update({ (Users.id eq id) and active() }) {
            it[Users.deactivated] = deactivated
        }
    }

    /**
     * Wholesale-replace the user's disabled-feature set (V46). Returns 1, or 0 when the id is
     * unknown or soft-deleted (the route 404s). Idempotent — a same-set re-PUT is a no-op
     * replace, not a transition (no 409, unlike [setDeactivated]'s route).
     */
    suspend fun setDisabledFeatures(id: UInt, features: Set<Feature>): Int = suspendTransaction(database) {
        val exists = Users.select(Users.id)
            .where { (Users.id eq id) and active() }
            .toList()
            .isNotEmpty()
        if (!exists) return@suspendTransaction 0
        UserDisabledFeatures.deleteWhere { UserDisabledFeatures.userId eq id }
        features.forEach { f ->
            UserDisabledFeatures.insert {
                it[userId] = id
                it[feature] = f.name
            }
        }
        1
    }

    /**
     * Flip the email-notification opt-out (V51). Returns 1, or 0 when the id is unknown or
     * soft-deleted (the route 404s). Idempotent like [setDisabledFeatures] — a same-value
     * re-PUT is a no-op write, not a transition.
     */
    suspend fun setEmailNotifications(id: UInt, enabled: Boolean): Int = suspendTransaction(database) {
        Users.update({ (Users.id eq id) and active() }) {
            it[emailNotificationsEnabled] = enabled
        }
    }

    /**
     * Which of [ids] are deactivated (active, non-soft-deleted) users — one SELECT, backing the
     * creation-time assignment blocks. Soft-deleted or unknown ids fall through to the existing
     * FK/reference validation.
     */
    suspend fun deactivatedIdsAmong(ids: Collection<UInt>): Set<UInt> {
        if (ids.isEmpty()) return emptySet()
        return suspendTransaction(database) {
            Users.select(Users.id)
                .where { (Users.id inList ids.toSet()) and (Users.deactivated eq true) and active() }
                .map { it[Users.id].value }
                .toSet()
        }
    }

    /**
     * 400 when any of [ids] is a deactivated user (the [requireActiveEntries] sibling). Callers
     * pass only NEWLY-referenced user ids — resubmitting an existing reference (a team member
     * already on the roster, an unchanged manager) is not a change and is never validated.
     */
    suspend fun requireNoDeactivatedUsers(ids: Collection<UInt>) {
        val hit = deactivatedIdsAmong(ids)
        if (hit.isNotEmpty()) {
            throw BadRequestException(
                "User ${hit.sorted().joinToString(", ")} is deactivated and cannot be newly assigned",
            )
        }
    }

    suspend fun list(filter: UserListFilter, paging: PageRequest): UserListResult =
        suspendTransaction(database) {
            val predicate: Op<Boolean> = buildPredicate(filter) and active()
            val total = Users.selectAll().where { predicate }.count()
            val rows = Users.selectAll()
                .where { predicate }
                .applyPaging(paging, SORTABLE_COLUMNS)
                .map { row ->
                    ListRow(
                        id = row[Users.id].value,
                        name = row[Users.name],
                        email = row[Users.email],
                        careerPathId = row[Users.careerPathId],
                        careerSpecializationId = row[Users.careerSpecializationId],
                        seniorityLevelId = row[Users.seniorityLevelId],
                        paidDaysOffAllowance = row[Users.paidDaysOffAllowance],
                        deactivated = row[Users.deactivated],
                        emailNotificationsEnabled = row[Users.emailNotificationsEnabled],
                    )
                }
                .toList()
            // One grouped query per aspect for the whole page — no per-row lookups.
            val rolesByUser = rolesByUserIds(rows.map { it.id })
            val featuresByUser = disabledFeaturesByUserIds(rows.map { it.id })
            val teamsByUser = teamRefsByUserIds(rows.map { it.id })
            val entries = entriesByIds(
                rows.flatMap { listOfNotNull(it.careerPathId, it.careerSpecializationId, it.seniorityLevelId) }.toSet(),
            )
            val items = rows.map { row ->
                UserResponse(
                    id = row.id,
                    name = row.name,
                    email = row.email,
                    roles = rolesByUser[row.id].orEmpty().sortedBy { r -> r.name },
                    careerPath = row.careerPathId?.let { entries[it] },
                    careerSpecialization = row.careerSpecializationId?.let { entries[it] },
                    seniorityLevel = row.seniorityLevelId?.let { entries[it] },
                    paidDaysOffAllowance = row.paidDaysOffAllowance,
                    deactivated = row.deactivated,
                    disabledFeatures = featuresByUser[row.id].orEmpty().sortedBy { f -> f.name },
                    emailNotificationsEnabled = row.emailNotificationsEnabled,
                    teams = teamsByUser[row.id].orEmpty(),
                )
            }
            UserListResult(items = items, total = total)
        }

    /** Intermediate page row — materialized before the grouped roles/entries queries run. */
    private data class ListRow(
        val id: UInt,
        val name: String,
        val email: String,
        val careerPathId: UInt?,
        val careerSpecializationId: UInt?,
        val seniorityLevelId: UInt?,
        val paidDaysOffAllowance: Int?,
        val deactivated: Boolean,
        val emailNotificationsEnabled: Boolean,
    )

    // Soft-delete ONLY — deactivated users must stay readable everywhere (their historical
    // data renders with unchanged rights); never fold Users.deactivated into this predicate.
    private fun active(): Op<Boolean> = Users.markedAsDeleted eq false

    /** Must run inside a transaction. */
    private suspend fun rolesOf(id: UInt): Set<UserRole> =
        UserRoles.selectAll()
            .where { UserRoles.userId eq id }
            .map { UserRole.valueOf(it[UserRoles.role]) }
            .toSet()

    /** Must run inside a transaction. */
    private suspend fun rolesByUserIds(ids: List<UInt>): Map<UInt, List<UserRole>> =
        if (ids.isEmpty()) emptyMap()
        else UserRoles.selectAll()
            .where { UserRoles.userId inList ids }
            .toList()
            .groupBy({ it[UserRoles.userId].value }, { UserRole.valueOf(it[UserRoles.role]) })

    /** Must run inside a transaction. */
    private suspend fun featuresOf(id: UInt): Set<Feature> =
        UserDisabledFeatures.selectAll()
            .where { UserDisabledFeatures.userId eq id }
            .map { Feature.valueOf(it[UserDisabledFeatures.feature]) }
            .toSet()

    /** Must run inside a transaction. */
    private suspend fun disabledFeaturesByUserIds(ids: List<UInt>): Map<UInt, List<Feature>> =
        if (ids.isEmpty()) emptyMap()
        else UserDisabledFeatures.selectAll()
            .where { UserDisabledFeatures.userId inList ids }
            .toList()
            .groupBy({ it[UserDisabledFeatures.userId].value }, { Feature.valueOf(it[UserDisabledFeatures.feature]) })

    /**
     * (userId → member-of team refs) for a page of ids: non-deleted teams only, name-ascending
     * per user. Membership only (roster semantics — managing a team does not list it here).
     * Must run inside a transaction.
     */
    private suspend fun teamRefsByUserIds(ids: List<UInt>): Map<UInt, List<TeamRef>> =
        if (ids.isEmpty()) emptyMap()
        else TeamService.TeamMembers
            .join(
                TeamService.Teams,
                JoinType.INNER,
                onColumn = TeamService.TeamMembers.teamId,
                otherColumn = TeamService.Teams.id,
            )
            .select(TeamService.TeamMembers.userId, TeamService.Teams.id, TeamService.Teams.name)
            .where {
                (TeamService.TeamMembers.userId inList ids) and
                    (TeamService.Teams.markedAsDeleted eq false)
            }
            .toList()
            .groupBy(
                { it[TeamService.TeamMembers.userId].value },
                { TeamRef(id = it[TeamService.Teams.id].value, name = it[TeamService.Teams.name]) },
            )
            .mapValues { (_, refs) -> refs.sortedBy { r -> r.name } }

    /** Must run inside a transaction. */
    private suspend fun insertRoles(id: UInt, roles: Set<UserRole>) {
        roles.forEach { r ->
            UserRoles.insert {
                it[UserRoles.userId] = id
                it[UserRoles.role] = r.name
            }
        }
    }

    private fun buildPredicate(filter: UserListFilter): Op<Boolean> {
        var op: Op<Boolean> = Op.TRUE
        filter.name?.takeIf { it.isNotBlank() }?.let {
            op = op and (Users.name.containsNormalized(it))
        }
        filter.email?.takeIf { it.isNotBlank() }?.let {
            op = op and (Users.email.containsNormalized(it))
        }
        filter.role?.let {
            val holders = UserRoles.select(UserRoles.userId).where { UserRoles.role eq it.name }
            op = op and (Users.id inSubQuery holders)
        }
        filter.teamId?.let {
            val memberUserIds = TeamService.TeamMembers
                .select(TeamService.TeamMembers.userId)
                .where { TeamService.TeamMembers.teamId eq it }
            op = op and (Users.id inSubQuery memberUserIds)
        }
        filter.deactivated?.let {
            op = op and (Users.deactivated eq it)
        }
        filter.feature?.let { f ->
            // The route guarantees featureEnabled is non-null whenever feature is set.
            val disabled = UserDisabledFeatures
                .select(UserDisabledFeatures.userId)
                .where { UserDisabledFeatures.feature eq f.name }
            op = op and if (filter.featureEnabled == false) {
                Users.id inSubQuery disabled
            } else {
                Users.id notInSubQuery disabled
            }
        }
        return op
    }

    private fun ResultRow.toUser(roles: Set<UserRole>, disabledFeatures: Set<Feature>) = User(
        name = this[Users.name],
        email = this[Users.email],
        passwordHash = this[Users.passwordHash],
        roles = roles,
        disabledFeatures = disabledFeatures,
        deactivated = this[Users.deactivated],
        passwordChangedAt = this[Users.passwordChangedAt],
        careerPathId = this[Users.careerPathId],
        careerSpecializationId = this[Users.careerSpecializationId],
        seniorityLevelId = this[Users.seniorityLevelId],
        paidDaysOffAllowance = this[Users.paidDaysOffAllowance],
        emailNotificationsEnabled = this[Users.emailNotificationsEnabled],
    )

    /**
     * Resolve career-profile refs to their entries (route-side, own transaction — kept out of
     * [read] to avoid a nested statement on the row flow and to keep /refresh cheap).
     * Soft-deleted entries are INCLUDED on purpose: a referenced entry keeps resolving to its
     * retained (possibly renamed) value.
     */
    suspend fun resolveEntryRefs(vararg ids: UInt?): Map<UInt, DictionaryEntry> =
        suspendTransaction(database) { entriesByIds(ids.filterNotNull().toSet()) }

    /**
     * Batch career-profile resolution for a page of user ids (route-side list enrichment —
     * the /teams/members rows). Two queries total: the users' ref columns, then one
     * [entriesByIds] over every referenced entry. Soft-deleted entries resolve as everywhere.
     */
    suspend fun careerProfilesByUserIds(ids: Set<UInt>): Map<UInt, CareerProfile> {
        if (ids.isEmpty()) return emptyMap()
        return suspendTransaction(database) {
            val refs = Users
                .select(Users.id, Users.careerPathId, Users.careerSpecializationId, Users.seniorityLevelId)
                .where { Users.id inList ids }
                .map {
                    CareerRefs(
                        userId = it[Users.id].value,
                        careerPathId = it[Users.careerPathId],
                        careerSpecializationId = it[Users.careerSpecializationId],
                        seniorityLevelId = it[Users.seniorityLevelId],
                    )
                }
                .toList()
            val entries = entriesByIds(
                refs.flatMap { listOfNotNull(it.careerPathId, it.careerSpecializationId, it.seniorityLevelId) }.toSet(),
            )
            refs.associate { r ->
                r.userId to CareerProfile(
                    careerPath = r.careerPathId?.let { entries[it] },
                    careerSpecialization = r.careerSpecializationId?.let { entries[it] },
                    seniorityLevel = r.seniorityLevelId?.let { entries[it] },
                )
            }
        }
    }

    private data class CareerRefs(
        val userId: UInt,
        val careerPathId: UInt?,
        val careerSpecializationId: UInt?,
        val seniorityLevelId: UInt?,
    )

    /**
     * 400 unless every (dictionary, id) pair is an ACTIVE entry of exactly that dictionary.
     * Callers pass only NEWLY-assigned ids — resubmitting a user's current (possibly
     * soft-deleted) id is not a change and is never validated.
     */
    suspend fun requireActiveEntries(refs: List<Pair<Dictionary, UInt>>) {
        if (refs.isEmpty()) return
        suspendTransaction(database) {
            val rows = DictionaryService.Entries.selectAll()
                .where { DictionaryService.Entries.id inList refs.map { it.second }.toSet() }
                .toList()
                .associateBy { it[DictionaryService.Entries.id].value }
            refs.forEach { (dict, entryId) ->
                val row = rows[entryId]
                if (row == null ||
                    row[DictionaryService.Entries.dictionary] != dict.name ||
                    row[DictionaryService.Entries.markedAsDeleted]
                ) {
                    throw BadRequestException("$entryId is not an active ${dict.name} dictionary entry")
                }
            }
        }
    }

    /** Must run inside a transaction. Soft-deleted included — see [resolveEntryRefs]. */
    private suspend fun entriesByIds(ids: Set<UInt>): Map<UInt, DictionaryEntry> =
        if (ids.isEmpty()) emptyMap()
        else DictionaryService.Entries.selectAll()
            .where { DictionaryService.Entries.id inList ids }
            .toList()
            .associate {
                it[DictionaryService.Entries.id].value to DictionaryEntry(
                    id = it[DictionaryService.Entries.id].value,
                    valueEn = it[DictionaryService.Entries.valueEn],
                    valuePl = it[DictionaryService.Entries.valuePl],
                )
            }
}
