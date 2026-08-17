package ch.nokillswit.users

import ch.nokillswit.infra.mail.LocalizedText
import ch.nokillswit.infra.mail.passwordEmail

/**
 * Content of the welcome email sent to newly created accounts (single create with
 * `sendEmail` and the mass import), rendered in the recipient's language (v2.21.0 — the
 * import always uses the English default). Thin wrapper over the shared scaffold
 * (infra/mail/PasswordEmail.kt).
 * NOTE: the single-user creation flow has a CLIENT-side sibling of this message — the mailto
 * draft built from `users.onboardingEmailSubject/Body` in web/src/locales, rendered in the
 * new user's chosen language — keep the two texts aligned when editing either.
 */
internal val WELCOME_EMAIL_SUBJECT: LocalizedText = LocalizedText(
    en = "Your Lettuce account is ready",
    pl = "Twoje konto Lettuce jest gotowe",
)

private val PASSWORD_LABEL = LocalizedText(en = "Password", pl = "Hasło")

internal fun welcomeEmailBody(
    name: String,
    email: String,
    password: String,
    appUrl: String?,
    language: String,
): String = passwordEmail(
    name = name,
    intro = LocalizedText(
        en = "an account has been created for you in Lettuce. Sign in with your email " +
            "address ($email) and the password below, and change the password after your " +
            "first sign-in.",
        pl = "utworzyliśmy dla Ciebie konto w Lettuce. Zaloguj się swoim adresem e-mail " +
            "($email) i hasłem poniżej, a po pierwszym logowaniu zmień hasło.",
    ),
    passwordLabel = PASSWORD_LABEL,
    password = password,
    appUrl = appUrl,
    language = language,
)
