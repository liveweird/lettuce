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

    /** Every interpolation key any notification type reads — generous on purpose. */
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
        "person" to "Percy Person",
        "year" to "2026",
        "from" to "20",
        "to" to "25",
        "openDate" to "2026-09-01",
        "closeDate" to "2026-09-08",
        "cycleId" to "7",
        "author" to "Olga Owner",
        "periodStart" to "2026-07-01",
        "periodEnd" to "2026-07-31",
        "sharer" to "Sia Sharer",
        "sharee" to "Shay Sharee",
        "actor" to "Ada Author",
        "expiresOn" to "2026-12-31",
        "count" to "3",
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
    fun `days-off created and deleted word the person and dates in both languages`() {
        // v3.9.0: no lifecycle, no pool/type in the sentence — the create/delete fan-out
        // carries only person + dates (the teammate redaction rule honoured by construction).
        val createdEn = notificationEmailContent(
            "R", NotificationType.DAYS_OFF_CREATED, allParams, null, null, "en",
        )!!
        assertTrue("Percy Person is off 2026-08-10 – 2026-08-14." in createdEn.body, createdEn.body)
        val createdPl = notificationEmailContent(
            "R", NotificationType.DAYS_OFF_CREATED, allParams, null, null, "pl",
        )!!
        assertTrue("Percy Person będzie nieobecny/a 2026-08-10 – 2026-08-14." in createdPl.body, createdPl.body)

        val deletedEn = notificationEmailContent(
            "R", NotificationType.DAYS_OFF_DELETED, allParams, null, null, "en",
        )!!
        assertTrue(
            "The days off of Percy Person (2026-08-10 – 2026-08-14) was deleted." in deletedEn.body,
            deletedEn.body,
        )
        val deletedPl = notificationEmailContent(
            "R", NotificationType.DAYS_OFF_DELETED, allParams, null, null, "pl",
        )!!
        assertTrue(
            "Wpis o dniach wolnych Percy Person (2026-08-10 – 2026-08-14) został usunięty." in deletedPl.body,
            deletedPl.body,
        )
    }

    @Test
    fun `the correction operation is translated per language, pool-named or legacy-default`() {
        val subtract = notificationEmailContent(
            "R", NotificationType.DAYS_OFF_CORRECTED_TO_OWNER,
            allParams + ("operation" to "SUBTRACT"), null, null, "en",
        )!!
        assertTrue("subtracted 4.5 day(s) from your \"Paid days off\" budget" in subtract.body, subtract.body)

        val add = notificationEmailContent(
            "R", NotificationType.DAYS_OFF_CORRECTED_TO_OWNER,
            allParams + ("operation" to "ADD"), null, null, "pl",
        )!!
        assertTrue("dodał/dodała 4.5 dni" in add.body)
        // The pool-present path (v3.2.1): the correction wording quotes the pool's name in
        // either language; a pre-pool row falls back to a PER-LANGUAGE default name (never
        // English in Polish).
        val pooled = allParams + ("pool" to "Maternal leave")
        val addPooledPl = notificationEmailContent(
            "R", NotificationType.DAYS_OFF_CORRECTED_TO_OWNER, pooled + ("operation" to "ADD"), null, null, "pl",
        )!!
        assertTrue("do Twojej puli „Maternal leave” na rok 2026" in addPooledPl.body, addPooledPl.body)
        val addLegacyPl = notificationEmailContent(
            "R", NotificationType.DAYS_OFF_CORRECTED_TO_OWNER, allParams + ("operation" to "ADD"), null, null, "pl",
        )!!
        assertTrue("do Twojej puli „Płatne dni wolne” na rok 2026" in addLegacyPl.body, addLegacyPl.body)
        assertTrue("Paid days off" !in addLegacyPl.body, addLegacyPl.body)
    }

    @Test
    fun `impact log entries word the author and period in both languages`() {
        val createdEn = notificationEmailContent(
            "R", NotificationType.IMPACT_ENTRY_CREATED_TO_MANAGER, allParams, null, null, "en",
        )!!
        assertEquals("Lettuce: impact log", createdEn.subject)
        assertTrue(
            "Olga Owner, who reports to you, added an impact log entry for the period 2026-07-01 – 2026-07-31." in
                createdEn.body,
            createdEn.body,
        )
        val updatedPl = notificationEmailContent(
            "R", NotificationType.IMPACT_ENTRY_UPDATED_TO_MANAGER, allParams, null, null, "pl",
        )!!
        assertTrue("zaktualizował/a wpis w dzienniku wpływu" in updatedPl.body, updatedPl.body)
        val deletedPl = notificationEmailContent(
            "R", NotificationType.IMPACT_ENTRY_DELETED_TO_MANAGER, allParams, null, null, "pl",
        )!!
        assertTrue("usunął/usunęła wpis z dziennika wpływu" in deletedPl.body, deletedPl.body)
    }

    @Test
    fun `the allowance change words a first assignment without a from value`() {
        // allParams carries both from and to — the every-type sweep exercises the changed
        // branch; the first-set wording needs `from` absent.
        val firstSet = notificationEmailContent(
            "R", NotificationType.DAYS_OFF_ALLOWANCE_CHANGED,
            allParams - "from", null, null, "en",
        )!!
        assertTrue("set your annual \"Paid days off\" allowance to 25 day(s)." in firstSet.body, firstSet.body)
        val changedPl = notificationEmailContent(
            "R", NotificationType.DAYS_OFF_ALLOWANCE_CHANGED, allParams, null, null, "pl",
        )!!
        assertTrue("z 20 na 25 dni" in changedPl.body, changedPl.body)
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
        assertEquals("Lettuce: days off", subject(NotificationType.DAYS_OFF_CREATED, "en"))
        assertEquals("Lettuce: ankieta pulsu", subject(NotificationType.PULSE_CYCLE_OPENED, "pl"))
        assertEquals("Lettuce: career update", subject(NotificationType.CAREER_POSITION_STARTED_TO_USER, "en"))
        // The sharing types (v4.8.0) ride their area's subject — succession plans now have their own.
        assertEquals("Lettuce: feedback update", subject(NotificationType.FEEDBACK_SHARED, "en"))
        assertEquals("Lettuce: plan sukcesji", subject(NotificationType.SUCCESSION_PLAN_SHARED, "pl"))
        assertEquals("Lettuce: succession plan", subject(NotificationType.SUCCESSION_PLAN_SHARE_WITHDRAWN, "en"))
        assertEquals("Lettuce: dziennik wpływu", subject(NotificationType.IMPACT_ENTRY_SHARED, "pl"))
    }

    @Test
    fun `a missing param renders as a question mark instead of failing`() {
        val content = notificationEmailContent(
            "R", NotificationType.GOAL_ACTIVATED_TO_SUBORDINATE, emptyMap(), null, null, "en",
        )
        assertNotNull(content)
        assertTrue("? activated the goal \"?\" for you." in content.body)
    }

    @Test
    fun `the two request-expiry types word both parties in both languages (v3_8_0)`() {
        val toRequesterEn = notificationEmailContent(
            "R", NotificationType.FEEDBACK_REQUEST_EXPIRED_TO_REQUESTER, allParams, null, null, "en",
        )!!
        assertTrue("Your feedback request to Pat Provider about Sam Subject expired." in toRequesterEn.body)
        assertEquals("Lettuce: feedback update", toRequesterEn.subject)

        val toRequesterPl = notificationEmailContent(
            "R", NotificationType.FEEDBACK_REQUEST_EXPIRED_TO_REQUESTER, allParams, null, null, "pl",
        )!!
        assertTrue("Twoja prośba o feedback do Pat Provider na temat Sam Subject wygasła." in toRequesterPl.body)

        val toProviderEn = notificationEmailContent(
            "R", NotificationType.FEEDBACK_REQUEST_EXPIRED_TO_PROVIDER, allParams, null, null, "en",
        )!!
        assertTrue("The feedback request from Rita Requester about Sam Subject expired." in toProviderEn.body)

        val toProviderPl = notificationEmailContent(
            "R", NotificationType.FEEDBACK_REQUEST_EXPIRED_TO_PROVIDER, allParams, null, null, "pl",
        )!!
        assertTrue("Prośba o feedback od Rita Requester na temat Sam Subject wygasła." in toProviderPl.body)
    }

    private fun body(type: NotificationType, params: Map<String, String>, lang: String) =
        notificationEmailContent("R", type, params, null, null, lang)!!.body

    @Test
    fun `a share notice words the sharer, the kind of document and the optional end date in both languages (v4_8_0)`() {
        val bound = mapOf("sharer" to "Sia Sharer", "expiresOn" to "2026-12-31")
        assertTrue(
            "Sia Sharer shared a goal with you. Access lasts until 2026-12-31." in
                body(NotificationType.GOAL_SHARED, bound, "en"),
        )
        assertTrue(
            "Sia Sharer udostępnił/a Ci cel. Dostęp obowiązuje do 2026-12-31." in
                body(NotificationType.GOAL_SHARED, bound, "pl"),
        )
        val open = mapOf("sharer" to "Sia Sharer")
        assertTrue("Sia Sharer shared feedback with you." in body(NotificationType.FEEDBACK_SHARED, open, "en"))
        assertFalse("Access lasts" in body(NotificationType.FEEDBACK_SHARED, open, "en"))
        assertTrue(
            "Sia Sharer udostępnił/a Ci ocenę okresową." in body(NotificationType.PERFORMANCE_REVIEW_SHARED, open, "pl"),
        )
        assertTrue(
            "Sia Sharer udostępnił/a Ci wpis z dziennika wpływu." in body(NotificationType.IMPACT_ENTRY_SHARED, open, "pl"),
        )
    }

    @Test
    fun `a mass share notice words the sharer, the total and the optional end date in both languages (v4_10_0)`() {
        val open = mapOf("sharer" to "Sia Sharer", "count" to "30")
        assertTrue(
            "Sia Sharer shared performance reviews with you (30 in total)." in
                body(NotificationType.PERFORMANCE_REVIEWS_BATCH_SHARED, open, "en"),
        )
        assertFalse("Access lasts" in body(NotificationType.PERFORMANCE_REVIEWS_BATCH_SHARED, open, "en"))
        assertTrue(
            "Sia Sharer udostępnił/a Ci oceny okresowe (łącznie: 30)." in
                body(NotificationType.PERFORMANCE_REVIEWS_BATCH_SHARED, open, "pl"),
        )
        assertFalse("Dostęp obowiązuje" in body(NotificationType.PERFORMANCE_REVIEWS_BATCH_SHARED, open, "pl"))
        val bound = open + ("expiresOn" to "2026-12-31")
        assertTrue(
            "Access lasts until 2026-12-31." in body(NotificationType.PERFORMANCE_REVIEWS_BATCH_SHARED, bound, "en"),
        )
        assertTrue(
            "Dostęp obowiązuje do 2026-12-31." in body(NotificationType.PERFORMANCE_REVIEWS_BATCH_SHARED, bound, "pl"),
        )
    }

    @Test
    fun `the succession share notice is content-free in both languages`() {
        val params = mapOf("sharer" to "Sia Sharer")
        assertTrue("Sia Sharer shared a succession plan with you." in body(NotificationType.SUCCESSION_PLAN_SHARED, params, "en"))
        assertTrue("Sia Sharer udostępnił/a Ci plan sukcesji." in body(NotificationType.SUCCESSION_PLAN_SHARED, params, "pl"))
        // The withdrawn copies need no actor/sharee — and render no unresolved param. The sharee's copy
        // is deliberately actor-neutral: it cannot say WHO withdrew (the sharer or the author).
        assertTrue(
            "You no longer have access to a succession plan Sia Sharer shared with you." in
                body(NotificationType.SUCCESSION_PLAN_SHARE_WITHDRAWN, params, "en"),
        )
        assertTrue(
            "Nie masz już dostępu do planu sukcesji, który udostępnił/a Ci Sia Sharer." in
                body(NotificationType.SUCCESSION_PLAN_SHARE_WITHDRAWN, params, "pl"),
        )
        val sharerCopy = params + ("self" to "sharer")
        assertTrue(
            "The owner of a succession plan withdrew your share of it." in
                body(NotificationType.SUCCESSION_PLAN_SHARE_WITHDRAWN, sharerCopy, "en"),
        )
        assertTrue(
            "Właściciel/ka planu sukcesji wycofał/a Twoje udostępnienie." in
                body(NotificationType.SUCCESSION_PLAN_SHARE_WITHDRAWN, sharerCopy, "pl"),
        )
    }

    @Test
    fun `a share withdrawal words the sharee's copy, the author case and the sharer's copy`() {
        val bySharer = mapOf("sharer" to "Sia Sharer", "sharee" to "Shay Sharee", "actor" to "Sia Sharer")
        assertTrue(
            "Sia Sharer stopped sharing a 1:1 meeting with you." in
                body(NotificationType.ONE_ON_ONE_SHARE_WITHDRAWN, bySharer, "en"),
        )
        assertTrue(
            "Sia Sharer wycofał/a Twój dostęp do spotkania 1:1." in
                body(NotificationType.ONE_ON_ONE_SHARE_WITHDRAWN, bySharer, "pl"),
        )

        val reviewByAuthor = mapOf("sharer" to "Sia Sharer", "sharee" to "Shay Sharee", "actor" to "Ada Author")
        assertTrue(
            "Ada Author wycofał/a Twój dostęp do oceny okresowej udostępnionej Ci przez Sia Sharer." in
                body(NotificationType.PERFORMANCE_REVIEW_SHARE_WITHDRAWN, reviewByAuthor, "pl"),
        )
        val byAuthor = mapOf("sharer" to "Sia Sharer", "sharee" to "Shay Sharee", "actor" to "Ada Author")
        assertTrue(
            "Ada Author withdrew your access to a team KPI that Sia Sharer had shared with you." in
                body(NotificationType.TEAM_KPI_SHARE_WITHDRAWN, byAuthor, "en"),
        )
        assertTrue(
            "Ada Author wycofał/a Twój dostęp do KPI zespołu udostępnionego Ci przez Sia Sharer." in
                body(NotificationType.TEAM_KPI_SHARE_WITHDRAWN, byAuthor, "pl"),
        )

        val sharerCopy = byAuthor + ("self" to "sharer")
        assertTrue(
            "Ada Author withdrew your share of feedback with Shay Sharee." in
                body(NotificationType.FEEDBACK_SHARE_WITHDRAWN, sharerCopy, "en"),
        )
        assertTrue(
            "Ada Author wycofał/a Twoje udostępnienie feedbacku osobie Shay Sharee." in
                body(NotificationType.FEEDBACK_SHARE_WITHDRAWN, sharerCopy, "pl"),
        )
    }
}
