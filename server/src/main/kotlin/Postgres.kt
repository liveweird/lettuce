package ch.nokillswit

import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import java.sql.Connection
import java.sql.DriverManager

fun Application.configurePostgres() {
    val dbConnection: Connection = connectToPostgres()
    val cityService = CityService(dbConnection)

    routing {

        // Create city
        post("/cities") {
            val city = call.receive<City>()
            val id = cityService.create(city)
            call.respond(HttpStatusCode.Created, id)
        }

        // Read city
        get("/cities/{id}") {
            val id = call.parameters["id"]?.toInt() ?: throw IllegalArgumentException("Invalid ID")
            try {
                val city = cityService.read(id)
                call.respond(HttpStatusCode.OK, city)
            } catch (e: Exception) {
                call.respond(HttpStatusCode.NotFound)
            }
        }

        // Update city
        put("/cities/{id}") {
            val id = call.parameters["id"]?.toInt() ?: throw IllegalArgumentException("Invalid ID")
            val user = call.receive<City>()
            cityService.update(id, user)
            call.respond(HttpStatusCode.OK)
        }

        // Delete city
        delete("/cities/{id}") {
            val id = call.parameters["id"]?.toInt() ?: throw IllegalArgumentException("Invalid ID")
            cityService.delete(id)
            call.respond(HttpStatusCode.OK)
        }
    }
}

fun Application.connectToPostgres(): Connection {
    Class.forName("org.postgresql.Driver")
    val url = environment.config.property("postgres.jdbcUrl").getString()
    val user = environment.config.property("postgres.user").getString()
    val password = environment.config.property("postgres.password").getString()
    log.info("Connecting to postgres database at $url")
    return DriverManager.getConnection(url, user, password)
}
