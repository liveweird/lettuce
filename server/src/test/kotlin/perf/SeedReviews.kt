package ch.nokillswit.perf

import ch.nokillswit.reviews.PerformanceReviewEventDescriptor
import ch.nokillswit.reviews.PerformanceReviewEventService
import ch.nokillswit.reviews.PerformanceReviewEventType
import ch.nokillswit.reviews.PerformanceReviewService
import ch.nokillswit.reviews.PerformanceReviewStatus
import ch.nokillswit.reviews.ReviewCategory
import ch.nokillswit.reviews.ReviewPeriodService
import ch.nokillswit.reviews.reviewCreationEvent
import ch.nokillswit.reviews.reviewTransitionEvent
import ch.nokillswit.reviews.reviewTransitionNotifications
import org.jetbrains.exposed.v1.core.Column
import org.jetbrains.exposed.v1.core.statements.BatchInsertStatement
import java.time.LocalDate
import java.time.YearMonth

class GeneratedPeriod(val id: UInt, val start: YearMonth, val end: YearMonth)

/**
 * Gapless half-year `review_periods` (Jan–Jun / Jul–Dec): from the first half-year starting at or
 * after the history window's start to the half-year containing the anchor — 10 rows at scale 1.0
 * (9 past + the current one, which contains today so the SPA's default period resolves).
 */
suspend fun seedReviewPeriods(ctx: SeedContext): List<GeneratedPeriod> {
    val currentStart = YearMonth.of(ctx.config.anchor.year, if (ctx.config.anchor.monthValue <= 6) 1 else 7)
    val windowStart = YearMonth.from(ctx.config.anchor).minusMonths(ctx.spec.months.toLong())
    val firstStart = generateSequence(windowStart) { it.plusMonths(1) }.first { it.monthValue == 1 || it.monthValue == 7 }
        .let { if (it > currentStart) currentStart else it }
    val periods = ReviewPeriodService.ReviewPeriods
    val ids = IdCounter(nextFreeId(ctx.db, periods))
    val generated = generateSequence(firstStart) { it.plusMonths(6) }.takeWhile { it <= currentStart }
        .map { GeneratedPeriod(ids.take(), it, it.plusMonths(5)) }.toList()
    val sink = RowSink<GeneratedPeriod>(ctx.db, periods) { p ->
        this[periods.id] = p.id
        this[periods.startMonth] = p.start.toString()
        this[periods.endMonth] = p.end.toString()
        this[periods.createdAt] = ctx.millis(p.start.atDay(1).minusDays(1))
    }
    generated.forEach(sink::add)
    sink.flush()
    advanceSequences(ctx.db, listOf(periods))
    return generated
}

private class ReviewRow(
    val id: UInt,
    val managerId: UInt,
    val subordinateId: UInt,
    val periodId: UInt,
    val createdAt: Long,
    val status: PerformanceReviewStatus,
    val lastModified: Long,
    /** Encrypted (rating, summary) per category; null = not assessed yet (a partial DRAFT). */
    val assessments: Map<ReviewCategory, Pair<String, String>>,
)

private val ReviewCategory.columns: Pair<Column<String?>, Column<String?>>
    get() = with(PerformanceReviewService.Reviews) {
        when (this@columns) {
            ReviewCategory.ATTITUDE -> attitudeRating to attitudeSummary
            ReviewCategory.DELIVERY -> deliveryRating to deliverySummary
            ReviewCategory.SKILLS -> skillsRating to skillsSummary
            ReviewCategory.APTITUDE -> aptitudeRating to aptitudeSummary
            ReviewCategory.OVERALL -> overallRating to overallSummary
        }
    }

private fun BatchInsertStatement.bindReview(r: ReviewRow) {
    val reviews = PerformanceReviewService.Reviews
    this[reviews.id] = r.id
    this[reviews.managerId] = r.managerId
    this[reviews.subordinateId] = r.subordinateId
    this[reviews.periodId] = r.periodId
    this[reviews.createdAt] = r.createdAt
    this[reviews.status] = r.status
    ReviewCategory.entries.forEach { category ->
        val (ratingColumn, summaryColumn) = category.columns
        this[ratingColumn] = r.assessments[category]?.first
        this[summaryColumn] = r.assessments[category]?.second
    }
    this[reviews.lastModified] = r.lastModified
}

/**
 * Reviews: one per (subordinate, period) for everyone with a manager — every PAST period PUBLISHED
 * (five encrypted ratings + five encrypted summaries), the CURRENT period a 30/20/50 % DRAFT/
 * CALIBRATION/PUBLISHED mix (a DRAFT may be partially assessed). Events by rule
 * (`reviews/PerformanceReviewEvents.kt`, "Performance reviews" in
 * `.claude/docs/features/performance-reviews.md`): CREATED by the manager, one RATING_CHANGED +
 * SUMMARY_CHANGED per assessed category (canonical order, ratings before summaries — the fill PUT),
 * then the STATUS_CHANGED edges the status implies; params carry category/status names only, never
 * values. Notifications: only CALIBRATION → PUBLISHED notifies (the published-to-subordinate note).
 */
suspend fun seedReviews(ctx: SeedContext, org: Org, periods: List<GeneratedPeriod>, mint: NotificationMint) {
    val rng = ctx.rng("reviews")
    val reviews = RowSink<ReviewRow>(ctx.db, PerformanceReviewService.Reviews) { bindReview(it) }
    val events = eventSink(ctx.db, PerformanceReviewEventService.ReviewEvents)
    val reviewIds = IdCounter(nextFreeId(ctx.db, PerformanceReviewService.Reviews))
    val eventIds = IdCounter(nextFreeId(ctx.db, PerformanceReviewEventService.ReviewEvents))
    val group = SinkGroup(reviews, events)
    val current = periods.last()

    for (period in periods) {
        val periodEnd: LocalDate = period.end.atEndOfMonth()
        val periodBase = minOf(periodEnd.minusDays(20), ctx.config.anchor.minusDays(25))
        for (person in org.managed) {
            val status = if (period != current) PerformanceReviewStatus.PUBLISHED else when {
                rng.chance(0.3) -> PerformanceReviewStatus.DRAFT
                rng.chance(0.2 / 0.7) -> PerformanceReviewStatus.CALIBRATION
                else -> PerformanceReviewStatus.PUBLISHED
            }
            val assessed = if (status == PerformanceReviewStatus.DRAFT) rng.int(0, 5) else ReviewCategory.entries.size
            val assessments = assess(ctx, rng, assessed)
            val day = periodBase.plusDays(rng.int(0, 10).toLong())
            val managerId = person.managerId!!
            val reviewId = reviewIds.take()
            val created = ctx.millis(day, hour = 9)
            val published = ctx.millis(day.plusDays(8), hour = 15)
            reviews.add(
                ReviewRow(
                    reviewId, managerId, person.id, period.id, created, status,
                    when (status) {
                        PerformanceReviewStatus.DRAFT -> ctx.millis(day.plusDays(1), hour = 11)
                        PerformanceReviewStatus.CALIBRATION -> ctx.millis(day.plusDays(4), hour = 13)
                        PerformanceReviewStatus.PUBLISHED -> published
                    },
                    assessments,
                ),
            )
            var minute = 0
            fun event(descriptor: PerformanceReviewEventDescriptor) {
                events.add(
                    EventRow(
                        eventIds.take(), reviewId, managerId, ctx.millis(day, hour = 9, minuteOffset = minute++),
                        descriptor.type.name, descriptor.params,
                    ),
                )
            }
            event(reviewCreationEvent())
            ReviewCategory.entries.filter { it in assessments }.forEach { category ->
                event(PerformanceReviewEventDescriptor(PerformanceReviewEventType.RATING_CHANGED, mapOf("category" to category.name)))
                event(PerformanceReviewEventDescriptor(PerformanceReviewEventType.SUMMARY_CHANGED, mapOf("category" to category.name)))
            }
            if (status != PerformanceReviewStatus.DRAFT) {
                event(reviewTransitionEvent(PerformanceReviewStatus.DRAFT, PerformanceReviewStatus.CALIBRATION))
            }
            if (status == PerformanceReviewStatus.PUBLISHED) {
                event(reviewTransitionEvent(PerformanceReviewStatus.CALIBRATION, PerformanceReviewStatus.PUBLISHED))
                mint.emitAll(
                    reviewTransitionNotifications(
                        reviewId, PerformanceReviewStatus.CALIBRATION, PerformanceReviewStatus.PUBLISHED,
                        person.id, org.names.getValue(managerId), period.start.toString(), period.end.toString(),
                    ),
                    published,
                )
            }
        }
        group.flush()
        mint.sinkGroup.flush()
    }
    advanceSequences(ctx.db, listOf(PerformanceReviewService.Reviews, PerformanceReviewEventService.ReviewEvents))
}

/** Ratings 1–6 (a bell around 4), summaries 150–400 chars; the first [count] categories, all encrypted. */
private fun assess(ctx: SeedContext, rng: Rng, count: Int): Map<ReviewCategory, Pair<String, String>> =
    ReviewCategory.entries.take(count).associateWith {
        val rating = rng.bell(4.0, 1.5, 1, 6)
        ctx.cipher.encrypt(rating.toString()) to ctx.cipher.encrypt(Text.paragraph(rng, 150, 400))
    }
