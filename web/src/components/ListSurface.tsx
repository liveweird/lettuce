import type { ReactNode } from "react";
import classes from "./ListSurface.module.css";

/** One resource surface: controls, results and pagination stay visually connected. */
export default function ListSurface({
  toolbar,
  children,
  footer,
  cards = false,
}: {
  toolbar?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Card collections already own their borders; keep the shared controls without a nested frame. */
  cards?: boolean;
}) {
  return (
    <div className={classes.surface} data-cards={cards || undefined}>
      {toolbar && <div className={classes.toolbar}>{toolbar}</div>}
      <div className={classes.body}>{children}</div>
      {footer && <div className={classes.footer}>{footer}</div>}
    </div>
  );
}
