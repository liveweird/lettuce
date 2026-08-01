package ch.nokillswit.teamkpis

import ch.nokillswit.infra.db.decodeParams
import ch.nokillswit.infra.db.encodeParams
import ch.nokillswit.users.UserService
import io.ktor.util.AttributeKey
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.core.dao.id.UIntIdTable
import org.jetbrains.exposed.v1.r2dbc.*
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction

val TeamKpiEventServiceKey = AttributeKey<TeamKpiEventService>("TeamKpiEventService")

class TeamKpiEventService(val database: R2dbcDatabase) {
    object TeamKpiEvents : UIntIdTable("team_kpi_events") {
        val kpiId = reference("team_kpi_id", TeamKpiService.TeamKpis)
        val userId = reference("user_id", UserService.Users)
        val timestamp = long("created_at")
        // Structured event so the SPA can localize it: the kind plus a JSON params map.
        val eventType = varchar("event_type", 40)
        val params = text("params")
    }

    /** Inserts an audit event. The timestamp is set here, never taken from a caller. */
    suspend fun create(event: TeamKpiEvent): UInt = suspendTransaction(database) {
        TeamKpiEvents.insert {
            it[kpiId] = event.kpiId
            it[userId] = event.userId
            it[timestamp] = System.currentTimeMillis()
            it[eventType] = event.type.name
            it[params] = encodeParams(event.params)
        }[TeamKpiEvents.id].value
    }

    /** The KPI's history, oldest first (id as a stable tiebreaker), with acting user names. */
    suspend fun listForKpi(kpiId: UInt): List<TeamKpiEventResponse> = suspendTransaction(database) {
        (TeamKpiEvents innerJoin UserService.Users)
            .selectAll()
            .where { TeamKpiEvents.kpiId eq kpiId }
            .orderBy(TeamKpiEvents.timestamp to SortOrder.ASC, TeamKpiEvents.id to SortOrder.ASC)
            .map { it.toResponse() }
            .toList()
    }

    private fun ResultRow.toResponse() = TeamKpiEventResponse(
        id = this[TeamKpiEvents.id].value,
        kpiId = this[TeamKpiEvents.kpiId].value,
        userId = this[TeamKpiEvents.userId].value,
        userName = this[UserService.Users.name],
        timestamp = this[TeamKpiEvents.timestamp],
        type = TeamKpiEventType.valueOf(this[TeamKpiEvents.eventType]),
        params = decodeParams(this[TeamKpiEvents.params]),
    )
}
