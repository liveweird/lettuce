package ch.nokillswit

import io.ktor.server.netty.EngineMain
import java.io.ByteArrayOutputStream
import java.net.Socket
import java.net.SocketTimeoutException
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The request-body size cap (v4.14.1, plugins/BodyLimit.kt) against the real Netty engine over a
 * raw socket — the wire shapes `testApplication` cannot produce: the Ktor client refuses a manual
 * `Content-Length` (UnsafeHeaderException) and never emits wire-level chunking. Boot shape ported
 * from RawForwardedForLinesTest.
 */
class RawRequestBodyLimitTest {

    private fun withServer(block: (port: Int) -> Unit) {
        val server = EngineMain.createServer(
            arrayOf(
                "-port=0",
                "-P:ktor.development=true",
                "-P:postgres.jdbcUrl=${PostgresTestSupport.jdbcUrl}",
                "-P:postgres.r2dbcUrl=${PostgresTestSupport.r2dbcUrl}",
                "-P:postgres.user=${PostgresTestSupport.user}",
                "-P:postgres.password=${PostgresTestSupport.password}",
                "-P:security.csrf.enabled=false",
                "-P:http.maxBodyBytes=4096",
            ),
        )
        try {
            server.start(wait = false)
            block(runBlocking { server.engine.resolvedConnectors().first().port })
        } finally {
            server.stop(gracePeriodMillis = 100, timeoutMillis = 1_000)
        }
    }

    /** The raw response (status line, headers, body so far) until the server closes or goes quiet. */
    private fun exchange(port: Int, head: String, body: ByteArray = ByteArray(0)): String {
        Socket("127.0.0.1", port).use { socket ->
            socket.soTimeout = 5_000
            val out = socket.getOutputStream()
            // The server may answer and close before the whole body is written (a 413 on the
            // declared length) — a reset mid-write is the cap working, not a test failure.
            runCatching {
                out.write(head.toByteArray(Charsets.US_ASCII))
                out.write(body)
                out.flush()
            }
            val response = ByteArrayOutputStream()
            val buffer = ByteArray(4096)
            try {
                while (true) {
                    val n = socket.getInputStream().read(buffer)
                    if (n < 0) break
                    response.write(buffer, 0, n)
                    // Enough to judge: the status line and the headers have arrived.
                    if (response.toString(Charsets.ISO_8859_1).contains("\r\n\r\n")) break
                }
            } catch (_: SocketTimeoutException) {
                // handled by the caller's assertions (an empty/partial response fails them)
            }
            return response.toString(Charsets.ISO_8859_1)
        }
    }

    private fun status(response: String): Int =
        response.lineSequence().firstOrNull()?.split(" ")?.getOrNull(1)?.toIntOrNull()
            ?: error("no HTTP status line in: '$response'")

    private fun loginHead(port: Int, vararg headers: String) = buildString {
        append("POST /api/v1/login HTTP/1.1\r\n")
        append("Host: 127.0.0.1:$port\r\n")
        append("Content-Type: application/json\r\n")
        headers.forEach { append(it).append("\r\n") }
        append("Connection: close\r\n\r\n")
    }

    private fun chunked(totalBytes: Int, chunkBytes: Int = 1024): ByteArray {
        val out = ByteArrayOutputStream()
        var left = totalBytes
        while (left > 0) {
            val n = minOf(chunkBytes, left)
            out.write("${n.toString(16)}\r\n".toByteArray())
            out.write(ByteArray(n) { ' '.code.toByte() })
            out.write("\r\n".toByteArray())
            left -= n
        }
        out.write("0\r\n\r\n".toByteArray())
        return out.toByteArray()
    }

    @Test
    fun `a Transfer-Encoding chunked body past the cap is a 413 problem on the wire`() = withServer { port ->
        val response = exchange(port, loginHead(port, "Transfer-Encoding: chunked"), chunked(8 * 1024))
        assertEquals(413, status(response), response)
        assertTrue(response.contains("application/problem+json", ignoreCase = true), response)
    }

    @Test
    fun `Transfer-Encoding together with Content-Length is rejected by Netty before the cap runs`() =
        withServer { port ->
            // RFC 9112 6.1: a message with both is ambiguous framing (request smuggling); Netty's
            // decoder refuses it, so the handler and the cap never see the body.
            val response = exchange(
                port,
                loginHead(port, "Transfer-Encoding: chunked", "Content-Length: 10"),
                chunked(8 * 1024),
            )
            assertEquals(400, status(response), response)
        }

    @Test
    fun `a declared Content-Length far over the cap is refused without a single body byte`() = withServer { port ->
        val response = exchange(port, loginHead(port, "Content-Length: 99999999"))
        assertEquals(413, status(response), response)
    }

    /**
     * Writes [head], then (optionally) keeps UPLOADING [uploadBytes] of body from a second thread, and
     * reads ONE complete response — status line, headers and a Content-Length body — without the
     * server having to close anything. A reset before the response was read fails the read.
     */
    private fun exchangeFull(port: Int, head: String, uploadBytes: Int = 0): String {
        Socket("127.0.0.1", port).use { socket ->
            socket.soTimeout = 5_000
            socket.getOutputStream().write(head.toByteArray(Charsets.ISO_8859_1))
            socket.getOutputStream().flush()
            if (uploadBytes > 0) {
                Thread {
                    runCatching {
                        val chunk = ByteArray(8192) { ' '.code.toByte() }
                        var sent = 0
                        while (sent < uploadBytes) {
                            socket.getOutputStream().write(chunk)
                            sent += chunk.size
                        }
                        socket.getOutputStream().flush()
                    }
                }.apply { isDaemon = true }.start()
            }
            val response = ByteArrayOutputStream()
            val buffer = ByteArray(4096)
            fun text() = response.toString(Charsets.ISO_8859_1)
            while (true) {
                val soFar = text()
                val headerEnd = soFar.indexOf("\r\n\r\n")
                if (headerEnd >= 0) {
                    val length = Regex("(?i)content-length: *(\\d+)").find(soFar.substring(0, headerEnd))
                        ?.groupValues?.get(1)?.toInt() ?: 0
                    if (soFar.length >= headerEnd + 4 + length) return soFar
                }
                val n = socket.getInputStream().read(buffer)
                if (n < 0) return soFar
                response.write(buffer, 0, n)
            }
        }
    }

    @Test
    fun `a keep-alive request refused on its declared length gets a complete 413 with Connection close`() =
        withServer { port ->
            // The server does not force the close (a RST can destroy the 413 itself): it signals
            // `Connection: close` and a conforming client closes after reading the response.
            val head = "POST /api/v1/login HTTP/1.1\r\nHost: 127.0.0.1:$port\r\n" +
                "Content-Type: application/json\r\nContent-Length: 99999999\r\n\r\n"
            val response = exchangeFull(port, head)
            assertEquals(413, status(response), response)
            assertTrue(response.contains("Connection: close", ignoreCase = true), response)
            assertTrue(response.contains("Request body must not exceed 4096 bytes"), response)
        }

    @Test
    fun `a client that keeps uploading after the headers still reads a complete 413`() = withServer { port ->
        val head = "POST /api/v1/login HTTP/1.1\r\nHost: 127.0.0.1:$port\r\n" +
            "Content-Type: application/json\r\nContent-Length: 99999999\r\n\r\n"
        val response = exchangeFull(port, head, uploadBytes = 1024 * 1024)
        assertEquals(413, status(response), response)
        assertTrue(response.contains("application/problem+json", ignoreCase = true), response)
        assertTrue(response.contains("Request body must not exceed 4096 bytes"), response)
    }

    @Test
    fun `control bytes in the path never reach the 413 log line and the query string is absent`() = withServer { port ->
        val logger = org.slf4j.LoggerFactory.getLogger("Application") as ch.qos.logback.classic.Logger
        val before = logger.level
        logger.level = ch.qos.logback.classic.Level.DEBUG
        val capture = LogCapture("Application")
        try {
            val head = "POST /api/v1/login\u001b[31m\u007fFORGED?secret=abc HTTP/1.1\r\nHost: 127.0.0.1:$port\r\n" +
                "Content-Type: application/json\r\nContent-Length: 99999999\r\nConnection: close\r\n\r\n"
            val response = exchangeFull(port, head)
            assertEquals(413, status(response), response)
            val line = runBlocking {
                capture.requireEvent("the 413 log line") { it.formattedMessage.startsWith("Request body rejected") }
            }.formattedMessage
            assertTrue(line.none { it.code < 0x20 || it.code > 0x7E }, "control bytes leaked: ${line.map { it.code }}")
            assertTrue("login" in line && "secret" !in line, line)
        } finally {
            capture.detach()
            logger.level = before
        }
    }
}
