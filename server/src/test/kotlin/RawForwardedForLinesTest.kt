package ch.nokillswit

import io.ktor.server.netty.EngineMain
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.Socket
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Ktor's XForwardedHeaders (3.6) resolves X-Forwarded-For through `Headers.get(name)` — the FIRST
 * header LINE only. A proxy that APPENDS its own separate X-Forwarded-For line instead of merging
 * into the one the client sent (HAProxy's `option forwardedfor`) leaves two physically distinct
 * lines on the wire, and Ktor alone would key the rate limiter on the client-supplied first one.
 * `resolveForwardedForOrigin` (plugins/Http.kt, v4.5.2) folds every line before choosing the
 * trusted hop.
 *
 * ktor-client folds repeated `header()` calls into ONE wire line before sending, so the shape can
 * only be reproduced with a raw socket against the real Netty engine (the ProductionHttpTest
 * technique). Ported from Flow's RawForwardedForLinesTest (the Flow handoff, 2026-09-26).
 */
class RawForwardedForLinesTest {

    @Test
    fun `two distinct X-Forwarded-For wire lines fold into one, in hop order`() {
        val server = EngineMain.createServer(
            arrayOf(
                "-port=0",
                "-P:ktor.development=true",
                "-P:postgres.jdbcUrl=${PostgresTestSupport.jdbcUrl}",
                "-P:postgres.r2dbcUrl=${PostgresTestSupport.r2dbcUrl}",
                "-P:postgres.user=${PostgresTestSupport.user}",
                "-P:postgres.password=${PostgresTestSupport.password}",
                "-P:security.csrf.enabled=false",
                "-P:http.behindProxy=true",
                "-P:security.rateLimit.loginPerMinute=10",
            ),
        )
        try {
            server.start(wait = false)
            val port = runBlocking { server.engine.resolvedConnectors().first().port }

            // The FIRST line rotates (a spoofing client); the SECOND is what the proxy appended
            // as its own, physically separate header line.
            fun rawLoginStatus(clientLine: String, proxyLine: String): Int {
                // A seeded account with a wrong password: an unknown email would pay the login
                // route's dummy bcrypt verify on every attempt. A fresh email per attempt keeps
                // the per-account lockout out of the picture — only the per-IP bucket counts.
                val email = uniqueEmail("xff-raw")
                runBlocking { TestUsers.seed(email, "the-right-password", roles = emptySet()) }
                Socket("127.0.0.1", port).use { socket ->
                    val body = """{"email":"$email","password":"wrong-password"}"""
                    val bytes = body.toByteArray()
                    val request = buildString {
                        append("POST /api/v1/login HTTP/1.1\r\n")
                        append("Host: 127.0.0.1:$port\r\n")
                        append("Content-Type: application/json\r\n")
                        append("Content-Length: ${bytes.size}\r\n")
                        append("X-Forwarded-For: $clientLine\r\n")
                        append("X-Forwarded-For: $proxyLine\r\n")
                        append("Connection: close\r\n")
                        append("\r\n")
                        append(body)
                    }
                    socket.soTimeout = 10_000
                    socket.getOutputStream().write(request.toByteArray(Charsets.US_ASCII))
                    socket.getOutputStream().flush()
                    val statusLine = BufferedReader(InputStreamReader(socket.getInputStream())).readLine()
                        ?: error("no response from the server")
                    return statusLine.split(" ")[1].toInt()
                }
            }

            // Ten failures from one real client (the proxy-appended line) exhaust its bucket,
            // however the client rotates its own line.
            repeat(10) { i ->
                assertEquals(401, rawLoginStatus("10.9.$i.1", "203.0.113.7"), "attempt ${i + 1}")
            }
            assertEquals(429, rawLoginStatus("10.9.99.1", "203.0.113.7"))
            // A different proxy-appended address is a different client.
            assertEquals(401, rawLoginStatus("10.9.99.1", "203.0.113.8"))
        } finally {
            server.stop(gracePeriodMillis = 100, timeoutMillis = 1_000)
        }
    }

    @Test
    fun `a junk X-Forwarded-Port is ignored rather than a 500`() {
        val server = EngineMain.createServer(
            arrayOf(
                "-port=0",
                "-P:ktor.development=true",
                "-P:postgres.jdbcUrl=${PostgresTestSupport.jdbcUrl}",
                "-P:postgres.r2dbcUrl=${PostgresTestSupport.r2dbcUrl}",
                "-P:postgres.user=${PostgresTestSupport.user}",
                "-P:postgres.password=${PostgresTestSupport.password}",
                "-P:security.csrf.enabled=false",
                "-P:http.behindProxy=true",
            ),
        )
        try {
            server.start(wait = false)
            val port = runBlocking { server.engine.resolvedConnectors().first().port }
            Socket("127.0.0.1", port).use { socket ->
                val request = "GET /healthz HTTP/1.1\r\nHost: 127.0.0.1:$port\r\n" +
                    "X-Forwarded-Port: not-a-port\r\nConnection: close\r\n\r\n"
                socket.soTimeout = 10_000
                socket.getOutputStream().write(request.toByteArray(Charsets.US_ASCII))
                socket.getOutputStream().flush()
                val statusLine = BufferedReader(InputStreamReader(socket.getInputStream())).readLine()
                    ?: error("no response from the server")
                assertEquals(200, statusLine.split(" ")[1].toInt(), statusLine)
            }
        } finally {
            server.stop(gracePeriodMillis = 100, timeoutMillis = 1_000)
        }
    }
}
