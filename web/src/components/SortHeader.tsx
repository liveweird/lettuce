import { UnstyledButton } from "@mantine/core";
import { IconArrowDown, IconArrowUp, IconArrowsSort } from "@tabler/icons-react";

export type SortDir = "asc" | "desc";

export default function SortHeader<F extends string>({
  field,
  label,
  activeField,
  activeDir,
  onToggle,
}: {
  field: F;
  label: string;
  activeField: F;
  activeDir: SortDir;
  onToggle: (field: F) => void;
}) {
  const isActive = activeField === field;
  const Icon = !isActive ? IconArrowsSort : activeDir === "asc" ? IconArrowUp : IconArrowDown;
  return (
    <UnstyledButton
      onClick={() => onToggle(field)}
      style={{ display: "inline-flex", alignItems: "center", gap: 4, fontWeight: 600, minWidth: 0, maxWidth: "100%", whiteSpace: "normal", textAlign: "left" }}
    >
      <span>{label}</span>
      <Icon style={{ flexShrink: 0 }} size={14} stroke={1.5} opacity={isActive ? 1 : 0.4} />
    </UnstyledButton>
  );
}
