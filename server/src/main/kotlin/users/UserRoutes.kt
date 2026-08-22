package ch.nokillswit.users

import ch.nokillswit.audit.audit
import ch.nokillswit.auth.MAX_PASSWORD_BYTES
import ch.nokillswit.auth.exceedsBcryptLimit
import ch.nokillswit.auth.hashPassword
import ch.nokillswit.auth.verifyPassword
import ch.nokillswit.dictionaries.DEFAULT_LANGUAGE
import ch.nokillswit.infra.mail.mailAppUrl
import ch.nokillswit.infra.validation.sanitizeSingleLine
import ch.nokillswit.infra.mail.mailer
import ch.nokillswit.infra.mail.respondMailUnavailable
import ch.nokillswit.authz.ConflictException
import ch.nokillswit.authz.ForbiddenException
import ch.nokillswit.authz.NotFoundException
import ch.nokillswit.authz.caller
import ch.nokillswit.authz.isHr
import ch.nokillswit.authz.requireAdmin
import ch.nokillswit.authz.requireCanAssignRoles
import ch.nokillswit.authz.requireCanAssignUniqueId
import ch.nokillswit.authz.requireSelfOrAdmin
import ch.nokillswit.authz.requireUserRead
import ch.nokillswit.notifications.Notification
import ch.nokillswit.notifications.NotificationServiceKey
import ch.nokillswit.notifications.NotificationType
import ch.nokillswit.infra.paging.parsePaging
import ch.nokillswit.infra.paging.optionalBoolean
import ch.nokillswit.infra.paging.optionalEnum
import ch.nokillswit.infra.paging.optionalString
import ch.nokillswit.infra.paging.optionalUInt
import ch.nokillswit.infra.paging.toPage
import java.time.LocalDate
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.resources.Resource
import io.ktor.server.application.*
import io.ktor.server.auth.authenticate
import io.ktor.server.plugins.BadRequestException
import io.ktor.server.request.receive
import io.ktor.server.resources.delete
import io.ktor.server.resources.get
import io.ktor.server.resources.href
import io.ktor.server.resources.post
import io.ktor.server.resources.put
import io.ktor.server.response.header
import io.ktor.server.response.respond
import io.ktor.server.routing.routing
import kotlinx.serialization.Serializable

/** Minimum accepted password length for create and change. */
const val MIN_PASSWORD_LENGTH = 10

/** Shared password rule for create and change: the minimum plus bcrypt's byte ceiling. */
internal fun validatePassword(password: String) {
    if (password.length < MIN_PASSWORD_LENGTH) {
        throw BadRequestException("Password must be at least $MIN_PASSWORD_LENGTH characters")
    }
    // Longer input would make bcrypt throw (a 500) — see MAX_PASSWORD_BYTES in auth/Passwords.kt.
    if (exceedsBcryptLimit(password)) {
        throw BadRequestException("Password must be at most $MAX_PASSWORD_BYTES bytes in UTF-8")
    }
}

// Field validation (incl. the shared email rule) lives in users/Validation.kt. (The paid
// days-off allowance rule moved to daysoff/DaysOff.kt in v2.32.0 with its endpoint.)

/** Audit format for a roles/features set: comma-joined sorted names, "" = empty set. */
private fun <T : Enum<T>> Set<T>.joinedNames(): String = map { it.name }.sorted().joinToString(",")

@Serializable
@Resource("/api/v1/users")
class Users {
    @Serializable
    @Resource("import")
    class Import(val parent: Users = Users())

    @Serializable
    @Resource("{id}")
    class Id(val parent: Users = Users(), val id: UInt) {
        @Serializable
        @Resource("password")
        class Password(val parent: Id)

        @Serializable
        @Resource("deactivate")
        class Deactivate(val parent: Id)

        @Serializable
        @Resource("activate")
        class Activate(val parent: Id)

        @Serializable
        @Resource("features")
        class Features(val parent: Id)

        @Serializable
        @Resource("email-notifications")
        class EmailNotifications(val parent: Id)

        @Serializable
        @Resource("language")
        class Language(val parent: Id)
    }
}

// Caps for the mass import — bcrypt at cost 12 is ~100 ms per row, so the synchronous
// request must stay bounded; violating either is a clean 400.
private const val MAX_IMPORT_ROWS = 200
private const val MAX_IMPORT_CSV_CHARS = 256 * 1024

fun Application.configureUserRoutes() {
    val userService = attributes[UserServiceKey]
    val careerPositionService = attributes[CareerPositionServiceKey]
    // For the password-changed notification (published by configureDatabase, which loads earlier).
    val notificationService = attributes[NotificationServiceKey]
    val mailer = mailer()
    val mailAppUrl = mailAppUrl()
    val importService = UserImportService(userService, mailer, mailAppUrl, log)

    // Reversible deactivation — the goals-transition shape (POST action, same-state 409).
    // Deliberately NOT a PUT field: the update route's whole-row write must never be able
    // to flip account state, and a boolean can't carry "omitted = unchanged".
    suspend fun setAccountDeactivated(call: ApplicationCall, targetId: UInt, deactivate: Boolean) {
        val caller = call.caller()
        requireAdmin(caller)
        // Reversible ≠ harmless: an admin locking themselves out (possibly of the only
        // admin account) is a support ticket — self-deactivation is blocked. The check
        // runs before the read so it 403s uniformly (the deactivate direction only:
        // self-reactivation is unreachable — a deactivated caller cannot hold a session).
        if (deactivate && caller.userId == targetId) {
            throw ForbiddenException("You cannot deactivate your own account")
        }
        val existing = userService.read(targetId)
            ?: throw NotFoundException("User not found")
        if (existing.deactivated == deactivate) {
            throw ConflictException(
                if (deactivate) "The account is already deactivated" else "The account is not deactivated",
            )
        }
        if (userService.setDeactivated(targetId, deactivate) == 0) {
            throw NotFoundException("User not found")
        }
        // Career timeline side effect (v2.17.0): deactivation closes the final active
        // position on the deactivation date; reactivation reopens it. Own transaction
        // after the flag commit — the app's documented non-atomic side-effect shape.
        val auditFields = mutableListOf<Pair<String, Any?>>(
            "byUserId" to caller.userId.toLong(),
            "targetUserId" to targetId.toLong(),
        )
        if (deactivate) {
            val endDate = LocalDate.now().toString()
            careerPositionService.closeFinalPosition(targetId, endDate)?.let {
                auditFields += "careerPositionId" to it.toLong()
                auditFields += "careerPositionEndDate" to endDate
            }
        } else {
            careerPositionService.reopenFinalPosition(targetId)?.let {
                auditFields += "careerPositionId" to it.toLong()
            }
        }
        audit(
            if (deactivate) "user.deactivated" else "user.reactivated",
            *auditFields.toTypedArray(),
        )
        call.respond(HttpStatusCode.NoContent)
    }

    routing {
        authenticate {
            get<Users> {
                val caller = call.caller()
                val paging = call.parsePaging(sortable = setOf("id", "name", "email", "uniqueId"))
                val params = call.request.queryParameters
                // Feature-flag state filter: the pair must come together — a feature without a
                // direction (or vice versa) is ambiguous, so a lone half is a clean 400.
                val feature = params.optionalEnum<Feature>("feature")
                val featureEnabled = params.optionalBoolean("featureEnabled")
                if ((feature == null) != (featureEnabled == null)) {
                    throw BadRequestException("feature and featureEnabled must be provided together")
                }
                val filter = UserListFilter(
                    name = params.optionalString("name"),
                    email = params.optionalString("email"),
                    role = params.optionalEnum<UserRole>("role"),
                    teamId = params.optionalUInt("teamId"),
                    deactivated = params.optionalBoolean("deactivated"),
                    feature = feature,
                    featureEnabled = featureEnabled,
                    uniqueId = params.optionalString("uniqueId"),
                    uniqueIdMissing = params.optionalBoolean("uniqueIdMissing"),
                )
                // Seniority is private (v2.25.0): blanked outside the caller's chain unless HR.
                val result = userService.list(filter, paging, caller.userId, caller.isHr())
                call.respond(HttpStatusCode.OK, paging.toPage(result.items, result.total))
            }
            post<Users> {
                val caller = call.caller()
                requireAdmin(caller)
                val req = call.receive<UserRequest>()
                // Canonical identity fields (v2.35.0): name/unique-id trimmed + control-char
                // checked, email folded (MT-001/MT-002) — before validation and every use.
                val name = sanitizeSingleLine(req.name, "Name")
                val email = canonicalEmail(req.email)
                val uniqueId = req.uniqueId?.let { sanitizeSingleLine(it, "Unique id") }
                validateNameAndEmail(name, email)
                validatePassword(req.password)
                validateUniqueId(uniqueId)
                validateLanguage(req.language)
                if (req.sendEmail && mailer == null) {
                    call.respondMailUnavailable("creating with the email option")
                    return@post
                }
                // Pre-check for the specific 409 detail (the SPA attributes it to the right
                // field); the V59 partial index stays the race backstop (generic 409).
                if (uniqueId != null && userService.uniqueIdInUse(uniqueId)) {
                    throw ConflictException("Unique id already in use")
                }
                val user = User(
                    name = name,
                    email = email,
                    passwordHash = hashPassword(req.password),
                    roles = req.roles?.toSet() ?: emptySet(),
                    uniqueId = uniqueId,
                    language = req.language ?: DEFAULT_LANGUAGE,
                )
                val id = userService.create(user)
                val createdFields = mutableListOf<Pair<String, Any?>>(
                    "byUserId" to caller.userId.toLong(),
                    "newUserId" to id.toLong(),
                    "email" to user.email,
                    "roles" to user.roles.joinedNames(),
                )
                user.uniqueId?.let { createdFields += "uniqueId" to it }
                if (user.language != DEFAULT_LANGUAGE) createdFields += "language" to user.language
                audit("user.created", *createdFields.toTypedArray())
                // Same welcome email as the mass import; a delivery failure keeps the account
                // (the modal still reveals the password) and is reported via emailSent=false.
                val emailSent: Boolean? = if (req.sendEmail) {
                    try {
                        mailer!!.send(
                            user.email,
                            WELCOME_EMAIL_SUBJECT.of(user.language),
                            welcomeEmailBody(user.name, user.email, req.password, mailAppUrl, user.language),
                        )
                        true
                    } catch (e: Exception) {
                        log.error("Welcome email to ${user.email} failed", e)
                        false
                    }
                } else null
                call.response.header(HttpHeaders.Location, call.application.href(Users.Id(id = id)))
                // Plain creates keep the pre-sendEmail wire shape (no emailSent key — Ktor's
                // default Json encodes even null fields, which strict decoders reject). The
                // career triple is always null here: a new user has no positions yet (v2.15.0).
                if (emailSent != null) {
                    call.respond(
                        HttpStatusCode.Created,
                        UserCreateResponse(
                            id,
                            user.name,
                            user.email,
                            user.roles.sortedBy { it.name },
                            emailSent,
                            careerPath = null,
                            careerSpecialization = null,
                            seniorityLevel = null,
                            deactivated = false,
                            disabledFeatures = listOf(Feature.MFA),
                            emailNotificationsEnabled = true,
                            uniqueId = user.uniqueId,
                            language = user.language,
                        ),
                    )
                } else {
                    // create() stored the inverted-default MFA row — report the actual state.
                    call.respond(
                        HttpStatusCode.Created,
                        user.copy(disabledFeatures = setOf(Feature.MFA)).toResponse(id, profile = null),
                    )
                }
            }
            post<Users.Import> {
                val caller = call.caller()
                requireAdmin(caller)
                val req = call.receive<UserImportRequest>()
                if (req.sendEmails && mailer == null) {
                    call.respondMailUnavailable("importing with the email option")
                    return@post
                }
                if (req.csv.length > MAX_IMPORT_CSV_CHARS) {
                    throw BadRequestException("CSV is too large (max $MAX_IMPORT_CSV_CHARS characters)")
                }

                // The pure half (line splitting, header/blank skipping, field validation)
                // lives in users/UserImport.kt; the effectful per-row loop (persistence,
                // email, audit) in users/UserImportService.kt.
                val parsed = parseImportRows(req.csv)
                if (parsed.size > MAX_IMPORT_ROWS) {
                    throw BadRequestException("Too many rows (${parsed.size}; max $MAX_IMPORT_ROWS per import)")
                }
                call.respond(HttpStatusCode.OK, importService.import(parsed, req.sendEmails, caller.userId))
            }
            get<Users.Id> { route ->
                val caller = call.caller()
                requireUserRead(caller, route.id)
                val user = userService.read(route.id)
                    ?: throw NotFoundException("User not found")
                // The triple = the user's current position (absent from the map = none).
                val profile = userService.careerProfilesByUserIds(setOf(route.id))[route.id]
                // Seniority is private (v2.25.0): here the guard already admitted self/ADMIN/HR,
                // so the blanking only ever bites an ADMIN outside the target's chain.
                val canSeeSeniority = caller.userId == route.id || caller.isHr() ||
                    careerPositionService.managesUser(caller.userId, route.id)
                val visible = if (canSeeSeniority) profile else profile?.copy(seniorityLevel = null)
                call.respond(HttpStatusCode.OK, user.toResponse(route.id, visible))
            }
            put<Users.Id> { route ->
                val caller = call.caller()
                requireSelfOrAdmin(caller, route.id)
                val req = call.receive<UserUpdateRequest>()
                val existing = userService.read(route.id)
                    ?: throw NotFoundException("User not found")
                // Authz before validation: an unauthorized roles/unique-id change is 403, not 400.
                requireCanAssignRoles(caller, existing.roles, req.roles.toSet())
                requireCanAssignUniqueId(caller, req.uniqueId, existing.uniqueId)
                // Canonical identity fields (v2.35.0, MT-001/MT-002) — after the guards
                // (403 wins over 400), before validation and every use below.
                val name = sanitizeSingleLine(req.name, "Name")
                val email = canonicalEmail(req.email)
                val uniqueId = req.uniqueId?.let { sanitizeSingleLine(it, "Unique id") }
                validateNameAndEmail(name, email)
                validateUniqueId(uniqueId)
                // Pre-check for the specific 409 detail (POST precedent); the partial index
                // stays the race backstop. Excluding self keeps a same-value resubmit a no-op.
                if (uniqueId != null && uniqueId != existing.uniqueId &&
                    userService.uniqueIdInUse(uniqueId, excludeId = route.id)
                ) {
                    throw ConflictException("Unique id already in use")
                }
                val user = User(
                    name = name,
                    email = email,
                    passwordHash = existing.passwordHash,
                    roles = req.roles.toSet(),
                    uniqueId = uniqueId ?: existing.uniqueId,
                )
                val updated = userService.update(route.id, user)
                if (updated == 0) {
                    throw NotFoundException("User not found")
                }
                // Name and email are identity/security-relevant (email is the login
                // identifier); audit with deltas only for the fields that actually changed.
                // (Career changes moved to the career_position.* events in v2.15.0, the
                // allowance to days_off.allowance_changed in v2.32.0.)
                val uniqueIdChanged = user.uniqueId != existing.uniqueId
                if (name != existing.name || email != existing.email || uniqueIdChanged) {
                    val auditFields = mutableListOf<Pair<String, Any?>>(
                        "byUserId" to caller.userId.toLong(),
                        "targetUserId" to route.id.toLong(),
                    )
                    if (name != existing.name) {
                        auditFields += "nameFrom" to existing.name
                        auditFields += "nameTo" to name
                    }
                    if (email != existing.email) {
                        auditFields += "emailFrom" to existing.email
                        auditFields += "emailTo" to email
                    }
                    // From omitted when previously unset.
                    if (uniqueIdChanged) {
                        existing.uniqueId?.let { auditFields += "uniqueIdFrom" to it }
                        auditFields += "uniqueIdTo" to user.uniqueId!!
                    }
                    audit("user.updated", *auditFields.toTypedArray())
                }
                if (req.roles.toSet() != existing.roles) {
                    audit(
                        "user.roles_changed",
                        "byUserId" to caller.userId.toLong(),
                        "targetUserId" to route.id.toLong(),
                        "from" to existing.roles.joinedNames(),
                        "to" to req.roles.toSet().joinedNames(),
                    )
                }
                call.respond(HttpStatusCode.NoContent)
            }
            put<Users.Id.Password> { route ->
                val caller = call.caller()
                requireSelfOrAdmin(caller, route.parent.id)
                val req = call.receive<PasswordUpdateRequest>()
                // Changing one's OWN password always requires the current one (even for an admin);
                // an admin resetting somebody else's does not. Read before update so a wrong
                // current password never mutates anything. Checked BEFORE the length validation
                // so 403 wins over 400 (the convention everywhere else).
                if (caller.userId == route.parent.id) {
                    val existing = userService.read(route.parent.id)
                        ?: throw NotFoundException("User not found")
                    if (req.currentPassword == null || !verifyPassword(req.currentPassword, existing.passwordHash)) {
                        audit(
                            "password.change_denied",
                            "targetUserId" to route.parent.id.toLong(),
                            "byUserId" to caller.userId.toLong(),
                            "reason" to "wrong_current_password",
                        )
                        throw ForbiddenException("Current password is missing or incorrect")
                    }
                }
                validatePassword(req.password)
                val updated = userService.updatePassword(route.parent.id, hashPassword(req.password))
                if (updated == 0) {
                    throw NotFoundException("User not found")
                }
                audit(
                    "password.changed",
                    "targetUserId" to route.parent.id.toLong(),
                    "byUserId" to caller.userId.toLong(),
                    "selfChange" to (caller.userId == route.parent.id),
                )
                // The affected user always learns their credential changed — a plain
                // confirmation on self-change, an "administrator changed it" wording (the
                // `self` param drives the i18next context) when someone else did.
                notificationService.create(
                    Notification(
                        recipientId = route.parent.id,
                        type = NotificationType.PASSWORD_CHANGED,
                        params = if (caller.userId == route.parent.id) emptyMap() else mapOf("self" to "admin"),
                    ),
                )
                call.respond(HttpStatusCode.NoContent)
            }
            post<Users.Id.Deactivate> { route -> setAccountDeactivated(call, route.parent.id, true) }
            post<Users.Id.Activate> { route -> setAccountDeactivated(call, route.parent.id, false) }
            // Per-user feature flags (V46): a wholesale replace of the disabled set. Deliberately
            // NOT a PUT /users/{id} field (the V44 rationale — the whole-row write must never flip
            // capability state) and deliberately WITHOUT the deactivation route's self-block: an
            // admin adjusting (or fixing) their own flags is a feature, and the users routes are
            // never gated, so a fully self-disabled admin can always find their way back here.
            put<Users.Id.Features> { route ->
                val caller = call.caller()
                requireAdmin(caller)
                // Guard before receive: a non-admin's malformed body is 403, not 400. An unknown
                // feature name fails enum decoding → BadRequestException → 400.
                val req = call.receive<UserFeaturesUpdateRequest>()
                val existing = userService.read(route.parent.id)
                    ?: throw NotFoundException("User not found")
                val requested = req.disabledFeatures.toSet()
                // A deactivated target is allowed on purpose: the flags are inert until
                // reactivation (no session exists to carry them).
                if (userService.setDisabledFeatures(route.parent.id, requested) == 0) {
                    throw NotFoundException("User not found")
                }
                if (requested != existing.disabledFeatures) {
                    audit(
                        "user.features_changed",
                        "byUserId" to caller.userId.toLong(),
                        "targetUserId" to route.parent.id.toLong(),
                        "from" to existing.disabledFeatures.joinedNames(),
                        "to" to requested.joinedNames(),
                    )
                }
                call.respond(HttpStatusCode.NoContent)
            }
            // Email-notification opt-out (V51): the self-service sibling of the features PUT —
            // requireSelfOrAdmin, not requireAdmin, because quieting one's own inbox is the whole
            // point (an admin may assist). Deliberately NOT a PUT /users/{id} field (the V44
            // rationale) and idempotent (same-value re-PUT is 204, not 409). A deactivated
            // target is allowed — the setting is inert until reactivation (the features idiom).
            put<Users.Id.EmailNotifications> { route ->
                val caller = call.caller()
                requireSelfOrAdmin(caller, route.parent.id)
                val req = call.receive<UserEmailNotificationsUpdateRequest>()
                val existing = userService.read(route.parent.id)
                    ?: throw NotFoundException("User not found")
                if (userService.setEmailNotifications(route.parent.id, req.enabled) == 0) {
                    throw NotFoundException("User not found")
                }
                if (req.enabled != existing.emailNotificationsEnabled) {
                    audit(
                        "user.email_notifications_changed",
                        "byUserId" to caller.userId.toLong(),
                        "targetUserId" to route.parent.id.toLong(),
                        "from" to existing.emailNotificationsEnabled,
                        "to" to req.enabled,
                    )
                }
                call.respond(HttpStatusCode.NoContent)
            }
            // Per-user language (V61): the email-notifications idiom verbatim — self or ADMIN
            // (the header switcher is the self-service writer; an admin may fix a mis-set
            // language), idempotent, deactivated target allowed (inert until reactivation).
            put<Users.Id.Language> { route ->
                val caller = call.caller()
                requireSelfOrAdmin(caller, route.parent.id)
                val req = call.receive<UserLanguageUpdateRequest>()
                validateLanguage(req.language)
                val existing = userService.read(route.parent.id)
                    ?: throw NotFoundException("User not found")
                if (userService.setLanguage(route.parent.id, req.language) == 0) {
                    throw NotFoundException("User not found")
                }
                if (req.language != existing.language) {
                    audit(
                        "user.language_changed",
                        "byUserId" to caller.userId.toLong(),
                        "targetUserId" to route.parent.id.toLong(),
                        "from" to existing.language,
                        "to" to req.language,
                    )
                }
                call.respond(HttpStatusCode.NoContent)
            }
            delete<Users.Id> { route ->
                val caller = call.caller()
                requireAdmin(caller)
                if (userService.delete(route.id) == 0) {
                    throw NotFoundException("User not found")
                }
                audit(
                    "user.deleted",
                    "byUserId" to caller.userId.toLong(),
                    "targetUserId" to route.id.toLong(),
                )
                call.respond(HttpStatusCode.NoContent)
            }
        }
    }
}
