package ch.nokillswit.users

import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.singleOrNull
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.r2dbc.select

/**
 * [userId]'s display name, or null when no such user exists (soft-deleted users keep their
 * name — event/notification params render it as historical fact). The shared lookup behind
 * every feature service's notification/event naming (the `ManagementChain.kt` idiom: one
 * implementation, callers bind their own transaction and fallback string).
 * Runs in the caller's transaction.
 */
suspend fun userNameOf(userId: UInt): String? =
    UserService.Users
        .select(UserService.Users.name)
        .where { UserService.Users.id eq userId }
        .map { it[UserService.Users.name] }
        .singleOrNull()
