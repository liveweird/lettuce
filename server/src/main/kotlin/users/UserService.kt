package ch.nokillswit.users

import ch.nokillswit.infra.db.containsPattern
import ch.nokillswit.infra.paging.PageRequest
import ch.nokillswit.infra.paging.applyPaging
import ch.nokillswit.teams.TeamService
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
                    UserResponse(
                        id = row[Users.id].value,
                        name = row[Users.name],
                        email = row[Users.email],
                        roles = emptyList(),
                    )
                }
                .toList()
            // One grouped query for the whole page — no per-row lookups.
            val rolesByUser = rolesByUserIds(rows.map { it.id })
            val items = rows.map { it.copy(roles = rolesByUser[it.id].orEmpty().sortedBy { r -> r.name }) }
            UserListResult(items = items, total = total)
        }

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
    )
}
