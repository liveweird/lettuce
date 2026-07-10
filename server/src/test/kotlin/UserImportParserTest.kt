package ch.nokillswit

import ch.nokillswit.users.ImportLine
import ch.nokillswit.users.UserImportStatus
import ch.nokillswit.users.parseImportRows
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

/** Direct tests of the pure CSV parser (users/UserImport.kt); the effectful half
 *  (persistence/email/audit) is covered by UserImportTest over HTTP. */
class UserImportParserTest {

    @Test
    fun `header and blank lines are skipped, line numbers stay 1-based against the file`() {
        val rows = parseImportRows("name,email\n\nAlice,a@x\n\nBob,b@x\n")
        assertEquals(2, rows.size)
        val alice = assertIs<ImportLine.Parsed>(rows[0])
        assertEquals(3, alice.line, "line numbers count real file lines incl. skipped ones")
        assertEquals("Alice", alice.name)
        assertEquals("a@x", alice.email)
        assertEquals(5, assertIs<ImportLine.Parsed>(rows[1]).line)
    }

    @Test
    fun `the header is only skipped as the first non-blank line`() {
        val rows = parseImportRows("Alice,a@x\nname,email")
        assertEquals(2, rows.size)
        // A later literal "name,email" is treated as a data row (and fails validation: no '@').
        val second = assertIs<ImportLine.Invalid>(rows[1])
        assertEquals(UserImportStatus.PARSE_ERROR, second.row.status)
    }

    @Test
    fun `names may contain commas - the split is on the last comma`() {
        val row = assertIs<ImportLine.Parsed>(parseImportRows("Kowalski, Jan, Jr.,jan@x").single())
        assertEquals("Kowalski, Jan, Jr.", row.name)
        assertEquals("jan@x", row.email)
    }

    @Test
    fun `lines without a comma or failing field validation become PARSE_ERROR rows`() {
        val rows = parseImportRows(
            listOf(
                "no-comma-at-all",         // no comma
                ",orphan@x",               // blank name
                "No At Sign,not-an-email", // '@' missing
                "${"x".repeat(51)},long@x", // name too long
            ).joinToString("\n"),
        )
        assertEquals(4, rows.size)
        rows.forEach { line ->
            val invalid = assertIs<ImportLine.Invalid>(line)
            assertEquals(UserImportStatus.PARSE_ERROR, invalid.row.status)
            assertTrue(!invalid.row.message.isNullOrBlank(), "each parse error carries a message")
        }
    }

    @Test
    fun `whitespace around fields is trimmed`() {
        val row = assertIs<ImportLine.Parsed>(parseImportRows("  Alice Smith ,  a@x  ").single())
        assertEquals("Alice Smith", row.name)
        assertEquals("a@x", row.email)
    }
}
