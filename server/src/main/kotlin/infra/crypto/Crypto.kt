package ch.nokillswit.infra.crypto

import io.ktor.server.application.*
import io.ktor.util.AttributeKey

val FieldCipherKey = AttributeKey<FieldCipher>("FieldCipher")

/**
 * The committed dev-only default for `security.encryption.key` (must match the literal in
 * application.yaml). Public, thus burned: production startup refuses it.
 */
internal const val DEV_DATA_ENCRYPTION_KEY =
    "650180357f3898db23d295f5bd7ce2ee52bfd280aefb562e75a3a64e8b3b80f3"

/** The docker-compose.yaml demo value — likewise committed, likewise burned. */
internal const val COMPOSE_DATA_ENCRYPTION_KEY =
    "63c71985aa36dfe66c2cb0fa341e8c9cd365734ad562b64c22a2c96674d515d6"

/**
 * Builds the [FieldCipher] used for application-level encryption of feedback content at rest and
 * publishes it as [FieldCipherKey]. Registered in application.yaml BEFORE configureDatabase,
 * which hands it to FeedbackService.
 *
 * Mirrors the JWT-secret fail-closed check in plugins/Security.kt: a blank or publicly known
 * (repo-committed) key is allowed with a loud warning in development, and refuses to start in
 * production. A malformed key (wrong length / not hex) fails startup in ANY mode — it cannot
 * encrypt at all.
 */
fun Application.configureCrypto() {
    val keyHex = environment.config.property("security.encryption.key").getString()
    val previousKeyHex = environment.config
        .propertyOrNull("security.encryption.previousKey")?.getString()?.takeIf { it.isNotBlank() }

    val burnedKeys = setOf(DEV_DATA_ENCRYPTION_KEY, COMPOSE_DATA_ENCRYPTION_KEY)
    if (keyHex.isBlank() || keyHex in burnedKeys) {
        val message =
            "Data encryption key is unset or a publicly known value — feedback content is not " +
                "confidential against a database-level attacker. Set a strong, private " +
                "DATA_ENCRYPTION_KEY (openssl rand -hex 32)."
        if (developmentMode) log.warn("$message (permitted in development only)")
        else error(message)
    }
    // If you rotate away from a burned key, the burned key may still appear as previousKey —
    // decrypt-only, so that is acceptable in any mode (the backfill re-encrypts at boot).
    attributes.put(FieldCipherKey, FieldCipher(keyHex, previousKeyHex))
}
