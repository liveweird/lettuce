import { useTranslation } from "react-i18next";
import { Select, type SelectProps } from "@mantine/core";
import type { DictionaryEntry, DictionarySlug } from "../api/dictionaries";
import { useDictionaryOptions } from "../hooks/useDictionaryOptions";

type Props = {
  slug: DictionarySlug;
  /** The prefilled entry — appended to the options when soft-deleted, so it still displays. */
  current?: DictionaryEntry | null;
} & SelectProps;

// One career-position picker (the RolesMultiSelect idiom: spread the value/onChange over it).
// Deliberately not clearable: the position form requires all three fields (v2.15.1), so
// values are only ever replaced — the required asterisk plus the disabled submit carry the
// empty state (the pre-v2.15.0 orange "missing" warning belonged to the retired optional
// admin-edit form and is gone).
export default function CareerProfileSelect({ slug, current, ...selectProps }: Props) {
  const { t } = useTranslation();
  const { options, loading, error: optionsError } = useDictionaryOptions(slug, current);

  return (
    <Select
      data={options}
      searchable
      clearable={false}
      allowDeselect={false}
      placeholder={loading ? t("common.state.loading") : t("users.profile.pickPlaceholder")}
      disabled={loading}
      nothingFoundMessage={t("users.profile.noMatch")}
      {...selectProps}
      // A failed dictionary load must not look like an empty list (the form error wins).
      error={selectProps.error ?? (optionsError ? t("common.error.optionsFailed") : undefined)}
    />
  );
}
