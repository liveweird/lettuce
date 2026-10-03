package ch.nokillswit.infra.db

import kotlinx.coroutines.currentCoroutineContext
import org.jetbrains.exposed.v1.core.Key
import org.jetbrains.exposed.v1.core.statements.StatementContext
import org.jetbrains.exposed.v1.r2dbc.R2dbcTransaction
import org.jetbrains.exposed.v1.r2dbc.statements.GlobalSuspendStatementInterceptor

/**
 * Feeds the per-request [RequestDbMetrics] element (defined in the `core` module — one copy per JVM
 * class-loader tree, see its KDoc) from Exposed's global statement interceptor SPI — loaded by
 * `R2dbcTransaction` through `ServiceLoader` from
 * `META-INF/services/org.jetbrains.exposed.v1.r2dbc.statements.GlobalSuspendStatementInterceptor`,
 * so it is JVM-global: it also runs under the test suite and the perf seed generator, where it is a
 * no-op (one `coroutineContext[RequestDbMetrics]` lookup — no element, nothing recorded).
 *
 * The hooks are `suspend`, so [currentCoroutineContext] is the request's context.
 *
 * **Timing semantics — the 2026-10-03 spike, pinned by `RequestTimingTest`.** Exposed's
 * `afterExecution` does NOT mark the end of the work: it fires when the driver has handed back the
 * statement's lazy `Result` handle, BEFORE the server has answered and before any row is streamed
 * (`SELECT pg_sleep(0.3)` — 301 ms in `pg_stat_statements` — reached `afterExecution` after 6–12 ms).
 * A duration taken between `beforeExecution` and `afterExecution` would therefore be a meaningless
 * dispatch time. So a statement's duration is its WINDOW: from its `beforeExecution` to the next
 * boundary on the SAME transaction — the next statement's `beforeExecution`, or `beforeCommit` /
 * `beforeRollback`. The services collect their rows right after each statement, so the window covers
 * the server execution, the row streaming and the Kotlin row mapping up to the next statement; it is
 * an UPPER bound on pure database time, never an under-count (CPU work that runs inside a
 * transaction BETWEEN two statements — decrypting, mapping — is included; the COMMIT round trip and the
 * pool acquire/validation are outside every window).
 *
 * The SQL template is rendered through [StatementContext.sql] (the `?` template — never `expandArgs`/bind
 * values: they carry emails and encrypted-column plaintext) only when a statement becomes the request's slowest
 * so far. It cannot be deferred to the slow-request log: rendering needs the still-open transaction and yields
 * nothing once it has closed (tried 2026-10-03), so every request pays the render of its running-maximum
 * statements even with the header off.
 */
class RequestDbMetricsInterceptor : GlobalSuspendStatementInterceptor {
    /** The statement window still open on a transaction: when it was dispatched and what it was. */
    private class OpenStatement(val startNanos: Long, val context: StatementContext)

    override suspend fun beforeExecution(transaction: R2dbcTransaction, context: StatementContext) {
        val metrics = currentCoroutineContext()[RequestDbMetrics] ?: return
        val now = System.nanoTime()
        closeOpenStatement(transaction, metrics, now)
        transaction.putUserData(Open, OpenStatement(now, context))
    }

    override suspend fun beforeCommit(transaction: R2dbcTransaction) = endTransaction(transaction)

    override suspend fun beforeRollback(transaction: R2dbcTransaction) = endTransaction(transaction)

    private suspend fun endTransaction(transaction: R2dbcTransaction) {
        val metrics = currentCoroutineContext()[RequestDbMetrics] ?: return
        closeOpenStatement(transaction, metrics, System.nanoTime())
        metrics.recordTransaction()
    }

    private fun closeOpenStatement(transaction: R2dbcTransaction, metrics: RequestDbMetrics, now: Long) {
        val open = transaction.getUserData(Open) ?: return
        transaction.removeUserData(Open)
        metrics.recordStatement(now - open.startNanos) { open.context.sql(transaction) }
    }

    private companion object {
        val Open = Key<OpenStatement>()
    }
}
