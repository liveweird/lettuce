package ch.nokillswit.teams

import ch.nokillswit.authz.caller
import ch.nokillswit.authz.requireSelfOrAdmin
import ch.nokillswit.authz.requireTeamManagerOrAdmin
import ch.nokillswit.infra.paging.parsePaging
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
import io.r2dbc.spi.R2dbcException
import org.jetbrains.exposed.v1.exceptions.ExposedSQLException

@Serializable
@Resource("/api/teams")
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

fun Application.configureTeamRoutes() {
    val teamService = attributes[TeamServiceKey]

    routing {
        authenticate {
            get<Teams> {
                call.caller()
                val paging = call.parsePaging(sortable = setOf("id", "name"))
                val params = call.request.queryParameters
                val managerIdFilter = params["managerId"]?.takeIf { it.isNotBlank() }?.let { raw ->
                    raw.toUIntOrNull()
                        ?: throw BadRequestException("managerId must be a non-negative integer")
                }
                val memberIdFilter = params["memberId"]?.takeIf { it.isNotBlank() }?.let { raw ->
                    raw.toUIntOrNull()
                        ?: throw BadRequestException("memberId must be a non-negative integer")
                }
                val filter = TeamListFilter(
                    name = params["name"]?.takeIf { it.isNotBlank() },
                    managerId = managerIdFilter,
                    memberId = memberIdFilter,
                )
                val result = teamService.list(filter, paging)
                call.respond(
                    HttpStatusCode.OK,
                    TeamPageResponse(
                        items = result.items,
                        page = paging.page,
                        pageSize = paging.pageSize,
                        total = result.total,
                    ),
                )
            }
            get<Teams.Members> {
                val caller = call.caller()
                val params = call.request.queryParameters
                val view = when (val raw = params["view"]?.takeIf { it.isNotBlank() } ?: "member") {
                    "member" -> TeamMemberListView.MEMBER
                    "managed" -> TeamMemberListView.MANAGED
                    "managers" -> TeamMemberListView.MANAGERS
                    else -> throw BadRequestException("Unknown view: $raw (allowed: member, managed, managers)")
                }
                val paging = call.parsePaging(sortable = setOf("id", "name", "email", "teamName"))
                val teamIdFilter = params["teamId"]?.takeIf { it.isNotBlank() }?.let { raw ->
                    raw.toUIntOrNull()
                        ?: throw BadRequestException("teamId must be a non-negative integer")
                }
                val filter = TeamMemberListFilter(
                    name = params["name"]?.takeIf { it.isNotBlank() },
                    email = params["email"]?.takeIf { it.isNotBlank() },
                    teamId = teamIdFilter,
                )
                val result = teamService.listMembers(view, caller.userId, filter, paging)
                call.respond(
                    HttpStatusCode.OK,
                    TeamMemberPageResponse(
                        items = result.items,
                        page = paging.page,
                        pageSize = paging.pageSize,
                        total = result.total,
                    ),
                )
            }
            post<Teams> {
                val caller = call.caller()
                val team = call.receive<Team>()
                requireSelfOrAdmin(caller, team.managerId)
                val id = try {
                    teamService.create(team)
                } catch (e: ExposedSQLException) {
                    throw BadRequestException("Referenced user does not exist", e)
                } catch (e: R2dbcException) {
                    throw BadRequestException("Referenced user does not exist", e)
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
                try {
                    teamService.update(route.id, team)
                } catch (e: ExposedSQLException) {
                    throw BadRequestException("Referenced user does not exist", e)
                } catch (e: R2dbcException) {
                    throw BadRequestException("Referenced user does not exist", e)
                }
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
                try {
                    teamService.addMember(route.parent.id, route.userId)
                } catch (e: ExposedSQLException) {
                    throw BadRequestException("Referenced user does not exist", e)
                } catch (e: R2dbcException) {
                    throw BadRequestException("Referenced user does not exist", e)
                }
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
