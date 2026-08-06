package ch.nokillswit.users

import ch.nokillswit.audit.audit
import ch.nokillswit.auth.MAX_PASSWORD_BYTES
import ch.nokillswit.auth.exceedsBcryptLimit
import ch.nokillswit.auth.generatePassword
import ch.nokillswit.auth.hashPassword
import ch.nokillswit.auth.verifyPassword
import ch.nokillswit.infra.mail.mailAppUrl
import ch.nokillswit.infra.mail.mailer
import ch.nokillswit.infra.mail.respondMailUnavailable
import ch.nokillswit.plugins.isUniqueViolation
import ch.nokillswit.authz.ConflictException
import ch.nokillswit.authz.ForbiddenException
import ch.nokillswit.authz.caller
import ch.nokillswit.authz.requireAdmin
import ch.nokillswit.authz.requireCanAssignPaidDaysOffAllowance
import ch.nokillswit.authz.requireCanAssignProfileFields
import ch.nokillswit.authz.requireCanAssignRoles
import ch.nokillswit.authz.requireSelfOrAdmin
import ch.nokillswit.authz.requireUserRead
import ch.nokillswit.daysoff.MAX_PAID_DAYS_OFF_ALLOWANCE
import ch.nokillswit.dictionaries.Dictionary
import ch.nokillswit.notifications.Notification
import ch.nokillswit.notifications.NotificationServiceKey
import ch.nokillswit.notifications.NotificationType
import ch.nokillswit.infra.paging.parsePaging
import ch.nokillswit.infra.paging.optionalBoolean
import ch.nokillswit.infra.paging.optionalEnum
import ch.nokillswit.infra.paging.optionalString
import ch.nokillswit.infra.paging.optionalUInt
import ch.nokillswit.infra.paging.toPage
import ch.nokillswit.plugins.respondProblem
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

// Field validation (incl. the shared email rule) lives in users/Validation.kt.

/** A (dictionary, id) ref to validate — only when [requested] actually changes [current]. */
private fun changedRef(dict: Dictionary, requested: UInt?, current: UInt?): Pair<Dictionary, UInt>? =
    requested?.takeIf { it != current }?.let { dict to it }

/** Range rule for the paid days-off allowance (whole days). Runs AFTER the assign guard —
 * 403 wins over 400 for non-admins, the house convention. */
private fun validatePaidDaysOffAllowance(value: Int?) {
    if (value != null && value !in 0..MAX_PAID_DAYS_OFF_ALLOWANCE) {
        throw BadRequestException("Paid days-off allowance must be between 0 and $MAX_PAID_DAYS_OFF_ALLOWANCE days")
    }
}

/** Audit format for a roles set: comma-joined sorted names, "" = no additional roles. */
private fun Set<UserRole>.joinedNames(): String = map { it.name }.sorted().joinToString(",")

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
    }
}

// Caps for the mass import — bcrypt at cost 12 is ~100 ms per row, so the synchronous
// request must stay bounded; violating either is a clean 400.
private const val MAX_IMPORT_ROWS = 200
private const val MAX_IMPORT_CSV_CHARS = 256 * 1024

fun Application.configureUserRoutes() {
    val userService = attributes[UserServiceKey]
    // For the password-changed notification (published by configureDatabase, which loads earlier).
    val notificationService = attributes[NotificationServiceKey]
    val mailer = mailer()
    val mailAppUrl = mailAppUrl()

    routing {
        authenticate {
            get<Users> {
                call.caller()
                val paging = call.parsePaging(sortable = setOf("id", "name", "email"))
                val params = call.request.queryParameters
                val filter = UserListFilter(
                    name = params.optionalString("name"),
                    email = params.optionalString("email"),
                    role = params.optionalEnum<UserRole>("role"),
                    teamId = params.optionalUInt("teamId"),
                    deactivated = params.optionalBoolean("deactivated"),
                )
                val result = userService.list(filter, paging)
                call.respond(HttpStatusCode.OK, paging.toPage(result.items, result.total))
            }
            post<Users> {
                val caller = call.caller()
                requireAdmin(caller)
                val req = call.receive<UserRequest>()
                validateNameAndEmail(req.name, req.email)
                validatePassword(req.password)
                // The whole POST is admin-only (requireAdmin above), so no assign guard needed.
                validatePaidDaysOffAllowance(req.paidDaysOffAllowance)
                // Every requested career ref is a fresh assignment here — all must be active.
                userService.requireActiveEntries(
                    listOfNotNull(
                        changedRef(Dictionary.CAREER_PATH, req.careerPathId, null),
                        changedRef(Dictionary.CAREER_SPECIALIZATION, req.careerSpecializationId, null),
                        changedRef(Dictionary.SENIORITY_LEVEL, req.seniorityLevelId, null),
                    ),
                )
                if (req.sendEmail && mailer == null) {
                    call.respondMailUnavailable("creating with the email option")
                    return@post
                }
                val user = User(
                    name = req.name,
                    email = req.email,
                    passwordHash = hashPassword(req.password),
                    roles = req.roles?.toSet() ?: emptySet(),
                    careerPathId = req.careerPathId,
                    careerSpecializationId = req.careerSpecializationId,
                    seniorityLevelId = req.seniorityLevelId,
                    paidDaysOffAllowance = req.paidDaysOffAllowance,
                )
                val id = userService.create(user)
                val createdFields = mutableListOf<Pair<String, Any?>>(
                    "byUserId" to caller.userId.toLong(),
                    "newUserId" to id.toLong(),
                    "email" to user.email,
                    "roles" to user.roles.joinedNames(),
                )
                user.careerPathId?.let { createdFields += "careerPathId" to it.toLong() }
                user.careerSpecializationId?.let { createdFields += "careerSpecializationId" to it.toLong() }
                user.seniorityLevelId?.let { createdFields += "seniorityLevelId" to it.toLong() }
                user.paidDaysOffAllowance?.let { createdFields += "allowance" to it.toLong() }
                audit("user.created", *createdFields.toTypedArray())
                // Same welcome email as the mass import; a delivery failure keeps the account
                // (the modal still reveals the password) and is reported via emailSent=false.
                val emailSent: Boolean? = if (req.sendEmail) {
                    try {
                        mailer!!.send(
                            user.email,
                            welcomeEmailSubject(),
                            welcomeEmailBody(user.name, user.email, req.password, mailAppUrl),
                        )
                        true
                    } catch (e: Exception) {
                        log.error("Welcome email to ${user.email} failed", e)
                        false
                    }
                } else null
                call.response.header(HttpHeaders.Location, call.application.href(Users.Id(id = id)))
                val resolved = userService.resolveEntryRefs(
                    user.careerPathId,
                    user.careerSpecializationId,
                    user.seniorityLevelId,
                )
                // Plain creates keep the pre-sendEmail wire shape (no emailSent key — Ktor's
                // default Json encodes even null fields, which strict decoders reject).
                if (emailSent != null) {
                    call.respond(
                        HttpStatusCode.Created,
                        UserCreateResponse(
                            id,
                            user.name,
                            user.email,
                            user.roles.sortedBy { it.name },
                            emailSent,
                            careerPath = user.careerPathId?.let { resolved[it] },
                            careerSpecialization = user.careerSpecializationId?.let { resolved[it] },
                            seniorityLevel = user.seniorityLevelId?.let { resolved[it] },
                            paidDaysOffAllowance = user.paidDaysOffAllowance,
                            deactivated = false,
                        ),
                    )
                } else {
                    call.respond(HttpStatusCode.Created, user.toResponse(id, resolved))
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
                // lives in users/UserImport.kt; this route owns persistence, email, audit.
                val parsed = parseImportRows(req.csv)
                if (parsed.size > MAX_IMPORT_ROWS) {
                    throw BadRequestException("Too many rows (${parsed.size}; max $MAX_IMPORT_ROWS per import)")
                }

                val rows = mutableListOf<UserImportRow>()
                for (item in parsed) {
                    val (line, name, email) = when (item) {
                        is ImportLine.Invalid -> {
                            rows += item.row
                            continue
                        }
                        is ImportLine.Parsed -> item
                    }
                    val password = generatePassword()
                    val id = try {
                        // Each create is its own transaction, so one failing row never
                        // poisons its siblings.
                        userService.create(User(name, email, hashPassword(password)))
                    } catch (e: Exception) {
                        rows += if (e.isUniqueViolation()) {
                            UserImportRow(line, name, email, UserImportStatus.DUPLICATE, "Email already in use")
                        } else {
                            log.error("User import: row $line failed", e)
                            UserImportRow(line, name, email, UserImportStatus.ERROR, "Could not create the user")
                        }
                        continue
                    }
                    audit(
                        "user.created",
                        "byUserId" to caller.userId.toLong(),
                        "newUserId" to id.toLong(),
                        "email" to email,
                        "roles" to "",
                    )
                    var status = UserImportStatus.CREATED
                    var message: String? = null
                    if (req.sendEmails) {
                        try {
                            mailer!!.send(email, welcomeEmailSubject(), welcomeEmailBody(name, email, password, mailAppUrl))
                        } catch (e: Exception) {
                            log.error("User import: welcome email to $email failed", e)
                            status = UserImportStatus.EMAIL_FAILED
                            message = "The account was created but the email could not be delivered"
                        }
                    }
                    rows += UserImportRow(line, name, email, status, message, password)
                }

                // EMAIL_FAILED rows are still created accounts — they count as created.
                val created = rows.count { it.status == UserImportStatus.CREATED || it.status == UserImportStatus.EMAIL_FAILED }
                val duplicates = rows.count { it.status == UserImportStatus.DUPLICATE }
                val errors = rows.count { it.status == UserImportStatus.PARSE_ERROR || it.status == UserImportStatus.ERROR }
                audit(
                    "users.imported",
                    "byUserId" to caller.userId.toLong(),
                    "total" to rows.size,
                    "created" to created,
                    "duplicates" to duplicates,
                    "errors" to errors,
                    "emailsSent" to if (req.sendEmails) rows.count { it.status == UserImportStatus.CREATED } else 0,
                )
                call.respond(HttpStatusCode.OK, UserImportResponse(rows, created, duplicates, errors))
            }
            get<Users.Id> { route ->
                requireUserRead(call.caller(), route.id)
                val user = userService.read(route.id)
                if (user != null) {
                    val resolved = userService.resolveEntryRefs(
                        user.careerPathId,
                        user.careerSpecializationId,
                        user.seniorityLevelId,
                    )
                    call.respond(HttpStatusCode.OK, user.toResponse(route.id, resolved))
                } else {
                    call.respondProblem(HttpStatusCode.NotFound, "User not found")
                }
            }
            put<Users.Id> { route ->
                val caller = call.caller()
                requireSelfOrAdmin(caller, route.id)
                val req = call.receive<UserUpdateRequest>()
                val existing = userService.read(route.id)
                if (existing == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "User not found")
                    return@put
                }
                // Authz before validation: an unauthorized roles/profile change is 403, not 400.
                requireCanAssignRoles(caller, existing.roles, req.roles.toSet())
                requireCanAssignProfileFields(
                    caller,
                    req.careerPathId to existing.careerPathId,
                    req.careerSpecializationId to existing.careerSpecializationId,
                    req.seniorityLevelId to existing.seniorityLevelId,
                )
                requireCanAssignPaidDaysOffAllowance(caller, req.paidDaysOffAllowance, existing.paidDaysOffAllowance)
                validateNameAndEmail(req.name, req.email)
                validatePaidDaysOffAllowance(req.paidDaysOffAllowance)
                // Validate only the CHANGED refs — resubmitting the current id (even one whose
                // entry is now soft-deleted) is not a change. null = leave unchanged: a set
                // value can never be cleared, by construction.
                userService.requireActiveEntries(
                    listOfNotNull(
                        changedRef(Dictionary.CAREER_PATH, req.careerPathId, existing.careerPathId),
                        changedRef(Dictionary.CAREER_SPECIALIZATION, req.careerSpecializationId, existing.careerSpecializationId),
                        changedRef(Dictionary.SENIORITY_LEVEL, req.seniorityLevelId, existing.seniorityLevelId),
                    ),
                )
                val user = User(
                    name = req.name,
                    email = req.email,
                    passwordHash = existing.passwordHash,
                    roles = req.roles.toSet(),
                    careerPathId = req.careerPathId ?: existing.careerPathId,
                    careerSpecializationId = req.careerSpecializationId ?: existing.careerSpecializationId,
                    seniorityLevelId = req.seniorityLevelId ?: existing.seniorityLevelId,
                    paidDaysOffAllowance = req.paidDaysOffAllowance ?: existing.paidDaysOffAllowance,
                )
                val updated = userService.update(route.id, user)
                if (updated == 0) {
                    call.respondProblem(HttpStatusCode.NotFound, "User not found")
                } else {
                    // Name and email are identity/security-relevant (email is the login identifier),
                    // career refs shape the org directory; audit with deltas only for the fields
                    // that actually changed.
                    val profileChanged = user.careerPathId != existing.careerPathId ||
                        user.careerSpecializationId != existing.careerSpecializationId ||
                        user.seniorityLevelId != existing.seniorityLevelId ||
                        user.paidDaysOffAllowance != existing.paidDaysOffAllowance
                    if (req.name != existing.name || req.email != existing.email || profileChanged) {
                        val auditFields = mutableListOf<Pair<String, Any?>>(
                            "byUserId" to caller.userId.toLong(),
                            "targetUserId" to route.id.toLong(),
                        )
                        if (req.name != existing.name) {
                            auditFields += "nameFrom" to existing.name
                            auditFields += "nameTo" to req.name
                        }
                        if (req.email != existing.email) {
                            auditFields += "emailFrom" to existing.email
                            auditFields += "emailTo" to req.email
                        }
                        // Entry ids, not values (ids are stable under renames; never log content
                        // that isn't). From is omitted when the field was previously unset.
                        fun delta(field: String, from: UInt?, to: UInt?) {
                            if (to != null && to != from) {
                                from?.let { auditFields += "${field}From" to it.toLong() }
                                auditFields += "${field}To" to to.toLong()
                            }
                        }
                        delta("careerPath", existing.careerPathId, user.careerPathId)
                        delta("careerSpecialization", existing.careerSpecializationId, user.careerSpecializationId)
                        delta("seniorityLevel", existing.seniorityLevelId, user.seniorityLevelId)
                        // The allowance shapes the paid-days budget — worth its own delta line
                        // (From omitted when previously unset, like the career refs).
                        if (user.paidDaysOffAllowance != existing.paidDaysOffAllowance) {
                            existing.paidDaysOffAllowance?.let { auditFields += "allowanceFrom" to it.toLong() }
                            auditFields += "allowanceTo" to user.paidDaysOffAllowance!!.toLong()
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
                    if (existing == null) {
                        call.respondProblem(HttpStatusCode.NotFound, "User not found")
                        return@put
                    }
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
                    call.respondProblem(HttpStatusCode.NotFound, "User not found")
                } else {
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
            }
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
                if (existing == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "User not found")
                    return
                }
                if (existing.deactivated == deactivate) {
                    throw ConflictException(
                        if (deactivate) "The account is already deactivated" else "The account is not deactivated",
                    )
                }
                if (userService.setDeactivated(targetId, deactivate) == 0) {
                    call.respondProblem(HttpStatusCode.NotFound, "User not found")
                    return
                }
                audit(
                    if (deactivate) "user.deactivated" else "user.reactivated",
                    "byUserId" to caller.userId.toLong(),
                    "targetUserId" to targetId.toLong(),
                )
                call.respond(HttpStatusCode.NoContent)
            }
            post<Users.Id.Deactivate> { route -> setAccountDeactivated(call, route.parent.id, true) }
            post<Users.Id.Activate> { route -> setAccountDeactivated(call, route.parent.id, false) }
            delete<Users.Id> { route ->
                val caller = call.caller()
                requireAdmin(caller)
                if (userService.delete(route.id) == 0) {
                    call.respondProblem(HttpStatusCode.NotFound, "User not found")
                } else {
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
}
