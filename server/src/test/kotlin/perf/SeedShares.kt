package ch.nokillswit.perf

import ch.nokillswit.daysoff.DaysOffCalendarShareable
import ch.nokillswit.daysoff.DaysOffService
import ch.nokillswit.feedbacks.FeedbackService
import ch.nokillswit.feedbacks.FeedbackShareable
import ch.nokillswit.goals.GoalService
import ch.nokillswit.goals.GoalShareable
import ch.nokillswit.impactlog.ImpactLogService
import ch.nokillswit.impactlog.ImpactLogShareable
import ch.nokillswit.infra.db.encodeParams
import ch.nokillswit.oneonones.OneOnOneService
import ch.nokillswit.oneonones.OneOnOneShareable
import ch.nokillswit.pulse.PulseTeamResultsShareable
import ch.nokillswit.reviews.PerformanceReviewService
import ch.nokillswit.reviews.PerformanceReviewShareable
import ch.nokillswit.sharing.ShareRegistry
import ch.nokillswit.sharing.ShareService
import ch.nokillswit.sharing.ShareableResource
import ch.nokillswit.sharing.ShareableResourceType
import ch.nokillswit.sharing.shareCreatedNotification
import ch.nokillswit.sharing.shareWithdrawnNotifications
import ch.nokillswit.succession.SuccessionPlanService
import ch.nokillswit.succession.SuccessionShareable
import ch.nokillswit.teamkpis.TeamKpiService
import ch.nokillswit.teamkpis.TeamKpiShareable
import ch.nokillswit.teams.TeamService
import ch.nokillswit.users.UserService
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase
import org.jetbrains.exposed.v1.r2dbc.select
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import java.time.Instant
import java.time.ZoneOffset

private const val SHARE_RATE = 0.05
private const val WITHDRAWN_RATE = 0.10
private const val EXPIRING_RATE = 0.40
private const val FEEDBACK_SWEEP_MILLIS = 3_600_000L

/** A document a person could share: its type, id, author (the sharer) and when it came to be. */
private class ShareableDoc(val type: ShareableResourceType, val id: UInt, val authorId: UInt, val atMillis: Long)

private class ShareRow(
    val id: UInt,
    val type: ShareableResourceType,
    val resourceId: UInt,
    val sharerId: UInt,
    val shareeId: UInt,
    val expiresOn: String?,
    val createdAt: Long,
    val withdrawnAt: Long?,
    val details: Map<String, String>,
)

/**
 * The REAL adapter registry, built exactly like `configureDatabase` builds it — an exhaustive `when` with
 * no `else`, so a new [ShareableResourceType] without a generator branch fails to compile here, and the
 * `details` snapshot of every share is whatever the production adapter's `label()` returns.
 */
private fun adapters(db: R2dbcDatabase, ctx: SeedContext): ShareRegistry {
    val cipher = ctx.cipher
    val feedbacks = FeedbackService(db, cipher, FEEDBACK_SWEEP_MILLIS)
    val oneOnOnes = OneOnOneService(db, cipher)
    val goals = GoalService(db, cipher)
    val teamKpis = TeamKpiService(db, cipher)
    val reviews = PerformanceReviewService(db, cipher)
    val impact = ImpactLogService(db, cipher)
    val succession = SuccessionPlanService(db, cipher)
    return ShareRegistry { type ->
        when (type) {
            ShareableResourceType.FEEDBACK -> FeedbackShareable(feedbacks)
            ShareableResourceType.ONE_ON_ONE -> OneOnOneShareable(oneOnOnes)
            ShareableResourceType.GOAL -> GoalShareable(goals)
            ShareableResourceType.TEAM_KPI -> TeamKpiShareable(teamKpis)
            ShareableResourceType.PERFORMANCE_REVIEW -> PerformanceReviewShareable(reviews)
            ShareableResourceType.IMPACT_LOG_ENTRY -> ImpactLogShareable(impact)
            ShareableResourceType.SUCCESSION_PLAN -> SuccessionShareable(succession)
            ShareableResourceType.DAYS_OFF_CALENDAR -> DaysOffCalendarShareable(UserService(db), DaysOffService(db, cipher))
            ShareableResourceType.PULSE_TEAM_RESULTS -> PulseTeamResultsShareable(TeamService(db))
        }
    }
}

/** The adapter's own creation-time snapshot of document [id]; null when it no longer exists. */
private suspend fun <D : Any> snapshot(adapter: ShareableResource<D, *>, id: UInt): Map<String, String>? =
    adapter.read(id)?.let { adapter.label(it) }

/** Every live document of the six table-backed kinds, with its author (the stored manager / provider / owner). */
private suspend fun loadDocuments(ctx: SeedContext, org: Org): List<ShareableDoc> = suspendTransaction(ctx.db) {
    val f = FeedbackService.Feedbacks
    val m = OneOnOneService.Meetings
    val g = GoalService.Goals
    val k = TeamKpiService.TeamKpis
    val r = PerformanceReviewService.Reviews
    val e = ImpactLogService.Entries
    val p = SuccessionPlanService.Plans
    val docs = mutableListOf<ShareableDoc>()
    docs += f.select(f.id, f.providerId, f.lastModified).where { f.markedAsDeleted eq false }.orderBy(f.id)
        .map { ShareableDoc(ShareableResourceType.FEEDBACK, it[f.id].value, it[f.providerId].value, it[f.lastModified]) }.toList()
    docs += m.select(m.id, m.managerId, m.lastModified).where { m.markedAsDeleted eq false }.orderBy(m.id)
        .map { ShareableDoc(ShareableResourceType.ONE_ON_ONE, it[m.id].value, it[m.managerId].value, it[m.lastModified]) }.toList()
    docs += g.select(g.id, g.managerId, g.createdAt).where { g.markedAsDeleted eq false }.orderBy(g.id)
        .map { ShareableDoc(ShareableResourceType.GOAL, it[g.id].value, it[g.managerId].value, it[g.createdAt]) }.toList()
    // A team KPI's author is whoever manages the team NOW (the current-manager derivation).
    docs += k.select(k.id, k.teamId, k.createdAt).where { k.markedAsDeleted eq false }.orderBy(k.id)
        .map {
            val manager = org.teamById.getValue(it[k.teamId].value).managerId
            ShareableDoc(ShareableResourceType.TEAM_KPI, it[k.id].value, manager, it[k.createdAt])
        }
        .toList()
    docs += r.select(r.id, r.managerId, r.createdAt).where { r.markedAsDeleted eq false }.orderBy(r.id)
        .map { ShareableDoc(ShareableResourceType.PERFORMANCE_REVIEW, it[r.id].value, it[r.managerId].value, it[r.createdAt]) }.toList()
    docs += e.select(e.id, e.userId, e.createdAt).where { e.markedAsDeleted eq false }.orderBy(e.id)
        .map { ShareableDoc(ShareableResourceType.IMPACT_LOG_ENTRY, it[e.id].value, it[e.userId].value, it[e.createdAt]) }.toList()
    docs += p.select(p.id, p.managerId, p.createdAt).where { p.markedAsDeleted eq false }.orderBy(p.id)
        .map { ShareableDoc(ShareableResourceType.SUCCESSION_PLAN, it[p.id].value, it[p.managerId].value, it[p.createdAt]) }.toList()
    docs
}

/** The two kinds whose resource is a person / a team rather than a document row. */
private fun personAndTeamDocs(ctx: SeedContext, org: Org, rng: Rng): List<ShareableDoc> {
    val at = ctx.anchorMillis - 90 * MILLIS_PER_DAY
    return org.people.map { ShareableDoc(ShareableResourceType.DAYS_OFF_CALENDAR, it.id, it.id, at - rng.int(0, 900) * MILLIS_PER_DAY) } +
        org.teams.map { ShareableDoc(ShareableResourceType.PULSE_TEAM_RESULTS, it.id, it.managerId, at - rng.int(0, 900) * MILLIS_PER_DAY) }
}

private fun isoDate(millis: Long) = Instant.ofEpochMilli(millis).atZone(ZoneOffset.UTC).toLocalDate()

/**
 * Document shares (`.claude/docs/features/sharing.md`): **5 % of every shareable kind** (feedbacks, 1:1s,
 * goals, team KPIs, performance reviews, impact entries, succession plans, a person's days-off calendar, a
 * team's pulse results — at least one each) shared read-only by an own-right reader who is the document's
 * AUTHOR (feedback provider; 1:1/goal/review manager; impact/succession owner; the calendar's person; the
 * team's current manager for a KPI and for pulse results) with a random PEER (same hierarchy level, else
 * anyone but the sharer); no active duplicate per (document, sharee). ~40 % carry an `expires_on` (30–180
 * days after the share, so some already lapsed — silent expiry), **~10 % were withdrawn** by the sharer
 * (`withdrawn_at`/`withdrawn_by`, terminal). `details` is the creation-time snapshot built by the REAL
 * `*Shareable.label()` of each kind ([adapters]). Notifications by the table in `notifications.md` through
 * the pure builders `shareCreatedNotification` (the sharee, at the share) and `shareWithdrawnNotifications`
 * (the sharee at the withdrawal; the sharer withdrew, so no second copy), retention-shaped by
 * [NotificationMint]. Shares are never written to the documents' event histories (the activity log reads
 * the share rows). **Not generated:** mass shares (`batch_id` stays NULL, no batch notices) and the
 * per-(sharer, sharee) daily notification cap.
 */
suspend fun seedShares(ctx: SeedContext, org: Org, mint: NotificationMint) {
    val db = ctx.db
    val rng = ctx.rng("shares")
    val registry = adapters(db, ctx)
    val peersByLevel = org.people.groupBy { it.level }
    val table = ShareService.DocumentShares
    val sink = RowSink<ShareRow>(db, table) { s ->
        this[table.id] = s.id
        this[table.resourceType] = s.type.name
        this[table.resourceId] = s.resourceId
        this[table.sharerId] = s.sharerId
        this[table.shareeId] = s.shareeId
        this[table.expiresOn] = s.expiresOn
        this[table.createdAt] = s.createdAt
        this[table.withdrawnAt] = s.withdrawnAt
        this[table.withdrawnBy] = s.withdrawnAt?.let { s.sharerId }
        this[table.details] = encodeParams(s.details)
    }
    val ids = IdCounter(nextFreeId(db, table))
    val taken = HashSet<Triple<ShareableResourceType, UInt, UInt>>()
    (loadDocuments(ctx, org) + personAndTeamDocs(ctx, org, rng)).groupBy { it.type }.forEach { (type, docs) ->
        val sample = docs.filter { rng.chance(SHARE_RATE) }.ifEmpty { listOf(rng.pick(docs)) }
        val adapter = registry.forType(type)
        sample.forEach { doc ->
            val sharer = org.byId.getValue(doc.authorId)
            val peers = peersByLevel[sharer.level].orEmpty().filter { it.id != sharer.id }
                .ifEmpty { org.people.filter { it.id != sharer.id } }
            val sharee = rng.pick(peers)
            if (!taken.add(Triple(type, doc.id, sharee.id))) return@forEach
            val label = snapshot(adapter, doc.id) ?: return@forEach
            val createdAt = ctx.spreadMillis(
                rng, isoDate(doc.atMillis).plusDays(rng.int(1, 30).toLong()), 9 + rng.int(0, 8), rng.int(0, 59), floor = doc.atMillis,
            )
            val expiresOn = if (rng.chance(EXPIRING_RATE)) isoDate(createdAt).plusDays(rng.int(30, 180).toLong()).toString() else null
            val withdrawnAt = if (rng.chance(WITHDRAWN_RATE)) {
                ctx.spreadMillis(rng, isoDate(createdAt).plusDays(rng.int(1, 20).toLong()), 10, floor = createdAt)
            } else {
                null
            }
            sink.add(ShareRow(ids.take(), type, doc.id, sharer.id, sharee.id, expiresOn, createdAt, withdrawnAt, label))
            val subject = adapter.isSubject(sharer.id, doc.id)
            mint.emit(
                shareCreatedNotification(type, sharee.id, sharer.name, expiresOn, adapter.viewPath(doc.id), label, subject),
                createdAt,
            )
            if (withdrawnAt != null) {
                mint.emitAll(
                    shareWithdrawnNotifications(
                        type, sharer.id, sharer.name, sharee.id, sharee.name, sharer.id, sharer.name, label, subject,
                    ),
                    withdrawnAt,
                )
            }
        }
    }
    sink.flush()
    mint.sinkGroup.flush()
    advanceSequences(db, listOf(table))
}
