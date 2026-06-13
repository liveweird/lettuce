package ch.nokillswit.users

import kotlinx.serialization.Serializable

@Serializable
enum class UserRole { ADMIN, USER }

@Serializable
data class User(
    val name: String,
    val email: String,
    val passwordHash: String,
    val role: UserRole = UserRole.USER,
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
    val role: UserRole? = null,
)

@Serializable
data class PasswordUpdateRequest(
    val password: String,
)

@Serializable
data class UserResponse(
    val id: UInt,
    val name: String,
    val email: String,
    val role: UserRole,
)

@Serializable
data class UserPageResponse(
    val items: List<UserResponse>,
    val page: Int,
    val pageSize: Int,
    val total: Long,
)

fun User.toResponse(id: UInt) = UserResponse(id, name, email, role)
