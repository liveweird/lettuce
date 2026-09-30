import type { PropsWithChildren } from "react";
import { Paper, type PaperProps } from "@mantine/core";
import classes from "./FormSurface.module.css";

/** Responsive document/form framing; form state and submission stay with the owning page. */
export default function FormSurface({ className, compact = false, ...props }: PropsWithChildren<Omit<PaperProps, "p" | "px" | "py" | "shadow"> & { compact?: boolean }>) {
  return <Paper {...props} data-compact={compact || undefined} withBorder radius="md" className={[classes.surface, className].filter(Boolean).join(" ")} />;
}
