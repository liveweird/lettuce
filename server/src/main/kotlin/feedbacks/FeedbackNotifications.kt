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
 * @param subjectManagerNames id → name of the subject's direct managers; they gain read access
 *   when the feedback is delivered, so a SENT landing notifies them too. Pass empty (the
 *   default) on transitions that cannot land in SENT — no query needed.
 */
internal fun feedbackTransitionNotifications(
    feedbackId: UInt,
    from: FeedbackStatus,
    next: Feedback,
    nameById: Map<UInt, String>,
    subjectManagerNames: Map<UInt, String> = emptyMap(),
): List<Notification> {
    // provider == subject is a SELF-REFLECTION. Its transitions are performed by that very
    // person, so the subject/provider-directed notifications below would tell the acting user
    // about their own action — they are filtered out at the end. Requester-directed ones (a
    // requested self-reflection) survive, worded via the `self` i18next context.
    val isSelfReflection = next.subjectId == next.providerId
    val selfParams = if (isSelfReflection) mapOf("self" to "self") else emptyMap()

    val to = next.status
    val provider = nameById.nameOf(next.providerId)
    val subject = nameById.nameOf(next.subjectId)
    val requester = next.requesterId?.let { nameById.nameOf(it) }

    val notifications = mutableListOf<Notification>()

    when {
        from == FeedbackStatus.DRAFT && to == FeedbackStatus.SENT -> {
            notifications += sentToSubjectNote(feedbackId, next, nameById)
            notifications += sentToProviderNote(feedbackId, next, nameById)
            notifications += sentToManagerNotes(feedbackId, next, nameById, subjectManagerNames, selfParams)
        }

        from == FeedbackStatus.REQUESTED && to == FeedbackStatus.REJECTED && next.requesterId != null ->
            notifications += Notification(
                recipientId = next.requesterId,
                type = NotificationType.FEEDBACK_REJECTED_TO_REQUESTER,
                params = mapOf("requester" to requester!!, "provider" to provider, "subject" to subject) + selfParams,
            )

        from == FeedbackStatus.REQUESTED && to == FeedbackStatus.DRAFT && next.requesterId != null ->
            notifications += Notification(
                recipientId = next.requesterId,
                type = NotificationType.FEEDBACK_PICKED_UP_TO_REQUESTER,
                params = mapOf("requester" to requester!!, "provider" to provider, "subject" to subject) + selfParams,
            )

        // Retracting a SENT feedback and abandoning a DRAFT both land in WITHDRAWN — a
        // delivered status, so the record becomes visible in the subject's Received list
        // either way; both paths notify identically (an abandoned draft must not appear
        // there silently).
        (from == FeedbackStatus.SENT || from == FeedbackStatus.DRAFT) && to == FeedbackStatus.WITHDRAWN -> {
            notifications += Notification(
                recipientId = next.subjectId,
                type = NotificationType.FEEDBACK_WITHDRAWN_TO_SUBJECT,
                params = mapOf("provider" to provider, "subject" to subject),
            )
            if (next.requesterId != null) {
                notifications += Notification(
                    recipientId = next.requesterId,
                    type = NotificationType.FEEDBACK_WITHDRAWN_TO_REQUESTER,
                    params = mapOf("provider" to provider, "subject" to subject, "requester" to requester!!) + selfParams,
                )
            }
        }
    }

    // A "sent" of requested feedback also notifies the requester (in addition to the subject
    // notification above for DRAFT -> SENT). REQUESTED -> SENT is not an allowed transition, so
    // in practice this fires alongside the DRAFT -> SENT case.
    if (to == FeedbackStatus.SENT && (from == FeedbackStatus.DRAFT || from == FeedbackStatus.REQUESTED)) {
        sentToRequesterNote(feedbackId, next, nameById, selfParams)?.let { notifications += it }
    }

    // Self-reflection: drop the notifications aimed at the subject/provider — that IS the acting
    // user (requester ≠ provider guarantees the requester-directed ones are unaffected).
    return if (isSelfReflection) notifications.filter { it.recipientId != next.providerId } else notifications
}

/**
 * Notifications produced when a feedback is *created* (as opposed to transitioned). Two cases:
 * a brand-new feedback in [FeedbackStatus.REQUESTED] status (the designated provider is told
 * that feedback has been requested of them, the requester gets a confirmation), and a feedback
 * created directly as [FeedbackStatus.SENT] ("save & send" — same recipient set as the
 * DRAFT -> SENT transition, so who gets notified never depends on whether a draft step
 * happened). Any other status (a private DRAFT) produces nothing. Pure / side-effect-free like
 * [feedbackTransitionNotifications]; [FeedbackService.create] resolves names and persists.
 *
 * @param feedbackId the id assigned by the insert (drives the edit/view links).
 * @param created the feedback as persisted.
 * @param nameById display names for the parties (requester/subject).
 * @param subjectManagerNames id → name of the subject's direct managers (SENT creations only —
 *   see [feedbackTransitionNotifications]).
 */
internal fun feedbackCreationNotifications(
    feedbackId: UInt,
    created: Feedback,
    nameById: Map<UInt, String>,
    subjectManagerNames: Map<UInt, String> = emptyMap(),
): List<Notification> {
    if (created.status == FeedbackStatus.SENT) {
        // Mirror the DRAFT -> SENT transition exactly, including the self-reflection rule:
        // a standalone self row ("save & send" about yourself) notifies no party (the acting
        // user is every recipient) — though the subject's managers, who are not the actor,
        // are still told; a requested one notifies only the requester, self-worded.
        val isSelfReflection = created.subjectId == created.providerId
        val selfParams = if (isSelfReflection) mapOf("self" to "self") else emptyMap()
        val notifications = listOfNotNull(
            sentToSubjectNote(feedbackId, created, nameById),
            sentToProviderNote(feedbackId, created, nameById),
            sentToRequesterNote(feedbackId, created, nameById, selfParams),
        ) + sentToManagerNotes(feedbackId, created, nameById, subjectManagerNames, selfParams)
        return if (isSelfReflection) {
            notifications.filter { it.recipientId != created.providerId }
        } else {
            notifications
        }
    }
    if (created.status != FeedbackStatus.REQUESTED) return emptyList()
    // REQUESTED requires a requester (enforced in FeedbackService.validate), so this is non-null.
    val requesterId = created.requesterId ?: return emptyList()
    val requester = nameById.nameOf(requesterId)
    val provider = nameById.nameOf(created.providerId)
    val subject = nameById.nameOf(created.subjectId)

    // The requester is confirmed their request went out; no link (nothing to open yet). The wording
    // differs when they asked for feedback about themselves (subject == requester, `self` context)
    // or asked the subject for a self-reflection (subject == provider, `reflection` context) —
    // the `self` param's VALUE drives the i18next context suffix in the SPA.
    val requesterNote = when {
        created.subjectId == requesterId ->
            Notification(
                recipientId = requesterId,
                type = NotificationType.FEEDBACK_REQUESTED_TO_REQUESTER,
                params = mapOf("provider" to provider, "self" to "self"),
            )
        created.subjectId == created.providerId ->
            Notification(
                recipientId = requesterId,
                type = NotificationType.FEEDBACK_REQUESTED_TO_REQUESTER,
                params = mapOf("provider" to provider, "subject" to subject, "self" to "reflection"),
            )
        else ->
            Notification(
                recipientId = requesterId,
                type = NotificationType.FEEDBACK_REQUESTED_TO_REQUESTER,
                params = mapOf("provider" to provider, "subject" to subject),
            )
    }

    // The provider is asked to write; when they ARE the subject (a requested self-reflection),
    // the `self` context words it as "asked you for a self-reflection".
    val providerSelf =
        if (created.subjectId == created.providerId) mapOf("self" to "self") else emptyMap()

    return listOf(
        Notification(
            recipientId = created.providerId,
            type = NotificationType.FEEDBACK_REQUESTED_TO_PROVIDER,
            params = mapOf("requester" to requester, "subject" to subject) + providerSelf,
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
    // A deleted requested self-reflection is worded via the `self` context, like the transitions.
    val selfParams =
        if (deleted.subjectId == deleted.providerId) mapOf("self" to "self") else emptyMap()
    return listOf(
        Notification(
            recipientId = requesterId,
            type = NotificationType.FEEDBACK_DELETED_TO_REQUESTER,
            params = mapOf("provider" to provider, "subject" to subject) + selfParams,
        ),
    )
}

// The notes minted whenever a feedback lands in SENT — shared by the DRAFT -> SENT transition
// and a feedback created directly as SENT ("save & send"), so the two paths can never drift.

private fun sentToSubjectNote(
    feedbackId: UInt,
    feedback: Feedback,
    nameById: Map<UInt, String>,
): Notification = Notification(
    recipientId = feedback.subjectId,
    type = NotificationType.FEEDBACK_SENT_TO_SUBJECT,
    params = mapOf(
        "provider" to nameById.nameOf(feedback.providerId),
        "subject" to nameById.nameOf(feedback.subjectId),
    ),
    link = "/feedback/$feedbackId/view".takeIf { subjectCanRead(feedback.visibility) },
)

// The provider (sender) is confirmed their feedback went out; they can always read their own
// feedback, so the view link is unconditional.
private fun sentToProviderNote(
    feedbackId: UInt,
    feedback: Feedback,
    nameById: Map<UInt, String>,
): Notification = Notification(
    recipientId = feedback.providerId,
    type = NotificationType.FEEDBACK_SENT_TO_PROVIDER,
    params = mapOf("subject" to nameById.nameOf(feedback.subjectId)),
    link = "/feedback/$feedbackId/view",
)

/**
 * One note per direct manager of the subject — they gain read access when the feedback is
 * delivered, and that read is not visibility-gated, so the view link is unconditional. Managers
 * who are themselves a party (provider/subject/requester) are excluded: they are the actor or
 * already notified in that role. Self-reflections keep these notes (the manager is never the
 * acting user), worded via the `self` context.
 */
private fun sentToManagerNotes(
    feedbackId: UInt,
    feedback: Feedback,
    nameById: Map<UInt, String>,
    managerNames: Map<UInt, String>,
    selfParams: Map<String, String>,
): List<Notification> {
    val parties = setOfNotNull(feedback.providerId, feedback.subjectId, feedback.requesterId)
    return managerNames.keys.filter { it !in parties }.map { managerId ->
        Notification(
            recipientId = managerId,
            type = NotificationType.FEEDBACK_SENT_TO_MANAGER,
            params = mapOf(
                "provider" to nameById.nameOf(feedback.providerId),
                "subject" to nameById.nameOf(feedback.subjectId),
            ) + selfParams,
            link = "/feedback/$feedbackId/view",
        )
    }
}

/** Null when the feedback has no requester. */
private fun sentToRequesterNote(
    feedbackId: UInt,
    feedback: Feedback,
    nameById: Map<UInt, String>,
    selfParams: Map<String, String>,
): Notification? = feedback.requesterId?.let { requesterId ->
    Notification(
        recipientId = requesterId,
        type = NotificationType.FEEDBACK_SENT_TO_REQUESTER,
        params = mapOf(
            "provider" to nameById.nameOf(feedback.providerId),
            "subject" to nameById.nameOf(feedback.subjectId),
            "requester" to nameById.nameOf(requesterId),
        ) + selfParams,
        link = "/feedback/$feedbackId/view".takeIf { requesterCanRead(feedback.visibility) },
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
