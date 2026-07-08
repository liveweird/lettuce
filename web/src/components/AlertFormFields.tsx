import { lazy, Suspense } from "react";
import { CloseButton, Group, Skeleton, Switch, Text, TextInput } from "@mantine/core";
import { hasLength, type UseFormReturnType } from "@mantine/form";
import { useTranslation } from "react-i18next";
import type { CreateAlertBody } from "../api/client";
import { datetimeLocalToEpoch } from "../utils/datetime";

const MarkdownEditor = lazy(() => import("./MarkdownEditor"));

// Datetime bounds live in the form as <input type="datetime-local"> strings ("" = unset);
// the pages convert to/from epoch millis at the API boundary (utils/datetime.ts).
export type AlertFormValues = {
  title: string;
  content: string;
  isActive: boolean;
  startsAt: string;
  endsAt: string;
};

/** Validation rules shared by the create and edit alert pages (mirrors the server's checks). */
export function alertFormValidation(t: (key: string) => string) {
  return {
    title: hasLength({ min: 1, max: 150 }, t("alerts.titleLength")),
    content: (v: string) => (v.trim() ? null : t("alerts.contentRequired")),
    endsAt: (value: string, values: AlertFormValues) => {
      const start = datetimeLocalToEpoch(values.startsAt);
      const end = datetimeLocalToEpoch(value);
      return start != null && end != null && start >= end ? t("alerts.windowInvalid") : null;
    },
  };
}

/** Form values -> the API request body (datetime-local strings -> epoch millis). */
export function toAlertBody(values: AlertFormValues): CreateAlertBody {
  return {
    title: values.title,
    content: values.content,
    isActive: values.isActive,
    startsAt: datetimeLocalToEpoch(values.startsAt),
    endsAt: datetimeLocalToEpoch(values.endsAt),
  };
}

/** The field block shared by the create and edit alert pages (which own submit/error handling). */
export default function AlertFormFields({ form }: { form: UseFormReturnType<AlertFormValues> }) {
  const { t } = useTranslation();
  return (
    <>
      <TextInput
        label={t("alerts.fieldTitle")}
        autoFocus
        maxLength={150}
        rightSection={
          form.values.title ? (
            <CloseButton
              size="sm"
              aria-label={t("alerts.clearTitle")}
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => form.setFieldValue("title", "")}
            />
          ) : null
        }
        rightSectionPointerEvents="auto"
        {...form.getInputProps("title")}
      />
      <Switch
        label={t("alerts.fieldActive")}
        description={t("alerts.activeHint")}
        {...form.getInputProps("isActive", { type: "checkbox" })}
      />
      <Group grow align="flex-start">
        <TextInput
          type="datetime-local"
          label={t("alerts.fieldStartsAt")}
          description={t("alerts.startsAtHint")}
          {...form.getInputProps("startsAt")}
        />
        <TextInput
          type="datetime-local"
          label={t("alerts.fieldEndsAt")}
          description={t("alerts.endsAtHint")}
          {...form.getInputProps("endsAt")}
        />
      </Group>
      <Suspense fallback={<Skeleton height={220} radius="sm" />}>
        <MarkdownEditor
          label={t("common.field.content")}
          placeholder={t("alerts.contentPlaceholder")}
          maxLength={5000}
          value={form.values.content}
          onChange={(md) => form.setFieldValue("content", md)}
        />
      </Suspense>
      {/* MarkdownEditor is not a form-bound input, so its validation error renders here. */}
      {form.errors.content && (
        <Text size="sm" c="red">
          {form.errors.content}
        </Text>
      )}
    </>
  );
}
