package ch.nokillswit

import ch.nokillswit.plugins.isClientDisconnect
import io.ktor.util.cio.ChannelWriteException
import io.ktor.utils.io.ClosedByteChannelException
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * The client-disconnect classifier (plugins/ErrorHandling.kt, checkup #36 C10): kept to the two
 * NAMED Ktor write-failure types so a genuine server fault never gets misclassified and
 * downgraded to a DEBUG log. A full closed-channel integration test (actually aborting a
 * response mid-transfer) is not exercised here — this pins the pure classification only.
 */
class ErrorHandlingTest {

    @Test
    fun `a ClosedByteChannelException is classified as a client disconnect`() {
        assertTrue(isClientDisconnect(ClosedByteChannelException()))
    }

    @Test
    fun `a ChannelWriteException is classified as a client disconnect`() {
        assertTrue(isClientDisconnect(ChannelWriteException("Cannot write to channel", RuntimeException())))
    }

    @Test
    fun `an unrelated exception is not classified as a client disconnect`() {
        assertFalse(isClientDisconnect(RuntimeException("boom")))
        assertFalse(isClientDisconnect(java.io.IOException("disk full")))
    }
}
