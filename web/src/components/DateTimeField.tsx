import { useState } from "react";
import { Box, Group, Input } from "@mantine/core";
import { TimeInput } from "@mantine/dates";
import { useTranslation } from "react-i18next";
import { isValidIsoDate } from "../utils/datetime";
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

const TIME_RE = /^\d{2}:\d{2}$/;

const split = (local: string) => {
  const [date = "", time = ""] = local.split("T");
  return { date, time };
};

/** The combined value when both halves are complete, else "" — never a dangling `${date}T`. */
const combine = (date: string, time: string) =>
  isValidIsoDate(date) && TIME_RE.test(time) ? `${date}T${time}` : "";

// The halves the user typed plus the value the parent is expected to hold after our last emit
// (initially the seed), so an external change — a form reset, a loaded record — re-seeds them
// while our own echo never does.
type Halves = { date: string; time: string; seen: string };

const seed = (value: string): Halves => ({ ...split(value), seen: value });

/**
 * The date-time input (v3.5.0): a typed-ISO DateField beside a time input, replacing the
 * two `<TextInput type="datetime-local">` alert bounds. Both halves are typed inputs, so
 * keyboard entry and tests drive them like the date fields; the hint/error render below.
 *
 * Since v3.5.2 the halves live in local state and the field emits the combined
 * `YYYY-MM-DDTHH:mm` ONLY once both are complete — anything less emits "" (an unset bound the
 * form's own validation flags), never a `${date}T` fragment that used to convert to a silent
 * null. Typing the time before the date is fine: the time waits for the date to land.
 */
export default function DateTimeField({ label, value = "", onChange, disabled, description, error }: DateTimeFieldProps) {
  const { t } = useTranslation();
  const [halves, setHalves] = useState<Halves>(() => seed(value));
  // Adopt an external value during render (the React "adjust state on prop change" idiom).
  if (value !== halves.seen) setHalves(seed(value));

  const emit = (date: string, time: string) => {
    const combined = combine(date, time);
    setHalves({ date, time, seen: combined });
    onChange(combined);
  };

  return (
    <Input.Wrapper description={description} error={error}>
      <Box role="group" aria-label={label}>
        <Group gap="xs" wrap="nowrap" align="flex-start">
          <DateField
            aria-label={t("common.field.dateOf", { label })}
            value={halves.date}
            onChange={(iso) => emit(iso, halves.time)}
            disabled={disabled}
            error={error != null}
            w={170}
          />
          <TimeInput
            aria-label={t("common.field.timeOf", { label })}
            value={halves.time}
            onChange={(event) => emit(halves.date, event.currentTarget.value)}
            disabled={disabled}
            error={error != null}
            w={110}
          />
        </Group>
      </Box>
    </Input.Wrapper>
  );
}
