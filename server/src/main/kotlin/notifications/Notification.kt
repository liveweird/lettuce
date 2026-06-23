package ch.nokillswit.notifications

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

@Serializable
data class NotificationPageResponse(
    val items: List<NotificationResponse>,
    val page: Int,
    val pageSize: Int,
    val total: Long,
)
