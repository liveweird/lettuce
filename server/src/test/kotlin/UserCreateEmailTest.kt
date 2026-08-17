package ch.nokillswit

import ch.nokillswit.auth.LoginRequest
import ch.nokillswit.users.UserCreateResponse
import ch.nokillswit.users.UserRequest
import io.ktor.client.call.body
import io.ktor.client.request.get
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

/** POST /api/v1/users with sendEmail — the single-create sibling of the import's sendEmails. */
class UserCreateEmailTest {

    private suspend fun io.ktor.client.HttpClient.createUser(
        email: String,
        password: String,
        sendEmail: Boolean,
        language: String? = null,
    ) = post("/api/v1/users") {
        contentType(ContentType.Application.Json)
        setBody(
            UserRequest(
                name = "Mail Create",
                email = email,
                password = password,
                sendEmail = sendEmail,
                language = language,
            ),
        )
    }

    @Test
    fun `sendEmail delivers the welcome email with the request's password and reports emailSent`() = testApplication {
        usePostgresTestcontainer() // dev-default `log` transport
        val admin = uniqueEmail("create-mail-admin")
        TestUsers.seed(email = admin, password = "admin-pass-123")
        val client = authedClient(admin, "admin-pass-123")
        val email = uniqueEmail("create-mail")
        val mail = LogCapture("ch.nokillswit.mail")
        try {
            val response = client.createUser(email, "chosen-password-1", sendEmail = true)
            assertEquals(HttpStatusCode.Created, response.status)
            assertEquals(true, response.body<UserCreateResponse>().emailSent)

            // Sent synchronously within the request — no polling needed.
            val message = mail.events.map { it.formattedMessage }.singleOrNull { "To: $email" in it }
            assertNotNull(message, "exactly one welcome email")
            assertTrue("chosen-password-1" in message, "the email carries the request's password")
            assertTrue("Your Lettuce account is ready" in message, "the EN welcome content (default language)")
        } finally {
            mail.detach()
        }
    }

    @Test
    fun `the welcome email renders in the requested language`() = testApplication {
        usePostgresTestcontainer()
        val admin = uniqueEmail("create-mail-pl-admin")
        TestUsers.seed(email = admin, password = "admin-pass-123")
        val client = authedClient(admin, "admin-pass-123")
        val email = uniqueEmail("create-mail-pl")
        val mail = LogCapture("ch.nokillswit.mail")
        try {
            val response = client.createUser(email, "chosen-password-1", sendEmail = true, language = "pl")
            assertEquals(HttpStatusCode.Created, response.status)
            val message = mail.events.map { it.formattedMessage }.singleOrNull { "To: $email" in it }
            assertNotNull(message, "exactly one welcome email")
            assertTrue("Twoje konto Lettuce jest gotowe" in message, "the PL subject")
            assertTrue("Cześć Mail Create," in message, "the PL body")
            assertTrue("Hasło:" in message)
        } finally {
            mail.detach()
        }
    }

    @Test
    fun `a plain create reports no emailSent field`() = testApplication {
        usePostgresTestcontainer()
        val admin = uniqueEmail("create-plain-admin")
        TestUsers.seed(email = admin, password = "admin-pass-123")
        val client = authedClient(admin, "admin-pass-123")

        val response = client.createUser(uniqueEmail("create-plain"), "chosen-password-1", sendEmail = false)
        assertEquals(HttpStatusCode.Created, response.status)
        assertNull(response.body<UserCreateResponse>().emailSent)
    }

    @Test
    fun `sendEmail on a mail-disabled deployment is rejected before creating anything`() = testApplication {
        configureApp("mail.transport" to "disabled")
        startApplication()
        val admin = uniqueEmail("create-disabled-admin")
        TestUsers.seed(email = admin, password = "admin-pass-123")
        val client = authedClient(admin, "admin-pass-123")
        val email = uniqueEmail("create-disabled")

        assertEquals(HttpStatusCode.ServiceUnavailable, client.createUser(email, "chosen-password-1", true).status)
        // Nothing was created — the same email can be created without the option.
        assertEquals(HttpStatusCode.Created, client.createUser(email, "chosen-password-1", false).status)
    }

    @Test
    fun `a delivery failure keeps the account and reports emailSent=false`() = testApplication {
        configureApp(
            "mail.transport" to "smtp",
            "mail.smtp.host" to "localhost",
            "mail.smtp.port" to "1",
            "mail.smtp.startTls" to "false",
        )
        startApplication()
        val admin = uniqueEmail("create-fail-admin")
        TestUsers.seed(email = admin, password = "admin-pass-123")
        val client = authedClient(admin, "admin-pass-123")
        val email = uniqueEmail("create-fail")

        val response = client.createUser(email, "chosen-password-1", sendEmail = true)
        assertEquals(HttpStatusCode.Created, response.status)
        assertEquals(false, response.body<UserCreateResponse>().emailSent)

        val login = jsonClient().post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(email, "chosen-password-1"))
        }
        assertEquals(HttpStatusCode.OK, login.status, "the account exists despite the failed email")
    }
}
