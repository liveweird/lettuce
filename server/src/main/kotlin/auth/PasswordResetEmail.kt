package ch.nokillswit.auth

/**
 * Content of the password-reset email. Bilingual by design (EN then PL — the server doesn't know
 * the recipient's UI language), side-effect-free so it is directly unit-testable. The password
 * appears once, shared by both language blocks; the sign-in link renders only when the
 * deployment's `mail.appUrl` is configured.
 */
internal fun passwordResetEmailSubject(): String =
    "Your new Lettuce password / Twoje nowe hasło Lettuce"

internal fun passwordResetEmailBody(name: String, password: String, appUrl: String?): String =
    buildString {
        appendLine("Hi $name,")
        appendLine()
        appendLine(
            "a password reset was requested for your Lettuce account, so your previous password " +
                "no longer works. Sign in with the new password below and change it afterwards. " +
                "If you didn't request this, someone submitted your address on the reset form — " +
                "sign in and change the password now.",
        )
        appendLine()
        appendLine("Cześć $name,")
        appendLine()
        appendLine(
            "ktoś poprosił o zresetowanie hasła do Twojego konta Lettuce, więc Twoje poprzednie " +
                "hasło już nie działa. Zaloguj się nowym hasłem poniżej, a potem je zmień. Jeśli " +
                "to nie Ty prosiłeś/aś o reset, ktoś podał Twój adres w formularzu — zaloguj się " +
                "i zmień hasło od razu.",
        )
        appendLine()
        appendLine("New password / Nowe hasło:")
        appendLine()
        appendLine(password)
        if (!appUrl.isNullOrBlank()) {
            appendLine()
            appendLine("Sign in / Zaloguj się: $appUrl")
        }
    }
