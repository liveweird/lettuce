package ch.nokillswit

import ch.nokillswit.authz.CallerPrincipal
import ch.nokillswit.authz.ForbiddenException
import ch.nokillswit.sharing.ReadVia
import ch.nokillswit.sharing.ShareCreateOutcome
import ch.nokillswit.sharing.ShareAccess
import ch.nokillswit.sharing.ShareService
import ch.nokillswit.sharing.ShareableResourceType
import ch.nokillswit.users.Feature
import ch.nokillswit.users.UserRole
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertSame
import kotlin.test.assertTrue

/**
 * The read-side authorization seam (`sharing/ShareAccess.kt`): every existing guard evaluated
 * for a role-stripped sharer principal. Driven with plain lambdas as guards — the per-feature
 * suites prove it against the real guards; here we pin the mechanism itself.
 */
class ShareAccessTest {

    private val type = ShareableResourceType.GOAL

    // One fresh synthetic document pair per test (JUnit builds an instance per test method).
    private val doc = TestShareDocuments.nextId()
    private val otherDoc = TestShareDocuments.nextId()
    private val shares = ShareService(TestServices.database)
    private val access = ShareAccess(shares, TestServices.users)

    private suspend fun user(prefix: String, roles: Set<UserRole> = emptySet()): UInt =
        TestUsers.seed(email = uniqueEmail(prefix), password = "pw-123456789", name = prefix, roles = roles)

    private fun principal(id: UInt, roles: Set<UserRole> = emptySet(), disabled: Set<Feature> = emptySet()) =
        CallerPrincipal(id, "p$id@test", roles, disabled)

    private suspend fun share(sharer: UInt, sharee: UInt, resourceId: UInt) {
        shares.create(type, resourceId, sharer, sharee, null)
    }

    /** A guard that lets exactly [allowed] read and records the roles it was handed. */
    private class RecordingGuard(private val allowed: Set<UInt>) {
        val seenRoles = mutableListOf<Set<UserRole>>()
        val seenUsers = mutableListOf<UInt>()

        suspend fun check(p: CallerPrincipal): String {
            seenRoles += p.roles
            seenUsers += p.userId
            if (p.userId !in allowed) throw ForbiddenException("denied for ${p.userId}")
            return "grant-${p.userId}"
        }
    }

    @Test
    fun `a caller who passes the guard reads in their own right and the shares are never consulted`(): Unit = runBlocking {
        val caller = user("owner")
        val sharer = user("sharer")
        // A share the caller holds exists AND its sharer would pass — so the guard's call log
        // (only the caller) is what proves the shares were never consulted.
        share(sharer, caller, doc)
        val guard = RecordingGuard(allowed = setOf(caller, sharer))
        val via = access.readOrShared(principal(caller), type, doc, guard = guard::check)
        assertIs<ReadVia.Own<String>>(via)
        assertEquals("grant-$caller", via.grant)
        assertEquals(listOf(caller), guard.seenUsers)
    }

    @Test
    fun `a denied caller with no share gets the ORIGINAL denial back untouched`(): Unit = runBlocking {
        val caller = user("stranger")
        val original = ForbiddenException("the original denial")
        val thrown = assertFailsWith<ForbiddenException> {
            access.readOrShared<String>(principal(caller), type, doc) { throw original }
        }
        assertSame(original, thrown)
    }

    @Test
    fun `an active share grants as the sharer sees it - guard run for a role-stripped sharer principal`(): Unit = runBlocking {
        val sharer = user("sharer", roles = setOf(UserRole.HR, UserRole.ADMIN))
        val sharee = user("sharee")
        share(sharer, sharee, doc)
        val guard = RecordingGuard(allowed = setOf(sharer))

        val via = access.readOrShared(principal(sharee), type, doc, guard = guard::check)
        assertIs<ReadVia.Shared<String>>(via)
        assertEquals(sharer, via.sharerId)
        assertEquals("sharer", via.sharerName)
        assertEquals("grant-$sharer", via.grant, "the grant is the sharer's, so redaction follows the sharer")
        assertEquals(sharer, via.principal.userId)
        // The sharer's HR/ADMIN roles never reach the guard: the share carries ordinary rights only.
        assertEquals(emptySet(), guard.seenRoles.last())
        assertEquals(emptySet(), via.principal.roles)
    }

    @Test
    fun `the share is scoped to its document and to its sharee`(): Unit = runBlocking {
        val sharer = user("sharer")
        val sharee = user("sharee")
        val other = user("other")
        share(sharer, sharee, doc)
        val guard = RecordingGuard(allowed = setOf(sharer))
        assertFailsWith<ForbiddenException> { access.readOrShared(principal(sharee), type, otherDoc, guard = guard::check) }
        assertFailsWith<ForbiddenException> { access.readOrShared(principal(other), type, doc, guard = guard::check) }
        assertFailsWith<ForbiddenException> {
            access.readOrShared(principal(sharee), ShareableResourceType.FEEDBACK, doc, guard = guard::check)
        }
    }

    @Test
    fun `a sharer who lost the right makes the share lapse with the distinct detail`(): Unit = runBlocking {
        val sharer = user("sharer")
        val sharee = user("sharee")
        share(sharer, sharee, doc)
        val guard = RecordingGuard(allowed = emptySet())
        val thrown = assertFailsWith<ForbiddenException> { access.readOrShared(principal(sharee), type, doc, guard = guard::check) }
        assertEquals("The person who shared this no longer has access to it", thrown.message)
    }

    @Test
    fun `a withdrawn or expired share grants nothing, and the denial is the plain one`(): Unit = runBlocking {
        val sharer = user("sharer")
        val sharee = user("sharee")
        val guard = RecordingGuard(allowed = setOf(sharer))
        val id = (shares.create(type, doc, sharer, sharee, null) as ShareCreateOutcome.Created).id
        shares.withdraw(id, sharer)
        // An expired share (the store does not validate dates — the route does) is equally inert.
        shares.create(type, doc, sharer, sharee, "2000-01-01")
        val thrown = assertFailsWith<ForbiddenException> { access.readOrShared(principal(sharee), type, doc, guard = guard::check) }
        assertEquals("denied for $sharee", thrown.message)
    }

    @Test
    fun `a deactivated or feature-disabled sharer is skipped and the next sharer can still carry the share`(): Unit = runBlocking {
        val deactivated = user("deactivated")
        val flagOff = user("flag-off")
        val good = user("good")
        val sharee = user("sharee")
        share(deactivated, sharee, doc)
        share(flagOff, sharee, doc)
        share(good, sharee, doc)
        TestServices.users.setDeactivated(deactivated, true)
        TestServices.users.setDisabledFeatures(flagOff, setOf(Feature.GOALS))
        val guard = RecordingGuard(allowed = setOf(deactivated, flagOff, good))

        val via = access.readOrShared(principal(sharee), type, doc, guard = guard::check)
        assertIs<ReadVia.Shared<String>>(via)
        assertEquals(good, via.sharerId)
        // Neither skipped sharer ever reached the guard.
        assertFalse(deactivated in guard.seenUsers)
        assertFalse(flagOff in guard.seenUsers)
    }

    @Test
    fun `only a ForbiddenException is a denial - any other failure propagates as itself`(): Unit = runBlocking {
        val sharer = user("sharer")
        val sharee = user("sharee")
        share(sharer, sharee, doc)
        // On the caller's own evaluation …
        assertFailsWith<IllegalStateException> {
            access.readOrShared<String>(principal(sharee), type, doc) { error("chain walk blew up") }
        }
        // … and on the sharer's: the caller's pass is a clean denial, the sharer's pass throws.
        var calls = 0
        assertFailsWith<IllegalStateException> {
            access.readOrShared<String>(principal(sharee), type, doc) {
                if (calls++ == 0) throw ForbiddenException("not mine") else error("sharer's chain walk blew up")
            }
        }
    }

    @Test
    fun `holdsOwnRight strips the HR role, honours the feature flag, and never consults shares`(): Unit = runBlocking {
        val owner = user("owner")
        val sharer = user("sharer")
        val sharee = user("sharee")
        val hr = user("hr", roles = setOf(UserRole.HR))
        share(sharer, sharee, doc)
        // A guard that reads for the owner and, like the real guards, for anyone holding HR.
        val guard: suspend (CallerPrincipal) -> Unit = { p ->
            if (p.userId != owner && UserRole.HR !in p.roles) throw ForbiddenException("denied")
        }
        assertTrue(access.holdsOwnRight(principal(owner), type, guard))
        // An HR auditor-only reader passes the raw guard but holds no right in their own.
        assertFalse(access.holdsOwnRight(principal(hr, roles = setOf(UserRole.HR)), type, guard))
        // Reading through a share is not an own right: the sharee fails, so cannot re-share.
        assertFalse(access.holdsOwnRight(principal(sharee), type, guard))
        // A disabled feature holds nothing.
        assertFalse(access.holdsOwnRight(principal(owner, disabled = setOf(Feature.GOALS)), type, guard))
        // Other exceptions propagate.
        assertFailsWith<IllegalStateException> { access.holdsOwnRight(principal(owner), type) { error("boom") } }
    }

    @Test
    fun `a share upgrades a weaker own read, but only to a sufficient one`(): Unit = runBlocking {
        val sharer = user("sharer")
        val sharee = user("sharee")
        val loner = user("loner")
        share(sharer, sharee, doc)
        // The sharee passes the guard with a WEAK grant, the sharer with a FULL one.
        val guard: suspend (CallerPrincipal) -> String = { p ->
            if (p.userId == sharer) "full" else if (p.userId == sharee || p.userId == loner) "weak" else error("unexpected")
        }
        val sufficient: (CallerPrincipal, String) -> Boolean = { _, grant -> grant == "full" }

        val upgraded = access.readOrShared(principal(sharee), type, doc, sufficient, guard)
        assertIs<ReadVia.Shared<String>>(upgraded)
        assertEquals("full", upgraded.grant)
        assertEquals(sharer, upgraded.sharerId)

        // No share to upgrade with: the weak own read stands, it is not an error.
        val own = access.readOrShared(principal(loner), type, doc, sufficient, guard)
        assertIs<ReadVia.Own<String>>(own)
        assertEquals("weak", own.grant)

        // A share whose sharer is no better off does not replace the own read either.
        val equallyWeak = access.readOrShared(principal(sharee), type, doc, { _, _ -> false }, guard)
        assertIs<ReadVia.Own<String>>(equallyWeak)
        assertEquals("weak", equallyWeak.grant)
    }

    @Test
    fun `a denied caller prefers a sufficient sharer over an earlier insufficient one`(): Unit = runBlocking {
        val weak = user("weak-sharer")
        val full = user("full-sharer")
        val sharee = user("sharee")
        share(weak, sharee, doc)
        share(full, sharee, doc)
        val guard: suspend (CallerPrincipal) -> String = { p ->
            when (p.userId) {
                weak -> "weak"
                full -> "full"
                else -> throw ForbiddenException("denied")
            }
        }
        val via = access.readOrShared(principal(sharee), type, doc, { _, grant -> grant == "full" }, guard)
        assertIs<ReadVia.Shared<String>>(via)
        assertEquals(full, via.sharerId)
        // Without a sufficiency requirement the oldest passing share simply wins.
        val first = access.readOrShared(principal(sharee), type, doc, guard = guard)
        assertIs<ReadVia.Shared<String>>(first)
        assertEquals(weak, first.sharerId)
    }

    @Test
    fun `an insufficient own read whose shares have all lapsed stays the own read, not the lapse 403`(): Unit = runBlocking {
        val sharer = user("sharer")
        val sharee = user("sharee")
        share(sharer, sharee, doc)
        // The sharee reads (weakly); the sharer no longer passes the guard at all.
        val guard: suspend (CallerPrincipal) -> String = { p ->
            if (p.userId == sharee) "weak" else throw ForbiddenException("sharer lost the right")
        }
        val via = access.readOrShared(principal(sharee), type, doc, { _, grant -> grant == "full" }, guard)
        assertIs<ReadVia.Own<String>>(via)
        assertEquals("weak", via.grant)
    }
}
