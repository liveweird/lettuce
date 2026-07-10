package ch.nokillswit

import ch.nokillswit.auth.LoginRequest
import ch.nokillswit.users.UserImportRequest
import ch.nokillswit.users.UserImportResponse
import ch.nokillswit.users.UserImportStatus
import ch.nokillswit.users.UserRole
import io.ktor.client.call.body
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** POST /api/v1/users/import — per-row CSV import with optional welcome emails. */
class UserImportTest {

    private suspend fun io.ktor.client.HttpClient.import(csv: String, sendEmails: Boolean = false) =
        post("/api/v1/users/import") {
            contentType(ContentType.Application.Json)
            setBody(UserImportRequest(csv, sendEmails))
        }

    @Test
    fun `mixed file imports independently and passwords work`() = testApplication {
        usePostgresTestcontainer()
        val admin = uniqueEmail("import-admin")
        TestUsers.seed(email = admin, password = "admin-pass-123")
        val existing = uniqueEmail("import-existing")
        TestUsers.seed(email = existing, password = "x".repeat(12), role = UserRole.USER)
        val client = authedClient(admin, "admin-pass-123")

        val a = uniqueEmail("import-a")
        val b = uniqueEmail("import-b")
        val csv = """
            name,email
            Alice Import,$a
            garbage line without comma at all... wait

            Nowak, Jan,$b
            Dup Licate,$existing
            ,missing-name@test
        """.trimIndent().replace("garbage line without comma at all... wait", "garbage-line-without-any-comma-or-at")

        val response = client.import(csv)
        assertEquals(HttpStatusCode.OK, response.status)
        val result = response.body<UserImportResponse>()

        assertEquals(5, result.rows.size, "header and blank lines are not rows: $result")
        assertEquals(2, result.created)
        assertEquals(1, result.duplicates)
        assertEquals(2, result.errors)

        val byEmail = result.rows.associateBy { it.email }
        assertEquals(UserImportStatus.CREATED, byEmail[a]?.status)
        // Name with a comma: split on the LAST comma keeps "Nowak, Jan" intact.
        assertEquals(UserImportStatus.CREATED, byEmail[b]?.status)
        assertEquals("Nowak, Jan", byEmail[b]?.name)
        assertEquals(UserImportStatus.DUPLICATE, byEmail[existing]?.status)
        assertNull(byEmail[existing]?.password, "duplicates carry no password")
        assertEquals(UserImportStatus.PARSE_ERROR, byEmail["missing-name@test"]?.status)
        assertTrue(result.rows.any { it.status == UserImportStatus.PARSE_ERROR && it.email == null })

        // The returned passwords actually log in.
        val jsonClient = jsonClient()
        for (email in listOf(a, b)) {
            val password = byEmail[email]?.password
            assertNotNull(password, "created rows carry the generated password")
            val login = jsonClient.post("/api/v1/login") {
                contentType(ContentType.Application.Json)
                setBody(LoginRequest(email, password))
            }
            assertEquals(HttpStatusCode.OK, login.status, "imported user $email must be able to log in")
        }
    }

    @Test
    fun `re-importing the same file yields only duplicates`() = testApplication {
        usePostgresTestcontainer()
        val admin = uniqueEmail("import-admin2")
        TestUsers.seed(email = admin, password = "admin-pass-123")
        val client = authedClient(admin, "admin-pass-123")
        val csv = "Re Import,${uniqueEmail("import-re")}"

        assertEquals(1, client.import(csv).body<UserImportResponse>().created)
        val second = client.import(csv).body<UserImportResponse>()
        assertEquals(0, second.created)
        assertEquals(1, second.duplicates)
    }

    @Test
    fun `intra-file duplicate is caught on the second occurrence`() = testApplication {
        usePostgresTestcontainer()
        val admin = uniqueEmail("import-admin3")
        TestUsers.seed(email = admin, password = "admin-pass-123")
        val client = authedClient(admin, "admin-pass-123")
        val email = uniqueEmail("import-twice")

        val result = client.import("First One,$email\nSecond One,$email").body<UserImportResponse>()
        assertEquals(1, result.created)
        assertEquals(1, result.duplicates)
        assertEquals(UserImportStatus.CREATED, result.rows[0].status)
        assertEquals(UserImportStatus.DUPLICATE, result.rows[1].status)
    }

    @Test
    fun `caps and authz`() = testApplication {
        usePostgresTestcontainer()
        val admin = uniqueEmail("import-admin4")
        TestUsers.seed(email = admin, password = "admin-pass-123")
        val user = uniqueEmail("import-plain-user")
        TestUsers.seed(email = user, password = "user-pass-1234", role = UserRole.USER)

        val adminClient = authedClient(admin, "admin-pass-123")
        val tooManyRows = (1..201).joinToString("\n") { "User $it,${uniqueEmail("cap-$it")}" }
        assertEquals(HttpStatusCode.BadRequest, adminClient.import(tooManyRows).status)
        val tooLarge = "x".repeat(256 * 1024 + 1)
        assertEquals(HttpStatusCode.BadRequest, adminClient.import(tooLarge).status)

        val userClient = authedClient(user, "user-pass-1234")
        assertEquals(HttpStatusCode.Forbidden, userClient.import("Somebody,${uniqueEmail("nope")}").status)
    }

    @Test
    fun `sendEmails delivers one welcome email per created row with the row's password`() = testApplication {
        usePostgresTestcontainer() // dev-default `log` transport
        val admin = uniqueEmail("import-admin5")
        TestUsers.seed(email = admin, password = "admin-pass-123")
        val client = authedClient(admin, "admin-pass-123")
        val a = uniqueEmail("import-mail-a")
        val mail = LogCapture("ch.nokillswit.mail")
        try {
            val result = client.import("Mail User,$a", sendEmails = true).body<UserImportResponse>()
            assertEquals(UserImportStatus.CREATED, result.rows.single().status)
            val password = result.rows.single().password!!
            // Emails are sent synchronously within the request, so no polling needed.
            val message = mail.events.map { it.formattedMessage }.singleOrNull { "To: $a" in it }
            assertNotNull(message, "exactly one welcome email for the created row")
            assertTrue(password in message, "the emailed password matches the response row")
            assertTrue("Twoje konto Lettuce" in message, "bilingual welcome content")
        } finally {
            mail.detach()
        }
    }

    @Test
    fun `sendEmails on a mail-disabled deployment is rejected up-front`() = testApplication {
        configureApp("mail.transport" to "disabled")
        startApplication()
        val admin = uniqueEmail("import-admin6")
        TestUsers.seed(email = admin, password = "admin-pass-123")
        val client = authedClient(admin, "admin-pass-123")
        val email = uniqueEmail("import-disabled")

        assertEquals(HttpStatusCode.ServiceUnavailable, client.import("Nobody,$email", sendEmails = true).status)
        // Without the email option the import still works on such a deployment.
        assertEquals(1, client.import("Nobody,$email").body<UserImportResponse>().created)
    }

    @Test
    fun `email delivery failure yields EMAIL_FAILED but keeps the account and password`() = testApplication {
        // Real SMTP transport pointed at a closed port: send() throws, create() already happened.
        configureApp(
            "mail.transport" to "smtp",
            "mail.smtp.host" to "localhost",
            "mail.smtp.port" to "1",
            "mail.smtp.startTls" to "false",
        )
        startApplication()
        val admin = uniqueEmail("import-admin7")
        TestUsers.seed(email = admin, password = "admin-pass-123")
        val client = authedClient(admin, "admin-pass-123")
        val email = uniqueEmail("import-fail-mail")

        val result = client.import("Fail Mail,$email", sendEmails = true).body<UserImportResponse>()
        val row = result.rows.single()
        assertEquals(UserImportStatus.EMAIL_FAILED, row.status)
        assertNotNull(row.password, "the password must still be shown so the admin can deliver it")
        assertEquals(1, result.created, "EMAIL_FAILED counts as created")

        val login = jsonClient().post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(email, row.password!!))
        }
        assertEquals(HttpStatusCode.OK, login.status, "the account exists and the password works")
    }
}
