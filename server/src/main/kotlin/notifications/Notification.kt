package ch.nokillswit.notifications

import ch.nokillswit.infra.paging.PageResponse
import kotlinx.serialization.Serializable

/**
 * The kind of notification, driving both the recipient's wording and its params. Values are
 * produced by feedbacks/FeedbackNotifications.kt, oneonones/OneOnOneNotifications.kt,
 * goals/GoalNotifications.kt, teamkpis/TeamKpiNotifications.kt,
 * reviews/PerformanceReviewNotifications.kt, daysoff/DaysOffNotifications.kt, and the
 * password-change paths (users/UserRoutes.kt, auth/AuthRoutes.kt); the SPA renders each one in
 * the viewer's language from
 * `notifications.event.*` keys.
 */
@Serializable
enum class NotificationType {
    FEEDBACK_REQUESTED_TO_PROVIDER,
    FEEDBACK_REQUESTED_TO_REQUESTER,
    FEEDBACK_SENT_TO_SUBJECT,
    FEEDBACK_SENT_TO_PROVIDER,
    FEEDBACK_SENT_TO_REQUESTER,
    FEEDBACK_SENT_TO_MANAGER,
    FEEDBACK_REJECTED_TO_REQUESTER,
    FEEDBACK_PICKED_UP_TO_REQUESTER,
    FEEDBACK_WITHDRAWN_TO_SUBJECT,
    FEEDBACK_WITHDRAWN_TO_REQUESTER,
    FEEDBACK_DELETED_TO_REQUESTER,
    ONE_ON_ONE_CREATED_TO_SUBORDINATE,
    ONE_ON_ONE_CREATED_TO_MANAGER,
    GOAL_ACTIVATED_TO_SUBORDINATE,
    GOAL_DEACTIVATED_TO_SUBORDINATE,
    GOAL_ARCHIVED_TO_SUBORDINATE,
    GOAL_REOPENED_TO_SUBORDINATE,
    TEAM_KPI_ACTIVATED_TO_MEMBER,
    TEAM_KPI_DEACTIVATED_TO_MEMBER,
    TEAM_KPI_ARCHIVED_TO_MEMBER,
    TEAM_KPI_REOPENED_TO_MEMBER,
    TEAM_KPI_VALUE_RECORDED_TO_MEMBER,
    TEAM_KPI_VALUE_CORRECTED_TO_MEMBER,
    TEAM_KPI_VALUE_REMOVED_TO_MEMBER,
    PERFORMANCE_REVIEW_PUBLISHED_TO_SUBORDINATE,
    PERFORMANCE_REVIEW_UNPUBLISHED_TO_SUBORDINATE,
    DAYS_OFF_REQUESTED_TO_MANAGER,
    DAYS_OFF_ACCEPTED_TO_OWNER,
    DAYS_OFF_REJECTED_TO_OWNER,
    DAYS_OFF_CANCELLED_TO_MANAGER,
    PASSWORD_CHANGED,
}

/**
 * Internal create input. There is no public create endpoint: notifications are generated as a
 * side-effect of other activities and minted via [NotificationService.create]. [params] carries the
 * interpolation values (party names as proper nouns) the localized message needs.
 */
@Serializable
data class Notification(
    val recipientId: UInt,
    val type: NotificationType,
    val params: Map<String, String> = emptyMap(),
    val link: String? = null,
)

@Serializable
data class NotificationResponse(
    val id: UInt,
    val recipientId: UInt,
    // Epoch milliseconds; when the notification was generated. Server-managed.
    val timestamp: Long,
    val type: NotificationType,
    val params: Map<String, String> = emptyMap(),
    val link: String?,
    val wasSeen: Boolean,
)

typealias NotificationPageResponse = PageResponse<NotificationResponse>
