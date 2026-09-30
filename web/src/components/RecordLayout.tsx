import type { ReactNode } from "react";
import { Paper } from "@mantine/core";
import classes from "./RecordLayout.module.css";

/** A readable document with explicitly placed context; dense workspaces keep full width. */
export default function RecordLayout({
  children,
  metadata,
  metadataPlacement = "top",
}: {
  children: ReactNode;
  metadata?: ReactNode;
  metadataPlacement?: "aside" | "top";
}) {
  return (
    <div className={classes.layout} data-metadata-placement={metadataPlacement}>
      {metadata && metadataPlacement === "top" && <div className={classes.metadata}>{metadata}</div>}
      <Paper withBorder radius="md" className={classes.document}>{children}</Paper>
      {metadata && metadataPlacement === "aside" && <aside className={classes.metadata}>{metadata}</aside>}
    </div>
  );
}
