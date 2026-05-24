package ch.nokillswit.auth

import at.favre.lib.crypto.bcrypt.BCrypt

internal fun hashPassword(plain: String, cost: Int = 12): String =
    BCrypt.withDefaults().hashToString(cost, plain.toCharArray())

internal fun verifyPassword(plain: String, hash: String): Boolean =
    BCrypt.verifyer().verify(plain.toCharArray(), hash).verified
