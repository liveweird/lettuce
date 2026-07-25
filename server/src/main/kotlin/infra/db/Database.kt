package ch.nokillswit.infra.db

import ch.nokillswit.alerts.AlertService
import ch.nokillswit.alerts.AlertServiceKey
import ch.nokillswit.auth.TokenBlocklistService
import ch.nokillswit.auth.TokenBlocklistServiceKey
import ch.nokillswit.feedbacks.FeedbackEventService
import ch.nokillswit.feedbacks.FeedbackEventServiceKey
import ch.nokillswit.feedbacks.FeedbackService
import ch.nokillswit.feedbacks.FeedbackServiceKey
import ch.nokillswit.goals.GoalEventService
import ch.nokillswit.goals.GoalEventServiceKey
import ch.nokillswit.goals.GoalService
import ch.nokillswit.goals.GoalServiceKey
import ch.nokillswit.infra.crypto.FieldCipherKey
import ch.nokillswit.notifications.NotificationService
import ch.nokillswit.notifications.NotificationServiceKey
import ch.nokillswit.oneonones.OneOnOneEventService
import ch.nokillswit.oneonones.OneOnOneEventServiceKey
import ch.nokillswit.oneonones.OneOnOneService
import ch.nokillswit.oneonones.OneOnOneServiceKey
import ch.nokillswit.teams.TeamService
import ch.nokillswit.teams.TeamServiceKey
import ch.nokillswit.templates.TemplateService
import ch.nokillswit.templates.TemplateServiceKey
import ch.nokillswit.users.UserService
import ch.nokillswit.users.UserServiceKey
import io.ktor.server.application.*
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase

suspend fun Application.configureDatabase() {
    val database = R2dbcDatabase.connect(
        url = environment.config.property("postgres.r2dbcUrl").getString(),
        user = environment.config.property("postgres.user").getString(),
        password = environment.config.property("postgres.password").getString(),
    )
    attributes.put(UserServiceKey, UserService(database))
    attributes.put(TeamServiceKey, TeamService(database))
    // configureCrypto runs before this module (application.yaml order), so the cipher is present.
    attributes.put(FeedbackServiceKey, FeedbackService(database, attributes[FieldCipherKey]))
    attributes.put(FeedbackEventServiceKey, FeedbackEventService(database))
    attributes.put(OneOnOneServiceKey, OneOnOneService(database, attributes[FieldCipherKey]))
    attributes.put(OneOnOneEventServiceKey, OneOnOneEventService(database))
    attributes.put(GoalServiceKey, GoalService(database, attributes[FieldCipherKey]))
    attributes.put(GoalEventServiceKey, GoalEventService(database))
    attributes.put(TemplateServiceKey, TemplateService(database))
    attributes.put(NotificationServiceKey, NotificationService(database))
    attributes.put(AlertServiceKey, AlertService(database))
    attributes.put(TokenBlocklistServiceKey, TokenBlocklistService(database))
}
