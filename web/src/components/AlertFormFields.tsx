import { lazy, Suspense } from "react";
import { Checkbox, CloseButton, Group, Skeleton, Stack, Switch, Text, TextInput } from "@mantine/core";
import { hasLength, type UseFormReturnType } from "@mantine/form";
import { useTranslation } from "react-i18next";
import type { CreateAlertBody } from "../api/client";
import { datetimeLocalToEpoch } from "../utils/datetime";

const MarkdownEditor = lazy(() => import("./MarkdownEditor"));

// Datetime bounds live in the form as <input type="datetime-local"> strings gated by an
// explicit "set" checkbox each (both bounds are optional and this makes it visible at a
// glance); the pages convert to/from epoch millis at the API boundary (utils/datetime.ts).
export type AlertFormValues = {
  title: string;
  content: string;
  isActive: boolean;
  startsAtSet: boolean;
  startsAt: string;
  endsAtSet: boolean;
  endsAt: string;
};

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

/** One optional bound: a checkbox that enables the datetime input next to it. */
function BoundField({
  form,
  setField,
  valueField,
  label,
  uncheckedHint,
}: {
  form: UseFormReturnType<AlertFormValues>;
  setField: "startsAtSet" | "endsAtSet";
  valueField: "startsAt" | "endsAt";
  label: string;
  uncheckedHint: string;
}) {
  const enabled = form.values[setField];
  return (
    <Stack gap={6}>
      <Checkbox
        label={label}
        {...form.getInputProps(setField, { type: "checkbox" })}
        onChange={(e) => {
          const checked = e.currentTarget.checked;
          form.setFieldValue(setField, checked);
          // Unchecking means "unbounded": drop the value and any validation error with it.
          if (!checked) {
            form.setFieldValue(valueField, "");
            form.clearFieldError(valueField);
          }
        }}
      />
      <TextInput
        type="datetime-local"
        aria-label={label}
        disabled={!enabled}
        description={enabled ? undefined : uncheckedHint}
        // Render the hint/error BELOW the input (default is above it), so the two bound
        // controls stay level with each other regardless of checkbox state.
        inputWrapperOrder={["label", "input", "description", "error"]}
        {...form.getInputProps(valueField)}
      />
    </Stack>
  );
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
        <BoundField
          form={form}
          setField="startsAtSet"
          valueField="startsAt"
          label={t("alerts.fieldStartsAt")}
          uncheckedHint={t("alerts.startsAtHint")}
        />
        <BoundField
          form={form}
          setField="endsAtSet"
          valueField="endsAt"
          label={t("alerts.fieldEndsAt")}
          uncheckedHint={t("alerts.endsAtHint")}
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
