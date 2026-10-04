package ch.nokillswit.perf

import ch.nokillswit.activity.AccountEventService
import ch.nokillswit.daysoff.DaysOffEventService
import ch.nokillswit.daysoff.DaysOffService
import ch.nokillswit.daysoff.PublicHolidayService
import ch.nokillswit.dictionaries.DictionaryService
import ch.nokillswit.feedbacks.FeedbackEventService
import ch.nokillswit.feedbacks.FeedbackService
import ch.nokillswit.goals.GoalEventService
import ch.nokillswit.goals.GoalService
import ch.nokillswit.impactlog.ImpactLogEventService
import ch.nokillswit.impactlog.ImpactLogService
import ch.nokillswit.notifications.NotificationService
import ch.nokillswit.oneonones.OneOnOneEventService
import ch.nokillswit.oneonones.OneOnOneService
import ch.nokillswit.reviews.PerformanceReviewEventService
import ch.nokillswit.pulse.PulseCycleService
import ch.nokillswit.pulse.PulseResponseService
import ch.nokillswit.reviews.PerformanceReviewService
import ch.nokillswit.reviews.ReviewPeriodService
import ch.nokillswit.sharing.ShareService
import ch.nokillswit.succession.SuccessionEventService
import ch.nokillswit.succession.SuccessionPlanService
import ch.nokillswit.teamkpis.TeamKpiEventService
import ch.nokillswit.teamkpis.TeamKpiService
import ch.nokillswit.teams.TeamService
import ch.nokillswit.users.CareerPositionEventService
import ch.nokillswit.users.CareerPositionService
import ch.nokillswit.users.UserService
import org.jetbrains.exposed.v1.core.Table

/**
 * THE registry of what the generator writes — the one list `SeedMain` counts, `PerfSeedSmokeTest`
 * requires a row in, and `PerfSeedCoverageTest` partitions the schema against. A table the generator
 * starts writing is added HERE (and its seeder); a migration that adds a table fails
 * `PerfSeedCoverageTest` until the table is in this list or in [NOT_SEEDED] with a reason.
 *
 * Convention (`.claude/docs/testing.md`, `.claude/docs/performance.md`): a change to a feature's event
 * or notification rules, or a new feature, updates the generator AND bumps [DATASET_VERSION] —
 * baselines only compare within one dataset version.
 */
object Seeded {
    val tables: List<Table> = listOf(
        UserService.Users, UserService.UserRoles, UserService.UserDisabledFeatures,
        TeamService.Teams, TeamService.TeamMembers, DictionaryService.Entries, CareerPositionService.CareerPositions,
        ReviewPeriodService.ReviewPeriods, PerformanceReviewService.Reviews, PerformanceReviewEventService.ReviewEvents,
        OneOnOneService.Meetings, OneOnOneService.Notes, OneOnOneService.ActionItems, OneOnOneEventService.OneOnOneEvents,
        GoalService.Goals, GoalService.Milestones, GoalEventService.GoalEvents,
        FeedbackService.Feedbacks, FeedbackService.FeedbackSubjects, FeedbackEventService.FeedbackEvents,
        NotificationService.Notifications,
        PulseCycleService.PulseCycles, PulseResponseService.PulseParticipants, PulseResponseService.PulseResponses,
        TeamKpiService.TeamKpis, TeamKpiService.TeamKpiValues, TeamKpiEventService.TeamKpiEvents,
        PublicHolidayService.PublicHolidays, DaysOffService.PoolTypes, DaysOffService.Pools, DaysOffService.Requests,
        DaysOffService.Corrections, DaysOffEventService.DaysOffEvents,
        ImpactLogService.Entries, ImpactLogEventService.ImpactLogEvents,
        SuccessionPlanService.Plans, SuccessionPlanService.Nominations, SuccessionPlanService.NominationGoals,
        SuccessionEventService.SuccessionPlanEvents,
        ShareService.DocumentShares, CareerPositionEventService.CareerPositionEvents, AccountEventService.AccountEvents,
    )

    val names: Set<String> = tables.map { it.tableName.lowercase() }.toSet()
}

/*
 * HAND-BUILT SHAPES — the event/notification params the generator writes WITHOUT a production builder, because the
 * builder needs full documents (before/after) or does not exist. Every other event and notification goes through
 * the pure `*Event`/`*Notifications` builders the routes use, so only these can drift from production; the doc
 * owner (`.claude/docs/performance.md`) lists them as the generator's known approximations:
 *
 *   goal_events           PROGRESS_UPDATED{from,to}      (SeedGoals — numeric from/to as strings, + an encrypted comment ~50 %)
 *                         MILESTONE_COMPLETED{position}  (SeedGoals — 1-based position)
 *   performance_review_events
 *                         RATING_CHANGED{category}, SUMMARY_CHANGED{category}  (SeedReviews — category enum name, never a rating value)
 *   one_on_one_events     ACTION_ITEM_RESOLVED{position} (SeedOneOnOnes — 1-based item position)
 *   impact_log_events     UPDATED{changed}               (SeedImpactLog — comma-joined subset of whatHappened,contribution,
 *                                                         whyItMattered,evidence in the builder's stable order; the real
 *                                                         `impactEntryUpdateEvent` needs two full documents)
 *   account_events        SIGNED_IN{mfa:"false"}, SIGNED_OUT{}  (SeedAccountEvents — AccountEventService.insert's own shape)
 *   notifications         TEAM_KPI_VALUE_RECORDED_TO_MEMBER params {date,value}  (SeedTeamKpis — the recorded point's ISO date + value;
 *                         the CORRECTED sibling reuses the real event's params)
 *
 * A change to any of these shapes in the app means updating the generator and bumping DATASET_VERSION.
 */

private const val MIGRATION = "filled by Flyway seeds / defaults — the generator adds nothing"
private const val RUNTIME = "runtime state written by the app while it runs, never part of a dataset"

/**
 * Every `public` table the generator does NOT write, with the reason. `PerfSeedCoverageTest` fails when
 * a table is in neither this map nor [Seeded], when a table is in both, and when an entry names a table
 * that no longer exists.
 */
val NOT_SEEDED: Map<String, String> = mapOf(
    "alerts" to "admin broadcast banners — off every measured screen; a handful of rows in production",
    "app_settings" to "runtime settings K/V (pulse settings); defaults apply",
    "flyway_schema_history" to "Flyway's own bookkeeping",
    "integration_clients" to "admin-managed API-key registry; the integration API is off in the perf stack",
    "login_lockouts" to RUNTIME,
    "mfa_challenges" to RUNTIME,
    "password_reset_requests" to RUNTIME,
    "revoked_tokens" to RUNTIME,
    "templates" to "$MIGRATION (V10/V14 feedback templates)",
    "user_notification_preferences" to "absent row = the defaults; nobody customised them in the dataset",
    "user_teams_identities" to "Teams-resolution cache, written only when the Teams channel sends",
)

/**
 * The columns the `EncryptedAtRest` services register (their `encryptLegacyRows` lists, "Encryption at
 * rest" in `.claude/docs/security.md`), by table. The services keep these lists private, so this is the
 * one hand-maintained mirror; `PerfSeedSmokeTest` holds it honest in both directions — every column the
 * seeded database holds as an `enc:v1:` envelope must be listed here (a newly encrypted column on a
 * seeded feature), every listed column of a seeded table must be present as an envelope after a tiny
 * seed (the generator's cipher path covers it), and `perf/pg/verify.sql` must check every entry.
 */
val ENCRYPTED_COLUMNS: Map<String, List<String>> = mapOf(
    "feedbacks" to listOf("content", "requester_message"),
    "one_on_one_notes" to listOf("content"),
    "one_on_one_action_items" to listOf("content"),
    "goals" to listOf("description", "summary"),
    "goal_milestones" to listOf("description"),
    "goal_events" to listOf("comment"),
    "performance_reviews" to listOf(
        "attitude_rating", "attitude_summary", "delivery_rating", "delivery_summary", "skills_rating",
        "skills_summary", "aptitude_rating", "aptitude_summary", "overall_rating", "overall_summary",
    ),
    "team_kpis" to listOf("description", "summary"),
    "impact_log_entries" to listOf("what_happened", "contribution", "why_it_mattered", "evidence"),
    "succession_plans" to listOf("loss_impact"),
    "succession_nominations" to listOf("competency_gaps"),
    "days_off_corrections" to listOf("comment"),
    "pulse_responses" to listOf("enps", "driver1", "driver2", "driver3", "driver4", "rotating", "comment"),
)
