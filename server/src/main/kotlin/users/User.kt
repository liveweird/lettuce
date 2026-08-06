package ch.nokillswit.users

import ch.nokillswit.dictionaries.DictionaryEntry
import ch.nokillswit.infra.paging.PageResponse
import kotlinx.serialization.Serializable

/**
 * Additional roles a user may hold. Every user is implicitly a regular user (USER is never
 * stored or transmitted); values here only ever ADD privileges on top of that baseline.
 * A future role is just a new value — no migration needed (user_roles has no CHECK).
 *
 * [ADMIN] — the management role: write access to users, teams, templates, and alerts (plus the
 * reads those screens need); NO special rights over feedbacks, 1:1s, goals, or notifications.
 * [HR] — read-only auditor: reads every user, feedback, 1:1, and goal (drafts included), zero
 * write or management privileges; HR-privileged reads are audit-logged (`hr.read`/`hr.list`).
 */
@Serializable
enum class UserRole { ADMIN, HR }

@Serializable
data class User(
    val name: String,
    val email: String,
    val passwordHash: String,
    val roles: Set<UserRole> = emptySet(),
    // Reversible admin disable (V44) — orthogonal to the soft-delete. Blocks login (403 after
    // the password verifies), refresh, password reset, and NEW assignments; historical data
    // stays readable with unchanged rights. Never client-settable via PUT — flipped only by
    // POST /users/{id}/deactivate|activate.
    val deactivated: Boolean = false,
    // Epoch millis of the last password change (0 = never). Server-internal; used to
    // invalidate refresh tokens minted before the change (see /api/v1/refresh).
    val passwordChangedAt: Long = 0,
    // Career profile: ids into dictionary_entries (CAREER_PATH / CAREER_SPECIALIZATION /
    // SENIORITY_LEVEL). Values are resolved at read time so dictionary renames propagate;
    // a soft-deleted referenced entry keeps resolving to its retained value.
    val careerPathId: UInt? = null,
    val careerSpecializationId: UInt? = null,
    val seniorityLevelId: UInt? = null,
    // Annual paid days-off allowance in whole days (V38). Null = not configured = zero paid
    // budget. ADMIN-only assignable; the current value applies to every calendar year.
    val paidDaysOffAllowance: Int? = null,
)

@Serializable
data class UserRequest(
    val name: String,
    val email: String,
    val password: String,
    val roles: List<UserRole>? = null,
    // Create only (PUT ignores it): email the new user their credentials (users/WelcomeEmail.kt),
    // like the mass import's sendEmails option. 503 on a mail-less deployment.
    val sendEmail: Boolean = false,
    // Optional career profile refs — each must be an ACTIVE entry of its dictionary (400 otherwise).
    val careerPathId: UInt? = null,
    val careerSpecializationId: UInt? = null,
    val seniorityLevelId: UInt? = null,
    // Optional paid days-off allowance in whole days (0–365) — ADMIN-only.
    val paidDaysOffAllowance: Int? = null,
)

@Serializable
data class UserCreateResponse(
    val id: UInt,
    val name: String,
    val email: String,
    val roles: List<UserRole>,
    // Only present when the create requested an email: true = handed to SMTP, false = delivery
    // failed (the account exists either way — the modal still shows the password).
    val emailSent: Boolean? = null,
    // No defaults: every construction site must resolve them, and the keys are always emitted.
    val careerPath: DictionaryEntry?,
    val careerSpecialization: DictionaryEntry?,
    val seniorityLevel: DictionaryEntry?,
    val paidDaysOffAllowance: Int?,
    // Always false at creation; kept in the shape so both user-response schemas stay aligned.
    val deactivated: Boolean,
)

@Serializable
data class UserUpdateRequest(
    val name: String,
    val email: String,
    val roles: List<UserRole>,
    // Career profile refs. null/omitted = leave unchanged — a set value can never be cleared
    // (there is deliberately no way to express clearing). Assigning or changing any of them
    // is ADMIN-only; a newly-assigned id must be an ACTIVE entry of the matching dictionary.
    val careerPathId: UInt? = null,
    val careerSpecializationId: UInt? = null,
    val seniorityLevelId: UInt? = null,
    // Paid days-off allowance (whole days, 0–365). Same null/omitted = leave unchanged and
    // ADMIN-only-change semantics as the career refs; clearing is inexpressible.
    val paidDaysOffAllowance: Int? = null,
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
    val roles: List<UserRole>,
    // Career profile, resolved from dictionary_entries at read time (renames propagate;
    // soft-deleted entries keep resolving). No defaults — see UserCreateResponse.
    val careerPath: DictionaryEntry?,
    val careerSpecialization: DictionaryEntry?,
    val seniorityLevel: DictionaryEntry?,
    // Rides the response like the career fields (visible wherever a user row is readable —
    // the same posture as seniority level); managers consume the derived numbers via
    // GET /days-off/budgets.
    val paidDaysOffAllowance: Int?,
    // Reversible admin disable — the ONLY place the state surfaces is the admin users list
    // (Inactive badge + filter); no other feature DTO carries it by design.
    val deactivated: Boolean,
)

typealias UserPageResponse = PageResponse<UserResponse>

fun User.toResponse(id: UInt, entries: Map<UInt, DictionaryEntry>) = UserResponse(
    id,
    name,
    email,
    roles.sortedBy { it.name },
    careerPath = careerPathId?.let { entries[it] },
    careerSpecialization = careerSpecializationId?.let { entries[it] },
    seniorityLevel = seniorityLevelId?.let { entries[it] },
    paidDaysOffAllowance = paidDaysOffAllowance,
    deactivated = deactivated,
)
