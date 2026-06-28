package ch.nokillswit.feedbacks

import kotlinx.serialization.Serializable

/**
 * Internal create input for a feedback audit event. There is no public create endpoint:
 * events are minted as a side-effect of feedback create/transition/edit (see [FeedbackEvents]
 * for the descriptions) and persisted via [FeedbackEventService.create]. The timestamp is
 * server-managed.
 */
@Serializable
data class FeedbackEvent(
    val feedbackId: UInt,
    // The user who performed the change (the acting caller).
    val userId: UInt,
    val content: String,
)

@Serializable
data class FeedbackEventResponse(
    val id: UInt,
    val feedbackId: UInt,
    val userId: UInt,
    // Display name of the acting user; server-resolved, read-only.
    val userName: String,
    // Epoch milliseconds when the event was recorded. Server-managed.
    val timestamp: Long,
    val content: String,
)

@Serializable
data class FeedbackEventListResponse(
    val items: List<FeedbackEventResponse>,
)
