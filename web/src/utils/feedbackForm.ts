// Server-side free-text limits (server feedbacks/Feedback.kt) mirrored client-side (v2.18.0)
// so overlength is caught in the form, not as an API 400.
export const MAX_FEEDBACK_CONTENT_LENGTH = 5000;
export const MAX_REQUESTER_MESSAGE_LENGTH = 1000;
