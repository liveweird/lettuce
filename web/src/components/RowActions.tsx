import type { ReactNode } from "react";
import { ActionIcon, Group, Menu, Tooltip } from "@mantine/core";
import { IconDotsVertical } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";

export type RowActionItem = {
  /** The visible tooltip / menu text. */
  label: string;
  /** The accessible name when it must differ from the label (the templated per-row arias,
   *  e.g. "Delete {{name}}"); defaults to `label`. */
  ariaLabel?: string;
  icon?: ReactNode;
  /** A router target — the control renders as a link (role stays `link`). */
  to?: string;
  onClick?: () => void;
  /** Destructive items render red. */
  color?: "red";
  disabled?: boolean;
  loading?: boolean;
  /** A separator above this item inside the ⋯ menu. */
  dividerBefore?: boolean;
};

export type RowActionMenu = {
  /** The trigger's accessible name (e.g. "Feedback actions for {{name}}"). */
  label: string;
  icon: ReactNode;
  items: RowActionItem[];
};

export type RowActionsProps = {
  /** The row subject — names the default ⋯ trigger ("More actions for {{name}}"); a
   *  primary-only cell may omit it. */
  name?: string;
  /** The one action worth a visible icon button. */
  primary?: RowActionItem & { icon: ReactNode };
  /** Named icon-menus rendered before the ⋯ (a topic with its own asserted trigger name,
   *  such as the Users "Feedback actions for X"). */
  menus?: RowActionMenu[];
  /** Everything else, destructive actions included — the ⋯ overflow menu. */
  items?: RowActionItem[];
  /** The ⋯ trigger's accessible name when a page must keep an asserted one ("Modify actions
   *  for X"); defaults to common.table.moreActionsFor. */
  menuLabel?: string;
  size?: "sm" | "md";
};

function MenuEntry({ item }: { item: RowActionItem }) {
  const shared = {
    leftSection: item.icon,
    color: item.color,
    disabled: item.disabled,
    "aria-label": item.ariaLabel,
  };
  return (
    <>
      {item.dividerBefore && <Menu.Divider />}
      {item.to ? (
        <Menu.Item component={RouterLink} to={item.to} {...shared}>
          {item.label}
        </Menu.Item>
      ) : (
        <Menu.Item onClick={item.onClick} {...shared}>
          {item.label}
        </Menu.Item>
      )}
    </>
  );
}

function IconButton({ item, size }: { item: RowActionItem & { icon: ReactNode }; size: "sm" | "md" }) {
  const common = {
    variant: "subtle" as const,
    color: item.color ?? "gray",
    size,
    "aria-label": item.ariaLabel ?? item.label,
    disabled: item.disabled,
    loading: item.loading,
  };
  const control = item.to ? (
    <ActionIcon component={RouterLink} to={item.to} {...common}>
      {item.icon}
    </ActionIcon>
  ) : (
    <ActionIcon onClick={item.onClick} {...common}>
      {item.icon}
    </ActionIcon>
  );
  // A disabled control can't anchor a tooltip (no pointer events) — render it bare.
  return item.disabled ? control : <Tooltip label={item.label}>{control}</Tooltip>;
}

/**
 * The one row-action cell (v3.3.0): the row's primary action as an icon button with a
 * tooltip, optional named icon-menus, and the ⋯ overflow menu for everything else — the
 * destructive actions included, so no list paints a red button on every row. Accessible
 * names are the callers' existing per-row strings, so the e2e/unit locators survive; menu
 * items keep the link/button role split (`to` → a real anchor).
 */
export default function RowActions({ name, primary, menus = [], items = [], menuLabel, size = "sm" }: RowActionsProps) {
  const { t } = useTranslation();
  const moreLabel =
    menuLabel ?? (name == null ? t("common.table.moreActions") : t("common.table.moreActionsFor", { name }));
  return (
    <Group gap={4} wrap="nowrap" justify="flex-end">
      {primary && <IconButton item={primary} size={size} />}
      {menus.map((menu) => (
        <Menu key={menu.label} position="bottom-end" withinPortal shadow="md">
          <Menu.Target>
            <Tooltip label={menu.label}>
              <ActionIcon variant="subtle" color="gray" size={size} aria-label={menu.label}>
                {menu.icon}
              </ActionIcon>
            </Tooltip>
          </Menu.Target>
          <Menu.Dropdown>
            {menu.items.map((item) => (
              <MenuEntry key={item.ariaLabel ?? item.label} item={item} />
            ))}
          </Menu.Dropdown>
        </Menu>
      ))}
      {items.length > 0 && (
        <Menu position="bottom-end" withinPortal shadow="md">
          <Menu.Target>
            <Tooltip label={t("common.table.moreActions")}>
              <ActionIcon variant="subtle" color="gray" size={size} aria-label={moreLabel}>
                <IconDotsVertical size={16} />
              </ActionIcon>
            </Tooltip>
          </Menu.Target>
          <Menu.Dropdown>
            {items.map((item) => (
              <MenuEntry key={item.ariaLabel ?? item.label} item={item} />
            ))}
          </Menu.Dropdown>
        </Menu>
      )}
    </Group>
  );
}
