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
    // Create only (PUT ignores it): email the new user their credentials (users/WelcomeEmail.kt),
    // like the mass import's sendEmails option. 503 on a mail-less deployment.
    val sendEmail: Boolean = false,
)

@Serializable
data class UserCreateResponse(
    val id: UInt,
    val name: String,
    val email: String,
    val role: UserRole,
    // Only present when the create requested an email: true = handed to SMTP, false = delivery
    // failed (the account exists either way — the modal still shows the password).
    val emailSent: Boolean? = null,
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
data class UserImportRequest(
    val csv: String,
    val sendEmails: Boolean = false,
)

@Serializable
enum class UserImportStatus {
    /** Account created (password in [UserImportRow.password], shown to the admin once). */
    CREATED,

    /** An active account with this email already exists — row skipped. */
    DUPLICATE,

    /** The line could not be parsed or failed field validation — row skipped. */
    PARSE_ERROR,

    /** Account created but the welcome email could not be delivered (password still shown). */
    EMAIL_FAILED,

    /** Any other failure — row skipped. */
    ERROR,
}

@Serializable
data class UserImportRow(
    /** 1-based line number in the uploaded file. */
    val line: Int,
    val name: String? = null,
    val email: String? = null,
    val status: UserImportStatus,
    val message: String? = null,
    val password: String? = null,
)

@Serializable
data class UserImportResponse(
    val rows: List<UserImportRow>,
    val created: Int,
    val duplicates: Int,
    val errors: Int,
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
