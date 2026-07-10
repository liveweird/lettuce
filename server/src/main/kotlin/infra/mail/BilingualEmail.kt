package ch.nokillswit.infra.mail

/**
 * Shared scaffold for the bilingual (EN then PL — the server doesn't know the recipient's
 * language) transactional emails that deliver a generated password. Side-effect-free and
 * directly unit-tested (BilingualEmailTest); the feature-specific wrappers
 * (auth/PasswordResetEmail.kt, users/WelcomeEmail.kt) contribute only their intro copy.
 * The sign-in link renders only when the deployment's `mail.appUrl` is configured.
 */
internal fun bilingualPasswordEmail(
    name: String,
    enIntro: String,
    plIntro: String,
    passwordLabel: String,
    password: String,
    appUrl: String?,
): String = buildString {
    appendLine("Hi $name,")
    appendLine()
    appendLine(enIntro)
    appendLine()
    appendLine("Cześć $name,")
    appendLine()
    appendLine(plIntro)
    appendLine()
    appendLine("$passwordLabel:")
    appendLine()
    appendLine(password)
    if (!appUrl.isNullOrBlank()) {
        appendLine()
        appendLine("Sign in / Zaloguj się: $appUrl")
    }
}
