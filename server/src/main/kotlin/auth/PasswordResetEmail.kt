package ch.nokillswit.auth

import ch.nokillswit.infra.mail.bilingualPasswordEmail

/**
 * Content of the password-reset email. Thin wrapper over the shared bilingual scaffold
 * (infra/mail/BilingualEmail.kt) — only the intro copy and the password label live here.
 */
internal fun passwordResetEmailSubject(): String =
    "Your new Lettuce password / Twoje nowe hasło Lettuce"

internal fun passwordResetEmailBody(name: String, password: String, appUrl: String?): String =
    bilingualPasswordEmail(
        name = name,
        enIntro = "a password reset was requested for your Lettuce account, so your previous " +
            "password no longer works. Sign in with the new password below and change it " +
            "afterwards. If you didn't request this, someone submitted your address on the " +
            "reset form — sign in and change the password now.",
        plIntro = "ktoś poprosił o zresetowanie hasła do Twojego konta Lettuce, więc Twoje " +
            "poprzednie hasło już nie działa. Zaloguj się nowym hasłem poniżej, a potem je " +
            "zmień. Jeśli to nie Ty prosiłeś/aś o reset, ktoś podał Twój adres w formularzu — " +
            "zaloguj się i zmień hasło od razu.",
        passwordLabel = "New password / Nowe hasło",
        password = password,
        appUrl = appUrl,
    )
