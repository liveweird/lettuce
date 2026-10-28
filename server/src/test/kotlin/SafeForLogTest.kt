package ch.nokillswit

import ch.nokillswit.plugins.DatabaseFailureLogged
import ch.nokillswit.plugins.safeForLog
import io.r2dbc.spi.R2dbcNonTransientResourceException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertSame
import kotlin.test.assertTrue

/**
 * `plugins/ErrorHandling.kt`'s [safeForLog]: a throwable with a database exception in its cause chain is replaced, for logging, by
 * a [DatabaseFailureLogged] that names the exception classes and the SQLSTATE and NEVER a message (a database message can quote
 * the offending row); anything else is handed through untouched.
 */
class SafeForLogTest {
    private val secret = "Failing row contains (secret-document-text)"

    @Test
    fun `a database failure is logged as classes and SQLSTATE, never its message`() {
        val db = R2dbcNonTransientResourceException(secret, "23505")
        val wrapped = IllegalStateException("wrapper also carries $secret", db)
        val safe = wrapped.safeForLog()
        assertIs<DatabaseFailureLogged>(safe)
        val text = safe.message.orEmpty()
        assertTrue("sqlState=23505" in text, text)
        assertTrue(IllegalStateException::class.java.name in text && R2dbcNonTransientResourceException::class.java.name in text, text)
        assertTrue("secret" !in text, "no message text may reach the log: $text")
        assertEquals(wrapped.stackTrace.toList(), safe.stackTrace.toList(), "the original call site stays diagnosable")
    }

    @Test
    fun `a failure with no database exception in its chain is returned as is`() {
        val plain = IllegalStateException("outer", IllegalArgumentException("inner"))
        assertSame(plain, plain.safeForLog())
    }

    @Test
    fun `a missing SQLSTATE is named none and a very deep chain is bounded`() {
        assertTrue("sqlState=none" in R2dbcNonTransientResourceException(secret).safeForLog().message.orEmpty())
        var deep: Throwable = RuntimeException("bottom")
        repeat(100) { deep = RuntimeException("level $it", deep) }
        val text = R2dbcNonTransientResourceException(secret, null, 0, deep).safeForLog().message.orEmpty()
        assertTrue(text.count { it == '<' } < 20, "the chain is cut off: ${text.length} chars")
    }
}
