package ch.nokillswit.teamkpis

import ch.nokillswit.infra.db.EventLog
import ch.nokillswit.infra.db.EventLogTable
import io.ktor.util.AttributeKey
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase

val TeamKpiEventServiceKey = AttributeKey<TeamKpiEventService>("TeamKpiEventService")

/**
 * The team KPI audit trail — a thin wrapper over the shared [EventLog] mechanics (the five
 * `*_events` tables are V15 clones; see infra/db/EventLog.kt). Only the typed DTO mapping
 * lives here.
 */
class TeamKpiEventService(val database: R2dbcDatabase) {
    object TeamKpiEvents : EventLogTable("team_kpi_events", "team_kpi_id", TeamKpiService.TeamKpis) {
        // Feature-named alias for direct DSL use (the same Column instance).
        val kpiId get() = ownerId
    }

    private val log = EventLog(database, TeamKpiEvents)

    /** Inserts an audit event. The timestamp is set here, never taken from a caller. */
    suspend fun create(event: TeamKpiEvent): UInt =
        log.create(event.kpiId, event.userId, event.type.name, event.params)

    /** The team KPI's history, newest first (id descending as the same-instant tiebreaker), with acting user names. */
    suspend fun listForKpi(kpiId: UInt): List<TeamKpiEventResponse> =
        log.listFor(kpiId).map {
            TeamKpiEventResponse(
                id = it.id,
                kpiId = it.ownerId,
                userId = it.userId,
                userName = it.userName,
                timestamp = it.timestamp,
                type = TeamKpiEventType.valueOf(it.type),
                params = it.params,
            )
        }
}
