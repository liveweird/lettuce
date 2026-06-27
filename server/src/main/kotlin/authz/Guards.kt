package ch.nokillswit.authz

import ch.nokillswit.feedbacks.Feedback
import ch.nokillswit.feedbacks.FeedbackStatus
import ch.nokillswit.feedbacks.FeedbackVisibility
import ch.nokillswit.users.UserRole
import org.slf4j.LoggerFactory
import org.slf4j.MarkerFactory

private val logger = LoggerFactory.getLogger("ch.nokillswit.authz.Guards")
private val SHOULD_NEVER_HAPPEN = MarkerFactory.getMarker("SHOULD_NEVER_HAPPEN")

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
    managesSubject: Boolean = false,
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
        (feedback.status == FeedbackStatus.SENT || feedback.status == FeedbackStatus.WITHDRAWN)
    ) return true

    // what SUBJECT's MANAGER sees
    // Subject's manager can see the feedback if:
    // - visibility: any
    // - status: Sent, Withdrawn
    if (managesSubject &&
        (feedback.status == FeedbackStatus.SENT || feedback.status == FeedbackStatus.WITHDRAWN)
    ) return true

    // what the rest sees
    // - visibility: public
    // - status: Sent
    if (feedback.visibility == FeedbackVisibility.PUBLIC &&
        feedback.status == FeedbackStatus.SENT
    ) return true

    // and here's the default
    // by default one CAN'T see the feedback, but this branch should never be reached, so log it.
    // Non-fatal: still denies; the marker + kv attributes flow through OpenTelemetry (see logback.xml).
    logger.atWarn().addMarker(SHOULD_NEVER_HAPPEN)
        .setMessage("Feedback visibility check fell through to default deny")
        .addKeyValue("subjectId", feedback.subjectId)
        .addKeyValue("providerId", feedback.providerId)
        .addKeyValue("visibility", feedback.visibility)
        .addKeyValue("status", feedback.status)
        .log()
    return false
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

suspend fun requireFeedbackReadAllowingManager(
    caller: CallerPrincipal,
    feedback: Feedback,
    managesSubject: suspend () -> Boolean,
) {
    if (canReadFeedback(caller, feedback)) return // cheap rules first
    if (managesSubject()) return // DB hit only if needed
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

fun canWriteFeedback(caller: CallerPrincipal, feedback: Feedback): Boolean =
    caller.isAdmin() || caller.userId == feedback.providerId

fun requireFeedbackWrite(caller: CallerPrincipal, feedback: Feedback) {
    if (!canWriteFeedback(caller, feedback)) {
        throw ForbiddenException("Only the feedback provider may modify this feedback")
    }
}
