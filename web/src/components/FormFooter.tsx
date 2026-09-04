import type { ReactNode } from "react";
import { Box, Group } from "@mantine/core";
import classes from "./FormFooter.module.css";

/**
 * The form's action row (v3.5.0): Cancel/secondaries left of the primary, right-aligned.
 * `sticky` pins it to the viewport bottom inside a long editor's Paper (feedback, the impact
 * wizard, nominations, performance reviews); short forms keep it in flow.
 */
export default function FormFooter({ children, sticky = false }: { children: ReactNode; sticky?: boolean }) {
  return (
    <Box className={sticky ? classes.sticky : undefined}>
      <Group justify="flex-end" gap="sm">
        {children}
      </Group>
    </Box>
  );
}
