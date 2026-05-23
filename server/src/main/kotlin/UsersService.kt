package ch.nokillswit

import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.singleOrNull
import kotlinx.serialization.Serializable
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.core.dao.id.UIntIdTable
import org.jetbrains.exposed.v1.r2dbc.*
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase

@Serializable
data class ExposedUser(
    val name: String,
    val age: Int,
    val email: String,
    val passwordHash: String,
)

class ExposedUserService(val database: R2dbcDatabase) {
    object Users : UIntIdTable() {
        val name = varchar("name", length = 50)
        val age = integer("age")
        val email = varchar("email", length = 254).uniqueIndex()
        val passwordHash = varchar("password_hash", length = 255)
    }

    suspend fun createSchema() {
        suspendTransaction(database) {
            SchemaUtils.create(Users)
        }
    }

    suspend fun create(user: ExposedUser): UInt = suspendTransaction(database) {
        val newRecord = Users.insert {
            it[name] = user.name
            it[age] = user.age
            it[email] = user.email
            it[passwordHash] = user.passwordHash
        }
        newRecord[Users.id].value
    }

    suspend fun read(id: UInt): ExposedUser? {
        return suspendTransaction(database) {
            Users.selectAll()
                .where { Users.id eq id }
                .map { ExposedUser(it[Users.name], it[Users.age], it[Users.email], it[Users.passwordHash]) }
                .singleOrNull()
        }
    }

    suspend fun findByEmail(email: String): ExposedUser? {
        return suspendTransaction(database) {
            Users.selectAll()
                .where { Users.email eq email }
                .map { ExposedUser(it[Users.name], it[Users.age], it[Users.email], it[Users.passwordHash]) }
                .singleOrNull()
        }
    }

    suspend fun update(id: UInt, user: ExposedUser) {
        suspendTransaction(database) {
            Users.update({ Users.id eq id }) {
                it[name] = user.name
                it[age] = user.age
                it[email] = user.email
                it[passwordHash] = user.passwordHash
            }
        }
    }

    suspend fun delete(id: UInt) {
        suspendTransaction(database) { Users.deleteWhere { Users.id.eq(id) } }
    }

}
