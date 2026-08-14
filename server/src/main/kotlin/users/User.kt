package ch.nokillswit.users

import ch.nokillswit.dictionaries.DictionaryEntry
import ch.nokillswit.infra.paging.PageResponse
import ch.nokillswit.teams.TeamRef
import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
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

/**
 * The per-user-toggleable feature areas (V46). Storage models the DISABLED set
 * (user_disabled_features) — absent = enabled, so every user defaults to full access.
 * Caller-only semantics: a disabled feature gates what the user themselves may see/execute
 * (403 on the feature's routes), never what others may create involving them. Uniform for
 * every role — HR audit reads and the ADMIN registries (review periods = PERFORMANCE_REVIEWS,
 * public holidays = DAYS_OFF) are gated exactly like ordinary use.
 * A future feature is just a new value — no migration needed (no CHECK on the column).
 *
 * [MFA] (v2.4.0) is the one deliberate deviation on both counts: it has an INVERTED DEFAULT —
 * every user starts with the disabled row present (seeded by V52 for existing users, inserted by
 * [ch.nokillswit.users.UserService.create] for new ones), so MFA is opt-in and "empty set = full
 * access" no longer implies "no rows anywhere" — and LOGIN-TIME semantics: it never gates routes
 * via requireFeatureEnabled; the login handler reads it straight off the DB record (never a JWT —
 * there is none yet) and, when enabled, demands the emailed second factor (see
 * "Email MFA" in `.claude/docs/security.md`).
 */
@Serializable
enum class Feature { FEEDBACKS, ONE_ON_ONES, GOALS, TEAM_KPIS, PERFORMANCE_REVIEWS, DAYS_OFF, PULSE_SURVEYS, MFA }

@Serializable
data class User(
    val name: String,
    val email: String,
    val passwordHash: String,
    val roles: Set<UserRole> = emptySet(),
    // Per-user feature flags (V46) — the DISABLED set, empty = full access. Rides the domain
    // object like roles so /login and /refresh mint the claim from the same read. Never
    // client-settable via PUT — replaced only by PUT /users/{id}/features (ADMIN).
    val disabledFeatures: Set<Feature> = emptySet(),
    // Reversible admin disable (V44) — orthogonal to the soft-delete. Blocks login (403 after
    // the password verifies), refresh, password reset, and NEW assignments; historical data
    // stays readable with unchanged rights. Never client-settable via PUT — flipped only by
    // POST /users/{id}/deactivate|activate.
    val deactivated: Boolean = false,
    // Epoch millis of the last password change (0 = never). Server-internal; used to
    // invalidate refresh tokens minted before the change (see /api/v1/refresh).
    val passwordChangedAt: Long = 0,
    // The career triple no longer lives on the user (v2.15.0): it derives from the LATEST
    // career position (users/CareerPositionService.kt) and is resolved response-side.
    // Annual paid days-off allowance in whole days (V38). Null = not configured = zero paid
    // budget. ADMIN-only assignable; the current value applies to every calendar year.
    val paidDaysOffAllowance: Int? = null,
    // Email-notification opt-out (V51): true (default) = every in-app notification is also
    // mirrored to the user's inbox. Never client-settable via PUT — flipped only by
    // PUT /users/{id}/email-notifications (target user or ADMIN).
    val emailNotificationsEnabled: Boolean = true,
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
    // Always null at creation since v2.15.0 (a new user has no career positions yet); the keys
    // stay in the shape so both user-response schemas stay aligned. No defaults: every
    // construction site must resolve them, and the keys are always emitted.
    val careerPath: DictionaryEntry?,
    val careerSpecialization: DictionaryEntry?,
    val seniorityLevel: DictionaryEntry?,
    val paidDaysOffAllowance: Int?,
    // Always false at creation; kept in the shape so both user-response schemas stay aligned.
    val deactivated: Boolean,
    // Always exactly [MFA] at creation (the inverted-default opt-in flag; every other
    // feature defaults enabled); aligned with UserResponse.
    val disabledFeatures: List<Feature>,
    // Always true at creation (the V51 default); aligned with UserResponse.
    val emailNotificationsEnabled: Boolean,
)

@Serializable
data class UserUpdateRequest(
    val name: String,
    val email: String,
    val roles: List<UserRole>,
    // Paid days-off allowance (whole days, 0–365). null/omitted = leave unchanged, changing
    // it is ADMIN-only; clearing is inexpressible. (The career refs left this request in
    // v2.15.0 — the position history owns them now.)
    val paidDaysOffAllowance: Int? = null,
)

/** Body of PUT /users/{id}/features — a wholesale replace of the user's disabled set. */
@Serializable
data class UserFeaturesUpdateRequest(
    val disabledFeatures: List<Feature>,
)

/** Body of PUT /users/{id}/email-notifications — the V51 email-mirror opt-out toggle. */
@Serializable
data class UserEmailNotificationsUpdateRequest(
    val enabled: Boolean,
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
    // Career profile — since v2.15.0 the user's CURRENT position (their latest career
    // position row), resolved from dictionary_entries at read time (renames propagate;
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
    // Per-user feature flags (V46) — the admin-disabled set, empty = full access.
    val disabledFeatures: List<Feature>,
    // Email-notification opt-out (V51): true = in-app notifications are mirrored by email.
    // Rides every user response (the deactivated posture) so the self-service toggle can
    // load its current state via GET /users/{id}.
    val emailNotificationsEnabled: Boolean,
    // Teams the user is a MEMBER of (non-deleted, name-ascending) — a LIST enrichment
    // (v2.1.0, backs the /feature-flags team column): computed by UserService.list only.
    // Membership only — managing a team without being on its roster does not put it here.
    // EncodeDefault(NEVER) OMITS the key when not computed (single-user/create/update
    // responses) instead of emitting `"teams": null` against the shared response schemas.
    @OptIn(ExperimentalSerializationApi::class)
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    val teams: List<TeamRef>? = null,
)

typealias UserPageResponse = PageResponse<UserResponse>

fun User.toResponse(id: UInt, profile: CareerProfile?) = UserResponse(
    id,
    name,
    email,
    roles.sortedBy { it.name },
    careerPath = profile?.careerPath,
    careerSpecialization = profile?.careerSpecialization,
    seniorityLevel = profile?.seniorityLevel,
    paidDaysOffAllowance = paidDaysOffAllowance,
    deactivated = deactivated,
    disabledFeatures = disabledFeatures.sortedBy { it.name },
    emailNotificationsEnabled = emailNotificationsEnabled,
)
