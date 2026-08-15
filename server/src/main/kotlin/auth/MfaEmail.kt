package ch.nokillswit.auth

/**
 * Content of the email-MFA sign-in-code email (v2.4.0). Bilingual EN+PL like every
 * transactional email (the server doesn't know the recipient's language); hand-rolled rather
 * than reusing bilingualPasswordEmail because a sign-in code needs no sign-in link — the user
 * is already mid-login.
 */
internal const val MFA_EMAIL_SUBJECT: String =
    "Lettuce: your sign-in code / twój kod logowania"

internal fun mfaEmailBody(name: String, code: String, ttlMinutes: Long): String = buildString {
    appendLine("Hi $name,")
    appendLine()
    appendLine(
        "someone — hopefully you — is signing in to your Lettuce account. Enter the code " +
            "below to finish signing in; it is valid for about $ttlMinutes minutes. If this " +
            "wasn't you, your password may be compromised — change it after signing in.",
    )
    appendLine()
    appendLine("Cześć $name,")
    appendLine()
    appendLine(
        "ktoś — mamy nadzieję, że Ty — loguje się na Twoje konto Lettuce. Wpisz poniższy " +
            "kod, aby dokończyć logowanie; kod jest ważny około $ttlMinutes min. Jeśli to " +
            "nie Ty, Twoje hasło mogło wpaść w niepowołane ręce — zmień je po zalogowaniu.",
    )
    appendLine()
    appendLine("Your sign-in code / Twój kod logowania:")
    appendLine()
    appendLine(code)
}
