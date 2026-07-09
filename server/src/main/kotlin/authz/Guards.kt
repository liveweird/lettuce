package ch.nokillswit.authz

import ch.nokillswit.feedbacks.Feedback
import ch.nokillswit.feedbacks.FeedbackStatus
import ch.nokillswit.feedbacks.FeedbackVisibility
import ch.nokillswit.feedbacks.isDelivered
import ch.nokillswit.users.UserRole

fun CallerPrincipal.isAdmin(): Boolean = role == UserRole.ADMIN

fun requireAdmin(caller: CallerPrincipal) {
    if (!caller.isAdmin()) throw ForbiddenException("Admin role required")
}

fun requireSelfOrAdmin(caller: CallerPrincipal, targetUserId: UInt) {
    if (caller.isAdmin()) return
    if (caller.userId != targetUserId) throw ForbiddenException("Caller may only act on their own user")
}

fun requireTeamManagerOrAdmin(caller: CallerPrincipal, managerId: UInt) {
    if (caller.isAdmin()) return
    if (caller.userId != managerId) throw ForbiddenException("Only the team manager may perform this action")
}

/** Reassigning a team's manager (handing the team to a different user) is admin-only; a current
 *  manager may edit their team but not transfer ownership. No-op when the manager is unchanged. */
fun requireCanReassignManager(caller: CallerPrincipal, current: UInt, requested: UInt) {
    if (requested == current) return
    if (!caller.isAdmin()) throw ForbiddenException("Only an admin may reassign a team's manager")
}

fun requireNotificationRecipient(caller: CallerPrincipal, recipientId: UInt) {
    if (caller.isAdmin()) return
    if (caller.userId != recipientId) throw ForbiddenException("Caller may only access their own notifications")
}

fun requireCanAssignRole(caller: CallerPrincipal, current: UserRole, requested: UserRole?) {
    if (requested == null || requested == current) return // no role change requested
    if (!caller.isAdmin()) throw ForbiddenException("Only admins may change a user's role")
}

fun canReadFeedback(
    caller: CallerPrincipal,
    feedback: Feedback,
): Boolean {
    // what ADMIN sees
    // Admins see everything, regardless of the status and visibility
    if (caller.isAdmin()) return true

    // what PROVIDER sees
    // Provider can always see the full feedback, regardless of the status and visibility
    if (caller.userId == feedback.providerId) return true

    // what REQUESTER sees
    // Requesters can see the feedback if:
    // - visibility: provider-requester, or provider-requester-subject
    // - status: any
    if ((feedback.requesterId != null && caller.userId == feedback.requesterId) &&
        (feedback.visibility == FeedbackVisibility.PROVIDER_REQUESTER || feedback.visibility == FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT)
    ) return true

    // what SUBJECT sees
    // Subject can see the feedback if:
    // - visibility: provider-subject, or provider-requester-subject
    // - status: Sent, Withdawn
    if (caller.userId == feedback.subjectId &&
        (feedback.visibility == FeedbackVisibility.PROVIDER_SUBJECT || feedback.visibility == FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT) &&
        feedback.status.isDelivered
    ) return true

    // The SUBJECT's MANAGEMENT CHAIN (their manager, that manager's manager, and so on —
    // transitive) is handled outside this function: requireFeedbackReadAllowingManager grants a
    // managing caller read once the feedback is delivered (SENT/WITHDRAWN) after these cheap
    // rules miss — matching the team list scope; a provider's DRAFT stays private.

    // what the rest sees
    // - visibility: public
    // - status: Sent
    if (feedback.visibility == FeedbackVisibility.PUBLIC &&
        feedback.status == FeedbackStatus.SENT
    ) return true

    // and here's the default: deny. This is an ORDINARY outcome, not an anomaly — every
    // unauthorized read attempt lands here (including successful manager reads, which fall
    // through to requireFeedbackReadAllowingManager's chain check next). Actual 403s are
    // already recorded by the `authz.denied` audit event in plugins/ErrorHandling.kt.
    return false
}

suspend fun requireFeedbackReadAllowingManager(
    caller: CallerPrincipal,
    feedback: Feedback,
    managesSubject: suspend () -> Boolean,
) {
    if (canReadFeedback(caller, feedback)) return // cheap rules first
    // Any manager in the subject's management chain (direct or transitive — their manager's
    // manager, and so on) may read only once the feedback is delivered (SENT/WITHDRAWN),
    // matching the team list scope — a provider's DRAFT/REQUESTED work stays private to the
    // parties involved.
    if (feedback.status.isDelivered && managesSubject()) return // DB hit only if needed
    throw ForbiddenException("Caller may not read this feedback")
}

/**
 * Whether the feedback's CONTENT (not just its existence) may be shown to [caller]. Assumes
 * [canReadFeedback] already granted access to the record. While a feedback is unfinished
 * (DRAFT/REQUESTED) its content is the provider's private work in progress, so a requester who is
 * only watching sees that it exists but not its content; everyone else who can read it sees content
 * as before.
 */
fun canReadFeedbackContent(caller: CallerPrincipal, feedback: Feedback): Boolean {
    if (caller.isAdmin()) return true
    if (caller.userId == feedback.providerId) return true
    val unfinished =
        feedback.status == FeedbackStatus.DRAFT || feedback.status == FeedbackStatus.REQUESTED
    return !(unfinished && caller.userId == feedback.requesterId)
}

// ADMIN is intentionally NOT granted write access here: admins may read every feedback
// (see canReadFeedback) but may not edit, delete, or transition existing ones — only the
// provider can. An admin who happens to be the provider still qualifies via the userId check.
private fun canWriteFeedback(caller: CallerPrincipal, feedback: Feedback): Boolean =
    caller.userId == feedback.providerId

fun requireFeedbackWrite(caller: CallerPrincipal, feedback: Feedback) {
    if (!canWriteFeedback(caller, feedback)) {
        throw ForbiddenException("Only the feedback provider may modify this feedback")
    }
}
