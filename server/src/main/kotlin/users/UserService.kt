package ch.nokillswit.users

import ch.nokillswit.infra.paging.PageRequest
import ch.nokillswit.infra.paging.applyPaging
import ch.nokillswit.teams.TeamService
import io.ktor.util.AttributeKey
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.singleOrNull
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.core.dao.id.UIntIdTable
import org.jetbrains.exposed.v1.r2dbc.*
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase

val UserServiceKey = AttributeKey<UserService>("UserService")

data class UserListFilter(
    val name: String? = null,
    val email: String? = null,
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
    "role" to UserService.Users.role,
)

class UserService(val database: R2dbcDatabase) {
    object Users : UIntIdTable() {
        val name = varchar("name", length = 50)
        // Uniqueness is enforced by a partial unique index (active rows only) in migration V18,
        // so a soft-deleted user frees its email. Exposed table defs are query-only (not DDL),
        // so this column carries no `.uniqueIndex()`.
        val email = varchar("email", length = 254)
        val passwordHash = varchar("password_hash", length = 255)
        val role = varchar("role", length = 20)
        val markedAsDeleted = bool("marked_as_deleted").default(false)
    }

    suspend fun create(user: User): UInt = suspendTransaction(database) {
        val newRecord = Users.insert {
            it[name] = user.name
            it[email] = user.email
            it[passwordHash] = user.passwordHash
            it[role] = user.role.name
        }
        newRecord[Users.id].value
    }

    suspend fun read(id: UInt): User? {
        return suspendTransaction(database) {
            Users.selectAll()
                .where { (Users.id eq id) and active() }
                .map { it.toUser() }
                .singleOrNull()
        }
    }

    suspend fun findByEmail(email: String): User? {
        return suspendTransaction(database) {
            Users.selectAll()
                .where { (Users.email eq email) and active() }
                .map { it.toUser() }
                .singleOrNull()
        }
    }

    suspend fun findWithIdByEmail(email: String): Pair<UInt, User>? {
        return suspendTransaction(database) {
            Users.selectAll()
                .where { (Users.email eq email) and active() }
                .map { it[Users.id].value to it.toUser() }
                .singleOrNull()
        }
    }

    suspend fun update(id: UInt, user: User): Int = suspendTransaction(database) {
        Users.update({ (Users.id eq id) and (Users.markedAsDeleted eq false) }) {
            it[name] = user.name
            it[email] = user.email
            it[passwordHash] = user.passwordHash
            it[role] = user.role.name
        }
    }

    suspend fun updatePassword(id: UInt, passwordHash: String): Int = suspendTransaction(database) {
        Users.update({ (Users.id eq id) and (Users.markedAsDeleted eq false) }) {
            it[this.passwordHash] = passwordHash
        }
    }

    suspend fun delete(id: UInt): Int = suspendTransaction(database) {
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
                        role = UserRole.valueOf(row[Users.role]),
                    )
                }
                .toList()
            UserListResult(items = rows, total = total)
        }

    private fun active(): Op<Boolean> = Users.markedAsDeleted eq false

    private fun buildPredicate(filter: UserListFilter): Op<Boolean> {
        var op: Op<Boolean> = Op.TRUE
        filter.name?.takeIf { it.isNotBlank() }?.let {
            op = op and (Users.name.lowerCase() like containsPattern(it))
        }
        filter.email?.takeIf { it.isNotBlank() }?.let {
            op = op and (Users.email.lowerCase() like containsPattern(it))
        }
        filter.role?.let {
            op = op and (Users.role eq it.name)
        }
        filter.teamId?.let {
            val memberUserIds = TeamService.TeamMembers
                .select(TeamService.TeamMembers.userId)
                .where { TeamService.TeamMembers.teamId eq it }
            op = op and (Users.id inSubQuery memberUserIds)
        }
        return op
    }

    private fun containsPattern(raw: String): LikePattern {
        val escaped = raw.lowercase()
            .replace("\\", "\\\\")
            .replace("%", "\\%")
            .replace("_", "\\_")
        return LikePattern("%$escaped%", escapeChar = '\\')
    }

    private fun ResultRow.toUser() = User(
        name = this[Users.name],
        email = this[Users.email],
        passwordHash = this[Users.passwordHash],
        role = UserRole.valueOf(this[Users.role]),
    )
}
