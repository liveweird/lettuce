package ch.nokillswit.notifications

import ch.nokillswit.users.Feature

/** A rendered notification email: bilingual subject + bilingual plain-text body. */
data class NotificationEmailContent(val subject: String, val body: String)

private data class Sentences(val en: String, val pl: String)

/**
 * Renders the email mirror of an in-app notification (v2.3.0) — pure and DB-free like the
 * `*Notifications.kt` builders. Bilingual EN then PL in one message (the BilingualEmail.kt
 * posture — the server doesn't know the recipient's language); the wording mirrors the SPA's
 * `notifications.event.*` strings, including the context variants carried in [params]
 * (`self` = "self"/"reflection" on the feedback types and "admin"/"reset" on PASSWORD_CHANGED,
 * `operation` = ADD/SUBTRACT on DAYS_OFF_CORRECTED). Dates/months/values interpolate raw
 * (ISO strings — a documented simplification; the SPA formats them per locale). The deep link
 * renders only when the notification has one AND the deployment's `mail.appUrl` is set.
 *
 * Returns null for the deliberately-not-emailed cases — today only PASSWORD_CHANGED with
 * `self == "reset"`, where the password-reset email itself is the notice. The exhaustive
 * `when` (the NotificationType.feature idiom) forces every future type to add wording.
 */
fun notificationEmailContent(
    recipientName: String,
    type: NotificationType,
    params: Map<String, String>,
    link: String?,
    appUrl: String?,
): NotificationEmailContent? {
    val s = sentences(type, params) ?: return null
    val body = buildString {
        appendLine("Hi $recipientName,")
        appendLine()
        appendLine(s.en)
        appendLine()
        appendLine("Cześć $recipientName,")
        appendLine()
        appendLine(s.pl)
        if (link != null && !appUrl.isNullOrBlank()) {
            appendLine()
            appendLine("Open in Lettuce / Otwórz w Lettuce: ${appUrl.trimEnd('/')}$link")
        }
    }
    return NotificationEmailContent(subject = subjectFor(type), body = body)
}

/** Bilingual per-area subject (the passwordResetEmailSubject idiom) — not per-type. */
private fun subjectFor(type: NotificationType): String = when (type.feature) {
    Feature.FEEDBACKS -> "Lettuce: feedback update / aktualizacja feedbacku"
    Feature.ONE_ON_ONES -> "Lettuce: 1:1 meeting / spotkanie 1:1"
    Feature.GOALS -> "Lettuce: goal update / aktualizacja celu"
    Feature.TEAM_KPIS -> "Lettuce: team KPI update / aktualizacja KPI zespołu"
    Feature.PERFORMANCE_REVIEWS -> "Lettuce: performance review / ocena okresowa"
    Feature.DAYS_OFF -> "Lettuce: days off / dni wolne"
    Feature.PULSE_SURVEYS -> "Lettuce: pulse survey / ankieta pulsu"
    // MFA mints no notifications (its emails are the sign-in codes themselves, sent directly
    // from the login flow) — same fallback as the feature-neutral security types.
    Feature.MFA, null -> "Lettuce: security notice / powiadomienie o bezpieczeństwie"
}

/** Missing-param fallback: render "?" rather than fail the whole email. */
private fun Map<String, String>.v(key: String): String = this[key] ?: "?"

private fun daysOffTypeEn(value: String): String = when (value) {
    "PAID" -> "Paid"
    "UNPAID" -> "Unpaid"
    else -> value
}

private fun daysOffTypePl(value: String): String = when (value) {
    "PAID" -> "Płatne"
    "UNPAID" -> "Bezpłatne"
    else -> value
}

@Suppress("CyclomaticComplexMethod", "LongMethod")
private fun sentences(type: NotificationType, p: Map<String, String>): Sentences? = when (type) {
    NotificationType.FEEDBACK_REQUESTED_TO_PROVIDER ->
        if (p["self"] == "self") Sentences(
            en = "${p.v("requester")} asked you for a self-reflection.",
            pl = "${p.v("requester")} poprosił/a Cię o autorefleksję.",
        ) else Sentences(
            en = "${p.v("requester")} requested feedback about ${p.v("subject")}.",
            pl = "${p.v("requester")} poprosił/a o feedback na temat ${p.v("subject")}.",
        )
    NotificationType.FEEDBACK_REQUESTED_TO_REQUESTER -> when (p["self"]) {
        "self" -> Sentences(
            en = "You asked ${p.v("provider")} for feedback on your performance.",
            pl = "Poprosiłeś/aś ${p.v("provider")} o feedback na temat swojej pracy.",
        )
        "reflection" -> Sentences(
            en = "You asked ${p.v("provider")} for a self-reflection.",
            pl = "Poprosiłeś/aś ${p.v("provider")} o autorefleksję.",
        )
        else -> Sentences(
            en = "You reached out to ${p.v("provider")} for feedback regarding ${p.v("subject")}.",
            pl = "Poprosiłeś/aś ${p.v("provider")} o feedback na temat ${p.v("subject")}.",
        )
    }
    NotificationType.FEEDBACK_SENT_TO_SUBJECT -> Sentences(
        en = "Feedback from ${p.v("provider")} about ${p.v("subject")} has been sent.",
        pl = "Feedback od ${p.v("provider")} na temat ${p.v("subject")} został wysłany.",
    )
    NotificationType.FEEDBACK_SENT_TO_PROVIDER -> Sentences(
        en = "The feedback you provided about ${p.v("subject")} has been sent.",
        pl = "Wystawiony przez Ciebie feedback na temat ${p.v("subject")} został wysłany.",
    )
    NotificationType.FEEDBACK_SENT_TO_REQUESTER ->
        if (p["self"] == "self") Sentences(
            en = "The self-reflection you requested from ${p.v("provider")} has been sent.",
            pl = "Autorefleksja, o którą prosiłeś/aś ${p.v("provider")}, została wysłana.",
        ) else Sentences(
            en = "The feedback you requested from ${p.v("provider")} about ${p.v("subject")} has been sent.",
            pl = "Feedback od ${p.v("provider")} na temat ${p.v("subject")} (na Twoją prośbę) został wysłany.",
        )
    NotificationType.FEEDBACK_SENT_TO_MANAGER ->
        if (p["self"] == "self") Sentences(
            en = "${p.v("subject")}, who reports to you, shared a self-reflection.",
            pl = "${p.v("subject")} — osoba, która Ci podlega — udostępnił/a autorefleksję.",
        ) else Sentences(
            en = "${p.v("provider")} sent feedback about ${p.v("subject")}, who reports to you.",
            pl = "${p.v("provider")} wysłał/a feedback na temat ${p.v("subject")} — osoby, która Ci podlega.",
        )
    NotificationType.FEEDBACK_REJECTED_TO_REQUESTER ->
        if (p["self"] == "self") Sentences(
            en = "${p.v("provider")} declined to write a self-reflection.",
            pl = "${p.v("provider")} odmówił/a napisania autorefleksji.",
        ) else Sentences(
            en = "${p.v("provider")} declined to provide feedback about ${p.v("subject")}.",
            pl = "${p.v("provider")} odmówił/a wystawienia feedbacku na temat ${p.v("subject")}.",
        )
    NotificationType.FEEDBACK_PICKED_UP_TO_REQUESTER ->
        if (p["self"] == "self") Sentences(
            en = "${p.v("provider")} is now drafting their self-reflection.",
            pl = "${p.v("provider")} przygotowuje właśnie swoją autorefleksję.",
        ) else Sentences(
            en = "${p.v("provider")} is now drafting feedback about ${p.v("subject")}.",
            pl = "${p.v("provider")} przygotowuje właśnie feedback na temat ${p.v("subject")}.",
        )
    NotificationType.FEEDBACK_WITHDRAWN_TO_SUBJECT -> Sentences(
        en = "Feedback from ${p.v("provider")} about ${p.v("subject")} has been withdrawn.",
        pl = "Feedback od ${p.v("provider")} na temat ${p.v("subject")} został wycofany.",
    )
    NotificationType.FEEDBACK_WITHDRAWN_TO_REQUESTER ->
        if (p["self"] == "self") Sentences(
            en = "${p.v("provider")} withdrew their self-reflection (which you requested).",
            pl = "${p.v("provider")} wycofał/a swoją autorefleksję (o którą prosiłeś/aś).",
        ) else Sentences(
            en = "${p.v("provider")} withdrew their feedback about ${p.v("subject")} (which you requested).",
            pl = "${p.v("provider")} wycofał/a swój feedback na temat ${p.v("subject")} (o który prosiłeś/aś).",
        )
    NotificationType.FEEDBACK_DELETED_TO_REQUESTER ->
        if (p["self"] == "self") Sentences(
            en = "${p.v("provider")} deleted their self-reflection (which you requested).",
            pl = "${p.v("provider")} usunął/usunęła swoją autorefleksję (o którą prosiłeś/aś).",
        ) else Sentences(
            en = "${p.v("provider")} deleted their feedback about ${p.v("subject")} (which you requested).",
            pl = "${p.v("provider")} usunął/usunęła swój feedback na temat ${p.v("subject")} (o który prosiłeś/aś).",
        )
    NotificationType.ONE_ON_ONE_CREATED_TO_SUBORDINATE -> Sentences(
        en = "${p.v("manager")} documented a 1:1 meeting with you (${p.v("date")}).",
        pl = "${p.v("manager")} udokumentował/a spotkanie 1:1 z Tobą (${p.v("date")}).",
    )
    NotificationType.ONE_ON_ONE_CREATED_TO_MANAGER -> Sentences(
        en = "You documented a 1:1 meeting with ${p.v("subordinate")} (${p.v("date")}).",
        pl = "Udokumentowałeś/aś spotkanie 1:1 z ${p.v("subordinate")} (${p.v("date")}).",
    )
    NotificationType.GOAL_ACTIVATED_TO_SUBORDINATE -> Sentences(
        en = "${p.v("manager")} activated the goal \"${p.v("title")}\" for you.",
        pl = "${p.v("manager")} aktywował/a dla Ciebie cel „${p.v("title")}”.",
    )
    NotificationType.GOAL_DEACTIVATED_TO_SUBORDINATE -> Sentences(
        en = "${p.v("manager")} returned the goal \"${p.v("title")}\" to draft.",
        pl = "${p.v("manager")} cofnął/cofnęła cel „${p.v("title")}” do szkicu.",
    )
    NotificationType.GOAL_ARCHIVED_TO_SUBORDINATE -> Sentences(
        en = "${p.v("manager")} archived the goal \"${p.v("title")}\".",
        pl = "${p.v("manager")} zarchiwizował/zarchiwizowała cel „${p.v("title")}”.",
    )
    NotificationType.GOAL_REOPENED_TO_SUBORDINATE -> Sentences(
        en = "${p.v("manager")} reopened the goal \"${p.v("title")}\".",
        pl = "${p.v("manager")} ponownie otworzył/a cel „${p.v("title")}”.",
    )
    NotificationType.GOAL_PROGRESS_UPDATED_TO_SUBORDINATE -> Sentences(
        en = "${p.v("manager")} updated the progress of your goal \"${p.v("title")}\".",
        pl = "${p.v("manager")} zaktualizował/a postęp Twojego celu „${p.v("title")}”.",
    )
    NotificationType.GOAL_PROGRESS_UPDATED_TO_MANAGER -> Sentences(
        en = "${p.v("subordinate")} updated the progress of the goal \"${p.v("title")}\".",
        pl = "${p.v("subordinate")} zaktualizował/a postęp celu „${p.v("title")}”.",
    )
    NotificationType.TEAM_KPI_ACTIVATED_TO_MEMBER -> Sentences(
        en = "${p.v("manager")} activated the KPI \"${p.v("title")}\" for team ${p.v("team")}.",
        pl = "${p.v("manager")} aktywował/a KPI „${p.v("title")}” dla zespołu ${p.v("team")}.",
    )
    NotificationType.TEAM_KPI_DEACTIVATED_TO_MEMBER -> Sentences(
        en = "${p.v("manager")} returned the KPI \"${p.v("title")}\" of team ${p.v("team")} to draft.",
        pl = "${p.v("manager")} przywrócił/przywróciła KPI „${p.v("title")}” zespołu ${p.v("team")} do szkicu.",
    )
    NotificationType.TEAM_KPI_ARCHIVED_TO_MEMBER -> Sentences(
        en = "${p.v("manager")} archived the KPI \"${p.v("title")}\" of team ${p.v("team")}.",
        pl = "${p.v("manager")} zarchiwizował/zarchiwizowała KPI „${p.v("title")}” zespołu ${p.v("team")}.",
    )
    NotificationType.TEAM_KPI_REOPENED_TO_MEMBER -> Sentences(
        en = "${p.v("manager")} reopened the KPI \"${p.v("title")}\" of team ${p.v("team")}.",
        pl = "${p.v("manager")} ponownie otworzył/a KPI „${p.v("title")}” zespołu ${p.v("team")}.",
    )
    NotificationType.TEAM_KPI_VALUE_RECORDED_TO_MEMBER -> Sentences(
        en = "${p.v("manager")} recorded ${p.v("value")} for ${p.v("date")} on the KPI \"${p.v("title")}\" of team ${p.v("team")}.",
        pl = "${p.v("manager")} zapisał/zapisała wartość ${p.v("value")} z dnia ${p.v("date")} w KPI „${p.v("title")}” zespołu ${p.v("team")}.",
    )
    NotificationType.TEAM_KPI_VALUE_CORRECTED_TO_MEMBER -> Sentences(
        en = "${p.v("manager")} corrected a data point of the KPI \"${p.v("title")}\" of team ${p.v("team")}: " +
            "${p.v("fromValue")} (${p.v("fromDate")}) → ${p.v("toValue")} (${p.v("toDate")}).",
        pl = "${p.v("manager")} poprawił/poprawiła punkt danych KPI „${p.v("title")}” zespołu ${p.v("team")}: " +
            "${p.v("fromValue")} (${p.v("fromDate")}) → ${p.v("toValue")} (${p.v("toDate")}).",
    )
    NotificationType.TEAM_KPI_VALUE_REMOVED_TO_MEMBER -> Sentences(
        en = "${p.v("manager")} removed the value ${p.v("value")} (${p.v("date")}) from the KPI \"${p.v("title")}\" of team ${p.v("team")}.",
        pl = "${p.v("manager")} usunął/usunęła wartość ${p.v("value")} (${p.v("date")}) z KPI „${p.v("title")}” zespołu ${p.v("team")}.",
    )
    NotificationType.PERFORMANCE_REVIEW_PUBLISHED_TO_SUBORDINATE -> Sentences(
        en = "${p.v("manager")} published your performance review for the period ${p.v("startMonth")} – ${p.v("endMonth")}.",
        pl = "${p.v("manager")} opublikował/a Twoją ocenę okresową za okres ${p.v("startMonth")} – ${p.v("endMonth")}.",
    )
    NotificationType.PERFORMANCE_REVIEW_UNPUBLISHED_TO_SUBORDINATE -> Sentences(
        en = "${p.v("manager")} retracted your performance review for the period ${p.v("startMonth")} – ${p.v("endMonth")}.",
        pl = "${p.v("manager")} wycofał/a Twoją ocenę okresową za okres ${p.v("startMonth")} – ${p.v("endMonth")}.",
    )
    NotificationType.DAYS_OFF_REQUESTED_TO_MANAGER -> Sentences(
        en = "${p.v("requester")} requested time off ${p.v("startDate")} – ${p.v("endDate")} " +
            "(${daysOffTypeEn(p.v("type"))}, ${p.v("days")} day(s)).",
        pl = "${p.v("requester")} złożył/złożyła wniosek o dni wolne ${p.v("startDate")} – ${p.v("endDate")} " +
            "(${daysOffTypePl(p.v("type"))}, dni: ${p.v("days")}).",
    )
    NotificationType.DAYS_OFF_ACCEPTED_TO_OWNER -> Sentences(
        en = "${p.v("manager")} accepted your days-off request (${p.v("startDate")} – ${p.v("endDate")}).",
        pl = "${p.v("manager")} zaakceptował/zaakceptowała Twój wniosek o dni wolne (${p.v("startDate")} – ${p.v("endDate")}).",
    )
    NotificationType.DAYS_OFF_REJECTED_TO_OWNER -> Sentences(
        en = "${p.v("manager")} rejected your days-off request (${p.v("startDate")} – ${p.v("endDate")}).",
        pl = "${p.v("manager")} odrzucił/odrzuciła Twój wniosek o dni wolne (${p.v("startDate")} – ${p.v("endDate")}).",
    )
    NotificationType.DAYS_OFF_CANCELLED_TO_MANAGER -> Sentences(
        en = "${p.v("requester")} cancelled their days-off request (${p.v("startDate")} – ${p.v("endDate")}).",
        pl = "${p.v("requester")} anulował/anulowała swój wniosek o dni wolne (${p.v("startDate")} – ${p.v("endDate")}).",
    )
    NotificationType.DAYS_OFF_CORRECTED_TO_OWNER ->
        if (p["operation"] == "SUBTRACT") Sentences(
            en = "${p.v("manager")} subtracted ${p.v("days")} day(s) from your paid days-off budget for ${p.v("year")}.",
            pl = "${p.v("manager")} odjął/odjęła ${p.v("days")} dni z Twojego budżetu płatnych dni na rok ${p.v("year")}.",
        ) else Sentences(
            en = "${p.v("manager")} added ${p.v("days")} day(s) to your paid days-off budget for ${p.v("year")}.",
            pl = "${p.v("manager")} dodał/dodała ${p.v("days")} dni do Twojego budżetu płatnych dni na rok ${p.v("year")}.",
        )
    NotificationType.PULSE_CYCLE_SCHEDULED -> Sentences(
        en = "A pulse survey is scheduled to open on ${p.v("openDate")}.",
        pl = "Ankieta pulsu zostanie otwarta ${p.v("openDate")}.",
    )
    NotificationType.PULSE_CYCLE_OPENED -> Sentences(
        en = "The pulse survey is open — share your answers by ${p.v("closeDate")}.",
        pl = "Ankieta pulsu jest otwarta — odpowiedz do ${p.v("closeDate")}.",
    )
    NotificationType.PULSE_RESULTS_AVAILABLE -> Sentences(
        en = "Pulse survey results are available.",
        pl = "Wyniki ankiety pulsu są już dostępne.",
    )
    NotificationType.PULSE_CYCLE_CANCELLED -> Sentences(
        en = "The pulse survey planned for ${p.v("openDate")} was cancelled.",
        pl = "Ankieta pulsu zaplanowana na ${p.v("openDate")} została anulowana.",
    )
    NotificationType.PASSWORD_CHANGED -> when (p["self"]) {
        // The reset flow's own email (with the new password) IS the notice — no duplicate.
        "reset" -> null
        "admin" -> Sentences(
            en = "An administrator changed your password.",
            pl = "Administrator zmienił Twoje hasło.",
        )
        else -> Sentences(
            en = "Your password was changed.",
            pl = "Twoje hasło zostało zmienione.",
        )
    }
}
