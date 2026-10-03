package ch.nokillswit.perf

import ch.nokillswit.daysoff.PublicHolidayService
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.r2dbc.selectAll
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import java.time.LocalDate

/** Easter Sunday by the anonymous Gregorian algorithm (Meeus/Jones/Butcher). */
private fun easter(year: Int): LocalDate {
    val a = year % 19
    val b = year / 100
    val c = year % 100
    val d = b / 4
    val e = b % 4
    val f = (b + 8) / 25
    val g = (b - f + 1) / 3
    val h = (19 * a + b - d - g + 15) % 30
    val i = c / 4
    val k = c % 4
    val l = (32 + 2 * e + 2 * i - h - k) % 7
    val m = (a + 11 * h + 22 * l) / 451
    val month = (h + l - 7 * m + 114) / 31
    val day = (h + l - 7 * m + 114) % 31 + 1
    return LocalDate.of(year, month, day)
}

/** The Polish statutory holidays of [year] — the V41 seed's set (Christmas Eve is statutory since 2025). */
private fun polishHolidays(year: Int): List<Pair<LocalDate, String>> {
    val easter = easter(year)
    return buildList {
        add(LocalDate.of(year, 1, 1) to "Nowy Rok")
        add(LocalDate.of(year, 1, 6) to "Święto Trzech Króli")
        add(easter to "Wielkanoc")
        add(easter.plusDays(1) to "Poniedziałek Wielkanocny")
        add(LocalDate.of(year, 5, 1) to "Święto Pracy")
        add(LocalDate.of(year, 5, 3) to "Święto Konstytucji 3 Maja")
        add(easter.plusDays(49) to "Zielone Świątki")
        add(easter.plusDays(60) to "Boże Ciało")
        add(LocalDate.of(year, 8, 15) to "Wniebowzięcie Najświętszej Maryi Panny")
        add(LocalDate.of(year, 11, 1) to "Wszystkich Świętych")
        add(LocalDate.of(year, 11, 11) to "Narodowe Święto Niepodległości")
        if (year >= 2025) add(LocalDate.of(year, 12, 24) to "Wigilia Bożego Narodzenia")
        add(LocalDate.of(year, 12, 25) to "Boże Narodzenie (pierwszy dzień)")
        add(LocalDate.of(year, 12, 26) to "Boże Narodzenie (drugi dzień)")
    }
}

/**
 * The `public_holidays` registry over the whole window: the V41 migration seeds 2026–2027, this adds every
 * missing statutory date from the first history year to the year after the anchor (the days-off cost math
 * freezes at creation against exactly this set). Returns every holiday date the registry holds afterwards.
 */
suspend fun seedPublicHolidays(ctx: SeedContext): Set<LocalDate> {
    val table = PublicHolidayService.PublicHolidays
    val existing = suspendTransaction(ctx.db) {
        table.selectAll().map { LocalDate.parse(it[table.holidayDate]) }.toList().toSet()
    }
    val firstYear = ctx.config.anchor.minusMonths(ctx.spec.months.toLong()).year
    val missing = (firstYear..ctx.config.anchor.year + 1).flatMap(::polishHolidays).filter { it.first !in existing }
    val ids = IdCounter(nextFreeId(ctx.db, table))
    val sink = RowSink<Pair<LocalDate, String>>(ctx.db, table) { (date, name) ->
        this[table.id] = ids.take()
        this[table.holidayDate] = date.toString()
        this[table.name] = name
        this[table.createdAt] = ctx.millis(ctx.config.anchor.minusMonths(ctx.spec.months.toLong()), 8)
    }
    missing.forEach(sink::add)
    sink.flush()
    advanceSequences(ctx.db, listOf(table))
    return existing + missing.map { it.first }
}
