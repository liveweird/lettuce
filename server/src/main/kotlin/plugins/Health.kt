package ch.nokillswit.plugins

import ch.nokillswit.settings.AppSettingsServiceKey
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.*
import io.ktor.server.response.respondText
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import org.slf4j.LoggerFactory

private val healthLog = LoggerFactory.getLogger("ch.nokillswit.health")

/**
 * Kubernetes health endpoints — unauthenticated and OUTSIDE `/api/`, so the OpenAPI conformance
 * layer (which validates `/api/` traffic only) ignores them, and no spec entry is needed. They are
 * registered before the SPA catch-all (`configureRouting` is last in `application.yaml`), so a real
 * route answers ahead of the `index.html` fallback.
 *
 *  - `GET /healthz` — liveness: the process is up. It never touches the database, so a DB outage
 *    does NOT turn into a liveness restart storm (only readiness reacts to the DB).
 *  - `GET /readyz` — readiness: a cheap DB round-trip (a lookup of a never-present settings key
 *    over the AppSettings table). `200` when the database answers, `503` problem+json when it does
 *    not — so the pod is pulled from the Service until it can serve API traffic again.
 *
 * In production mode the HTTPS redirect fires on a plain-HTTP request, so the k8s probes send
 * `X-Forwarded-Proto: https` (see k8s/templates/app-deployment.yaml). In development mode (tests, the compose
 * demo) there is no redirect and the endpoints answer directly.
 */
fun Application.configureHealth() {
    routing {
        get("/healthz") {
            call.respondText("OK")
        }
        get("/readyz") {
            val probe = runCatching {
                call.application.attributes[AppSettingsServiceKey].get("__readyz_probe__")
            }
            if (probe.isSuccess) {
                call.respondText("OK")
            } else {
                healthLog.warn("readiness probe failed: database unreachable", probe.exceptionOrNull())
                call.respondProblem(HttpStatusCode.ServiceUnavailable, "Database is not reachable")
            }
        }
    }
}
