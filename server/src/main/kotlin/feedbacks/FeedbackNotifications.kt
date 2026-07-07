package ch.nokillswit.feedbacks

import ch.nokillswit.notifications.Notification
import ch.nokillswit.notifications.NotificationType

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
    // A self-reflection (provider == subject, never a requester) has no other party: every
    // notification below would tell the acting user about their own action — produce none.
    if (next.subjectId == next.providerId) return emptyList()

    val to = next.status
    val provider = nameById.nameOf(next.providerId)
    val subject = nameById.nameOf(next.subjectId)
    val requester = next.requesterId?.let { nameById.nameOf(it) }

    val view = "/feedback/$feedbackId/view"
    val subjectLink = view.takeIf { subjectCanRead(next.visibility) }
    val requesterLink = view.takeIf { requesterCanRead(next.visibility) }

    val notifications = mutableListOf<Notification>()

    when {
        from == FeedbackStatus.DRAFT && to == FeedbackStatus.SENT -> {
            notifications += Notification(
                recipientId = next.subjectId,
                type = NotificationType.FEEDBACK_SENT_TO_SUBJECT,
                params = mapOf("provider" to provider, "subject" to subject),
                link = subjectLink,
            )
            // The provider (sender) is confirmed their feedback went out; they can always read their
            // own feedback, so the view link is unconditional.
            notifications += Notification(
                recipientId = next.providerId,
                type = NotificationType.FEEDBACK_SENT_TO_PROVIDER,
                params = mapOf("subject" to subject),
                link = view,
            )
        }

        from == FeedbackStatus.REQUESTED && to == FeedbackStatus.REJECTED && next.requesterId != null ->
            notifications += Notification(
                recipientId = next.requesterId,
                type = NotificationType.FEEDBACK_REJECTED_TO_REQUESTER,
                params = mapOf("requester" to requester!!, "provider" to provider, "subject" to subject),
            )

        from == FeedbackStatus.REQUESTED && to == FeedbackStatus.DRAFT && next.requesterId != null ->
            notifications += Notification(
                recipientId = next.requesterId,
                type = NotificationType.FEEDBACK_PICKED_UP_TO_REQUESTER,
                params = mapOf("requester" to requester!!, "provider" to provider, "subject" to subject),
            )

        from == FeedbackStatus.SENT && to == FeedbackStatus.WITHDRAWN -> {
            notifications += Notification(
                recipientId = next.subjectId,
                type = NotificationType.FEEDBACK_WITHDRAWN_TO_SUBJECT,
                params = mapOf("provider" to provider, "subject" to subject),
            )
            if (next.requesterId != null) {
                notifications += Notification(
                    recipientId = next.requesterId,
                    type = NotificationType.FEEDBACK_WITHDRAWN_TO_REQUESTER,
                    params = mapOf("provider" to provider, "subject" to subject, "requester" to requester!!),
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
            type = NotificationType.FEEDBACK_SENT_TO_REQUESTER,
            params = mapOf("provider" to provider, "subject" to subject, "requester" to requester!!),
            link = requesterLink,
        )
    }

    return notifications
}

/**
 * Notifications produced when a feedback is *created* (as opposed to transitioned). The only case
 * is a brand-new feedback in [FeedbackStatus.REQUESTED] status: the designated provider is told
 * that feedback has been requested of them. Pure / side-effect-free like
 * [feedbackTransitionNotifications]; [FeedbackService.create] resolves names and persists.
 *
 * @param feedbackId the id assigned by the insert (drives the edit link).
 * @param created the feedback as persisted.
 * @param nameById display names for the parties (requester/subject).
 */
internal fun feedbackCreationNotifications(
    feedbackId: UInt,
    created: Feedback,
    nameById: Map<UInt, String>,
): List<Notification> {
    if (created.status != FeedbackStatus.REQUESTED) return emptyList()
    // REQUESTED requires a requester (enforced in FeedbackService.validate), so this is non-null.
    val requesterId = created.requesterId ?: return emptyList()
    val requester = nameById.nameOf(requesterId)
    val provider = nameById.nameOf(created.providerId)
    val subject = nameById.nameOf(created.subjectId)

    // The requester is confirmed their request went out; no link (nothing to open yet). The wording
    // differs when they asked for feedback about themselves (subject == requester) vs. about someone
    // — the `self` param drives an i18next context in the SPA.
    val requesterNote =
        if (created.subjectId == requesterId) {
            Notification(
                recipientId = requesterId,
                type = NotificationType.FEEDBACK_REQUESTED_TO_REQUESTER,
                params = mapOf("provider" to provider, "self" to "self"),
            )
        } else {
            Notification(
                recipientId = requesterId,
                type = NotificationType.FEEDBACK_REQUESTED_TO_REQUESTER,
                params = mapOf("provider" to provider, "subject" to subject),
            )
        }

    return listOf(
        Notification(
            recipientId = created.providerId,
            type = NotificationType.FEEDBACK_REQUESTED_TO_PROVIDER,
            params = mapOf("requester" to requester, "subject" to subject),
            link = "/feedback/$feedbackId/edit",
        ),
        requesterNote,
    )
}

/**
 * Notification produced when a feedback is *deleted* (soft-deleted) by its provider. When the
 * feedback has a requester, they are told the provider deleted it; the notification carries **no
 * link** (there is nothing left to open). Returns empty when there is no requester. Pure /
 * side-effect-free like the others; the route resolves names and persists.
 *
 * @param deleted the feedback as it was before deletion (source of the ids).
 * @param nameById display names for the parties (provider/subject).
 */
internal fun feedbackDeletionNotifications(
    deleted: Feedback,
    nameById: Map<UInt, String>,
): List<Notification> {
    val requesterId = deleted.requesterId ?: return emptyList()
    val provider = nameById.nameOf(deleted.providerId)
    val subject = nameById.nameOf(deleted.subjectId)
    return listOf(
        Notification(
            recipientId = requesterId,
            type = NotificationType.FEEDBACK_DELETED_TO_REQUESTER,
            params = mapOf("provider" to provider, "subject" to subject),
        ),
    )
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
