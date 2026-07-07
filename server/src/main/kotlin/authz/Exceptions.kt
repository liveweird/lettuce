package ch.nokillswit.authz

class UnauthorizedException(message: String = "Authentication required") : RuntimeException(message)

class ForbiddenException(message: String = "Forbidden") : RuntimeException(message)

/** Requested action conflicts with the resource's current state (e.g. an invalid status transition). */
class ConflictException(message: String = "Conflict") : RuntimeException(message)

/**
 * Caller-specific throttling (e.g. the per-account login lockout) → 429 with the given detail.
 * Distinct from the per-IP RateLimit plugin's bodiless 429, which the StatusPages
 * `status(TooManyRequests)` handler completes with a generic problem body.
 */
class TooManyRequestsException(message: String = "Too many requests") : RuntimeException(message)
