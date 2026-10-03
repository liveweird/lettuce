package ch.nokillswit.notifications

import ch.nokillswit.infra.mail.LocalizedText
import ch.nokillswit.users.Feature

/** A rendered notification email: subject + plain-text body, in the recipient's language. */
data class NotificationEmailContent(val subject: String, val body: String)

private val GREETING = LocalizedText(en = "Hi", pl = "Cześć")
private val OPEN_IN_LETTUCE = LocalizedText(en = "Open in Lettuce", pl = "Otwórz w Lettuce")

/**
 * Renders the email mirror of an in-app notification (v2.3.0) — pure and DB-free like the
 * `*Notifications.kt` builders. Rendered in the RECIPIENT'S [language] (v2.21.0 — previously
 * bilingual EN then PL; English fallback for unknown codes via [LocalizedText.of]); the
 * wording mirrors the SPA's `notifications.event.*` strings, including the context variants
 * carried in [params] (`self` = "self"/"reflection" on the feedback types and "admin"/"reset"
 * on PASSWORD_CHANGED, `operation` = ADD/SUBTRACT on DAYS_OFF_CORRECTED). Dates/months/values
 * interpolate raw (ISO strings — a documented simplification; the SPA formats them per
 * locale). The deep link renders only when the notification has one AND the deployment's
 * `mail.appUrl` is set.
 *
 * Returns null for the deliberately-not-emailed cases — today only PASSWORD_CHANGED with
 * `self == "reset"`, where the password-reset email itself is the notice; the decision lives
 * in the ONE shared catalog, so it cannot diverge per language. The exhaustive `when` (the
 * NotificationType.feature idiom) forces every future type to add wording — in EVERY
 * language, since LocalizedText's constructor requires them all.
 */
fun notificationEmailContent(
    recipientName: String,
    type: NotificationType,
    params: Map<String, String>,
    link: String?,
    appUrl: String?,
    language: String,
): NotificationEmailContent? {
    val s = sentences(type, params) ?: return null
    val body = buildString {
        appendLine("${GREETING.of(language)} $recipientName,")
        appendLine()
        appendLine(s.of(language))
        if (link != null && !appUrl.isNullOrBlank()) {
            appendLine()
            appendLine("${OPEN_IN_LETTUCE.of(language)}: ${appUrl.trimEnd('/')}$link")
        }
    }
    return NotificationEmailContent(subject = subjectFor(type).of(language), body = body)
}

/** Per-area subject (the PASSWORD_RESET_EMAIL_SUBJECT idiom) — not per-type. */
private fun subjectFor(type: NotificationType): LocalizedText = if (
    type == NotificationType.CAREER_POSITION_STARTED_TO_USER
) {
    // Feature-neutral but not a security notice — the one type that names its own area.
    LocalizedText(en = "Lettuce: career update", pl = "Lettuce: aktualizacja kariery")
} else when (type.feature) {
    Feature.FEEDBACKS -> LocalizedText(en = "Lettuce: feedback update", pl = "Lettuce: aktualizacja feedbacku")
    Feature.ONE_ON_ONES -> LocalizedText(en = "Lettuce: 1:1 meeting", pl = "Lettuce: spotkanie 1:1")
    Feature.GOALS -> LocalizedText(en = "Lettuce: goal update", pl = "Lettuce: aktualizacja celu")
    Feature.TEAM_KPIS -> LocalizedText(en = "Lettuce: team KPI update", pl = "Lettuce: aktualizacja KPI zespołu")
    Feature.PERFORMANCE_REVIEWS -> LocalizedText(en = "Lettuce: performance review", pl = "Lettuce: ocena okresowa")
    Feature.DAYS_OFF -> LocalizedText(en = "Lettuce: days off", pl = "Lettuce: dni wolne")
    Feature.PULSE_SURVEYS -> LocalizedText(en = "Lettuce: pulse survey", pl = "Lettuce: ankieta pulsu")
    Feature.IMPACT_LOG -> LocalizedText(en = "Lettuce: impact log", pl = "Lettuce: dziennik wpływu")
    // SUCCESSION_PLANS mints only the content-free share notices (v4.8.0 — it used to mint none, by
    // design: confidential, the owner is always the actor). MFA mints no notifications (its
    // emails are the sign-in codes themselves, sent directly from the login flow), and
    // TEAMS_NOTIFICATIONS (v4.5.0) is a CHANNEL, never a NotificationType.feature value (no type
    // maps to it — this branch exists only because the `when` is over the whole Feature? enum) —
    // same fallback as the feature-neutral security types.
    Feature.SUCCESSION_PLANS ->
        LocalizedText(en = "Lettuce: succession plan", pl = "Lettuce: plan sukcesji")
    Feature.MFA, Feature.TEAMS_NOTIFICATIONS, null ->
        LocalizedText(en = "Lettuce: security notice", pl = "Lettuce: powiadomienie o bezpieczeństwie")
}

/** Missing-param fallback: render "?" rather than fail the whole email. */
private fun Map<String, String>.v(key: String): String = this[key] ?: "?"

/** The paid pool's name (v3.2.0); rows minted before the pools existed name the only pool
 * there was — a per-language fallback (v3.2.1), never an English literal in a Polish sentence. */
private fun poolLabel(p: Map<String, String>): LocalizedText =
    p["pool"]?.let { LocalizedText(en = it, pl = it) } ?: LocalizedText(en = "Paid days off", pl = "Płatne dni wolne")

// The exhaustive per-type wording table — one branch per notification type, by design.
@Suppress("CyclomaticComplexMethod", "LongMethod")
private fun sentences(type: NotificationType, p: Map<String, String>): LocalizedText? = when (type) {
    NotificationType.FEEDBACK_REQUESTED_TO_PROVIDER ->
        if (p["self"] == "self") LocalizedText(
            en = "${p.v("requester")} asked you for a self-reflection.",
            pl = "${p.v("requester")} poprosił/a Cię o autorefleksję.",
        ) else LocalizedText(
            en = "${p.v("requester")} requested feedback about ${p.v("subject")}.",
            pl = "${p.v("requester")} poprosił/a o feedback na temat ${p.v("subject")}.",
        )
    NotificationType.FEEDBACK_REQUESTED_TO_REQUESTER -> when (p["self"]) {
        "self" -> LocalizedText(
            en = "You asked ${p.v("provider")} for feedback on your performance.",
            pl = "Poprosiłeś/aś ${p.v("provider")} o feedback na temat swojej pracy.",
        )
        "reflection" -> LocalizedText(
            en = "You asked ${p.v("provider")} for a self-reflection.",
            pl = "Poprosiłeś/aś ${p.v("provider")} o autorefleksję.",
        )
        else -> LocalizedText(
            en = "You reached out to ${p.v("provider")} for feedback regarding ${p.v("subject")}.",
            pl = "Poprosiłeś/aś ${p.v("provider")} o feedback na temat ${p.v("subject")}.",
        )
    }
    NotificationType.FEEDBACK_SENT_TO_SUBJECT -> LocalizedText(
        en = "Feedback from ${p.v("provider")} about ${p.v("subject")} has been sent.",
        pl = "Feedback od ${p.v("provider")} na temat ${p.v("subject")} został wysłany.",
    )
    NotificationType.FEEDBACK_SENT_TO_PROVIDER -> LocalizedText(
        en = "The feedback you provided about ${p.v("subject")} has been sent.",
        pl = "Wystawiony przez Ciebie feedback na temat ${p.v("subject")} został wysłany.",
    )
    NotificationType.FEEDBACK_SENT_TO_REQUESTER ->
        if (p["self"] == "self") LocalizedText(
            en = "The self-reflection you requested from ${p.v("provider")} has been sent.",
            pl = "Autorefleksja, o którą prosiłeś/aś ${p.v("provider")}, została wysłana.",
        ) else LocalizedText(
            en = "The feedback you requested from ${p.v("provider")} about ${p.v("subject")} has been sent.",
            pl = "Feedback od ${p.v("provider")} na temat ${p.v("subject")} (na Twoją prośbę) został wysłany.",
        )
    NotificationType.FEEDBACK_SENT_TO_MANAGER ->
        if (p["self"] == "self") LocalizedText(
            en = "${p.v("subject")}, who reports to you, shared a self-reflection.",
            pl = "${p.v("subject")} — osoba, która Ci podlega — udostępnił/a autorefleksję.",
        ) else LocalizedText(
            en = "${p.v("provider")} sent feedback about ${p.v("subject")}, who reports to you.",
            pl = "${p.v("provider")} wysłał/a feedback na temat ${p.v("subject")} — osoby, która Ci podlega.",
        )
    NotificationType.FEEDBACK_REJECTED_TO_REQUESTER ->
        if (p["self"] == "self") LocalizedText(
            en = "${p.v("provider")} declined to write a self-reflection.",
            pl = "${p.v("provider")} odmówił/a napisania autorefleksji.",
        ) else LocalizedText(
            en = "${p.v("provider")} declined to provide feedback about ${p.v("subject")}.",
            pl = "${p.v("provider")} odmówił/a wystawienia feedbacku na temat ${p.v("subject")}.",
        )
    NotificationType.FEEDBACK_PICKED_UP_TO_REQUESTER ->
        if (p["self"] == "self") LocalizedText(
            en = "${p.v("provider")} is now drafting their self-reflection.",
            pl = "${p.v("provider")} przygotowuje właśnie swoją autorefleksję.",
        ) else LocalizedText(
            en = "${p.v("provider")} is now drafting feedback about ${p.v("subject")}.",
            pl = "${p.v("provider")} przygotowuje właśnie feedback na temat ${p.v("subject")}.",
        )
    NotificationType.FEEDBACK_WITHDRAWN_TO_SUBJECT -> LocalizedText(
        en = "Feedback from ${p.v("provider")} about ${p.v("subject")} has been withdrawn.",
        pl = "Feedback od ${p.v("provider")} na temat ${p.v("subject")} został wycofany.",
    )
    NotificationType.FEEDBACK_WITHDRAWN_TO_REQUESTER ->
        if (p["self"] == "self") LocalizedText(
            en = "${p.v("provider")} withdrew their self-reflection (which you requested).",
            pl = "${p.v("provider")} wycofał/a swoją autorefleksję (o którą prosiłeś/aś).",
        ) else LocalizedText(
            en = "${p.v("provider")} withdrew their feedback about ${p.v("subject")} (which you requested).",
            pl = "${p.v("provider")} wycofał/a swój feedback na temat ${p.v("subject")} (o który prosiłeś/aś).",
        )
    NotificationType.FEEDBACK_REQUEST_EXPIRED_TO_REQUESTER -> LocalizedText(
        en = "Your feedback request to ${p.v("provider")} about ${p.v("subject")} expired.",
        pl = "Twoja prośba o feedback do ${p.v("provider")} na temat ${p.v("subject")} wygasła.",
    )
    NotificationType.FEEDBACK_REQUEST_EXPIRED_TO_PROVIDER -> LocalizedText(
        en = "The feedback request from ${p.v("requester")} about ${p.v("subject")} expired.",
        pl = "Prośba o feedback od ${p.v("requester")} na temat ${p.v("subject")} wygasła.",
    )
    NotificationType.FEEDBACK_DELETED_TO_REQUESTER ->
        if (p["self"] == "self") LocalizedText(
            en = "${p.v("provider")} deleted their self-reflection (which you requested).",
            pl = "${p.v("provider")} usunął/usunęła swoją autorefleksję (o którą prosiłeś/aś).",
        ) else LocalizedText(
            en = "${p.v("provider")} deleted their feedback about ${p.v("subject")} (which you requested).",
            pl = "${p.v("provider")} usunął/usunęła swój feedback na temat ${p.v("subject")} (o który prosiłeś/aś).",
        )
    NotificationType.ONE_ON_ONE_CREATED_TO_SUBORDINATE -> LocalizedText(
        en = "${p.v("manager")} documented a 1:1 meeting with you (${p.v("date")}).",
        pl = "${p.v("manager")} udokumentował/a spotkanie 1:1 z Tobą (${p.v("date")}).",
    )
    NotificationType.ONE_ON_ONE_CREATED_TO_MANAGER -> LocalizedText(
        en = "You documented a 1:1 meeting with ${p.v("subordinate")} (${p.v("date")}).",
        pl = "Udokumentowałeś/aś spotkanie 1:1 z ${p.v("subordinate")} (${p.v("date")}).",
    )
    NotificationType.GOAL_ACTIVATED_TO_SUBORDINATE -> LocalizedText(
        en = "${p.v("manager")} activated the goal \"${p.v("title")}\" for you.",
        pl = "${p.v("manager")} aktywował/a dla Ciebie cel „${p.v("title")}”.",
    )
    NotificationType.GOAL_DEACTIVATED_TO_SUBORDINATE -> LocalizedText(
        en = "${p.v("manager")} returned the goal \"${p.v("title")}\" to draft.",
        pl = "${p.v("manager")} cofnął/cofnęła cel „${p.v("title")}” do szkicu.",
    )
    NotificationType.GOAL_ARCHIVED_TO_SUBORDINATE -> LocalizedText(
        en = "${p.v("manager")} archived the goal \"${p.v("title")}\".",
        pl = "${p.v("manager")} zarchiwizował/zarchiwizowała cel „${p.v("title")}”.",
    )
    NotificationType.GOAL_REOPENED_TO_SUBORDINATE -> LocalizedText(
        en = "${p.v("manager")} reopened the goal \"${p.v("title")}\".",
        pl = "${p.v("manager")} ponownie otworzył/a cel „${p.v("title")}”.",
    )
    NotificationType.GOAL_PROGRESS_UPDATED_TO_SUBORDINATE -> LocalizedText(
        en = "${p.v("manager")} updated the progress of your goal \"${p.v("title")}\".",
        pl = "${p.v("manager")} zaktualizował/a postęp Twojego celu „${p.v("title")}”.",
    )
    NotificationType.GOAL_PROGRESS_UPDATED_TO_MANAGER -> LocalizedText(
        en = "${p.v("subordinate")} updated the progress of the goal \"${p.v("title")}\".",
        pl = "${p.v("subordinate")} zaktualizował/a postęp celu „${p.v("title")}”.",
    )
    NotificationType.TEAM_KPI_ACTIVATED_TO_MEMBER -> LocalizedText(
        en = "${p.v("manager")} activated the KPI \"${p.v("title")}\" for team ${p.v("team")}.",
        pl = "${p.v("manager")} aktywował/a KPI „${p.v("title")}” dla zespołu ${p.v("team")}.",
    )
    NotificationType.TEAM_KPI_DEACTIVATED_TO_MEMBER -> LocalizedText(
        en = "${p.v("manager")} returned the KPI \"${p.v("title")}\" of team ${p.v("team")} to draft.",
        pl = "${p.v("manager")} przywrócił/przywróciła KPI „${p.v("title")}” zespołu ${p.v("team")} do szkicu.",
    )
    NotificationType.TEAM_KPI_ARCHIVED_TO_MEMBER -> LocalizedText(
        en = "${p.v("manager")} archived the KPI \"${p.v("title")}\" of team ${p.v("team")}.",
        pl = "${p.v("manager")} zarchiwizował/zarchiwizowała KPI „${p.v("title")}” zespołu ${p.v("team")}.",
    )
    NotificationType.TEAM_KPI_REOPENED_TO_MEMBER -> LocalizedText(
        en = "${p.v("manager")} reopened the KPI \"${p.v("title")}\" of team ${p.v("team")}.",
        pl = "${p.v("manager")} ponownie otworzył/a KPI „${p.v("title")}” zespołu ${p.v("team")}.",
    )
    NotificationType.TEAM_KPI_VALUE_RECORDED_TO_MEMBER -> LocalizedText(
        en = "${p.v("manager")} recorded ${p.v("value")} for ${p.v("date")} on the KPI \"${p.v("title")}\" of team ${p.v("team")}.",
        pl = "${p.v("manager")} zapisał/zapisała wartość ${p.v("value")} z dnia ${p.v("date")} " +
            "w KPI „${p.v("title")}” zespołu ${p.v("team")}.",
    )
    NotificationType.TEAM_KPI_VALUE_CORRECTED_TO_MEMBER -> LocalizedText(
        en = "${p.v("manager")} corrected a data point of the KPI \"${p.v("title")}\" of team ${p.v("team")}: " +
            "${p.v("fromValue")} (${p.v("fromDate")}) → ${p.v("toValue")} (${p.v("toDate")}).",
        pl = "${p.v("manager")} poprawił/poprawiła punkt danych KPI „${p.v("title")}” zespołu ${p.v("team")}: " +
            "${p.v("fromValue")} (${p.v("fromDate")}) → ${p.v("toValue")} (${p.v("toDate")}).",
    )
    NotificationType.TEAM_KPI_VALUE_REMOVED_TO_MEMBER -> LocalizedText(
        en = "${p.v("manager")} removed the value ${p.v("value")} (${p.v("date")}) " +
            "from the KPI \"${p.v("title")}\" of team ${p.v("team")}.",
        pl = "${p.v("manager")} usunął/usunęła wartość ${p.v("value")} (${p.v("date")}) z KPI „${p.v("title")}” zespołu ${p.v("team")}.",
    )
    NotificationType.PERFORMANCE_REVIEW_PUBLISHED_TO_SUBORDINATE -> LocalizedText(
        en = "${p.v("manager")} published your performance review for the period ${p.v("startMonth")} – ${p.v("endMonth")}.",
        pl = "${p.v("manager")} opublikował/a Twoją ocenę okresową za okres ${p.v("startMonth")} – ${p.v("endMonth")}.",
    )
    NotificationType.PERFORMANCE_REVIEW_UNPUBLISHED_TO_SUBORDINATE -> LocalizedText(
        en = "${p.v("manager")} retracted your performance review for the period ${p.v("startMonth")} – ${p.v("endMonth")}.",
        pl = "${p.v("manager")} wycofał/a Twoją ocenę okresową za okres ${p.v("startMonth")} – ${p.v("endMonth")}.",
    )
    NotificationType.DAYS_OFF_CREATED -> LocalizedText(
        en = "${p.v("person")} is off ${p.v("startDate")} – ${p.v("endDate")}.",
        pl = "${p.v("person")} będzie nieobecny/a ${p.v("startDate")} – ${p.v("endDate")}.",
    )
    NotificationType.DAYS_OFF_DELETED -> LocalizedText(
        en = "The days off of ${p.v("person")} (${p.v("startDate")} – ${p.v("endDate")}) was deleted.",
        pl = "Wpis o dniach wolnych ${p.v("person")} (${p.v("startDate")} – ${p.v("endDate")}) został usunięty.",
    )
    NotificationType.DAYS_OFF_CORRECTED_TO_OWNER ->
        // `pool` (v3.2.0) names the adjusted paid pool; pre-v3.2.0 rows carry none.
        if (p["operation"] == "SUBTRACT") LocalizedText(
            en = "${p.v("manager")} subtracted ${p.v("days")} day(s) from your \"${poolLabel(p).en}\" budget for ${p.v("year")}.",
            pl = "${p.v("manager")} odjął/odjęła ${p.v("days")} dni z Twojej puli „${poolLabel(p).pl}” na rok ${p.v("year")}.",
        ) else LocalizedText(
            en = "${p.v("manager")} added ${p.v("days")} day(s) to your \"${poolLabel(p).en}\" budget for ${p.v("year")}.",
            pl = "${p.v("manager")} dodał/dodała ${p.v("days")} dni do Twojej puli „${poolLabel(p).pl}” na rok ${p.v("year")}.",
        )
    NotificationType.DAYS_OFF_ALLOWANCE_CHANGED ->
        // `from` is absent on a first assignment (the audit-delta idiom); `pool` (v3.2.0)
        // names the paid pool.
        if (p["from"] != null) LocalizedText(
            en = "${p.v("manager")} changed your annual \"${poolLabel(p).en}\" allowance " +
                "from ${p.v("from")} to ${p.v("to")} day(s).",
            pl = "${p.v("manager")} zmienił/zmieniła Twój roczny limit puli „${poolLabel(p).pl}” " +
                "z ${p.v("from")} na ${p.v("to")} dni.",
        ) else LocalizedText(
            en = "${p.v("manager")} set your annual \"${poolLabel(p).en}\" allowance to ${p.v("to")} day(s).",
            pl = "${p.v("manager")} ustawił/ustawiła Twój roczny limit puli „${poolLabel(p).pl}” na ${p.v("to")} dni.",
        )
    NotificationType.PULSE_CYCLE_SCHEDULED -> LocalizedText(
        en = "A pulse survey is scheduled to open on ${p.v("openDate")}.",
        pl = "Ankieta pulsu zostanie otwarta ${p.v("openDate")}.",
    )
    NotificationType.PULSE_CYCLE_OPENED -> LocalizedText(
        en = "The pulse survey is open — share your answers by ${p.v("closeDate")}.",
        pl = "Ankieta pulsu jest otwarta — odpowiedz do ${p.v("closeDate")}.",
    )
    NotificationType.PULSE_RESULTS_AVAILABLE -> LocalizedText(
        en = "Pulse survey results are available.",
        pl = "Wyniki ankiety pulsu są już dostępne.",
    )
    NotificationType.PULSE_CYCLE_CANCELLED -> LocalizedText(
        en = "The pulse survey planned for ${p.v("openDate")} was cancelled.",
        pl = "Ankieta pulsu zaplanowana na ${p.v("openDate")} została anulowana.",
    )
    NotificationType.IMPACT_ENTRY_CREATED_TO_MANAGER -> LocalizedText(
        en = "${p.v("author")}, who reports to you, added an impact log entry " +
            "for the period ${p.v("periodStart")} – ${p.v("periodEnd")}.",
        pl = "${p.v("author")} — osoba, która Ci podlega — dodał/a wpis do dziennika wpływu " +
            "za okres ${p.v("periodStart")} – ${p.v("periodEnd")}.",
    )
    NotificationType.IMPACT_ENTRY_UPDATED_TO_MANAGER -> LocalizedText(
        en = "${p.v("author")}, who reports to you, updated an impact log entry " +
            "for the period ${p.v("periodStart")} – ${p.v("periodEnd")}.",
        pl = "${p.v("author")} — osoba, która Ci podlega — zaktualizował/a wpis w dzienniku wpływu " +
            "za okres ${p.v("periodStart")} – ${p.v("periodEnd")}.",
    )
    NotificationType.IMPACT_ENTRY_DELETED_TO_MANAGER -> LocalizedText(
        en = "${p.v("author")}, who reports to you, deleted an impact log entry " +
            "for the period ${p.v("periodStart")} – ${p.v("periodEnd")}.",
        pl = "${p.v("author")} — osoba, która Ci podlega — usunął/usunęła wpis z dziennika wpływu " +
            "za okres ${p.v("periodStart")} – ${p.v("periodEnd")}.",
    )
    NotificationType.CAREER_POSITION_STARTED_TO_USER -> LocalizedText(
        en = "${p.v("manager")} recorded a new position in your career progression, starting ${p.v("startDate")}.",
        pl = "${p.v("manager")} odnotował/a nowe stanowisko w Twojej historii kariery, obowiązujące od ${p.v("startDate")}.",
    )
    NotificationType.FEEDBACK_SHARED -> sharedSentence(SHARE_NOUN_FEEDBACK, p)
    NotificationType.FEEDBACK_SHARE_WITHDRAWN -> withdrawnSentence(SHARE_NOUN_FEEDBACK, p)
    NotificationType.ONE_ON_ONE_SHARED -> sharedSentence(SHARE_NOUN_ONE_ON_ONE, p)
    NotificationType.ONE_ON_ONE_SHARE_WITHDRAWN -> withdrawnSentence(SHARE_NOUN_ONE_ON_ONE, p)
    NotificationType.GOAL_SHARED -> sharedSentence(SHARE_NOUN_GOAL, p)
    NotificationType.GOAL_SHARE_WITHDRAWN -> withdrawnSentence(SHARE_NOUN_GOAL, p)
    NotificationType.TEAM_KPI_SHARED -> sharedSentence(SHARE_NOUN_TEAM_KPI, p)
    NotificationType.TEAM_KPI_SHARE_WITHDRAWN -> withdrawnSentence(SHARE_NOUN_TEAM_KPI, p)
    NotificationType.PERFORMANCE_REVIEW_SHARED -> sharedSentence(SHARE_NOUN_PERFORMANCE_REVIEW, p)
    NotificationType.PERFORMANCE_REVIEW_SHARE_WITHDRAWN -> withdrawnSentence(SHARE_NOUN_PERFORMANCE_REVIEW, p)
    NotificationType.PERFORMANCE_REVIEWS_BATCH_SHARED ->
        batchSharedSentence(p, en = "performance reviews", pl = "oceny okresowe")
    NotificationType.IMPACT_ENTRY_SHARED -> sharedSentence(SHARE_NOUN_IMPACT_ENTRY, p)
    NotificationType.IMPACT_ENTRY_SHARE_WITHDRAWN -> withdrawnSentence(SHARE_NOUN_IMPACT_ENTRY, p)
    NotificationType.SUCCESSION_PLAN_SHARED -> sharedSentence(SHARE_NOUN_SUCCESSION_PLAN, p)
    NotificationType.SUCCESSION_PLAN_SHARE_WITHDRAWN -> withdrawnSentence(SHARE_NOUN_SUCCESSION_PLAN, p)
    NotificationType.DAYS_OFF_CALENDAR_SHARED -> sharedSentence(calendarShareNoun(p), p)
    NotificationType.DAYS_OFF_CALENDAR_SHARE_WITHDRAWN -> withdrawnSentence(calendarShareNoun(p), p)
    NotificationType.DAYS_OFF_CALENDARS_BATCH_SHARED -> batchSharedSentence(
        p,
        en = "days-off calendars",
        pl = "kalendarze dni wolnych",
    )
    NotificationType.PULSE_RESULTS_SHARED -> sharedSentence(pulseShareNoun(p), p)
    NotificationType.PULSE_RESULTS_SHARE_WITHDRAWN -> withdrawnSentence(pulseShareNoun(p), p)
    NotificationType.PASSWORD_CHANGED -> when (p["self"]) {
        // The reset flow's own email (with the new password) IS the notice — no duplicate.
        "reset" -> null
        "admin" -> LocalizedText(
            en = "An administrator changed your password.",
            pl = "Administrator zmienił Twoje hasło.",
        )
        else -> LocalizedText(
            en = "Your password was changed.",
            pl = "Twoje hasło zostało zmienione.",
        )
    }
}

/**
 * The kind of document a share notification names, in the forms the wording needs: [en] (with
 * its article), the Polish accusative [plAcc] ("udostępnił/a Ci …"), the Polish genitive [plGen]
 * ("dostęp do …", "udostępnienie …") and [plGenShared], the genitive participle agreeing with
 * it ("… oceny okresowej udostępnionej Ci przez …"). Content-free by construction — only the
 * kind, never a title or party (the succession copy in particular names nothing about the seat).
 */
private data class ShareNoun(
    val en: String,
    val plAcc: String,
    val plGen: String,
    val plGenShared: String,
    /**
     * Set only for the kind whose sharee withdrawal copy is deliberately ACTOR-NEUTRAL (succession
     * plans): the copy carries `{sharer}` only, so it cannot tell whether the sharer or the author
     * withdrew — it must not claim "{sharer} stopped sharing". The value is the Polish relative
     * pronoun agreeing with the noun's gender ("który" for "plan").
     */
    val plWhich: String? = null,
)

private val SHARE_NOUN_FEEDBACK =
    ShareNoun(en = "feedback", plAcc = "feedback", plGen = "feedbacku", plGenShared = "udostępnionego")
private val SHARE_NOUN_ONE_ON_ONE =
    ShareNoun(en = "a 1:1 meeting", plAcc = "spotkanie 1:1", plGen = "spotkania 1:1", plGenShared = "udostępnionego")
private val SHARE_NOUN_GOAL = ShareNoun(en = "a goal", plAcc = "cel", plGen = "celu", plGenShared = "udostępnionego")
private val SHARE_NOUN_TEAM_KPI =
    ShareNoun(en = "a team KPI", plAcc = "KPI zespołu", plGen = "KPI zespołu", plGenShared = "udostępnionego")
private val SHARE_NOUN_PERFORMANCE_REVIEW = ShareNoun(
    en = "a performance review", plAcc = "ocenę okresową", plGen = "oceny okresowej", plGenShared = "udostępnionej",
)
private val SHARE_NOUN_IMPACT_ENTRY = ShareNoun(
    en = "an impact log entry", plAcc = "wpis z dziennika wpływu", plGen = "wpisu z dziennika wpływu",
    plGenShared = "udostępnionego",
)
private val SHARE_NOUN_SUCCESSION_PLAN = ShareNoun(
    en = "a succession plan", plAcc = "plan sukcesji", plGen = "planu sukcesji", plGenShared = "udostępnionego",
    plWhich = "który",
)

/**
 * The days-off calendar noun (v4.11.0), built from the notice's params because it names a PERSON:
 * `person` is the calendar's owner, and `self == "own"` means the sharer shared their own calendar
 * ("their" / Polish "swój"). The Polish forms keep "osoby {person}" so the sentence still names whose
 * calendar it is. [ShareNoun.plGenShared] agrees with the masculine "kalendarza".
 */
private fun calendarShareNoun(p: Map<String, String>): ShareNoun = if (p["self"] == "own") {
    ShareNoun(
        en = "their days-off calendar", plAcc = "swój kalendarz dni wolnych", plGen = "swojego kalendarza dni wolnych",
        plGenShared = "udostępnionego",
    )
} else {
    ShareNoun(
        en = "${p.v("person")}'s days-off calendar",
        plAcc = "kalendarz dni wolnych osoby ${p.v("person")}",
        plGen = "kalendarza dni wolnych osoby ${p.v("person")}",
        plGenShared = "udostępnionego",
    )
}

/**
 * The pulse-results noun (v4.12.0), built from the notice's params because it names a TEAM: `team` is
 * the team whose survey results are shared. [ShareNoun.plGenShared] agrees with the plural
 * "wyników".
 */
private fun pulseShareNoun(p: Map<String, String>): ShareNoun = ShareNoun(
    en = "the pulse survey results of ${p.v("team")}",
    plAcc = "wyniki ankiety pulsu zespołu ${p.v("team")}",
    plGen = "wyników ankiety pulsu zespołu ${p.v("team")}",
    plGenShared = "udostępnionych",
)

/** `*_SHARED` — params `{sharer}` plus the raw ISO `expiresOn` when the share has an end date. */
private fun sharedSentence(noun: ShareNoun, p: Map<String, String>): LocalizedText {
    val until = p["expiresOn"]
    return LocalizedText(
        en = "${p.v("sharer")} shared ${noun.en} with you." + (until?.let { " Access lasts until $it." } ?: ""),
        pl = "${p.v("sharer")} udostępnił/a Ci ${noun.plAcc}." + (until?.let { " Dostęp obowiązuje do $it." } ?: ""),
    )
}

/**
 * `PERFORMANCE_REVIEWS_BATCH_SHARED` (v4.10.0) / `DAYS_OFF_CALENDARS_BATCH_SHARED` (v4.11.0) — params
 * `{sharer, count}` plus the raw ISO `expiresOn` when the batch has an end date; [en]/[pl] are the
 * plural noun of the kind. Count-neutral wording ("in total") so the Polish copy needs no numeral
 * declension.
 */
private fun batchSharedSentence(p: Map<String, String>, en: String, pl: String): LocalizedText {
    val until = p["expiresOn"]
    return LocalizedText(
        en = "${p.v("sharer")} shared $en with you (${p.v("count")} in total)." +
            (until?.let { " Access lasts until $it." } ?: ""),
        pl = "${p.v("sharer")} udostępnił/a Ci $pl (łącznie: ${p.v("count")})." +
            (until?.let { " Dostęp obowiązuje do $it." } ?: ""),
    )
}

/**
 * `*_SHARE_WITHDRAWN` — three audiences share one type, told apart by params. The SHARER'S copy
 * (`self == "sharer"`, minted only when someone else — the document's author — withdrew their
 * share) names the actor and the sharee; the SHARE'S copy names the actor and the sharer, or,
 * when `actor` is absent or the sharer themselves, reads as the sharer stopping the share. The
 * succession copy carries `{sharer}` only (no `actor`/`sharee`) and is deliberately actor-neutral
 * ([ShareNoun.plWhich]): "You no longer have access to a succession plan X shared with you" — true
 * whether the sharer or the author withdrew, and naming no one else.
 */
private fun withdrawnSentence(noun: ShareNoun, p: Map<String, String>): LocalizedText {
    val actor = p["actor"]
    val sharee = p["sharee"]
    return if (p["self"] == "sharer") {
        if (actor != null && sharee != null) LocalizedText(
            en = "$actor withdrew your share of ${noun.en} with $sharee.",
            pl = "$actor wycofał/a Twoje udostępnienie ${noun.plGen} osobie $sharee.",
        ) else LocalizedText(
            en = "The owner of ${noun.en} withdrew your share of it.",
            pl = "Właściciel/ka ${noun.plGen} wycofał/a Twoje udostępnienie.",
        )
    } else if (noun.plWhich != null) {
        LocalizedText(
            en = "You no longer have access to ${noun.en} ${p.v("sharer")} shared with you.",
            pl = "Nie masz już dostępu do ${noun.plGen}, ${noun.plWhich} udostępnił/a Ci ${p.v("sharer")}.",
        )
    } else if (actor == null || actor == p["sharer"]) {
        LocalizedText(
            en = "${p.v("sharer")} stopped sharing ${noun.en} with you.",
            pl = "${p.v("sharer")} wycofał/a Twój dostęp do ${noun.plGen}.",
        )
    } else {
        LocalizedText(
            en = "$actor withdrew your access to ${noun.en} that ${p.v("sharer")} had shared with you.",
            pl = "$actor wycofał/a Twój dostęp do ${noun.plGen} ${noun.plGenShared} Ci przez ${p.v("sharer")}.",
        )
    }
}
