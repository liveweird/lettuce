import { MultiSelect, type MultiSelectProps } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { USER_ROLES, type UserRole } from "../api/session";
import { accessibleRenderPill } from "./accessiblePill";

/**
 * The Roles field shared by the user create/edit forms: one option per additional role, empty =
 * regular user. Pills render through the shared accessible pill (a named remove button).
 */
export default function RolesMultiSelect(
  props: Omit<MultiSelectProps, "label" | "data" | "renderPill"> & { value?: UserRole[] },
) {
  const { t } = useTranslation();
  return (
    <MultiSelect
      label={t("common.field.roles")}
      placeholder={props.value?.length === 0 ? t("users.rolesNone") : undefined}
      data={USER_ROLES.map((value) => ({ value, label: t(`common.role.${value}`) }))}
      renderPill={accessibleRenderPill((role) => t("users.removeRole", { role }))}
      {...props}
    />
  );
}
