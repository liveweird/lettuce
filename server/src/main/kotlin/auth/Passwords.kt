package ch.nokillswit.auth

import at.favre.lib.crypto.bcrypt.BCrypt

internal fun verifyPassword(plain: String, hash: String): Boolean =
    BCrypt.verifyer().verify(plain.toCharArray(), hash).verified
