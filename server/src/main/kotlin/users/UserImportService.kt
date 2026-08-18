package ch.nokillswit.users

import ch.nokillswit.audit.audit
import ch.nokillswit.auth.generatePassword
import ch.nokillswit.auth.hashPassword
import ch.nokillswit.dictionaries.DEFAULT_LANGUAGE
import ch.nokillswit.infra.mail.Mailer
import ch.nokillswit.plugins.isUniqueViolation
import org.slf4j.Logger

/**
 * The effectful half of the mass CSV import — the per-row create/classify/email loop, the
 * per-row and summary audit events, and the tally (`users/UserImport.kt` holds the pure
 * parser; the route keeps authz, the caps, and the mail-availability 503). A route-local
 * collaborator (the LoginThrottle shape): constructed inside `configureUserRoutes`, where its
 * mail deps live — no AttributeKey.
 */
internal class UserImportService(
    private val userService: UserService,
    private val mailer: Mailer?,
    private val mailAppUrl: String?,
    private val log: Logger,
) {
    /** Imports [parsed] rows independently; returns the response the route sends verbatim. */
    suspend fun import(parsed: List<ImportLine>, sendEmails: Boolean, callerId: UInt): UserImportResponse {
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
                "byUserId" to callerId.toLong(),
                "newUserId" to id.toLong(),
                "email" to email,
                "roles" to "",
            )
            var status = UserImportStatus.CREATED
            var message: String? = null
            if (sendEmails) {
                try {
                    mailer!!.send(
                        email,
                        WELCOME_EMAIL_SUBJECT.of(DEFAULT_LANGUAGE),
                        // Imported users default to English (the CSV stays two-column).
                        welcomeEmailBody(name, email, password, mailAppUrl, DEFAULT_LANGUAGE),
                    )
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
            "byUserId" to callerId.toLong(),
            "total" to rows.size,
            "created" to created,
            "duplicates" to duplicates,
            "errors" to errors,
            "emailsSent" to if (sendEmails) rows.count { it.status == UserImportStatus.CREATED } else 0,
        )
        return UserImportResponse(rows, created, duplicates, errors)
    }
}
