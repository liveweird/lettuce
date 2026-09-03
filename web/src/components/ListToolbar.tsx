import { type ReactNode } from "react";
import { Button, Group, Stack } from "@mantine/core";
import { IconSearch } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useFilterPanel } from "../hooks/useFilterPanel";
import ClearableTextInput from "./ClearableTextInput";
import { FilterPanelBody, FilterToggle } from "./FilterPanel";

export type ListToolbarProps = {
  /** The collapsible filter panel: its controls, the active count on the toggle, and the
   *  view's storage key (the FilterPanel contract). `onClear` shows a "Clear filters" link
   *  while any filter is active. */
  filters?: {
    activeCount: number;
    storageKey: string;
    onClear?: () => void;
    children: ReactNode;
  };
  /** The always-visible quick search — the list's primary substring filter (its label is the
   *  input's accessible name, so `getByLabel("Name")` keeps working). */
  search?: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    clearLabel: string;
  };
  /** The right-hand slot: a sort picker (card grids), a scope switch, a view toggle. */
  right?: ReactNode;
};

/**
 * The list toolbar (v3.3.0): quick search + Filters toggle (+ Clear) on the left, the view's
 * secondary controls on the right, and the open filter panel spanning the width below. One
 * shape for every list, so filters are always found in the same place.
 */
export default function ListToolbar({ filters, search, right }: ListToolbarProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useFilterPanel(filters?.storageKey ?? "list");
  const showClear = filters?.onClear != null && filters.activeCount > 0;
  return (
    <Stack gap="sm">
      <Group justify="space-between" align="center" wrap="wrap" gap="sm">
        <Group gap="xs" align="center" wrap="wrap">
          {search && (
            <ClearableTextInput
              hideLabel
              label={search.label}
              value={search.value}
              onChange={search.onChange}
              clearLabel={search.clearLabel}
              placeholder={t("common.filter.search")}
              leftSection={<IconSearch size={16} />}
              w={260}
            />
          )}
          {filters && (
            <FilterToggle
              open={open}
              onToggle={() => setOpen(!open)}
              activeFilterCount={filters.activeCount}
            />
          )}
          {showClear && (
            <Button variant="subtle" size="xs" onClick={filters?.onClear}>
              {t("common.filter.clear")}
            </Button>
          )}
        </Group>
        {right && <Group gap="sm">{right}</Group>}
      </Group>
      {filters && open && <FilterPanelBody>{filters.children}</FilterPanelBody>}
    </Stack>
  );
}
