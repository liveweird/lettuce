package ch.nokillswit.authz

import ch.nokillswit.feedbacks.Feedback
import ch.nokillswit.feedbacks.FeedbackVisibility
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

fun canReadFeedback(
    caller: CallerPrincipal,
    feedback: Feedback,
    managesSubject: Boolean = false,
): Boolean {
    if (caller.isAdmin()) return true
    if (caller.userId == feedback.providerId) return true
    // A manager may read any feedback about a subordinate (team-list parity), read-only.
    if (managesSubject) return true
    return when (feedback.visibility) {
        FeedbackVisibility.PUBLIC -> true
        FeedbackVisibility.PROVIDER_SUBJECT ->
            caller.userId == feedback.subjectId
        FeedbackVisibility.PROVIDER_REQUESTER ->
            feedback.requesterId != null && caller.userId == feedback.requesterId
        FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT ->
            caller.userId == feedback.subjectId ||
                (feedback.requesterId != null && caller.userId == feedback.requesterId)
    }
}

fun requireFeedbackRead(
    caller: CallerPrincipal,
    feedback: Feedback,
    managesSubject: Boolean = false,
) {
    if (!canReadFeedback(caller, feedback, managesSubject)) {
        throw ForbiddenException("Caller may not read this feedback")
    }
}

fun canWriteFeedback(caller: CallerPrincipal, feedback: Feedback): Boolean =
    caller.isAdmin() || caller.userId == feedback.providerId

fun requireFeedbackWrite(caller: CallerPrincipal, feedback: Feedback) {
    if (!canWriteFeedback(caller, feedback)) {
        throw ForbiddenException("Only the feedback provider may modify this feedback")
    }
}
