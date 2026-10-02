package ch.nokillswit.activity

import ch.nokillswit.authz.ActivityReadGrant
import ch.nokillswit.authz.NotFoundException
import ch.nokillswit.authz.caller
import ch.nokillswit.authz.requireActivityRead
import ch.nokillswit.infra.paging.SortField
import ch.nokillswit.infra.paging.optionalEnum
import ch.nokillswit.infra.paging.optionalLong
import ch.nokillswit.infra.paging.parsePaging
import ch.nokillswit.infra.paging.toPage
import ch.nokillswit.users.UserServiceKey
import io.ktor.http.HttpStatusCode
import io.ktor.resources.Resource
import io.ktor.server.application.*
import io.ktor.server.auth.authenticate
import io.ktor.server.plugins.BadRequestException
import io.ktor.server.resources.get
import io.ktor.server.response.respond
import io.ktor.server.routing.routing
import kotlinx.serialization.Serializable

@Serializable
@Resource("/api/v1/users/{id}/activity")
class UserActivity(val id: UInt)

private val ACTIVITY_SORTABLE = setOf("createdAt")

/**
 * The per-user activity log (v4.9.0, `.claude/docs/features/activity-log.md`) — a person-anchored
 * sub-resource (API-RES-006, the career-positions precedent), caller-relative only through the
 * guard: the person themselves, the HR auditor (audited `hr.list`), and a manager in the person's
 * transitive chain (who sees only the entries whose document they can read themselves). Order: the shape 400s (paging, `sort`, `area`, the
 * `createdAt` bounds) → unknown/soft-deleted target 404 (a deactivated one stays readable) →
 * the guard 403. The shape 400s deliberately run BEFORE the role gate (the registered L4
 * exception in `.claude/docs/authorization.md`), so the parameter vocabulary is no role oracle.
 */
fun Application.configureActivityRoutes() {
    val userService = attributes[UserServiceKey]
    val activityService = attributes[ActivityServiceKey]

    routing {
        authenticate {
            get<UserActivity> { route ->
                val caller = call.caller()
                val params = call.request.queryParameters
                val paging = call.parsePaging(ACTIVITY_SORTABLE, defaultSort = listOf(SortField("createdAt", descending = true)))
                val area = params.optionalEnum<ActivityArea>("area")
                val createdAtGte = params.optionalLong("createdAt[gte]")
                val createdAtLte = params.optionalLong("createdAt[lte]")
                if (createdAtGte != null && createdAtLte != null && createdAtGte > createdAtLte) {
                    throw BadRequestException("createdAt[gte] must not be after createdAt[lte]")
                }
                if (userService.read(route.id) == null) throw NotFoundException("User not found")
                val grant = requireActivityRead(caller, route.id, area?.name) {
                    activityService.managesUser(caller.userId, route.id)
                }
                val scope = when (grant) {
                    // Self is self for EVERY role: an HR user's OWN log is projected like anyone's (details/link
                    // null where they cannot read the document in their own right) — handing HR the full
                    // view of their own log would be an unaudited HR-privileged read (security audit, LOW-1).
                    ActivityReadGrant.SELF -> ActivityScope.OWN_RIGHT
                    ActivityReadGrant.HR -> ActivityScope.EVERYTHING
                    ActivityReadGrant.CHAIN -> ActivityScope.CHAIN
                }
                val result = activityService.list(
                    route.id,
                    ActivityViewer(caller.userId, caller.disabledFeatures, scope),
                    ActivityFilter(area, createdAtGte, createdAtLte),
                    paging,
                )
                call.respond(HttpStatusCode.OK, paging.toPage(result.items, result.total))
            }
        }
    }
}
