package ch.nokillswit

import ch.nokillswit.dictionaries.SUPPORTED_LANGUAGES
import ch.nokillswit.notifications.NotificationType
import ch.nokillswit.notifications.notificationEmailContent
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The pure per-language wording catalog behind the notification email mirror (v2.3.0,
 * per-recipient language since v2.21.0) — notifications/NotificationEmail.kt. No DB, no app.
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

    private val greetings = mapOf("en" to "Hi Rae Recipient,", "pl" to "Cześć Rae Recipient,")

    @Test
    fun `every type renders a single-language body in every supported language`() {
        SUPPORTED_LANGUAGES.forEach { lang ->
            NotificationType.entries.forEach { type ->
                val content = notificationEmailContent(
                    recipientName = "Rae Recipient",
                    type = type,
                    params = allParams,
                    link = "/somewhere",
                    appUrl = "https://lettuce.test",
                    language = lang,
                )
                assertNotNull(content, "$type must have wording (only the reset context is skipped)")
                assertTrue(content.subject.startsWith("Lettuce: "), "$type/$lang subject: ${content.subject}")
                assertFalse(" / " in content.subject, "$type/$lang subject must be single-language")
                assertTrue(
                    content.body.startsWith(greetings.getValue(lang)),
                    "$type body must greet in $lang",
                )
                // Single-language: exactly one greeting line, never the other language's.
                greetings.filterKeys { it != lang }.values.forEach { other ->
                    assertFalse(other in content.body, "$type/$lang body carries another language's greeting")
                }
                assertFalse("{{" in content.body, "$type/$lang body leaks an i18next placeholder")
                assertFalse(
                    "?" in content.body.substringBefore("Open in Lettuce").substringBefore("Otwórz w Lettuce"),
                    "$type/$lang body has an unresolved param",
                )
            }
        }
    }

    @Test
    fun `an unknown recipient language falls back to English`() {
        val content = notificationEmailContent(
            "Rae Recipient", NotificationType.GOAL_ACTIVATED_TO_SUBORDINATE, allParams, null, null,
            language = "xx",
        )!!
        assertTrue(content.body.startsWith("Hi Rae Recipient,"))
        assertEquals("Lettuce: goal update", content.subject)
    }

    @Test
    fun `the deep link renders only with both a link and an appUrl`() {
        fun body(link: String?, appUrl: String?, lang: String = "en") = notificationEmailContent(
            "R", NotificationType.GOAL_ACTIVATED_TO_SUBORDINATE, allParams, link, appUrl, lang,
        )!!.body

        val linked = body("/goals/9/view", "https://lettuce.test/")
        assertTrue("Open in Lettuce: https://lettuce.test/goals/9/view" in linked)
        assertTrue("Otwórz w Lettuce: https://lettuce.test/goals/9/view" in body("/goals/9/view", "https://lettuce.test/", "pl"))
        assertFalse("Open in Lettuce" in body(null, "https://lettuce.test"), "no link → no link line")
        assertFalse("Open in Lettuce" in body("/goals/9/view", null), "no appUrl → no link line")
        assertFalse("Open in Lettuce" in body("/goals/9/view", ""), "blank appUrl → no link line")
    }

    @Test
    fun `feedback context variants pick the self-reflection wording in either language`() {
        val selfEn = notificationEmailContent(
            "R", NotificationType.FEEDBACK_REQUESTED_TO_PROVIDER,
            allParams + ("self" to "self"), null, null, "en",
        )!!
        assertTrue("asked you for a self-reflection" in selfEn.body)
        val selfPl = notificationEmailContent(
            "R", NotificationType.FEEDBACK_REQUESTED_TO_PROVIDER,
            allParams + ("self" to "self"), null, null, "pl",
        )!!
        assertTrue("poprosił/a Cię o autorefleksję" in selfPl.body)

        val reflection = notificationEmailContent(
            "R", NotificationType.FEEDBACK_REQUESTED_TO_REQUESTER,
            allParams + ("self" to "reflection"), null, null, "en",
        )!!
        assertTrue("You asked Pat Provider for a self-reflection." in reflection.body)

        val plain = notificationEmailContent(
            "R", NotificationType.FEEDBACK_REQUESTED_TO_PROVIDER, allParams, null, null, "en",
        )!!
        assertTrue("Rita Requester requested feedback about Sam Subject." in plain.body)
    }

    @Test
    fun `days-off type and correction operation are translated per language`() {
        val requestedEn = notificationEmailContent(
            "R", NotificationType.DAYS_OFF_REQUESTED_TO_MANAGER, allParams, null, null, "en",
        )!!
        assertTrue("(Paid, 4.5 day(s))" in requestedEn.body, requestedEn.body)
        val requestedPl = notificationEmailContent(
            "R", NotificationType.DAYS_OFF_REQUESTED_TO_MANAGER, allParams, null, null, "pl",
        )!!
        assertTrue("(Płatne, dni: 4.5)" in requestedPl.body, requestedPl.body)

        val subtract = notificationEmailContent(
            "R", NotificationType.DAYS_OFF_CORRECTED_TO_OWNER,
            allParams + ("operation" to "SUBTRACT"), null, null, "en",
        )!!
        assertTrue("subtracted 4.5 day(s) from your paid days-off budget" in subtract.body)

        val add = notificationEmailContent(
            "R", NotificationType.DAYS_OFF_CORRECTED_TO_OWNER,
            allParams + ("operation" to "ADD"), null, null, "pl",
        )!!
        assertTrue("dodał/dodała 4.5 dni" in add.body)
    }

    @Test
    fun `password changed variants — and the reset context is deliberately not emailed in any language`() {
        SUPPORTED_LANGUAGES.forEach { lang ->
            assertNull(
                notificationEmailContent(
                    "R", NotificationType.PASSWORD_CHANGED, mapOf("self" to "reset"), null, null, lang,
                ),
                "the reset flow's own email is the notice — no duplicate ($lang)",
            )
        }
        val admin = notificationEmailContent(
            "R", NotificationType.PASSWORD_CHANGED, mapOf("self" to "admin"), null, null, "en",
        )!!
        assertTrue("An administrator changed your password." in admin.body)
        assertEquals("Lettuce: security notice", admin.subject)
        val selfChange = notificationEmailContent(
            "R", NotificationType.PASSWORD_CHANGED, emptyMap(), null, null, "pl",
        )!!
        assertTrue("Twoje hasło zostało zmienione." in selfChange.body)
        assertEquals("Lettuce: powiadomienie o bezpieczeństwie", selfChange.subject)
    }

    @Test
    fun `subjects are per feature area and per language`() {
        fun subject(type: NotificationType, lang: String) =
            notificationEmailContent("R", type, allParams, null, null, lang)!!.subject
        assertEquals("Lettuce: feedback update", subject(NotificationType.FEEDBACK_SENT_TO_SUBJECT, "en"))
        assertEquals("Lettuce: aktualizacja feedbacku", subject(NotificationType.FEEDBACK_SENT_TO_SUBJECT, "pl"))
        assertEquals("Lettuce: 1:1 meeting", subject(NotificationType.ONE_ON_ONE_CREATED_TO_SUBORDINATE, "en"))
        assertEquals("Lettuce: aktualizacja celu", subject(NotificationType.GOAL_ARCHIVED_TO_SUBORDINATE, "pl"))
        assertEquals("Lettuce: team KPI update", subject(NotificationType.TEAM_KPI_VALUE_RECORDED_TO_MEMBER, "en"))
        assertEquals("Lettuce: ocena okresowa", subject(NotificationType.PERFORMANCE_REVIEW_PUBLISHED_TO_SUBORDINATE, "pl"))
        assertEquals("Lettuce: days off", subject(NotificationType.DAYS_OFF_ACCEPTED_TO_OWNER, "en"))
        assertEquals("Lettuce: ankieta pulsu", subject(NotificationType.PULSE_CYCLE_OPENED, "pl"))
        assertEquals("Lettuce: career update", subject(NotificationType.CAREER_POSITION_STARTED_TO_USER, "en"))
    }

    @Test
    fun `a missing param renders as a question mark instead of failing`() {
        val content = notificationEmailContent(
            "R", NotificationType.GOAL_ACTIVATED_TO_SUBORDINATE, emptyMap(), null, null, "en",
        )
        assertNotNull(content)
        assertTrue("? activated the goal \"?\" for you." in content.body)
    }
}
