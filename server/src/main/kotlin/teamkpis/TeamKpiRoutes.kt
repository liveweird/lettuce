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
import ch.nokillswit.notifications.NotificationType
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

        // The KPI's data points: readable by whoever reads the KPI, mutable by the current
        // manager while the KPI is ACTIVE (the definition PUT is DRAFT-only).
        @Serializable
        @Resource("values")
        class Values(val parent: Id) {
            @Serializable
            @Resource("{valueId}")
            class ValueId(val parent: Values, val valueId: UInt)
        }

        // Lifecycle-transition actions (POST). The state machine gates which are valid from the
        // current status (invalid → 409); archive is the only bodied one (its required summary).
        @Serializable @Resource("activate") class Activate(val parent: Id)

        @Serializable @Resource("deactivate") class Deactivate(val parent: Id)

        @Serializable @Resource("archive") class Archive(val parent: Id)

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

    // Fan out a data-point mutation to the team's current members (minus the acting manager) —
    // [existing] is the pre-mutation read, which carries every display field the message needs.
    suspend fun notifyValueChange(
        existing: TeamKpiResponse,
        kpiId: UInt,
        type: NotificationType,
        valueParams: Map<String, String>,
    ) {
        teamKpiValueNotifications(
            kpiId = kpiId,
            type = type,
            memberIds = kpiService.memberIds(existing.teamId),
            actingManagerId = existing.managerId,
            managerName = existing.managerName,
            title = existing.title,
            teamName = existing.teamName,
            kpiType = existing.type,
            valueParams = valueParams,
        ).forEach { notificationService.create(it) }
    }

    // The uniform read preamble (the 404-before-403 idiom): resolves the KPI and enforces the
    // document read rule (manager / audited HR at any status; member / chain once out of
    // DRAFT). A null return means the 404 response was already sent; the guard itself throws
    // ForbiddenException. Shared by the document, values, and events GETs.
    suspend fun readGuardedKpi(call: ApplicationCall, kpiId: UInt): TeamKpiResponse? {
        val caller = call.caller()
        val kpi = kpiService.read(kpiId)
        if (kpi == null) {
            call.respondProblem(HttpStatusCode.NotFound, "Team KPI not found")
            return null
        }
        requireTeamKpiReadAllowingChain(
            caller,
            kpi,
            isTeamMember = { kpiService.isTeamMember(caller.userId, kpi.teamId) },
            managesTeamManager = { kpiService.managesManagerOf(caller.userId, kpi.managerId) },
        )
        return kpi
    }

    // The write sibling: current-manager-only (nobody else — ADMIN included). Same null = the
    // 404 was already sent contract; guards run BEFORE any body is received, so an outsider's
    // malformed payload is still 403.
    suspend fun writeGuardedKpi(call: ApplicationCall, kpiId: UInt): TeamKpiResponse? {
        val kpi = kpiService.read(kpiId)
        if (kpi == null) {
            call.respondProblem(HttpStatusCode.NotFound, "Team KPI not found")
            return null
        }
        requireTeamKpiWrite(call.caller(), kpi)
        return kpi
    }

    // Shared handler for the lifecycle-transition action endpoints: current-manager-only, 404
    // when missing, 409 (via ConflictException in the service) when the KPI is not at the edge's
    // source status, otherwise it applies the change, delivers the members' notifications, and
    // records the audit event. Each endpoint names its whole edge (from AND target) — see
    // TeamKpiService.transition. The summary is only present (and required non-blank) when
    // archiving.
    suspend fun transitionTo(
        call: ApplicationCall,
        kpiId: UInt,
        from: TeamKpiStatus,
        target: TeamKpiStatus,
        receiveSummary: (suspend () -> String?)? = null,
    ) {
        writeGuardedKpi(call, kpiId) ?: return
        // The archive body is received (and validated) only after the write guard, so a
        // non-manager's malformed or blank summary is still 403 on a foreign KPI, not 400.
        val summary = receiveSummary?.invoke()
        if (target == TeamKpiStatus.ARCHIVED) validateTeamKpiSummary(summary)
        val toNotify = kpiService.transition(kpiId, from, target, summary)
        if (toNotify == null) {
            call.respondProblem(HttpStatusCode.NotFound, "Team KPI not found")
            return
        }
        toNotify.forEach { notificationService.create(it) }
        kpiEventService.create(teamKpiTransitionEvent(from, target).toEvent(kpiId, call.caller().userId))
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
                val kpi = readGuardedKpi(call, route.id) ?: return@get
                call.respond(HttpStatusCode.OK, kpi)
            }
            put<TeamKpis.Id> { route ->
                val existing = writeGuardedKpi(call, route.id) ?: return@put
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
                    kpiEventService.create(descriptor.toEvent(route.id, call.caller().userId))
                }
                call.respond(HttpStatusCode.NoContent)
            }
            get<TeamKpis.Id.Values> { route ->
                // Whoever may read the KPI may read its data points (the KPI data tab and the
                // Graph tab both feed on them).
                val kpiId = route.parent.id
                readGuardedKpi(call, kpiId) ?: return@get
                call.respond(HttpStatusCode.OK, TeamKpiValueListResponse(kpiService.listValues(kpiId)))
            }
            post<TeamKpis.Id.Values> { route ->
                val kpiId = route.parent.id
                val existing = writeGuardedKpi(call, kpiId) ?: return@post
                val write = call.receive<TeamKpiValueWrite>()
                // ACTIVE-only (else 409) and the value/date checks both happen in the service;
                // a duplicate date raises 23505 → 409 via the central mapping.
                val newId = kpiService.addValue(kpiId, write)
                if (newId == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Team KPI not found")
                    return@post
                }
                kpiEventService.create(
                    teamKpiValueRecordedEvent(write.date!!, write.value!!)
                        .toEvent(kpiId, call.caller().userId),
                )
                notifyValueChange(
                    existing,
                    kpiId,
                    NotificationType.TEAM_KPI_VALUE_RECORDED_TO_MEMBER,
                    mapOf("date" to write.date, "value" to write.value.toString()),
                )
                call.response.header(
                    HttpHeaders.Location,
                    call.application.href(TeamKpis.Id.Values.ValueId(route, newId)),
                )
                call.respond(
                    HttpStatusCode.Created,
                    TeamKpiValueResponse(id = newId, date = write.date, value = write.value),
                )
            }
            put<TeamKpis.Id.Values.ValueId> { route ->
                val kpiId = route.parent.parent.id
                val existing = writeGuardedKpi(call, kpiId) ?: return@put
                val write = call.receive<TeamKpiValueWrite>()
                val correction = kpiService.correctValue(kpiId, route.valueId, write)
                if (correction == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Team KPI data point not found")
                    return@put
                }
                // An exact no-op corrected nothing — no event, no notification, still 204.
                if (correction.changed) {
                    kpiEventService.create(
                        teamKpiValueCorrectedEvent(correction.old, write.date!!, write.value!!)
                            .toEvent(kpiId, call.caller().userId),
                    )
                    notifyValueChange(
                        existing,
                        kpiId,
                        NotificationType.TEAM_KPI_VALUE_CORRECTED_TO_MEMBER,
                        mapOf(
                            "fromDate" to correction.old.date,
                            "fromValue" to correction.old.value.toString(),
                            "toDate" to write.date,
                            "toValue" to write.value.toString(),
                        ),
                    )
                }
                call.respond(HttpStatusCode.NoContent)
            }
            delete<TeamKpis.Id.Values.ValueId> { route ->
                val kpiId = route.parent.parent.id
                val existing = writeGuardedKpi(call, kpiId) ?: return@delete
                val removed = kpiService.removeValue(kpiId, route.valueId)
                if (removed == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "Team KPI data point not found")
                    return@delete
                }
                kpiEventService.create(teamKpiValueRemovedEvent(removed).toEvent(kpiId, call.caller().userId))
                notifyValueChange(
                    existing,
                    kpiId,
                    NotificationType.TEAM_KPI_VALUE_REMOVED_TO_MEMBER,
                    mapOf("date" to removed.date, "value" to removed.value.toString()),
                )
                call.respond(HttpStatusCode.NoContent)
            }
            post<TeamKpis.Id.Activate> { route ->
                transitionTo(call, route.parent.id, from = TeamKpiStatus.DRAFT, target = TeamKpiStatus.ACTIVE)
            }
            post<TeamKpis.Id.Deactivate> { route ->
                transitionTo(call, route.parent.id, from = TeamKpiStatus.ACTIVE, target = TeamKpiStatus.DRAFT)
            }
            post<TeamKpis.Id.Archive> { route ->
                transitionTo(call, route.parent.id, from = TeamKpiStatus.ACTIVE, target = TeamKpiStatus.ARCHIVED) {
                    call.receive<TeamKpiArchiveRequest>().summary
                }
            }
            post<TeamKpis.Id.Reopen> { route ->
                transitionTo(call, route.parent.id, from = TeamKpiStatus.ARCHIVED, target = TeamKpiStatus.ACTIVE)
            }
            get<TeamKpis.Id.Events> { route ->
                // Whoever may read the KPI may read its history (the Graph tab feeds on it).
                val kpiId = route.parent.id
                readGuardedKpi(call, kpiId) ?: return@get
                call.respond(HttpStatusCode.OK, TeamKpiEventListResponse(kpiEventService.listForKpi(kpiId)))
            }
            delete<TeamKpis.Id> { route ->
                val existing = writeGuardedKpi(call, route.id) ?: return@delete
                // Delete is a draft-only action; ACTIVE/ARCHIVED KPIs are archived (or reopened)
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
                kpiEventService.create(teamKpiDeletionEvent().toEvent(route.id, call.caller().userId))
                call.respond(HttpStatusCode.NoContent)
            }
        }
    }
}
