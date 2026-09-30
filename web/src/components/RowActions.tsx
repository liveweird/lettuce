import type { ReactNode } from "react";
import { ActionIcon, Button, Group, Loader, Menu, Tooltip } from "@mantine/core";
import { IconDotsVertical } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";
import { actionAccessibleName } from "../utils/accessibleActionName";
import classes from "./RowActions.module.css";

type RowActionBase = {
  /** The visible tooltip / menu text. */
  label: string;
  /** The accessible name when it must differ from the label (the templated per-row arias,
   *  e.g. "Delete {{name}}"); defaults to `label`. */
  ariaLabel?: string;
  icon?: ReactNode;
  /** Destructive items render red. */
  color?: "red";
  /** A separator above this item inside the ⋯ menu. */
  dividerBefore?: boolean;
};

/** A router target — the control renders as a link (role stays `link`). A link can't be
 *  disabled or loading (an anchor's `disabled` attribute is inert): hide it instead. */
type RowActionLink = RowActionBase & { to: string; onClick?: never; disabled?: never; loading?: never };

type RowActionButton = RowActionBase & { to?: undefined; onClick?: () => void; disabled?: boolean; loading?: boolean };

export type RowActionItem = RowActionLink | RowActionButton;

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
  /** The one action worth a visible labelled button. */
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
  // A loading item (a row mid-action) reads as busy: disabled, with a spinner in the icon slot.
  const shared = {
    leftSection: item.loading ? <Loader size={14} /> : item.icon,
    color: item.color,
    disabled: item.disabled || item.loading,
    "aria-busy": item.loading || undefined,
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

function PrimaryButton({ item, size }: { item: RowActionItem & { icon: ReactNode }; size: "sm" | "md" }) {
  const common = {
    variant: "subtle" as const,
    color: item.color ?? "lettuce",
    size: size === "sm" ? ("xs" as const) : ("sm" as const),
    "aria-label": actionAccessibleName(item.label, item.ariaLabel),
    disabled: item.disabled,
    loading: item.loading,
    leftSection: item.icon,
    className: classes.primary,
    "data-row-primary": true,
  };
  const control = item.to ? (
    <Button component={RouterLink} to={item.to} {...common}>
      {item.label}
    </Button>
  ) : (
    <Button onClick={item.onClick} {...common}>
      {item.label}
    </Button>
  );
  return control;
}

/**
 * The one row-action cell (v3.3.0): the row's primary action as a compact labelled button,
 * optional named icon-menus, and the ⋯ overflow menu for everything else — the
 * destructive actions included, so no list paints a red button on every row. Contextual
 * accessible names retain the visible label for speech-input matching; menu items keep the
 * link/button role split (`to` → a real anchor).
 */
export default function RowActions({ name, primary, menus = [], items = [], menuLabel, size = "sm" }: RowActionsProps) {
  const { t } = useTranslation();
  const moreLabel =
    menuLabel ?? (name == null ? t("common.table.moreActions") : t("common.table.moreActionsFor", { name }));
  return (
    <Group gap={4} wrap="wrap" justify="flex-end">
      {primary && <PrimaryButton item={primary} size={size} />}
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
            {menu.items.map((item, i) => (
              <MenuEntry key={`${i}-${item.label}`} item={item} />
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
            {items.map((item, i) => (
              <MenuEntry key={`${i}-${item.label}`} item={item} />
            ))}
          </Menu.Dropdown>
        </Menu>
      )}
    </Group>
  );
}
