package ch.nokillswit

import ch.nokillswit.infra.db.jdbcTarget
import kotlin.test.Test
import kotlin.test.assertEquals

class FlywayBootLogTest {
    @Test
    fun `the boot log names only host, port and database, never credentials`() {
        assertEquals("postgres:5432/lettuce", jdbcTarget("jdbc:postgresql://postgres:5432/lettuce"))
        assertEquals(
            "db.internal:5432/lettuce",
            jdbcTarget("jdbc:postgresql://db.internal:5432/lettuce?user=app&password=hunter2&sslmode=require"),
        )
        assertEquals("db:5432/lettuce", jdbcTarget("jdbc:postgresql://app:hunter2@db:5432/lettuce"))
        assertEquals("db:5432/lettuce", jdbcTarget("jdbc:postgresql://app:pa/ss@db:5432/lettuce"))
        assertEquals("localhost", jdbcTarget("jdbc:postgresql://localhost"))
        assertEquals("jdbc:…", jdbcTarget("jdbc:postgresql:lettuce"))
    }
}
