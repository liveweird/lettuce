package ch.nokillswit.dashboard

import ch.nokillswit.authz.caller
import ch.nokillswit.feedbacks.FeedbackListFilter
import ch.nokillswit.feedbacks.FeedbackListView
import ch.nokillswit.feedbacks.FeedbackServiceKey
import ch.nokillswit.feedbacks.FeedbackStatus
import ch.nokillswit.goals.GoalListFilter
import ch.nokillswit.goals.GoalListView
import ch.nokillswit.goals.GoalServiceKey
import ch.nokillswit.goals.GoalStatus
import ch.nokillswit.infra.paging.PageRequest
import ch.nokillswit.infra.paging.SortField
import ch.nokillswit.reviews.PerformanceReviewListFilter
import ch.nokillswit.reviews.PerformanceReviewListView
import ch.nokillswit.reviews.PerformanceReviewServiceKey
import ch.nokillswit.reviews.ReviewPeriodServiceKey
import ch.nokillswit.teams.TeamServiceKey
import io.ktor.http.HttpStatusCode
import io.ktor.resources.Resource
import io.ktor.server.application.Application
import io.ktor.server.auth.authenticate
import io.ktor.server.resources.get
import io.ktor.server.response.respond
import io.ktor.server.routing.routing
import kotlinx.serialization.Serializable

@Serializable
@Resource("/api/v1/dashboard/summary")
class DashboardSummaryResource

/**
 * The caller's at-a-glance numbers for the Dashboard hero tiles. Strictly caller-scoped —
 * every count reuses an existing caller-scoped list scope, so there is no authorization
 * question this endpoint could get wrong. `directReports` doubles as the manager gate
 * (0 = the manager tiles stay hidden) and as the reviews tile's denominator; the
 * current-period fields are null while the review-period timeline doesn't cover today.
 */
@Serializable
data class DashboardSummary(
    /** Active feedback requests waiting for the caller as the provider. */
    val pendingFeedbackRequests: Long,
    /** The caller's own ACTIVE goals. */
    val activeGoals: Long,
    /** Delivered (SENT) feedbacks in the caller's received scope, by SENT moment, last 30 days. */
    val feedbackReceived30d: Long,
    /** Current direct reports of the caller (members of non-deleted teams they manage). */
    val directReports: Int,
    /** The previous 30-day window's received count (days 60–30 ago) — the tile's delta base. */
    val feedbackReceivedPrev30d: Long? = null,
    /** The review period containing today, or null when the timeline doesn't cover it. */
    val currentPeriodId: UInt? = null,
    /** Reviews the caller authored for the current period; null with no current period. */
    val currentPeriodReviewsDone: Long? = null,
)

// The counts only need totals — first row of page 1 is never read.
private val COUNT_ONLY = PageRequest(page = 1, pageSize = 1, sort = listOf(SortField("id", descending = false)))

private const val THIRTY_DAYS_MS = 30L * 24 * 60 * 60 * 1000

fun Application.configureDashboardRoutes() {
    // Composed route-side from the feature services (the /teams/members enrichment idiom) —
    // no dashboard-specific SQL exists; every number is an existing list scope's total or a
    // feature-service count (the received tiles use FeedbackService.receivedSentCount, which
    // reuses the received-scope predicate + the lastSentAtBy SENT-moment rule).
    val feedbackService = attributes[FeedbackServiceKey]
    val goalService = attributes[GoalServiceKey]
    val reviewService = attributes[PerformanceReviewServiceKey]
    val reviewPeriodService = attributes[ReviewPeriodServiceKey]
    val teamService = attributes[TeamServiceKey]

    routing {
        authenticate {
            get<DashboardSummaryResource> {
                val caller = call.caller()
                val pendingRequests = feedbackService.list(
                    FeedbackListView.PROVIDED,
                    caller.userId,
                    FeedbackListFilter(status = FeedbackStatus.REQUESTED),
                    COUNT_ONLY,
                ).total
                // By the actual SENT moment (audit-trail event; pre-V15 fallback lastModified),
                // not lastModified — a later content edit must not re-count a feedback, and the
                // previous-window delta needs the honest boundary.
                val now = System.currentTimeMillis()
                val received30d = feedbackService.receivedSentCount(
                    caller.userId,
                    fromMs = now - THIRTY_DAYS_MS,
                    toMs = now,
                )
                val receivedPrev30d = feedbackService.receivedSentCount(
                    caller.userId,
                    fromMs = now - 2 * THIRTY_DAYS_MS,
                    toMs = now - THIRTY_DAYS_MS,
                )
                val activeGoals = goalService.list(
                    GoalListView.OWN,
                    caller.userId,
                    GoalListFilter(status = GoalStatus.ACTIVE),
                    COUNT_ONLY,
                ).total
                val directReports = teamService.directReportCount(caller.userId)
                val currentPeriod = reviewPeriodService.currentPeriod()
                val reviewsDone = currentPeriod?.let { period ->
                    reviewService.list(
                        PerformanceReviewListView.MANAGED,
                        caller.userId,
                        PerformanceReviewListFilter(periodId = period.id),
                        COUNT_ONLY,
                    ).total
                }
                call.respond(
                    HttpStatusCode.OK,
                    DashboardSummary(
                        pendingFeedbackRequests = pendingRequests,
                        activeGoals = activeGoals,
                        feedbackReceived30d = received30d,
                        directReports = directReports,
                        feedbackReceivedPrev30d = receivedPrev30d,
                        currentPeriodId = currentPeriod?.id,
                        currentPeriodReviewsDone = reviewsDone,
                    ),
                )
            }
        }
    }
}
