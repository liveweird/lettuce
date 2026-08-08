package ch.nokillswit.pulse

import ch.nokillswit.settings.AppSettingsService
import io.ktor.server.plugins.BadRequestException
import kotlinx.serialization.Serializable

/**
 * The pulse feature's runtime settings (stored in `app_settings`, seeded by V47). ADVISORY
 * ONLY: both values exist solely to prefill the admin scheduling form — the server never
 * schedules, opens, or closes anything on its own (no background jobs).
 */
@Serializable
data class PulseSettings(
    /** Suggested weeks between cycle opens (prefills the next cycle's open date). */
    val cadenceWeeks: Int,
    /** Suggested days a cycle stays open (prefills the close date from the open date). */
    val openDays: Int,
)

const val PULSE_CADENCE_WEEKS_KEY = "pulse.cadenceWeeks"
const val PULSE_OPEN_DAYS_KEY = "pulse.openDays"
const val DEFAULT_PULSE_CADENCE_WEEKS = 4
const val DEFAULT_PULSE_OPEN_DAYS = 7

fun validatePulseSettings(settings: PulseSettings) {
    if (settings.cadenceWeeks !in 1..52) {
        throw BadRequestException("cadenceWeeks must be between 1 and 52")
    }
    if (settings.openDays !in 1..90) {
        throw BadRequestException("openDays must be between 1 and 90")
    }
}

/** Loads the pair, falling back to the defaults for an absent/corrupt row (V47 seeds both). */
suspend fun AppSettingsService.pulseSettings(): PulseSettings {
    val values = getAll(setOf(PULSE_CADENCE_WEEKS_KEY, PULSE_OPEN_DAYS_KEY))
    return PulseSettings(
        cadenceWeeks = values[PULSE_CADENCE_WEEKS_KEY]?.toIntOrNull() ?: DEFAULT_PULSE_CADENCE_WEEKS,
        openDays = values[PULSE_OPEN_DAYS_KEY]?.toIntOrNull() ?: DEFAULT_PULSE_OPEN_DAYS,
    )
}

suspend fun AppSettingsService.savePulseSettings(settings: PulseSettings) {
    put(PULSE_CADENCE_WEEKS_KEY, settings.cadenceWeeks.toString())
    put(PULSE_OPEN_DAYS_KEY, settings.openDays.toString())
}
