import { Select } from "@mantine/core";
import { useTranslation } from "react-i18next";

export type ReportsScope = "direct" | "all";

// The "Reports" filter shared by the manager-facing lists (My subordinates, Feedback →
// My Team): direct reports only (the default) vs. the whole transitive management chain.
// The caller derives its includeIndirect API param from the selected value.
export default function ReportsScopeSelect({
  value,
  onChange,
}: {
  value: ReportsScope;
  onChange: (scope: ReportsScope) => void;
}) {
  const { t } = useTranslation();
  return (
    <Select
      label={t("common.reportsScope.label")}
      data={[
        { value: "direct", label: t("common.reportsScope.direct") },
        { value: "all", label: t("common.reportsScope.all") },
      ]}
      value={value}
      allowDeselect={false}
      onChange={(v) => {
        if (v) onChange(v as ReportsScope);
      }}
    />
  );
}
