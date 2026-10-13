package ch.nokillswit.teams

import ch.nokillswit.audit.audit
import ch.nokillswit.authz.NotFoundException
import ch.nokillswit.authz.caller
import ch.nokillswit.authz.requireAdmin
import ch.nokillswit.infra.db.requireValidReferences
import ch.nokillswit.users.UserServiceKey
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
@Resource("/api/v1/teams/{id}/memberships")
class TeamMembershipsRoute(val id: UInt) {
    @Serializable
    @Resource("{membershipId}")
    class Row(val parent: TeamMembershipsRoute, val membershipId: UInt)
}

@Serializable
@Resource("/api/v1/teams/{id}/managers")
class TeamManagersRoute(val id: UInt) {
    @Serializable
    @Resource("{periodId}")
    class Row(val parent: TeamManagersRoute, val periodId: UInt)
}

@Serializable
@Resource("/api/v1/users/{id}/team-history")
class UserTeamHistoryRoute(val id: UInt)

/** Adds `removedPeriodIds` (the rows an automatic equal-manager merge deleted) when there were any. */
private fun withRemoved(fields: MutableList<Pair<String, Any?>>, removed: List<UInt>) {
    if (removed.isNotEmpty()) fields += "removedPeriodIds" to removed.sorted().joinToString(",")
}

/**
 * The dated team structure's sub-resources (V93, v4.17.0): membership periods, the manager succession
 * line and a person's team history. Reads are open to any authenticated caller (a missing or deleted
 * team/user is 404); writes are ADMIN-only — guard first, then payload validation, then the 404/409s of
 * the service. Rights everywhere else stay "today only"; these rows are display and admin editing.
 */
fun Application.configureTeamHistoryRoutes() {
    val history = attributes[TeamHistoryServiceKey]
    val userService = attributes[UserServiceKey]

    routing {
        authenticate {
            get<TeamMembershipsRoute> { route ->
                call.caller()
                call.respond(HttpStatusCode.OK, history.listMemberships(route.id))
            }
            post<TeamMembershipsRoute> { route ->
                val caller = call.caller()
                requireAdmin(caller)
                val write = call.receive<TeamMembershipCreate>()
                validatePeriodDates(write.startDate, write.endDate)
                val created = requireValidReferences("Referenced user does not exist") {
                    history.createMembership(route.id, write.userId, write.startDate, write.endDate)
                }
                audit(
                    "team.membership_created",
                    "byUserId" to caller.userId.toLong(),
                    "teamId" to route.id.toLong(),
                    "membershipId" to created.id.toLong(),
                    "memberUserId" to created.userId.toLong(),
                    "startDate" to created.startDate,
                    "endDate" to created.endDate,
                )
                call.response.header(
                    HttpHeaders.Location,
                    call.application.href(TeamMembershipsRoute.Row(route, created.id)),
                )
                call.respond(HttpStatusCode.Created, created)
            }
            put<TeamMembershipsRoute.Row> { route ->
                val caller = call.caller()
                requireAdmin(caller)
                val write = call.receive<TeamMembershipWrite>()
                validatePeriodDates(write.startDate, write.endDate)
                val update = history.replaceMembership(route.parent.id, route.membershipId, write.startDate, write.endDate)
                val fields = mutableListOf<Pair<String, Any?>>(
                    "byUserId" to caller.userId.toLong(),
                    "teamId" to route.parent.id.toLong(),
                    "membershipId" to route.membershipId.toLong(),
                    "memberUserId" to update.before.userId.toLong(),
                )
                if (update.after.start != update.before.start) {
                    fields += "startDateFrom" to update.before.start
                    fields += "startDateTo" to update.after.start
                }
                if (update.after.end != update.before.end) {
                    fields += "endDateFrom" to update.before.end
                    fields += "endDateTo" to update.after.end
                }
                // Change-only: a PUT that changes nothing mints no event.
                if (update.after != update.before) audit("team.membership_updated", *fields.toTypedArray())
                call.respond(HttpStatusCode.NoContent)
            }
            delete<TeamMembershipsRoute.Row> { route ->
                val caller = call.caller()
                requireAdmin(caller)
                val removed = history.deleteMembership(route.parent.id, route.membershipId)
                audit(
                    "team.membership_deleted",
                    "byUserId" to caller.userId.toLong(),
                    "teamId" to route.parent.id.toLong(),
                    "membershipId" to route.membershipId.toLong(),
                    "memberUserId" to removed.userId.toLong(),
                    "startDate" to removed.start,
                    "endDate" to removed.end,
                )
                call.respond(HttpStatusCode.NoContent)
            }

            get<TeamManagersRoute> { route ->
                call.caller()
                call.respond(HttpStatusCode.OK, history.listPeriods(route.id))
            }
            post<TeamManagersRoute> { route ->
                val caller = call.caller()
                requireAdmin(caller)
                val write = call.receive<TeamManagerPeriodWrite>()
                validateManagerPeriodStart(write.startDate)
                val creation = requireValidReferences("Referenced user does not exist") {
                    history.createPeriod(route.id, write.managerId, write.startDate)
                }
                val created = creation.period
                val createdFields = mutableListOf<Pair<String, Any?>>(
                    "byUserId" to caller.userId.toLong(),
                    "teamId" to route.id.toLong(),
                    "periodId" to created.id.toLong(),
                    "managerId" to write.managerId.toLong(),
                    "startDate" to write.startDate,
                )
                withRemoved(createdFields, creation.removedPeriodIds)
                audit("team.manager_period_created", *createdFields.toTypedArray())
                call.response.header(
                    HttpHeaders.Location,
                    call.application.href(TeamManagersRoute.Row(route, created.id)),
                )
                call.respond(HttpStatusCode.Created, created)
            }
            put<TeamManagersRoute.Row> { route ->
                val caller = call.caller()
                requireAdmin(caller)
                val write = call.receive<TeamManagerPeriodWrite>()
                validateManagerPeriodStart(write.startDate)
                val update = requireValidReferences("Referenced user does not exist") {
                    history.replacePeriod(route.parent.id, route.periodId, write.managerId, write.startDate)
                }
                val fields = mutableListOf<Pair<String, Any?>>(
                    "byUserId" to caller.userId.toLong(),
                    "teamId" to route.parent.id.toLong(),
                    "periodId" to route.periodId.toLong(),
                )
                if (write.managerId != update.before.managerId) {
                    fields += "managerIdFrom" to update.before.managerId.toLong()
                    fields += "managerIdTo" to write.managerId.toLong()
                }
                if (write.startDate != update.before.start) {
                    fields += "startDateFrom" to update.before.start
                    fields += "startDateTo" to write.startDate
                }
                if (fields.size > 3) {
                    // The period folded into an equal-manager neighbour: name the row that survived.
                    if (update.after.id != route.periodId) fields += "mergedIntoPeriodId" to update.after.id.toLong()
                    withRemoved(fields, update.removedPeriodIds)
                    audit("team.manager_period_updated", *fields.toTypedArray())
                }
                call.respond(HttpStatusCode.NoContent)
            }
            delete<TeamManagersRoute.Row> { route ->
                val caller = call.caller()
                requireAdmin(caller)
                val removal = history.deletePeriod(route.parent.id, route.periodId)
                val deletedFields = mutableListOf<Pair<String, Any?>>(
                    "byUserId" to caller.userId.toLong(),
                    "teamId" to route.parent.id.toLong(),
                    "periodId" to route.periodId.toLong(),
                    "managerId" to removal.deleted.managerId.toLong(),
                    "startDate" to removal.deleted.start,
                    "endDate" to removal.deleted.end,
                    "absorbedByPeriodId" to removal.absorbedBy.toLong(),
                )
                withRemoved(deletedFields, removal.removedPeriodIds)
                audit("team.manager_period_deleted", *deletedFields.toTypedArray())
                call.respond(HttpStatusCode.NoContent)
            }

            // Open to any authenticated caller (the teams reads are open); only a missing/deleted user is a 404.
            get<UserTeamHistoryRoute> { route ->
                call.caller()
                if (userService.read(route.id) == null) throw NotFoundException("User not found")
                call.respond(HttpStatusCode.OK, history.userHistory(route.id))
            }
        }
    }
}
