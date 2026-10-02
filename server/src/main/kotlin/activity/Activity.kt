package ch.nokillswit.activity

import ch.nokillswit.infra.paging.PageResponse
import ch.nokillswit.sharing.ShareableResourceType
import ch.nokillswit.users.Feature
import io.ktor.util.AttributeKey
import kotlinx.serialization.Serializable

val ActivityServiceKey = AttributeKey<ActivityService>("ActivityService")

/**
 * The areas an activity row can belong to (v4.9.0). The seven document areas carry the NAME of
 * their [ShareableResourceType] on purpose, so `area == resourceType` for document rows and the
 * row's `link` comes from the sharing adapter's `viewPath`. [DAYS_OFF] (V88, person-scoped),
 * [CAREER_POSITION] (V89) and [ACCOUNT] are declared from the start (the OpenAPI enum is append-only —
 * API-EVOL); [DAYS_OFF] and [CAREER_POSITION] produce rows (person-scoped), [ACCOUNT] the account's own
 * sign-in history (V90 — owner = actor, retention-purged, no subject person).
 */
@Serializable
enum class ActivityArea {
    FEEDBACK,
    ONE_ON_ONE,
    GOAL,
    TEAM_KPI,
    PERFORMANCE_REVIEW,
    IMPACT_LOG_ENTRY,
    SUCCESSION_PLAN,
    DAYS_OFF,
    CAREER_POSITION,
    ACCOUNT,
}

/** The activity area of a shareable document type — an exhaustive `when`, never name matching. */
val ShareableResourceType.activityArea: ActivityArea
    get() = when (this) {
        ShareableResourceType.FEEDBACK -> ActivityArea.FEEDBACK
        ShareableResourceType.ONE_ON_ONE -> ActivityArea.ONE_ON_ONE
        ShareableResourceType.GOAL -> ActivityArea.GOAL
        ShareableResourceType.TEAM_KPI -> ActivityArea.TEAM_KPI
        ShareableResourceType.PERFORMANCE_REVIEW -> ActivityArea.PERFORMANCE_REVIEW
        ShareableResourceType.IMPACT_LOG_ENTRY -> ActivityArea.IMPACT_LOG_ENTRY
        ShareableResourceType.SUCCESSION_PLAN -> ActivityArea.SUCCESSION_PLAN
        // v4.11.0: a calendar share row rides the person-scoped DAYS_OFF area (no new area).
        ShareableResourceType.DAYS_OFF_CALENDAR -> ActivityArea.DAYS_OFF
    }

/**
 * Areas whose events are keyed on a PERSON (the one whose leave/career was touched), not on a
 * document: the union's `document_id` column then carries that person's id, the entry has no
 * `documentId`/`link`/`details`, and chain visibility is "the owner is the viewer or in the
 * viewer's chain" — the trail is a person-scoped record, so a soft-deleted entry's events are
 * still listed (`ENTRY_DELETED` is the point).
 */
val ActivityArea.isPersonScoped: Boolean
    get() = this == ActivityArea.DAYS_OFF || this == ActivityArea.CAREER_POSITION

/**
 * The sharing type of a document area; null for the areas with nothing shareable. DAYS_OFF is
 * person-scoped for its EVENT rows yet carries the calendar's SHARE rows (v4.11.0) — the
 * `document_id` of such a share row is the person's user id, like the event rows' owner id.
 */
val ActivityArea.shareType: ShareableResourceType?
    get() = when (this) {
        ActivityArea.FEEDBACK -> ShareableResourceType.FEEDBACK
        ActivityArea.ONE_ON_ONE -> ShareableResourceType.ONE_ON_ONE
        ActivityArea.GOAL -> ShareableResourceType.GOAL
        ActivityArea.TEAM_KPI -> ShareableResourceType.TEAM_KPI
        ActivityArea.PERFORMANCE_REVIEW -> ShareableResourceType.PERFORMANCE_REVIEW
        ActivityArea.IMPACT_LOG_ENTRY -> ShareableResourceType.IMPACT_LOG_ENTRY
        ActivityArea.SUCCESSION_PLAN -> ShareableResourceType.SUCCESSION_PLAN
        ActivityArea.DAYS_OFF -> ShareableResourceType.DAYS_OFF_CALENDAR
        ActivityArea.CAREER_POSITION, ActivityArea.ACCOUNT -> null
    }

/**
 * The feature flag gating an area for the VIEWER (a disabled area is omitted from the union, so
 * `total` stays honest): the document areas follow their share type, days-off its own flag,
 * career positions and sign-ins are ungated like the users routes they belong to.
 */
val ActivityArea.feature: Feature?
    get() = when (this) {
        ActivityArea.FEEDBACK -> Feature.FEEDBACKS
        ActivityArea.ONE_ON_ONE -> Feature.ONE_ON_ONES
        ActivityArea.GOAL -> Feature.GOALS
        ActivityArea.TEAM_KPI -> Feature.TEAM_KPIS
        ActivityArea.PERFORMANCE_REVIEW -> Feature.PERFORMANCE_REVIEWS
        ActivityArea.IMPACT_LOG_ENTRY -> Feature.IMPACT_LOG
        ActivityArea.SUCCESSION_PLAN -> Feature.SUCCESSION_PLANS
        ActivityArea.DAYS_OFF -> Feature.DAYS_OFF
        ActivityArea.CAREER_POSITION, ActivityArea.ACCOUNT -> null
    }

/**
 * One line of a person's activity log. [id] is a SYNTHETIC string `<AREA>:<SOURCE>:<id>` — SOURCE
 * `EVENT` for a row of a document's `*_events` trail (id = the event's id), `SHARE` for a share the
 * person created and `SHARE_WITHDRAWAL` for one they withdrew (id = the share's id): a union row
 * has no scalar id, and the string is the stable, unique key a client needs. The log is ordered by
 * the id's components — `createdAt DESC, area, source, id DESC` — a total order (a registered
 * deviation from API-LIST-003, see the known-gaps register).
 *
 * [params] is the content-free map the client localizes: an event row's is the same one the
 * document's own History tab renders (a person-scoped row's — e.g. DAYS_OFF `ENTRY_RECORDED
 * {requestId, type, poolTypeId?, startDate, endDate, days, onBehalf}` — is self-describing: the
 * frozen facts of the action, so such a row needs no `details`); a share row's is `{sharee, expiresOn?}` (+ `byAuthor`,
 * `sharer` on a withdrawal by someone other than the sharer), the names LIVE. [eventType] of a share
 * row is `SHARE_CREATED` / `SHARE_WITHDRAWN`.
 *
 * [details]/[link] are the document's labels and view path. Event rows: the document's CURRENT
 * plaintext labels, null when the VIEWER can no longer read the document in their own right (a
 * self viewer's own row for a document since deleted or made private to them again — the fact
 * that they acted is theirs, the document's current title is not). Share rows: [details] is the
 * share's STORED creation-time snapshot (`ShareResponse.details` keys — e.g. TEAM_KPI
 * `{title, team}`, no `type`), and [link] is always present.
 */
@Serializable
data class ActivityEntry(
    val id: String,
    // Epoch milliseconds — the event's own timestamp.
    val createdAt: Long,
    val area: ActivityArea,
    val eventType: String,
    val params: Map<String, String>,
    // Null for the person-scoped areas (days-off, career positions); always encoded (no default — the wire shape
    // carries explicit nulls like the share list's).
    val documentId: UInt?,
    val link: String?,
    val details: Map<String, String>?,
    // The person a PERSON-scoped row concerns (days-off, career positions) — their id and
    // LIVE display name; null for document rows. The row itself lives in the ACTOR's log.
    val subjectUserId: UInt?,
    val subjectUserName: String?,
)

typealias ActivityPage = PageResponse<ActivityEntry>
