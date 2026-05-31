package ch.nokillswit.auth

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

class PasswordsTest {

    @Test
    fun `verifyPassword accepts the plaintext it was hashed from`() {
        val hash = hashPassword("correct-horse", cost = 4)
        assertTrue(verifyPassword("correct-horse", hash))
    }

    @Test
    fun `verifyPassword rejects a different plaintext`() {
        val hash = hashPassword("correct-horse", cost = 4)
        assertFalse(verifyPassword("wrong-horse", hash))
    }

    @Test
    fun `hashPassword is salted - two calls produce different hashes that both verify`() {
        val first = hashPassword("same-password", cost = 4)
        val second = hashPassword("same-password", cost = 4)
        assertNotEquals(first, second, "bcrypt hashes must include a per-call salt")
        assertTrue(verifyPassword("same-password", first))
        assertTrue(verifyPassword("same-password", second))
        // Sanity: equal-comparison of hashes is NOT a valid password check.
        assertEquals(false, first == second)
    }
}
