package ch.nokillswit

import ch.nokillswit.notifications.NotificationType
import ch.nokillswit.notifications.notificationEmailContent
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The pure bilingual wording catalog behind the notification email mirror (v2.3.0) —
 * notifications/NotificationEmail.kt. No DB, no app.
 */
class NotificationEmailTest {

    /** Every interpolation key any of the 36 types reads — generous on purpose. */
    private val allParams = mapOf(
        "requester" to "Rita Requester",
        "subject" to "Sam Subject",
        "provider" to "Pat Provider",
        "manager" to "Mona Manager",
        "subordinate" to "Sub Ordinate",
        "date" to "2026-08-01",
        "title" to "Ship it",
        "team" to "AAA",
        "value" to "42.0",
        "fromValue" to "41.0",
        "toValue" to "43.0",
        "fromDate" to "2026-07-01",
        "toDate" to "2026-07-02",
        "startMonth" to "2026-01",
        "endMonth" to "2026-06",
        "startDate" to "2026-08-10",
        "endDate" to "2026-08-14",
        "type" to "PAID",
        "days" to "4.5",
        "year" to "2026",
        "openDate" to "2026-09-01",
        "closeDate" to "2026-09-08",
        "cycleId" to "7",
    )

    @Test
    fun `every type renders a bilingual body with no leftover placeholders`() {
        NotificationType.entries.forEach { type ->
            val content = notificationEmailContent(
                recipientName = "Rae Recipient",
                type = type,
                params = allParams,
                link = "/somewhere",
                appUrl = "https://lettuce.test",
            )
            assertNotNull(content, "$type must have wording (only the reset context is skipped)")
            assertTrue(content.subject.startsWith("Lettuce: "), "$type subject: ${content.subject}")
            assertTrue(" / " in content.subject, "$type subject must be bilingual")
            assertTrue(content.body.startsWith("Hi Rae Recipient,"), "$type body must greet in EN")
            assertTrue("Cześć Rae Recipient," in content.body, "$type body must greet in PL")
            assertFalse("{{" in content.body, "$type body leaks an i18next placeholder")
            assertFalse("?" in content.body.substringBefore("Open in Lettuce"), "$type body has an unresolved param")
        }
    }

    @Test
    fun `the deep link renders only with both a link and an appUrl`() {
        fun body(link: String?, appUrl: String?) = notificationEmailContent(
            "R", NotificationType.GOAL_ACTIVATED_TO_SUBORDINATE, allParams, link, appUrl,
        )!!.body

        val linked = body("/goals/9/view", "https://lettuce.test/")
        assertTrue("Open in Lettuce / Otwórz w Lettuce: https://lettuce.test/goals/9/view" in linked)
        assertFalse("Open in Lettuce" in body(null, "https://lettuce.test"), "no link → no link line")
        assertFalse("Open in Lettuce" in body("/goals/9/view", null), "no appUrl → no link line")
        assertFalse("Open in Lettuce" in body("/goals/9/view", ""), "blank appUrl → no link line")
    }

    @Test
    fun `feedback context variants pick the self-reflection wording`() {
        val self = notificationEmailContent(
            "R", NotificationType.FEEDBACK_REQUESTED_TO_PROVIDER,
            allParams + ("self" to "self"), null, null,
        )!!
        assertTrue("asked you for a self-reflection" in self.body)
        assertTrue("poprosił/a Cię o autorefleksję" in self.body)

        val reflection = notificationEmailContent(
            "R", NotificationType.FEEDBACK_REQUESTED_TO_REQUESTER,
            allParams + ("self" to "reflection"), null, null,
        )!!
        assertTrue("You asked Pat Provider for a self-reflection." in reflection.body)

        val plain = notificationEmailContent(
            "R", NotificationType.FEEDBACK_REQUESTED_TO_PROVIDER, allParams, null, null,
        )!!
        assertTrue("Rita Requester requested feedback about Sam Subject." in plain.body)
    }

    @Test
    fun `days-off type and correction operation are translated per language`() {
        val requested = notificationEmailContent(
            "R", NotificationType.DAYS_OFF_REQUESTED_TO_MANAGER, allParams, null, null,
        )!!
        assertTrue("(Paid, 4.5 day(s))" in requested.body, requested.body)
        assertTrue("(Płatne, dni: 4.5)" in requested.body, requested.body)

        val subtract = notificationEmailContent(
            "R", NotificationType.DAYS_OFF_CORRECTED_TO_OWNER,
            allParams + ("operation" to "SUBTRACT"), null, null,
        )!!
        assertTrue("subtracted 4.5 day(s) from your paid days-off budget" in subtract.body)
        assertTrue("odjął/odjęła 4.5 dni" in subtract.body)

        val add = notificationEmailContent(
            "R", NotificationType.DAYS_OFF_CORRECTED_TO_OWNER,
            allParams + ("operation" to "ADD"), null, null,
        )!!
        assertTrue("added 4.5 day(s) to your paid days-off budget" in add.body)
    }

    @Test
    fun `password changed variants — and the reset context is deliberately not emailed`() {
        assertNull(
            notificationEmailContent(
                "R", NotificationType.PASSWORD_CHANGED, mapOf("self" to "reset"), null, null,
            ),
            "the reset flow's own email is the notice — no duplicate",
        )
        val admin = notificationEmailContent(
            "R", NotificationType.PASSWORD_CHANGED, mapOf("self" to "admin"), null, null,
        )!!
        assertTrue("An administrator changed your password." in admin.body)
        assertEquals("Lettuce: security notice / powiadomienie o bezpieczeństwie", admin.subject)
        val selfChange = notificationEmailContent(
            "R", NotificationType.PASSWORD_CHANGED, emptyMap(), null, null,
        )!!
        assertTrue("Your password was changed." in selfChange.body)
        assertTrue("Twoje hasło zostało zmienione." in selfChange.body)
    }

    @Test
    fun `subjects are per feature area`() {
        fun subject(type: NotificationType) =
            notificationEmailContent("R", type, allParams, null, null)!!.subject
        assertEquals("Lettuce: feedback update / aktualizacja feedbacku", subject(NotificationType.FEEDBACK_SENT_TO_SUBJECT))
        assertEquals("Lettuce: 1:1 meeting / spotkanie 1:1", subject(NotificationType.ONE_ON_ONE_CREATED_TO_SUBORDINATE))
        assertEquals("Lettuce: goal update / aktualizacja celu", subject(NotificationType.GOAL_ARCHIVED_TO_SUBORDINATE))
        assertEquals("Lettuce: team KPI update / aktualizacja KPI zespołu", subject(NotificationType.TEAM_KPI_VALUE_RECORDED_TO_MEMBER))
        assertEquals("Lettuce: performance review / ocena okresowa", subject(NotificationType.PERFORMANCE_REVIEW_PUBLISHED_TO_SUBORDINATE))
        assertEquals("Lettuce: days off / dni wolne", subject(NotificationType.DAYS_OFF_ACCEPTED_TO_OWNER))
        assertEquals("Lettuce: pulse survey / ankieta pulsu", subject(NotificationType.PULSE_CYCLE_OPENED))
    }

    @Test
    fun `a missing param renders as a question mark instead of failing`() {
        val content = notificationEmailContent(
            "R", NotificationType.GOAL_ACTIVATED_TO_SUBORDINATE, emptyMap(), null, null,
        )
        assertNotNull(content)
        assertTrue("? activated the goal \"?\" for you." in content.body)
    }
}
