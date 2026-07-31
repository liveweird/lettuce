package ch.nokillswit.authz

import ch.nokillswit.audit.audit
import ch.nokillswit.feedbacks.Feedback
import ch.nokillswit.feedbacks.FeedbackStatus
import ch.nokillswit.feedbacks.FeedbackVisibility
import ch.nokillswit.feedbacks.isDelivered
import ch.nokillswit.goals.GoalResponse
import ch.nokillswit.goals.GoalStatus
import ch.nokillswit.oneonones.OneOnOneResponse
import ch.nokillswit.users.UserRole

fun CallerPrincipal.isAdmin(): Boolean = UserRole.ADMIN in roles

fun CallerPrincipal.isHr(): Boolean = UserRole.HR in roles

/** Read-everything privilege: ADMIN, or the HR auditor role (whose reads are audit-logged). */
fun CallerPrincipal.hasFullReadAccess(): Boolean = isAdmin() || isHr()

/**
 * Grants a read via the HR auditor role and records it (`hr.read`). Call AFTER the ordinary
 * rules (party/ADMIN/…) have missed, so the event only fires when the HR privilege is the
 * granting reason — one deliberate exception: an HR caller who is also in the record's
 * management chain is logged here without the chain walk (still an auditor-capable read,
 * and it saves the DB hit).
 */
private fun grantHrRead(caller: CallerPrincipal, resource: String, resourceId: UInt): Boolean {
    if (!caller.isHr()) return false
    audit(
        "hr.read",
        "resource" to resource,
        "resourceId" to resourceId.toLong(),
        "byUserId" to caller.userId.toLong(),
    )
    return true
}

fun requireAdmin(caller: CallerPrincipal) {
    if (!caller.isAdmin()) throw ForbiddenException("Admin role required")
}

fun requireSelfOrAdmin(caller: CallerPrincipal, targetUserId: UInt) {
    if (caller.isAdmin()) return
    if (caller.userId != targetUserId) throw ForbiddenException("Caller may only act on their own user")
}

/**
 * Read guard for GET /users/{id}: self, ADMIN, or HR (audited). Reads-only sibling of
 * [requireSelfOrAdmin] — the PUT/password sites keep that guard, so HR never gains the writes.
 * Runs guard-before-read like the original (API-ERR-006 uniform 403 preserved; the hr.read
 * event may therefore cite a nonexistent id — it records the attempt, which is fine).
 */
fun requireUserRead(caller: CallerPrincipal, targetUserId: UInt) {
    if (caller.isAdmin() || caller.userId == targetUserId) return
    if (grantHrRead(caller, "user", targetUserId)) return
    throw ForbiddenException("Caller may only act on their own user")
}

/**
 * Gate for the auditor list view (`view=user` on the feedback/1:1/goal lists): HR or ADMIN.
 * HR usage is recorded (`hr.list`); ADMIN reads stay unlogged like everywhere else.
 */
fun requireAuditListAccess(caller: CallerPrincipal, resource: String, targetUserId: UInt) {
    if (!caller.hasFullReadAccess()) {
        throw ForbiddenException("HR or Admin role required for view=user")
    }
    if (!caller.isAdmin()) {
        audit(
            "hr.list",
            "resource" to resource,
            "targetUserId" to targetUserId.toLong(),
            "byUserId" to caller.userId.toLong(),
        )
    }
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

fun requireCanAssignRoles(caller: CallerPrincipal, current: Set<UserRole>, requested: Set<UserRole>?) {
    if (requested == null || requested == current) return // no roles change requested
    if (!caller.isAdmin()) throw ForbiddenException("Only admins may change a user's roles")
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
    feedbackId: UInt,
    managesSubject: suspend () -> Boolean,
) {
    if (canReadFeedback(caller, feedback)) return // cheap rules first
    // HR auditor: reads everything (drafts included), audit-logged. Before the chain walk —
    // no DB hit for HR.
    if (grantHrRead(caller, "feedback", feedbackId)) return
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
    if (caller.hasFullReadAccess()) return true // ADMIN, and the HR auditor (never blanked)
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

// ── 1:1 meetings ────────────────────────────────────────────────────────────────────────────
// Existence disclosure: like feedbacks, 1:1 routes read BEFORE guarding (missing → 404,
// existing-but-forbidden → 403), so an id probe can learn a meeting exists — never its content
// or parties (ids are sequential; existence is no secret).

/** The cheap (no-DB) read rules: the two parties and ADMIN. The subordinate's wider management
 *  chain is handled by [requireOneOnOneReadAllowingManager] to keep the DB hit lazy. */
fun canReadOneOnOne(caller: CallerPrincipal, meeting: OneOnOneResponse): Boolean {
    if (caller.isAdmin()) return true
    if (caller.userId == meeting.managerId) return true
    return caller.userId == meeting.subordinateId
}

/**
 * Read guard for the single GET / events / action-item history: the parties and ADMIN pass the
 * cheap rules; otherwise any manager in the subordinate's transitive management chain (their
 * manager's manager, and so on) may read — matching the team list scope, whose direct-only
 * default is a narrower slice of this same right, not a separate authorization.
 */
suspend fun requireOneOnOneReadAllowingManager(
    caller: CallerPrincipal,
    meeting: OneOnOneResponse,
    managesSubordinate: suspend () -> Boolean,
) {
    if (canReadOneOnOne(caller, meeting)) return // cheap rules first
    // HR auditor: reads everything, audit-logged. Before the chain walk — no DB hit for HR.
    if (grantHrRead(caller, "oneOnOne", meeting.id)) return
    if (managesSubordinate()) return // DB hit only if needed
    throw ForbiddenException("Caller may not read this 1:1 meeting")
}

/**
 * The manager is always the author: only they may edit or delete the meeting. ADMIN is
 * intentionally NOT granted write access (mirroring [canWriteFeedback]); an admin who is
 * themselves the manager still qualifies via the userId check.
 */
fun requireOneOnOneWrite(caller: CallerPrincipal, meeting: OneOnOneResponse) {
    if (caller.userId != meeting.managerId) {
        throw ForbiddenException("Only the meeting's manager may modify this 1:1 meeting")
    }
}

// ── Goals ───────────────────────────────────────────────────────────────────────────────────
// Existence disclosure: like feedbacks and 1:1s, goal routes read BEFORE guarding (missing →
// 404, existing-but-forbidden → 403), so an id probe can learn a goal exists — never its
// content or parties (ids are sequential; existence is no secret).

/** The cheap (no-DB) read rules: the two parties and ADMIN, at every status. The subordinate's
 *  wider management chain is handled by [requireGoalReadAllowingManager] to keep the DB hit lazy. */
fun canReadGoal(caller: CallerPrincipal, goal: GoalResponse): Boolean {
    if (caller.isAdmin()) return true
    if (caller.userId == goal.managerId) return true
    return caller.userId == goal.subordinateId
}

/**
 * Read guard for the single GET / events: the parties and ADMIN pass the cheap rules; otherwise
 * any manager in the subordinate's transitive management chain (their manager's manager, and so
 * on) may read only once the goal has left DRAFT (ACTIVE/CLOSED) — a manager's draft stays
 * private to the pair, matching the team list scope (whose status != DRAFT filter is the same
 * rule, not a separate authorization) and mirroring the delivered-only feedback chain rule.
 */
suspend fun requireGoalReadAllowingManager(
    caller: CallerPrincipal,
    goal: GoalResponse,
    managesSubordinate: suspend () -> Boolean,
) {
    if (canReadGoal(caller, goal)) return // cheap rules first
    // HR auditor: reads everything — deliberately BEFORE the chain rule, so HR (unlike chain
    // managers) also sees DRAFT goals. Audit-logged; no DB hit for HR.
    if (grantHrRead(caller, "goal", goal.id)) return
    if (goal.status != GoalStatus.DRAFT && managesSubordinate()) return // DB hit only if needed
    throw ForbiddenException("Caller may not read this goal")
}

/**
 * The manager is always the author: only they may edit, transition, or delete the goal — the
 * subordinate has read rights only. ADMIN is intentionally NOT granted write access (mirroring
 * [canWriteFeedback]); an admin who is themselves the manager still qualifies via the userId
 * check.
 */
fun requireGoalWrite(caller: CallerPrincipal, goal: GoalResponse) {
    if (caller.userId != goal.managerId) {
        throw ForbiddenException("Only the goal's manager may modify this goal")
    }
}
