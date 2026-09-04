import { Box, Group, Input } from "@mantine/core";
import { TimeInput } from "@mantine/dates";
import { useTranslation } from "react-i18next";
import DateField from "./DateField";

export type DateTimeFieldProps = {
  /** The bound's caption — the group's accessible name; the two inputs are named "<label> — date" / "<label> — time". */
  label: string;
  /** The app's `YYYY-MM-DDTHH:mm` state (the former datetime-local shape; empty = unset). */
  value?: string;
  onChange: (local: string) => void;
  disabled?: boolean;
  description?: string;
  error?: string;
};

const split = (local: string) => {
  const [date = "", time = ""] = local.split("T");
  return { date, time };
};

/**
 * The date-time input (v3.5.0): a typed-ISO DateField beside a time input, replacing the
 * two `<TextInput type="datetime-local">` alert bounds. Both halves are typed inputs, so
 * keyboard entry and tests drive them like the date fields; the hint/error render below.
 */
export default function DateTimeField({ label, value = "", onChange, disabled, description, error }: DateTimeFieldProps) {
  const { t } = useTranslation();
  const { date, time } = split(value);
  return (
    <Input.Wrapper description={description} error={error} inputWrapperOrder={["label", "input", "description", "error"]}>
      <Box role="group" aria-label={label}>
        <Group gap="xs" wrap="nowrap" align="flex-start">
          <DateField
            aria-label={t("common.field.dateOf", { label })}
            value={date}
            onChange={(iso) => onChange(iso ? `${iso}T${time || "00:00"}` : "")}
            disabled={disabled}
            error={error != null}
            w={170}
          />
          <TimeInput
            aria-label={t("common.field.timeOf", { label })}
            value={time}
            onChange={(event) => onChange(date ? `${date}T${event.currentTarget.value}` : "")}
            disabled={disabled}
            error={error != null}
            w={110}
          />
        </Group>
      </Box>
    </Input.Wrapper>
  );
}
