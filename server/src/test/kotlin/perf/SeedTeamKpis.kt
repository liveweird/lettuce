package ch.nokillswit.perf

import ch.nokillswit.goals.TargetDirection
import ch.nokillswit.notifications.NotificationType
import ch.nokillswit.teamkpis.TeamKpiEventService
import ch.nokillswit.teamkpis.TeamKpiService
import ch.nokillswit.teamkpis.TeamKpiStatus
import ch.nokillswit.teamkpis.TeamKpiType
import ch.nokillswit.teamkpis.TeamKpiValueResponse
import ch.nokillswit.teamkpis.teamKpiCreationEvent
import ch.nokillswit.teamkpis.teamKpiTransitionEvent
import ch.nokillswit.teamkpis.teamKpiTransitionNotifications
import ch.nokillswit.teamkpis.teamKpiValueCorrectedEvent
import ch.nokillswit.teamkpis.teamKpiValueNotifications
import ch.nokillswit.teamkpis.teamKpiValueRecordedEvent
import java.time.LocalDate
import kotlin.math.roundToLong

private const val KPIS_PER_TEAM = 4
private val VALUE_DAYS = listOf(4, 11, 18, 25)
private const val CORRECTION_RATE = 0.01

private class KpiRow(
    val id: UInt,
    val teamId: UInt,
    val createdBy: UInt,
    val createdAt: Long,
    val title: String,
    val description: String,
    val type: TeamKpiType,
    val target: Double,
    val direction: TargetDirection,
    var current: Double,
    var currentDate: String?,
    val summary: String?,
    var lastModified: Long,
)

private class KpiValueRow(val id: UInt, val kpiId: UInt, val date: String, val value: Double)

private fun round1(value: Double) = (value * 10).roundToLong() / 10.0

/** Writes one KPI's whole life: the row, its data points, events and notifications. */
private class KpiWriter(private val ctx: SeedContext, private val mint: NotificationMint) {
    val rng = ctx.rng("team-kpis")
    private val db = ctx.db
    private val k = TeamKpiService.TeamKpis
    val kpis = RowSink<KpiRow>(db, k) { r ->
        this[k.id] = r.id
        this[k.teamId] = r.teamId
        this[k.createdBy] = r.createdBy
        this[k.createdAt] = r.createdAt
        this[k.title] = r.title
        this[k.description] = r.description
        this[k.type] = r.type
        this[k.targetValue] = r.target
        this[k.targetDirection] = r.direction
        this[k.currentValue] = r.current
        this[k.currentValueDate] = r.currentDate
        this[k.status] = TeamKpiStatus.ACTIVE
        this[k.summary] = r.summary
        this[k.lastModified] = r.lastModified
    }
    val values = RowSink<KpiValueRow>(db, TeamKpiService.TeamKpiValues) { v ->
        val t = TeamKpiService.TeamKpiValues
        this[t.id] = v.id
        this[t.kpiId] = v.kpiId
        this[t.valueDate] = v.date
        this[t.value] = v.value
    }
    val events = EventStream(db, TeamKpiEventService.TeamKpiEvents)
    val group = SinkGroup(kpis, values, events.sink)
    val kpiIds = IdCounter(0u)
    val valueIds = IdCounter(0u)

    suspend fun init() {
        kpiIds.reset(nextFreeId(db, k))
        valueIds.reset(nextFreeId(db, TeamKpiService.TeamKpiValues))
        events.init(db)
    }

    suspend fun flush() {
        group.flush()
        mint.sinkGroup.flush()
    }

    /**
     * One KPI: created and activated near the start of the window, then four data points a month
     * (strict-ISO days 4/11/18/25) with a noisy ramp toward the target. A KPI flagged [archivedOnce] is
     * archived (with its encrypted summary) and reopened ~10 days later at mid-history — the summary is
     * kept on reopen, and no data point lands in between (recording needs ACTIVE).
     */
    fun write(org: Org, team: Team, number: Int, firstMonth: LocalDate, archivedOnce: Boolean) {
        val manager = team.managerId
        val managerName = org.names.getValue(manager)
        val id = kpiIds.take()
        val title = "${Text.title(rng, 3)} ${number + 1}"
        val type = if (rng.chance(0.5)) TeamKpiType.NUMBER else TeamKpiType.PERCENTAGE
        val target = if (type == TeamKpiType.PERCENTAGE) rng.int(60, 99).toDouble() else rng.int(20, 400).toDouble()
        val direction = if (rng.chance(0.85)) TargetDirection.AT_LEAST else TargetDirection.AT_MOST
        val created = firstMonth.plusDays(rng.int(0, 15).toLong())
        val createdAt = ctx.millis(created, 9)
        fun audience(from: TeamKpiStatus, to: TeamKpiStatus, day: LocalDate, minute: Int) {
            val at = ctx.millis(day, 9, minute)
            val d = teamKpiTransitionEvent(from, to)
            events.add(id, manager, at, d.type.name, d.params)
            mint.emitAll(
                teamKpiTransitionNotifications(id, from, to, team.memberIds.toSet(), manager, manager, managerName, title, team.name),
                at,
            )
        }
        val creation = teamKpiCreationEvent(type)
        events.add(id, manager, createdAt, creation.type.name, creation.params)
        val activated = created.plusDays(rng.int(1, 3).toLong())
        audience(TeamKpiStatus.DRAFT, TeamKpiStatus.ACTIVE, activated, 0)
        val archiveDate = firstMonth.plusMonths(ctx.spec.months / 2L).plusDays(15)
        val reopenDate = archiveDate.plusDays(10)
        var last = KpiValueRow(0u, id, "", 0.0)
        var month = firstMonth
        val total = ctx.spec.months
        for (m in 0 until total) {
            for (day in VALUE_DAYS) {
                val date = month.withDayOfMonth(day)
                val skipped = archivedOnce && date >= archiveDate && date <= reopenDate
                if (date <= activated || date >= ctx.config.anchor || skipped) continue
                val progress = 0.45 + 0.55 * (m.toDouble() / total) + (rng.double() - 0.5) * 0.2
                val raw = target * progress
                val value = round1(if (type == TeamKpiType.PERCENTAGE) raw.coerceIn(0.0, 100.0) else raw.coerceAtLeast(0.0))
                val point = KpiValueRow(valueIds.take(), id, date.toString(), value)
                last = KpiValueRow(point.id, id, point.date, record(org, team, id, title, type, point, date))
                values.add(last)
            }
            month = month.plusMonths(1)
        }
        if (archivedOnce) {
            audience(TeamKpiStatus.ACTIVE, TeamKpiStatus.ARCHIVED, archiveDate, 0)
            audience(TeamKpiStatus.ARCHIVED, TeamKpiStatus.ACTIVE, reopenDate, 1)
        }
        val modified = if (last.date.isEmpty()) createdAt else ctx.millis(LocalDate.parse(last.date), 16)
        val description = ctx.cipher.encrypt(Text.paragraph(rng, 80, 300))
        val summary = if (archivedOnce) ctx.cipher.encrypt(Text.paragraph(rng, 60, 200)) else null
        kpis.add(
            KpiRow(
                id, team.id, manager, createdAt, title, description, type, target, direction,
                last.value, last.date.ifEmpty { null }, summary, modified,
            ),
        )
    }

    /**
     * VALUE_RECORDED + its member fan-out; ~1 % are followed by a correction (VALUE_CORRECTED + fan-out).
     * Returns the value the row ends up holding (the corrected one when a correction happened).
     */
    private fun record(
        org: Org, team: Team, kpiId: UInt, title: String, type: TeamKpiType, point: KpiValueRow, date: LocalDate,
    ): Double {
        val actorId = if (rng.chance(0.7)) team.managerId else rng.pick(team.memberIds)
        val actorName = org.names.getValue(actorId)
        val at = ctx.millis(date, 10 + rng.int(0, 6), rng.int(0, 59))
        val recorded = teamKpiValueRecordedEvent(point.date, point.value)
        events.add(kpiId, actorId, at, recorded.type.name, recorded.params)
        fun fanout(kind: NotificationType, params: Map<String, String>, moment: Long) = mint.emitAll(
            teamKpiValueNotifications(
                kpiId, kind, team.memberIds.toSet(), team.managerId, actorId, actorName, title, team.name, type, params,
            ),
            moment,
        )
        fanout(NotificationType.TEAM_KPI_VALUE_RECORDED_TO_MEMBER, mapOf("date" to point.date, "value" to point.value.toString()), at)
        if (rng.chance(CORRECTION_RATE)) {
            val scaled = round1(point.value * (0.9 + rng.double() * 0.2))
            val corrected = if (type == TeamKpiType.PERCENTAGE) scaled.coerceAtMost(100.0) else scaled
            val moment = at + 3_600_000L
            val event = teamKpiValueCorrectedEvent(TeamKpiValueResponse(point.id, point.date, point.value), point.date, corrected)
            events.add(kpiId, actorId, moment, event.type.name, event.params)
            fanout(NotificationType.TEAM_KPI_VALUE_CORRECTED_TO_MEMBER, event.params, moment)
            return corrected
        }
        return point.value
    }
}

/**
 * Team KPIs (`.claude/docs/features/team-kpis.md`): four per team, every one created and activated by the
 * team's manager near the start of the history (so ≈ 4 × 81 × 60 months × 4 points = ~77k `team_kpi_values`),
 * `NUMBER`/`PERCENTAGE` with an `AT_LEAST`/`AT_MOST` target and an encrypted description. Events by rule
 * (`TeamKpiEvents.kt`): `CREATED{type}`, `STATUS_CHANGED{DRAFT→ACTIVE}`, one `VALUE_RECORDED{date,value}` per
 * point (recorded by the manager 70 % of the time, a team member otherwise), and `VALUE_CORRECTED` for ~1 %
 * — all through the real pure builders; the first KPI of every team is archived and reopened mid-history. Notifications
 * (the team-KPI table in `notifications.md`): every transition and every data-point mutation notifies all
 * current team members plus the manager, minus the actor (`teamKpiTransitionNotifications`,
 * `teamKpiValueNotifications`), retention-shaped by [NotificationMint].
 */
suspend fun seedTeamKpis(ctx: SeedContext, org: Org, mint: NotificationMint) {
    val writer = KpiWriter(ctx, mint)
    writer.init()
    val firstMonth = ctx.config.anchor.withDayOfMonth(1).minusMonths(ctx.spec.months.toLong())
    org.teams.forEach { team ->
        repeat(KPIS_PER_TEAM) { number -> writer.write(org, team, number, firstMonth, archivedOnce = number == 0) }
        writer.flush()
    }
    advanceSequences(
        ctx.db,
        listOf(TeamKpiService.TeamKpis, TeamKpiService.TeamKpiValues, TeamKpiEventService.TeamKpiEvents),
    )
}
