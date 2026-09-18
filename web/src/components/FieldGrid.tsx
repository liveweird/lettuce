import { SimpleGrid, type SimpleGridProps } from "@mantine/core";
import type { ReactNode } from "react";

/**
 * The equal-column field row of the v3.5.0 form shells: fields FILL their column, so column
 * starts align with each other and with the enclosing `Fieldset`'s content edge — use it
 * instead of a `Group` of fixed-width inputs, which stops wherever its content ends and lines
 * up with nothing. A container-query grid (the dashboard person-card precedent), so it keys on
 * the card's own width — the icon rail and the Container tier never shift the breakpoint: one
 * column on a phone, three from 40em of card width.
 */
export default function FieldGrid({
  children,
  cols = { base: 1, "40em": 3 },
  ...rest
}: {
  children: ReactNode;
  cols?: SimpleGridProps["cols"];
} & Omit<SimpleGridProps, "cols" | "type" | "children">) {
  return (
    <SimpleGrid
      type="container"
      cols={cols}
      spacing="xl"
      verticalSpacing="md"
      {...rest}
    >
      {children}
    </SimpleGrid>
  );
}
