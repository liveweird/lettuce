package ch.nokillswit.perf

import ch.nokillswit.feedbacks.Feedback
import ch.nokillswit.feedbacks.FeedbackEventService
import ch.nokillswit.feedbacks.FeedbackService
import ch.nokillswit.feedbacks.FeedbackStatus
import ch.nokillswit.feedbacks.FeedbackVisibility
import ch.nokillswit.feedbacks.feedbackCreationEvent
import ch.nokillswit.feedbacks.feedbackCreationNotifications
import ch.nokillswit.feedbacks.feedbackTransitionNotifications
import ch.nokillswit.feedbacks.feedbackUpdateEvent
import java.time.LocalDate

private class FeedbackRow(
    val id: UInt,
    val feedback: Feedback,
    val content: String,
    val requesterMessage: String?,
    val lastModified: Long,
)

private class SubjectRow(val feedbackId: UInt, val userId: UInt, val position: Int)

/** The lifecycle a feedback takes — the statuses it passes through, in order, ending in its stored status. */
private enum class Path(val statuses: List<FeedbackStatus>) {
    SENT_DIRECT(listOf(FeedbackStatus.SENT)),
    DRAFT_THEN_SENT(listOf(FeedbackStatus.DRAFT, FeedbackStatus.SENT)),
    REQUESTED_THEN_SENT(listOf(FeedbackStatus.REQUESTED, FeedbackStatus.DRAFT, FeedbackStatus.SENT)),
    SENT_THEN_WITHDRAWN(listOf(FeedbackStatus.SENT, FeedbackStatus.WITHDRAWN)),
    REQUESTED_THEN_REJECTED(listOf(FeedbackStatus.REQUESTED, FeedbackStatus.REJECTED)),
    OPEN_REQUESTED(listOf(FeedbackStatus.REQUESTED)),
    OPEN_DRAFT(listOf(FeedbackStatus.DRAFT)),
    ;

    val requested get() = statuses.first() == FeedbackStatus.REQUESTED
    val open get() = this == OPEN_REQUESTED || this == OPEN_DRAFT
}

private const val OPEN_WINDOW_DAYS = 60L

/**
 * Feedbacks: one per person per month as the PROVIDER (≈ 30.7k at scale 1.0), 1–4 recipients (75/15/6/4 %,
 * the provider never among them), mostly delivered. Paths — direct SENT 42 %, DRAFT → SENT 40 %,
 * REQUESTED → DRAFT → SENT 8 %, SENT → WITHDRAWN 5 %, REQUESTED → REJECTED 5 % — and, only for rows
 * created in the last 60 days, an open REQUESTED (8 %) or DRAFT (8 %) row, never two open rows of one
 * provider for the same recipient (the no-duplicate rule, "No-duplicate invariant" in
 * `.claude/docs/features/feedbacks.md`). A requested feedback addresses exactly ONE person (the
 * requester) and never PROVIDER_SUBJECT visibility; PROVIDER_REQUESTER needs a requester.
 * Events by rule (`feedbacks/FeedbackEvents.kt`): `feedbackCreationEvent` + `feedbackUpdateEvent` per
 * edge, actor = the creator (the requester for a requested row) then the provider; notifications via
 * `feedbackCreationNotifications`/`feedbackTransitionNotifications`, retention-shaped by [NotificationMint].
 */
suspend fun seedFeedbacks(ctx: SeedContext, org: Org, mint: NotificationMint) {
    val rng = ctx.rng("feedbacks")
    val db = ctx.db
    val feedbacks = RowSink<FeedbackRow>(db, FeedbackService.Feedbacks) { r ->
        val t = FeedbackService.Feedbacks
        this[t.id] = r.id
        this[t.requesterId] = r.feedback.requesterId
        this[t.subjectId] = r.feedback.subjectId
        this[t.providerId] = r.feedback.providerId
        this[t.visibility] = r.feedback.visibility
        this[t.status] = r.feedback.status
        this[t.content] = r.content
        this[t.requesterMessage] = r.requesterMessage
        this[t.expiresOn] = null
        this[t.lastModified] = r.lastModified
    }
    val subjects = RowSink<SubjectRow>(db, FeedbackService.FeedbackSubjects) { s ->
        this[FeedbackService.FeedbackSubjects.feedbackId] = s.feedbackId
        this[FeedbackService.FeedbackSubjects.userId] = s.userId
        this[FeedbackService.FeedbackSubjects.position] = s.position
    }
    val events = eventSink(db, FeedbackEventService.FeedbackEvents)
    val group = SinkGroup(feedbacks, subjects, events)
    val feedbackIds = IdCounter(nextFreeId(db, FeedbackService.Feedbacks))
    val eventIds = IdCounter(nextFreeId(db, FeedbackEventService.FeedbackEvents))
    val openRecipients = HashMap<UInt, MutableSet<UInt>>() // provider → recipients of their open rows
    val firstMonth = ctx.config.anchor.withDayOfMonth(1).minusMonths(ctx.spec.months.toLong())
    val everyone = org.people.map { it.id }

    for (m in 0 until ctx.spec.months) {
        val monthStart = firstMonth.plusMonths(m.toLong())
        for (provider in org.people) {
            val created = monthStart.plusDays(rng.int(0, 26).toLong())
            val recent = created >= ctx.config.anchor.minusDays(OPEN_WINDOW_DAYS)
            var path = pickPath(rng, recent)
            var recipients = pickRecipients(rng, org, provider, everyone, single = path.requested)
            if (path.open && recipients.any { it in openRecipients[provider.id].orEmpty() }) {
                path = Path.SENT_DIRECT
                recipients = pickRecipients(rng, org, provider, everyone, single = false)
            }
            if (path.open) openRecipients.getOrPut(provider.id) { mutableSetOf() }.addAll(recipients)
            val requester = if (path.requested) recipients.single() else null
            val feedback = Feedback(
                requesterId = requester,
                subjectId = recipients.first(),
                additionalSubjectIds = recipients.drop(1),
                providerId = provider.id,
                visibility = pickVisibility(rng, requester != null),
                status = path.statuses.last(),
                content = "",
            )
            val id = feedbackIds.take()
            val story = FeedbackStory(ctx, org, mint, events, eventIds, id, feedback, created)
            story.tell(rng, path)
            // The draw always happens (stable RNG stream); a request that was never picked up — still open, or
            // rejected — has no content (a provider writes content only after the REQUESTED → DRAFT edge).
            val drawn = Text.paragraph(rng, 200, 700)
            val content = if (path.requested && FeedbackStatus.DRAFT !in path.statuses) "" else drawn
            val message = if (requester != null && rng.chance(0.5)) ctx.cipher.encrypt(Text.paragraph(rng, 40, 160)) else null
            feedbacks.add(FeedbackRow(id, feedback, ctx.cipher.encrypt(content), message, story.lastModified))
            recipients.forEachIndexed { position, userId -> subjects.add(SubjectRow(id, userId, position)) }
        }
        group.flush()
        mint.sinkGroup.flush()
    }
    advanceSequences(db, listOf(FeedbackService.Feedbacks, FeedbackEventService.FeedbackEvents))
}

private fun pickPath(rng: Rng, recent: Boolean): Path {
    if (recent) {
        val roll = rng.double()
        if (roll < 0.08) return Path.OPEN_REQUESTED
        if (roll < 0.16) return Path.OPEN_DRAFT
    }
    val roll = rng.int(1, 100)
    return when {
        roll <= 42 -> Path.SENT_DIRECT
        roll <= 82 -> Path.DRAFT_THEN_SENT
        roll <= 90 -> Path.REQUESTED_THEN_SENT
        roll <= 95 -> Path.SENT_THEN_WITHDRAWN
        else -> Path.REQUESTED_THEN_REJECTED
    }
}

/** Distinct recipients, never the provider: mostly the provider's own circle, sometimes anyone. */
private fun pickRecipients(rng: Rng, org: Org, provider: Person, everyone: List<UInt>, single: Boolean): List<UInt> {
    val count = if (single) 1 else when (rng.int(1, 100)) {
        in 1..75 -> 1
        in 76..90 -> 2
        in 91..96 -> 3
        else -> 4
    }
    val circle = org.teammates(provider) + listOfNotNull(provider.managerId) + org.reports[provider.id].orEmpty().map { it.id }
    val picked = LinkedHashSet<UInt>()
    while (picked.size < count) {
        val candidate = if (circle.isNotEmpty() && rng.chance(0.6)) rng.pick(circle) else rng.pick(everyone)
        if (candidate != provider.id) picked.add(candidate)
    }
    return picked.toList()
}

private fun pickVisibility(rng: Rng, hasRequester: Boolean): FeedbackVisibility = if (hasRequester) {
    rng.pick(
        listOf(
            FeedbackVisibility.PROVIDER_REQUESTER, FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT,
            FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT, FeedbackVisibility.PUBLIC,
        ),
    )
} else {
    when (rng.int(1, 100)) {
        in 1..55 -> FeedbackVisibility.PROVIDER_SUBJECT
        in 56..70 -> FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT
        else -> FeedbackVisibility.PUBLIC
    }
}

/** Narrates one feedback's lifecycle as events and notifications. */
private class FeedbackStory(
    private val ctx: SeedContext,
    private val org: Org,
    private val mint: NotificationMint,
    private val events: RowSink<EventRow>,
    private val eventIds: IdCounter,
    private val id: UInt,
    private val stored: Feedback,
    created: LocalDate,
) {
    private var day = created
    private var minute = 0
    var lastModified: Long = ctx.millis(created, 9)
        private set

    /** The next step's moment; past the anchor, scattered over the last 30 days (never before the previous step). */
    private fun at(rng: Rng): Long = ctx.spreadMillis(rng, ctx.rawMillis(day, 9, minute++), floor = lastModified).also { lastModified = it }

    /** The recipients' direct managers, with each manager's own recipients — what the SENT notes need. */
    private fun managerMaps(): Pair<Map<UInt, String>, Map<UInt, Set<UInt>>> {
        val byManager = stored.subjectIds.mapNotNull { s -> org.byId[s]?.managerId?.let { it to s } }
            .groupBy({ it.first }, { it.second }).mapValues { it.value.toSet() }
        return byManager.keys.associateWith { org.names.getValue(it) } to byManager
    }

    fun tell(rng: Rng, path: Path) {
        val (managerNames, recipientsByManager) = managerMaps()
        val creator = stored.requesterId ?: stored.providerId
        val first = stored.copy(status = path.statuses.first())
        val creation = feedbackCreationEvent(first)
        val createdAt = at(rng)
        events.add(EventRow(eventIds.take(), id, creator, createdAt, creation.type.name, creation.params))
        mint.emitAll(feedbackCreationNotifications(id, first, org.names, managerNames, recipientsByManager), createdAt)
        path.statuses.zipWithNext().forEach { (from, to) ->
            day = day.plusDays(rng.int(1, 5).toLong())
            val before = stored.copy(status = from)
            val after = stored.copy(status = to)
            val update = checkNotNull(feedbackUpdateEvent(before, after)) { "a status edge always mints an event" }
            val atEdge = at(rng)
            events.add(EventRow(eventIds.take(), id, stored.providerId, atEdge, update.type.name, update.params))
            mint.emitAll(
                feedbackTransitionNotifications(id, from, after, org.names, managerNames, recipientsByManager),
                atEdge,
            )
        }
    }
}
