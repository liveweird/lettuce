package ch.nokillswit

import io.ktor.client.request.request
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The anonymous-access sweep (v2.4.1): every operation in the OpenAPI spec that requires bearer
 * auth and declares a 401 must answer exactly 401 (+ problem+json) to a request with NO
 * Authorization header. Spec-driven via [OpenApiSpec.parsed], so a new endpoint joins the sweep
 * the moment it is specced — this closed the audit finding that whole newer feature areas
 * (pulse, days-off, reviews, 1:1s, templates, alerts, the registries) had zero anonymous-request
 * coverage while the older ones asserted it per-suite.
 */
class AnonymousAccessTest {

    @Test
    fun `every bearer-authenticated operation answers 401 to an anonymous request`() = testApplication {
        usePostgresTestcontainer()
        val client = jsonClient()
        val paths = OpenApiSpec.parsed.paths
        var swept = 0
        val failures = mutableListOf<String>()

        for ((rawPath, item) in paths) {
            val ops = mapOf(
                HttpMethod.Get to item.get,
                HttpMethod.Post to item.post,
                HttpMethod.Put to item.put,
                HttpMethod.Delete to item.delete,
                HttpMethod.Patch to item.patch,
            )
            for ((method, op) in ops) {
                if (op == null) continue
                // `security: []` marks the anonymous auth endpoints (login family, password
                // reset) — they have no bearer requirement to sweep.
                if (op.security != null && op.security.isEmpty()) continue
                if (op.responses?.containsKey("401") != true) continue

                // Substitute dummy values for path params; the JWT challenge runs before any
                // routing-level 404, so the id never matters.
                val path = rawPath
                    .replace(Regex("""\{[a-zA-Z]*[iI]d\}"""), "999999999")
                    .replace("{dictionary}", "career-paths")
                    .replace(Regex("""\{[a-zA-Z]+\}"""), "1")
                val response = client.request(path) {
                    this.method = method
                    // A body-less POST/PUT must still 401 (auth precedes body parsing), but send
                    // a JSON stub so nothing else in the pipeline balks first.
                    if (method == HttpMethod.Post || method == HttpMethod.Put) {
                        contentType(ContentType.Application.Json)
                        setBody("{}")
                    }
                }
                swept += 1
                if (response.status != HttpStatusCode.Unauthorized) {
                    failures += "$method $path -> ${response.status} (${response.bodyAsText().take(120)})"
                } else if (response.contentType()?.match("application/problem+json") != true) {
                    failures += "$method $path -> 401 but content type ${response.contentType()}"
                }
            }
        }

        assertTrue(failures.isEmpty(), "anonymous requests not answered 401+problem+json:\n${failures.joinToString("\n")}")
        // Sanity floor: the sweep must actually cover the API surface (129 ops at v2.4.1) —
        // a parsing regression that swept nothing would otherwise pass vacuously.
        assertTrue(swept >= 100, "expected to sweep >=100 operations, swept $swept")
        assertEquals(0, failures.size)
    }
}
