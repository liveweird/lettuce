package ch.nokillswit.authz

import ch.nokillswit.audit.audit
import ch.nokillswit.daysoff.DaysOffResponse
import ch.nokillswit.daysoff.DaysOffStatus
import ch.nokillswit.feedbacks.Feedback
import ch.nokillswit.feedbacks.FeedbackStatus
import ch.nokillswit.feedbacks.FeedbackVisibility
import ch.nokillswit.feedbacks.isDelivered
import ch.nokillswit.goals.GoalResponse
import ch.nokillswit.goals.GoalStatus
import ch.nokillswit.oneonones.OneOnOneResponse
import ch.nokillswit.pulse.PulseCycleStatus
import ch.nokillswit.reviews.PerformanceReviewResponse
import ch.nokillswit.reviews.PerformanceReviewStatus
import ch.nokillswit.teamkpis.TeamKpiResponse
import ch.nokillswit.teamkpis.TeamKpiStatus
import ch.nokillswit.users.Feature
import ch.nokillswit.users.UserRole

fun CallerPrincipal.isAdmin(): Boolean = UserRole.ADMIN in roles

fun CallerPrincipal.isHr(): Boolean = UserRole.HR in roles

/**
 * Grants a read via the HR auditor role and records it (`hr.read`). Call AFTER the ordinary
 * rules (party/self/…) have missed, so the event only fires when the HR privilege is the
 * granting reason — one deliberate exception: an HR caller who is also in the record's
 * management chain is logged here without the chain walk (still an auditor-capable read,
 * and it saves the DB hit).
 */
private fun grantHrRead(caller: CallerPrincipal, resource: String, resourceId: UInt): Boolean {
    if (!caller.isHr()) return false
    auditHrRead(resource, resourceId, caller.userId)
    return true
}

/**
 * The single writer of the `hr.read` event shape: resource + resourceId + byUserId, plus any
 * per-site extras (the pulse team-scoped reads append a teamId). [grantHrRead] and the pulse
 * guards below both emit through it, so the shape cannot drift per call site. (`hr.list` is a
 * separate event with its own shape — see [requireAuditListAccess].)
 */
internal fun auditHrRead(resource: String, resourceId: UInt, byUserId: UInt, vararg extra: Pair<String, Any?>) {
    audit(
        "hr.read",
        "resource" to resource,
        "resourceId" to resourceId.toLong(),
        "byUserId" to byUserId.toLong(),
        *extra,
    )
}

fun requireAdmin(caller: CallerPrincipal) {
    if (!caller.isAdmin()) throw ForbiddenException("Admin role required")
}

/**
 * Per-user feature flag gate (V46): 403 when [feature] is in the caller's disabled set.
 * Uniform — binds HR and ADMIN exactly like a regular user (an HR auditor with FEEDBACKS
 * disabled cannot audit feedbacks; the review-periods/public-holidays registries count as
 * PERFORMANCE_REVIEWS/DAYS_OFF). Each gated route file runs this as the caller's FIRST guard,
 * before any read — so a disabled caller gets a uniform 403 even for a missing id, a
 * deliberate deviation from the read-before-guard 404 idiom (no existence disclosure: the
 * answer never varies for them). The set rides the JWT, so a change takes effect at the next
 * refresh (≤15 min) or login — the documented password-change staleness window.
 */
fun requireFeatureEnabled(caller: CallerPrincipal, feature: Feature) {
    if (feature in caller.disabledFeatures) {
        throw ForbiddenException("The ${feature.name} feature is disabled for this account")
    }
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
 * Gate for the auditor list view (`view=user` on the feedback/1:1/goal lists): HR only —
 * ADMIN is a management role with no special feedback/1:1/goal access. Every use is
 * recorded (`hr.list`).
 */
fun requireAuditListAccess(caller: CallerPrincipal, resource: String, targetUserId: UInt) {
    if (!caller.isHr()) {
        throw ForbiddenException("HR role required for view=user")
    }
    audit(
        "hr.list",
        "resource" to resource,
        "targetUserId" to targetUserId.toLong(),
        "byUserId" to caller.userId.toLong(),
    )
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
    // Recipient-only for everyone — notifications are personal alerts; not even ADMIN
    // (a management role) or HR (whose audit read covers the primary records) may touch them.
    if (caller.userId != recipientId) throw ForbiddenException("Caller may only access their own notifications")
}

fun requireCanAssignRoles(caller: CallerPrincipal, current: Set<UserRole>, requested: Set<UserRole>?) {
    if (requested == null || requested == current) return // no roles change requested
    if (!caller.isAdmin()) throw ForbiddenException("Only admins may change a user's roles")
}

/**
 * Writing a user's career position history (v2.15.0): any manager in the target's TRANSITIVE
 * management chain — and nobody else. Deliberately wider than the days-off corrections write
 * (direct managers only): career progression is the chain's shared record, and a skip-level
 * manager concluding a position is a feature. ADMIN gets nothing (the management role lost the
 * career write in v2.15.0), HR stays read-only, and the user never writes their own history.
 */
suspend fun requireCareerPositionWrite(caller: CallerPrincipal, managesTarget: suspend () -> Boolean) {
    if (!managesTarget()) {
        throw ForbiddenException("Only a manager in the user's management chain may manage their career positions")
    }
}

/**
 * The [requireCanAssignRoles] sibling for the paid days-off allowance (an Int, not a
 * dictionary ref): newly assigning or changing it is ADMIN-only. A null request (= leave
 * unchanged) or resubmitting the current value is not a change; clearing is inexpressible.
 */
fun requireCanAssignPaidDaysOffAllowance(caller: CallerPrincipal, requested: Int?, current: Int?) {
    if (requested == null || requested == current) return
    if (!caller.isAdmin()) throw ForbiddenException("Only admins may change a user's paid days-off allowance")
}

fun canReadFeedback(
    caller: CallerPrincipal,
    feedback: Feedback,
): Boolean {
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
    if (caller.isHr()) return true // the HR auditor is never blanked
    if (caller.userId == feedback.providerId) return true
    val unfinished =
        feedback.status == FeedbackStatus.DRAFT || feedback.status == FeedbackStatus.REQUESTED
    return !(unfinished && caller.userId == feedback.requesterId)
}

// Provider-only: nobody else — including ADMIN (a management role with no feedback access
// beyond a standard user's) — may edit, delete, or transition a feedback. An admin who
// happens to be the provider qualifies via the userId check like anyone.
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

/** The cheap (no-DB) read rules: the two parties. The subordinate's wider management
 *  chain is handled by [requireOneOnOneReadAllowingManager] to keep the DB hit lazy. */
fun canReadOneOnOne(caller: CallerPrincipal, meeting: OneOnOneResponse): Boolean {
    if (caller.userId == meeting.managerId) return true
    return caller.userId == meeting.subordinateId
}

/**
 * Read guard for the single GET / events / action-item history: the parties pass the
 * cheap rules; the HR auditor reads everything (audit-logged); otherwise any manager in the
 * subordinate's transitive management chain (their manager's manager, and so on) may read —
 * matching the team list scope, whose direct-only default is a narrower slice of this same
 * right, not a separate authorization.
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
 * The manager is always the author: only they may edit or delete the meeting — nobody else,
 * ADMIN included (mirroring [canWriteFeedback]); an admin who is themselves the manager
 * qualifies via the userId check like anyone.
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

/** The cheap (no-DB) read rules: the two parties, at every status. The subordinate's
 *  wider management chain is handled by [requireGoalReadAllowingManager] to keep the DB hit lazy. */
fun canReadGoal(caller: CallerPrincipal, goal: GoalResponse): Boolean {
    if (caller.userId == goal.managerId) return true
    return caller.userId == goal.subordinateId
}

/**
 * Read guard for the single GET / events: the parties pass the cheap rules; the HR auditor
 * reads everything, DRAFTs included (audit-logged); otherwise any manager in the subordinate's
 * transitive management chain (their manager's manager, and so on) may read only once the goal
 * has left DRAFT (ACTIVE/ARCHIVED) — a manager's draft stays private to the pair, matching the
 * team list scope (whose status != DRAFT filter is the same rule, not a separate
 * authorization) and mirroring the delivered-only feedback chain rule.
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
 * The manager is always the author: only they may edit the definition, transition, or delete
 * the goal — nobody else (ADMIN included, mirroring [canWriteFeedback]) has any of that; an
 * admin who is themselves the manager qualifies via the userId check like anyone. The one
 * subordinate write is the ACTIVE progress update, guarded by [requireGoalProgressWrite]
 * instead (v2.8.0).
 */
fun requireGoalWrite(caller: CallerPrincipal, goal: GoalResponse) {
    if (caller.userId != goal.managerId) {
        throw ForbiddenException("Only the goal's manager may modify this goal")
    }
}

/**
 * Progress updates on an ACTIVE goal are a shared right of the pair (v2.8.0): the manager OR
 * the subordinate — the definition/lifecycle stays manager-only via [requireGoalWrite].
 * Nobody else (HR reads only; ADMIN nothing special). The ACTIVE-only rule itself lives in
 * the service (409), like every other status rule.
 */
fun requireGoalProgressWrite(caller: CallerPrincipal, goal: GoalResponse) {
    if (caller.userId != goal.managerId && caller.userId != goal.subordinateId) {
        throw ForbiddenException("Only the goal's manager or subordinate may update its progress")
    }
}

// ── Performance reviews ─────────────────────────────────────────────────────────────────────
// Existence disclosure: like goals, review routes read BEFORE guarding (missing → 404,
// existing-but-forbidden → 403), so an id probe can learn a review exists — never its content.
// The manager is the stored author (the goals model): the direct-report check is create-time
// only, and the author keeps write access even if the subordinate later moves teams.

/**
 * The cheap (no-DB) read rules: the authoring manager at every status; the subordinate only
 * once PUBLISHED — a review in DRAFT or CALIBRATION is invisible to them. The subordinate's
 * wider management chain is handled by [requirePerformanceReviewReadAllowingManager] to keep
 * the DB hit lazy.
 */
fun canReadPerformanceReview(caller: CallerPrincipal, review: PerformanceReviewResponse): Boolean {
    if (caller.userId == review.managerId) return true
    return caller.userId == review.subordinateId &&
        review.status == PerformanceReviewStatus.PUBLISHED
}

/**
 * Read guard for the single GET / events: the parties pass the cheap rules (the subordinate
 * PUBLISHED-only); the HR auditor reads everything, DRAFTs included (audit-logged); otherwise
 * any manager in the subordinate's transitive management chain may read only once the review
 * has left DRAFT (CALIBRATION/PUBLISHED — calibration is exactly the phase upper managers join
 * to compare ratings) — a draft stays private to its author, matching the team list scope
 * (whose status != DRAFT filter is the same rule, not a separate authorization).
 */
suspend fun requirePerformanceReviewReadAllowingManager(
    caller: CallerPrincipal,
    review: PerformanceReviewResponse,
    managesSubordinate: suspend () -> Boolean,
) {
    if (canReadPerformanceReview(caller, review)) return // cheap rules first
    // HR auditor: reads everything — deliberately BEFORE the chain rule, so HR (unlike chain
    // managers) also sees DRAFT reviews. Audit-logged; no DB hit for HR.
    if (grantHrRead(caller, "performanceReview", review.id)) return
    if (review.status != PerformanceReviewStatus.DRAFT && managesSubordinate()) return
    throw ForbiddenException("Caller may not read this performance review")
}

/**
 * The manager is always the author: only they may edit, transition, or delete the review — the
 * subordinate has read rights only, and nobody else (ADMIN included, mirroring
 * [requireGoalWrite]) has any; an admin who is themselves the manager qualifies via the userId
 * check like anyone.
 */
fun requirePerformanceReviewWrite(caller: CallerPrincipal, review: PerformanceReviewResponse) {
    if (caller.userId != review.managerId) {
        throw ForbiddenException("Only the review's manager may modify this performance review")
    }
}

// ── Team KPIs ───────────────────────────────────────────────────────────────────────────────
// Existence disclosure: like goals, KPI routes read BEFORE guarding (missing → 404,
// existing-but-forbidden → 403), so an id probe can learn a KPI exists — never its content.
// The manager in these guards is the team's CURRENT manager (resolved from teams.manager_id
// into the response at read time — never stored on the KPI row), so a reassigned team's new
// manager takes over.

/**
 * Read guard for the single GET / events: the team's current manager reads at every status; the
 * HR auditor reads everything, DRAFTs included (audit-logged); otherwise a current team member,
 * or any manager in the chain ABOVE the team's manager (their manager, transitively), may read
 * only once the KPI has left DRAFT (ACTIVE/ARCHIVED) — a draft stays private to the manager,
 * matching the member list scope (whose status != DRAFT filter is the same rule, not a separate
 * authorization) and mirroring the goal chain rule.
 */
suspend fun requireTeamKpiReadAllowingChain(
    caller: CallerPrincipal,
    kpi: TeamKpiResponse,
    isTeamMember: suspend () -> Boolean,
    managesTeamManager: suspend () -> Boolean,
) {
    if (caller.userId == kpi.managerId) return // the current manager — cheap rule first
    // HR auditor: reads everything — deliberately BEFORE the member/chain rules, so HR (unlike
    // them) also sees DRAFT KPIs. Audit-logged; no DB hit for HR.
    if (grantHrRead(caller, "teamKpi", kpi.id)) return
    if (kpi.status != TeamKpiStatus.DRAFT && (isTeamMember() || managesTeamManager())) return
    throw ForbiddenException("Caller may not read this team KPI")
}

/**
 * The team's CURRENT manager is the only writer: only they may edit, transition, or delete the
 * KPI — members have read rights only, and nobody else (ADMIN included, mirroring
 * [requireGoalWrite]) has any; an admin who is themselves the manager qualifies via the userId
 * check like anyone.
 */
fun requireTeamKpiWrite(caller: CallerPrincipal, kpi: TeamKpiResponse) {
    if (caller.userId != kpi.managerId) {
        throw ForbiddenException("Only the team's manager may modify this team KPI")
    }
}

// ── Days off ────────────────────────────────────────────────────────────────────────────────
// Existence disclosure: like goals, days-off routes read BEFORE guarding (missing → 404,
// existing-but-forbidden → 403), so an id probe can learn a request exists — never its dates
// or owner (ids are sequential; existence is no secret).

/**
 * Read guard for the single GET: the owner reads everything; the HR auditor reads everything
 * (audit-logged); any manager in the owner's transitive management chain reads at every status;
 * a teammate (someone sharing a non-deleted team with the owner) reads only while the request
 * is REQUESTED or ACCEPTED — exactly what the team calendar shows (calendar parity: the record
 * carries no free text, only dates/type/status), so a REJECTED or CANCELLED request stays
 * private to the owner, their chain, and HR.
 */
suspend fun requireDaysOffRead(
    caller: CallerPrincipal,
    request: DaysOffResponse,
    managesOwner: suspend () -> Boolean,
    sharesTeam: suspend () -> Boolean,
) {
    if (caller.userId == request.userId) return // the owner — cheap rule first
    // HR auditor: reads everything, audit-logged. Before the chain walk — no DB hit for HR.
    if (grantHrRead(caller, "daysOff", request.id)) return
    if (managesOwner()) return // DB hit only if needed
    val teammateVisible =
        request.status == DaysOffStatus.REQUESTED || request.status == DaysOffStatus.ACCEPTED
    if (teammateVisible && sharesTeam()) return
    throw ForbiddenException("Caller may not read this days-off request")
}

/**
 * Accept/reject: a CURRENT direct manager of the owner only — never the owner, never a chain
 * manager higher up, and nobody else (ADMIN included, mirroring [requireGoalWrite]); an admin
 * who is themselves a direct manager qualifies via the membership check like anyone.
 */
/**
 * The lifecycle features' create rule (goals / 1:1s / reviews / team KPIs): the author is
 * always the caller — no create-on-behalf, ADMIN included — and the counterpart must be in
 * the required CURRENT relationship (direct report, or managed team) at creation time. The
 * denial message stays per-feature (tests pin the wording); call this BEFORE payload
 * validation so an outsider's malformed request is still 403, not 400.
 */
suspend fun requireDirectReport(isDirectReport: suspend () -> Boolean, denied: String) {
    if (!isDirectReport()) throw ForbiddenException(denied)
}

suspend fun requireDaysOffResolve(caller: CallerPrincipal, isDirectManager: suspend () -> Boolean) {
    if (!isDirectManager()) {
        throw ForbiddenException("Only a direct manager of the requester may resolve a days-off request")
    }
}

/** Cancel: the owner only (the mirror of [requireDaysOffResolve] — managers reject, owners cancel). */
fun requireDaysOffOwner(caller: CallerPrincipal, request: DaysOffResponse) {
    if (caller.userId != request.userId) {
        throw ForbiddenException("Only the requester may cancel their days-off request")
    }
}

/**
 * Reading a user's budget corrections (v1.43.0): the subordinate themselves, the HR auditor
 * (audit-logged), and any manager in the subordinate's transitive chain (which includes every
 * current direct manager). Teammates never qualify — they don't see each other's budgets at
 * all, so calendar parity is untouched; ADMIN-as-such gets nothing.
 */
suspend fun requireDaysOffCorrectionsRead(
    caller: CallerPrincipal,
    targetUserId: UInt,
    managesOwner: suspend () -> Boolean,
) {
    if (caller.userId == targetUserId) return // the subordinate — cheap rule first
    if (grantHrRead(caller, "daysOffCorrections", targetUserId)) return
    if (managesOwner()) return // DB hit only if needed
    throw ForbiddenException("Caller may not read this user's budget corrections")
}

// ── Pulse surveys ───────────────────────────────────────────────────────────────────────────
// Cycle reads are read-before-guard (404 visible), and the team-scoped reads order their
// checks deliberately — 404 → 409-state → 403-identity — so a non-closed cycle answers
// uniformly for every caller, HR included. The routes own the 404/409 steps; these guards are
// the identity step, with the HR-exemption branches (audited `hr.read`) kept in their place
// in the order. See "Pulse surveys" in `.claude/docs/features/pulse-surveys.md`.

/**
 * The participant-only my-response gate (GET and PUT alike): only a member of the cycle's
 * frozen eligibility snapshot may touch their own survey (a user enabled after open is NOT a
 * participant), and even for them the cycle must be OPEN — after close, saved answers are
 * never served again (the anti-copy-paste rule). Identity deliberately precedes state here:
 * a non-participant gets the uniform 403 whatever the cycle's status.
 */
suspend fun requirePulseMyResponse(
    caller: CallerPrincipal,
    status: PulseCycleStatus,
    isParticipant: suspend () -> Boolean,
) {
    if (!isParticipant()) throw ForbiddenException("You are not a participant of this pulse cycle")
    if (status != PulseCycleStatus.OPEN) throw ConflictException("The pulse cycle is not open")
}

/**
 * Team results access (the route has already answered the 404 and the CLOSED-only 409): the
 * HR auditor reads org-wide (audited, resource `pulseResults`, the teamId as an extra field);
 * everyone else — ADMIN included, no role exemption — must pass the per-cycle fill gate (they
 * responded in THIS cycle) and the team must be inside their visible tree.
 */
suspend fun requirePulseResultsAccess(
    caller: CallerPrincipal,
    cycleId: UInt,
    teamId: UInt,
    hasResponded: suspend () -> Boolean,
    visibleTeamIds: suspend () -> Set<UInt>,
) {
    if (caller.isHr()) {
        auditHrRead("pulseResults", cycleId, caller.userId, "teamId" to teamId.toLong())
        return
    }
    // The per-cycle fill gate: no participation, no results, then the team-tree scope.
    if (!hasResponded()) throw ForbiddenException("Results are available only for cycles you took part in")
    if (teamId !in visibleTeamIds()) throw ForbiddenException("The team is outside your visible scope")
}

/**
 * Comments access — a monitoring right, not a results view, so no fill gate applies: managers
 * over their monitored (managed) tree, the HR auditor org-wide (audited, resource
 * `pulseComments`, the teamId as an extra field); a plain member never reads comments.
 */
suspend fun requirePulseMonitorAccess(
    caller: CallerPrincipal,
    cycleId: UInt,
    teamId: UInt,
    monitoredTeamIds: suspend () -> Set<UInt>,
) {
    if (caller.isHr()) {
        auditHrRead("pulseComments", cycleId, caller.userId, "teamId" to teamId.toLong())
        return
    }
    if (teamId !in monitoredTeamIds()) throw ForbiddenException("The team is outside your monitored scope")
}

/**
 * Trend access — team scope as results (visible tree; the HR auditor org-wide, audited,
 * resource `pulseTrend` with the TEAM as the resourceId — the trend spans cycles). The
 * per-cycle fill gate is deliberately NOT here: it applies point-wise in the route (a cycle
 * the caller sat out contributes a gap, not a number).
 */
suspend fun requirePulseTrendAccess(
    caller: CallerPrincipal,
    teamId: UInt,
    visibleTeamIds: suspend () -> Set<UInt>,
) {
    if (caller.isHr()) {
        auditHrRead("pulseTrend", teamId, caller.userId)
        return
    }
    if (teamId !in visibleTeamIds()) throw ForbiddenException("The team is outside your visible scope")
}

