package ch.nokillswit.daysoff

import ch.nokillswit.audit.audit
import ch.nokillswit.authz.caller
import ch.nokillswit.authz.requireAdmin
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
import io.ktor.server.response.header
import io.ktor.server.response.respond
import io.ktor.server.routing.routing
import kotlinx.serialization.Serializable

@Serializable
@Resource("/api/v1/public-holidays")
class PublicHolidaysResource {
    @Serializable
    @Resource("{id}")
    class Id(val parent: PublicHolidaysResource = PublicHolidaysResource(), val id: UInt)
}

fun Application.configurePublicHolidayRoutes() {
    val holidayService = attributes[PublicHolidayServiceKey]

    routing {
        authenticate {
            // The whole registry, oldest date first — unpaged (the review-periods shape): the
            // registry is intrinsically small and the create-request cost preview needs all of
            // it. Any authenticated caller may read it.
            get<PublicHolidaysResource> {
                call.caller()
                call.respond(HttpStatusCode.OK, PublicHolidayList(holidayService.list()))
            }
            post<PublicHolidaysResource> {
                val caller = call.caller()
                requireAdmin(caller)
                val request = call.receive<PublicHolidayCreateRequest>()
                validatePublicHoliday(request)
                // A duplicate date is the DB's unique index → 23505 → the central 409 mapping.
                val id = holidayService.create(request)
                call.response.header(HttpHeaders.Location, call.application.href(PublicHolidaysResource.Id(id = id)))
                audit(
                    "public_holiday.created",
                    "byUserId" to caller.userId.toLong(),
                    "holidayId" to id.toLong(),
                    "date" to request.date,
                )
                val created = holidayService.read(id)
                    ?: error("Public holiday $id vanished between create and re-read")
                call.respond(HttpStatusCode.Created, created)
            }
            delete<PublicHolidaysResource.Id> { route ->
                val caller = call.caller()
                requireAdmin(caller)
                // Hard delete (see PublicHolidayService) — existing request costs stay frozen.
                if (holidayService.delete(route.id) == 0) {
                    call.respondProblem(HttpStatusCode.NotFound, "Public holiday not found")
                    return@delete
                }
                audit(
                    "public_holiday.deleted",
                    "byUserId" to caller.userId.toLong(),
                    "holidayId" to route.id.toLong(),
                )
                call.respond(HttpStatusCode.NoContent)
            }
        }
    }
}
