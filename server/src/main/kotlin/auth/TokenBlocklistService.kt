package ch.nokillswit.auth

import ch.nokillswit.users.UserService.Users
import io.ktor.util.AttributeKey
import kotlinx.coroutines.flow.firstOrNull
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.r2dbc.*
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction

val TokenBlocklistServiceKey = AttributeKey<TokenBlocklistService>("TokenBlocklistService")

class TokenBlocklistService(val database: R2dbcDatabase) {
    object RevokedTokens : Table("revoked_tokens") {
        val jti = varchar("jti", 36)
        val expiresAt = long("expires_at")
        override val primaryKey = PrimaryKey(jti)
    }

    suspend fun revoke(jti: String, expiresAtEpochMillis: Long) {
        suspendTransaction(database) {
            RevokedTokens.deleteWhere { expiresAt less System.currentTimeMillis() }
            RevokedTokens.insertIgnore {
                it[RevokedTokens.jti] = jti
                it[RevokedTokens.expiresAt] = expiresAtEpochMillis
            }
        }
    }

    suspend fun isRevoked(jti: String): Boolean = suspendTransaction(database) {
        RevokedTokens.selectAll()
            .where { RevokedTokens.jti eq jti }
            .firstOrNull() != null
    }

    /**
     * The access-token check behind every authenticated request: the token's [jti] is not
     * revoked AND its [userId] still names an account that is neither deactivated (V44) nor
     * soft-deleted — ONE statement, so the per-request statement count is the blocklist-only
     * lookup's. Deactivating (or deleting) an account therefore ends its live sessions on their
     * next request, instead of leaving the access token valid until its own expiry; the SPA's
     * 401 → /refresh then fails (refresh rejects deactivated users), which ends the session.
     */
    suspend fun isSessionLive(jti: String, userId: UInt): Boolean = suspendTransaction(database) {
        val revoked = RevokedTokens.select(RevokedTokens.jti).where { RevokedTokens.jti eq jti }
        Users.select(Users.id)
            .where {
                (Users.id eq userId) and
                    (Users.deactivated eq false) and
                    (Users.markedAsDeleted eq false) and
                    NotExists(revoked)
            }
            .firstOrNull() != null
    }
}
