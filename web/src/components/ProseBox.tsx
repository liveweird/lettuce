import type { ReactNode } from "react";
import { Box } from "@mantine/core";

/**
 * The bordered read-only prose shell used by the view screens (template content, goal
 * description/summary): default border + radius, a line-count minimum height so short and
 * empty content keep the same silhouette, scrolls when long. ViewFeedback's content box is
 * deliberately not this — it is a tinted, focusable scroll region with its own styling.
 */
export default function ProseBox({
  children,
  minHeightLines = 3,
}: {
  children: ReactNode;
  minHeightLines?: number;
}) {
  return (
    <Box
      style={{
        border: "1px solid var(--mantine-color-default-border)",
        borderRadius: "var(--mantine-radius-default)",
        padding: "var(--mantine-spacing-sm)",
        minHeight: `calc(${minHeightLines}lh + 2 * var(--mantine-spacing-sm))`,
        overflow: "auto",
      }}
    >
      {children}
    </Box>
  );
}
