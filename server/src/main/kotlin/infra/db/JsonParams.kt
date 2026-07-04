package ch.nokillswit.infra.db

import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json

/**
 * (De)serialization of the string-to-string `params` maps stored as JSON TEXT columns
 * (feedback_events.params, notifications.params) — the interpolation values the SPA uses to
 * render structured events/notifications in the viewer's language.
 */
private val paramsSerializer = MapSerializer(String.serializer(), String.serializer())

internal fun encodeParams(params: Map<String, String>): String =
    Json.encodeToString(paramsSerializer, params)

internal fun decodeParams(json: String): Map<String, String> =
    Json.decodeFromString(paramsSerializer, json)
