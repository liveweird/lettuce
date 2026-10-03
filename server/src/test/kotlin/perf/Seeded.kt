package ch.nokillswit.perf

import ch.nokillswit.dictionaries.DictionaryService
import ch.nokillswit.feedbacks.FeedbackEventService
import ch.nokillswit.feedbacks.FeedbackService
import ch.nokillswit.goals.GoalEventService
import ch.nokillswit.goals.GoalService
import ch.nokillswit.notifications.NotificationService
import ch.nokillswit.oneonones.OneOnOneEventService
import ch.nokillswit.oneonones.OneOnOneService
import ch.nokillswit.reviews.PerformanceReviewEventService
import ch.nokillswit.reviews.PerformanceReviewService
import ch.nokillswit.reviews.ReviewPeriodService
import ch.nokillswit.teams.TeamService
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
    )

    val names: Set<String> = tables.map { it.tableName.lowercase() }.toSet()
}

private const val M2 = "not seeded in M1 — the plan's M2 step 7 (move it to Seeded.tables with its seeder)"
private const val RUNTIME = "runtime state written by the app while it runs, never part of a dataset"
private const val MIGRATION = "filled by Flyway seeds / defaults — the generator adds nothing"

/**
 * Every `public` table the generator does NOT write, with the reason. `PerfSeedCoverageTest` fails when
 * a table is in neither this map nor [Seeded], when a table is in both, and when an entry names a table
 * that no longer exists.
 */
val NOT_SEEDED: Map<String, String> = mapOf(
    "account_events" to "$M2 (sign-in history, 90-day retention)",
    "alerts" to "admin broadcast banners — off every measured screen; a handful of rows in production",
    "app_settings" to "runtime settings K/V (pulse settings); defaults apply",
    "career_position_events" to "$M2 (V89 person-keyed trail)",
    "days_off_corrections" to M2,
    "days_off_events" to "$M2 (V88 person-keyed trail)",
    "days_off_pool_types" to "$MIGRATION (V74 default pool kind); M2 adds an extra kind",
    "days_off_pools" to M2,
    "days_off_requests" to M2,
    "document_shares" to M2,
    "flyway_schema_history" to "Flyway's own bookkeeping",
    "impact_log_entries" to M2,
    "impact_log_events" to M2,
    "integration_clients" to "admin-managed API-key registry; the integration API is off in the perf stack",
    "login_lockouts" to RUNTIME,
    "mfa_challenges" to RUNTIME,
    "password_reset_requests" to RUNTIME,
    "public_holidays" to "$MIGRATION (V41 Polish holidays); M2 extends them over the five years",
    "pulse_cycles" to M2,
    "pulse_participants" to M2,
    "pulse_responses" to M2,
    "revoked_tokens" to RUNTIME,
    "succession_nomination_goals" to M2,
    "succession_nominations" to M2,
    "succession_plan_events" to M2,
    "succession_plans" to M2,
    "team_kpi_events" to M2,
    "team_kpi_values" to M2,
    "team_kpis" to M2,
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
    // not seeded yet (M2) — verify.sql already checks them so the M2 generator is held to the same rule
    "team_kpis" to listOf("description", "summary"),
    "impact_log_entries" to listOf("what_happened", "contribution", "why_it_mattered", "evidence"),
    "succession_plans" to listOf("loss_impact"),
    "succession_nominations" to listOf("competency_gaps"),
    "days_off_corrections" to listOf("comment"),
    "pulse_responses" to listOf("enps", "driver1", "driver2", "driver3", "driver4", "rotating", "comment"),
)
