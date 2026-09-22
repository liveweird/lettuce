import type { ParseKeys } from "i18next";
import type { NotificationItem } from "../api/notifications";

/**
 * The short label key for each `NotificationType`, used by the notification-preferences matrix
 * (`pages/NotificationPreferences.tsx`). Typed as a `Record` over the full generated union, the
 * same completeness idiom as `NotificationsButton.tsx`'s `EVENT_KEY`/`TYPE_META` — a future
 * server-added type fails this file to compile until it's given a label, and each literal is a
 * `ParseKeys`, so a typo in the JSON path also fails `tsc`/`npm run build`.
 */
export const PREFERENCE_LABEL_KEY: Record<NotificationItem["type"], ParseKeys> = {
  FEEDBACK_REQUESTED_TO_PROVIDER: "notifications.preference.FEEDBACK_REQUESTED_TO_PROVIDER",
  FEEDBACK_REQUESTED_TO_REQUESTER: "notifications.preference.FEEDBACK_REQUESTED_TO_REQUESTER",
  FEEDBACK_SENT_TO_SUBJECT: "notifications.preference.FEEDBACK_SENT_TO_SUBJECT",
  FEEDBACK_SENT_TO_PROVIDER: "notifications.preference.FEEDBACK_SENT_TO_PROVIDER",
  FEEDBACK_SENT_TO_REQUESTER: "notifications.preference.FEEDBACK_SENT_TO_REQUESTER",
  FEEDBACK_SENT_TO_MANAGER: "notifications.preference.FEEDBACK_SENT_TO_MANAGER",
  FEEDBACK_REJECTED_TO_REQUESTER: "notifications.preference.FEEDBACK_REJECTED_TO_REQUESTER",
  FEEDBACK_PICKED_UP_TO_REQUESTER: "notifications.preference.FEEDBACK_PICKED_UP_TO_REQUESTER",
  FEEDBACK_WITHDRAWN_TO_SUBJECT: "notifications.preference.FEEDBACK_WITHDRAWN_TO_SUBJECT",
  FEEDBACK_WITHDRAWN_TO_REQUESTER: "notifications.preference.FEEDBACK_WITHDRAWN_TO_REQUESTER",
  FEEDBACK_DELETED_TO_REQUESTER: "notifications.preference.FEEDBACK_DELETED_TO_REQUESTER",
  FEEDBACK_REQUEST_EXPIRED_TO_REQUESTER:
    "notifications.preference.FEEDBACK_REQUEST_EXPIRED_TO_REQUESTER",
  FEEDBACK_REQUEST_EXPIRED_TO_PROVIDER:
    "notifications.preference.FEEDBACK_REQUEST_EXPIRED_TO_PROVIDER",
  ONE_ON_ONE_CREATED_TO_SUBORDINATE: "notifications.preference.ONE_ON_ONE_CREATED_TO_SUBORDINATE",
  ONE_ON_ONE_CREATED_TO_MANAGER: "notifications.preference.ONE_ON_ONE_CREATED_TO_MANAGER",
  GOAL_ACTIVATED_TO_SUBORDINATE: "notifications.preference.GOAL_ACTIVATED_TO_SUBORDINATE",
  GOAL_DEACTIVATED_TO_SUBORDINATE: "notifications.preference.GOAL_DEACTIVATED_TO_SUBORDINATE",
  GOAL_ARCHIVED_TO_SUBORDINATE: "notifications.preference.GOAL_ARCHIVED_TO_SUBORDINATE",
  GOAL_REOPENED_TO_SUBORDINATE: "notifications.preference.GOAL_REOPENED_TO_SUBORDINATE",
  GOAL_PROGRESS_UPDATED_TO_SUBORDINATE:
    "notifications.preference.GOAL_PROGRESS_UPDATED_TO_SUBORDINATE",
  GOAL_PROGRESS_UPDATED_TO_MANAGER: "notifications.preference.GOAL_PROGRESS_UPDATED_TO_MANAGER",
  TEAM_KPI_ACTIVATED_TO_MEMBER: "notifications.preference.TEAM_KPI_ACTIVATED_TO_MEMBER",
  TEAM_KPI_DEACTIVATED_TO_MEMBER: "notifications.preference.TEAM_KPI_DEACTIVATED_TO_MEMBER",
  TEAM_KPI_ARCHIVED_TO_MEMBER: "notifications.preference.TEAM_KPI_ARCHIVED_TO_MEMBER",
  TEAM_KPI_REOPENED_TO_MEMBER: "notifications.preference.TEAM_KPI_REOPENED_TO_MEMBER",
  TEAM_KPI_VALUE_RECORDED_TO_MEMBER: "notifications.preference.TEAM_KPI_VALUE_RECORDED_TO_MEMBER",
  TEAM_KPI_VALUE_CORRECTED_TO_MEMBER:
    "notifications.preference.TEAM_KPI_VALUE_CORRECTED_TO_MEMBER",
  TEAM_KPI_VALUE_REMOVED_TO_MEMBER: "notifications.preference.TEAM_KPI_VALUE_REMOVED_TO_MEMBER",
  PERFORMANCE_REVIEW_PUBLISHED_TO_SUBORDINATE:
    "notifications.preference.PERFORMANCE_REVIEW_PUBLISHED_TO_SUBORDINATE",
  PERFORMANCE_REVIEW_UNPUBLISHED_TO_SUBORDINATE:
    "notifications.preference.PERFORMANCE_REVIEW_UNPUBLISHED_TO_SUBORDINATE",
  DAYS_OFF_CREATED: "notifications.preference.DAYS_OFF_CREATED",
  DAYS_OFF_DELETED: "notifications.preference.DAYS_OFF_DELETED",
  DAYS_OFF_CORRECTED_TO_OWNER: "notifications.preference.DAYS_OFF_CORRECTED_TO_OWNER",
  DAYS_OFF_ALLOWANCE_CHANGED: "notifications.preference.DAYS_OFF_ALLOWANCE_CHANGED",
  PULSE_CYCLE_SCHEDULED: "notifications.preference.PULSE_CYCLE_SCHEDULED",
  PULSE_CYCLE_OPENED: "notifications.preference.PULSE_CYCLE_OPENED",
  PULSE_RESULTS_AVAILABLE: "notifications.preference.PULSE_RESULTS_AVAILABLE",
  PULSE_CYCLE_CANCELLED: "notifications.preference.PULSE_CYCLE_CANCELLED",
  IMPACT_ENTRY_CREATED_TO_MANAGER: "notifications.preference.IMPACT_ENTRY_CREATED_TO_MANAGER",
  IMPACT_ENTRY_UPDATED_TO_MANAGER: "notifications.preference.IMPACT_ENTRY_UPDATED_TO_MANAGER",
  IMPACT_ENTRY_DELETED_TO_MANAGER: "notifications.preference.IMPACT_ENTRY_DELETED_TO_MANAGER",
  CAREER_POSITION_STARTED_TO_USER: "notifications.preference.CAREER_POSITION_STARTED_TO_USER",
  PASSWORD_CHANGED: "notifications.preference.PASSWORD_CHANGED",
};
