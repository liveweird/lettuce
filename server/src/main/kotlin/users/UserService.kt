package ch.nokillswit.users

import io.ktor.util.AttributeKey
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.singleOrNull
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.core.dao.id.UIntIdTable
import org.jetbrains.exposed.v1.r2dbc.*
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase

val UserServiceKey = AttributeKey<UserService>("UserService")

class UserService(val database: R2dbcDatabase) {
    object Users : UIntIdTable() {
        val name = varchar("name", length = 50)
        val age = integer("age")
        val email = varchar("email", length = 254).uniqueIndex()
        val passwordHash = varchar("password_hash", length = 255)
        val role = varchar("role", length = 20)
    }

    suspend fun create(user: User): UInt = suspendTransaction(database) {
        val newRecord = Users.insert {
            it[name] = user.name
            it[age] = user.age
            it[email] = user.email
            it[passwordHash] = user.passwordHash
            it[role] = user.role.name
        }
        newRecord[Users.id].value
    }

    suspend fun read(id: UInt): User? {
        return suspendTransaction(database) {
            Users.selectAll()
                .where { Users.id eq id }
                .map { it.toUser() }
                .singleOrNull()
        }
    }

    suspend fun findByEmail(email: String): User? {
        return suspendTransaction(database) {
            Users.selectAll()
                .where { Users.email eq email }
                .map { it.toUser() }
                .singleOrNull()
        }
    }

    suspend fun findWithIdByEmail(email: String): Pair<UInt, User>? {
        return suspendTransaction(database) {
            Users.selectAll()
                .where { Users.email eq email }
                .map { it[Users.id].value to it.toUser() }
                .singleOrNull()
        }
    }

    suspend fun update(id: UInt, user: User): Int = suspendTransaction(database) {
        Users.update({ Users.id eq id }) {
            it[name] = user.name
            it[age] = user.age
            it[email] = user.email
            it[passwordHash] = user.passwordHash
            it[role] = user.role.name
        }
    }

    suspend fun delete(id: UInt) {
        suspendTransaction(database) { Users.deleteWhere { Users.id.eq(id) } }
    }

    private fun ResultRow.toUser() = User(
        name = this[Users.name],
        age = this[Users.age],
        email = this[Users.email],
        passwordHash = this[Users.passwordHash],
        role = UserRole.valueOf(this[Users.role]),
    )
}
