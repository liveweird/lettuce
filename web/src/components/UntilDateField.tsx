import { useTranslation } from "react-i18next";
import { todayIsoDate } from "../utils/datetime";
import DateField from "./DateField";

/** The share dialogs' optional "Until" input (checkup #38 R5), driven by `useUntilDate`. */
export default function UntilDateField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (iso: string) => void;
  error: string | null;
}) {
  const { t } = useTranslation();
  return (
    <DateField
      label={t("sharing.until")}
      description={t("sharing.untilHint")}
      value={value}
      onChange={onChange}
      minIso={todayIsoDate()}
      error={error}
      w={{ base: "100%", sm: 260 }}
    />
  );
}
