package ch.nokillswit

import ch.nokillswit.sharing.ShareableResourceType
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * The per-kind `details` snapshot keys as DOCUMENTED in the OpenAPI spec — the one oracle shared by
 * the server adapters' `label()` and the SPA's `REQUIRED_KEYS` table (`web/src/utils/shareKinds.ts`;
 * its vitest parses the same text). The source is the description of `ShareResponse.details`, which
 * lists the keys as `` `TYPE {key,key,...}` `` clauses after "Keys per `resourceType`:", e.g.
 * `` FEEDBACK `{provider,subjects}`; ONE_ON_ONE `{manager,subordinate,meetingDate}`; ... ``
 * (clauses `;`-separated, the last one ends with `.`, line breaks inside the description are
 * insignificant). A description edit that breaks this format fails [ShareDetailsSpecTest].
 */
object ShareDetailsSpec {
    private val clause = Regex("""\b([A-Z][A-Z_]*) `\{([A-Za-z,]+)\}`""")

    /** Resource type → the documented `details` key set, parsed from the spec description. */
    val documentedKeys: Map<ShareableResourceType, Set<String>> by lazy {
        val description = assertNotNull(
            OpenApiSpec.parsed.components.schemas["ShareResponse"]?.properties?.get("details")?.description,
            "ShareResponse.details must carry the per-kind key list in its description",
        )
        // Line breaks inside the description are insignificant ("Keys per\n`resourceType`:" wraps mid-phrase).
        val keysPart = description.replace(Regex("""\s+"""), " ").substringAfter("Keys per `resourceType`:", "")
        assertTrue(keysPart.isNotBlank(), "the details description must contain 'Keys per `resourceType`:'")
        clause.findAll(keysPart).associate { match ->
            ShareableResourceType.valueOf(match.groupValues[1]) to match.groupValues[2].split(',').toSet()
        }
    }

    /**
     * Asserts [details] — a stored share row's snapshot, i.e. what [type]'s adapter `label()` produced
     * at creation — carries exactly the keys the spec documents for [type].
     */
    fun assertMatches(type: ShareableResourceType, details: Map<String, String>?) {
        assertEquals(documentedKeys.getValue(type), details?.keys, "details keys for $type vs the spec")
    }
}

/** Pure (no app, no DB): the spec's documented key list covers every shareable type, once, with real keys. */
class ShareDetailsSpecTest {

    @Test
    fun `the spec documents a non-empty details key list for every shareable type and no other`() {
        val documented = ShareDetailsSpec.documentedKeys
        assertEquals(ShareableResourceType.entries.toSet(), documented.keys, "spec vs ShareableResourceType")
        documented.forEach { (type, keys) ->
            assertTrue(keys.isNotEmpty(), "$type has an empty key list")
            assertFalse(keys.any { it.isBlank() }, "$type has a blank key")
        }
    }
}
