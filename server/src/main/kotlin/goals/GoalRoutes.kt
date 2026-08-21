package ch.nokillswit.goals

import ch.nokillswit.authz.NotFoundException
import ch.nokillswit.authz.caller
import ch.nokillswit.authz.requireAuditListAccess
import ch.nokillswit.authz.requireDirectReport
import ch.nokillswit.authz.requireFeatureEnabled
import ch.nokillswit.authz.requireGoalProgressWrite
import ch.nokillswit.authz.requireGoalReadAllowingManager
import ch.nokillswit.authz.requireGoalWrite
import ch.nokillswit.infra.db.orVanished
import ch.nokillswit.infra.db.requireValidReferences
import ch.nokillswit.infra.paging.SortField
import ch.nokillswit.infra.paging.optionalBoolean
import ch.nokillswit.infra.paging.optionalEnum
import ch.nokillswit.infra.paging.optionalIncludeIndirect
import ch.nokillswit.infra.paging.optionalLong
import ch.nokillswit.infra.paging.optionalString
import ch.nokillswit.infra.paging.optionalUInt
import ch.nokillswit.infra.paging.parsePaging
import ch.nokillswit.infra.paging.toPage
import ch.nokillswit.infra.paging.uintOnlyForView
import ch.nokillswit.notifications.NotificationServiceKey
import ch.nokillswit.users.Feature
import ch.nokillswit.users.UserServiceKey
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
        // current status (invalid → 409); archive is the only bodied one (its required summary).
        @Serializable @Resource("activate") class Activate(val parent: Id)

        @Serializable @Resource("deactivate") class Deactivate(val parent: Id)

        @Serializable @Resource("archive") class Archive(val parent: Id)

        @Serializable @Resource("reopen") class Reopen(val parent: Id)
    }
}

// Turn a structured event descriptor into the persistable audit event (the SPA localizes it).
// The optional comment (progress updates only) rides the event's own encrypted column, never
// its plaintext params.
private fun GoalEventDescriptor.toEvent(goalId: UInt, userId: UInt, comment: String? = null) = GoalEvent(
    goalId = goalId,
    userId = userId,
    type = type,
    params = params,
    comment = comment,
)

// The gated caller (V46): every goal handler resolves its principal through this, so the
// per-user GOALS flag is enforced before any other guard or read.
private fun ApplicationCall.goalCaller() =
    caller().also { requireFeatureEnabled(it, Feature.GOALS) }

fun Application.configureGoalRoutes() {
    val goalService = attributes[GoalServiceKey]
    val goalEventService = attributes[GoalEventServiceKey]
    val notificationService = attributes[NotificationServiceKey]
    val userService = attributes[UserServiceKey]

    // The uniform read preamble (the 404-before-403 idiom): resolves the goal (missing →
    // NotFoundException) and enforces the document read rule (parties / audited HR at any
    // status; chain managers once out of DRAFT — the guard itself throws ForbiddenException).
    // Shared by the document and events GETs.
    suspend fun readGuardedGoal(call: ApplicationCall, goalId: UInt): GoalResponse {
        val caller = call.goalCaller()
        val goal = goalService.read(goalId)
            ?: throw NotFoundException("Goal not found")
        requireGoalReadAllowingManager(caller, goal) {
            goalService.managesSubordinate(caller.userId, goal.subordinateId)
        }
        return goal
    }

    // The write sibling: manager-only (nobody else — ADMIN included). Guards run BEFORE any
    // body is received, so an outsider's malformed payload is still 403.
    suspend fun writeGuardedGoal(call: ApplicationCall, goalId: UInt): GoalResponse {
        // The gated caller resolves FIRST: a GOALS-disabled caller gets a uniform 403
        // before the read (the feature 403 must precede the 404).
        val caller = call.goalCaller()
        val goal = goalService.read(goalId)
            ?: throw NotFoundException("Goal not found")
        requireGoalWrite(caller, goal)
        return goal
    }

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
        receiveSummary: (suspend () -> String?)? = null,
    ) {
        val existing = writeGuardedGoal(call, goalId)
        // Payload/state pre-checks apply only while the row actually sits at the edge's source
        // status — off-edge calls must reach the service so its status check answers the
        // documented 409 (an ARCHIVED goal's stale due date must not turn activate into a 400).
        val atSource = existing.status == from
        // Activation only (not reopen — ARCHIVED->ACTIVE must stay open for overdue goals, whose
        // due date is DRAFT-only editable): a stale draft must pick a fresh due date first, and
        // a PLAN draft needs something to track (milestones are DRAFT-only editable too, but
        // reopen can't hit zero — an archived PLAN was ACTIVE, so it passed this gate).
        if (atSource && from == GoalStatus.DRAFT && target == GoalStatus.ACTIVE) {
            validateGoalDueDate(existing.dueDate)
            if (existing.type == GoalType.PLAN && existing.milestones.isEmpty()) {
                throw BadRequestException("A PLAN goal needs at least one milestone to activate")
            }
        }
        // The archive body is received (and validated) only after the write guard, so a
        // non-manager's malformed or blank summary is still 403 on a foreign goal, not 400.
        val summary = receiveSummary?.invoke()
        if (atSource && target == GoalStatus.ARCHIVED) validateGoalSummary(summary)
        val toNotify = goalService.transition(goalId, from, target, summary)
            ?: throw NotFoundException("Goal not found")
        toNotify.forEach { notificationService.create(it) }
        goalEventService.create(goalTransitionEvent(from, target).toEvent(goalId, call.caller().userId))
        call.respond(HttpStatusCode.NoContent)
    }

    routing {
        authenticate {
            get<Goals> {
                val caller = call.goalCaller()
                val params = call.request.queryParameters
                val view = when (val raw = params.optionalString("view") ?: "own") {
                    "own" -> GoalListView.OWN
                    "managed" -> GoalListView.MANAGED
                    "team" -> GoalListView.TEAM
                    "user" -> GoalListView.USER
                    else -> throw BadRequestException("Unknown view: $raw (allowed: own, managed, team, user)")
                }
                val paging = call.parsePaging(
                    sortable = setOf(
                        "id", "managerName", "subordinateName", "title", "type", "status",
                        "targetValue", "currentValue", "createdAt", "dueDate", "lastModified",
                    ),
                    defaultSort = listOf(SortField("createdAt", descending = true)),
                )
                val includeIndirect =
                    params.optionalIncludeIndirect(view, listOf(GoalListView.MANAGED, GoalListView.TEAM))
                // The auditor view (HR-only): view-shape validation like counterpartId on the
                // 1:1 list, then the role gate (every use is audit-logged).
                val userId = params.uintOnlyForView("userId", view, GoalListView.USER)
                if (view == GoalListView.USER) {
                    requireAuditListAccess(caller, "goal", userId!!)
                }
                val filter = GoalListFilter(
                    managerName = params.optionalString("managerName"),
                    subordinateName = params.optionalString("subordinateName"),
                    managerId = params.optionalUInt("managerId"),
                    subordinateId = params.optionalUInt("subordinateId"),
                    title = params.optionalString("title"),
                    type = params.optionalEnum<GoalType>("type"),
                    status = params.optionalEnum<GoalStatus>("status"),
                    createdAtGte = params.optionalLong("createdAt[gte]"),
                    lastModifiedGte = params.optionalLong("lastModified[gte]"),
                )
                val result = goalService.list(
                    view,
                    caller.userId,
                    filter,
                    paging,
                    includeIndirect = includeIndirect,
                    targetUserId = userId,
                )
                call.respond(HttpStatusCode.OK, paging.toPage(result.items, result.total))
            }
            post<Goals> {
                val caller = call.goalCaller()
                val request = call.receive<GoalCreateRequest>()
                // The manager is always the caller (no create-on-behalf, not even for ADMIN) and
                // the subordinate must be a direct report right now. Checked before payload
                // validation so an outsider's malformed request is still 403, not 400.
                requireDirectReport(
                    caller,
                    { goalService.isDirectReport(caller.userId, request.subordinateId) },
                    "You may only set goals for your direct reports",
                )
                // After the authz guard (403 wins over 400): no NEW goals for deactivated users.
                userService.requireNoDeactivatedUsers(listOf(request.subordinateId))
                val id = requireValidReferences("Referenced user does not exist") {
                    goalService.create(caller.userId, request)
                }
                call.response.header(HttpHeaders.Location, call.application.href(Goals.Id(id = id)))
                // Audit: record the creation against the acting manager. No notification — the
                // goal is a private draft until activated.
                goalEventService.create(goalCreationEvent(request.type).toEvent(id, caller.userId))
                val created = goalService.read(id)
                    .orVanished("Goal", id)
                call.respond(HttpStatusCode.Created, created)
            }
            get<Goals.Id> { route ->
                val goal = readGuardedGoal(call, route.id)
                call.respond(HttpStatusCode.OK, goal)
            }
            put<Goals.Id> { route ->
                val existing = writeGuardedGoal(call, route.id)
                val edit = call.receive<GoalDefinitionUpdate>()
                // DRAFT-only (else 409) and per-type validation both happen in the service,
                // atomically with the update.
                val updated = goalService.updateDefinition(route.id, edit)
                if (updated == 0) {
                    throw NotFoundException("Goal not found")
                }
                // Audit: one event per changed aspect; a no-op PUT records nothing.
                goalDefinitionUpdateEvents(existing, edit).forEach { descriptor ->
                    goalEventService.create(descriptor.toEvent(route.id, call.caller().userId))
                }
                call.respond(HttpStatusCode.NoContent)
            }
            put<Goals.Id.Progress> { route ->
                val goalId = route.parent.id
                // Progress is the pair's shared write (v2.8.0): manager OR subordinate — the
                // definition/lifecycle routes keep the manager-only writeGuardedGoal.
                val caller = call.goalCaller()
                val existing = goalService.read(goalId)
                    ?: throw NotFoundException("Goal not found")
                requireGoalProgressWrite(caller, existing)
                val edit = call.receive<GoalProgressUpdate>()
                // ACTIVE-only (else 409) and the per-type field check both happen in the service.
                val toNotify = goalService.updateProgress(goalId, caller.userId, edit)
                    ?: throw NotFoundException("Goal not found")
                toNotify.forEach { notificationService.create(it) }
                // State change → MILESTONE_COMPLETED/REOPENED per toggle (PLAN) or one
                // PROGRESS_UPDATED (numeric); comment-only → PROGRESS_COMMENTED; true no-op →
                // nothing. The comment (blank = absent) rides the encrypted column of the LAST
                // event, so it tops the newest-first timeline.
                val descriptors = goalProgressUpdateEvents(existing, edit)
                val comment = edit.comment?.takeIf { it.isNotBlank() }
                descriptors.forEachIndexed { index, descriptor ->
                    goalEventService.create(
                        descriptor.toEvent(
                            goalId,
                            caller.userId,
                            comment = comment.takeIf { index == descriptors.lastIndex },
                        ),
                    )
                }
                call.respond(HttpStatusCode.NoContent)
            }
            post<Goals.Id.Activate> { route ->
                transitionTo(call, route.parent.id, from = GoalStatus.DRAFT, target = GoalStatus.ACTIVE)
            }
            post<Goals.Id.Deactivate> { route ->
                transitionTo(call, route.parent.id, from = GoalStatus.ACTIVE, target = GoalStatus.DRAFT)
            }
            post<Goals.Id.Archive> { route ->
                transitionTo(call, route.parent.id, from = GoalStatus.ACTIVE, target = GoalStatus.ARCHIVED) {
                    call.receive<GoalArchiveRequest>().summary
                }
            }
            post<Goals.Id.Reopen> { route ->
                transitionTo(call, route.parent.id, from = GoalStatus.ARCHIVED, target = GoalStatus.ACTIVE)
            }
            get<Goals.Id.Events> { route ->
                val goalId = route.parent.id
                // Whoever may read the goal may read its history.
                readGuardedGoal(call, goalId)
                call.respond(HttpStatusCode.OK, GoalEventListResponse(goalEventService.listForGoal(goalId)))
            }
            delete<Goals.Id> { route ->
                val existing = writeGuardedGoal(call, route.id)
                // Delete is a draft-only action; ACTIVE/ARCHIVED goals are closed (or reopened)
                // through the transitions instead, keeping the record.
                if (existing.status != GoalStatus.DRAFT) {
                    throw BadRequestException("Only a draft goal may be deleted")
                }
                if (goalService.delete(route.id) == 0) {
                    throw NotFoundException("Goal not found")
                }
                // Audit the deletion against the acting manager (events outlive the soft-deleted
                // row). No notification — deleting a private draft is invisible activity.
                goalEventService.create(goalDeletionEvent().toEvent(route.id, call.caller().userId))
                call.respond(HttpStatusCode.NoContent)
            }
        }
    }
}
