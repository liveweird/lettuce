package ch.nokillswit

import ch.nokillswit.sharing.ShareRegistry
import ch.nokillswit.sharing.ShareableResourceType
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertSame
import kotlin.test.assertTrue

/** The registry is complete by construction and refuses an adapter that reports the wrong type. */
class ShareRegistryTest {

    @Test
    fun `forType answers the adapter built for each type, for every type`() {
        val built = ShareableResourceType.entries.associateWith { FakeShareable(it) }
        val registry = ShareRegistry { built.getValue(it) }
        ShareableResourceType.entries.forEach { type ->
            assertSame(built.getValue(type), registry.forType(type))
            assertEquals(type, registry.forType(type).type)
        }
    }

    @Test
    fun `an adapter reporting a different type than the one it was built for is refused at construction`() {
        val failure = assertFailsWith<IllegalStateException> {
            // Every type is handed the FEEDBACK adapter — all but FEEDBACK are mismatches.
            ShareRegistry { FakeShareable(ShareableResourceType.FEEDBACK) }
        }
        assertTrue("reports FEEDBACK" in failure.message.orEmpty(), failure.message)
    }
}
