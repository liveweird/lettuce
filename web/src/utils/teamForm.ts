import type { TFunction } from "i18next";
import { hasLength } from "@mantine/form";

// Server limit (server teams/TeamRoutes.kt) mirrored client-side (v2.18.0).
export const MAX_TEAM_NAME_LENGTH = 100;

/** The form values shared by CreateTeam and EditTeam (the AlertFormValues idiom). */
export type TeamFormValues = {
  name: string;
  // The Select's string value; Number()-ed at the API boundary.
  managerId: string;
};

/** Validation rules shared by the create and edit team pages (mirrors the server's checks). */
export function teamFormValidation(t: TFunction) {
  return {
    name: hasLength({ min: 1, max: MAX_TEAM_NAME_LENGTH }, t("teams.nameLength")),
    managerId: (value: string) => (value ? null : t("teams.managerRequired")),
  };
}
