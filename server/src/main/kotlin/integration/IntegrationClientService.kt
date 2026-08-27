package ch.nokillswit.integration

import ch.nokillswit.auth.generateApiKey
import ch.nokillswit.users.UserService
import io.ktor.util.AttributeKey
import java.security.MessageDigest
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.singleOrNull
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.core.dao.id.UIntIdTable
import org.jetbrains.exposed.v1.r2dbc.*
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction

val IntegrationClientServiceKey = AttributeKey<IntegrationClientService>("IntegrationClientService")

/** The authenticated machine identity behind an integration API key (see integration/Integration.kt). */
data class IntegrationClientPrincipal(
    val clientId: UInt,
    val name: String,
)

enum class RevokeOutcome { REVOKED, NOT_FOUND, ALREADY_REVOKED }

/** SHA-256 hex digest — the at-rest form of every API key. No bcrypt work factor needed:
 *  keys are ~258 bits of server-generated randomness, not human-chosen secrets. */
internal fun apiKeyHash(rawKey: String): String =
    MessageDigest.getInstance("SHA-256")
        .digest(rawKey.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) }

/**
 * Admin-managed technical identities for the read-only integration API (v3.0.0).
 * A client holds exactly one immutable key: create → shown once, revoke → terminal
 * (`revoked_at` is the removal — no update/delete; see migration V71). The registry is
 * expected to stay tiny (dozens), so [list] is unpaged like the review-period registry.
 */
class IntegrationClientService(val database: R2dbcDatabase) {
    object IntegrationClients : UIntIdTable("integration_clients") {
        val name = varchar("name", length = 100)
        val keyHash = varchar("key_hash", length = 64)
        val createdBy = reference("created_by", UserService.Users)
        val createdAt = long("created_at")
        val lastUsedAt = long("last_used_at").nullable()
        val revokedAt = long("revoked_at").nullable()
    }

    /** Inserts the client and returns (id, plaintext key). The key never persists — only its hash. */
    suspend fun create(name: String, createdBy: UInt): Pair<UInt, String> = suspendTransaction(database) {
        validateIntegrationClientName(name)
        val rawKey = generateApiKey()
        val record = IntegrationClients.insert {
            it[IntegrationClients.name] = name
            it[keyHash] = apiKeyHash(rawKey)
            it[IntegrationClients.createdBy] = createdBy
            it[createdAt] = System.currentTimeMillis()
        }
        record[IntegrationClients.id].value to rawKey
    }

    suspend fun read(id: UInt): IntegrationClientResponse? = suspendTransaction(database) {
        joined().where { IntegrationClients.id eq id }.map { it.toResponse() }.singleOrNull()
    }

    suspend fun list(): List<IntegrationClientResponse> = suspendTransaction(database) {
        joined().orderBy(IntegrationClients.id to SortOrder.ASC).map { it.toResponse() }.toList()
    }

    suspend fun revoke(id: UInt): RevokeOutcome = suspendTransaction(database) {
        // Keep the whole row: a `map { it[revokedAt] }.singleOrNull()` would fold the
        // legitimate "exists with NULL revoked_at" case into "missing".
        val row = IntegrationClients.selectAll()
            .where { IntegrationClients.id eq id }
            .singleOrNull()
            ?: return@suspendTransaction RevokeOutcome.NOT_FOUND
        if (row[IntegrationClients.revokedAt] != null) return@suspendTransaction RevokeOutcome.ALREADY_REVOKED
        // Conditional on the flag so a concurrent revoke loses cleanly: the second caller's
        // update matches zero rows and answers 409 instead of double-stamping (checkup #30, A-L1).
        val updated = IntegrationClients.update({
            (IntegrationClients.id eq id) and IntegrationClients.revokedAt.isNull()
        }) {
            it[IntegrationClients.revokedAt] = System.currentTimeMillis()
        }
        if (updated == 0) RevokeOutcome.ALREADY_REVOKED else RevokeOutcome.REVOKED
    }

    /** The bearer-provider lookup: non-revoked hash match → principal (stamping `last_used_at`), else null. */
    suspend fun authenticate(rawKey: String): IntegrationClientPrincipal? = suspendTransaction(database) {
        val row = IntegrationClients.selectAll()
            .where { (IntegrationClients.keyHash eq apiKeyHash(rawKey)) and IntegrationClients.revokedAt.isNull() }
            .singleOrNull()
            ?: return@suspendTransaction null
        val clientId = row[IntegrationClients.id].value
        // Conditional on non-revoked so a revoke committing between the select and this update
        // is never recorded as a post-revocation "use" (checkup #30, A-L2).
        IntegrationClients.update({
            (IntegrationClients.id eq clientId) and IntegrationClients.revokedAt.isNull()
        }) {
            it[lastUsedAt] = System.currentTimeMillis()
        }
        IntegrationClientPrincipal(clientId = clientId, name = row[IntegrationClients.name])
    }

    private fun joined() = (IntegrationClients innerJoin UserService.Users)
        .select(
            IntegrationClients.id,
            IntegrationClients.name,
            IntegrationClients.createdAt,
            IntegrationClients.lastUsedAt,
            IntegrationClients.revokedAt,
            UserService.Users.name,
        )

    private fun ResultRow.toResponse() = IntegrationClientResponse(
        id = this[IntegrationClients.id].value,
        name = this[IntegrationClients.name],
        createdAt = this[IntegrationClients.createdAt],
        createdByName = this[UserService.Users.name],
        lastUsedAt = this[IntegrationClients.lastUsedAt],
        revoked = this[IntegrationClients.revokedAt] != null,
        revokedAt = this[IntegrationClients.revokedAt],
    )
}
