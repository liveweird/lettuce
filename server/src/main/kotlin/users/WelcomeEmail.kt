package ch.nokillswit.users

/**
 * Content of the welcome email sent to accounts created by the mass import (when the admin
 * opts in). Bilingual EN then PL like the password-reset email — the server doesn't know the
 * recipient's language — and side-effect-free so it is directly unit-testable. The sign-in
 * link renders only when the deployment's `mail.appUrl` is configured.
 */
internal fun welcomeEmailSubject(): String =
    "Your Lettuce account / Twoje konto Lettuce"

internal fun welcomeEmailBody(name: String, email: String, password: String, appUrl: String?): String =
    buildString {
        appendLine("Hi $name,")
        appendLine()
        appendLine(
            "an account has been created for you in Lettuce. Sign in with your email address " +
                "($email) and the password below, and change the password after your first sign-in.",
        )
        appendLine()
        appendLine("Cześć $name,")
        appendLine()
        appendLine(
            "utworzyliśmy dla Ciebie konto w Lettuce. Zaloguj się swoim adresem e-mail " +
                "($email) i hasłem poniżej, a po pierwszym logowaniu zmień hasło.",
        )
        appendLine()
        appendLine("Password / Hasło:")
        appendLine()
        appendLine(password)
        if (!appUrl.isNullOrBlank()) {
            appendLine()
            appendLine("Sign in / Zaloguj się: $appUrl")
        }
    }
