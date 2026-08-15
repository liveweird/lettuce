// Server limits (server users/Validation.kt) mirrored client-side (v2.18.0).
export const MAX_USER_NAME_LENGTH = 50;
export const MAX_EMAIL_LENGTH = 254;

// bcrypt hashes at most 72 bytes incl. a null terminator, so a password is capped at 71
// UTF-8 BYTES (server auth/Passwords.kt) — a byte count, not a character count: multibyte
// characters use the budget faster. Checked client-side so the form catches it, not the 400.
export const MAX_PASSWORD_BYTES = 71;

const utf8 = new TextEncoder();

export function utf8ByteLength(value: string): number {
  return utf8.encode(value).length;
}
