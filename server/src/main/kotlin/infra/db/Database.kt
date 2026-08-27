package ch.nokillswit.infra.db

import ch.nokillswit.alerts.AlertService
import ch.nokillswit.alerts.AlertServiceKey
import ch.nokillswit.auth.TokenBlocklistService
import ch.nokillswit.auth.TokenBlocklistServiceKey
import ch.nokillswit.daysoff.DaysOffService
import ch.nokillswit.daysoff.DaysOffServiceKey
import ch.nokillswit.daysoff.PublicHolidayService
import ch.nokillswit.daysoff.PublicHolidayServiceKey
import ch.nokillswit.dictionaries.DictionaryService
import ch.nokillswit.dictionaries.DictionaryServiceKey
import ch.nokillswit.feedbacks.FeedbackEventService
import ch.nokillswit.feedbacks.FeedbackEventServiceKey
import ch.nokillswit.feedbacks.FeedbackService
import ch.nokillswit.feedbacks.FeedbackServiceKey
import ch.nokillswit.goals.GoalEventService
import ch.nokillswit.goals.GoalEventServiceKey
import ch.nokillswit.goals.GoalService
import ch.nokillswit.goals.GoalServiceKey
import ch.nokillswit.impactlog.ImpactLogEventService
import ch.nokillswit.impactlog.ImpactLogEventServiceKey
import ch.nokillswit.impactlog.ImpactLogService
import ch.nokillswit.impactlog.ImpactLogServiceKey
import ch.nokillswit.infra.crypto.FieldCipherKey
import ch.nokillswit.infra.mail.mailAppUrl
import ch.nokillswit.infra.mail.mailer
import ch.nokillswit.integration.IntegrationClientService
import ch.nokillswit.integration.IntegrationClientServiceKey
import ch.nokillswit.notifications.NotificationEmailer
import ch.nokillswit.notifications.NotificationService
import ch.nokillswit.notifications.NotificationServiceKey
import ch.nokillswit.oneonones.OneOnOneEventService
import ch.nokillswit.oneonones.OneOnOneEventServiceKey
import ch.nokillswit.oneonones.OneOnOneService
import ch.nokillswit.oneonones.OneOnOneServiceKey
import ch.nokillswit.pulse.PulseCycleService
import ch.nokillswit.pulse.PulseCycleServiceKey
import ch.nokillswit.pulse.PulseResponseService
import ch.nokillswit.pulse.PulseResponseServiceKey
import ch.nokillswit.reviews.PerformanceReviewEventService
import ch.nokillswit.reviews.PerformanceReviewEventServiceKey
import ch.nokillswit.reviews.PerformanceReviewService
import ch.nokillswit.reviews.PerformanceReviewServiceKey
import ch.nokillswit.reviews.ReviewPeriodService
import ch.nokillswit.reviews.ReviewPeriodServiceKey
import ch.nokillswit.succession.SuccessionEventService
import ch.nokillswit.succession.SuccessionEventServiceKey
import ch.nokillswit.succession.SuccessionPlanService
import ch.nokillswit.succession.SuccessionPlanServiceKey
import ch.nokillswit.teamkpis.TeamKpiEventService
import ch.nokillswit.teamkpis.TeamKpiEventServiceKey
import ch.nokillswit.teamkpis.TeamKpiService
import ch.nokillswit.teamkpis.TeamKpiServiceKey
import ch.nokillswit.teams.TeamService
import ch.nokillswit.teams.TeamServiceKey
import ch.nokillswit.templates.TemplateService
import ch.nokillswit.templates.TemplateServiceKey
import ch.nokillswit.settings.AppSettingsService
import ch.nokillswit.settings.AppSettingsServiceKey
import ch.nokillswit.users.CareerPositionService
import ch.nokillswit.users.CareerPositionServiceKey
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
    val userService = UserService(database)
    attributes.put(UserServiceKey, userService)
    attributes.put(CareerPositionServiceKey, CareerPositionService(database))
    attributes.put(TeamServiceKey, TeamService(database))
    // configureCrypto runs before this module (application.yaml order), so the cipher is present.
    attributes.put(FeedbackServiceKey, FeedbackService(database, attributes[FieldCipherKey]))
    attributes.put(FeedbackEventServiceKey, FeedbackEventService(database))
    attributes.put(OneOnOneServiceKey, OneOnOneService(database, attributes[FieldCipherKey]))
    attributes.put(OneOnOneEventServiceKey, OneOnOneEventService(database))
    attributes.put(GoalServiceKey, GoalService(database, attributes[FieldCipherKey]))
    // The goal event trail carries the encrypted progress-update comment (V54), hence the cipher.
    attributes.put(GoalEventServiceKey, GoalEventService(database, attributes[FieldCipherKey]))
    attributes.put(TeamKpiServiceKey, TeamKpiService(database, attributes[FieldCipherKey]))
    attributes.put(TeamKpiEventServiceKey, TeamKpiEventService(database))
    attributes.put(ReviewPeriodServiceKey, ReviewPeriodService(database))
    attributes.put(PerformanceReviewServiceKey, PerformanceReviewService(database, attributes[FieldCipherKey]))
    attributes.put(PerformanceReviewEventServiceKey, PerformanceReviewEventService(database))
    attributes.put(PublicHolidayServiceKey, PublicHolidayService(database))
    attributes.put(DaysOffServiceKey, DaysOffService(database, attributes[FieldCipherKey]))
    attributes.put(TemplateServiceKey, TemplateService(database))
    attributes.put(DictionaryServiceKey, DictionaryService(database))
    attributes.put(AppSettingsServiceKey, AppSettingsService(database))
    attributes.put(PulseCycleServiceKey, PulseCycleService(database))
    attributes.put(PulseResponseServiceKey, PulseResponseService(database, attributes[FieldCipherKey]))
    attributes.put(ImpactLogServiceKey, ImpactLogService(database, attributes[FieldCipherKey]))
    attributes.put(ImpactLogEventServiceKey, ImpactLogEventService(database))
    attributes.put(SuccessionPlanServiceKey, SuccessionPlanService(database, attributes[FieldCipherKey]))
    attributes.put(SuccessionEventServiceKey, SuccessionEventService(database))
    attributes.put(IntegrationClientServiceKey, IntegrationClientService(database))
    // The email mirror (v2.3.0): configureMail runs before this module, so the transport and
    // appUrl are readable; the Application is the CoroutineScope its fire-and-forget sends
    // ride on (the password-reset launch precedent).
    val notificationEmailer = NotificationEmailer(
        scope = this,
        mailer = mailer(),
        appUrl = mailAppUrl(),
        userService = userService,
    )
    attributes.put(NotificationServiceKey, NotificationService(database, notificationEmailer))
    attributes.put(AlertServiceKey, AlertService(database))
    attributes.put(TokenBlocklistServiceKey, TokenBlocklistService(database))
}
