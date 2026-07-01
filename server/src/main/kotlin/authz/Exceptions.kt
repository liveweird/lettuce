package ch.nokillswit.authz

class UnauthorizedException(message: String = "Authentication required") : RuntimeException(message)

class ForbiddenException(message: String = "Forbidden") : RuntimeException(message)

/** Requested action conflicts with the resource's current state (e.g. an invalid status transition). */
class ConflictException(message: String = "Conflict") : RuntimeException(message)
