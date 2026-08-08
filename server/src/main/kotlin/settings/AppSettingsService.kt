package ch.nokillswit.settings

import io.ktor.util.AttributeKey
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.singleOrNull
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase
import org.jetbrains.exposed.v1.r2dbc.insert
import org.jetbrains.exposed.v1.r2dbc.select
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import org.jetbrains.exposed.v1.r2dbc.update

val AppSettingsServiceKey = AttributeKey<AppSettingsService>("AppSettingsService")

/**
 * The generic runtime-settings store over `app_settings` (V47) — the only configuration in the
 * app that is editable at runtime (everything else is application.yaml/env, read once at boot).
 * Deliberately dumb: string keys to string values, no typing, no whitelist — each feature owns
 * its keys, defaults, parsing, and validation (see pulse/PulseSettings.kt). Rows hard-upsert
 * and never soft-delete (config, not user data).
 */
class AppSettingsService(val database: R2dbcDatabase) {
    object AppSettings : Table("app_settings") {
        val key = varchar("key", length = 100)
        val value = varchar("value", length = 200)
        override val primaryKey = PrimaryKey(key)
    }

    suspend fun get(key: String): String? = suspendTransaction(database) {
        AppSettings.select(AppSettings.value)
            .where { AppSettings.key eq key }
            .map { it[AppSettings.value] }
            .singleOrNull()
    }

    /** Batch read for a feature's whole key family; absent keys are simply missing from the map. */
    suspend fun getAll(keys: Set<String>): Map<String, String> = suspendTransaction(database) {
        AppSettings.select(AppSettings.key, AppSettings.value)
            .where { AppSettings.key inList keys }
            .map { it[AppSettings.key] to it[AppSettings.value] }
            .toList()
            .toMap()
    }

    /**
     * Upserts one setting. Update-then-insert rather than a DB upsert: writes are rare,
     * ADMIN-only actions, so the lost-race window is irrelevant (and the V47 seed guarantees
     * the pulse keys exist from first boot anyway).
     */
    suspend fun put(key: String, value: String): Unit = suspendTransaction(database) {
        val updated = AppSettings.update({ AppSettings.key eq key }) {
            it[AppSettings.value] = value
        }
        if (updated == 0) {
            AppSettings.insert {
                it[AppSettings.key] = key
                it[AppSettings.value] = value
            }
        }
    }
}
