package ch.nokillswit.teams

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
                val team = call.receive<Team>()
                val id = teamService.create(team)
                call.response.header(HttpHeaders.Location, call.application.href(Teams.Id(id = id)))
                call.respond(HttpStatusCode.Created, team.toResponse(id))
            }
            get<Teams.Id> { route ->
                val team = teamService.read(route.id)
                if (team != null) {
                    call.respond(HttpStatusCode.OK, team.toResponse(route.id))
                } else {
                    call.respond(HttpStatusCode.NotFound)
                }
            }
            put<Teams.Id> { route ->
                val team = call.receive<Team>()
                teamService.update(route.id, team)
                call.respond(HttpStatusCode.NoContent)
            }
            delete<Teams.Id> { route ->
                teamService.delete(route.id)
                call.respond(HttpStatusCode.NoContent)
            }
            put<Teams.Id.Member> { route ->
                teamService.addMember(route.parent.id, route.userId)
                call.respond(HttpStatusCode.NoContent)
            }
            delete<Teams.Id.Member> { route ->
                teamService.removeMember(route.parent.id, route.userId)
                call.respond(HttpStatusCode.NoContent)
            }
        }
    }
}
