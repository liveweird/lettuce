package ch.nokillswit.authz

class UnauthorizedException(message: String = "Authentication required") : RuntimeException(message)

class ForbiddenException(message: String = "Forbidden") : RuntimeException(message)
