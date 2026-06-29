package ch.nokillswit.feedbacks

/**
 * Pure mapping from a feedback create / update to the audit-event description it should record.
 * Side-effect-free (no DB) so it can be unit-tested directly; the acting user is the caller and
 * persistence happens in the route (see FeedbackRoutes).
 */

/** Description recorded when a feedback is first created, keyed on its initial status. */
internal fun feedbackCreationEventContent(created: Feedback): String = when (created.status) {
    FeedbackStatus.REQUESTED -> "Feedback requested."
    FeedbackStatus.DRAFT -> "Feedback created as a draft."
    FeedbackStatus.SENT -> "Feedback created and sent."
    FeedbackStatus.WITHDRAWN -> "Feedback created as withdrawn."
    FeedbackStatus.REJECTED -> "Feedback created as rejected."
}

/** Description recorded when a draft feedback is deleted (soft-deleted) by its provider. */
internal fun feedbackDeletionEventContent(deleted: Feedback): String = "Feedback deleted."

/**
 * Description recorded on update. A status change wins; otherwise it reports the content/visibility
 * edit. Returns null when nothing audit-worthy changed (so no empty event is recorded).
 */
internal fun feedbackUpdateEventContent(before: Feedback, after: Feedback): String? {
    if (before.status != after.status) {
        return "Status changed from ${before.status} to ${after.status}."
    }
    val contentChanged = before.content != after.content
    val visibilityChanged = before.visibility != after.visibility
    return when {
        contentChanged && visibilityChanged -> "Content and visibility updated."
        contentChanged -> "Content updated."
        visibilityChanged -> "Visibility changed to ${after.visibility}."
        else -> null
    }
}
