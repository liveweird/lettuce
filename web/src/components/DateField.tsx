import { DateInput, type DateInputProps } from "@mantine/dates";
import { useTranslation } from "react-i18next";
import { isValidIsoDate } from "../utils/datetime";
import { isOutsideIsoRange } from "../utils/isoRange";

export type DateFieldProps = Omit<
  DateInputProps,
  "value" | "onChange" | "minDate" | "maxDate" | "defaultValue" | "excludeDate" | "dateParser"
> & {
  /** The app's ISO `YYYY-MM-DD` state (empty string = unset — the `@mantine/form` shape). */
  value?: string;
  onChange: (iso: string) => void;
  /** The calendar greys out days outside [minIso, maxIso] — a HINT like the native `min`/`max`
   *  attributes were: a typed out-of-range date still reaches the form, whose own validation
   *  explains the rule ("The due date cannot be in the past") instead of silently refusing. */
  minIso?: string;
  maxIso?: string;
};

/**
 * The strict parser (v3.5.2): only a complete, real ISO date commits. Mantine's default is a
 * lenient dayjs parse that turns every partial keystroke into a date ("2" → 2001-02-01) and
 * rolls overflow days ("2026-02-30" → March 2nd); returning null keeps the typed text in the
 * box without touching the value, so a partial or impossible date never reaches the form.
 */
const parseIsoDate = (typed: string) => (isValidIsoDate(typed) ? typed : null);

/**
 * The date input (v3.5.0): Mantine's DateInput over the app's ISO strings. Typed input is
 * ISO too (`valueFormat` YYYY-MM-DD, parsed as you type), so keyboard entry and the e2e
 * `fillDate` helper work exactly like the native input did, while the calendar popover
 * localizes through AppDatesProvider. Replaces every `<TextInput type="date">`.
 */
export default function DateField({ value = "", onChange, minIso, maxIso, ...rest }: DateFieldProps) {
  const { t } = useTranslation();
  return (
    <DateInput
      valueFormat="YYYY-MM-DD"
      dateParser={parseIsoDate}
      placeholder={t("common.field.datePlaceholder")}
      clearable
      clearButtonProps={{ "aria-label": t("common.field.clearDate") }}
      value={value === "" ? null : value}
      onChange={(next) => onChange(next ?? "")}
      excludeDate={minIso || maxIso ? (day) => isOutsideIsoRange(day, minIso, maxIso) : undefined}
      {...rest}
    />
  );
}
