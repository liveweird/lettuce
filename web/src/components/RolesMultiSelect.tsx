import { MultiSelect, Pill, type MultiSelectProps } from "@mantine/core";
import { useTranslation } from "react-i18next";
import { USER_ROLES, type UserRole } from "../api/session";

/**
 * The Roles field shared by the user create/edit forms: one option per additional role, empty =
 * regular user. Pills are custom-rendered because Mantine's default pill remove button carries
 * no accessible name.
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
      renderPill={({ option, onRemove, disabled }) => (
        <Pill
          withRemoveButton={!disabled}
          onRemove={onRemove}
          // Mantine hides the remove button from the a11y tree (aria-hidden + tabindex -1),
          // leaving keyboard/screen-reader users only the undiscoverable Backspace gesture —
          // surface it as a real, focusable, named button instead.
          removeButtonProps={{
            "aria-label": t("users.removeRole", { role: option.label }),
            "aria-hidden": false,
            tabIndex: 0,
          }}
        >
          {option.label}
        </Pill>
      )}
      {...props}
    />
  );
}
