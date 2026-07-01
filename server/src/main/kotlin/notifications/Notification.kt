package ch.nokillswit.notifications

import ch.nokillswit.infra.paging.PageResponse
import kotlinx.serialization.Serializable

/**
 * Internal create input. There is no public create endpoint: notifications are
 * generated as a side-effect of other activities and minted via [NotificationService.create].
 */
@Serializable
data class Notification(
    val recipientId: UInt,
    val message: String,
    val link: String? = null,
)

@Serializable
data class NotificationResponse(
    val id: UInt,
    val recipientId: UInt,
    // Epoch milliseconds; when the notification was generated. Server-managed.
    val timestamp: Long,
    val message: String,
    val link: String?,
    val wasSeen: Boolean,
)

typealias NotificationPageResponse = PageResponse<NotificationResponse>
