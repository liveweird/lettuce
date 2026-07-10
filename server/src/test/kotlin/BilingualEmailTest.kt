package ch.nokillswit

import ch.nokillswit.auth.passwordResetEmailBody
import ch.nokillswit.auth.passwordResetEmailSubject
import ch.nokillswit.users.welcomeEmailBody
import ch.nokillswit.users.welcomeEmailSubject
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** Direct tests of the bilingual email builders (both are thin wrappers over
 *  infra/mail/BilingualEmail.kt — exercised here through their real content). */
class BilingualEmailTest {

    @Test
    fun `password-reset body carries both languages, the password, and warns the old one is dead`() {
        val body = passwordResetEmailBody("Alice", "s3cret-P4ss_word", appUrl = null)
        assertTrue("Hi Alice," in body)
        assertTrue("Cześć Alice," in body)
        assertTrue("New password / Nowe hasło:" in body)
        assertTrue("s3cret-P4ss_word" in body)
        assertTrue("no longer works" in body)
        assertTrue("już nie działa" in body)
        assertTrue("/" in passwordResetEmailSubject(), "subject is bilingual")
    }

    @Test
    fun `welcome body carries both languages, the email address, and the password`() {
        val body = welcomeEmailBody("Bob", "bob@x.test", "s3cret-P4ss_word", appUrl = null)
        assertTrue("Hi Bob," in body)
        assertTrue("Cześć Bob," in body)
        assertTrue("(bob@x.test)" in body)
        assertTrue("Password / Hasło:" in body)
        assertTrue("s3cret-P4ss_word" in body)
        assertTrue("/" in welcomeEmailSubject(), "subject is bilingual")
    }

    @Test
    fun `the sign-in link renders only when appUrl is configured`() {
        val without = welcomeEmailBody("Bob", "bob@x.test", "pw", appUrl = null)
        val blank = passwordResetEmailBody("Alice", "pw", appUrl = "  ")
        val with = passwordResetEmailBody("Alice", "pw", appUrl = "https://lettuce.example.com")

        assertFalse("Sign in / Zaloguj się:" in without)
        assertFalse("Sign in / Zaloguj się:" in blank, "blank appUrl counts as unconfigured")
        assertTrue("Sign in / Zaloguj się: https://lettuce.example.com" in with)
    }
}
