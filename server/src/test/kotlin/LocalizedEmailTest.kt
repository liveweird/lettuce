package ch.nokillswit

import ch.nokillswit.auth.passwordResetEmailBody
import ch.nokillswit.auth.PASSWORD_RESET_EMAIL_SUBJECT
import ch.nokillswit.dictionaries.SUPPORTED_LANGUAGES
import ch.nokillswit.infra.mail.LocalizedText
import ch.nokillswit.users.welcomeEmailBody
import ch.nokillswit.users.WELCOME_EMAIL_SUBJECT
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Direct tests of the per-language email builders (v2.21.0 — thin wrappers over
 *  infra/mail/PasswordEmail.kt, exercised here through their real content). */
class LocalizedEmailTest {

    @Test
    fun `LocalizedText resolves every supported language and falls back to English`() {
        val text = LocalizedText(en = "EN", pl = "PL")
        assertEquals("EN", text.of("en"))
        assertEquals("PL", text.of("pl"))
        assertEquals("EN", text.of("xx"), "an unknown code falls back to English")
        // The registry guard: no supported language may fall into the EN fallback — adding a
        // language to SUPPORTED_LANGUAGES must extend LocalizedText (and this sentinel map).
        val sentinels = mapOf("en" to "EN", "pl" to "PL")
        SUPPORTED_LANGUAGES.forEach { lang ->
            assertEquals(sentinels.getValue(lang), text.of(lang), "no wording for supported language '$lang'")
        }
    }

    @Test
    fun `password-reset body renders one language with the password and the dead-password warning`() {
        val en = passwordResetEmailBody("Alice", "s3cret-P4ss_word", appUrl = null, language = "en")
        assertTrue("Hi Alice," in en)
        assertFalse("Cześć" in en, "the EN body must not carry Polish")
        assertTrue("New password:" in en)
        assertTrue("s3cret-P4ss_word" in en)
        assertTrue("no longer works" in en)

        val pl = passwordResetEmailBody("Alice", "s3cret-P4ss_word", appUrl = null, language = "pl")
        assertTrue("Cześć Alice," in pl)
        assertFalse("Hi Alice," in pl, "the PL body must not carry English")
        assertTrue("Nowe hasło:" in pl)
        assertTrue("już nie działa" in pl)

        assertEquals("Your new Lettuce password", PASSWORD_RESET_EMAIL_SUBJECT.of("en"))
        assertEquals("Twoje nowe hasło Lettuce", PASSWORD_RESET_EMAIL_SUBJECT.of("pl"))
    }

    @Test
    fun `welcome body renders one language with the email address and the password`() {
        val en = welcomeEmailBody("Bob", "bob@x.test", "s3cret-P4ss_word", appUrl = null, language = "en")
        assertTrue("Hi Bob," in en)
        assertTrue("(bob@x.test)" in en)
        assertTrue("Password:" in en)
        assertTrue("s3cret-P4ss_word" in en)
        assertFalse("Hasło" in en)

        val pl = welcomeEmailBody("Bob", "bob@x.test", "s3cret-P4ss_word", appUrl = null, language = "pl")
        assertTrue("Cześć Bob," in pl)
        assertTrue("Hasło:" in pl)
        assertFalse("Hi Bob," in pl)

        assertEquals("Your Lettuce account is ready", WELCOME_EMAIL_SUBJECT.of("en"))
        assertEquals("Twoje konto Lettuce jest gotowe", WELCOME_EMAIL_SUBJECT.of("pl"))
    }

    @Test
    fun `the sign-in link renders only when appUrl is configured, in the body's language`() {
        val without = welcomeEmailBody("Bob", "bob@x.test", "pw", appUrl = null, language = "en")
        val blank = passwordResetEmailBody("Alice", "pw", appUrl = "  ", language = "en")
        val en = passwordResetEmailBody("Alice", "pw", appUrl = "https://lettuce.example.com", language = "en")
        val pl = passwordResetEmailBody("Alice", "pw", appUrl = "https://lettuce.example.com", language = "pl")

        assertFalse("Sign in:" in without)
        assertFalse("Sign in:" in blank, "blank appUrl counts as unconfigured")
        assertTrue("Sign in: https://lettuce.example.com" in en)
        assertTrue("Zaloguj się: https://lettuce.example.com" in pl)
    }
}
