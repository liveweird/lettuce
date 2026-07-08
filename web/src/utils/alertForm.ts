import { hasLength } from "@mantine/form";
import { ApiError, type CreateAlertBody } from "../api/client";
import { datetimeLocalToEpoch } from "./datetime";

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
export function alertFormValidation(t: (key: string) => string) {
  return {
    title: hasLength({ min: 1, max: 150 }, t("alerts.titleLength")),
    content: (v: string) => (v.trim() ? null : t("alerts.contentRequired")),
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

/**
 * The save-error mapping the create and edit pages share (403/400/status/network, plus the
 * edit-only 404 "gone" case). Returns the user-facing message for the page-level Alert.
 */
export function alertSaveErrorMessage(
  err: unknown,
  t: (key: string, opts?: Record<string, unknown>) => string,
  mode: "create" | "edit",
): string {
  if (err instanceof ApiError) {
    if (err.status === 403) return t(`alerts.${mode}Forbidden`);
    if (mode === "edit" && err.status === 404) return t("alerts.alertGone");
    if (err.status === 400) return t("alerts.validationError");
    return t(`alerts.${mode}FailedStatus`, { status: err.status });
  }
  return t(`alerts.${mode}FailedNetwork`);
}
