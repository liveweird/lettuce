import type { TFunction } from "i18next";
import { hasLength } from "@mantine/form";
import { ApiError } from "../api/http";
import type { UserRole } from "../api/session";
import type { SupportedLanguage } from "../i18n";

// Server limits (server users/Validation.kt) mirrored client-side (v2.18.0).
export const MAX_USER_NAME_LENGTH = 50;
export const MAX_EMAIL_LENGTH = 254;
export const MAX_UNIQUE_ID_LENGTH = 50;

/**
 * The form values shared by CreateUser and EditUser (the AlertFormValues idiom). (The paid
 * days-off allowance left this form in v2.32.0 — a chain manager edits it on the person's
 * days-off drill-down.)
 */
export type UserFormValues = {
  name: string;
  email: string;
  // Roles hold only ADDITIONAL privileges — a new user starts as a plain user (empty set).
  roles: UserRole[];
  // Sent only when non-blank (trimmed) — emptying the field leaves the server value
  // unchanged, so clearing a set id is inexpressible client-side (the allowance semantics).
  uniqueId: string;
  // The user's language (v2.21.0) — drives their UI at sign-in and every email sent to
  // them. On edit it rides the dedicated PUT /users/{id}/language, never the whole-user PUT.
  language: SupportedLanguage;
  // No career fields (v2.15.0): career history lives on /users/:id/career, managed by the
  // person's management chain, not by admins.
};

/** The shared blank form (create page; edit initializes from the loaded user). */
export function emptyUserFormValues(): UserFormValues {
  return { name: "", email: "", roles: [], uniqueId: "", language: "en" };
}

// Linear-time (no ambiguous backtracking): dot-separated domain labels may not contain dots.
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

/** Validation rules shared by the create and edit user pages (mirrors the server's checks). */
export function userFormValidation(t: TFunction) {
  return {
    name: hasLength({ min: 1, max: MAX_USER_NAME_LENGTH }, t("users.validation.nameLength")),
    email: (value: string) => {
      if (!value) return t("users.validation.emailRequired");
      if (!EMAIL_RE.test(value)) return t("users.validation.emailInvalid");
      if (value.length > MAX_EMAIL_LENGTH) return t("users.validation.emailTooLong");
      return null;
    },
  };
}

/**
 * Whether a 409 from user create/update is the unique-id clash rather than the email one —
 * the two share the status, so the ProblemDetail detail string (the server's pre-check
 * message) decides which form field gets the error.
 */
export function isUniqueIdConflict(err: unknown): boolean {
  if (!(err instanceof ApiError) || err.status !== 409) return false;
  return err.detail?.toLowerCase().includes("unique id") ?? false;
}

// bcrypt hashes at most 72 bytes incl. a null terminator, so a password is capped at 71
// UTF-8 BYTES (server auth/Passwords.kt) — a byte count, not a character count: multibyte
// characters use the budget faster. Checked client-side so the form catches it, not the 400.
export const MAX_PASSWORD_BYTES = 71;

const utf8 = new TextEncoder();

export function utf8ByteLength(value: string): number {
  return utf8.encode(value).length;
}
