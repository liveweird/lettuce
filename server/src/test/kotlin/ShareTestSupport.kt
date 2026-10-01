package ch.nokillswit

import java.util.concurrent.atomic.AtomicLong

/**
 * Synthetic document ids for the sharing tests. `document_shares` rows live in the one shared
 * container for the whole JVM, and `(resource_type, resource_id)` is how a share names its
 * document — so a test's made-up id must never equal a REAL document's id (the per-feature
 * sharing suites create real ones, which are small sequence values) nor another test's. This
 * range sits far above any sequence the suite reaches yet inside int32 (the spec's id format),
 * and the counter is JVM-wide and never reset.
 */
object TestShareDocuments {
    private val next = AtomicLong(1_500_000_000)

    fun nextId(): UInt = next.incrementAndGet().toUInt()
}
