import type { CSSProperties, ReactNode } from "react";
import { Badge, type MantineColor } from "@mantine/core";
import classes from "./StatusPill.module.css";

// The hue formula shared by the pill's own leftSection dot and the standalone StatusDot below —
// the mid shade in light mode, a lighter one on the dark tint (never a shade-suffixed colour).
function hueDotVar(color: MantineColor): CSSProperties {
  const hue = color.split(".")[0];
  return { "--pill-dot": `light-dark(var(--mantine-color-${hue}-6), var(--mantine-color-${hue}-4))` } as CSSProperties;
}

/**
 * A bare hue dot with no pill/label around it — for a status row that has no room for a full
 * badge (PersonCardStats' last-review row). Same colour source as StatusPill's `dot`
 * leftSection: reuse this rather than duplicating the hue formula.
 */
export function StatusDot({ color, style }: { color: MantineColor; style?: CSSProperties }) {
  return <span className={classes.dot} aria-hidden="true" style={{ ...hueDotVar(color), ...style }} />;
}

export type StatusPillProps = {
  /** A bare hue name ("teal", "gray", "lettuce") — never a shade-suffixed colour: the tint
   *  comes from the hue and the AA ink from themeVariables.ts. */
  color: MantineColor;
  children: ReactNode;
  /** A 6px hue dot before the text — the status components set it; plain labels
   *  (visibility, roles, "Default") don't. */
  dot?: boolean;
  size?: "sm" | "md";
  ariaLabel?: string;
  title?: string;
  icon?: ReactNode;
};

/**
 * The one status/label pill (v3.3.0): a sentence-case light Badge in the hue's AA ink,
 * optionally with a hue dot, plus the min-width guard that keeps Mantine from ellipsizing it
 * inside table cells. Every status-badge component renders through it — their per-feature
 * colour maps stay where they are (the single colour source per area).
 */
export default function StatusPill({
  color,
  children,
  dot = false,
  size = "md",
  ariaLabel,
  title,
  icon,
}: StatusPillProps) {
  const style = { minWidth: "max-content", ...hueDotVar(color) } as CSSProperties;
  return (
    <Badge
      color={color}
      size={size}
      leftSection={dot ? <span className={classes.dot} aria-hidden="true" /> : icon}
      style={style}
      aria-label={ariaLabel}
      title={title}
    >
      {children}
    </Badge>
  );
}
