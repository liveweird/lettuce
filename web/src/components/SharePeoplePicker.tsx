import { useMemo } from "react";
import { MultiSelect } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { getUserId } from "../api/session";
import { useAllUsers } from "../hooks/useAllUsers";
import { accessibleRenderPill } from "./accessiblePill";
import { renderUserOption, userOption } from "./userOptions";

/**
 * The "share with" people picker shared by the single-document ShareDialog and the mass-share
 * dialog. The value is the picked user ids as strings (the Mantine MultiSelect contract). It
 * never offers the caller or a deactivated account (the server answers those 400) nor anyone in
 * `excludedIds`; a person still in the selection stays listed so a refetch can never orphan a
 * pill. Names for failure messages come from `useAllUsers` (the same shared query).
 */
export default function SharePeoplePicker({
  value,
  onChange,
  excludedIds,
  maxValues,
  label,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  excludedIds: ReadonlySet<number>;
  maxValues?: number;
  label?: string;
}) {
  const { t } = useTranslation();
  const currentUserId = getUserId();
  const { userPool, usersError } = useAllUsers();

  const options = useMemo(
    () =>
      (userPool ?? [])
        .filter(
          (u) =>
            value.includes(String(u.id)) ||
            (u.id !== currentUserId && !u.deactivated && !excludedIds.has(u.id)),
        )
        .map((u) => userOption(u.id, u.name, (u.teams ?? []).map((team) => team.name)))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [userPool, currentUserId, excludedIds, value],
  );

  return (
    <MultiSelect
      label={label ?? t("sharing.shareWith")}
      placeholder={value.length === 0 ? t("sharing.pickPeople") : undefined}
      data={options}
      renderOption={renderUserOption}
      value={value}
      onChange={onChange}
      maxValues={maxValues}
      searchable
      hidePickedOptions
      nothingFoundMessage={t("sharing.noPeople")}
      error={usersError ? t("common.error.optionsFailed") : undefined}
      renderPill={accessibleRenderPill((name) => t("sharing.removePerson", { name }))}
    />
  );
}
