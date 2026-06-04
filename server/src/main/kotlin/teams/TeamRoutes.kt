package ch.nokillswit.teams

import ch.nokillswit.authz.caller
import ch.nokillswit.authz.requireSelfOrAdmin
import ch.nokillswit.authz.requireTeamManagerOrAdmin
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
@Resource("/teams")
class Teams {
    @Serializable
    @Resource("{id}")
    class Id(val parent: Teams = Teams(), val id: UInt) {
        @Serializable
        @Resource("members/{userId}")
        class Member(val parent: Id, val userId: UInt)
    }
}

fun Application.configureTeamRoutes() {
    val teamService = attributes[TeamServiceKey]

    routing {
        authenticate {
            post<Teams> {
                val caller = call.caller()
                val team = call.receive<Team>()
                requireSelfOrAdmin(caller, team.managerId)
                val id = teamService.create(team)
                call.response.header(HttpHeaders.Location, call.application.href(Teams.Id(id = id)))
                call.respond(HttpStatusCode.Created, team.toResponse(id))
            }
            get<Teams.Id> { route ->
                call.caller()
                val team = teamService.read(route.id)
                if (team != null) {
                    call.respond(HttpStatusCode.OK, team.toResponse(route.id))
                } else {
                    call.respond(HttpStatusCode.NotFound)
                }
            }
            put<Teams.Id> { route ->
                val caller = call.caller()
                val existing = teamService.read(route.id)
                if (existing == null) {
                    call.respond(HttpStatusCode.NotFound)
                    return@put
                }
                requireTeamManagerOrAdmin(caller, existing.managerId)
                val team = call.receive<Team>()
                teamService.update(route.id, team)
                call.respond(HttpStatusCode.NoContent)
            }
            delete<Teams.Id> { route ->
                val caller = call.caller()
                val existing = teamService.read(route.id)
                if (existing == null) {
                    call.respond(HttpStatusCode.NotFound)
                    return@delete
                }
                requireTeamManagerOrAdmin(caller, existing.managerId)
                teamService.delete(route.id)
                call.respond(HttpStatusCode.NoContent)
            }
            put<Teams.Id.Member> { route ->
                val caller = call.caller()
                val existing = teamService.read(route.parent.id)
                if (existing == null) {
                    call.respond(HttpStatusCode.NotFound)
                    return@put
                }
                requireTeamManagerOrAdmin(caller, existing.managerId)
                teamService.addMember(route.parent.id, route.userId)
                call.respond(HttpStatusCode.NoContent)
            }
            delete<Teams.Id.Member> { route ->
                val caller = call.caller()
                val existing = teamService.read(route.parent.id)
                if (existing == null) {
                    call.respond(HttpStatusCode.NotFound)
                    return@delete
                }
                requireTeamManagerOrAdmin(caller, existing.managerId)
                teamService.removeMember(route.parent.id, route.userId)
                call.respond(HttpStatusCode.NoContent)
            }
        }
    }
}
