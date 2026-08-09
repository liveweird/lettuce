package ch.nokillswit.teamkpis

import ch.nokillswit.notifications.Notification
import ch.nokillswit.notifications.NotificationType

/**
 * Pure mapping from a team-KPI status transition to the notifications it should produce: every
 * current team member is told their manager moved the KPI — except the acting manager themselves,
 * who may also be a member of their own team and must not self-notify. Transitions and the data-point
 * mutations (see [teamKpiValueNotifications]) are the only notifying events; creation (a
 * private draft), definition edits, and deletion notify nobody.
 * Side-effect-free (no DB) like goals/GoalNotifications.kt; [TeamKpiService.transition] resolves
 * the current membership and manager name inside its transaction and the route persists the
 * result.
 *
 * The KPI title and team name ride along in params — both are plaintext by design (unlike
 * description/summary), so the localized message can name them.
 */
internal fun teamKpiTransitionNotifications(
    kpiId: UInt,
    from: TeamKpiStatus,
    to: TeamKpiStatus,
    memberIds: Set<UInt>,
    actingManagerId: UInt,
    managerName: String,
    title: String,
    teamName: String,
): List<Notification> {
    val type = when (from to to) {
        TeamKpiStatus.DRAFT to TeamKpiStatus.ACTIVE -> NotificationType.TEAM_KPI_ACTIVATED_TO_MEMBER
        TeamKpiStatus.ACTIVE to TeamKpiStatus.DRAFT -> NotificationType.TEAM_KPI_DEACTIVATED_TO_MEMBER
        TeamKpiStatus.ACTIVE to TeamKpiStatus.ARCHIVED -> NotificationType.TEAM_KPI_ARCHIVED_TO_MEMBER
        TeamKpiStatus.ARCHIVED to TeamKpiStatus.ACTIVE -> NotificationType.TEAM_KPI_REOPENED_TO_MEMBER
        // Every legal edge of the DRAFT <-> ACTIVE <-> ARCHIVED machine is named above — fail
        // loud on anything else (the daysoff precedent) so a future edge cannot silently mint
        // nothing.
        else -> error("Not a team-KPI transition edge: $from -> $to")
    }
    // Deactivation lands the KPI back in DRAFT, which members may not read — that notification
    // carries no link (the feedback convention: a link only when the recipient may follow it).
    val link = if (to == TeamKpiStatus.DRAFT) null else "/team-kpis/$kpiId/view"
    return (memberIds - actingManagerId).map { memberId ->
        Notification(
            recipientId = memberId,
            type = type,
            params = mapOf("manager" to managerName, "title" to title, "team" to teamName),
            link = link,
        )
    }
}

/**
 * Pure mapping from a data-point mutation (add / correct / remove — [type] must be one of the
 * TEAM_KPI_VALUE_* kinds) to the notifications it should produce: every current team member
 * except the acting manager, always linking to the KPI (data points only mutate while ACTIVE,
 * which members may read). [valueParams] carries the mutation's dates/values as raw strings
 * (ISO dates + the events' Double format — plaintext by design, like the audit trail):
 * `{date, value}` for recorded/removed, `{fromDate, fromValue, toDate, toValue}` for corrected.
 * [kpiType]'s name rides along so the SPA can format the values per type (the "%" suffix).
 * A no-op correction notifies nobody — the route skips the builder entirely (like the event).
 */
internal fun teamKpiValueNotifications(
    kpiId: UInt,
    type: NotificationType,
    memberIds: Set<UInt>,
    actingManagerId: UInt,
    managerName: String,
    title: String,
    teamName: String,
    kpiType: TeamKpiType,
    valueParams: Map<String, String>,
): List<Notification> =
    (memberIds - actingManagerId).map { memberId ->
        Notification(
            recipientId = memberId,
            type = type,
            params = mapOf(
                "manager" to managerName,
                "title" to title,
                "team" to teamName,
                "kpiType" to kpiType.name,
            ) + valueParams,
            link = "/team-kpis/$kpiId/view",
        )
    }
