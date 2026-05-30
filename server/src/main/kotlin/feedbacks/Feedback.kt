package ch.nokillswit.feedbacks

import kotlinx.serialization.Serializable

@Serializable
enum class FeedbackVisibility {
    PROVIDER_SUBJECT,
    PROVIDER_REQUESTER,
    PROVIDER_REQUESTER_SUBJECT,
    PUBLIC,
}

@Serializable
enum class FeedbackStatus { REQUESTED, DRAFT, SENT, WITHDRAWN }

@Serializable
data class Feedback(
    val requesterId: UInt? = null,
    val subjectId: UInt,
    val providerId: UInt,
    val visibility: FeedbackVisibility,
    val status: FeedbackStatus,
    val content: String = "",
)

@Serializable
data class FeedbackResponse(
    val id: UInt,
    val requesterId: UInt?,
    val subjectId: UInt,
    val providerId: UInt,
    val visibility: FeedbackVisibility,
    val status: FeedbackStatus,
    val content: String,
)

fun Feedback.toResponse(id: UInt) =
    FeedbackResponse(id, requesterId, subjectId, providerId, visibility, status, content)
