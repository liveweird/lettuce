import { Select } from "@mantine/core";
import { useTranslation } from "react-i18next";
import type { AccountStatus } from "../hooks/useAccountStatusFilter";

/**
 * The Status filter control (Any / Active / Inactive) shared by /users, the dashboard person-card
 * grids and the reviews rosters. Any = cleared (the placeholder), so the default Active shows as
 * a selected value and "Any" is one click on the clear button. State and the default live in
 * `hooks/useAccountStatusFilter.ts`.
 */
export default function AccountStatusSelect({
  value,
  onChange,
}: {
  value: AccountStatus;
  onChange: (status: AccountStatus) => void;
}) {
  const { t } = useTranslation();
  return (
    <Select
      label={t("users.statusFilterLabel")}
      placeholder={t("common.state.any")}
      data={[
        { value: "false", label: t("users.statusActive") },
        { value: "true", label: t("users.statusInactive") },
      ]}
      value={value}
      onChange={(v) => onChange((v as AccountStatus) ?? null)}
      clearable
    />
  );
}
