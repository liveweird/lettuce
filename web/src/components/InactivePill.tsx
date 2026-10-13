import { useTranslation } from "react-i18next";
import StatusPill from "./StatusPill";

/**
 * The one "Inactive" marker for a deactivated account (V44): a gray StatusPill — gray on
 * purpose, neither the brand accent nor a semantic state colour. Rendered ONLY for deactivated
 * people (active people carry no pill) on the surfaces that show a person as an entity: the
 * Users list, the user-details header, the dashboard person cards and the reviews rosters, the
 * mass-share rows and the org chart. Document tables (feedback, 1:1s, …) deliberately stay
 * unmarked — their rows are history. Callers keep their own aria-labels stable.
 */
export default function InactivePill() {
  const { t } = useTranslation();
  return <StatusPill color="gray">{t("users.inactiveBadge")}</StatusPill>;
}
