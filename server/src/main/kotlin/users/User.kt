package ch.nokillswit.users

import kotlinx.serialization.Serializable

@Serializable
data class ExposedUser(
    val name: String,
    val age: Int,
    val email: String,
    val passwordHash: String,
)
