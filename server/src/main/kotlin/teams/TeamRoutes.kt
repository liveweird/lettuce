package ch.nokillswit.teams

import ch.nokillswit.authz.caller
import ch.nokillswit.authz.requireCanReassignManager
import ch.nokillswit.authz.requireSelfOrAdmin
import ch.nokillswit.authz.requireTeamManagerOrAdmin
import ch.nokillswit.infra.db.requireValidReferences
import ch.nokillswit.infra.paging.parsePaging
import ch.nokillswit.infra.paging.optionalBoolean
import ch.nokillswit.infra.paging.optionalString
import ch.nokillswit.infra.paging.optionalUInt
import ch.nokillswit.infra.paging.toPage
import ch.nokillswit.plugins.respondProblem
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.resources.Resource
import io.ktor.server.application.*
import io.ktor.server.auth.authenticate
import io.ktor.server.plugins.BadRequestException
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
@Resource("/api/v1/teams")
class Teams {
    @Serializable
    @Resource("members")
    class Members(val parent: Teams = Teams())

    @Serializable
    @Resource("{id}")
    class Id(val parent: Teams = Teams(), val id: UInt) {
        @Serializable
        @Resource("members/{userId}")
        class Member(val parent: Id, val userId: UInt)
    }
}

// Column limit (teams.name varchar(100)) enforced up-front: 400 instead of a DB-level 500.
private const val MAX_TEAM_NAME_LENGTH = 100

private fun validateTeamName(name: String) {
    if (name.isBlank()) throw BadRequestException("Team name must not be blank")
    if (name.length > MAX_TEAM_NAME_LENGTH) {
        throw BadRequestException("Team name must be at most $MAX_TEAM_NAME_LENGTH characters")
    }
}

fun Application.configureTeamRoutes() {
    val teamService = attributes[TeamServiceKey]

    routing {
        authenticate {
            get<Teams> {
                call.caller()
                val paging = call.parsePaging(sortable = setOf("id", "name"))
                val params = call.request.queryParameters
                val filter = TeamListFilter(
                    name = params.optionalString("name"),
                    managerId = params.optionalUInt("managerId"),
                    memberId = params.optionalUInt("memberId"),
                )
                val result = teamService.list(filter, paging)
                call.respond(HttpStatusCode.OK, paging.toPage(result.items, result.total))
            }
            get<Teams.Members> {
                val caller = call.caller()
                val params = call.request.queryParameters
                val view = when (val raw = params.optionalString("view") ?: "member") {
                    "member" -> TeamMemberListView.MEMBER
                    "managed" -> TeamMemberListView.MANAGED
                    "managers" -> TeamMemberListView.MANAGERS
                    else -> throw BadRequestException("Unknown view: $raw (allowed: member, managed, managers)")
                }
                val includeIndirect = params.optionalBoolean("includeIndirect")
                if (includeIndirect != null && view != TeamMemberListView.MANAGED) {
                    throw BadRequestException("includeIndirect is only supported for view=managed")
                }
                val paging = call.parsePaging(sortable = setOf("id", "name", "email", "teamName"))
                val filter = TeamMemberListFilter(
                    name = params.optionalString("name"),
                    email = params.optionalString("email"),
                    teamId = params.optionalUInt("teamId"),
                )
                val result = teamService.listMembers(
                    view,
                    caller.userId,
                    filter,
                    paging,
                    includeIndirect = includeIndirect == true,
                )
                call.respond(HttpStatusCode.OK, paging.toPage(result.items, result.total))
            }
            post<Teams> {
                val caller = call.caller()
                val team = call.receive<Team>()
                requireSelfOrAdmin(caller, team.managerId)
                validateTeamName(team.name)
                val id = requireValidReferences("Referenced user does not exist") {
                    teamService.create(team)
                }
                call.response.header(HttpHeaders.Location, call.application.href(Teams.Id(id = id)))
                call.respond(HttpStatusCode.Created, team.toResponse(id))
            }
            get<Teams.Id> { route ->
                call.caller()
                val team = teamService.read(route.id)
                if (team != null) {
                    call.respond(HttpStatusCode.OK, team.toResponse(route.id))
                } else {
                    call.respondProblem(HttpStatusCode.NotFound, "Team not found")
                }
            }
            put<Teams.Id> { route ->
                val caller = call.caller()
                val existing = teamService.read(route.id)
                if (existing == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Team not found")
                    return@put
                }
                requireTeamManagerOrAdmin(caller, existing.managerId)
                val team = call.receive<Team>()
                validateTeamName(team.name)
                requireCanReassignManager(caller, existing.managerId, team.managerId)
                requireValidReferences("Referenced user does not exist") {
                    teamService.update(route.id, team)
                }
                call.respond(HttpStatusCode.NoContent)
            }
            delete<Teams.Id> { route ->
                val caller = call.caller()
                val existing = teamService.read(route.id)
                if (existing == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Team not found")
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
                    call.respondProblem(HttpStatusCode.NotFound, "Team not found")
                    return@put
                }
                requireTeamManagerOrAdmin(caller, existing.managerId)
                requireValidReferences("Referenced user does not exist") {
                    teamService.addMember(route.parent.id, route.userId)
                }
                call.respond(HttpStatusCode.NoContent)
            }
            delete<Teams.Id.Member> { route ->
                val caller = call.caller()
                val existing = teamService.read(route.parent.id)
                if (existing == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Team not found")
                    return@delete
                }
                requireTeamManagerOrAdmin(caller, existing.managerId)
                teamService.removeMember(route.parent.id, route.userId)
                call.respond(HttpStatusCode.NoContent)
            }
        }
    }
}
