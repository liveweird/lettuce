import { type ReactNode } from "react";
import { Badge, Button, Group, Paper } from "@mantine/core";
import { IconChevronDown, IconFilter } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useFilterPanel } from "../hooks/useFilterPanel";

/** The "Filters" toggle with its active-count badge and `aria-expanded` state. */
export function FilterToggle({
  open,
  onToggle,
  activeFilterCount,
}: {
  open: boolean;
  onToggle: () => void;
  activeFilterCount: number;
}) {
  const { t } = useTranslation();
  return (
    <Button
      variant="default"
      size="xs"
      onClick={onToggle}
      aria-expanded={open}
      leftSection={<IconFilter size={16} />}
      rightSection={
        <Group gap={6} wrap="nowrap" component="span">
          {activeFilterCount > 0 && (
            <Badge size="sm" circle variant="filled">
              {activeFilterCount}
            </Badge>
          )}
          <IconChevronDown
            size={16}
            style={{
              transform: open ? "rotate(180deg)" : "none",
              transition: "transform 150ms ease",
            }}
          />
        </Group>
      }
    >
      {t("common.filter.title")}
    </Button>
  );
}

/** The open panel: the filter controls in a wrapping row on a quiet tinted surface — the
 *  `--lettuce-surface-tint` token (gray-0 / dark-6), NOT Mantine's default-hover, whose dark
 *  value (dark-5) leaves the dimmed labels under 4.5:1 (theme.test.ts guards the pair). */
export function FilterPanelBody({ children }: { children: ReactNode }) {
  return (
    <Paper withBorder radius="md" p="sm" bg="var(--lettuce-surface-tint)">
      <Group align="flex-end" gap="sm">
        {children}
      </Group>
    </Paper>
  );
}

/**
 * Collapsible list-filter panel: a "Filters" toggle (with an active-count badge) that shows/hides the
 * filter controls passed as children. Collapsed by default; filter state lives in the parent, so
 * collapsing never loses values. The open/collapsed choice persists per view under `storageKey`
 * (the view's `lettuce.viewSettings.*` namespace). Lists migrating to the v3.3.0 toolbar use
 * ListToolbar, which composes the same two pieces around a quick-search box.
 */
export default function FilterPanel({
  activeFilterCount,
  storageKey,
  children,
}: {
  activeFilterCount: number;
  storageKey: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useFilterPanel(storageKey);
  return (
    <div>
      <Group gap="xs" mb={open ? "sm" : 0}>
        <FilterToggle open={open} onToggle={() => setOpen(!open)} activeFilterCount={activeFilterCount} />
      </Group>
      {open && <FilterPanelBody>{children}</FilterPanelBody>}
    </div>
  );
}
