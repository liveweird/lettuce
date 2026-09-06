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
        // a 500 on login would double as an account-enumeration oracle.
        val hash = hashPassword("correct-horse", cost = 4)
        assertFalse(verifyPassword("x".repeat(200), hash))
    }

    @Test
    fun `dummy login hash matches the production bcrypt work factor`() {
        val defaultHash = hashPassword("default-cost-proof")

        assertEquals(DEFAULT_BCRYPT_COST, bcryptCost(defaultHash))
        assertEquals(DEFAULT_BCRYPT_COST, bcryptCost(DUMMY_LOGIN_PASSWORD_HASH))
    }

    @Test
    fun `login password check invokes one verifier for both existing and missing accounts`() {
        val accountHash = "\$2y\$12\$account-hash"
        var calls = 0
        var verifiedHash: String? = null
        val acceptingVerifier = { _: String, hash: String ->
            calls += 1
            verifiedHash = hash
            true
        }

        assertTrue(verifyLoginPassword("candidate", accountHash, acceptingVerifier))
        assertEquals(1, calls)
        assertEquals(accountHash, verifiedHash)

        calls = 0
        verifiedHash = null
        assertFalse(verifyLoginPassword("changeme", null, acceptingVerifier))
        assertEquals(1, calls)
        assertEquals(DUMMY_LOGIN_PASSWORD_HASH, verifiedHash)

        calls = 0
        verifiedHash = null
        val rejectingVerifier = { _: String, hash: String ->
            calls += 1
            verifiedHash = hash
            false
        }
        assertFalse(verifyLoginPassword("candidate", accountHash, rejectingVerifier))
        assertEquals(1, calls)
        assertEquals(accountHash, verifiedHash)
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

    private fun bcryptCost(hash: String): Int {
        val fields = hash.split('$')
        assertEquals("", fields[0])
        return fields[2].toInt()
    }
}
