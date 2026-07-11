package ch.nokillswit.notifications

import ch.nokillswit.infra.paging.PageResponse
import kotlinx.serialization.Serializable

/**
 * The kind of notification, driving both the recipient's wording and its params. Values are
 * produced by feedbacks/FeedbackNotifications.kt and oneonones/OneOnOneNotifications.kt; the SPA
 * renders each one in the viewer's language from `notifications.event.*` keys.
 */
@Serializable
enum class NotificationType {
    FEEDBACK_REQUESTED_TO_PROVIDER,
    FEEDBACK_REQUESTED_TO_REQUESTER,
    FEEDBACK_SENT_TO_SUBJECT,
    FEEDBACK_SENT_TO_PROVIDER,
    FEEDBACK_SENT_TO_REQUESTER,
    FEEDBACK_REJECTED_TO_REQUESTER,
    FEEDBACK_PICKED_UP_TO_REQUESTER,
    FEEDBACK_WITHDRAWN_TO_SUBJECT,
    FEEDBACK_WITHDRAWN_TO_REQUESTER,
    FEEDBACK_DELETED_TO_REQUESTER,
    ONE_ON_ONE_CREATED_TO_SUBORDINATE,
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
