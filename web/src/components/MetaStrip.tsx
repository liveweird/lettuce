import type { ReactNode } from "react";
import classes from "./MetaStrip.module.css";

export type MetaStripItem = {
  label: ReactNode;
  /** Text, a PersonaChip, a pill — or a control (the v3.5.0 form context lines). */
  value: ReactNode;
  key?: string;
};

/**
 * The metadata strip (v3.4.0): a `<dl>` of label-over-value cells that auto-fits the
 * width — the identity line of a detail page (Team details: Name, Manager) and, from
 * v3.5.0, the detail/form context lines. Replaces ad-hoc rows of ReadOnlyFields.
 */
export default function MetaStrip({ items }: { items: MetaStripItem[] }) {
  return (
    <dl className={classes.strip}>
      {items.map((item, index) => (
        <div key={item.key ?? index} className={classes.item}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
