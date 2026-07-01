package ch.nokillswit.feedbacks

import ch.nokillswit.infra.paging.PageResponse
import kotlinx.serialization.Serializable

@Serializable
enum class FeedbackVisibility {
    PROVIDER_SUBJECT,
    PROVIDER_REQUESTER,
    PROVIDER_REQUESTER_SUBJECT,
    PUBLIC,
}

@Serializable
enum class FeedbackStatus { REQUESTED, DRAFT, SENT, WITHDRAWN, REJECTED }

@Serializable
data class Feedback(
    val requesterId: UInt? = null,
    val subjectId: UInt,
    val providerId: UInt,
    val visibility: FeedbackVisibility,
    val status: FeedbackStatus,
    val content: String = "",
    // Requester's clarification note to the provider; set at creation only, never editable afterward.
    val requesterMessage: String? = null,
    // Server-managed: set on every create/update and ignored from request bodies.
    val lastModified: Long = 0L,
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
    val requesterMessage: String? = null,
    val lastModified: Long,
    // Resolved party display names; null when not resolved (e.g. no requester).
    val requesterName: String? = null,
    val subjectName: String? = null,
    val providerName: String? = null,
)

fun Feedback.toResponse(
    id: UInt,
    names: Map<UInt, String> = emptyMap(),
    includeContent: Boolean = true,
) =
    FeedbackResponse(
        id, requesterId, subjectId, providerId, visibility, status,
        content = if (includeContent) content else "",
        requesterMessage = requesterMessage,
        lastModified = lastModified,
        requesterName = requesterId?.let { names[it] },
        subjectName = names[subjectId],
        providerName = names[providerId],
    )

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
    val lastModified: Long,
)

typealias FeedbackPageResponse = PageResponse<FeedbackListItem>
