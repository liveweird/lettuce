package ch.nokillswit.infra.db

import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference
import kotlin.coroutines.AbstractCoroutineContextElement
import kotlin.coroutines.CoroutineContext

/**
 * The statement the request spent the longest on: [nanos] of database window and its SQL TEMPLATE
 * (`?` placeholders — never the bind values).
 */
class SlowestStatement(val nanos: Long, val sql: String)

/**
 * Per-request database work counters — what a request did to PostgreSQL, readable in the response's
 * `Server-Timing` header and the slow-request log line (`server/.../plugins/RequestTiming.kt`,
 * `.claude/docs/performance.md`).
 *
 * **Why this lives in `core`:** the element must exist exactly ONCE per JVM class-loader tree. In
 * `./gradlew :server:run` (Ktor's dev-mode reload) the application's own classes are loaded by a child
 * class loader while Exposed instantiates its `GlobalSuspendStatementInterceptor` providers in the
 * application loader; an element class defined in `server` was therefore loaded twice, the
 * interceptor's `coroutineContext[RequestDbMetrics]` key never matched the plugin's, and every counter
 * stayed 0. `core` is a jar both loaders resolve through the parent, so there is one copy. It depends on
 * the Kotlin stdlib only (no Exposed, no kotlinx.coroutines), which is why `core` needs no new dependency.
 *
 * A coroutine-context element installed per request in the Setup phase of the call pipeline (so it covers
 * the JWT validation's blocklist read and every route transaction); no ThreadLocal. The counters are
 * atomic because a request may run statements concurrently (`async` inside a handler).
 *
 * What the numbers mean:
 *  - [statements] — SQL statements Exposed dispatched (a multi-row `batchInsert` counts every row; the
 *    `SELECT 1` connection validation of the pool is NOT counted — it runs below Exposed).
 *  - [transactions] — `suspendTransaction` blocks that committed or rolled back. Every one is a pool
 *    acquire, and since v4.7.1 every acquire is a REMOTE validation round trip, so `tx` ≈ the number of
 *    extra validation round trips the request paid on top of its statements.
 *  - [dbNanos] — the sum of the statement windows (see `RequestDbMetricsInterceptor`: dispatch of a
 *    statement to the next boundary on its transaction — an upper bound on pure database time, it includes
 *    Kotlin work between two statements of one transaction and excludes COMMIT and pool acquire/validation).
 *    Concurrent transactions overlap, so the sum can exceed wall time.
 */
class RequestDbMetrics : AbstractCoroutineContextElement(Key) {
    companion object Key : CoroutineContext.Key<RequestDbMetrics>

    private val statementCount = AtomicInteger()
    private val transactionCount = AtomicInteger()
    private val totalNanos = AtomicLong()
    private val slowestStatement = AtomicReference<SlowestStatement?>()

    val statements: Int get() = statementCount.get()
    val transactions: Int get() = transactionCount.get()
    val dbNanos: Long get() = totalNanos.get()
    val slowest: SlowestStatement? get() = slowestStatement.get()

    /**
     * Records one statement whose window lasted [nanos]. [sql] renders the template and is invoked ONLY when the
     * statement becomes the request's slowest so far (rendering needs the still-open transaction: a lazily
     * rendered template fails once the transaction has closed — measured 2026-10-03 — so it cannot be deferred
     * to the slow-request log).
     */
    fun recordStatement(nanos: Long, sql: () -> String) {
        statementCount.incrementAndGet()
        totalNanos.addAndGet(nanos)
        val current = slowestStatement.get()
        if (current == null || nanos > current.nanos) {
            val candidate = SlowestStatement(nanos, runCatching(sql).getOrDefault("<sql unavailable>"))
            slowestStatement.updateAndGet { c -> if (c == null || candidate.nanos > c.nanos) candidate else c }
        }
    }

    fun recordTransaction() {
        transactionCount.incrementAndGet()
    }
}
