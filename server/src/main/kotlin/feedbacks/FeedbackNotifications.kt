package ch.nokillswit.feedbacks

import ch.nokillswit.notifications.Notification

/**
 * Pure mapping from a feedback status transition to the notifications it should produce.
 * Kept side-effect-free (no DB) so it can be unit-tested directly; [FeedbackService.update]
 * resolves the party names and the persistence happens in the route.
 *
 * @param next the feedback after the update (its ids/visibility are the source of truth).
 * @param nameById display names for the parties (provider/subject/requester).
 */
internal fun feedbackTransitionNotifications(
    feedbackId: UInt,
    from: FeedbackStatus,
    next: Feedback,
    nameById: Map<UInt, String>,
): List<Notification> {
    val to = next.status
    val provider = nameById.nameOf(next.providerId)
    val subject = nameById.nameOf(next.subjectId)
    val requester = next.requesterId?.let { nameById.nameOf(it) }

    val view = "/feedback/$feedbackId/view"
    val subjectLink = view.takeIf { subjectCanRead(next.visibility) }
    val requesterLink = view.takeIf { requesterCanRead(next.visibility) }

    val notifications = mutableListOf<Notification>()

    when {
        from == FeedbackStatus.DRAFT && to == FeedbackStatus.SENT ->
            notifications += Notification(
                recipientId = next.subjectId,
                message = "Feedback from provider $provider about subject $subject has been sent.",
                link = subjectLink,
            )

        from == FeedbackStatus.REQUESTED && to == FeedbackStatus.REJECTED && next.requesterId != null ->
            notifications += Notification(
                recipientId = next.requesterId,
                message = "Feedback request by requester $requester to provider $provider " +
                    "about subject $subject was rejected.",
            )

        from == FeedbackStatus.REQUESTED && to == FeedbackStatus.DRAFT && next.requesterId != null ->
            notifications += Notification(
                recipientId = next.requesterId,
                message = "Feedback request by requester $requester to provider $provider " +
                    "about subject $subject was picked up by the provider (now a draft).",
            )

        from == FeedbackStatus.SENT && to == FeedbackStatus.WITHDRAWN -> {
            notifications += Notification(
                recipientId = next.subjectId,
                message = "Feedback from provider $provider about subject $subject has been withdrawn.",
            )
            if (next.requesterId != null) {
                notifications += Notification(
                    recipientId = next.requesterId,
                    message = "Feedback from provider $provider about subject $subject " +
                        "(requested by $requester) has been withdrawn.",
                )
            }
        }
    }

    // A "sent" of requested feedback also notifies the requester (in addition to the subject
    // notification above for DRAFT -> SENT). REQUESTED -> SENT is not an allowed transition, so
    // in practice this fires alongside the DRAFT -> SENT case.
    if (to == FeedbackStatus.SENT &&
        (from == FeedbackStatus.DRAFT || from == FeedbackStatus.REQUESTED) &&
        next.requesterId != null
    ) {
        notifications += Notification(
            recipientId = next.requesterId,
            message = "Requested feedback from provider $provider about subject $subject " +
                "(requested by $requester) has been sent.",
            link = requesterLink,
        )
    }

    return notifications
}

private fun Map<UInt, String>.nameOf(id: UInt): String = this[id] ?: "#$id"

private fun subjectCanRead(visibility: FeedbackVisibility): Boolean = when (visibility) {
    FeedbackVisibility.PUBLIC,
    FeedbackVisibility.PROVIDER_SUBJECT,
    FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT -> true
    FeedbackVisibility.PROVIDER_REQUESTER -> false
}

private fun requesterCanRead(visibility: FeedbackVisibility): Boolean = when (visibility) {
    FeedbackVisibility.PUBLIC,
    FeedbackVisibility.PROVIDER_REQUESTER,
    FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT -> true
    FeedbackVisibility.PROVIDER_SUBJECT -> false
}
