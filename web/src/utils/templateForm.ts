import type { TFunction } from "i18next";
import { hasLength } from "@mantine/form";

// Server limits (server templates/Template.kt) mirrored client-side (v2.18.0).
export const MAX_TEMPLATE_NAME_LENGTH = 100;
export const MAX_TEMPLATE_CONTENT_LENGTH = 5000;

/** The form values shared by CreateTemplate and EditTemplate (the AlertFormValues idiom). */
export type TemplateFormValues = {
  name: string;
  content: string;
};

/** Validation rules shared by the create and edit template pages (mirrors the server's checks). */
export function templateFormValidation(t: TFunction) {
  return {
    name: hasLength({ min: 1, max: MAX_TEMPLATE_NAME_LENGTH }, t("templates.nameLength")),
    // The editor hard-caps typing; this catches pre-limit legacy rows loaded for editing.
    content: (v: string) =>
      v.length > MAX_TEMPLATE_CONTENT_LENGTH ? t("templates.contentLength") : null,
  };
}
