package ch.nokillswit.activity

import ch.nokillswit.feedbacks.FeedbackEventService.FeedbackEvents
import ch.nokillswit.feedbacks.FeedbackService.FeedbackSubjects
import ch.nokillswit.feedbacks.FeedbackService.Feedbacks
import ch.nokillswit.goals.GoalEventService.GoalEvents
import ch.nokillswit.goals.GoalService.Goals
import ch.nokillswit.impactlog.ImpactLogEventService.ImpactLogEvents
import ch.nokillswit.impactlog.ImpactLogService.Entries
import ch.nokillswit.infra.db.EventLogTable
import ch.nokillswit.infra.db.decodeParams
import ch.nokillswit.infra.paging.PageRequest
import ch.nokillswit.infra.paging.applyPaging
import ch.nokillswit.oneonones.OneOnOneEventService.OneOnOneEvents
import ch.nokillswit.oneonones.OneOnOneService.Meetings
import ch.nokillswit.reviews.PerformanceReviewEventService.ReviewEvents
import ch.nokillswit.reviews.PerformanceReviewService.Reviews
import ch.nokillswit.reviews.ReviewPeriodService.ReviewPeriods
import ch.nokillswit.sharing.ShareRegistry
import ch.nokillswit.sharing.ShareService.DocumentShares
import ch.nokillswit.sharing.ShareableResourceType
import ch.nokillswit.succession.SuccessionEventService.SuccessionPlanEvents
import ch.nokillswit.succession.SuccessionPlanService.Plans
import ch.nokillswit.teamkpis.TeamKpiEventService.TeamKpiEvents
import ch.nokillswit.teamkpis.TeamKpiService.TeamKpis
import ch.nokillswit.teams.TeamService.Teams
import ch.nokillswit.teams.isInManagementChain
import ch.nokillswit.teams.transitiveSubordinateIds
import ch.nokillswit.users.Feature
import ch.nokillswit.users.UserService.Users
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.core.dao.id.EntityID
import org.jetbrains.exposed.v1.core.dao.id.IdTable
import org.jetbrains.exposed.v1.r2dbc.Query
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase
import org.jetbrains.exposed.v1.r2dbc.SetOperation
import org.jetbrains.exposed.v1.r2dbc.select
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import org.jetbrains.exposed.v1.r2dbc.unionAll

/**
 * How much of the target's log the VIEWER may see, decided by the route's guard
 * (`requireActivityRead`) and consumed here.
 *
 * - [OWN_RIGHT] — the self viewer: EVERY row of their own log is listed, but `details`/`link` are
 *   null when they can no longer read the document in their own right (the fact that they acted
 *   is theirs; the document's current title is not).
 * - [EVERYTHING] — the HR auditor (and HR reading their own log): every row, labels and links
 *   always present (a deleted document's link answers 404 — the share-list precedent).
 *
 * - [CHAIN] — a manager in the target's transitive management chain: an EVENT row is listed ONLY
 *   when the document is one the viewer can currently read in their OWN right (hide, never redact —
 *   a hidden row is not counted either, so `total` is exact). The predicate is the document's
 *   `ActivityVisibility.readable` builder applied as the WHERE of each event branch (the branch
 *   joins the parent document); hydrated rows therefore always carry their labels and link. A SHARE
 *   row (created or withdrawn) is listed only when the viewer is the document's AUTHOR and the
 *   document is not soft-deleted (`ActivityVisibility.authoredShares`, the `view=document` rule —
 *   the subject and a non-author manager never learn of a share). Share-granted reads and the
 *   days-off teammate grant are deliberately NOT consulted: a share is a single-document read, not
 *   a list scope, and a teammate's calendar parity is not a reason to list a colleague's actions.
 */
enum class ActivityScope { OWN_RIGHT, EVERYTHING, CHAIN }

/** The viewer: who they are (for the own-right projection), their disabled areas, and their scope. */
data class ActivityViewer(val userId: UInt, val disabledFeatures: Set<Feature>, val scope: ActivityScope)

/** The list filters — `area` equality and the inclusive epoch-millisecond bounds on `createdAt`. */
data class ActivityFilter(
    val area: ActivityArea? = null,
    val createdAtGte: Long? = null,
    val createdAtLte: Long? = null,
)

data class ActivityListResult(val items: List<ActivityEntry>, val total: Long)

/** The two `document_shares` sources of the log (step 3): a share the person created, and one they withdrew. */
private enum class ShareKind(val source: String, val eventType: String) {
    CREATED("SHARE", "SHARE_CREATED"),
    WITHDRAWN("SHARE_WITHDRAWAL", "SHARE_WITHDRAWN"),
}

/** The synthetic id's SOURCE component and the union's sort position (`createdAt DESC, area, source, eventId DESC`). */
private const val SOURCE_EVENT = "EVENT"

private val actorLabelUsers = Users.alias("act_user_a")
private val partnerLabelUsers = Users.alias("act_user_b")

/**
 * One `*_events` table feeding the union, with the area its rows belong to and the [parent]
 * document table the chain-mode predicate reads (team KPIs additionally join `teams`: the KPI's
 * current manager is `teams.manager_id`, never stored on the KPI).
 */
private class EventSource(val area: ActivityArea, val table: EventLogTable, val parent: IdTable<UInt>) {
    fun joinedToParent(): ColumnSet {
        val withParent = table.join(parent, JoinType.INNER, onColumn = table.ownerId, otherColumn = parent.id)
        return if (area == ActivityArea.TEAM_KPI) {
            withParent.join(Teams, JoinType.INNER, onColumn = TeamKpis.teamId, otherColumn = Teams.id)
        } else {
            withParent
        }
    }
}

/** The chain viewer's own-right filter: [viewer] and their transitive subordinates ([chain]). */
private class ChainFilter(val viewer: UInt, val chain: Set<UInt>)

/** The seven document event trails — the rows of this step. Order is irrelevant (the union is sorted). */
private val EVENT_SOURCES = listOf(
    EventSource(ActivityArea.FEEDBACK, FeedbackEvents, Feedbacks),
    EventSource(ActivityArea.ONE_ON_ONE, OneOnOneEvents, Meetings),
    EventSource(ActivityArea.GOAL, GoalEvents, Goals),
    EventSource(ActivityArea.TEAM_KPI, TeamKpiEvents, TeamKpis),
    EventSource(ActivityArea.PERFORMANCE_REVIEW, ReviewEvents, Reviews),
    EventSource(ActivityArea.IMPACT_LOG_ENTRY, ImpactLogEvents, Entries),
    EventSource(ActivityArea.SUCCESSION_PLAN, SuccessionPlanEvents, Plans),
)

/** How the hydration phase decides `readable` for a document. */
private sealed interface Readability {
    data object Everything : Readability
    class OwnRight(val viewer: UInt, val chain: Set<UInt>) : Readability
}

/** What the hydration phase learned about one document. */
private class DocFacts(val details: Map<String, String>, val readable: Boolean)

/** What the hydration phase learned about one share (names resolved, the creation-time label snapshot). */
private class ShareFacts(
    val sharerId: UInt,
    val sharerName: String,
    val shareeName: String,
    val expiresOn: String?,
    val withdrawnBy: UInt?,
    val details: Map<String, String>?,
)

/** The union's row, before hydration. */
private class UnionRow(
    val area: ActivityArea,
    val source: String,
    val eventId: UInt,
    val documentId: UInt,
    val createdAt: Long,
    val eventType: String,
    val params: String,
)

/**
 * The per-user activity log (v4.9.0): a chronological "what did this person do" read model built
 * at QUERY TIME as a `UNION ALL` over the seven per-document `*_events` tables (one branch each) and
 * the two `document_shares` sources (shares the person created / withdrew), filtered on the ACTING
 * user — no new table, no dual write, nothing to drift (`.claude/docs/features/activity-log.md`).
 *
 * Two phases inside ONE transaction (so `total` and the rows agree — API-LIST-002): the ordered,
 * paged union of 7-column tuples (cheap — the V87 `(user_id, created_at)` indexes make each branch
 * a range scan), then a set-at-a-time hydration of the ≤100 page rows: one label query per area
 * present for event rows (plaintext title/party columns only — never a decrypt; for the self viewer
 * also the own-right `readable` projection, `ActivityVisibility`), and one `document_shares` join
 * for share rows (names live, `details` the stored snapshot). The viewer's disabled areas are
 * simply not added to the union, so `total` stays honest.
 *
 * The goal progress comment and every other encrypted column are NEVER read here: the union
 * carries only `eventType` + the content-free `params` map, like the document's own History tab.
 */
class ActivityService(
    private val database: R2dbcDatabase,
    private val registry: ShareRegistry,
) {
    /** True iff [managerId] is in [userId]'s transitive management chain (the chain-viewer gate). */
    suspend fun managesUser(managerId: UInt, userId: UInt): Boolean =
        suspendTransaction(database) { isInManagementChain(managerId, userId) }

    suspend fun list(
        targetUserId: UInt,
        viewer: ActivityViewer,
        filter: ActivityFilter,
        paging: PageRequest,
    ): ActivityListResult {
        val sources = EVENT_SOURCES.filter { source ->
            (filter.area == null || filter.area == source.area) && source.area.feature !in viewer.disabledFeatures
        }
        // Shares ride the document's area: the enabled, filter-matching types, by enum name (the
        // open-set rule — a stored type this build does not know is never in this list).
        val shareTypes = ActivityArea.entries
            .filter {
                it.shareType != null && (filter.area == null || filter.area == it) &&
                    it.feature !in viewer.disabledFeatures
            }
            .map { it.shareType!!.name }
        if (sources.isEmpty() && shareTypes.isEmpty()) return ActivityListResult(emptyList(), 0)
        return suspendTransaction(database) {
            // Chain mode: the viewer's transitive subordinates, computed ONCE and bound as one array
            // per predicate use (never a placeholder per id).
            val chainFilter = if (viewer.scope == ActivityScope.CHAIN) {
                ChainFilter(viewer.userId, transitiveSubordinateIds(viewer.userId))
            } else {
                null
            }
            // Each branch can also build its own contradiction (`matching = false`) — see [unionOf].
            val specs: List<(Boolean) -> Query> =
                sources.map { source -> { matching: Boolean -> branch(source, targetUserId, filter, chainFilter, matching) } } +
                    if (shareTypes.isEmpty()) {
                        emptyList()
                    } else {
                        ShareKind.entries.map { kind ->
                            { matching: Boolean -> shareBranch(kind, targetUserId, filter, shareTypes, chainFilter, matching) }
                        }
                    }
            val projection = Projection(specs.first()(true))
            val union = unionOf(specs)
            val total = union.count()
            // The tiebreak flips WITH the createdAt direction, so ascending is the exact reverse of
            // the default order (the whole composite key reverses, not just its first component).
            val descending = paging.sort.firstOrNull { it.name == "createdAt" }?.descending ?: true
            val forward = if (descending) SortOrder.ASC else SortOrder.DESC
            val backward = if (descending) SortOrder.DESC else SortOrder.ASC
            val rows = union
                .applyPaging(
                    paging,
                    mapOf("createdAt" to projection.createdAt),
                    tiebreak = listOf(
                        projection.area to forward,
                        projection.source to forward,
                        projection.eventId to backward,
                    ),
                )
                .map { projection.read(it) }
                .toList()
            ActivityListResult(hydrate(rows, viewer), total)
        }
    }

    /** One `*_events` table → the 7-column tuple, restricted to the actor and the time window. */
    private fun branch(
        source: EventSource,
        targetUserId: UInt,
        filter: ActivityFilter,
        chainFilter: ChainFilter?,
        matching: Boolean = true,
    ): Query {
        val table = source.table
        val from: ColumnSet = if (chainFilter == null) table else source.joinedToParent()
        return from.select(
            stringLiteral(source.area.name).alias("area"),
            stringLiteral(SOURCE_EVENT).alias("source"),
            table.id.alias("event_id"),
            table.ownerId.alias("document_id"),
            table.timestamp.alias("created_at"),
            table.eventType.alias("event_type"),
            table.params.alias("params"),
        ).where {
            var op: Op<Boolean> = if (matching) table.userId eq targetUserId else Op.FALSE
            filter.createdAtGte?.let { op = op and (table.timestamp greaterEq it) }
            filter.createdAtLte?.let { op = op and (table.timestamp lessEq it) }
            if (chainFilter != null) {
                op = op and ActivityVisibility.readable(source.area, chainFilter.viewer, chainFilter.chain)
            }
            op
        }
    }

    /**
     * One `document_shares` source → the same 7-column tuple. The AREA is the row's own
     * `resource_type` (restricted to the enabled, known [shareTypes]); the actor is the SHARER for
     * [ShareKind.CREATED] and the WITHDRAWER for [ShareKind.WITHDRAWN] (actor-only — an author who
     * withdraws a report's share has the row in THEIR log). The event id is the share's id; the
     * params column carries nothing (`{}`) — the sharee/expiry facts are resolved in hydration.
     * A chain viewer only gets the rows of documents they AUTHOR (the `view=document` rule).
     */
    private fun shareBranch(
        kind: ShareKind,
        targetUserId: UInt,
        filter: ActivityFilter,
        shareTypes: List<String>,
        chainFilter: ChainFilter?,
        matching: Boolean,
    ): Query {
        val shares = DocumentShares
        val at: Column<*> = if (kind == ShareKind.CREATED) shares.createdAt else shares.withdrawnAt
        val actor = if (kind == ShareKind.CREATED) shares.sharerId eq targetUserId else shares.withdrawnBy eq targetUserId
        return shares.select(
            shares.resourceType.alias("area"),
            stringLiteral(kind.source).alias("source"),
            shares.id.alias("event_id"),
            shares.resourceId.alias("document_id"),
            at.alias("created_at"),
            stringLiteral(kind.eventType).alias("event_type"),
            stringLiteral("{}").alias("params"),
        ).where {
            var op: Op<Boolean> = if (matching) actor and (shares.resourceType inList shareTypes) else Op.FALSE
            if (kind == ShareKind.CREATED) {
                filter.createdAtGte?.let { op = op and (shares.createdAt greaterEq it) }
                filter.createdAtLte?.let { op = op and (shares.createdAt lessEq it) }
            } else {
                filter.createdAtGte?.let { op = op and (shares.withdrawnAt greaterEq it) }
                filter.createdAtLte?.let { op = op and (shares.withdrawnAt lessEq it) }
            }
            if (chainFilter != null) op = op and ActivityVisibility.authoredShares(chainFilter.viewer, chainFilter.chain)
            op
        }
    }

    /**
     * Left-folds the branches into one `UNION ALL`. Exposed has no one-branch set operation, so a
     * lone branch is paired with its own contradiction (`WHERE FALSE`): the same rows, one code
     * path. Today every shareable area contributes an event branch plus the two share branches
     * (never fewer than three), so this guards the day a non-shareable area (days-off, career) can
     * be the ONLY source — `area=DAYS_OFF`.
     */
    private fun unionOf(specs: List<(Boolean) -> Query>): SetOperation {
        val branches = specs.map { it(true) } + if (specs.size == 1) listOf(specs.first()(false)) else emptyList()
        return branches.drop(2).fold<Query, SetOperation>(branches[0].unionAll(branches[1])) { acc, next ->
            acc.unionAll(next)
        }
    }

    /** The first branch's output aliases — the union's `ORDER BY` targets and the row reader. */
    private class Projection(first: Query) {
        private val fields = first.set.fields
        val area: Expression<*> = fields[0]
        val source: Expression<*> = fields[1]
        val eventId: Expression<*> = fields[2]
        val createdAt: Expression<*> = fields[4]
        private val documentId: Expression<*> = fields[3]
        private val eventType: Expression<*> = fields[5]
        private val params: Expression<*> = fields[6]

        // The id columns come back as EntityID<UInt> (or the raw UInt, depending on the alias wrapper).
        private fun idOf(value: Any?): UInt = ((value as? EntityID<*>)?.value ?: value) as UInt

        // An event row's area literal is an ActivityArea name; a share row's is the stored
        // `resource_type` (a ShareableResourceType name) — mapped through the exhaustive `when`.
        private fun areaOf(value: String, source: String): ActivityArea =
            if (source == SOURCE_EVENT) ActivityArea.valueOf(value) else ShareableResourceType.valueOf(value).activityArea

        fun read(row: ResultRow): UnionRow = UnionRow(
            area = areaOf(row[area].toString(), row[source].toString()),
            source = row[source].toString(),
            eventId = idOf(row[eventId]),
            documentId = idOf(row[documentId]),
            createdAt = row[createdAt] as Long,
            eventType = row[eventType].toString(),
            params = row[params].toString(),
        )
    }

    // ——— Phase 2: hydration ————————————————————————————————————————————————————————————————

    private suspend fun hydrate(rows: List<UnionRow>, viewer: ActivityViewer): List<ActivityEntry> {
        if (rows.isEmpty()) return emptyList()
        val readability = when (viewer.scope) {
            // Chain rows were already filtered in SQL: every surviving row is readable by the viewer.
            ActivityScope.EVERYTHING, ActivityScope.CHAIN -> Readability.Everything
            // Computed once per request, in this transaction: the viewer's transitive subordinates.
            ActivityScope.OWN_RIGHT -> Readability.OwnRight(viewer.userId, transitiveSubordinateIds(viewer.userId))
        }
        val (shareRows, eventRows) = rows.partition { it.source != SOURCE_EVENT }
        val facts = eventRows.groupBy({ it.area }, { it.documentId }).mapValues { (area, ids) ->
            factsFor(area, ids.toSet(), readability)
        }
        val shares = shareFacts(shareRows.map { it.eventId }.toSet())
        return rows.map { row ->
            // (Event ids and share ids are separate sequences — only a SHARE row may take this branch.)
            if (row.source != SOURCE_EVENT) shares[row.eventId]?.let { return@map shareEntry(row, it) }
            val fact = facts[row.area]?.get(row.documentId)
            val visible = fact?.readable ?: (readability is Readability.Everything)
            ActivityEntry(
                id = "${row.area.name}:${row.source}:${row.eventId}",
                createdAt = row.createdAt,
                area = row.area,
                eventType = row.eventType,
                params = decodeParams(row.params),
                documentId = row.documentId,
                link = if (visible) row.area.shareType?.let { registry.forType(it).viewPath(row.documentId) } else null,
                details = if (visible) fact?.details else null,
            )
        }
    }

    /** One share row of the log: params resolved from the share, `details` the STORED snapshot, link always. */
    private fun shareEntry(row: UnionRow, share: ShareFacts): ActivityEntry {
        val params = buildMap {
            // The sharee's name is LIVE (a rename after the fact shows the new name); the document
            // labels in `details` are the creation-time snapshot and never refreshed.
            put("sharee", share.shareeName)
            share.expiresOn?.let { put("expiresOn", it) }
            if (row.eventType == ShareKind.WITHDRAWN.eventType && share.withdrawnBy != share.sharerId) {
                put("byAuthor", "true")
                put("sharer", share.sharerName)
            }
        }
        return ActivityEntry(
            id = "${row.area.name}:${row.source}:${row.eventId}",
            createdAt = row.createdAt,
            area = row.area,
            eventType = row.eventType,
            params = params,
            documentId = row.documentId,
            link = row.area.shareType?.let { registry.forType(it).viewPath(row.documentId) },
            details = share.details,
        )
    }

    /** Set-at-a-time: the shares behind the page's share rows, both parties' names resolved. */
    private suspend fun shareFacts(ids: Set<UInt>): Map<UInt, ShareFacts> {
        if (ids.isEmpty()) return emptyMap()
        return DocumentShares
            .join(actorLabelUsers, JoinType.INNER, onColumn = DocumentShares.sharerId, otherColumn = actorLabelUsers[Users.id])
            .join(partnerLabelUsers, JoinType.INNER, onColumn = DocumentShares.shareeId, otherColumn = partnerLabelUsers[Users.id])
            .select(
                DocumentShares.id, DocumentShares.sharerId, actorLabelUsers[Users.name], partnerLabelUsers[Users.name],
                DocumentShares.expiresOn, DocumentShares.withdrawnBy, DocumentShares.details,
            )
            .where { DocumentShares.id inList ids }
            .map { row ->
                row[DocumentShares.id].value to ShareFacts(
                    sharerId = row[DocumentShares.sharerId].value,
                    sharerName = row[actorLabelUsers[Users.name]],
                    shareeName = row[partnerLabelUsers[Users.name]],
                    expiresOn = row[DocumentShares.expiresOn],
                    withdrawnBy = row[DocumentShares.withdrawnBy]?.value,
                    details = row[DocumentShares.details]?.let { decodeParams(it) },
                )
            }
            .toList()
            .toMap()
    }

    private suspend fun factsFor(area: ActivityArea, ids: Set<UInt>, readability: Readability): Map<UInt, DocFacts> =
        when (area) {
            ActivityArea.FEEDBACK -> feedbackFacts(ids, readability)
            ActivityArea.ONE_ON_ONE -> oneOnOneFacts(ids, readability)
            ActivityArea.GOAL -> goalFacts(ids, readability)
            ActivityArea.TEAM_KPI -> teamKpiFacts(ids, readability)
            ActivityArea.PERFORMANCE_REVIEW -> reviewFacts(ids, readability)
            ActivityArea.IMPACT_LOG_ENTRY -> impactFacts(ids, readability)
            ActivityArea.SUCCESSION_PLAN -> successionFacts(ids, readability)
            // No branch of the union produces these yet (their steps add them).
            ActivityArea.DAYS_OFF, ActivityArea.CAREER_POSITION, ActivityArea.ACCOUNT -> emptyMap()
        }

    /**
     * The own-right projection as a selectable boolean (a `CASE`, so it rides the same row as the
     * labels), or null when the viewer reads everything.
     */
    private fun readableExpr(area: ActivityArea, readability: Readability): Expression<Boolean>? =
        (readability as? Readability.OwnRight)?.let {
            case().When(ActivityVisibility.readable(area, it.viewer, it.chain), booleanLiteral(true))
                .Else(booleanLiteral(false))
        }

    /** Runs one area's label query over [from] (explicit joins) for [ids] and maps each row to its facts. */
    private suspend fun facts(
        area: ActivityArea,
        readability: Readability,
        idColumn: Column<EntityID<UInt>>,
        from: ColumnSet,
        ids: Set<UInt>,
        columns: List<Expression<*>>,
        label: (ResultRow) -> Map<String, String>,
    ): Map<UInt, DocFacts> {
        val readable = readableExpr(area, readability)
        return from.select(listOfNotNull(idColumn, *columns.toTypedArray(), readable))
            .where { idColumn inList ids }
            .map { row ->
                row[idColumn].value to DocFacts(label(row), readable?.let { row[it] } ?: true)
            }
            .toList()
            .toMap()
    }

    private suspend fun feedbackFacts(ids: Set<UInt>, readability: Readability): Map<UInt, DocFacts> {
        // The recipients are position-ordered (the join table includes the anchor at position 0);
        // a legacy row without join rows falls back to the anchor column's name.
        val recipients = FeedbackSubjects
            .join(Users, JoinType.INNER, onColumn = FeedbackSubjects.userId, otherColumn = Users.id)
            .select(FeedbackSubjects.feedbackId, FeedbackSubjects.position, Users.name)
            .where { FeedbackSubjects.feedbackId inList ids }
            .orderBy(FeedbackSubjects.position to SortOrder.ASC)
            .map { it[FeedbackSubjects.feedbackId].value to it[Users.name] }
            .toList()
            .groupBy({ it.first }, { it.second })
        val from = Feedbacks
            .join(actorLabelUsers, JoinType.INNER, onColumn = Feedbacks.providerId, otherColumn = actorLabelUsers[Users.id])
            .join(partnerLabelUsers, JoinType.INNER, onColumn = Feedbacks.subjectId, otherColumn = partnerLabelUsers[Users.id])
        return facts(
            ActivityArea.FEEDBACK, readability, Feedbacks.id, from, ids,
            listOf(actorLabelUsers[Users.name], partnerLabelUsers[Users.name]),
        ) { row ->
            val subjects = recipients[row[Feedbacks.id].value] ?: listOf(row[partnerLabelUsers[Users.name]])
            mapOf("provider" to row[actorLabelUsers[Users.name]], "subjects" to subjects.joinToString(", "))
        }
    }

    private suspend fun oneOnOneFacts(ids: Set<UInt>, readability: Readability): Map<UInt, DocFacts> {
        val from = Meetings
            .join(actorLabelUsers, JoinType.INNER, onColumn = Meetings.managerId, otherColumn = actorLabelUsers[Users.id])
            .join(partnerLabelUsers, JoinType.INNER, onColumn = Meetings.subordinateId, otherColumn = partnerLabelUsers[Users.id])
        return facts(
            ActivityArea.ONE_ON_ONE, readability, Meetings.id, from, ids,
            listOf(actorLabelUsers[Users.name], partnerLabelUsers[Users.name], Meetings.meetingDate),
        ) { row ->
            mapOf(
                "manager" to row[actorLabelUsers[Users.name]],
                "subordinate" to row[partnerLabelUsers[Users.name]],
                "meetingDate" to row[Meetings.meetingDate],
            )
        }
    }

    private suspend fun goalFacts(ids: Set<UInt>, readability: Readability): Map<UInt, DocFacts> {
        val from = Goals
            .join(partnerLabelUsers, JoinType.INNER, onColumn = Goals.subordinateId, otherColumn = partnerLabelUsers[Users.id])
        return facts(
            ActivityArea.GOAL, readability, Goals.id, from, ids,
            listOf(Goals.title, partnerLabelUsers[Users.name]),
        ) { row -> mapOf("title" to row[Goals.title], "subordinate" to row[partnerLabelUsers[Users.name]]) }
    }

    private suspend fun teamKpiFacts(ids: Set<UInt>, readability: Readability): Map<UInt, DocFacts> {
        val from = TeamKpis.join(Teams, JoinType.INNER, onColumn = TeamKpis.teamId, otherColumn = Teams.id)
        return facts(
            ActivityArea.TEAM_KPI, readability, TeamKpis.id, from, ids,
            listOf(TeamKpis.title, Teams.name, TeamKpis.type),
        ) { row ->
            mapOf("title" to row[TeamKpis.title], "team" to row[Teams.name], "type" to row[TeamKpis.type].name)
        }
    }

    private suspend fun reviewFacts(ids: Set<UInt>, readability: Readability): Map<UInt, DocFacts> {
        val from = Reviews
            .join(partnerLabelUsers, JoinType.INNER, onColumn = Reviews.subordinateId, otherColumn = partnerLabelUsers[Users.id])
            .join(ReviewPeriods, JoinType.INNER, onColumn = Reviews.periodId, otherColumn = ReviewPeriods.id)
        return facts(
            ActivityArea.PERFORMANCE_REVIEW, readability, Reviews.id, from, ids,
            listOf(partnerLabelUsers[Users.name], ReviewPeriods.startMonth, ReviewPeriods.endMonth),
        ) { row ->
            mapOf(
                "subordinate" to row[partnerLabelUsers[Users.name]],
                "startMonth" to row[ReviewPeriods.startMonth],
                "endMonth" to row[ReviewPeriods.endMonth],
            )
        }
    }

    private suspend fun impactFacts(ids: Set<UInt>, readability: Readability): Map<UInt, DocFacts> {
        val from = Entries
            .join(actorLabelUsers, JoinType.INNER, onColumn = Entries.userId, otherColumn = actorLabelUsers[Users.id])
        return facts(
            ActivityArea.IMPACT_LOG_ENTRY, readability, Entries.id, from, ids,
            listOf(Entries.title, actorLabelUsers[Users.name], Entries.periodStart, Entries.periodEnd),
        ) { row ->
            mapOf(
                "title" to row[Entries.title],
                "author" to row[actorLabelUsers[Users.name]],
                "periodStart" to row[Entries.periodStart],
                "periodEnd" to row[Entries.periodEnd],
            )
        }
    }

    private suspend fun successionFacts(ids: Set<UInt>, readability: Readability): Map<UInt, DocFacts> {
        val from = Plans
            .join(partnerLabelUsers, JoinType.INNER, onColumn = Plans.userId, otherColumn = partnerLabelUsers[Users.id])
            .join(actorLabelUsers, JoinType.INNER, onColumn = Plans.managerId, otherColumn = actorLabelUsers[Users.id])
        return facts(
            ActivityArea.SUCCESSION_PLAN, readability, Plans.id, from, ids,
            listOf(partnerLabelUsers[Users.name], actorLabelUsers[Users.name]),
        ) { row ->
            mapOf("person" to row[partnerLabelUsers[Users.name]], "owner" to row[actorLabelUsers[Users.name]])
        }
    }
}
