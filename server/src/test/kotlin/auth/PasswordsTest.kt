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
    fun `exceedsBcryptLimit counts UTF-8 bytes with the boundary at 71`() {
        assertFalse(exceedsBcryptLimit("a".repeat(MAX_PASSWORD_BYTES)))
        assertTrue(exceedsBcryptLimit("a".repeat(MAX_PASSWORD_BYTES + 1)))
        // Multi-byte characters count as bytes, not chars: 24 × 'ó' (2 bytes) = 48 ok; 36 × = 72 over.
        assertFalse(exceedsBcryptLimit("ó".repeat(24)))
        assertTrue(exceedsBcryptLimit("ó".repeat(36)))
    }

    @Test
    fun `hashPassword accepts exactly the bcrypt byte ceiling`() {
        val atLimit = "a".repeat(MAX_PASSWORD_BYTES)
        assertTrue(verifyPassword(atLimit, hashPassword(atLimit, cost = 4)))
    }

    @Test
    fun `verifyPassword treats an over-long candidate as non-matching instead of throwing`() {
        // bcrypt throws IllegalArgumentException above 72 bytes incl. terminator; surfacing that as
        // a 500 on login would double as an account-enumeration oracle (unknown emails
        // short-circuit to 401 before hashing).
        val hash = hashPassword("correct-horse", cost = 4)
        assertFalse(verifyPassword("x".repeat(200), hash))
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
