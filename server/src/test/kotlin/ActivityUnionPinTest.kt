package ch.nokillswit

import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.toList
import ch.nokillswit.activity.anyOf
import kotlinx.coroutines.runBlocking
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.r2dbc.*
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * The step-1 pin of the activity log's query architecture (the architect plan's "first task"):
 * Exposed's `UNION ALL` over several tables must render `ORDER BY` against the OUTPUT ALIASES,
 * honour `limit`/`offset`, answer `count()` over the union, and bind a long id set ONCE as an
 * `= ANY(array)` — all against the real PostgreSQL Testcontainer. If any of this stops holding
 * the `ActivityService` falls back to the V87 `CREATE VIEW` contingency (see
 * `.claude/docs/features/activity-log.md`). Scratch tables are TEMP + `ON COMMIT DROP`, so the
 * shared container keeps no residue.
 */
class ActivityUnionPinTest {
    private object PinA : Table("pin_a") {
        val id = integer("id")
        val userId = integer("user_id")
        val createdAt = long("created_at")
    }

    private object PinB : Table("pin_b") {
        val id = integer("id")
        val userId = integer("user_id")
        val createdAt = long("created_at")
    }

    private fun branch(
        table: Table,
        id: Column<Int>,
        createdAt: Column<Long>,
        area: String,
        where: Op<Boolean>,
    ): Query = table.select(
        stringLiteral(area).alias("area"),
        id.alias("event_id"),
        createdAt.alias("created_at"),
    ).where { where }

    @Test
    fun `union all orders by output aliases, pages, counts and binds an array once`() = runBlocking {
        TestServices.database // forces the schema migration + a connection to the container
        suspendTransaction(TestServices.database) {
            exec("CREATE TEMP TABLE pin_a (id INT, user_id INT, created_at BIGINT) ON COMMIT DROP")
            exec("CREATE TEMP TABLE pin_b (id INT, user_id INT, created_at BIGINT) ON COMMIT DROP")
            // Same instant (100) in both branches -> the (area, event_id DESC) tiebreak decides.
            listOf(1 to 100L, 2 to 100L, 3 to 300L, 4 to 50L).forEach { (id, at) ->
                exec("INSERT INTO pin_a VALUES ($id, 7, $at)")
            }
            listOf(1 to 100L, 2 to 200L, 3 to 100L).forEach { (id, at) ->
                exec("INSERT INTO pin_b VALUES (${id + 10}, 7, $at)")
            }
            exec("INSERT INTO pin_b VALUES (99, 8, 999)") // another user — filtered out

            val first = branch(PinA, PinA.id, PinA.createdAt, "A", PinA.userId eq 7)
            val area = first.set.fields[0] as Expression<String>
            val eventId = first.set.fields[1] as Expression<Int>
            val createdAt = first.set.fields[2] as Expression<Long>
            fun union(): SetOperation {
                val a = branch(PinA, PinA.id, PinA.createdAt, "A", PinA.userId eq 7)
                val b = branch(PinB, PinB.id, PinB.createdAt, "B", PinB.userId eq 7)
                return a.unionAll(b)
            }

            fun SetOperation.ordered() = orderBy(
                createdAt to SortOrder.DESC, area to SortOrder.ASC, eventId to SortOrder.DESC,
            )

            val all = union().ordered().map { row ->
                "${row[area]}${row[eventId]}"
            }.toList()
            // 300 first; then the three 200/100 rows by time, ties by area ASC then id DESC.
            // created_at: A3=300, B12=200, then the 100s — area ASC, id DESC: A2, A1, B13, B11 — then A4=50.
            assertEquals(listOf("A3", "B12", "A2", "A1", "B13", "B11", "A4"), all)

            val firstPage = union().ordered().limit(3).offset(0).map { row ->
                "${row[area]}${row[eventId]}"
            }.toList()
            val secondPage = union().ordered().limit(3).offset(3).map { row ->
                "${row[area]}${row[eventId]}"
            }.toList()
            assertEquals(all.take(3), firstPage)
            assertEquals(all.drop(3).take(3), secondPage)
            assertEquals(7L, union().count())

            // One bound array instead of N placeholders (correction 8: the 65,535-bind cap).
            val viaArray = PinA.select(PinA.id).where { PinA.userId eq anyFrom(arrayOf(7, 9, 11)) }
                .map { it[PinA.id] }.toList()
            assertEquals(4, viaArray.size)
        }
    }

    @Test
    fun `the chain predicate binds its id set as ONE array parameter`() = runBlocking {
        TestServices.database
        suspendTransaction(TestServices.database) {
            val ids = (1u..500u).toList()
            val query = ch.nokillswit.goals.GoalService.Goals.select(ch.nokillswit.goals.GoalService.Goals.id)
                .where { ch.nokillswit.goals.GoalService.Goals.subordinateId.anyOf(ids) }
            val sql = query.prepareSQL(QueryBuilder(true))
            assertEquals(1, Regex("\\$\\d+|\\?").findAll(sql.substringAfter("WHERE")).count(), sql)
            // And it executes (the cast int8 = ANY(int8[]) against the real column).
            query.toList()
            assertEquals(Op.FALSE, ch.nokillswit.goals.GoalService.Goals.subordinateId.anyOf(emptyList()))
        }
    }
}
