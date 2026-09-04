import { lazy, Suspense } from "react";
import { Checkbox, CloseButton, Group, Skeleton, Stack, Switch, Text, TextInput } from "@mantine/core";
import { type UseFormReturnType } from "@mantine/form";
import { useTranslation } from "react-i18next";
import DateTimeField from "./DateTimeField";
import { MAX_ALERT_CONTENT_LENGTH, MAX_ALERT_TITLE_LENGTH, type AlertFormValues } from "../utils/alertForm";
import { charCountDescription } from "../utils/charCount";

const MarkdownEditor = lazy(() => import("./MarkdownEditor"));

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
      <DateTimeField
        label={label}
        disabled={!enabled}
        description={enabled ? undefined : uncheckedHint}
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
        maxLength={MAX_ALERT_TITLE_LENGTH}
        description={charCountDescription(form.values.title.length, MAX_ALERT_TITLE_LENGTH)}
        inputWrapperOrder={["label", "input", "description", "error"]}
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
          maxLength={MAX_ALERT_CONTENT_LENGTH}
          value={form.values.content}
          onChange={(md) => form.setFieldValue("content", md)}
        />
      </Suspense>
      {/* MarkdownEditor is not a form-bound input, so its validation error renders here. */}
      {form.errors.content && (
        <Text size="sm" c="var(--lettuce-ink-error)">
          {form.errors.content}
        </Text>
      )}
    </>
  );
}
