package ch.nokillswit.users

import ch.nokillswit.audit.audit
import ch.nokillswit.auth.generatePassword
import ch.nokillswit.auth.hashPassword
import ch.nokillswit.auth.verifyPassword
import ch.nokillswit.infra.mail.mailAppUrl
import ch.nokillswit.infra.mail.mailer
import ch.nokillswit.infra.mail.respondMailUnavailable
import ch.nokillswit.plugins.isUniqueViolation
import ch.nokillswit.authz.ForbiddenException
import ch.nokillswit.authz.caller
import ch.nokillswit.authz.requireAdmin
import ch.nokillswit.authz.requireCanAssignRole
import ch.nokillswit.authz.requireSelfOrAdmin
import ch.nokillswit.infra.paging.parsePaging
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

// Field validation (incl. the shared email rule) lives in users/Validation.kt.

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
    }
}

// Caps for the mass import — bcrypt at cost 12 is ~100 ms per row, so the synchronous
// request must stay bounded; violating either is a clean 400.
private const val MAX_IMPORT_ROWS = 200
private const val MAX_IMPORT_CSV_CHARS = 256 * 1024

fun Application.configureUserRoutes() {
    val userService = attributes[UserServiceKey]
    val mailer = mailer()
    val mailAppUrl = mailAppUrl()

    routing {
        authenticate {
            get<Users> {
                call.caller()
                val paging = call.parsePaging(sortable = setOf("id", "name", "email", "role"))
                val params = call.request.queryParameters
                val filter = UserListFilter(
                    name = params.optionalString("name"),
                    email = params.optionalString("email"),
                    role = params.optionalEnum<UserRole>("role"),
                    teamId = params.optionalUInt("teamId"),
                )
                val result = userService.list(filter, paging)
                call.respond(HttpStatusCode.OK, paging.toPage(result.items, result.total))
            }
            post<Users> {
                val caller = call.caller()
                requireAdmin(caller)
                val req = call.receive<UserRequest>()
                validateNameAndEmail(req.name, req.email)
                if (req.password.length < MIN_PASSWORD_LENGTH) {
                    throw BadRequestException("Password must be at least $MIN_PASSWORD_LENGTH characters")
                }
                if (req.sendEmail && mailer == null) {
                    call.respondMailUnavailable("creating with the email option")
                    return@post
                }
                val user = User(
                    name = req.name,
                    email = req.email,
                    passwordHash = hashPassword(req.password),
                    role = req.role ?: UserRole.USER,
                )
                val id = userService.create(user)
                audit(
                    "user.created",
                    "byUserId" to caller.userId.toLong(),
                    "newUserId" to id.toLong(),
                    "email" to user.email,
                    "role" to user.role.name,
                )
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
                // Plain creates keep the pre-sendEmail wire shape (no emailSent key — Ktor's
                // default Json encodes even null fields, which strict decoders reject).
                if (emailSent != null) {
                    call.respond(HttpStatusCode.Created, UserCreateResponse(id, user.name, user.email, user.role, emailSent))
                } else {
                    call.respond(HttpStatusCode.Created, user.toResponse(id))
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
                        userService.create(User(name, email, hashPassword(password), UserRole.USER))
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
                        "role" to UserRole.USER.name,
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
                requireSelfOrAdmin(call.caller(), route.id)
                val user = userService.read(route.id)
                if (user != null) {
                    call.respond(HttpStatusCode.OK, user.toResponse(route.id))
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
                // Authz before validation: an unauthorized role change is 403, not 400.
                requireCanAssignRole(caller, existing.role, req.role)
                validateNameAndEmail(req.name, req.email)
                val user = User(
                    name = req.name,
                    email = req.email,
                    passwordHash = existing.passwordHash,
                    role = req.role,
                )
                val updated = userService.update(route.id, user)
                if (updated == 0) {
                    call.respondProblem(HttpStatusCode.NotFound, "User not found")
                } else {
                    if (req.role != existing.role) {
                        audit(
                            "user.role_changed",
                            "byUserId" to caller.userId.toLong(),
                            "targetUserId" to route.id.toLong(),
                            "from" to existing.role.name,
                            "to" to req.role.name,
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
                if (req.password.length < MIN_PASSWORD_LENGTH) {
                    throw BadRequestException("Password must be at least $MIN_PASSWORD_LENGTH characters")
                }
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
                    call.respond(HttpStatusCode.NoContent)
                }
            }
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
