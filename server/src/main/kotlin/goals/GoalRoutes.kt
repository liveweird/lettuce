package ch.nokillswit.goals

import ch.nokillswit.authz.ForbiddenException
import ch.nokillswit.authz.caller
import ch.nokillswit.authz.requireGoalReadAllowingManager
import ch.nokillswit.authz.requireGoalWrite
import ch.nokillswit.infra.db.requireValidReferences
import ch.nokillswit.infra.paging.SortField
import ch.nokillswit.infra.paging.optionalBoolean
import ch.nokillswit.infra.paging.optionalEnum
import ch.nokillswit.infra.paging.optionalLong
import ch.nokillswit.infra.paging.optionalString
import ch.nokillswit.infra.paging.parsePaging
import ch.nokillswit.infra.paging.toPage
import ch.nokillswit.notifications.NotificationServiceKey
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
@Resource("/api/v1/goals")
class Goals {
    @Serializable
    @Resource("{id}")
    class Id(val parent: Goals = Goals(), val id: UInt) {
        @Serializable
        @Resource("events")
        class Events(val parent: Id)

        // The ACTIVE-only current-value edit (PUT) — the definition PUT is DRAFT-only.
        @Serializable
        @Resource("progress")
        class Progress(val parent: Id)

        // Lifecycle-transition actions (POST). The state machine gates which are valid from the
        // current status (invalid → 409); close is the only bodied one (its required summary).
        @Serializable @Resource("activate") class Activate(val parent: Id)

        @Serializable @Resource("deactivate") class Deactivate(val parent: Id)

        @Serializable @Resource("close") class Close(val parent: Id)

        @Serializable @Resource("reopen") class Reopen(val parent: Id)
    }
}

// Turn a structured event descriptor into the persistable audit event (the SPA localizes it).
private fun GoalEventDescriptor.toEvent(goalId: UInt, userId: UInt) = GoalEvent(
    goalId = goalId,
    userId = userId,
    type = type,
    params = params,
)

fun Application.configureGoalRoutes() {
    val goalService = attributes[GoalServiceKey]
    val goalEventService = attributes[GoalEventServiceKey]
    val notificationService = attributes[NotificationServiceKey]

    // Shared handler for the lifecycle-transition action endpoints: manager-only, 404 when
    // missing, 409 (via ConflictException in the service) when the goal is not at the edge's
    // source status, otherwise it applies the change, delivers the subordinate's notification,
    // and records the audit event. Each endpoint names its whole edge (from AND target) — see
    // GoalService.transition. The summary is only present (and required non-blank) when closing.
    suspend fun transitionTo(
        call: ApplicationCall,
        goalId: UInt,
        from: GoalStatus,
        target: GoalStatus,
        summary: String? = null,
    ) {
        val caller = call.caller()
        val existing = goalService.read(goalId)
        if (existing == null) {
            call.respondProblem(HttpStatusCode.NotFound, "Goal not found")
            return
        }
        requireGoalWrite(caller, existing)
        // Validated after the write guard so a non-manager's blank summary is still 403, not 400.
        if (target == GoalStatus.CLOSED) {
            if (summary.isNullOrBlank()) throw BadRequestException("Closing a goal requires a non-blank summary")
            if (summary.length > MAX_GOAL_TEXT_LENGTH) {
                throw BadRequestException("Goal summary must be at most $MAX_GOAL_TEXT_LENGTH characters")
            }
        }
        val toNotify = goalService.transition(goalId, from, target, summary)
        if (toNotify == null) {
            call.respondProblem(HttpStatusCode.NotFound, "Goal not found")
            return
        }
        toNotify.forEach { notificationService.create(it) }
        goalEventService.create(goalTransitionEvent(from, target).toEvent(goalId, caller.userId))
        call.respond(HttpStatusCode.NoContent)
    }

    routing {
        authenticate {
            get<Goals> {
                val caller = call.caller()
                val params = call.request.queryParameters
                val view = when (val raw = params.optionalString("view") ?: "own") {
                    "own" -> GoalListView.OWN
                    "managed" -> GoalListView.MANAGED
                    "team" -> GoalListView.TEAM
                    else -> throw BadRequestException("Unknown view: $raw (allowed: own, managed, team)")
                }
                val paging = call.parsePaging(
                    sortable = setOf(
                        "id", "managerName", "subordinateName", "title", "type", "status",
                        "createdAt", "lastModified",
                    ),
                    defaultSort = listOf(SortField("createdAt", descending = true)),
                )
                val includeIndirect = params.optionalBoolean("includeIndirect")
                if (includeIndirect != null && view != GoalListView.TEAM) {
                    throw BadRequestException("includeIndirect is only supported for view=team")
                }
                val filter = GoalListFilter(
                    managerName = params.optionalString("managerName"),
                    subordinateName = params.optionalString("subordinateName"),
                    title = params.optionalString("title"),
                    type = params.optionalEnum<GoalType>("type"),
                    status = params.optionalEnum<GoalStatus>("status"),
                    lastModifiedGte = params.optionalLong("lastModified[gte]"),
                )
                val result = goalService.list(
                    view,
                    caller.userId,
                    filter,
                    paging,
                    includeIndirect = includeIndirect == true,
                )
                call.respond(HttpStatusCode.OK, paging.toPage(result.items, result.total))
            }
            post<Goals> {
                val caller = call.caller()
                val request = call.receive<GoalCreateRequest>()
                // The manager is always the caller (no create-on-behalf, not even for ADMIN) and
                // the subordinate must be a direct report right now. Checked before payload
                // validation so an outsider's malformed request is still 403, not 400.
                if (!goalService.isDirectReport(caller.userId, request.subordinateId)) {
                    throw ForbiddenException("You may only set goals for your direct reports")
                }
                val id = requireValidReferences("Referenced user does not exist") {
                    goalService.create(caller.userId, request)
                }
                call.response.header(HttpHeaders.Location, call.application.href(Goals.Id(id = id)))
                // Audit: record the creation against the acting manager. No notification — the
                // goal is a private draft until activated.
                goalEventService.create(goalCreationEvent(request.type).toEvent(id, caller.userId))
                val created = goalService.read(id)
                if (created == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Goal not found")
                    return@post
                }
                call.respond(HttpStatusCode.Created, created)
            }
            get<Goals.Id> { route ->
                val caller = call.caller()
                val goal = goalService.read(route.id)
                if (goal == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Goal not found")
                    return@get
                }
                requireGoalReadAllowingManager(caller, goal) {
                    goalService.managesSubordinate(caller.userId, goal.subordinateId)
                }
                call.respond(HttpStatusCode.OK, goal)
            }
            put<Goals.Id> { route ->
                val caller = call.caller()
                val existing = goalService.read(route.id)
                if (existing == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Goal not found")
                    return@put
                }
                requireGoalWrite(caller, existing)
                val edit = call.receive<GoalDefinitionUpdate>()
                // DRAFT-only (else 409) and per-type validation both happen in the service,
                // atomically with the update.
                val updated = goalService.updateDefinition(route.id, edit)
                if (updated == 0) {
                    call.respondProblem(HttpStatusCode.NotFound, "Goal not found")
                    return@put
                }
                // Audit: one event per changed aspect; a no-op PUT records nothing.
                goalDefinitionUpdateEvents(existing, edit).forEach { descriptor ->
                    goalEventService.create(descriptor.toEvent(route.id, caller.userId))
                }
                call.respond(HttpStatusCode.NoContent)
            }
            put<Goals.Id.Progress> { route ->
                val caller = call.caller()
                val goalId = route.parent.id
                val existing = goalService.read(goalId)
                if (existing == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Goal not found")
                    return@put
                }
                requireGoalWrite(caller, existing)
                val edit = call.receive<GoalProgressUpdate>()
                // ACTIVE-only (else 409) and the per-type field check both happen in the service.
                val updated = goalService.updateProgress(goalId, edit)
                if (updated == 0) {
                    call.respondProblem(HttpStatusCode.NotFound, "Goal not found")
                    return@put
                }
                goalProgressUpdateEvent(existing, edit)?.let { descriptor ->
                    goalEventService.create(descriptor.toEvent(goalId, caller.userId))
                }
                call.respond(HttpStatusCode.NoContent)
            }
            post<Goals.Id.Activate> { route ->
                transitionTo(call, route.parent.id, from = GoalStatus.DRAFT, target = GoalStatus.ACTIVE)
            }
            post<Goals.Id.Deactivate> { route ->
                transitionTo(call, route.parent.id, from = GoalStatus.ACTIVE, target = GoalStatus.DRAFT)
            }
            post<Goals.Id.Close> { route ->
                val body = call.receive<GoalCloseRequest>()
                transitionTo(
                    call, route.parent.id,
                    from = GoalStatus.ACTIVE, target = GoalStatus.CLOSED, summary = body.summary,
                )
            }
            post<Goals.Id.Reopen> { route ->
                transitionTo(call, route.parent.id, from = GoalStatus.CLOSED, target = GoalStatus.ACTIVE)
            }
            get<Goals.Id.Events> { route ->
                val caller = call.caller()
                val goalId = route.parent.id
                val goal = goalService.read(goalId)
                if (goal == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Goal not found")
                    return@get
                }
                // Whoever may read the goal may read its history.
                requireGoalReadAllowingManager(caller, goal) {
                    goalService.managesSubordinate(caller.userId, goal.subordinateId)
                }
                call.respond(HttpStatusCode.OK, GoalEventListResponse(goalEventService.listForGoal(goalId)))
            }
            delete<Goals.Id> { route ->
                val caller = call.caller()
                val existing = goalService.read(route.id)
                if (existing == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Goal not found")
                    return@delete
                }
                requireGoalWrite(caller, existing)
                // Delete is a draft-only action; ACTIVE/CLOSED goals are closed (or reopened)
                // through the transitions instead, keeping the record.
                if (existing.status != GoalStatus.DRAFT) {
                    throw BadRequestException("Only a draft goal may be deleted")
                }
                if (goalService.delete(route.id) == 0) {
                    call.respondProblem(HttpStatusCode.NotFound, "Goal not found")
                    return@delete
                }
                // Audit the deletion against the acting manager (events outlive the soft-deleted
                // row). No notification — deleting a private draft is invisible activity.
                goalEventService.create(goalDeletionEvent().toEvent(route.id, caller.userId))
                call.respond(HttpStatusCode.NoContent)
            }
        }
    }
}
