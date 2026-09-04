import type { ReactNode } from "react";
import { Box } from "@mantine/core";

/**
 * The border-first read-only prose shell used by the view screens (feedback content, goal
 * description/summary, template content, the impact-log sections): a hairline border on the
 * surface — no tint — sized to its content (v3.5.0), with an optional line-count minimum so
 * a deliberately taller box (a review summary) keeps its silhouette when short or empty;
 * scrolls when long.
 */
export default function ProseBox({
  children,
  minHeightLines = 1,
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
