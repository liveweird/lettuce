package ch.nokillswit.sharing

import io.ktor.resources.Resource
import io.ktor.server.application.*
import io.ktor.server.auth.authenticate
import io.ktor.server.plugins.ratelimit.RateLimitName
import io.ktor.server.plugins.ratelimit.rateLimit
import io.ktor.server.resources.get
import io.ktor.server.resources.post
import io.ktor.server.routing.Route
import io.ktor.server.routing.routing
import kotlinx.serialization.Serializable

/** The per-caller RateLimit bucket name — registered in auth/AuthRoutes.kt's single install. */
const val SHARES_RATE_LIMIT = "shares"

/**
 * The mass share's OWN per-caller bucket (a separate, much smaller limit): one batch call fans
 * out up to 20 summary notices (+ email + Teams), so it must not ride the single-share bucket.
 */
const val SHARES_BATCH_RATE_LIMIT = "shares-batch"

@Serializable
@Resource("/api/v1/shares")
class Shares {
    /** `POST /api/v1/shares/batch` (v4.10.0) — a constant segment, so it wins over `{id}` in routing. */
    @Serializable
    @Resource("batch")
    class Batch(val parent: Shares = Shares())

    @Serializable
    @Resource("{id}")
    class Id(val parent: Shares = Shares(), val id: UInt) {
        @Serializable
        @Resource("withdraw")
        class Withdraw(val parent: Id)
    }
}

/**
 * `/api/v1/shares` (v4.8.0) — registers the central sharing resource; every handler lives in
 * [ShareHandlers] (checkup #38 M8 — the handler order, the authz-before-validation contract and
 * the mass-share evaluation order are documented there). The routes keep the registration order
 * the buckets depend on: the mass share's own per-caller bucket first, then the single-share
 * mutations' bucket (keyed on userId, see auth/AuthRoutes.kt).
 */
fun Application.configureShareRoutes() {
    val handlers = ShareHandlers(this)
    routing {
        authenticate {
            get<Shares> { handlers.list(call) }
            get<Shares.Id> { route -> handlers.read(call, route.id) }
            shareBatchRoute(handlers)
            shareMutationRoutes(handlers)
        }
    }
}

// The mass share has its own per-caller bucket (burst fan-out, see SHARES_BATCH_RATE_LIMIT).
private fun Route.shareBatchRoute(handlers: ShareHandlers) {
    rateLimit(RateLimitName(SHARES_BATCH_RATE_LIMIT)) {
        post<Shares.Batch> { handlers.batch(call) }
    }
}

// The single-share mutations share one per-caller bucket (keyed on userId, see auth/AuthRoutes.kt).
private fun Route.shareMutationRoutes(handlers: ShareHandlers) {
    rateLimit(RateLimitName(SHARES_RATE_LIMIT)) {
        post<Shares> { handlers.create(call) }
        post<Shares.Id.Withdraw> { route -> handlers.withdraw(call, route.parent.id) }
    }
}
