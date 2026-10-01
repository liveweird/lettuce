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
 * row's `link` comes from the sharing adapter's `viewPath`. [DAYS_OFF], [CAREER_POSITION] and
 * [ACCOUNT] are declared from the start (the OpenAPI enum is append-only — API-EVOL) but produce
 * no row until their steps land: the days-off and career trails (V88/V89) and the sign-in trail
 * (V90).
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

/** The sharing type of a document area; null for the person-scoped areas. */
val ActivityArea.shareType: ShareableResourceType?
    get() = when (this) {
        ActivityArea.FEEDBACK -> ShareableResourceType.FEEDBACK
        ActivityArea.ONE_ON_ONE -> ShareableResourceType.ONE_ON_ONE
        ActivityArea.GOAL -> ShareableResourceType.GOAL
        ActivityArea.TEAM_KPI -> ShareableResourceType.TEAM_KPI
        ActivityArea.PERFORMANCE_REVIEW -> ShareableResourceType.PERFORMANCE_REVIEW
        ActivityArea.IMPACT_LOG_ENTRY -> ShareableResourceType.IMPACT_LOG_ENTRY
        ActivityArea.SUCCESSION_PLAN -> ShareableResourceType.SUCCESSION_PLAN
        ActivityArea.DAYS_OFF, ActivityArea.CAREER_POSITION, ActivityArea.ACCOUNT -> null
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
 * One line of a person's activity log. [id] is a SYNTHETIC string `<AREA>:<SOURCE>:<eventId>`
 * (SOURCE `EVENT` for a row of an `*_events` table; the share sources arrive in step 3): a union
 * row has no scalar id, and the string is the stable, unique key a client needs. The log is
 * ordered by the id's components — `createdAt DESC, area, source, eventId DESC` — a total order
 * (a registered deviation from API-LIST-003, see the known-gaps register).
 *
 * [params] is the event's content-free map (the same one the document's own History tab renders),
 * localized client-side. [details]/[link] are the document's label snapshot and view path: null
 * when the VIEWER can no longer read the document in their own right (a self viewer's own row for
 * a document since deleted or made private to them again — the fact that they acted is theirs, the
 * document's current title is not).
 */
@Serializable
data class ActivityEntry(
    val id: String,
    // Epoch milliseconds — the event's own timestamp.
    val createdAt: Long,
    val area: ActivityArea,
    val eventType: String,
    val params: Map<String, String>,
    // Null for the person-scoped areas (later steps); always encoded (no default — the wire shape
    // carries explicit nulls like the share list's).
    val documentId: UInt?,
    val link: String?,
    val details: Map<String, String>?,
)

typealias ActivityPage = PageResponse<ActivityEntry>
