import { type ReactNode } from "react";
import { Badge, Button, Group } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconChevronDown, IconFilter } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

/**
 * Collapsible list-filter panel: a "Filters" toggle (with an active-count badge) that shows/hides the
 * filter controls passed as children. Collapsed by default; filter state lives in the parent, so
 * collapsing never loses values. Shared by every list view.
 */
export default function FilterPanel({
  activeFilterCount,
  children,
}: {
  activeFilterCount: number;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [open, { toggle }] = useDisclosure(false);
  return (
    <div>
      <Group gap="xs" mb={open ? "sm" : 0}>
        <Button
          variant="default"
          size="xs"
          onClick={toggle}
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
      </Group>
      {open && (
        <Group align="flex-end" gap="sm">
          {children}
        </Group>
      )}
    </div>
  );
}
