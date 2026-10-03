import { MultiSelect, type ComboboxData, type MultiSelectProps } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { accessibleRenderPill } from "./accessiblePill";

/**
 * The multi-value list filter (v4.13.0, API-LIST-004 "any of"): a searchable, clearable
 * MultiSelect whose empty state reads "All" (no filter), with named pill remove buttons. Used by
 * every converted list filter (status / team / type) and the Mass-share facets; a filter sets
 * the stored array and the query helpers send it as a repeated key. Search folds accents through
 * the theme-level `foldedOptionsFilter`. Typed on the option value so a status filter's setter
 * takes the enum array, not `string[]`.
 */
export default function FilterMultiSelect<T extends string = string>({
  value,
  onChange,
  data,
  w = 220,
  ...rest
}: Omit<MultiSelectProps, "value" | "onChange" | "data" | "renderPill" | "searchable" | "clearable"> & {
  value: readonly T[];
  onChange: (next: T[]) => void;
  data: ComboboxData;
}) {
  const { t } = useTranslation();
  return (
    <MultiSelect
      placeholder={value.length === 0 ? t("common.state.all") : undefined}
      renderPill={accessibleRenderPill((label) => t("common.filter.removeValue", { value: label }))}
      searchable
      clearable
      w={w}
      {...rest}
      data={data}
      value={[...value]}
      onChange={(next) => onChange(next as T[])}
    />
  );
}
