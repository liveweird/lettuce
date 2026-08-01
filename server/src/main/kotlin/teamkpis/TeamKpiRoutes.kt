package ch.nokillswit.teamkpis

import ch.nokillswit.authz.ForbiddenException
import ch.nokillswit.authz.caller
import ch.nokillswit.authz.requireTeamKpiReadAllowingChain
import ch.nokillswit.authz.requireTeamKpiWrite
import ch.nokillswit.infra.db.requireValidReferences
import ch.nokillswit.infra.paging.SortField
import ch.nokillswit.infra.paging.optionalEnum
import ch.nokillswit.infra.paging.optionalLong
import ch.nokillswit.infra.paging.optionalString
import ch.nokillswit.infra.paging.optionalUInt
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
@Resource("/api/v1/team-kpis")
class TeamKpis {
    @Serializable
    @Resource("{id}")
    class Id(val parent: TeamKpis = TeamKpis(), val id: UInt) {
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
private fun TeamKpiEventDescriptor.toEvent(kpiId: UInt, userId: UInt) = TeamKpiEvent(
    kpiId = kpiId,
    userId = userId,
    type = type,
    params = params,
)

fun Application.configureTeamKpiRoutes() {
    val kpiService = attributes[TeamKpiServiceKey]
    val kpiEventService = attributes[TeamKpiEventServiceKey]
    val notificationService = attributes[NotificationServiceKey]

    // Shared handler for the lifecycle-transition action endpoints: current-manager-only, 404
    // when missing, 409 (via ConflictException in the service) when the KPI is not at the edge's
    // source status, otherwise it applies the change, delivers the members' notifications, and
    // records the audit event. Each endpoint names its whole edge (from AND target) — see
    // TeamKpiService.transition. The summary is only present (and required non-blank) when
    // closing.
    suspend fun transitionTo(
        call: ApplicationCall,
        kpiId: UInt,
        from: TeamKpiStatus,
        target: TeamKpiStatus,
        receiveSummary: (suspend () -> String?)? = null,
    ) {
        val caller = call.caller()
        val existing = kpiService.read(kpiId)
        if (existing == null) {
            call.respondProblem(HttpStatusCode.NotFound, "Team KPI not found")
            return
        }
        requireTeamKpiWrite(caller, existing)
        // The close body is received (and validated) only after the write guard, so a
        // non-manager's malformed or blank summary is still 403 on a foreign KPI, not 400.
        val summary = receiveSummary?.invoke()
        if (target == TeamKpiStatus.CLOSED) validateTeamKpiSummary(summary)
        val toNotify = kpiService.transition(kpiId, from, target, summary)
        if (toNotify == null) {
            call.respondProblem(HttpStatusCode.NotFound, "Team KPI not found")
            return
        }
        toNotify.forEach { notificationService.create(it) }
        kpiEventService.create(teamKpiTransitionEvent(from, target).toEvent(kpiId, caller.userId))
        call.respond(HttpStatusCode.NoContent)
    }

    routing {
        authenticate {
            get<TeamKpis> {
                val caller = call.caller()
                val params = call.request.queryParameters
                val view = when (val raw = params.optionalString("view") ?: "own") {
                    "own" -> TeamKpiListView.OWN
                    "managed" -> TeamKpiListView.MANAGED
                    else -> throw BadRequestException("Unknown view: $raw (allowed: own, managed)")
                }
                val paging = call.parsePaging(
                    sortable = setOf(
                        "id", "teamName", "managerName", "title", "type", "status",
                        "targetValue", "currentValue", "createdAt", "lastModified",
                    ),
                    defaultSort = listOf(SortField("createdAt", descending = true)),
                )
                val filter = TeamKpiListFilter(
                    teamName = params.optionalString("teamName"),
                    teamId = params.optionalUInt("teamId"),
                    title = params.optionalString("title"),
                    type = params.optionalEnum<TeamKpiType>("type"),
                    status = params.optionalEnum<TeamKpiStatus>("status"),
                    createdAtGte = params.optionalLong("createdAt[gte]"),
                    lastModifiedGte = params.optionalLong("lastModified[gte]"),
                )
                val result = kpiService.list(view, caller.userId, filter, paging)
                call.respond(HttpStatusCode.OK, paging.toPage(result.items, result.total))
            }
            post<TeamKpis> {
                val caller = call.caller()
                val request = call.receive<TeamKpiCreateRequest>()
                // The author is always the team's CURRENT manager (no create-on-behalf, not even
                // for ADMIN). Checked before payload validation so an outsider's malformed
                // request is still 403, not 400.
                if (!kpiService.managesTeam(caller.userId, request.teamId)) {
                    throw ForbiddenException("You may only set KPIs for teams you manage")
                }
                val id = requireValidReferences("Referenced team does not exist") {
                    kpiService.create(request)
                }
                call.response.header(HttpHeaders.Location, call.application.href(TeamKpis.Id(id = id)))
                // Audit: record the creation against the acting manager. No notification — the
                // KPI is a private draft until activated.
                kpiEventService.create(teamKpiCreationEvent(request.type).toEvent(id, caller.userId))
                // The create committed (Location set, CREATED event persisted), so a missing
                // re-read is a server-side anomaly, not a client 404.
                val created = kpiService.read(id)
                    ?: error("Team KPI $id vanished between create and re-read")
                call.respond(HttpStatusCode.Created, created)
            }
            get<TeamKpis.Id> { route ->
                val caller = call.caller()
                val kpi = kpiService.read(route.id)
                if (kpi == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Team KPI not found")
                    return@get
                }
                requireTeamKpiReadAllowingChain(
                    caller,
                    kpi,
                    isTeamMember = { kpiService.isTeamMember(caller.userId, kpi.teamId) },
                    managesTeamManager = { kpiService.managesManagerOf(caller.userId, kpi.managerId) },
                )
                call.respond(HttpStatusCode.OK, kpi)
            }
            put<TeamKpis.Id> { route ->
                val caller = call.caller()
                val existing = kpiService.read(route.id)
                if (existing == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Team KPI not found")
                    return@put
                }
                requireTeamKpiWrite(caller, existing)
                val edit = call.receive<TeamKpiDefinitionUpdate>()
                // DRAFT-only (else 409) and per-type validation both happen in the service,
                // atomically with the update.
                val updated = kpiService.updateDefinition(route.id, edit)
                if (updated == 0) {
                    call.respondProblem(HttpStatusCode.NotFound, "Team KPI not found")
                    return@put
                }
                // Audit: one event per changed aspect; a no-op PUT records nothing.
                teamKpiDefinitionUpdateEvents(existing, edit).forEach { descriptor ->
                    kpiEventService.create(descriptor.toEvent(route.id, caller.userId))
                }
                call.respond(HttpStatusCode.NoContent)
            }
            put<TeamKpis.Id.Progress> { route ->
                val caller = call.caller()
                val kpiId = route.parent.id
                val existing = kpiService.read(kpiId)
                if (existing == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Team KPI not found")
                    return@put
                }
                requireTeamKpiWrite(caller, existing)
                val edit = call.receive<TeamKpiProgressUpdate>()
                // ACTIVE-only (else 409) and the value check both happen in the service.
                val updated = kpiService.updateProgress(kpiId, edit)
                if (updated == 0) {
                    call.respondProblem(HttpStatusCode.NotFound, "Team KPI not found")
                    return@put
                }
                teamKpiProgressUpdateEvent(existing, edit)?.let { descriptor ->
                    kpiEventService.create(descriptor.toEvent(kpiId, caller.userId))
                }
                call.respond(HttpStatusCode.NoContent)
            }
            post<TeamKpis.Id.Activate> { route ->
                transitionTo(call, route.parent.id, from = TeamKpiStatus.DRAFT, target = TeamKpiStatus.ACTIVE)
            }
            post<TeamKpis.Id.Deactivate> { route ->
                transitionTo(call, route.parent.id, from = TeamKpiStatus.ACTIVE, target = TeamKpiStatus.DRAFT)
            }
            post<TeamKpis.Id.Close> { route ->
                transitionTo(call, route.parent.id, from = TeamKpiStatus.ACTIVE, target = TeamKpiStatus.CLOSED) {
                    call.receive<TeamKpiCloseRequest>().summary
                }
            }
            post<TeamKpis.Id.Reopen> { route ->
                transitionTo(call, route.parent.id, from = TeamKpiStatus.CLOSED, target = TeamKpiStatus.ACTIVE)
            }
            get<TeamKpis.Id.Events> { route ->
                val caller = call.caller()
                val kpiId = route.parent.id
                val kpi = kpiService.read(kpiId)
                if (kpi == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Team KPI not found")
                    return@get
                }
                // Whoever may read the KPI may read its history (the Graph tab feeds on it).
                requireTeamKpiReadAllowingChain(
                    caller,
                    kpi,
                    isTeamMember = { kpiService.isTeamMember(caller.userId, kpi.teamId) },
                    managesTeamManager = { kpiService.managesManagerOf(caller.userId, kpi.managerId) },
                )
                call.respond(HttpStatusCode.OK, TeamKpiEventListResponse(kpiEventService.listForKpi(kpiId)))
            }
            delete<TeamKpis.Id> { route ->
                val caller = call.caller()
                val existing = kpiService.read(route.id)
                if (existing == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Team KPI not found")
                    return@delete
                }
                requireTeamKpiWrite(caller, existing)
                // Delete is a draft-only action; ACTIVE/CLOSED KPIs are closed (or reopened)
                // through the transitions instead, keeping the record.
                if (existing.status != TeamKpiStatus.DRAFT) {
                    throw BadRequestException("Only a draft team KPI may be deleted")
                }
                if (kpiService.delete(route.id) == 0) {
                    call.respondProblem(HttpStatusCode.NotFound, "Team KPI not found")
                    return@delete
                }
                // Audit the deletion against the acting manager (events outlive the soft-deleted
                // row). No notification — deleting a private draft is invisible activity.
                kpiEventService.create(teamKpiDeletionEvent().toEvent(route.id, caller.userId))
                call.respond(HttpStatusCode.NoContent)
            }
        }
    }
}
