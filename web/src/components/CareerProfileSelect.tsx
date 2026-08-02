import { useTranslation } from "react-i18next";
import { Select, Text, type SelectProps } from "@mantine/core";
import type { DictionaryEntry, DictionarySlug } from "../api/client";
import { useDictionaryOptions } from "../hooks/useDictionaryOptions";

type Props = {
  slug: DictionarySlug;
  /** The user's current entry — appended to the options when soft-deleted (edit only). */
  current?: DictionaryEntry | null;
} & SelectProps;

// One career-profile picker (the RolesMultiSelect idiom: spread form.getInputProps over it).
// Deliberately not clearable: once a value is set it can never be removed — only replaced —
// mirroring the server rule. An empty value shows the orange missing hint (orange = warning;
// red stays reserved for errors).
export default function CareerProfileSelect({ slug, current, ...selectProps }: Props) {
  const { t } = useTranslation();
  const { options, loading } = useDictionaryOptions(slug, current);
  const missing = !selectProps.value;

  return (
    <Select
      data={options}
      searchable
      clearable={false}
      allowDeselect={false}
      placeholder={loading ? t("common.state.loading") : t("users.profile.pickPlaceholder")}
      disabled={loading}
      nothingFoundMessage={t("users.profile.noMatch")}
      description={
        missing ? (
          <Text size="xs" c="orange.7" component="span">
            {t("users.profile.missingHint")}
          </Text>
        ) : undefined
      }
      {...selectProps}
    />
  );
}
