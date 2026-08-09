package ch.nokillswit

import ch.nokillswit.feedbacks.FeedbackCreateRequest
import ch.nokillswit.feedbacks.FeedbackResponse
import ch.nokillswit.feedbacks.FeedbackStatus
import ch.nokillswit.feedbacks.FeedbackVisibility
import ch.nokillswit.infra.mail.LogMailer
import ch.nokillswit.notifications.Notification
import ch.nokillswit.notifications.NotificationType
import ch.nokillswit.users.Feature
import io.ktor.client.call.body
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import kotlinx.coroutines.coroutineScope
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The notification email mirror (v2.3.0): the send-time skip matrix at the service level
 * (deterministic — the emailer's fire-and-forget sends launch on a coroutineScope that joins
 * them before assertions run) plus one route-level pass through the booted app. Email lands on
 * the `ch.nokillswit.mail` logger via [LogMailer] and is captured with the LogCapture idiom.
 */
class NotificationEmailDeliveryTest {

    private fun sentNote(recipientId: UInt, link: String? = "/feedback/7/view") = Notification(
        recipientId = recipientId,
        type = NotificationType.FEEDBACK_SENT_TO_SUBJECT,
        params = mapOf("provider" to "Pat Provider", "subject" to "Sam Subject"),
        link = link,
    )

    @Test
    fun `a minted notification is mirrored to the recipient's inbox with the deep link`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("mirror")
        val userId = TestUsers.seed(email = email, password = "pw", name = "Mia Mirror")
        val mail = LogCapture("ch.nokillswit.mail")
        try {
            coroutineScope {
                TestNotifications.withEmailer(this, LogMailer(), "https://lettuce.test/")
                    .create(sentNote(userId))
            }
            val message = mail.events.firstOrNull { "To: $email" in it.formattedMessage }?.formattedMessage
            assertNotNull(message, "the mirror email should have been delivered")
            assertTrue("Lettuce: feedback update / aktualizacja feedbacku" in message)
            assertTrue("Hi Mia Mirror," in message)
            assertTrue("Feedback from Pat Provider about Sam Subject has been sent." in message)
            assertTrue("Feedback od Pat Provider na temat Sam Subject został wysłany." in message)
            assertTrue("Open in Lettuce / Otwórz w Lettuce: https://lettuce.test/feedback/7/view" in message)
        } finally {
            mail.detach()
        }
    }

    @Test
    fun `createAll mirrors the whole batch`() = testApplication {
        usePostgresTestcontainer()
        val emailA = uniqueEmail("batch-a")
        val emailB = uniqueEmail("batch-b")
        val idA = TestUsers.seed(email = emailA, password = "pw")
        val idB = TestUsers.seed(email = emailB, password = "pw")
        val mail = LogCapture("ch.nokillswit.mail")
        try {
            coroutineScope {
                TestNotifications.withEmailer(this, LogMailer(), null)
                    .createAll(listOf(sentNote(idA), sentNote(idB)))
            }
            assertNotNull(mail.events.firstOrNull { "To: $emailA" in it.formattedMessage })
            assertNotNull(mail.events.firstOrNull { "To: $emailB" in it.formattedMessage })
        } finally {
            mail.detach()
        }
    }

    @Test
    fun `an opted-out recipient gets the row but no email`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("optout")
        val userId = TestUsers.seed(email = email, password = "pw")
        assertEquals(1, TestServices.users.setEmailNotifications(userId, false))
        val mail = LogCapture("ch.nokillswit.mail")
        try {
            coroutineScope {
                TestNotifications.withEmailer(this, LogMailer(), null).create(sentNote(userId))
            }
            assertNull(mail.events.firstOrNull { "To: $email" in it.formattedMessage })
        } finally {
            mail.detach()
        }
    }

    @Test
    fun `a recipient with the type's feature disabled is skipped — feature-neutral types still send`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("featoff")
        val userId = TestUsers.seed(email = email, password = "pw")
        assertEquals(1, TestServices.users.setDisabledFeatures(userId, setOf(Feature.FEEDBACKS)))
        val mail = LogCapture("ch.nokillswit.mail")
        try {
            coroutineScope {
                val service = TestNotifications.withEmailer(this, LogMailer(), null)
                service.create(sentNote(userId))
                // PASSWORD_CHANGED maps to no feature — never filtered, so it still mirrors.
                service.create(Notification(recipientId = userId, type = NotificationType.PASSWORD_CHANGED))
            }
            val toUser = mail.events.filter { "To: $email" in it.formattedMessage }
            assertEquals(1, toUser.size, "only the feature-neutral notification should mirror")
            assertTrue("Your password was changed." in toUser.single().formattedMessage)
        } finally {
            mail.detach()
        }
    }

    @Test
    fun `deactivated and soft-deleted recipients are skipped`() = testApplication {
        usePostgresTestcontainer()
        val deactivatedEmail = uniqueEmail("deact")
        val deletedEmail = uniqueEmail("softdel")
        val deactivatedId = TestUsers.seed(email = deactivatedEmail, password = "pw")
        val deletedId = TestUsers.seed(email = deletedEmail, password = "pw")
        assertEquals(1, TestServices.users.setDeactivated(deactivatedId, true))
        assertEquals(1, TestServices.users.delete(deletedId))
        val mail = LogCapture("ch.nokillswit.mail")
        try {
            coroutineScope {
                val service = TestNotifications.withEmailer(this, LogMailer(), null)
                service.create(sentNote(deactivatedId))
                service.create(sentNote(deletedId))
            }
            assertNull(mail.events.firstOrNull { "To: $deactivatedEmail" in it.formattedMessage })
            assertNull(mail.events.firstOrNull { "To: $deletedEmail" in it.formattedMessage })
        } finally {
            mail.detach()
        }
    }

    @Test
    fun `a null mailer (transport disabled) mints the row and sends nothing`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("nomailer")
        val userId = TestUsers.seed(email = email, password = "pw")
        val mail = LogCapture("ch.nokillswit.mail")
        try {
            val id = coroutineScope {
                TestNotifications.withEmailer(this, mailer = null, appUrl = null).create(sentNote(userId))
            }
            assertNotNull(TestNotifications.service.read(id), "the row must still be minted")
            assertNull(mail.events.firstOrNull { "To: $email" in it.formattedMessage })
        } finally {
            mail.detach()
        }
    }

    @Test
    fun `route-level - a feedback save-and-send emails the subject through the booted app`() = testApplication {
        configureApp("mail.appUrl" to "https://app.example")
        startApplication()
        val providerEmail = uniqueEmail("wired-provider")
        val subjectEmail = uniqueEmail("wired-subject")
        val providerId = TestUsers.seed(email = providerEmail, password = "pw", name = "Wanda Wired")
        val subjectId = TestUsers.seed(email = subjectEmail, password = "pw")
        val mail = LogCapture("ch.nokillswit.mail")
        try {
            val response = authedClient(providerEmail, "pw").post("/api/v1/feedbacks") {
                contentType(ContentType.Application.Json)
                setBody(
                    FeedbackCreateRequest(
                        requesterId = null,
                        subjectId = subjectId,
                        providerId = providerId,
                        visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                        status = FeedbackStatus.SENT,
                        content = "Great work on the mirror",
                    ),
                )
            }
            assertEquals(HttpStatusCode.Created, response.status)
            val feedbackId = response.body<FeedbackResponse>().id
            // The mirror is fire-and-forget on the app scope — poll like the reset test does.
            val message = mail.awaitEvent { "To: $subjectEmail" in it.formattedMessage }?.formattedMessage
            assertNotNull(message, "the subject's notification should be mirrored by email")
            assertTrue("Open in Lettuce / Otwórz w Lettuce: https://app.example/feedback/$feedbackId/view" in message)
        } finally {
            mail.detach()
        }
    }
}
