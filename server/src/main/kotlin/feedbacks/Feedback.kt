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

/** Delivered = visible beyond the parties involved (subject, management chain, team lists). */
val FeedbackStatus.isDelivered: Boolean
    get() = this == FeedbackStatus.SENT || this == FeedbackStatus.WITHDRAWN

/**
 * Body of `PUT /feedbacks/{id}` — the editable representation of a feedback. Status transitions,
 * party ids, and the requester message are NOT settable here (status moves through the
 * `POST /feedbacks/{id}/{action}` endpoints; the rest are immutable after creation).
 */
@Serializable
data class FeedbackContentUpdate(
    val content: String = "",
    val visibility: FeedbackVisibility,
)

/**
 * Body of `POST /feedbacks` — mirrors the spec's FeedbackRequest exactly. Deliberately has no
 * `lastModified`: that field is server-managed, and a dedicated create DTO keeps clients from
 * even sending it (unknown keys are rejected as 400 by the default Json config).
 */
@Serializable
data class FeedbackCreateRequest(
    val requesterId: UInt? = null,
    val subjectId: UInt,
    val providerId: UInt,
    val visibility: FeedbackVisibility,
    val status: FeedbackStatus,
    val content: String = "",
    val requesterMessage: String? = null,
) {
    fun toFeedback() = Feedback(
        requesterId = requesterId,
        subjectId = subjectId,
        providerId = providerId,
        visibility = visibility,
        status = status,
        content = content,
        requesterMessage = requesterMessage,
    )
}

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
    // Server-managed: set on every create/update; never part of a request body (see FeedbackCreateRequest).
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

/**
 * GET /api/v1/feedbacks/duplicate-check: the in-progress duplicate for a prospective
 * (subject, provider, requester) triple, if any — both fields null when there is none.
 * Backs the SPA's early warning on the create screens.
 */
@Serializable
data class DuplicateCheckResponse(
    val existingId: UInt?,
    val existingStatus: FeedbackStatus?,
)
