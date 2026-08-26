package ch.nokillswit.succession

import ch.nokillswit.authz.NotFoundException
import ch.nokillswit.authz.caller
import ch.nokillswit.authz.requireAuditListAccess
import ch.nokillswit.authz.requireFeatureEnabled
import ch.nokillswit.authz.requireRelationship
import ch.nokillswit.authz.requireSuccessionPlanRead
import ch.nokillswit.authz.requireSuccessionPlanWrite
import ch.nokillswit.infra.db.orVanished
import ch.nokillswit.infra.db.requireValidReferences
import ch.nokillswit.infra.paging.SortField
import ch.nokillswit.infra.paging.optionalIncludeIndirect
import ch.nokillswit.infra.paging.optionalString
import ch.nokillswit.infra.paging.optionalUInt
import ch.nokillswit.infra.paging.parsePaging
import ch.nokillswit.infra.paging.toPage
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
@Resource("/api/v1/succession-plans")
class SuccessionPlans {
    @Serializable
    @Resource("{id}")
    class Id(val parent: SuccessionPlans = SuccessionPlans(), val id: UInt) {
        @Serializable
        @Resource("close")
        class Close(val parent: Id)

        @Serializable
        @Resource("complete-review")
        class CompleteReview(val parent: Id)

        @Serializable
        @Resource("events")
        class Events(val parent: Id)

        @Serializable
        @Resource("nominations")
        class Nominations(val parent: Id) {
            @Serializable
            @Resource("{nominationId}")
            class NominationId(val parent: Nominations, val nominationId: UInt)
        }
    }
}

// The gated caller (V46): every succession handler resolves its principal through this, so the
// per-user SUCCESSION_PLANS flag is enforced before any other guard or read.
private fun ApplicationCall.successionCaller() =
    caller().also { requireFeatureEnabled(it, Feature.SUCCESSION_PLANS) }

// The descriptor -> persistable-event adapter (the ImpactLogRoutes shape).
private fun SuccessionEventDescriptor.toEvent(planId: UInt, userId: UInt) =
    SuccessionPlanEvent(planId = planId, userId = userId, type = type, params = params)

fun Application.configureSuccessionRoutes() {
    val successionService = attributes[SuccessionPlanServiceKey]
    val eventService = attributes[SuccessionEventServiceKey]
    val userService = attributes[UserServiceKey]

    // The uniform read preamble (the 404-before-403 idiom): resolves the plan (missing →
    // NotFoundException) and enforces the read rule (owner / audited HR / the OWNER's
    // transitive chain — the guard itself throws ForbiddenException). The seat's person and the
    // candidates never pass.
    suspend fun readGuardedPlan(call: ApplicationCall, planId: UInt): SuccessionPlanResponse {
        val caller = call.successionCaller()
        val plan = successionService.read(planId)
            ?: throw NotFoundException("Succession plan not found")
        requireSuccessionPlanRead(caller, plan) {
            successionService.managesUser(caller.userId, plan.managerId)
        }
        return plan
    }

    // The write sibling: owner-only (nobody else — the chain, ADMIN, and HR included). Guards
    // run BEFORE any body is received, so an outsider's malformed payload is still 403; the
    // OPEN/CLOSED state rule stays with the service (409), state checks never precede authz.
    suspend fun writeGuardedPlan(call: ApplicationCall, planId: UInt): SuccessionPlanResponse {
        // The gated caller resolves FIRST: a SUCCESSION_PLANS-disabled caller gets a uniform
        // 403 before the read (the feature 403 must precede the 404).
        val caller = call.successionCaller()
        val plan = successionService.read(planId)
            ?: throw NotFoundException("Succession plan not found")
        requireSuccessionPlanWrite(caller, plan)
        return plan
    }

    routing {
        authenticate {
            get<SuccessionPlans> {
                val caller = call.successionCaller()
                val params = call.request.queryParameters
                val view = when (val raw = params.optionalString("view") ?: "own") {
                    "own" -> SuccessionListView.OWN
                    "team" -> SuccessionListView.TEAM
                    "user" -> SuccessionListView.USER
                    else -> throw BadRequestException("Unknown view: $raw (allowed: own, team, user)")
                }
                val paging = call.parsePaging(
                    sortable = setOf("id", "userName", "managerName", "status", "createdAt", "lastReviewedAt"),
                    // The stalest reviews float up last — recent planning activity first.
                    defaultSort = listOf(SortField("lastReviewedAt", descending = true)),
                )
                val includeIndirect =
                    params.optionalIncludeIndirect(view, listOf(SuccessionListView.TEAM))
                // The auditor view (HR-only): view-shape validation first, then the role gate
                // (every use is audit-logged) — the goals-list idiom.
                val userId = params.optionalUInt("userId")
                if (view == SuccessionListView.USER && userId == null) {
                    throw BadRequestException("userId is required for view=user")
                }
                if (view != SuccessionListView.USER && userId != null) {
                    throw BadRequestException("userId is only supported for view=user")
                }
                if (view == SuccessionListView.USER) {
                    requireAuditListAccess(caller, "successionPlans", userId!!)
                }
                val status = params.optionalString("status")?.let { raw ->
                    SuccessionPlanStatus.entries.find { it.name == raw }
                        ?: throw BadRequestException("Unknown status: $raw")
                }
                val result = successionService.list(
                    view,
                    caller.userId,
                    SuccessionListFilter(
                        userName = params.optionalString("userName"),
                        managerName = params.optionalString("managerName"),
                        status = status,
                    ),
                    paging,
                    includeIndirect = includeIndirect,
                    targetUserId = userId,
                )
                call.respond(HttpStatusCode.OK, paging.toPage(result.items, result.total))
            }
            post<SuccessionPlans> {
                val caller = call.successionCaller()
                val request = call.receive<SuccessionPlanCreateRequest>()
                // The owner is always the caller (no create-on-behalf) and the seat's person
                // must be in the caller's TRANSITIVE chain right now (the chain rule). Checked
                // before payload validation so an outsider's malformed request is still 403.
                requireRelationship(
                    caller,
                    { successionService.managesUser(caller.userId, request.userId) },
                    "You may only plan succession for reports in your management chain",
                )
                // After the authz guard (403 wins over 400): no NEW plans for deactivated users.
                userService.requireNoDeactivatedUsers(listOf(request.userId))
                validateSuccessionPlanFields(request.lossImpact, request.targetBenchDepth)
                val id = successionService.create(caller.userId, request)
                eventService.create(successionPlanCreationEvent(request).toEvent(id, caller.userId))
                call.response.header(HttpHeaders.Location, call.application.href(SuccessionPlans.Id(id = id)))
                val created = successionService.read(id)
                    .orVanished("Succession plan", id)
                call.respond(HttpStatusCode.Created, created)
            }
            get<SuccessionPlans.Id> { route ->
                val plan = readGuardedPlan(call, route.id)
                call.respond(HttpStatusCode.OK, plan)
            }
            put<SuccessionPlans.Id> { route ->
                val existing = writeGuardedPlan(call, route.id)
                val edit = call.receive<SuccessionPlanUpdate>()
                validateSuccessionPlanFields(edit.lossImpact, edit.targetBenchDepth)
                successionService.update(route.id, edit)
                    ?: throw NotFoundException("Succession plan not found")
                // Per-field history fan-out (the goals idiom); a no-op PUT records nothing.
                successionPlanUpdateEvents(existing, edit).forEach { descriptor ->
                    eventService.create(descriptor.toEvent(route.id, call.caller().userId))
                }
                call.respond(HttpStatusCode.NoContent)
            }
            post<SuccessionPlans.Id.Close> { route ->
                writeGuardedPlan(call, route.parent.id)
                successionService.close(route.parent.id)
                    ?: throw NotFoundException("Succession plan not found")
                eventService.create(successionPlanClosedEvent().toEvent(route.parent.id, call.caller().userId))
                call.respond(HttpStatusCode.NoContent)
            }
            post<SuccessionPlans.Id.CompleteReview> { route ->
                writeGuardedPlan(call, route.parent.id)
                successionService.completeReview(route.parent.id)
                    ?: throw NotFoundException("Succession plan not found")
                eventService.create(
                    successionReviewCompletedEvent().toEvent(route.parent.id, call.caller().userId),
                )
                call.respond(HttpStatusCode.NoContent)
            }
            delete<SuccessionPlans.Id> { route ->
                writeGuardedPlan(call, route.id)
                if (successionService.delete(route.id) == 0) {
                    throw NotFoundException("Succession plan not found")
                }
                // Audited against the plan; unreachable via the API afterwards (soft-deleted).
                eventService.create(successionPlanDeletedEvent().toEvent(route.id, call.caller().userId))
                call.respond(HttpStatusCode.NoContent)
            }
            post<SuccessionPlans.Id.Nominations> { route ->
                val plan = writeGuardedPlan(call, route.parent.id)
                val request = call.receive<SuccessionNominationRequest>()
                validateNomination(request, plan.userId)
                // The deactivation rule (after authz, before the service): no NEW nominations
                // for deactivated candidates.
                userService.requireNoDeactivatedUsers(listOf(request.candidateId))
                val id = requireValidReferences("Referenced goal does not exist") {
                    successionService.createNomination(route.parent.id, plan.managerId, request)
                }
                call.response.header(
                    HttpHeaders.Location,
                    call.application.href(
                        SuccessionPlans.Id.Nominations.NominationId(
                            parent = SuccessionPlans.Id.Nominations(SuccessionPlans.Id(id = route.parent.id)),
                            nominationId = id,
                        ),
                    ),
                )
                val created = successionService.read(route.parent.id)
                    .orVanished("Succession plan", route.parent.id)
                    .nominations.find { it.id == id }
                    .orVanished("Succession nomination", id)
                val actorId = call.caller().userId
                eventService.create(nominationAddedEvent(created).toEvent(route.parent.id, actorId))
                // The V69 auto-demote's history: the standing PRIMARY in the PRE-mutation
                // document is the row the service demoted (route-derived — no service change).
                if (request.nominationType == NominationType.PRIMARY) {
                    plan.nominations.find { it.nominationType == NominationType.PRIMARY }?.let {
                        eventService.create(primaryDemotedEvent(it).toEvent(route.parent.id, actorId))
                    }
                }
                call.respond(HttpStatusCode.Created, created)
            }
            put<SuccessionPlans.Id.Nominations.NominationId> { route ->
                val planId = route.parent.parent.id
                val plan = writeGuardedPlan(call, planId)
                val edit = call.receive<SuccessionNominationRequest>()
                validateNomination(edit, plan.userId)
                // A CHANGED candidate is checked like a fresh assignment; keeping a
                // since-deactivated candidate stays editable (the team delta-validation rule).
                val existing = plan.nominations.find { it.id == route.nominationId }
                if (existing != null && existing.candidateId != edit.candidateId) {
                    userService.requireNoDeactivatedUsers(listOf(edit.candidateId))
                }
                successionService.updateNomination(planId, route.nominationId, plan.managerId, edit)
                    ?: throw NotFoundException("Succession nomination not found")
                // `existing` is non-null here (the service 404s the same missing row above).
                if (existing != null) {
                    val actorId = call.caller().userId
                    nominationUpdateEvents(existing, edit)?.let { descriptor ->
                        eventService.create(descriptor.toEvent(planId, actorId))
                    }
                    if (edit.nominationType == NominationType.PRIMARY) {
                        plan.nominations
                            .find { it.nominationType == NominationType.PRIMARY && it.id != route.nominationId }
                            ?.let { eventService.create(primaryDemotedEvent(it).toEvent(planId, actorId)) }
                    }
                }
                call.respond(HttpStatusCode.NoContent)
            }
            delete<SuccessionPlans.Id.Nominations.NominationId> { route ->
                val planId = route.parent.parent.id
                val plan = writeGuardedPlan(call, planId)
                successionService.deleteNomination(planId, route.nominationId)
                    ?: throw NotFoundException("Succession nomination not found")
                plan.nominations.find { it.id == route.nominationId }?.let {
                    eventService.create(nominationRemovedEvent(it).toEvent(planId, call.caller().userId))
                }
                call.respond(HttpStatusCode.NoContent)
            }
            get<SuccessionPlans.Id.Events> { route ->
                // Whoever may read the plan may read its history (the impact-log rule).
                readGuardedPlan(call, route.parent.id)
                call.respond(
                    HttpStatusCode.OK,
                    SuccessionPlanEventListResponse(eventService.listForPlan(route.parent.id)),
                )
            }
        }
    }
}
