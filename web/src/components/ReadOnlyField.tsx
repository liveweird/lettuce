import type { ReactNode } from "react";
import { Box, Input } from "@mantine/core";

/**
 * A labeled read-only value styled like a form field: input-style label over content vertically
 * centered at input height (mih 36), so it sits flush next to a picker / real inputs on the
 * view and edit screens. Owns that alignment contract — don't re-inline the wrapper.
 */
export default function ReadOnlyField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Input.Wrapper label={label}>
      <Box mih={36} display="flex" style={{ alignItems: "center" }}>
        {children}
      </Box>
    </Input.Wrapper>
  );
}
