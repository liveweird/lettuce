import type { TFunction } from "i18next";
import { hasLength } from "@mantine/form";
import { type CreateAlertBody } from "../api/alerts";
import { datetimeLocalToEpoch } from "./datetime";

// Server limits (server alerts/Alert.kt) mirrored client-side.
export const MAX_ALERT_TITLE_LENGTH = 150;
export const MAX_ALERT_CONTENT_LENGTH = 5000;

// Datetime bounds live in the form as <input type="datetime-local"> strings gated by an
// explicit "set" checkbox each (both bounds are optional and this makes it visible at a
// glance); toAlertBody converts to epoch millis at the API boundary.
export type AlertFormValues = {
  title: string;
  content: string;
  isActive: boolean;
  startsAtSet: boolean;
  startsAt: string;
  endsAtSet: boolean;
  endsAt: string;
};

/** The shared blank form (create page; edit initializes from the loaded alert). */
export function emptyAlertFormValues(): AlertFormValues {
  return {
    title: "",
    content: "",
    isActive: true,
    startsAtSet: false,
    startsAt: "",
    endsAtSet: false,
    endsAt: "",
  };
}

/** Validation rules shared by the create and edit alert pages (mirrors the server's checks). */
export function alertFormValidation(t: TFunction) {
  return {
    title: hasLength({ min: 1, max: MAX_ALERT_TITLE_LENGTH }, t("alerts.titleLength")),
    content: (v: string) => {
      if (!v.trim()) return t("alerts.contentRequired");
      // The editor hard-caps typing; this backstop covers programmatic value pushes.
      return v.length > MAX_ALERT_CONTENT_LENGTH ? t("alerts.contentLength") : null;
    },
    startsAt: (value: string, values: AlertFormValues) =>
      values.startsAtSet && !value ? t("alerts.boundRequired") : null,
    endsAt: (value: string, values: AlertFormValues) => {
      if (values.endsAtSet && !value) return t("alerts.boundRequired");
      if (!values.startsAtSet || !values.endsAtSet) return null;
      const start = datetimeLocalToEpoch(values.startsAt);
      const end = datetimeLocalToEpoch(value);
      return start != null && end != null && start >= end ? t("alerts.windowInvalid") : null;
    },
  };
}

/** Form values -> the API request body (an unchecked bound is null regardless of the input). */
export function toAlertBody(values: AlertFormValues): CreateAlertBody {
  return {
    title: values.title,
    content: values.content,
    isActive: values.isActive,
    startsAt: values.startsAtSet ? datetimeLocalToEpoch(values.startsAt) : null,
    endsAt: values.endsAtSet ? datetimeLocalToEpoch(values.endsAt) : null,
  };
}
