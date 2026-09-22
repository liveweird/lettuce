package ch.nokillswit.infra.db

import io.ktor.server.application.*
import org.flywaydb.core.Flyway

fun Application.configureFlyway() {
    val url = environment.config.property("postgres.jdbcUrl").getString()
    val user = environment.config.property("postgres.user").getString()
    val password = environment.config.property("postgres.password").getString()

    log.info("Running Flyway migrations against ${jdbcTarget(url)}")
    val result = Flyway.configure()
        .dataSource(url, user, password)
        .locations("classpath:db/migration")
        .load()
        .migrate()
    log.info("Flyway applied ${result.migrationsExecuted} migration(s); schema at version ${result.targetSchemaVersion}")
}

/**
 * The host[:port]/database part of a JDBC URL, for the boot log (checkup #37 D7): the URL itself
 * can carry credentials — `user`/`password` query parameters or a `user:pass@` authority — which
 * must never reach the log (they ride the Logback→OTel pipeline). Everything after `?` and any
 * userinfo is dropped; a URL without a `//` authority is logged as its scheme only.
 */
internal fun jdbcTarget(url: String): String {
    if ("//" !in url) return url.substringBefore(':', url) + ":…"
    // Userinfo is stripped before splitting host from path: a password may itself contain `/`.
    val rest = url.substringAfter("//").substringBefore('?').substringBefore(';').substringAfterLast('@')
    val host = rest.substringBefore('/')
    val database = rest.substringAfter('/', "")
    return if (database.isEmpty()) host else "$host/$database"
}
