import { CloseButton, Select, SimpleGrid, TextInput } from "@mantine/core";
import { type UseFormReturnType } from "@mantine/form";
import { useTranslation } from "react-i18next";
import { NATIVE_LANGUAGE_NAMES, SUPPORTED_LANGUAGES } from "../i18n";
import { charCountDescription } from "../utils/charCount";
import {
  MAX_EMAIL_LENGTH,
  MAX_UNIQUE_ID_LENGTH,
  MAX_USER_NAME_LENGTH,
  type UserFormValues,
} from "../utils/userForm";
import RolesMultiSelect from "./RolesMultiSelect";

/**
 * The field block shared by the create and edit user pages (which own submit/error handling
 * and their page-specific tails — the create page's send-email checkbox). Since v3.5.0 the
 * four short identity fields sit in a two-column grid (name/email, unique id/language) and
 * the roles picker spans the full width below.
 */
export default function UserFormFields({ form }: { form: UseFormReturnType<UserFormValues> }) {
  const { t } = useTranslation();
  return (
    <>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md" verticalSpacing="md">
        <TextInput
          label={t("common.field.name")}
          autoFocus
          maxLength={MAX_USER_NAME_LENGTH}
          description={charCountDescription(form.values.name.length, MAX_USER_NAME_LENGTH)}
          rightSection={
            form.values.name ? (
              <CloseButton
                size="sm"
                aria-label={t("users.clearName")}
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => form.setFieldValue("name", "")}
              />
            ) : null
          }
          rightSectionPointerEvents="auto"
          {...form.getInputProps("name")}
        />
        <TextInput
          label={t("common.field.email")}
          type="email"
          autoComplete="email"
          maxLength={MAX_EMAIL_LENGTH}
          description={charCountDescription(form.values.email.length, MAX_EMAIL_LENGTH)}
          rightSection={
            form.values.email ? (
              <CloseButton
                size="sm"
                aria-label={t("users.clearEmail")}
                tabIndex={-1}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => form.setFieldValue("email", "")}
              />
            ) : null
          }
          rightSectionPointerEvents="auto"
          {...form.getInputProps("email")}
        />
        <TextInput
          label={t("users.uniqueId")}
          maxLength={MAX_UNIQUE_ID_LENGTH}
          // The counter takes over the description slot near the cap (the name idiom);
          // otherwise the slot explains the set-once semantics.
          description={
            charCountDescription(form.values.uniqueId.length, MAX_UNIQUE_ID_LENGTH) ??
            t("users.uniqueIdHint")
          }
          {...form.getInputProps("uniqueId")}
        />
        <Select
          label={t("common.language.label")}
          description={t("users.languageHint")}
          data={SUPPORTED_LANGUAGES.map((lng) => ({
            value: lng,
            label: NATIVE_LANGUAGE_NAMES[lng],
          }))}
          allowDeselect={false}
          {...form.getInputProps("language")}
        />
      </SimpleGrid>
      <RolesMultiSelect {...form.getInputProps("roles")} />
    </>
  );
}
