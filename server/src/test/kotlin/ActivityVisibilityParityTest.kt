package ch.nokillswit

import ch.nokillswit.activity.ActivityArea
import ch.nokillswit.activity.ActivityFilter
import ch.nokillswit.activity.ActivityScope
import ch.nokillswit.activity.ActivityServiceKey
import ch.nokillswit.activity.ActivityViewer
import ch.nokillswit.activity.shareType
import ch.nokillswit.authz.CallerPrincipal
import ch.nokillswit.authz.ForbiddenException
import ch.nokillswit.daysoff.DaysOffEventService.DaysOffEvents
import ch.nokillswit.feedbacks.FeedbackEventService.FeedbackEvents
import ch.nokillswit.feedbacks.FeedbackService.FeedbackSubjects
import ch.nokillswit.feedbacks.FeedbackService.Feedbacks
import ch.nokillswit.feedbacks.FeedbackStatus
import ch.nokillswit.feedbacks.FeedbackVisibility
import ch.nokillswit.goals.GoalEventService.GoalEvents
import ch.nokillswit.goals.GoalService.Goals
import ch.nokillswit.goals.GoalStatus
import ch.nokillswit.goals.GoalType
import ch.nokillswit.impactlog.ImpactLogEventService.ImpactLogEvents
import ch.nokillswit.impactlog.ImpactLogService.Entries
import ch.nokillswit.infra.db.EventLogTable
import ch.nokillswit.infra.paging.PageRequest
import ch.nokillswit.infra.paging.SortField
import ch.nokillswit.oneonones.OneOnOneEventService.OneOnOneEvents
import ch.nokillswit.oneonones.OneOnOneService.Meetings
import ch.nokillswit.reviews.PerformanceReviewEventService.ReviewEvents
import ch.nokillswit.reviews.PerformanceReviewService.Reviews
import ch.nokillswit.reviews.PerformanceReviewStatus
import ch.nokillswit.sharing.ShareRegistryKey
import ch.nokillswit.sharing.ShareService.DocumentShares
import ch.nokillswit.sharing.ShareableResource
import ch.nokillswit.succession.RetentionRisk
import ch.nokillswit.succession.RoleCriticality
import ch.nokillswit.succession.SuccessionEventService.SuccessionPlanEvents
import ch.nokillswit.succession.SuccessionPlanService.Plans
import ch.nokillswit.succession.SuccessionPlanStatus
import ch.nokillswit.teamkpis.TeamKpiEventService.TeamKpiEvents
import ch.nokillswit.teamkpis.TeamKpiService.TeamKpis
import ch.nokillswit.teamkpis.TeamKpiStatus
import ch.nokillswit.teamkpis.TeamKpiType
import ch.nokillswit.teams.Team
import ch.nokillswit.teams.isInManagementChain
import ch.nokillswit.users.CareerPositionEventService.CareerPositionEvents
import io.ktor.server.testing.testApplication
import org.jetbrains.exposed.v1.r2dbc.insert
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The guard-vs-SQL oracle for `activity/ActivityVisibility.kt` (step 2, plan correction 6). Each
 * area's SQL predicate must agree, document by document, with the REAL read guard evaluated for a
 * role-stripped principal through the sharing adapter (`read(id) != null && guard(...)`) — the
 * one definition of "may this person read this document in their own right". A seeded matrix per
 * area (statuses × party/chain/skip-level/team-member/outsider/requester relationships, soft
 * deletion, multi-recipient feedback, a soft-deleted team) is run through the service end to end,
 * in BOTH uses of the predicate:
 *
 * - **chain mode** — a viewer reading someone else's log: a row is listed iff the oracle says the
 *   viewer reads the document;
 * - **self mode** — a viewer reading their own log: every row is listed, `details` is non-null iff
 *   the oracle says the viewer reads the document.
 *
 * A guard that changes without its `ActivityVisibility` builder fails here. (HR's auditor read is
 * not part of "own right" and is covered in `ActivityLogTest`.)
 */
class ActivityVisibilityParityTest {

    private class Doc(val area: ActivityArea, val id: UInt)

    private suspend fun <D : Any, G> ShareableResource<D, G>.ownRight(userId: UInt, id: UInt): Boolean {
        val doc = read(id) ?: return false
        return try {
            guard(CallerPrincipal(userId, "viewer-$userId@test", emptySet()), doc)
            true
        } catch (_: ForbiddenException) {
            false
        }
    }

    private suspend fun <D : Any, G> ShareableResource<D, G>.authors(userId: UInt, id: UInt): Boolean {
        val doc = read(id) ?: return false
        return isAuthor(userId, doc)
    }

    private suspend fun user(prefix: String): UInt =
        TestUsers.seed(email = uniqueEmail(prefix), password = "pw-123456789", name = prefix, roles = emptySet())

    private class Org(
        val gm: UInt, val m: UInt, val s: UInt, val s2: UInt, val pm: UInt, val p: UInt,
        val r: UInt, val g: UInt, val o: UInt, val t: UInt,
        val leads: UInt, val squad: UInt, val peers: UInt, val old: UInt,
    ) {
        val viewers = listOf(gm, m, s, s2, pm, p, r, g, o)
    }

    /** GM → M → {S, S2}; PM → P; R a requester; G a provider/actor; O nobody; T the log owner. */
    private suspend fun org(): Org {
        val gm = user("gm")
        val m = user("m")
        val s = user("s")
        val s2 = user("s2")
        val pm = user("pm")
        val p = user("p")
        val r = user("r")
        val suffix = UUID.randomUUID().toString().take(8)
        val old = TestServices.teams.create(Team("Old-$suffix", m, listOf(r)))
        TestServices.teams.delete(old)
        return Org(
            gm, m, s, s2, pm, p, r, user("g"), user("o"), user("t"),
            leads = TestServices.teams.create(Team("Leads-$suffix", gm, listOf(m))),
            squad = TestServices.teams.create(Team("Squad-$suffix", m, listOf(s, s2))),
            peers = TestServices.teams.create(Team("Peers-$suffix", pm, listOf(p))),
            old = old,
        )
    }

    private suspend fun seedFeedbacksAndMeetings(o: Org, now: Long): List<Doc> = suspendTransaction(TestServices.database) {
        val docs = mutableListOf<Doc>()
        // FEEDBACK: provider × recipients × visibility × status (+ a deleted one, + one without a requester).
        // Multi-recipient lists include ones whose ONLY in-chain recipient is not the anchor (the first one).
        val recipientLists = listOf(
            listOf(o.s), listOf(o.s, o.s2), listOf(o.o, o.s2), listOf(o.p, o.s), listOf(o.p, o.o),
        )
        for (provider in listOf(o.g, o.m)) {
            for (recipients in recipientLists) {
                for (visibility in FeedbackVisibility.entries) {
                    for (status in FeedbackStatus.entries) {
                        docs += feedback(provider, recipients, o.r, visibility, status, now, deleted = false)
                    }
                }
            }
        }
        docs += feedback(o.g, listOf(o.s), o.r, FeedbackVisibility.PUBLIC, FeedbackStatus.SENT, now, deleted = true)
        docs += feedback(o.g, listOf(o.s), null, FeedbackVisibility.PROVIDER_SUBJECT, FeedbackStatus.SENT, now, false)
        // ONE_ON_ONE: parties and chain; one deleted.
        listOf(o.m to o.s, o.m to o.s2, o.gm to o.m, o.pm to o.p, o.g to o.s).forEachIndexed { i, (mgr, sub) ->
            docs += meeting(mgr, sub, "2026-01-0${i + 1}", now, deleted = false)
        }
        docs += meeting(o.m, o.s, "2026-02-01", now, deleted = true)
        docs
    }

    private suspend fun seedGoalsKpisAndOwnerDocs(o: Org, now: Long): List<Doc> = suspendTransaction(TestServices.database) {
        val docs = mutableListOf<Doc>()
        for ((mgr, sub) in listOf(o.m to o.s, o.gm to o.m, o.pm to o.p, o.g to o.s2)) {
            for (status in GoalStatus.entries) docs += goal(mgr, sub, status, now, deleted = false)
        }
        docs += goal(o.m, o.s, GoalStatus.ACTIVE, now, deleted = true)
        // TEAM_KPI: current manager / chain above / members / a soft-deleted team × statuses.
        for (team in listOf(o.squad, o.leads, o.peers, o.old)) {
            for (status in TeamKpiStatus.entries) docs += kpi(team, o.g, status, now, deleted = false)
        }
        docs += kpi(o.squad, o.g, TeamKpiStatus.ACTIVE, now, deleted = true)
        // IMPACT_LOG_ENTRY: owners (+ deleted). SUCCESSION_PLAN: owner × seat (+ deleted).
        for (owner in listOf(o.s, o.m, o.p, o.gm, o.g)) docs += entry(owner, now, deleted = false)
        docs += entry(o.s, now, deleted = true)
        for ((owner, seat) in listOf(o.m to o.s, o.gm to o.m, o.pm to o.p, o.s to o.s2)) {
            docs += plan(owner, seat, now, deleted = false)
        }
        // Owner OUTSIDE m's chain with the seat INSIDE it (and the reverse): the rule keys on the OWNER.
        docs += plan(o.g, o.s, now, deleted = false)
        docs += plan(o.s, o.p, now, deleted = false)
        docs += plan(o.m, o.s2, now, deleted = true)
        docs
    }

    /** T shared EVERY document and withdrew it again: a SHARE and a SHARE_WITHDRAWAL row per document. */
    private suspend fun seedShares(o: Org, docs: List<Doc>, now: Long) = suspendTransaction(TestServices.database) {
        for (doc in docs) {
            DocumentShares.insert {
                it[resourceType] = doc.area.shareType!!.name
                it[resourceId] = doc.id
                it[sharerId] = o.t
                it[shareeId] = o.o
                it[createdAt] = now
                it[withdrawnAt] = now + 1
                it[withdrawnBy] = o.t
            }
        }
    }

    /** Reviews need a distinct period per (subordinate, period). */
    private suspend fun seedReviews(o: Org, now: Long): List<Doc> {
        val periods = List(4) { TestReviewPeriods.append(months = 1).id }
        return suspendTransaction(TestServices.database) {
            val docs = mutableListOf<Doc>()
            for ((mgr, sub) in listOf(o.m to o.s, o.gm to o.m, o.pm to o.p, o.g to o.s2)) {
                PerformanceReviewStatus.entries.forEachIndexed { i, status ->
                    docs += review(mgr, sub, periods[i], status, now, deleted = false)
                }
            }
            docs += review(o.m, o.s, periods[3], PerformanceReviewStatus.PUBLISHED, now, deleted = true)
            docs
        }
    }

    private val eventTables: Map<ActivityArea, EventLogTable> = mapOf(
        ActivityArea.FEEDBACK to FeedbackEvents, ActivityArea.ONE_ON_ONE to OneOnOneEvents,
        ActivityArea.GOAL to GoalEvents, ActivityArea.TEAM_KPI to TeamKpiEvents,
        ActivityArea.PERFORMANCE_REVIEW to ReviewEvents, ActivityArea.IMPACT_LOG_ENTRY to ImpactLogEvents,
        ActivityArea.SUCCESSION_PLAN to SuccessionPlanEvents,
    )

    /** One event per (document, actor): T for the chain-mode viewers, every viewer for self mode. */
    private suspend fun seedEvents(o: Org, docs: List<Doc>, now: Long) = suspendTransaction(TestServices.database) {
        for (doc in docs) {
            val table = eventTables.getValue(doc.area)
            for (actor in o.viewers + o.t) event(table, doc.id, actor, now)
        }
    }

    @Test
    fun `every area's SQL predicate agrees with its real read guard, for chain viewers and for self`() =
        testApplication {
            usePostgresTestcontainer()
            val registry = application.attributes[ShareRegistryKey]
            val service = application.attributes[ActivityServiceKey]
            val o = org()
            val now = System.currentTimeMillis()
            val docs = seedFeedbacksAndMeetings(o, now) + seedGoalsKpisAndOwnerDocs(o, now) + seedReviews(o, now)

            // Exhaustiveness: the matrix covers EVERY shareable area (a new area without a matrix fails here).
            val shareable = ActivityArea.entries.filter { it.shareType != null }.toSet()
            assertEquals(shareable, docs.map { it.area }.toSet())
            assertEquals(
                ch.nokillswit.sharing.ShareableResourceType.entries.toSet(),
                shareable.map { it.shareType }.toSet(),
            )
            seedEvents(o, docs, now)
            seedShares(o, docs, now)

            val mismatches = mutableListOf<String>()
            val outcomes = mutableMapOf<Pair<ActivityArea, Boolean>, Int>()
            val authorOutcomes = mutableMapOf<Pair<ActivityArea, Boolean>, Int>()
            for (area in shareable) {
                val areaDocs = docs.filter { it.area == area }
                val adapter = registry.forType(area.shareType!!)
                for (viewer in o.viewers) {
                    val expected = areaDocs.associate { it.id to adapter.ownRight(viewer, it.id) }
                    // chain mode (viewer reads T's log): a row per readable document, none for the rest.
                    val chainRows = listed(service, o.t, viewer, ActivityScope.CHAIN, area, shares = false)
                    // share rows (T shared and withdrew every document): a chain viewer sees them only for
                    // documents they AUTHOR (adapter.isAuthor, document not deleted) — never as a mere reader.
                    val shareRows = listed(service, o.t, viewer, ActivityScope.CHAIN, area, shares = true)
                    // self mode (viewer reads their own log): every document is listed; details ⇔ readable.
                    val selfRows = listed(service, viewer, viewer, ActivityScope.OWN_RIGHT, area)
                    for (doc in areaDocs) {
                        val ok = expected.getValue(doc.id)
                        outcomes.merge(area to ok, 1, Int::plus)
                        val authored = adapter.authors(viewer, doc.id)
                        authorOutcomes.merge(area to authored, 1, Int::plus)
                        if ((doc.id in shareRows) != authored) {
                            mismatches += "SHARE $area doc=${doc.id} viewer=$viewer author=$authored listed=${doc.id in shareRows}"
                        }
                        if ((doc.id in chainRows) != ok) {
                            mismatches += "CHAIN $area doc=${doc.id} viewer=$viewer oracle=$ok listed=${doc.id in chainRows}"
                        }
                        if (selfRows[doc.id] == null) {
                            mismatches += "SELF $area doc=${doc.id} viewer=$viewer: row missing from the own log"
                        } else if (selfRows[doc.id] != ok) {
                            mismatches += "SELF $area doc=${doc.id} viewer=$viewer oracle=$ok details=${selfRows[doc.id]}"
                        }
                    }
                }
            }
            assertTrue(mismatches.isEmpty(), "predicate/guard disagreements:\n" + mismatches.take(40).joinToString("\n"))
            // Non-vacuous: every area saw both readable and unreadable documents.
            for (area in shareable) {
                assertTrue((outcomes[area to true] ?: 0) > 0, "$area never readable in the matrix")
                assertTrue((outcomes[area to false] ?: 0) > 0, "$area never hidden in the matrix")
                assertTrue((authorOutcomes[area to true] ?: 0) > 0, "$area never authored in the matrix")
                assertTrue((authorOutcomes[area to false] ?: 0) > 0, "$area never non-authored in the matrix")
            }
        }

    /**
     * The person-scoped areas (DAYS_OFF V88, CAREER_POSITION V89) have no document and no adapter, so
     * their oracle is the chain rule itself: a chain viewer sees T's row about OWNER iff the owner is
     * the viewer or in the viewer's transitive chain (`isInManagementChain(viewer, owner)` — the real
     * walk, owner ≠ viewer excluded).
     */
    @Test
    fun `person-scoped rows follow the owner-in-chain rule for every viewer and owner`() = testApplication {
        usePostgresTestcontainer()
        val service = application.attributes[ActivityServiceKey]
        val o = org()
        val now = System.currentTimeMillis()
        val owners = o.viewers + o.t
        val trails = mapOf(ActivityArea.DAYS_OFF to DaysOffEvents, ActivityArea.CAREER_POSITION to CareerPositionEvents)
        suspendTransaction(TestServices.database) {
            for (table in trails.values) for (owner in owners) event(table, owner, o.t, now)
        }
        val firstPage = PageRequest(1, 100, listOf(SortField("createdAt", descending = true)))
        for (area in trails.keys) {
            for (viewer in o.viewers) {
                val rows = service.list(
                    o.t, ActivityViewer(viewer, emptySet(), ActivityScope.CHAIN), ActivityFilter(area = area), firstPage,
                )
                val seen = rows.items.map { it.subjectUserId!! }.toSet()
                val expected = suspendTransaction(TestServices.database) {
                    owners.filter { owner -> owner == viewer || isInManagementChain(viewer, owner) }.toSet()
                }
                assertEquals(expected, seen, "$area viewer $viewer")
                assertEquals(rows.total, rows.items.size.toLong())
            }
            // Non-vacuous: the skip-level manager sees several owners; an outsider only their own row.
            val gmSees = service.list(
                o.t, ActivityViewer(o.gm, emptySet(), ActivityScope.CHAIN), ActivityFilter(area = area), firstPage,
            )
            assertTrue(gmSees.total >= 4, "$area")
            val outsiderSees = service.list(
                o.t, ActivityViewer(o.o, emptySet(), ActivityScope.CHAIN), ActivityFilter(area = area), firstPage,
            )
            assertEquals(setOf(o.o), outsiderSees.items.map { it.subjectUserId }.toSet(), "$area")
        }
    }

    /** documentId → "details present", for every row [viewer] gets from [target]'s log of [area]. */
    private suspend fun listed(
        service: ch.nokillswit.activity.ActivityService,
        target: UInt,
        viewer: UInt,
        scope: ActivityScope,
        area: ActivityArea,
        shares: Boolean = false,
    ): Map<UInt, Boolean> {
        val seen = mutableMapOf<UInt, Boolean>()
        val seenIds = mutableListOf<String>()
        var page = 1
        while (true) {
            val result = service.list(
                target,
                ActivityViewer(viewer, emptySet(), scope),
                ActivityFilter(area = area),
                PageRequest(page, 100, listOf(SortField("createdAt", descending = true))),
            )
            val ids = result.items.map { it.id }
            assertEquals(ids.size, ids.toSet().size, "duplicate row ids on one page")
            seenIds += ids
            // Event rows and share rows of one log are told apart by the synthetic id's SOURCE part.
            result.items.filter { (":EVENT:" in it.id) != shares }.forEach { seen[it.documentId!!] = it.details != null }
            if (page * 100 >= result.total) {
                assertEquals(result.total, seenIds.size.toLong(), "the pages' rows must add up to total")
                assertEquals(seenIds.size, seenIds.toSet().size, "a row repeated across pages")
                break
            }
            page++
        }
        return seen
    }

    // ——— raw seeding (no service validations: the point is to cover every status × relationship) ———

    private suspend fun event(table: EventLogTable, ownerId: UInt, actor: UInt, at: Long) {
        table.insert {
            it[table.ownerId] = ownerId
            it[table.userId] = actor
            it[table.timestamp] = at
            it[table.eventType] = "CREATED"
            it[table.params] = "{}"
        }
    }

    private suspend fun feedback(
        provider: UInt,
        recipients: List<UInt>,
        requester: UInt?,
        visibility: FeedbackVisibility,
        status: FeedbackStatus,
        now: Long,
        deleted: Boolean,
    ): Doc {
        val id = Feedbacks.insert {
            it[requesterId] = requester
            it[subjectId] = recipients.first()
            it[providerId] = provider
            it[Feedbacks.visibility] = visibility
            it[Feedbacks.status] = status
            it[content] = ""
            it[lastModified] = now
            it[markedAsDeleted] = deleted
        }[Feedbacks.id].value
        recipients.forEachIndexed { index, user ->
            FeedbackSubjects.insert {
                it[feedbackId] = id
                it[userId] = user
                it[position] = index
            }
        }
        return Doc(ActivityArea.FEEDBACK, id)
    }

    private suspend fun meeting(manager: UInt, subordinate: UInt, date: String, now: Long, deleted: Boolean): Doc =
        Doc(
            ActivityArea.ONE_ON_ONE,
            Meetings.insert {
                it[managerId] = manager
                it[subordinateId] = subordinate
                it[meetingDate] = date
                it[lastModified] = now
                it[markedAsDeleted] = deleted
            }[Meetings.id].value,
        )

    private suspend fun goal(manager: UInt, subordinate: UInt, status: GoalStatus, now: Long, deleted: Boolean): Doc =
        Doc(
            ActivityArea.GOAL,
            Goals.insert {
                it[managerId] = manager
                it[subordinateId] = subordinate
                it[createdAt] = now
                it[dueDate] = "2099-12-31"
                it[title] = "parity goal"
                it[description] = ""
                it[type] = GoalType.NUMBER
                it[Goals.status] = status
                it[lastModified] = now
                it[markedAsDeleted] = deleted
            }[Goals.id].value,
        )

    private suspend fun kpi(team: UInt, creator: UInt, status: TeamKpiStatus, now: Long, deleted: Boolean): Doc =
        Doc(
            ActivityArea.TEAM_KPI,
            TeamKpis.insert {
                it[teamId] = team
                it[createdBy] = creator
                it[createdAt] = now
                it[title] = "parity kpi"
                it[description] = ""
                it[type] = TeamKpiType.NUMBER
                it[targetValue] = 1.0
                it[targetDirection] = ch.nokillswit.goals.TargetDirection.AT_LEAST
                it[currentValue] = 0.0
                it[TeamKpis.status] = status
                it[lastModified] = now
                it[markedAsDeleted] = deleted
            }[TeamKpis.id].value,
        )

    private suspend fun review(
        manager: UInt,
        subordinate: UInt,
        period: UInt,
        status: PerformanceReviewStatus,
        now: Long,
        deleted: Boolean,
    ): Doc =
        Doc(
            ActivityArea.PERFORMANCE_REVIEW,
            Reviews.insert {
                it[managerId] = manager
                it[subordinateId] = subordinate
                it[periodId] = period
                it[createdAt] = now
                it[Reviews.status] = status
                it[lastModified] = now
                it[markedAsDeleted] = deleted
            }[Reviews.id].value,
        )

    private suspend fun entry(owner: UInt, now: Long, deleted: Boolean): Doc =
        Doc(
            ActivityArea.IMPACT_LOG_ENTRY,
            Entries.insert {
                it[userId] = owner
                it[title] = "parity entry"
                it[periodStart] = "2026-01-01"
                it[periodEnd] = "2026-01-31"
                it[whatHappened] = ""
                it[contribution] = ""
                it[whyItMattered] = ""
                it[evidence] = ""
                it[createdAt] = now
                it[lastModified] = now
                it[markedAsDeleted] = deleted
            }[Entries.id].value,
        )

    private suspend fun plan(owner: UInt, seat: UInt, now: Long, deleted: Boolean): Doc =
        Doc(
            ActivityArea.SUCCESSION_PLAN,
            Plans.insert {
                it[managerId] = owner
                it[userId] = seat
                it[roleCriticality] = RoleCriticality.CRITICAL
                it[retentionRisk] = RetentionRisk.HIGH
                it[lossImpact] = "[]"
                it[targetBenchDepth] = 1
                it[Plans.status] = SuccessionPlanStatus.OPEN
                it[createdAt] = now
                it[lastReviewedAt] = now
                it[markedAsDeleted] = deleted
            }[Plans.id].value,
        )
}
