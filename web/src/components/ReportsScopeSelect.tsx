import { Select } from "@mantine/core";
import { useTranslation } from "react-i18next";

type ReportsScope = "direct" | "all";
export type AuditorReportsScope = ReportsScope | "auditor";

export type ReportsScopeSelectBaseProps = {
  value: ReportsScope;
  onChange: (scope: ReportsScope) => void;
  auditorOption?: false;
  auditorOnly?: false;
};

export type ReportsScopeSelectAuditorProps = {
  value: AuditorReportsScope;
  onChange: (scope: AuditorReportsScope) => void;
  /** Offers a third "Everyone (auditor)" option (v4.3.0) — reach for this only behind a
   * `canAudit()` check, never unconditionally. */
  auditorOption: true;
  /** Locks the control to the single auditor option (v4.3.0) — the HR-non-manager shape: an
   * auditor who manages nobody has no meaningful direct/all choice, so the control degrades to
   * a disabled single-option Select rather than offering scopes that are always empty. */
  auditorOnly?: boolean;
};

// The "Reports" filter shared by the manager-facing lists (My subordinates, Feedback →
// My Team): direct reports only (the default) vs. the whole transitive management chain. The
// caller derives its includeIndirect API param from the selected value. Every existing caller
// keeps the plain two-option shape (ReportsScopeSelectBaseProps) unchanged; opt into the third
// auditor option via `auditorOption` (ReviewsDashboard, v4.3.0) — see web/CLAUDE.md,
// "reports-scoped lists".
export default function ReportsScopeSelect(props: ReportsScopeSelectBaseProps): React.JSX.Element;
export default function ReportsScopeSelect(props: ReportsScopeSelectAuditorProps): React.JSX.Element;
export default function ReportsScopeSelect(
  props: ReportsScopeSelectBaseProps | ReportsScopeSelectAuditorProps,
): React.JSX.Element {
  const { t } = useTranslation();
  const auditorOption = props.auditorOption === true;
  const auditorOnly = auditorOption && props.auditorOnly === true;

  const data = auditorOnly
    ? [{ value: "auditor", label: t("common.reportsScope.auditor") }]
    : [
        { value: "direct", label: t("common.reportsScope.direct") },
        { value: "all", label: t("common.reportsScope.all") },
        ...(auditorOption ? [{ value: "auditor", label: t("common.reportsScope.auditor") }] : []),
      ];

  return (
    <Select
      label={t("common.reportsScope.label")}
      data={data}
      value={props.value}
      allowDeselect={false}
      disabled={auditorOnly}
      onChange={(v) => {
        if (!v) return;
        // The rendered `data` above is exactly the domain `onChange` accepts for the branch in
        // play (BaseProps never renders "auditor"; AuditorProps' onChange accepts it) — safe by
        // construction, not by the cast.
        (props.onChange as (scope: string) => void)(v);
      }}
    />
  );
}
