package ch.nokillswit

import ch.nokillswit.authz.CallerPrincipal
import ch.nokillswit.authz.ForbiddenException
import ch.nokillswit.authz.canReadFeedback
import ch.nokillswit.authz.canReadFeedbackContent
import ch.nokillswit.authz.canReadGoal
import ch.nokillswit.authz.canReadOneOnOne
import ch.nokillswit.authz.isAdmin
import ch.nokillswit.authz.isHr
import ch.nokillswit.authz.requireAuditListAccess
import ch.nokillswit.authz.requireCanAssignRoles
import ch.nokillswit.authz.requireCanAssignUniqueId
import ch.nokillswit.authz.requireFeatureEnabled
import ch.nokillswit.authz.requireFeedbackReadAllowingManager
import ch.nokillswit.authz.requireGoalReadAllowingManager
import ch.nokillswit.authz.requireOneOnOneReadAllowingManager
import ch.nokillswit.authz.requireUserRead
import ch.nokillswit.goals.GoalResponse
import ch.nokillswit.goals.GoalStatus
import ch.nokillswit.goals.GoalType
import ch.nokillswit.oneonones.OneOnOneResponse
import kotlinx.coroutines.runBlocking
import ch.nokillswit.feedbacks.Feedback
import ch.nokillswit.feedbacks.FeedbackStatus
import ch.nokillswit.feedbacks.FeedbackVisibility
import ch.nokillswit.users.Feature
import ch.nokillswit.users.UserRole
import kotlin.test.Test
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Pure unit tests for the authorization predicates in authz/Guards.kt (no DB / container).
 * The HTTP-level read matrix lives in AuthorizationTest; these pin down the rule edges that
 * are awkward to stage over HTTP (terminal statuses, non-party callers, PUBLIC visibility).
 */
class GuardsTest {

    private val provider = CallerPrincipal(userId = 1u, email = "provider@test", roles = emptySet())
    private val subject = CallerPrincipal(userId = 2u, email = "subject@test", roles = emptySet())
    private val requester = CallerPrincipal(userId = 3u, email = "requester@test", roles = emptySet())
    private val stranger = CallerPrincipal(userId = 9u, email = "stranger@test", roles = emptySet())
    private val admin = CallerPrincipal(userId = 10u, email = "admin@test", roles = setOf(UserRole.ADMIN))
    private val hr = CallerPrincipal(userId = 11u, email = "hr@test", roles = setOf(UserRole.HR))

    private fun feedback(
        status: FeedbackStatus,
        visibility: FeedbackVisibility,
        requesterId: UInt? = null,
    ) = Feedback(
        requesterId = requesterId,
        subjectId = subject.userId,
        providerId = provider.userId,
        visibility = visibility,
        status = status,
    )

    // ── canReadFeedback ────────────────────────────────────────────────────────

    @Test
    fun `the subject may read a withdrawn feedback under a subject-inclusive visibility`() {
        // WITHDRAWN is terminal but stays readable, exactly like SENT.
        assertTrue(canReadFeedback(subject, feedback(FeedbackStatus.WITHDRAWN, FeedbackVisibility.PROVIDER_SUBJECT)))
        assertTrue(
            canReadFeedback(
                subject,
                feedback(FeedbackStatus.WITHDRAWN, FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT, requesterId = 3u),
            )
        )
    }

    @Test
    fun `the subject may not read an unfinished or requester-only feedback`() {
        // Unfinished: DRAFT content is the provider's private work in progress.
        assertFalse(canReadFeedback(subject, feedback(FeedbackStatus.DRAFT, FeedbackVisibility.PROVIDER_SUBJECT)))
        // PROVIDER_REQUESTER excludes the subject even once delivered.
        assertFalse(
            canReadFeedback(
                subject,
                feedback(FeedbackStatus.SENT, FeedbackVisibility.PROVIDER_REQUESTER, requesterId = 3u),
            )
        )
    }

    @Test
    fun `anyone may read a public feedback once sent`() {
        assertTrue(canReadFeedback(stranger, feedback(FeedbackStatus.SENT, FeedbackVisibility.PUBLIC)))
    }

    @Test
    fun `a public feedback is hidden from non-parties until sent and after withdrawal`() {
        assertFalse(canReadFeedback(stranger, feedback(FeedbackStatus.DRAFT, FeedbackVisibility.PUBLIC)))
        assertFalse(canReadFeedback(stranger, feedback(FeedbackStatus.WITHDRAWN, FeedbackVisibility.PUBLIC)))
    }

    @Test
    fun `a non-public sent feedback is not readable by a non-party`() {
        assertFalse(
            canReadFeedback(
                stranger,
                feedback(FeedbackStatus.SENT, FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT, requesterId = 3u),
            )
        )
    }

    @Test
    fun `the requester may watch any status under a requester-inclusive visibility but not under public`() {
        // Requester-inclusive visibilities grant the requester read at any status.
        assertTrue(
            canReadFeedback(
                requester,
                feedback(FeedbackStatus.DRAFT, FeedbackVisibility.PROVIDER_REQUESTER, requesterId = requester.userId),
            )
        )
        // PUBLIC is not in the requester's visibility set: before it is sent, a requester
        // watching a PUBLIC feedback is denied like anyone else (default deny).
        assertFalse(
            canReadFeedback(
                requester,
                feedback(FeedbackStatus.DRAFT, FeedbackVisibility.PUBLIC, requesterId = requester.userId),
            )
        )
    }

    @Test
    fun `only the provider reads a hidden draft - admin is an ordinary non-party now`() {
        val hidden = feedback(FeedbackStatus.DRAFT, FeedbackVisibility.PROVIDER_SUBJECT)
        assertTrue(canReadFeedback(provider, hidden))
        // ADMIN is a management role: no special feedback read (PUBLIC+SENT still applies).
        assertFalse(canReadFeedback(admin, hidden))
        assertTrue(canReadFeedback(admin, feedback(FeedbackStatus.SENT, FeedbackVisibility.PUBLIC)))
    }

    // ── canReadFeedbackContent ─────────────────────────────────────────────────

    @Test
    fun `content of an unfinished feedback is hidden from its requester but not from other readers`() {
        val draft = feedback(FeedbackStatus.DRAFT, FeedbackVisibility.PROVIDER_REQUESTER, requesterId = requester.userId)
        val requested = feedback(
            FeedbackStatus.REQUESTED,
            FeedbackVisibility.PROVIDER_REQUESTER,
            requesterId = requester.userId,
        )
        assertFalse(canReadFeedbackContent(requester, draft))
        assertFalse(canReadFeedbackContent(requester, requested))
        // A reader who is not the requester (e.g. a managing caller) still sees the content —
        // the admin case is the same generic non-requester rule, not a privilege.
        assertTrue(canReadFeedbackContent(stranger, draft))
        assertTrue(canReadFeedbackContent(admin, draft))
        assertTrue(canReadFeedbackContent(provider, draft))
    }

    @Test
    fun `content of a delivered feedback is visible to its requester`() {
        val sent = feedback(FeedbackStatus.SENT, FeedbackVisibility.PROVIDER_REQUESTER, requesterId = requester.userId)
        assertTrue(canReadFeedbackContent(requester, sent))
    }

    // ── requireCanAssignRoles ──────────────────────────────────────────────────

    @Test
    fun `resubmitting or omitting the current roles set is not a roles change`() {
        // A non-admin resubmitting their unchanged roles must not trip the guard.
        requireCanAssignRoles(subject, current = emptySet(), requested = emptySet())
        requireCanAssignRoles(subject, current = emptySet(), requested = null)
        requireCanAssignRoles(subject, current = setOf(UserRole.ADMIN), requested = setOf(UserRole.ADMIN))
    }

    @Test
    fun `only an admin may change the roles set`() {
        assertFailsWith<ForbiddenException> {
            requireCanAssignRoles(subject, current = emptySet(), requested = setOf(UserRole.ADMIN))
        }
        assertFailsWith<ForbiddenException> {
            // Dropping a role is a change too, admin-only like granting one.
            requireCanAssignRoles(subject, current = setOf(UserRole.ADMIN), requested = emptySet())
        }
        requireCanAssignRoles(admin, current = emptySet(), requested = setOf(UserRole.ADMIN))
    }

    // ── requireCanAssignUniqueId (V59) ─────────────────────────────────────────

    @Test
    fun `unique id changes are admin-only - null or the current value is not a change`() {
        // A non-admin omitting the field or resubmitting the current value must pass.
        requireCanAssignUniqueId(subject, requested = null, current = null)
        requireCanAssignUniqueId(subject, requested = null, current = "EMP-1")
        requireCanAssignUniqueId(subject, requested = "EMP-1", current = "EMP-1")
        // Assigning or changing is admin-only.
        assertFailsWith<ForbiddenException> {
            requireCanAssignUniqueId(subject, requested = "EMP-1", current = null)
        }
        assertFailsWith<ForbiddenException> {
            requireCanAssignUniqueId(subject, requested = "EMP-2", current = "EMP-1")
        }
        requireCanAssignUniqueId(admin, requested = "EMP-2", current = "EMP-1")
    }

    // ── requireFeatureEnabled (per-user feature flags, V46) ────────────────────

    @Test
    fun `requireFeatureEnabled passes an empty or non-matching disabled set and blocks a match`() {
        // The default (no claim / nothing disabled) always passes.
        requireFeatureEnabled(stranger, Feature.GOALS)
        val gated = CallerPrincipal(
            userId = 12u,
            email = "gated@test",
            roles = setOf(UserRole.ADMIN),
            disabledFeatures = setOf(Feature.GOALS, Feature.DAYS_OFF),
        )
        requireFeatureEnabled(gated, Feature.FEEDBACKS)
        // Uniform: roles grant no bypass — this caller is an ADMIN.
        assertFailsWith<ForbiddenException> { requireFeatureEnabled(gated, Feature.GOALS) }
        assertFailsWith<ForbiddenException> { requireFeatureEnabled(gated, Feature.DAYS_OFF) }
    }

    // ── isAdmin / isHr ─────────────────────────────────────────────────────────

    @Test
    fun `isAdmin means the ADMIN role is in the caller's set`() {
        assertFalse(stranger.isAdmin())
        assertTrue(admin.isAdmin())
        assertFalse(hr.isAdmin())
    }

    @Test
    fun `isHr covers exactly the HR role`() {
        assertTrue(hr.isHr())
        assertFalse(admin.isHr())
        assertFalse(stranger.isHr())
    }

    @Test
    fun `admin has no special read on one-on-ones, goals, or others' notifications`() {
        assertFalse(canReadOneOnOne(admin, meeting()))
        assertFalse(canReadGoal(admin, goal(GoalStatus.ACTIVE)))
        assertFailsWith<ForbiddenException> {
            ch.nokillswit.authz.requireNotificationRecipient(admin, subject.userId)
        }
    }

    // ── HR auditor reads ───────────────────────────────────────────────────────

    /** A chain lambda that must never run: HR/party reads settle before the DB walk. */
    private val neverWalkChain: suspend () -> Boolean = { throw AssertionError("chain walk must not run") }

    private fun meeting(id: UInt = 40u) = OneOnOneResponse(
        id = id,
        managerId = provider.userId,
        managerName = "Manager",
        subordinateId = subject.userId,
        subordinateName = "Subordinate",
        meetingDate = "2026-07-01",
        lastModified = 0,
        points = emptyList(),
        decisions = emptyList(),
        actionItems = emptyList(),
    )

    private fun goal(status: GoalStatus, id: UInt = 50u) = GoalResponse(
        id = id,
        managerId = provider.userId,
        subordinateId = subject.userId,
        createdAt = 0,
        dueDate = "2027-01-01",
        title = "Goal",
        description = "",
        type = GoalType.PLAN,
        targetValue = null,
        currentValue = null,
        milestones = emptyList(),
        status = status,
        summary = null,
        lastModified = 0,
        managerName = "Manager",
        subordinateName = "Subordinate",
    )

    @Test
    fun `hr reads any feedback at any status without the chain walk`() {
        runBlocking {
            // DRAFT with a private visibility — nobody but the provider (and ADMIN) could read it.
            val draft = feedback(FeedbackStatus.DRAFT, FeedbackVisibility.PROVIDER_SUBJECT)
            requireFeedbackReadAllowingManager(hr, draft, feedbackId = 30u, managesSubject = neverWalkChain)
            // A plain stranger still cannot (chain walk allowed to run and say no).
            assertFailsWith<ForbiddenException> {
                requireFeedbackReadAllowingManager(stranger, draft, feedbackId = 30u) { false }
            }
        }
    }

    @Test
    fun `hr reads any one-on-one without the chain walk`() {
        runBlocking {
            requireOneOnOneReadAllowingManager(hr, meeting(), managesSubordinate = neverWalkChain)
            assertFailsWith<ForbiddenException> {
                requireOneOnOneReadAllowingManager(stranger, meeting()) { false }
            }
        }
    }

    @Test
    fun `hr reads goals at every status including DRAFT, chain managers still do not see drafts`() {
        runBlocking {
            requireGoalReadAllowingManager(hr, goal(GoalStatus.DRAFT), managesSubordinate = neverWalkChain)
            requireGoalReadAllowingManager(hr, goal(GoalStatus.ACTIVE), managesSubordinate = neverWalkChain)
            // A chain manager (managesSubordinate = true) is still shut out of a DRAFT.
            assertFailsWith<ForbiddenException> {
                requireGoalReadAllowingManager(stranger, goal(GoalStatus.DRAFT)) { true }
            }
        }
    }

    @Test
    fun `hr sees feedback content everywhere, even as a watching requester would not`() {
        val draft = feedback(FeedbackStatus.DRAFT, FeedbackVisibility.PROVIDER_REQUESTER, requesterId = requester.userId)
        assertTrue(canReadFeedbackContent(hr, draft))
    }

    @Test
    fun `requireUserRead grants self, admin, and hr - denies everyone else`() {
        requireUserRead(subject, subject.userId)
        requireUserRead(admin, subject.userId)
        requireUserRead(hr, subject.userId)
        assertFailsWith<ForbiddenException> { requireUserRead(stranger, subject.userId) }
    }

    @Test
    fun `requireAuditListAccess admits hr only`() {
        requireAuditListAccess(hr, "goal", subject.userId)
        assertFailsWith<ForbiddenException> { requireAuditListAccess(admin, "goal", subject.userId) }
        assertFailsWith<ForbiddenException> { requireAuditListAccess(stranger, "goal", subject.userId) }
    }

    @Test
    fun `hr gains no write access anywhere`() {
        // The write guards are userId-keyed; HR (not a party) must fail all of them.
        val sent = feedback(FeedbackStatus.SENT, FeedbackVisibility.PUBLIC)
        assertFailsWith<ForbiddenException> { ch.nokillswit.authz.requireFeedbackWrite(hr, sent) }
        assertFailsWith<ForbiddenException> { ch.nokillswit.authz.requireOneOnOneWrite(hr, meeting()) }
        assertFailsWith<ForbiddenException> { ch.nokillswit.authz.requireGoalWrite(hr, goal(GoalStatus.ACTIVE)) }
        assertFailsWith<ForbiddenException> {
            ch.nokillswit.authz.requireGoalProgressWrite(hr, goal(GoalStatus.ACTIVE))
        }
        assertFailsWith<ForbiddenException> { ch.nokillswit.authz.requireAdmin(hr) }
        assertFailsWith<ForbiddenException> {
            requireCanAssignRoles(hr, current = emptySet(), requested = setOf(UserRole.ADMIN))
        }
    }

    @Test
    fun `goal progress write is the pair's shared right - definition write stays manager-only`() {
        val active = goal(GoalStatus.ACTIVE)
        // Both parties may update progress (v2.8.0); nobody else — ADMIN included.
        ch.nokillswit.authz.requireGoalProgressWrite(provider, active) // the manager
        ch.nokillswit.authz.requireGoalProgressWrite(subject, active) // the subordinate
        assertFailsWith<ForbiddenException> { ch.nokillswit.authz.requireGoalProgressWrite(stranger, active) }
        assertFailsWith<ForbiddenException> { ch.nokillswit.authz.requireGoalProgressWrite(admin, active) }
        // The general write guard is untouched: the subordinate still cannot use it.
        assertFailsWith<ForbiddenException> { ch.nokillswit.authz.requireGoalWrite(subject, active) }
    }

    @Test
    fun `career position writes are the transitive chain's alone`() {
        runBlocking {
            // The guard is a pure gate over the chain check — role never matters (v2.15.0:
            // ADMIN and HR are deliberately in the shut-out set; only the chain answer counts).
            ch.nokillswit.authz.requireCareerPositionWrite(stranger) { true }
            assertFailsWith<ForbiddenException> {
                ch.nokillswit.authz.requireCareerPositionWrite(stranger) { false }
            }
            assertFailsWith<ForbiddenException> {
                ch.nokillswit.authz.requireCareerPositionWrite(admin) { false }
            }
            assertFailsWith<ForbiddenException> {
                ch.nokillswit.authz.requireCareerPositionWrite(hr) { false }
            }
        }
    }

    @Test
    fun `career position reads admit self, the chain, and hr - admin and strangers are shut out`() {
        runBlocking {
            // v2.25.0 (the seniority-privacy round): the read mirror of the write guard,
            // widened by self and HR. HR passes BEFORE the chain lambda (no DB hit); ADMIN
            // deliberately gets nothing (the narrowed-ADMIN rule).
            ch.nokillswit.authz.requireCareerPositionRead(stranger, stranger.userId) { false } // self
            ch.nokillswit.authz.requireCareerPositionRead(stranger, 1u) { true } // chain
            ch.nokillswit.authz.requireCareerPositionRead(hr, 1u) { error("HR must not walk the chain") }
            assertFailsWith<ForbiddenException> {
                ch.nokillswit.authz.requireCareerPositionRead(stranger, 1u) { false }
            }
            assertFailsWith<ForbiddenException> {
                ch.nokillswit.authz.requireCareerPositionRead(admin, 1u) { false }
            }
        }
    }

    // ── impact log ─────────────────────────────────────────────────────────────

    private fun impactEntry(ownerId: UInt) = ch.nokillswit.impactlog.ImpactEntryResponse(
        id = 42u,
        userId = ownerId,
        userName = "Olga Owner",
        periodStart = "2026-07-01",
        periodEnd = "2026-07-31",
        whatHappened = "w",
        contribution = "c",
        whyItMattered = "y",
        evidence = "e",
        createdAt = 1L,
        lastModified = 1L,
    )

    @Test
    fun `impact entry reads admit the owner, the chain, and hr - admin and strangers are shut out`() {
        runBlocking {
            val entry = impactEntry(ownerId = subject.userId)
            // Owner passes without the chain walk; HR passes BEFORE the lambda (no DB hit).
            ch.nokillswit.authz.requireImpactEntryRead(subject, entry) { error("owner must not walk the chain") }
            ch.nokillswit.authz.requireImpactEntryRead(hr, entry) { error("HR must not walk the chain") }
            ch.nokillswit.authz.requireImpactEntryRead(stranger, entry) { true } // chain manager
            assertFailsWith<ForbiddenException> {
                ch.nokillswit.authz.requireImpactEntryRead(stranger, entry) { false }
            }
            // ADMIN deliberately gets nothing (the narrowed-ADMIN rule).
            assertFailsWith<ForbiddenException> {
                ch.nokillswit.authz.requireImpactEntryRead(admin, entry) { false }
            }
        }
    }

    @Test
    fun `impact entry writes are owner-only - the chain read right carries no pen`() {
        val entry = impactEntry(ownerId = subject.userId)
        ch.nokillswit.authz.requireImpactEntryWrite(subject, entry)
        assertFailsWith<ForbiddenException> { ch.nokillswit.authz.requireImpactEntryWrite(stranger, entry) }
        assertFailsWith<ForbiddenException> { ch.nokillswit.authz.requireImpactEntryWrite(admin, entry) }
        assertFailsWith<ForbiddenException> { ch.nokillswit.authz.requireImpactEntryWrite(hr, entry) }
    }
}
