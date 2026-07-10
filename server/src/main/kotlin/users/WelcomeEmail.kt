package ch.nokillswit.users

import ch.nokillswit.infra.mail.bilingualPasswordEmail

/**
 * Content of the welcome email sent to accounts created by the mass import (when the admin
 * opts in). Thin wrapper over the shared bilingual scaffold (infra/mail/BilingualEmail.kt).
 * NOTE: the single-user creation flow has a CLIENT-side sibling of this message — the mailto
 * draft built from `users.onboardingEmailSubject/Body` in web/src/locales — keep the two
 * texts aligned when editing either.
 */
internal fun welcomeEmailSubject(): String =
    "Your Lettuce account is ready / Twoje konto Lettuce jest gotowe"

internal fun welcomeEmailBody(name: String, email: String, password: String, appUrl: String?): String =
    bilingualPasswordEmail(
        name = name,
        enIntro = "an account has been created for you in Lettuce. Sign in with your email " +
            "address ($email) and the password below, and change the password after your " +
            "first sign-in.",
        plIntro = "utworzyliśmy dla Ciebie konto w Lettuce. Zaloguj się swoim adresem e-mail " +
            "($email) i hasłem poniżej, a po pierwszym logowaniu zmień hasło.",
        passwordLabel = "Password / Hasło",
        password = password,
        appUrl = appUrl,
    )
