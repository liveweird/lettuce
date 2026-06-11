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

@Serializable
data class FeedbackListItem(
    val id: UInt,
    val requesterId: UInt?,
    val requesterName: String?,
    val requesterDeleted: Boolean,
    val subjectId: UInt,
    val subjectName: String,
    val subjectDeleted: Boolean,
    val providerId: UInt,
    val providerName: String,
    val providerDeleted: Boolean,
    val visibility: FeedbackVisibility,
    val status: FeedbackStatus,
    val contentPreview: String,
)

@Serializable
data class FeedbackPageResponse(
    val items: List<FeedbackListItem>,
    val page: Int,
    val pageSize: Int,
    val total: Long,
)
