package ch.nokillswit.alerts

import ch.nokillswit.audit.audit
import ch.nokillswit.authz.caller
import ch.nokillswit.authz.requireAdmin
import ch.nokillswit.infra.paging.optionalBoolean
import ch.nokillswit.infra.paging.optionalString
import ch.nokillswit.infra.paging.parsePaging
import ch.nokillswit.infra.paging.toPage
import ch.nokillswit.plugins.respondProblem
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.resources.Resource
import io.ktor.server.application.*
import io.ktor.server.auth.authenticate
import io.ktor.server.request.receive
import io.ktor.server.resources.delete
import io.ktor.server.resources.get
import io.ktor.server.resources.href
import io.ktor.server.resources.post
import io.ktor.server.resources.put
import io.ktor.server.response.header
import io.ktor.server.response.respond
import io.ktor.server.routing.routing
import kotlinx.serialization.Serializable

@Serializable
@Resource("/api/v1/alerts")
class Alerts {
    @Serializable
    @Resource("{id}")
    class Id(val parent: Alerts = Alerts(), val id: UInt)

    @Serializable
    @Resource("visible")
    class Visible(val parent: Alerts = Alerts())
}

fun Application.configureAlertRoutes() {
    val alertService = attributes[AlertServiceKey]

    routing {
        authenticate {
            // Management endpoints are ADMIN-only (unlike templates, non-admins have no use for
            // them); what everyone sees flows through GET /api/v1/alerts/visible below.
            get<Alerts> {
                requireAdmin(call.caller())
                val paging = call.parsePaging(sortable = setOf("id", "title", "startsAt", "endsAt"))
                val filter = AlertListFilter(
                    title = call.request.queryParameters.optionalString("title"),
                    isActive = call.request.queryParameters.optionalBoolean("isActive"),
                )
                val result = alertService.list(filter, paging)
                call.respond(HttpStatusCode.OK, paging.toPage(result.items, result.total))
            }
            post<Alerts> {
                val caller = call.caller()
                requireAdmin(caller)
                val alert = call.receive<Alert>()
                validateAlert(alert)
                val id = alertService.create(alert)
                // Admin-authored broadcast content: audited so a defaced banner has a trail.
                audit("alert.created", "byUserId" to caller.userId.toLong(), "alertId" to id.toLong())
                call.response.header(HttpHeaders.Location, call.application.href(Alerts.Id(id = id)))
                call.respond(HttpStatusCode.Created, alert.toResponse(id))
            }
            get<Alerts.Visible> {
                call.caller()
                call.respond(HttpStatusCode.OK, VisibleAlertList(items = alertService.visible()))
            }
            get<Alerts.Id> { route ->
                requireAdmin(call.caller())
                val alert = alertService.read(route.id)
                if (alert == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Alert not found")
                    return@get
                }
                call.respond(HttpStatusCode.OK, alert.toResponse(route.id))
            }
            put<Alerts.Id> { route ->
                val caller = call.caller()
                requireAdmin(caller)
                val alert = call.receive<Alert>()
                validateAlert(alert)
                if (alertService.update(route.id, alert) == 0) {
                    call.respondProblem(HttpStatusCode.NotFound, "Alert not found")
                } else {
                    audit("alert.updated", "byUserId" to caller.userId.toLong(), "alertId" to route.id.toLong())
                    call.respond(HttpStatusCode.NoContent)
                }
            }
            delete<Alerts.Id> { route ->
                val caller = call.caller()
                requireAdmin(caller)
                if (alertService.delete(route.id) == 0) {
                    call.respondProblem(HttpStatusCode.NotFound, "Alert not found")
                } else {
                    audit("alert.deleted", "byUserId" to caller.userId.toLong(), "alertId" to route.id.toLong())
                    call.respond(HttpStatusCode.NoContent)
                }
            }
        }
    }
}
