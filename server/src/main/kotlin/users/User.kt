package ch.nokillswit.users

import kotlinx.serialization.Serializable

@Serializable
data class ExposedUser(
    val name: String,
    val age: Int,
    val email: String,
    val passwordHash: String,
)

@Serializable
data class UserRequest(
    val name: String,
    val age: Int,
    val email: String,
    val password: String,
)

@Serializable
data class UserResponse(
    val id: UInt,
    val name: String,
    val age: Int,
    val email: String,
)

fun ExposedUser.toResponse(id: UInt) = UserResponse(id, name, age, email)
