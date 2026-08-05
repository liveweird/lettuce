package ch.nokillswit.users

import ch.nokillswit.dictionaries.Dictionary
import ch.nokillswit.dictionaries.DictionaryEntry
import ch.nokillswit.dictionaries.DictionaryService
import ch.nokillswit.infra.db.containsPattern
import ch.nokillswit.infra.paging.PageRequest
import ch.nokillswit.infra.paging.applyPaging
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
        val passwordChangedAt = long("password_changed_at").default(0)

        // Career profile refs into dictionary_entries (V33). Plain nullable id columns —
        // the FK lives in the migration; Exposed defs are query-only.
        val careerPathId = uinteger("career_path_id").nullable()
        val careerSpecializationId = uinteger("career_specialization_id").nullable()
        val seniorityLevelId = uinteger("seniority_level_id").nullable()

        // Annual paid days-off allowance in whole days (V38); null = not configured.
        val paidDaysOffAllowance = integer("paid_days_off_allowance").nullable()
    }

    object UserRoles : Table("user_roles") {
        val userId = reference("user_id", Users)
        val role = varchar("role", length = 30)
        override val primaryKey = PrimaryKey(userId, role)
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
                ?.toUser(rolesOf(id))
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
                    id to it.toUser(rolesOf(id))
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
                    )
                }
                .toList()
            // One grouped query per aspect for the whole page — no per-row lookups.
            val rolesByUser = rolesByUserIds(rows.map { it.id })
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
    )

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
            op = op and (Users.name.lowerCase() like containsPattern(it))
        }
        filter.email?.takeIf { it.isNotBlank() }?.let {
            op = op and (Users.email.lowerCase() like containsPattern(it))
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
        return op
    }

    private fun ResultRow.toUser(roles: Set<UserRole>) = User(
        name = this[Users.name],
        email = this[Users.email],
        passwordHash = this[Users.passwordHash],
        roles = roles,
        passwordChangedAt = this[Users.passwordChangedAt],
        careerPathId = this[Users.careerPathId],
        careerSpecializationId = this[Users.careerSpecializationId],
        seniorityLevelId = this[Users.seniorityLevelId],
        paidDaysOffAllowance = this[Users.paidDaysOffAllowance],
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
                    value = it[DictionaryService.Entries.value],
                )
            }
}
