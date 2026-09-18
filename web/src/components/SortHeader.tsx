import { UnstyledButton } from "@mantine/core";
import { IconArrowDown, IconArrowUp, IconArrowsSort } from "@tabler/icons-react";
import classes from "./SortHeader.module.css";

export type SortDir = "asc" | "desc";

export default function SortHeader<F extends string>({
  field,
  label,
  activeField,
  activeDir,
  onToggle,
  orientation = "horizontal",
}: {
  field: F;
  label: string;
  activeField: F;
  activeDir: SortDir;
  onToggle: (field: F) => void;
  /**
   * "vertical" rotates the label for narrow numeric matrix columns — see the `.vertical` rule
   * in SortHeader.module.css. Defaults to the original horizontal layout; every pre-v3.11.1
   * consumer is unaffected.
   */
  orientation?: "horizontal" | "vertical";
}) {
  const isActive = activeField === field;
  const Icon = !isActive ? IconArrowsSort : activeDir === "asc" ? IconArrowUp : IconArrowDown;
  return (
    <UnstyledButton
      onClick={() => onToggle(field)}
      className={[classes.button, orientation === "vertical" ? classes.vertical : null]
        .filter(Boolean)
        .join(" ")}
    >
      <span>{label}</span>
      <Icon style={{ flexShrink: 0 }} size={14} stroke={1.5} opacity={isActive ? 1 : 0.4} />
    </UnstyledButton>
  );
}
