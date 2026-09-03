import { lazy, Suspense } from "react";
import { CloseButton, Skeleton, Text, TextInput } from "@mantine/core";
import { type UseFormReturnType } from "@mantine/form";
import { useTranslation } from "react-i18next";
import { charCountDescription } from "../utils/charCount";
import {
  MAX_TEMPLATE_CONTENT_LENGTH,
  MAX_TEMPLATE_NAME_LENGTH,
  type TemplateFormValues,
} from "../utils/templateForm";

const MarkdownEditor = lazy(() => import("./MarkdownEditor"));

/** The field block shared by the create and edit template pages (which own submit/error handling). */
export default function TemplateFormFields({ form }: { form: UseFormReturnType<TemplateFormValues> }) {
  const { t } = useTranslation();
  return (
    <>
      <TextInput
        label={t("common.field.name")}
        autoFocus
        maxLength={MAX_TEMPLATE_NAME_LENGTH}
        description={charCountDescription(form.values.name.length, MAX_TEMPLATE_NAME_LENGTH)}
        inputWrapperOrder={["label", "input", "description", "error"]}
        rightSection={
          form.values.name ? (
            <CloseButton
              size="sm"
              aria-label={t("templates.clearName")}
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => form.setFieldValue("name", "")}
            />
          ) : null
        }
        rightSectionPointerEvents="auto"
        {...form.getInputProps("name")}
      />
      <Suspense fallback={<Skeleton height={220} radius="sm" />}>
        <MarkdownEditor
          label={t("common.field.content")}
          placeholder={t("templates.contentPlaceholder")}
          maxLength={MAX_TEMPLATE_CONTENT_LENGTH}
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
