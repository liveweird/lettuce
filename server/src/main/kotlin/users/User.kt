package ch.nokillswit.users

import ch.nokillswit.infra.paging.PageResponse
import kotlinx.serialization.Serializable

@Serializable
enum class UserRole { ADMIN, USER }

@Serializable
data class User(
    val name: String,
    val email: String,
    val passwordHash: String,
    val role: UserRole = UserRole.USER,
    // Epoch millis of the last password change (0 = never). Server-internal; used to
    // invalidate refresh tokens minted before the change (see /api/v1/refresh).
    val passwordChangedAt: Long = 0,
)

@Serializable
data class UserRequest(
    val name: String,
    val email: String,
    val password: String,
    val role: UserRole? = null,
)

@Serializable
data class UserUpdateRequest(
    val name: String,
    val email: String,
    val role: UserRole,
)

@Serializable
data class PasswordUpdateRequest(
    val password: String,
    // Required when a caller changes their OWN password (even an admin); not required
    // for an admin resetting somebody else's.
    val currentPassword: String? = null,
)

@Serializable
data class UserResponse(
    val id: UInt,
    val name: String,
    val email: String,
    val role: UserRole,
)

typealias UserPageResponse = PageResponse<UserResponse>

fun User.toResponse(id: UInt) = UserResponse(id, name, email, role)
