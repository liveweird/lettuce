package ch.nokillswit.succession

import ch.nokillswit.infra.db.EventLog
import ch.nokillswit.infra.db.EventLogTable
import io.ktor.util.AttributeKey
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase

val SuccessionEventServiceKey = AttributeKey<SuccessionEventService>("SuccessionEventService")

/**
 * The succession plans' per-record audit trail (v2.46.0) — the seventh EventLogTable clone
 * (the ImpactLogEventService shape; V70). Plan-scoped: nomination changes are recorded as
 * plan-level events. No cipher — params are content-free by construction (enum names, numbers,
 * candidate display names; see SuccessionEvents.kt), unlike GoalEventService's V54 comment
 * column. Reads ride the plan's read guard; no notifications ever accompany these events.
 */
class SuccessionEventService(val database: R2dbcDatabase) {
    object SuccessionPlanEvents : EventLogTable("succession_plan_events", "plan_id", SuccessionPlanService.Plans) {
        val planId get() = ownerId
    }

    private val log = EventLog(database, SuccessionPlanEvents)

    suspend fun create(event: SuccessionPlanEvent): UInt =
        log.create(event.planId, event.userId, event.type.name, event.params)

    suspend fun listForPlan(planId: UInt): List<SuccessionPlanEventResponse> =
        log.listFor(planId).map {
            SuccessionPlanEventResponse(
                id = it.id,
                planId = it.ownerId,
                userId = it.userId,
                userName = it.userName,
                timestamp = it.timestamp,
                type = SuccessionEventType.valueOf(it.type),
                params = it.params,
            )
        }
}
