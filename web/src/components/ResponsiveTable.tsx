import { useEffect, useRef, useState } from "react";
import { Table, type TableProps } from "@mantine/core";
import { useTranslation } from "react-i18next";
import classes from "./ResponsiveTable.module.css";

type ResponsiveTableProps = TableProps & {
  /** Ordinary lists stack within their available container; comparison matrices scroll. */
  mode?: "list" | "matrix";
  density?: "compact" | "normal" | "wide";
  minWidth?: number;
};

function ResponsiveTable({
  mode = "list", density = "normal", minWidth = 900, className, children, ...props
}: ResponsiveTableProps) {
  const { t } = useTranslation();
  const viewportRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  // The matrix-mode scroll hint (and the affordance it advertises) is only meaningful once the
  // table actually overflows its viewport — a narrow matrix at a wide enough breakpoint needs
  // neither. ResizeObserver's callback also fires once on observe(), so this doubles as the
  // initial check; happy-dom has no ResizeObserver, so tests get exactly that one mount-time
  // check and nothing further (no window-resize fallback — unnecessary per the measured usage).
  useEffect(() => {
    if (mode !== "matrix") return undefined;
    const el = viewportRef.current;
    if (!el) return undefined;
    const check = () => setOverflowing(el.scrollWidth > el.clientWidth);
    check();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [mode]);

  const showHint = mode === "matrix" && overflowing;
  return (
    <div
      className={classes.container}
      data-density={density}
      data-mode={mode}
      data-overflowing={showHint || undefined}
    >
      {showHint && <div className={classes.scrollHint}>{t("common.table.scrollHint")}</div>}
      <div
        ref={viewportRef}
        className={classes.viewport}
        tabIndex={mode === "matrix" ? 0 : undefined}
        role={mode === "matrix" ? "region" : undefined}
        aria-label={mode === "matrix" ? t("common.table.scrollRegion") : undefined}
      >
        <Table
          {...props}
          role="table"
          layout={mode === "list" ? "fixed" : "auto"}
          miw={mode === "matrix" ? minWidth : undefined}
          className={[classes.table, className].filter(Boolean).join(" ")}
        >
          {children}
        </Table>
      </div>
    </div>
  );
}

function Thead(props: Table.Thead.Props) {
  return <Table.Thead {...props} role="rowgroup" />;
}
function Tbody(props: Table.Tbody.Props) {
  return <Table.Tbody {...props} role="rowgroup" />;
}
function Tr(props: Table.Tr.Props) {
  return <Table.Tr {...props} role="row" />;
}
function Th({ sortable, actions, primary, vertical, ...props }: Table.Th.Props & {
  sortable?: boolean; actions?: boolean; primary?: boolean;
  /** A matrix-mode affordance for narrow numeric columns (e.g. rotated rating headers) —
      shrinks the column to its rotated label's width. List/stacked modes never use it. */
  vertical?: boolean;
}) {
  return <Table.Th {...props} role="columnheader" scope="col" data-sortable={sortable || undefined}
    data-actions={actions || undefined} data-primary={primary || undefined} data-vertical={vertical || undefined} />;
}
function Td({ label, actions, primary, children, className, ...props }: Table.Td.Props & {
  /** Translated column label; also shown when the row stacks. Omit for spanning states. */
  label?: string; actions?: boolean; primary?: boolean;
}) {
  return (
    <Table.Td {...props} role="cell" data-actions={actions || undefined} data-primary={primary || undefined}
      className={[classes.cell, className].filter(Boolean).join(" ")}>
      {label && <span className={classes.label} data-label={label} aria-hidden="true" />}
      <div className={classes.content}>{children}</div>
    </Table.Td>
  );
}

ResponsiveTable.Thead = Thead;
ResponsiveTable.Tbody = Tbody;
ResponsiveTable.Tr = Tr;
ResponsiveTable.Th = Th;
ResponsiveTable.Td = Td;
export default ResponsiveTable;
