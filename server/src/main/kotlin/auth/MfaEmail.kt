package ch.nokillswit.auth

import ch.nokillswit.infra.mail.LocalizedText

/**
 * Content of the email-MFA sign-in-code email (v2.4.0), rendered in the recipient's language
 * (v2.21.0). Hand-rolled rather than reusing passwordEmail because a sign-in code needs no
 * sign-in link — the user is already mid-login.
 */
internal val MFA_EMAIL_SUBJECT: LocalizedText = LocalizedText(
    en = "Lettuce: your sign-in code",
    pl = "Lettuce: twój kod logowania",
)

private val GREETING = LocalizedText(en = "Hi", pl = "Cześć")

private val CODE_LABEL = LocalizedText(en = "Your sign-in code", pl = "Twój kod logowania")

internal fun mfaEmailBody(name: String, code: String, ttlMinutes: Long, language: String): String = buildString {
    val intro = LocalizedText(
        en = "someone — hopefully you — is signing in to your Lettuce account. Enter the code " +
            "below to finish signing in; it is valid for about $ttlMinutes minutes. If this " +
            "wasn't you, your password may be compromised — change it after signing in.",
        pl = "ktoś — mamy nadzieję, że Ty — loguje się na Twoje konto Lettuce. Wpisz poniższy " +
            "kod, aby dokończyć logowanie; kod jest ważny około $ttlMinutes min. Jeśli to " +
            "nie Ty, Twoje hasło mogło wpaść w niepowołane ręce — zmień je po zalogowaniu.",
    )
    appendLine("${GREETING.of(language)} $name,")
    appendLine()
    appendLine(intro.of(language))
    appendLine()
    appendLine("${CODE_LABEL.of(language)}:")
    appendLine()
    appendLine(code)
}
