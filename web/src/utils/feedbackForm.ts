// Server-side free-text limits (server feedbacks/Feedback.kt) mirrored client-side (v2.18.0)
// so overlength is caught in the form, not as an API 400.
export const MAX_FEEDBACK_CONTENT_LENGTH = 5000;
export const MAX_REQUESTER_MESSAGE_LENGTH = 1000;

// The shared create-flow error-key maps (2026-08 audit round — previously copied
// byte-for-byte across CreateKudo/CreateFeedback and AskFeedback/RequestFeedback; the
// PulseSettingsCard module-const idiom). Edit/delete keep their own page-local maps —
// their key sets genuinely differ.
import type { SaveErrorKeys } from "./saveError";

/** Providing feedback (CreateFeedback, CreateKudo). */
export const PROVIDE_ERROR_KEYS: SaveErrorKeys = {
  forbidden: "feedback.error.providePermission",
  conflict: "feedback.error.duplicate",
  invalid: "feedback.error.validation",
  failedStatus: "feedback.error.createFailedStatus",
  failed: "feedback.error.createFailed",
};

/** Requesting feedback from providers (AskFeedback, RequestFeedback). */
export const REQUEST_ERROR_KEYS: SaveErrorKeys = {
  forbidden: "feedback.error.requestPermission",
  conflict: "feedback.error.duplicate",
  invalid: "feedback.error.validationSimple",
  failedStatus: "feedback.error.requestFailedStatus",
  failed: "feedback.error.requestFailed",
};
