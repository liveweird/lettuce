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
    // Structured event; the SPA renders it in the viewer's language.
    val type: FeedbackEventType,
    val params: Map<String, String> = emptyMap(),
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
    // Structured event for client-side localization.
    val type: FeedbackEventType,
    val params: Map<String, String> = emptyMap(),
)

@Serializable
data class FeedbackEventListResponse(
    val items: List<FeedbackEventResponse>,
)
